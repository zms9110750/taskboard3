/**
 * HTTP 路由 —— 浏览器与 Host 之间的数据通道。
 *
 * ## 为什么是裸 handler 而不是 `resource`
 *
 * `dsh-host-webserver` 的 `resource(request, peer)` **只接 `GET` / `HEAD`**，
 * 其它方法直接被 405。任务板有写操作（建卡、改卡、转移状态）⇒ 只能用
 * 裸 `handler(req, res)`，并自己完成鉴权。
 *
 * ## 鉴权
 *
 * `ctx.connection.requestRejection(req)` 收 `ConnectionTrustRequest`，
 * 而后者的 `headers` 类型与 node `IncomingMessage.headers` 兼容
 * （`dsh-client-connection/src/rpc.ts:98-101`）⇒ **不用构造 Fetch Request**。
 *
 * 完整先例：`dsh-host-open-in-app/src/index.ts:184-204`。
 *
 * ## 路径约定
 *
 * Host 注册用**带前导 `/`** 的绝对路径（`/taskboard3`）。
 * 浏览器 `fetch` 用**不带前导 `/`** 的相对形式 —— 页面可能挂在子路径下，
 * 绝对路径会跳出挂载点。见 `dsh-host-open-in-app/src/shared.ts:10-26`。
 *
 * ## 响应信封
 *
 * 成功 `{ ok: true, data }`；失败 `{ ok: false, code, message, issues?, detail? }`
 * （形状就是 `@taskboard/protocol` 的 `Failure`）。
 */

import type { SearchCondition, Taskboard } from '@taskboard/core';
import type { Failure, TaskState } from '@taskboard/protocol';
import { ErrorCode, failure, isTaskState, judgeTransition } from '@taskboard/protocol';

import type { ConnectionLike, IncomingLike, OutgoingLike, ReadableIncoming, WebServerLike } from './types.ts';

/** 路由前缀（Host 注册用，带前导 `/`）。 */
export const ROUTE_PREFIX = '/taskboard3';

/** 请求体上限：一条卡的最坏情况远小于它。 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * 判断一个请求是否被拒绝。
 *
 * @returns `true` = 已经写了响应，调用方应立即 return
 */
