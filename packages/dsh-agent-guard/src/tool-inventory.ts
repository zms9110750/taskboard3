/**
 * 工具清单的「全量并集」—— `/api/tools` 的数据来源。
 *
 * ## 为什么不能只读 `ctx.tools.schemas()`
 *
 * 用户 `2026-11-24`：「这里的工具集显然没有真正连通后端。不可能就这么一点工具。」
 *
 * `schemas()` 不传 scope 时是**全局视图**：只含在 root/host 上下文注册的工具。
 * 隔离 profile 里实测只有 16 个（11 个 `taskboard_*` + `working_directory` + 4 个 `team_task_*`），
 * 而一个正常 agent 有 50+ 个（bash / read / write / grep / glob / pwsh / web_search /
 * subagent / todo_write / skill / present …）。
 *
 * 那几十个长在 **agent-preset 的 scope 层**里（`dsh-web-app` 把 agent plane 挪进了 preset）。
 *
 * ## 官方没有聚合 API，用两个枚举入口拼
 *
 * ```ts
 * ctx.agentPresets.list(): Promise<{ id: string }[]>
 * ctx.agentPresets.acquireScope(id): Promise<{ key: ScopeKey } & AsyncDisposable>
 * ctx.tools.schemas(lease.key)      // 该 preset 的可见工具
 *
 * ctx.agents.list(): Agent[]
 * ctx.tools.schemas(agent)          // 活 agent 自身的 scope 层（Agent 本身就是 ScopeKey）
 * ```
 *
 * ⇒ 并集 = 全局 ∪ 每个 preset 的 scope ∪ 每个活 agent 的 scope，按 **name** 去重。
 *
 * ## 两条必须守住的纪律
 *
 * 1. **`agentPresets` / `agents` 都是可选服务**：preset registry 只在 web-app 形态存在，
 *    TUI / headless profile 没有它。⇒ 只能 `ctx.get(…)` 可选访问，**绝不能写进 `inject`**
 *    （会让非 web profile 报缺依赖、整行不激活 —— 本仓库踩过）。
 * 2. **任何一个环节失败都不许让端点 500**：list 抛、acquireScope 抛、lease 释放抛，
 *    全部降级跳过；最差也返回全局那 16 个。
 *
 * ## 缓存
 *
 * `list()` + `acquireScope()` 每次都很重 ⇒ 默认 10 秒 TTL。
 * 另外在枚举前 `await loader.await()`（官方 diagnostic 也这么做），等挂载稳定。
 */

/** preset registry 的最小面（`ctx.agentPresets`）。 */
export interface PresetsLike {
	list(): Promise<readonly { readonly id: string }[]>;
	acquireScope(id: string): Promise<ScopeLeaseLike>;
}

/**
 * `acquireScope()` 返回的租约。
 *
 * 真实对象带 `[Symbol.asyncDispose]()`；`lib` 是 ES2023，没有这个符号的类型，
 * 所以这里只声明 `key`，释放时按运行时符号去取（见 `disposeLease`）。
 */
export interface ScopeLeaseLike {
	readonly key: unknown;
}

/** 活 agent 清单的最小面（`ctx.agents`）。 */
export interface AgentsLike {
	list?(): readonly unknown[];
}

/** 本模块要的依赖，全部可注入（测试用假件）。 */
export interface InventoryDeps {
	/** `ctx.tools.schemas(scope?)`。 */
	readonly schemas: (scope?: unknown) => readonly unknown[];
	/**
	 * **延迟解析** `agentPresets`（`ctx.get('agentPresets')`）。
	 *
	 * ⚠ 必须是函数而不是值：`apply()` 执行时，别的插件可能**还没激活**
	 *   （我们的行是 bundle 里第 6 行，preset-registry 由 `dsh-web-app` 插入，
	 *   激活顺序不由我们决定）⇒ apply 时 `ctx.get()` 拿到 undefined，
	 *   而枚举发生在请求到达时（那时服务早就齐了）。
	 *
	 * 第一版就是**在 apply 时取一次值**，结果 /api/tools 只返回 16 个 ——
	 *   服务当时还没注册，`presets` 是 undefined，preset 层直接跳过（且不告警，所以静默）。
	 */
	readonly resolvePresets?: (() => PresetsLike | undefined) | undefined;
	/** 直接给 preset registry（测试用；给了就不用 resolver）。 */
	readonly presets?: PresetsLike | undefined;
	/** 延迟解析 `ctx.get('agents')`（理由同上）。 */
	readonly resolveAgents?: (() => AgentsLike | undefined) | undefined;
	/** 直接给 agents 服务（测试用）。 */
	readonly agents?: AgentsLike | undefined;
	/** 延迟解析 `ctx.loader.await`（等挂载稳定）。 */
	readonly resolveAwaitReady?: (() => (() => Promise<unknown>) | undefined) | undefined;
	/** 直接给等挂载函数（测试用）。 */
	readonly awaitReady?: (() => Promise<unknown>) | undefined;
	/** 降级时的告警出口（默认 `console.warn`）。 */
	readonly warn?: ((message: string) => void) | undefined;
	/** 时钟（测试注入）。 */
	readonly now?: (() => number) | undefined;
	/** 缓存 TTL，默认 10 000ms。 */
	readonly ttlMs?: number | undefined;
}

