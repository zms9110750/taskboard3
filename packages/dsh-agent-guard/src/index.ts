/**
 * `@taskboard/dsh-agent-guard` —— 任务板对 DSH 的**入侵式权限面**，一个可单独关闭的插件行。
 *
 * ## 这个包为什么存在（用户 `2026-11-23`）
 *
 * > 「3. agent处有一个权限选择。完全由各自agent接入处提供。这不是任务板的功能。
 * >   因为这依赖agent自己的tool。所以mcp也不提供这个功能。别的agent也不提供这个功能。
 * >   这是对于dsh私人的专属功能。
 * >  4. 由3伴生来的一个档位对工具的拦截和权限。也是我对于dsh的私人专属实现。
 * >   这个tool，不在core里提供。完全由dsh桥接包提供。并且这个ui也完全由dsh ui提供。
 * >   mcp不提供这个tool和ui。」
 *
 * > 「这个访问工具的事情也要在agentguard这个包里。因为只有他会用。」
 *
 * ## 它装了什么（五样，全在**这一行**里）
 *
 * ```
 * ① 三个 agent 侧 tool 档位   ToolGuardLevel: off / manage / manage-edit
 *                             （kv 存储借用 @taskboard/store 的端口）
 * ② 入侵式 guard              ctx.tools.guard(...) —— 挂在 DSH 的工具管线上
 * ③ 两个 AI 工具              taskboard_tool_policy / taskboard_tool_policy_read
 *                             （原来是 @taskboard/tools 的一部分 ⇒ MCP 会拿到，
 *                               用户明确说不许 ⇒ 已搬到本包）
 * ④ GET /api/tools            读 ctx.tools.schemas()（全局视图），给工具清单供数据
 * ⑤ 三档位的 UI               ⚠ **不在本包**：UI 在 `@taskboard/dsh-client`
 *                             （用户：「这个ui也完全由dsh ui提供」）
 * ```
 *
 * ## 关掉这一行会怎样
 *
 * ```
 * · 三个档位消失（composer 的权限框读不到值）
 * · guard 不再挂载 ⇒ 任务板不再干涉 agent 的工具调用
 * · 两个 policy 工具消失（MCP 本来就没有）
 * · GET /api/tools 404
 * · 任务板的其它功能（卡 / 空间 / HTTP / 界面）**不受影响**
 * ```
 *
 * ## 依赖方向
 *
 * ```
 * dsh-agent-guard ──► @taskboard/dsh-tools   （借它的 DSH schema 适配器）
 *                 ──► @taskboard/tools       （工具定义的零件）
 *                 ──► @taskboard/core        （Taskboard 实例、策略存储）
 * ```
 *
 * ⚠ **`@taskboard/dsh-tools` 不反过来依赖本包** —— 它需要读「是否 manage-edit」时，
 *   走 Cordis 服务 `ctx.get('taskboard3AgentGuard')`，不是 import。
 *   这样「关掉本行」不会让 `dsh-tools` 那一行崩。
 */

