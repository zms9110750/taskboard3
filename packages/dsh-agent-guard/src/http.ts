/**
 * `GET /api/tools` —— 读 DSH 的**全量**工具清单（全局 ∪ 每个 agent preset ∪ 活 agent）。
 *
 * ## 为什么这个端点在本包（用户 `2026-11-23`）
 *
 * > 「这个访问工具的事情也要在agentguard这个包里。因为只有他会用。」
 *
 * 只有「工具权限」这套 UI 需要工具清单，所以端点跟着本行走 ——
 * 关掉本行，端点一起消失，不污染 `@taskboard/dsh` 的公开面。
 *
 * ## 数据从哪来（两次修订，都是实测推翻的）
 *
 * 第一版只读 `ctx.tools.schemas()`（不传 scope = 全局视图）。用户 `2026-11-24` 看到只有 16 个：
 *
 * > 「这里的工具集显然没有真正连通后端。不可能就这么一点工具」
 *
 * 实测：全局视图只含 root/host 层注册的工具；那几十个常用工具
 * （bash / read / write / grep / glob / pwsh / web_search / subagent / todo_write …）
 * 长在 **agent-preset 的 scope 层**里。
 *
 * ⇒ 现在的数据来源是 {@link createToolInventory}：全局 ∪ 每个 preset 的 scope ∪ 活 agent，
 *   按 name 去重（隔离 profile 实测 16 → 53）。
 *
 * ## 鉴权与 `@taskboard/dsh` 同源，不另发明
 *
 * `packages/dsh/src/http.ts:56` 的 `rejected()` 是唯一先例：
 *
 * ```ts
 * const rejection = connection.requestRejection(req);   // 401 / 403 / undefined
 * ```
 *
 * 本端点照抄这一调用与返回值处理 —— **`/api/tools` 暴露全部工具名与参数 schema，
 * 不该匿名可读**。`requestRejection` 收的形状与 node `IncomingMessage.headers`
 * 兼容（`dsh-client-connection/src/rpc.ts:98-101`）⇒ 不用构造 Fetch Request。
 *
 * ## 路由匹配方式：按 tail，不新挂一条路由
 *
 * `@taskboard/dsh` 已经把 `prefix: '/taskboard3'` 整段注册走了
 * （`packages/dsh/src/http.ts:868` `webServer.register({ kind:'prefix', … })`）。
 * **再挂一条 exact 很可能收不到请求** —— Host 先匹配到那条 prefix。
 *
 * ⇒ 本包改为：**在 dsh 的那条 prefix handler 里按 tail 分派**。
 *   `@taskboard/dsh` 的 handler 在遇到 `/api/tools` 时调
 *   `deps.agentGuardTools?()` 把请求交给本包（见 `packages/dsh/src/http.ts`）。
 *   这样只有一条路由、鉴权只写一次、顺序问题不存在。
 */

/** `ctx.connection` 的最小面（与 `@taskboard/dsh` 的 `ConnectionLike` 同形）。 */
export interface ConnectionLike {
	/** 返回 `401` / `403` 表示拒绝；`undefined` 表示放行。 */
	requestRejection(request: {
		readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
	}): 401 | 403 | undefined;
}