/** 取「全量工具清单」的函数（带 TTL 缓存）。 */
export type ToolInventory = () => Promise<readonly unknown[]>;

/** 默认 TTL：10 秒。 */
export const DEFAULT_TOOLS_TTL_MS = 10_000;

/**
 * 「一个 scope 层都没枚举到」时的短 TTL：1 秒。
 *
 * 服务可能在我们第一次请求到达时还没注册完（激活顺序不由本行决定）⇒
 * 这种情况不能把「只有 16 个」缓存 10 秒，否则用户刷新页面还是看不到。
 */
export const UNSCOPED_TOOLS_TTL_MS = 1_000;

/**
 * 造一个「全量工具清单」取数器。
 *
 * @param deps 见 {@link InventoryDeps}
 * @returns 调用后返回去重后的原始 schema 数组（不做字段白名单，交给上层 normalize）
 */
export function createToolInventory(deps: InventoryDeps): ToolInventory {
	const ttlMs = deps.ttlMs ?? DEFAULT_TOOLS_TTL_MS;
	const now = deps.now ?? ((): number => Date.now());
	let cached: { readonly at: number; readonly tools: readonly unknown[]; readonly ttl: number } | undefined;
	let inflight: Promise<readonly unknown[]> | undefined;

	return async (): Promise<readonly unknown[]> => {
		if (cached !== undefined && now() - cached.at < cached.ttl) return cached.tools;
		if (inflight !== undefined) return inflight;
		inflight = collectTools(deps).then(
			(result) => {
				/* 没枚举到任何 scope 层 ⇒ 说明服务还没就绪，用短 TTL 尽快重试。 */
				cached = { at: now(), tools: result.tools, ttl: result.scoped ? ttlMs : UNSCOPED_TOOLS_TTL_MS };
				return result.tools;
			},
			(error: unknown) => {
				/* collectTools 自己不该抛；真抛了也不许毁掉端点 —— 退回全局视图。 */
				warn(deps, `清单枚举整体失败，退回全局视图：${String(error)}`);
				const fallback = trySchemas(deps);
				cached = { at: now(), tools: fallback, ttl: UNSCOPED_TOOLS_TTL_MS };
				return fallback;
			},
		);
		try {
			return await inflight;
		} finally {
			inflight = undefined;
		}
	};
}

/**
 * 一次完整枚举（不含缓存）。
 *
 * @param deps 见 {@link InventoryDeps}
 * @returns `tools` = 按 name 去重后的工具（保留先出现的定义）；`scoped` = 是否真的枚举到了 scope 层
 */