function rejected(connection: ConnectionLike, req: IncomingLike, res: OutgoingLike): boolean {
	const rejection = connection.requestRejection(req);
	if (rejection === undefined) return false;
	sendJson(res, rejection, {
		ok: false,
		code: ErrorCode.INTERNAL_ERROR,
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

/** 写成功信封。 */
function sendOk(res: OutgoingLike, data: unknown, status = 200): void {
	sendJson(res, status, { ok: true, data });
}

/** 写失败信封。 */
function sendFailure(res: OutgoingLike, fail: Failure, status?: number): void {
	sendJson(res, status ?? statusOf(fail.code), fail);
}

/**
 * 错误码 → HTTP 状态。
 *
 * ## 为什么按码映射而不是每处手写状态
 *
 * 同一个错误码可能在多个端点出现（`CARD_NOT_FOUND` 在 GET/PATCH/DELETE/action 都有）。
 * 每处手写状态 ⇒ 同一个码在不同端点上给出不同状态，客户端没法统一处理。
 *
 * ⇒ 映射只在这里写一次。
 */
function statusOf(code: Failure['code']): number {
	switch (code) {
		case ErrorCode.CARD_NOT_FOUND:
		case ErrorCode.WORKSPACE_NOT_FOUND:
		case ErrorCode.TEMPLATE_NOT_FOUND:
		case ErrorCode.ACTION_NOT_FOUND:
			return 404;
		case ErrorCode.TRANSITION_REJECTED:
		case ErrorCode.CLAIM_REJECTED:
		case ErrorCode.RELATION_TARGET_INVALID:
			return 409;
		case ErrorCode.TEMPLATES_UNAVAILABLE:
		case ErrorCode.PORT_UNAVAILABLE:
			return 501;
		default:
			return 400;
	}
}

/** 405。 */
function sendMethodNotAllowed(res: OutgoingLike, allow: string): void {
	res.statusCode = 405;
	res.setHeader('allow', allow);
	res.setHeader('content-type', 'text/plain; charset=utf-8');
	res.end(`method not allowed; use ${allow}`);
}

/**
 * 读请求体（限量）。
 *
 * node 的 `IncomingMessage` 是 `AsyncIterable`。超限直接抛，由调用方转成 413。
 */
async function readBody(req: ReadableIncoming): Promise<string> {
	const chunks: string[] = [];
	let size = 0;
	for await (const chunk of req) {
		const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
		size += text.length;
		if (size > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
		chunks.push(text);
	}
	return chunks.join('');
}

/** 读 JSON body；空 body 返回 `undefined`。 */
async function readJson(req: ReadableIncoming): Promise<unknown> {
	const text = await readBody(req);
	if (text.trim() === '') return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new Error('BODY_INVALID_JSON');
	}
}

/** 从 `url` 拆出 pathname 与 query。 */
function parseUrl(url: string | undefined): { path: string; query: URLSearchParams } {
	const raw = url ?? '/';
	const q = raw.indexOf('?');
	if (q < 0) return { path: raw, query: new URLSearchParams() };
	return { path: raw.slice(0, q), query: new URLSearchParams(raw.slice(q + 1)) };
}

/** 取 query 里的重复参数（`?status=a&status=b`）→ 数组；没有则 `undefined`。 */
function multi(query: URLSearchParams, key: string): readonly string[] | undefined {
	const all = query.getAll(key);
	return all.length === 0 ? undefined : all;
}

/** 从已解析的 body 里取字符串字段。 */
function str(body: unknown, key: string): string | undefined {
	if (typeof body !== 'object' || body === null) return undefined;
	const value = (body as Record<string, unknown>)[key];
	return typeof value === 'string' ? value : undefined;
}

/** 从已解析的 body 里取任意字段。 */
function raw(body: unknown, key: string): unknown {
	if (typeof body !== 'object' || body === null) return undefined;
	return (body as Record<string, unknown>)[key];
}

/** 路由装配参数。 */
export interface RouteDeps {
	/** 任务板实例。 */
	readonly taskboard: Taskboard;
	/** 鉴权服务。 */
	readonly connection: ConnectionLike;
	/**
	 * 解析「本次请求的默认空间」。
	 *
	 * ⚠ 这是**入口的默认参数策略**，不是 core 的概念。core 只认显式 `workspaceId`。
	 *   用户裁定：「整个激活都只对 dsh 会话有效。mcp 是没法提供的。」
	 */
	readonly defaultWorkspaceId: () => Promise<string>;
	/**
	 * 状态转移的写入口。
	 *
	 * ⚠ core 目前**没有** `transition()`（只有 create/update/remove）。
	 *   实现方在此接线；未接线时该端点答 501，而不是静默当作成功。
	 */
	readonly applyTransition?: (
		workspaceId: string,
		cardId: string,
		to: TaskState,
	) => Promise<
		| { readonly ok: true; readonly card: unknown }
		| Failure
	>;
}

/**
 * 建一个**单一路由 handler**，由 `webServer.register({ kind: 'prefix' })` 挂上。
 *
 * 用一条 prefix 路由而不是每端点一条：路径前缀相同、鉴权逻辑一致，
 * 拆成多条只是把同一个 `rejected` 调用抄 N 遍。
 */
export function createHandler(deps: RouteDeps): (req: ReadableIncoming, res: OutgoingLike) => Promise<void> {
	return async (req, res) => {
		try {
			await route(req, res, deps);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message === 'BODY_TOO_LARGE') {
				sendFailure(res, failure(ErrorCode.FIELD_REQUIRED, '请求体过大。'), 413);
				return;
			}
			if (message === 'BODY_INVALID_JSON') {
				sendFailure(res, failure(ErrorCode.FIELD_REQUIRED, '请求体不是合法 JSON。'), 400);
				return;
			}
			/* 路由内部异常绝不能退出进程（`host-webserver` 会把 handler 异常答成 400 并警告）。 */
			console.error('[taskboard3] 路由异常：', error);
			sendFailure(res, failure(ErrorCode.INTERNAL_ERROR, '内部错误。'), 500);
		}
	};
}

/** 真正的路由分派。 */
async function route(req: ReadableIncoming, res: OutgoingLike, deps: RouteDeps): Promise<void> {
	const { taskboard, connection } = deps;

	/* ① 鉴权先于一切 —— 未通过时连路径都不看。 */
	if (rejected(connection, req, res)) return;

	const method = (req.method ?? 'GET').toUpperCase();
	const { path, query } = parseUrl(req.url);
	const prefix = `${ROUTE_PREFIX}/api`;

	if (path !== prefix && !path.startsWith(`${prefix}/`)) {
		sendFailure(res, failure(ErrorCode.INTERNAL_ERROR, `未知路径：${path}`), 404);
		return;
	}
	const tail = path.slice(prefix.length);

	/* ── GET /api/state?workspace=<id> ── */
	if (tail === '/state') {
		if (method !== 'GET') return sendMethodNotAllowed(res, 'GET');
		const workspaceId = query.get('workspace') ?? (await deps.defaultWorkspaceId());
		sendOk(res, {
			workspaceId,
			workspaces: taskboard.listWorkspaces(true),
			cards: taskboard.list(workspaceId),
			templates: taskboard.listTemplates(),
			templateErrors: taskboard.templateErrors(),
		});
		return;
	}

	/* ── GET / POST /api/workspaces ── */
	if (tail === '/workspaces') {
		if (method === 'GET') {
			sendOk(res, { workspaces: taskboard.listWorkspaces(true) });
			return;
		}
		if (method === 'POST') {
			const body = await readJson(req);
			const created = await taskboard.createWorkspace(str(body, 'name') ?? '');
			if (!created.ok) return sendFailure(res, created);
			sendOk(res, { workspace: created.workspace }, 201);
			return;
		}
		return sendMethodNotAllowed(res, 'GET, POST');
	}

	/* ── GET /api/templates[?ref=<ref>] ── */
	if (tail === '/templates') {
		if (method !== 'GET') return sendMethodNotAllowed(res, 'GET');
		const ref = query.get('ref');
		if (ref === null) {
			sendOk(res, { templates: taskboard.listTemplates(), errors: taskboard.templateErrors() });
			return;
		}
		const meta = taskboard.templateMeta(ref);
		if (meta === undefined) {
			sendFailure(res, failure(ErrorCode.TEMPLATE_NOT_FOUND, `模板「${ref}」不存在。`), 404);
			return;
		}
		sendOk(res, { template: meta });
		return;
	}

	/* ── GET /api/search ── */
	if (tail === '/search') {
		if (method !== 'GET') return sendMethodNotAllowed(res, 'GET');
		const workspaceId = query.get('workspace') ?? (await deps.defaultWorkspaceId());
		const title = query.get('title');
		const status = multi(query, 'status');
		const kind = multi(query, 'kind');
		const domain = multi(query, 'domain');
		const templateRef = multi(query, 'templateRef');
		const condition: SearchCondition = {
			...(title === null ? {} : { title }),
			...(status === undefined ? {} : { status }),
			...(kind === undefined ? {} : { kind }),
			...(domain === undefined ? {} : { domain }),
			...(templateRef === undefined ? {} : { templateRef }),
		};
		/* `core.search` 走自己的搜索端口；这里不重复实现筛法。 */
		sendOk(res, { cards: taskboard.search(workspaceId, condition) });
		return;
	}

	/* ── POST /api/cards ── */
	if (tail === '/cards') {
		if (method !== 'POST') return sendMethodNotAllowed(res, 'POST');
		const body = await readJson(req);
		const workspaceId = str(body, 'workspaceId') ?? (await deps.defaultWorkspaceId());
		const content = raw(body, 'content');
		const created = await taskboard.create({
			workspaceId,
			templateRef: str(body, 'templateRef') ?? '',
			title: str(body, 'title') ?? '',
			...(content === undefined ? {} : { content }),
		});
		if (!created.ok) return sendFailure(res, created);
		sendOk(res, { card: created.card }, 201);
		return;
	}

	/* ── GET / PATCH / DELETE /api/cards/:id ── */
	const cardMatch = /^\/cards\/([^/]+)$/.exec(tail);
	if (cardMatch !== null) {
		const cardId = decodeURIComponent(cardMatch[1] ?? '');
		if (method === 'GET') {
			const workspaceId = query.get('workspace') ?? (await deps.defaultWorkspaceId());
			const found = taskboard.get(workspaceId, cardId);
			if (!found.ok) return sendFailure(res, found, 404);
			sendOk(res, { card: found.card });
			return;
		}
		if (method === 'PATCH') {
			const body = await readJson(req);
			const workspaceId = str(body, 'workspaceId') ?? (await deps.defaultWorkspaceId());
			const title = raw(body, 'title');
			const note = raw(body, 'note');
			const content = raw(body, 'content');
			const updated = await taskboard.update(workspaceId, cardId, {
				...(title === undefined ? {} : { title: str(body, 'title') ?? '' }),
				...(note === undefined ? {} : { note: str(body, 'note') ?? '' }),
				...(content === undefined ? {} : { content }),
			});
			if (!updated.ok) return sendFailure(res, updated);
			sendOk(res, { card: updated.card });
			return;
		}
		if (method === 'DELETE') {
			const workspaceId = query.get('workspace') ?? (await deps.defaultWorkspaceId());
			const removed = await taskboard.remove(workspaceId, cardId);
			if (!removed.ok) return sendFailure(res, removed);
			sendOk(res, { card: removed.card });
			return;
		}
		return sendMethodNotAllowed(res, 'GET, PATCH, DELETE');
	}

	/* ── POST /api/cards/:id/action ── */
	const actionMatch = /^\/cards\/([^/]+)\/action$/.exec(tail);
	if (actionMatch !== null) {
		if (method !== 'POST') return sendMethodNotAllowed(res, 'POST');
		const cardId = decodeURIComponent(actionMatch[1] ?? '');
		const body = await readJson(req);
		const workspaceId = str(body, 'workspaceId') ?? (await deps.defaultWorkspaceId());
		const to = str(body, 'to') ?? '';

		if (!isTaskState(to)) {
			sendFailure(res, failure(ErrorCode.TRANSITION_REJECTED, `「${to}」不是已知状态。`), 400);
			return;
		}

		const found = taskboard.get(workspaceId, cardId);
		if (!found.ok) return sendFailure(res, found, 404);
		const card = found.card;

		/* 判定：人点按钮 ⇒ `trigger: 'button'`。规则全在 protocol 的判定表里。 */
		const verdict = judgeTransition({
			kind: card.template.kind,
			from: card.status,
			to,
			trigger: 'button',
		});
		if (!verdict.ok) {
			sendFailure(
				res,
				failure(ErrorCode.TRANSITION_REJECTED, `不能从「${card.status}」转到「${to}」：${verdict.reason}`, {
					detail: { reason: verdict.reason },
				}),
				409,
			);
			return;
		}

		if (deps.applyTransition === undefined) {
			sendFailure(
				res,
				failure(ErrorCode.PORT_UNAVAILABLE, '状态转移的写入口尚未装配：核心目前缺 transition()。'),
				501,
			);
			return;
		}

		const applied = await deps.applyTransition(workspaceId, cardId, to);
		if (!applied.ok) return sendFailure(res, applied);
		sendOk(res, { card: applied.card });
		return;
	}

	sendFailure(res, failure(ErrorCode.INTERNAL_ERROR, `未知路径：${path}`), 404);
}

/** 把路由挂到宿主；返回 disposer。 */
export function mountRoutes(webServer: WebServerLike, deps: RouteDeps): () => void {
	return webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: createHandler(deps) });
}