/*
 * ───────────────── TODO(审查) 汇总（本包 2026-11-25 审查，只记问题，未改逻辑） ─────────────────
 * 非源码问题（package.json / test / 产物）落在这里；源码内的问题就近标在对应代码旁。
 *
 * TODO(审查): package.json:30-37 把 peer `@deepseek-ai/dsh-tools` 标成 optional，但 src/tools.ts 经
 *   @taskboard/dsh-tools 运行时必然 require 它 ⇒ 缺它时本包不是降级而是 import 失败。
 *   可直接改：改必选 peer，或 tools.ts 动态导入降级；发布口径需用户确认。
 * TODO(审查): apply() 零测试（全包无 test 导入本文件）⇒ inject 清单 / provide 形状 / guard 与 tools 的
 *   卸载顺序 / 可选服务回落全无覆盖，而「少列 inject」只会静默不激活（症状：dsh: warning: 1 entry
 *   did not activate）。可直接改：新增 test/apply.test.ts，用假 ctx 断言 register 3 次、dispose 先 guard。
 * TODO(审查): test/guard.test.ts:57,75-77,91 的 dataDir 创建后从不使用（每个用例在 beforeEach 另建），
 *   只在 after 被删；:82 又用 `undefined as unknown as Taskboard` 表示已关闭。
 *   可直接改：删 dataDir，taskboard 改 `Taskboard | undefined`。
 * TODO(审查): test/guard.test.ts:174-176 断言「namesOf 返回空串 ⇒ 回落 agent.id」，正是与 dsh-tools
 *   holderOf 的分歧行为（见 permission.ts 内 TODO）；改用 dsh-tools 实现后这条会失败。
 *   可直接改：随 holder 统一一起删/移到 dsh-tools。
 * TODO(审查): test/policy-tools.test.ts:76,84,87 的 workspaceId 只被 `void workspaceId;` 消费，
 *   before 里建 workspace 对这两个权限工具无用。可直接改：删 workspace 创建与该变量。
 * TODO(审查): test/policy-tools.test.ts:123,136 给「读」工具传 `{ tier: 'unclaimed' }`，但读工具
 *   inputSchema 是 additionalProperties:false 且只认 templateRef ⇒ 真实 DSH 校验会拒；假 defineTool
 *   绕过校验才绿。可直接改：测试改传 {}。
 * TODO(审查): 两个工具的 hosts:['dsh'] 过滤与 adaptDefinitions 的 schema 转换在本包零覆盖（测试用假
 *   defineTool 直接调 handler）。可直接改：补一条经真实 adaptDefinitions 的 schema 形状断言。
 * TODO(审查): lib/.tsbuildinfo#2 是产物目录里的旁路残留（tsconfig:7 指定 ./lib/.tsbuildinfo）。
 *   可直接改：rm -rf lib && tsc -b 后确认不再出现；若为中断构建残留，无需其它处理。
 * ────────────────────────────────────────────────────────────────────────────────────────────
 */

import type { Taskboard } from '@taskboard/core';

import { handleToolsRequest, type ConnectionLike, type IncomingLike, type OutgoingLike } from './http.ts';
import { createPermissionGuard } from './permission.ts';
import { createAgentGuardTools } from './tools.ts';
import {
	createToolInventory,
	type AgentsLike,
	type PresetsLike,
} from './tool-inventory.ts';
import { readToolGuardLevelOf, writeToolGuardLevel, type ToolGuardKv, type ToolGuardLevel } from './tool-guard.ts';

/** Cordis 插件名（bundle 第 6 行的 id 用 `taskboard3-agent-guard`）。 */
export const name = 'taskboard3-agent-guard';

/**
 * 前置服务。
 *
 * · `taskboard3Core`  —— `@taskboard/dsh-core` 提供的实例
 * · `taskboard3Store` —— `@taskboard/store` 提供的 kv 端口（存三档位）
 * · `tools`           —— DSH 工具注册表 + guard
 * · `webServer`       —— 挂 `GET /api/tools`
 *
 * ⚠ **四个都要列**（AGENTS §3.10 的教训）：少列一个不报「缺依赖」，
 *   而是 `apply` 里第一次读 `ctx.<服务>` 时才抛 `cannot get property … without inject`，
 *   症状是 profile 启动报 `dsh: warning: 1 entry did not activate`。
 */
// TODO(审查): 上面注释说「四个都要列」，但这里只有 3 个；第四项 webServer 已不再使用（路由改走
//   @taskboard/dsh 的 prefix handler，见 http.ts:36-45），apply 末尾 effect label 也仍写着 /api/tools。
//   可直接改：注释改「三个」、label 去掉 /api/tools。
export const inject = ['taskboard3Core', 'taskboard3Store', 'tools'] as const;

/** 本插件行的配置（暂无）。 */
// TODO(审查): Config 为空，而 tool-inventory 的 TTL（10s / 1s）是硬编码；DSH 实践建议可调值进 Config
//   以便用户在 cordis.patch.yml 改（dsh-doc references/practices.md:22）。
//   需用户决定：是否把 TTL 暴露成配置项。
export interface Config {}

/** 本包 provide 给别的行用的服务名。 */
export const AGENT_GUARD_SERVICE = 'taskboard3AgentGuard' as const;

/** `AGENT_GUARD_SERVICE` 的形状。 */
export interface AgentGuardService {
	/** 读当前档位。 */
	readonly readLevel: () => ToolGuardLevel;
	/** 写档位（UI / HTTP 用）。 */
	readonly writeLevel: (level: ToolGuardLevel) => Promise<void>;
	/** `manage-edit` 才允许编辑档位权限（`canManageToolPolicies` 的唯一来源）。 */
	readonly isManageEdit: () => boolean;
	/** GET /api/tools 的处理器（由 `@taskboard/dsh` 的 prefix handler 转过来）。 */
	readonly handleTools: (connection: ConnectionLike, req: IncomingLike, res: OutgoingLike) => boolean;
}