async function collectTools(
	deps: InventoryDeps,
): Promise<{ readonly tools: readonly unknown[]; readonly scoped: boolean }> {
	const byName = new Map<string, unknown>();
	let scoped = false;

	/* ① 全局层（老行为，永远先放，保证它不被挤掉）。 */
	try {
		merge(byName, safeSchemas(deps));
	} catch (error) {
		warn(deps, `读全局视图失败（继续枚举 scope）：${String(error)}`);
	}

	/* ② 等挂载稳定（失败就当没等到）。 */
	const awaitReady = deps.awaitReady ?? deps.resolveAwaitReady?.();
	try {
		await awaitReady?.();
	} catch (error) {
		warn(deps, `等挂载失败（忽略）：${String(error)}`);
	}

	/* ③ 每个 agent preset 的 scope 层。**每次枚举现取**，不在 apply 时固化。 */
	const presets = deps.presets ?? deps.resolvePresets?.();
	if (presets !== undefined) {
		let ids: readonly { readonly id: string }[];
		try {
			ids = await presets.list();
		} catch (error) {
			warn(deps, `列 agent preset 失败（只用全局 + 活 agent）：${String(error)}`);
			ids = [];
		}
		if (ids.length > 0) scoped = true;
		for (const one of ids) {
			if (typeof one !== 'object' || one === null) continue;
			const id = one.id;
			if (typeof id !== 'string' || id === '') continue;
			let lease: ScopeLeaseLike;
			try {
				lease = await presets.acquireScope(id);
			} catch (error) {
				warn(deps, `preset「${id}」拿 scope 失败（跳过）：${String(error)}`);
				continue;
			}
			try {
				merge(byName, safeSchemas(deps, lease.key));
			} catch (error) {
				warn(deps, `preset「${id}」读 schemas 失败（跳过）：${String(error)}`);
			} finally {
				await disposeLease(deps, lease, id);
			}
		}
	}

	/* ④ 活 agent 自己的 scope 层（Agent 本身就是 ScopeKey）。**每次枚举现取**。 */
	const agents = deps.agents ?? deps.resolveAgents?.();
	if (agents?.list !== undefined) {
		try {
			const live = agents.list();
			if (live.length > 0) scoped = true;
			for (const agent of live) {
				try {
					merge(byName, safeSchemas(deps, agent));
				} catch (error) {
					warn(deps, `活 agent 读 schemas 失败（跳过）：${String(error)}`);
				}
			}
		} catch (error) {
			warn(deps, `列活 agent 失败（跳过）：${String(error)}`);
		}
	}

	return { tools: [...byName.values()], scoped };
}

/**
 * 调 `schemas(scope)` 并保证返回数组。
 *
 * @param deps 依赖
 * @param scope 省略 = 全局视图
 * @returns 工具数组（调不通 ⇒ 空数组）
 */
function safeSchemas(deps: InventoryDeps, scope?: unknown): readonly unknown[] {
	const raw = scope === undefined ? deps.schemas() : deps.schemas(scope);
	return Array.isArray(raw) ? raw : [];
}

/**
 * `safeSchemas` 的「绝不抛」版本 —— 只在**兜底路径**用。
 *
 * 全局视图本身也可能抛（注册表未就绪 / 被卸载）；那种情况下端点仍要 200，
 * 只是清单为空。用在这里就不会出现「兜底兜出第二次异常」。
 *
 * @param deps 依赖
 * @returns 工具数组（抛了也返回空数组）
 */
function trySchemas(deps: InventoryDeps): readonly unknown[] {
	try {
		return safeSchemas(deps);
	} catch (error) {
		warn(deps, `兜底读全局视图也失败：${String(error)}`);
		return [];
	}
}

/**
 * 把一批工具按 name 并进 map（先出现的赢）。
 *
 * @param byName 目标 map
 * @param tools 待并工具
 */
function merge(byName: Map<string, unknown>, tools: readonly unknown[]): void {
	for (const item of tools) {
		const name = nameOf(item);
		if (name === undefined) continue;
		if (!byName.has(name)) byName.set(name, item);
	}
}

/**
 * 取工具名。
 *
 * @param item 原始 schema
 * @returns 名字；不是对象 / 没有字符串名字 ⇒ `undefined`
 */
function nameOf(item: unknown): string | undefined {
	if (typeof item !== 'object' || item === null) return undefined;
	const name = (item as { name?: unknown }).name;
	return typeof name === 'string' && name !== '' ? name : undefined;
}

/**
 * 释放 scope 租约。
 *
 * `[Symbol.asyncDispose]` 在 ES2023 的 lib 里没有类型，按运行时符号取；
 * 释放失败只告警，不能影响清单结果。
 *
 * @param deps 依赖
 * @param lease 租约
 * @param id preset id（告警用）
 */
async function disposeLease(deps: InventoryDeps, lease: ScopeLeaseLike, id: string): Promise<void> {
	const symbol = (Symbol as unknown as { asyncDispose?: symbol }).asyncDispose;
	if (symbol === undefined) return;
	const dispose = (lease as unknown as Record<symbol, unknown>)[symbol];
	if (typeof dispose !== 'function') return;
	try {
		await (dispose as () => Promise<void>).call(lease);
	} catch (error) {
		warn(deps, `preset「${id}」释放 scope 失败（忽略）：${String(error)}`);
	}
}

/**
 * 打一条告警。
 *
 * @param deps 依赖
 * @param message 文案
 */
function warn(deps: InventoryDeps, message: string): void {
	const sink = deps.warn;
	if (sink !== undefined) {
		sink(message);
		return;
	}
	console.warn(`[taskboard3-agent-guard] ${message}`);
}
