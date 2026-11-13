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
import type { Failure } from '@taskboard/protocol';
import { ErrorCode, TaskState, failure, isTaskState, judgeTransition } from '@taskboard/protocol';

import type { SseHub, SseResponseLike } from './sse.ts';
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
	 * SSE 连接管理器 —— **原型期脚手架**。
	 *
	 * ⚠ 与 `core/src/bus.ts` 同生共死。拆 `bus.ts` 时删掉本字段与
	 *   `GET /api/events` 那一段。见 `src/sse.ts` 文件头。
	 */
	readonly events?: SseHub;
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

	/* ── GET /api/events ──
	 *
	 * ⚠ **原型期脚手架**，与 `core/src/bus.ts` 同生共死。
	 *   拆 `bus.ts` 时删掉本段 + `RouteDeps.events` + `src/sse.ts`。
	 *   见 `src/sse.ts` 文件头与 `core/src/bus.ts` 的拆解步骤第 4 条。
	 */
	if (tail === '/events') {
		if (method !== 'GET') return sendMethodNotAllowed(res, 'GET');
		const hub = deps.events;
		if (hub === undefined) {
			/*
			 * 没装 bus ⇒ 这个端点不存在。
			 * 答 404 而不是 501：对客户端来说它就是「没有这个资源」。
			 */
			sendFailure(res, failure(ErrorCode.INTERNAL_ERROR, 'SSE 端点未装配（bus 未启用）。'), 404);
			return;
		}
		if (hub.isClosed()) {
			sendFailure(res, failure(ErrorCode.INTERNAL_ERROR, 'SSE 端点已关闭（插件正在卸载）。'), 503);
			return;
		}
		/*
		 * ⚠ **这里不 `end()`** —— `open()` 会长期持有 response，
		 *   直到客户端断开（`close` 事件）或 provider 卸载（`closeAll()`）。
		 *
		 *   `host-webserver` 的 `WebRoute.handler` 允许这样做
		 *   （它的注释写了 `may hold the response open, e.g. SSE`），
		 *   但 **disposer 不会主动断开已建立的连接** ⇒ `SseHub` 自己管集合。
		 */
		hub.open(req, res as SseResponseLike);
		return;
	}

	/* ── GET /api/updates ── */
	if (tail === '/updates') {
		if (method !== 'GET') return sendMethodNotAllowed(res, 'GET');
		const workspaceId = query.get('workspace') ?? (await deps.defaultWorkspaceId());
		const updates = await taskboard.updates(workspaceId);
		/*
		 * ⚠ 字段名按「**谁改的**」命名（core 的口径，别搞反）：
		 *   `ai`   —— AI 改过，**用户**还没看过
		 *   `user` —— 用户改过，**AI** 还没看过
		 */
		sendOk(res, { ai: updates.ai, user: updates.user });
		return;
	}

	/* ── POST /api/cards/:id/seen ── */
	const seenMatch = /^\/cards\/([^/]+)\/seen$/.exec(tail);
	if (seenMatch !== null) {
		if (method !== 'POST') return sendMethodNotAllowed(res, 'POST');
		const cardId = decodeURIComponent(seenMatch[1] ?? '');
		const body = await readJson(req);
		const workspaceId = str(body, 'workspaceId') ?? (await deps.defaultWorkspaceId());
		/*
		 * ⚠ **`reader` 固定 `'user'`，不从 body 取。**
		 *
		 * 浏览器里操作的人是用户 —— 这条通道不可信到能自称「我是 AI」。
		 * AI 的已读游标由 AI 工具 `taskboard_mark_seen` 自己写（那边有真实 agent 身份）。
		 *
		 * ⚠ 若前端传了 `reader: 'ai'`，忽略并继续 —— 不报错（避免前端猜错时整个打开卡流程坏掉），
		 *   但日志里留一条，便于发现「前端以为自己是 AI」这种误解。
		 */
		const claimed = str(body, 'reader');
		if (claimed !== undefined && claimed !== 'user') {
			console.warn(`[taskboard3] /seen 收到 reader=${claimed}，忽略（HTTP 通道固定 user）。`);
		}
		const result = await taskboard.markSeen(workspaceId, cardId, 'user');
		if (!result.ok) return sendFailure(res, result);
		sendOk(res, { at: result.at });
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
			/*
			 * ⚠ **显式**标 `'user'`，不靠默认值。
			 *
			 * 默认值让「忘了传」和「故意传 user」变成同一件事 —— 两者都编译通过、
			 * 都不报错。显式传之后 `grep "actor"` 就能确认每个入口都表了态。
			 */
			actor: 'user',
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
			/* 显式 `'user'`：浏览器里操作的人是用户。 */
			const updated = await taskboard.update(
				workspaceId,
				cardId,
				{
					...(title === undefined ? {} : { title: str(body, 'title') ?? '' }),
					...(note === undefined ? {} : { note: str(body, 'note') ?? '' }),
					...(content === undefined ? {} : { content }),
				},
				'user',
			);
			if (!updated.ok) return sendFailure(res, updated);
			sendOk(res, { card: updated.card });
			return;
		}
		if (method === 'DELETE') {
			const workspaceId = query.get('workspace') ?? (await deps.defaultWorkspaceId());
			/* 显式 `'user'`：同上。 */
			const removed = await taskboard.remove(workspaceId, cardId, 'user');
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

		/*
		 * ── 领取 / 释放只能由 AI 工具发起 ──
		 *
		 * HTTP 请求**没有 `exec.agent`** —— 浏览器不知道「是哪个 agent 在领」。
		 * 而 claim 的语义是「指派某个 agent 去做」，持有者必须是**可信的** agent 身份。
		 *
		 * ⚠ 让前端传 `?holder=` 是不可行的：那是**自报**，任何页面脚本都能声称自己是
		 *   任意 agent，于是「一次一张」这条约束形同虚设。
		 *
		 * ⇒ 界面点「领取」时，正确做法是让 AI 调 `taskboard_claim` 工具 ——
		 *   工具那边从 `exec.agent` 取**真实**身份（见 `src/holder.ts`）。
		 *
		 * 释放同理：释放的对象是「自己这个持有者」，而 HTTP 说不清「自己」是谁。
		 */
		if (to === TaskState.WORKING) {
			sendFailure(
				res,
				failure(
					ErrorCode.CLAIM_REJECTED,
					'「领取」只能由 AI 工具发起（taskboard_claim），不能从界面直接领 —— 界面无法证明是哪个 agent 在领。',
					{ detail: { reason: 'CLAIM_REQUIRES_AGENT' } },
				),
				409,
			);
			return;
		}
		if (card.status === TaskState.WORKING && to === TaskState.SUBMITTED) {
			sendFailure(
				res,
				failure(
					ErrorCode.CLAIM_REJECTED,
					'「释放」只能由 AI 工具发起（taskboard_release）—— 界面无法证明「自己」是哪个持有者。',
					{ detail: { reason: 'RELEASE_REQUIRES_AGENT' } },
				),
				409,
			);
			return;
		}

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

		/*
		 * 状态转移。
		 *
		 * ⚠ **直接调 `taskboard.transition`，不做可用性探查。**
		 *   core 是我们自己的包，方法必须在编译期确定 ——
		 *   方法名写错应该是**编译错误**，不是运行时静默答 501。
		 *
		 * ⚠ `trigger` 写死 `'button'`（人点界面）。前端不能传这个参数，
		 *   否则能自称是 `ai` 绕过「AI 不能进终结态」的规则。
		 */
		const applied = await taskboard.transition(workspaceId, cardId, to, 'button');
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