/** `apply` 用到的最小上下文形状。 */
export interface ApplyContext {
	readonly taskboard3Core: Taskboard;
	readonly taskboard3Store: ToolGuardKv;
	readonly tools: {
		register(tool: unknown): () => void;
		guard(fn: (exec: unknown) => unknown): () => void;
	};
	// TODO(审查): 这个字段全包无人使用（grep 只命中类型声明本身），路由已改为在 @taskboard/dsh 的
	// prefix handler 里按 tail 分派。可直接改：删掉 webServer 字段。
	readonly webServer: {
		register(route: {
			kind: 'exact' | 'prefix';
			path: string;
			handler: (req: never, res: never) => void | Promise<void>;
		}): () => void;
	};
	readonly subagents?: unknown;
	/**
	 * `ctx.loader`（cordis loader）。
	 *
	 * 只用来 `await()` 等挂载稳定 —— 枚举 preset 之前要先等挂载完成，
	 * 否则会拿到「还没注册完」的半个注册表。可选：没有就跳过等待。
	 */
	readonly loader?: { await?(): Promise<unknown> } | undefined;
	get?(name: string): unknown;
	provide(serviceName: string, api: unknown): void;
	// TODO(审查): effect 标成可选后被 `ctx.effect?.()` 调用；宿主没有 effect 时 guard 与两个工具在插件
	// 卸载时泄漏（服务也仍在）。cordis 的 effect 是 Context 固有方法。可直接改：改必选（也让 apply 测试
	// 更真实）；若确需可选，应补一条「无 effect 时不注册」的显式分支。
	effect?(effect: () => () => void, label?: string): void;
}

/**
 * 装这一行。
 *
 * @param ctx 宿主上下文（只需要上面声明的那几个服务）
 * @param config 无
 */