/** 入站请求的最小面（node `IncomingMessage` 满足）。 */
export interface IncomingLike {
	readonly method?: string | undefined;
	readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

/** 出站响应的最小面。 */
export interface OutgoingLike {
	statusCode: number;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
}

/** 一个工具在清单里的形状（= `schemas()` 的可见字段）。 */
export interface ToolSummary {
	readonly name: string;
	readonly description: string;
	readonly parameters: Record<string, unknown>;
}

/** 本端点相对 `ROUTE_PREFIX` 的 tail（`@taskboard/dsh` 的 handler 用它对）。 */
export const TOOLS_TAIL = '/api/tools';

/**
 * 在 `@taskboard/dsh` 的 prefix handler 里处理 `GET /api/tools`。
 *
 * ## 为什么允许 `listTools` 返回 Promise 却仍返回 `boolean`
 *
 * 枚举 preset scope 必须异步（`agentPresets.list()` / `acquireScope()` 都是 Promise），
 * 但 `@taskboard/dsh` 那侧的 `agentGuardTools` 是**同步分派**（它只判断「这条 tail 归你」）。
 *
 * ⇒ 保持「同步返回 true = 我接了」，需要异步时**内部 fire-and-forget**：
 *   响应可以稍后 `res.end()`，node 的 `ServerResponse` 允许。
 *   这样不用把 `boolean` 的契约改成 `Promise<boolean>`，也不用动 `@taskboard/dsh` 的
 *   `deps` 类型（那会牵动另一行的公开面）。
 *
 * @param connection Host 的连接服务（鉴权）
 * @param req 请求
 * @param res 响应
 * @param listTools 取全量工具清单（调用方负责 `createToolInventory()`）
 * @returns `true` = 已处理（调用方不要再往下走）
 */
export function handleToolsRequest(
	connection: ConnectionLike,
	req: IncomingLike,
	res: OutgoingLike,
	listTools: () => readonly unknown[] | Promise<readonly unknown[]>,
): boolean {
	/* ① 鉴权：与 `@taskboard/dsh` 同一调用、同一返回值处理。 */
	if (rejected(connection, req, res)) return true;

	/* ② 只支持 GET。 */
	if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
		sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '只支持 GET。' });
		return true;
	}

	/* ③ 返回清单（只保留白名单三字段）。同步返回的直接写，异步的等它写完。 */
	const result = listTools();
	if (isPromiseLike(result)) {
		void result.then(
			(tools) => {
				sendJson(res, 200, { tools: normalize(tools) });
			},
			(error: unknown) => {
				/*
				 * 走到这里说明 `createToolInventory()` 的兜底也没兜住。
				 * ⚠ 仍然**不返回 500**：清单读不到是降级，不是请求非法。
				 *   返回空清单 + 200，UI 那边会显示「0 个」，比整页报错好定位。
				 */
				console.warn(`[taskboard3-agent-guard] /api/tools 枚举失败：${String(error)}`);
				sendJson(res, 200, { tools: [] });
			},
		);
		return true;
	}
	sendJson(res, 200, { tools: normalize(result) });
	return true;
}

/**
 * 判断返回值是不是 Promise（不依赖构造函数，避免跨 realm 误判）。
 *
 * @param value 候选值
 * @returns `true` = 需要 await
 */
function isPromiseLike(value: readonly unknown[] | Promise<readonly unknown[]>): value is Promise<readonly unknown[]> {
	return typeof (value as { then?: unknown }).then === 'function';
}

/**
 * 鉴权 —— **照抄** `packages/dsh/src/http.ts:56` 的 `rejected()`。
 *
 * @returns `true` = 已经写了响应，调用方应立即 return
 */
function rejected(connection: ConnectionLike, req: IncomingLike, res: OutgoingLike): boolean {
	const rejection = connection.requestRejection(req);
	if (rejection === undefined) return false;
	sendJson(res, rejection, {
		ok: false,
		code: 'UNAUTHORIZED',
		message: rejection === 401 ? '未认证（浏览器 cookie 缺失或无效）。' : '来源不可信（Host / Origin 校验失败）。',
	});
	return true;
}

/** 写 JSON。 */
function sendJson(res: OutgoingLike, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.end(JSON.stringify(body));
}

/**
 * 把 `schemas()` 的原始返回收成 `{ name, description, parameters }`。
 *
 * ⚠ 只保留白名单三字段 —— DSH 的 `ToolSchema` 可能带更多字段，但清单不需要，
 *   也不该把内部元数据漏到 UI。
 */
function normalize(raw: readonly unknown[]): readonly ToolSummary[] {
	const out: ToolSummary[] = [];
	for (const item of raw) {
		if (typeof item !== 'object' || item === null) continue;
		const one = item as Record<string, unknown>;
		const name = typeof one['name'] === 'string' ? one['name'] : undefined;
		if (name === undefined) continue;
		const description = typeof one['description'] === 'string' ? one['description'] : '';
		const parameters =
			typeof one['parameters'] === 'object' && one['parameters'] !== null
				? (one['parameters'] as Record<string, unknown>)
				: {};
		out.push({ name, description, parameters });
	}
	return out;
}
