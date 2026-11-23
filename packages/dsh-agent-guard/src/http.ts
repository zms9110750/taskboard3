/**
 * `GET /api/tools` —— 读 DSH 的**全局**工具清单。
 *
 * ## 为什么这个端点在本包（用户 `2026-11-23`）
 *
 * > 「这个访问工具的事情也要在agentguard这个包里。因为只有他会用。」
 *
 * 只有「工具权限」这套 UI 需要工具清单，所以端点跟着本行走 ——
 * 关掉本行，端点一起消失，不污染 `@taskboard/dsh` 的公开面。
 *
 * ## 数据从哪来（已核实的 DSH API）
 *
 * ```ts
 * // packages/dsh-tools/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts:712
 * schemas(scope?: ScopeKey): ToolSchema[];
 * // 文档 L706-711：Project visible definitions onto the allowlisted model-facing
 * //              schema fields, omitting scope = the global view
 * ```
 *
 * **不传 `scope`** ⇒ 全局视图（用户 `2026-11-23`：「就用全局吧。保险起见」）。
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
 * @param connection Host 的连接服务（鉴权）
 * @param req 请求
 * @param res 响应
 * @param listTools 取全局工具清单（调用方负责读 `ctx.tools.schemas()`）
 * @returns `true` = 已处理（调用方不要再往下走）
 */
export function handleToolsRequest(
	connection: ConnectionLike,
	req: IncomingLike,
	res: OutgoingLike,
	listTools: () => readonly unknown[],
): boolean {
	/* ① 鉴权：与 `@taskboard/dsh` 同一调用、同一返回值处理。 */
	if (rejected(connection, req, res)) return true;

	/* ② 只支持 GET。 */
	if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
		sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: '只支持 GET。' });
		return true;
	}

	/* ③ 返回清单（只保留白名单三字段）。 */
	sendJson(res, 200, { tools: normalize(listTools()) });
	return true;
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