export function apply(ctx: ApplyContext, _config: Config = {}): void {
	const taskboard = ctx.taskboard3Core;
	const kv = ctx.taskboard3Store;

	/*
	 * `ctx.subagents` 是**可选**服务 —— 用可选访问读它，不能写进 inject。
	 * 没有 subagent 环境的 profile 也该能用（holder 回落 `agent.id`）。
	 */
	// TODO(审查): 可选服务有 3 种读法：这里 ctx.get 优先/否则读属性并强转，下面 optionalService 只走
	// ctx.get，再下面 loader 又 `ctx.loader ?? optionalService('loader')`。可直接改：全部收敛到一个
	// optionalService（subagents/loader 也走它），同时删掉本行的强转。
	// TODO(审查): DSH 实践（dsh-doc references/practices.md:20）建议可选服务走 inject / ctx.inject([...])，
	// 而不是 ctx.get + 手写形状检测（hasSubagents / typeof list）。需用户决定：改成 ctx.inject 要重构。
	const subagents =
		typeof ctx.get === 'function' ? ctx.get('subagents') : (ctx as { subagents?: unknown }).subagents;

	/* ① 档位读写 + 对外服务（`dsh` 的 /api/permission 和 composer 权限框都靠它）。 */

	/* ④ GET /api/tools 的处理器（服务上暴露给 `@taskboard/dsh` 的 prefix handler）。 */
	/*
	 * 数据源 = 全量并集：全局层 ∪ 每个 agent preset 的 scope ∪ 活 agent。
	 *
	 * ⚠ `agentPresets` / `agents` 都是**可选**服务（preset registry 只在 web-app 形态存在），
	 *   只能 `ctx.get(…)` 可选访问 —— 写进 `inject` 会让 TUI / headless profile 整行不激活。
	 *   现成先例：上面 `ctx.get('subagents')`。
	 */
	const optionalService = <T>(serviceName: string): T | undefined => {
		if (typeof ctx.get !== 'function') return undefined;
		const found = ctx.get(serviceName);
		return found === undefined || found === null ? undefined : (found as T);
	};
	// TODO(审查): `as unknown as ToolsSchemasLike` 双强转只为访问 schemas()；运行时已确认
	// tools.schemas(scope?: ScopeKey, toolSet?) 真实存在（cordis_inspect_query host Service）。
	// 可直接改：把 schemas? 写进 ApplyContext.tools，删掉 ToolsSchemasLike；变量名 permissionTools 实为
	// tools 服务，建议改 toolsService。
	const permissionTools = ctx.tools as unknown as ToolsSchemasLike;
	/*
	 * ⚠ 全部用**延迟解析**（函数），不在 apply 时固化。
	 *
	 * `apply()` 执行时别的插件可能还没激活（本行是 bundle 第 6 行，
	 * preset-registry 由 `dsh-web-app` 插入，激活顺序不由我们决定）。
	 * 第一版就是在这里取一次值 ⇒ `/api/tools` 只返回 16 个（preset 层被静默跳过）。
	 * 枚举发生在**请求到达时**，那时服务早就齐了。
	 */
	const toolInventory = createToolInventory({
		schemas: (scope?: unknown) => permissionTools.schemas?.(scope) ?? [],
		resolvePresets: () => optionalService<PresetsLike>('agentPresets'),
		resolveAgents: () => optionalService<AgentsLike>('agents'),
		resolveAwaitReady: () => {
			const loader = ctx.loader ?? optionalService<{ await?(): Promise<unknown> }>('loader');
			if (loader?.await === undefined) return undefined;
			return async (): Promise<unknown> => loader.await?.();
		},
		warn: (message) => {
			console.warn(`[taskboard3-agent-guard] ${message}`);
		},
	});

	const handleTools = (connection: ConnectionLike, req: IncomingLike, res: OutgoingLike): boolean =>
		handleToolsRequest(connection, req, res, toolInventory);

	const service: AgentGuardService = {
		readLevel: () => readToolGuardLevelOf(kv),
		writeLevel: async (level) => {
			await writeToolGuardLevel(kv, level);
		},
		// TODO(审查): 与 src/tools.ts:59 各自写一遍 `readToolGuardLevelOf(kv) === 'manage-edit'`，
		// 同一事实两处重算（service.isManageEdit 也是同一份）。可直接改：把 isManageEdit 注入
		// createAgentGuardTools，或让 tools.ts 直接用这里的结果。
		isManageEdit: () => readToolGuardLevelOf(kv) === 'manage-edit',
		handleTools,
	};
	ctx.provide(AGENT_GUARD_SERVICE, service);

	/* ② 入侵式 guard —— 加装在 DSH 的工具管线上。 */
	const permissionGuard = createPermissionGuard({ taskboard, kv, subagents });
	const disposeGuard = ctx.tools.guard(permissionGuard);

	/* ③ 两个 AI 工具（写 / 读三档策略）—— 定义在本包，不再进 `@taskboard/tools`。 */
	const tools = createAgentGuardTools({ taskboard, kv, subagents });
	const disposeTools = tools.map((tool) => ctx.tools.register(tool));

	const disposeAll = (): void => {
		/* 先摘 guard，再清工具：卸载过程中不该再有机会按旧档位判定。 */
		disposeGuard();
		for (const dispose of disposeTools) {
			// TODO(审查): register 的返回类型已保证是函数，这个 typeof 分支是多余的防御。
			// 可直接改：删掉判断，直接 `dispose()`。
			if (typeof dispose === 'function') (dispose as () => void)();
		}
	};

	/*
	 * ⚠ `ctx.effect(execute)` 的 `execute` 会被**立即调用**，返回值才被收作 disposer。
	 *   写 `ctx.effect(disposeAll)` 会让它立刻执行 —— 工具刚注册就被删掉。
	 */
	ctx.effect?.(() => disposeAll, 'taskboard3-agent-guard: guard + policy tools + /api/tools');
}

/** `ctx.tools` 上本包用到的 `schemas()` 最小面（DSH `ToolsService`）。 */
interface ToolsSchemasLike {
	schemas(scope?: unknown): unknown[];
}

export { handleToolsRequest, TOOLS_TAIL, type ConnectionLike, type IncomingLike, type OutgoingLike } from './http.ts';
export { createAgentGuardTools, type AgentGuardToolDeps } from './tools.ts';
export { createToolPolicyTool } from './tool-policy.ts';
export { createToolPolicyReadTool } from './tool-policy-read.ts';
export {
	createPermissionGuard,
	heldWorkCardsOf,
	type GuardDeps,
	type GuardVerdict,
} from './permission.ts';
export * from './tool-guard.ts';
