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

import type { CardActionLevel, SearchCondition, Taskboard, ToolGuardLevel } from '@taskboard/core';
import { CARD_ACTION_OPTIONS, TOOL_GUARD_OPTIONS, isAdoptTransition, missingRenderers } from '@taskboard/core';
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
		/*
		 * 完结态不可改内容 = 「请求与资源当前状态冲突」，不是「参数写错了」。
		 * 409 让客户端能区分「改请求」（400）和「换一张卡 / 先转移状态」（409）。
		 */
		case ErrorCode.CARD_ENDED_IMMUTABLE:
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
function rawField(body: unknown, key: string): unknown {
	if (typeof body !== 'object' || body === null) return undefined;
	return (body as Record<string, unknown>)[key];
}

/* ────────────────────────── 两条正交轴的档位 ────────────────────────── */

/**
 * `GET /api/permission` 的 `data` 形状（也是 POST 成功后的回声）。
 *
 * ⚠ **选项表来自 core**（`CARD_ACTION_OPTIONS` / `TOOL_GUARD_OPTIONS`），
 * 本文件不硬编码第二份 —— 第二份清单一旦漂移就是「UI 显示一个存不进去的档」，
 * 而且不报错。core 的选项表本身有 `satisfies` + 「每档恰好出现一次」的
 * 编译期断言（AGENTS 3.7）。
 */
interface PermissionState {
	readonly cardActionLevel: CardActionLevel;
	readonly toolGuardLevel: ToolGuardLevel;
	readonly cardActionOptions: typeof CARD_ACTION_OPTIONS;
	readonly toolGuardOptions: typeof TOOL_GUARD_OPTIONS;
	/**
	 * 总闸：角色为 `ai` 的改卡状态操作允不允许。
	 *
	 * 用户 `2026-11-23`：「core提供的后端里面有一个开关设置和权限。
	 * 用指令和UI可以改这个开关。然后会限制改卡状态的角色为ai的部分的操作。」
	 *
	 * ⚠ **它不是第三条轴**（用户已明确「两条正交轴」）—— 它管的是**角色**：
	 *   关掉之后 `user` 点按钮、`system` 自动重算都不受影响。
	 */
	readonly aiStateChangeAllowed: boolean;
}

/** 读两条轴的当前档位 + 总闸 + 选项表。 */
function permissionStateOf(taskboard: Taskboard): PermissionState {
	return {
		cardActionLevel: taskboard.getCardActionLevel(),
		toolGuardLevel: taskboard.getToolGuardLevel(),
		cardActionOptions: CARD_ACTION_OPTIONS,
		toolGuardOptions: TOOL_GUARD_OPTIONS,
		aiStateChangeAllowed: taskboard.getAiStateChangeAllowed(),
	};
}

/**
 * 把 body 里的原始值解析成 UI 轴档位。
 *
 * @returns `undefined` = 不是合法档位（判据是 core 的选项表本身）
 */
function asCardActionLevel(value: unknown): CardActionLevel | undefined {
	return CARD_ACTION_OPTIONS.find((one) => one.value === value)?.value;
}

/**
 * 把 body 里的原始值解析成宿主轴档位。
 *
 * @returns `undefined` = 不是合法档位（判据是 core 的选项表本身）
 */
function asToolGuardLevel(value: unknown): ToolGuardLevel | undefined {
	return TOOL_GUARD_OPTIONS.find((one) => one.value === value)?.value;
}

/**
 * 把 body 里的原始值解析成布尔。
 *
 * 只认**真布尔**，不认 `'true'` / `1` —— 这个开关是安全边界，
 * 宽松解析会让「前端传错类型」变成「静默关掉/打开」。
 */
function asBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
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

	/* ── POST /api/workspaces/:id/archive | /unarchive ──
	 *
	 * ## 为什么用路径参数，不用 body 传 id
	 *
	 * 本文件对「某个资源的子动作」已经有一个**既定形态**：
	 *
	 * ```
	 * POST /cards/:id/action      → /^\/cards\/([^/]+)\/action$/
	 * ```
	 *
	 * 归档是同一类东西（对已有资源的动作），照抄这个形态比另发明一套
	 * 「body 里放 id」更好 —— 后者会让本文件出现两种 id 传法，
	 * 读的人得先判断「这次是哪种」。
	 *
	 * ⚠ 归档是**幂等**的：对一个已经归档的空间再归档，
	 *   `core.archiveWorkspace()` 返回 `{ ok: true, changed: false }`，
	 *   **不是错误**。HTTP 也回 200，把 `changed` 透给客户端 ——
	 *   客户端据此决定要不要重拉列表（没变就不用拉）。
	 */
	const archiveMatch = /^\/workspaces\/([^/]+)\/(archive|unarchive)$/.exec(tail);
	if (archiveMatch !== null) {
		if (method !== 'POST') return sendMethodNotAllowed(res, 'POST');
		const workspaceId = decodeURIComponent(archiveMatch[1] ?? '');
		const action = archiveMatch[2];

		const result =
			action === 'archive'
				? await taskboard.archiveWorkspace(workspaceId)
				: await taskboard.unarchiveWorkspace(workspaceId);
		if (!result.ok) return sendFailure(res, result);

		/*
		 * 回整张空间（不是只回 changed）——
		 * 客户端归档后常常要立刻用新的 `archived` 标记重画 chip，
		 * 只给 `changed: true` 它还得再拉一次才算得出新状态。
		 */
		const workspace = taskboard.getWorkspace(workspaceId);
		sendOk(res, { changed: result.changed, workspace });
		return;
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

	/* ── GET / POST /api/permission —— 读写两条正交轴的档位 ──
	 *
	 * | 轴 | 取值 | 谁定 |
	 * |---|---|---|
	 * | `cardActionLevel` | no-claim / claim / adopt | 用户（任务板 UI） |
	 * | `toolGuardLevel` | off / manage / manage-edit | 宿主（DSH） |
	 *
	 * ⚠ 与旧的 `GET /api/policy-edit` **不是一件事**：那是「能不能改四档策略」的
	 *   内存开关，已被用户否掉。这里读写的只是**两个档位**，策略本身仍走
	 *   `/api/...` 之外的 AI 工具（`taskboard_tool_policy_*`）。
	 *
	 * ⚠ 选项表从 core 来（见 `permissionStateOf`），不在本文件硬编码。
	 */
	if (tail === '/permission') {
		if (method === 'GET') {
			sendOk(res, permissionStateOf(taskboard));
			return;
		}
		if (method === 'POST') {
			const body = await readJson(req);
			const cardRaw = rawField(body, 'cardActionLevel');
			const guardRaw = rawField(body, 'toolGuardLevel');
			const switchRaw = rawField(body, 'aiStateChangeAllowed');
			/*
			 * 先解析成类型化变量，**只判一次** —— 后面的写直接用解析结果。
			 *
			 * ⚠ 不要写成「校验时判一次、写之前再判一次」：第二次判定是兜底，
			 *   第一次校验哪天被改掉，第二次会静默跳过 —— 返回 200 但什么都没写。
			 */
			const cardLevel = cardRaw === undefined ? undefined : asCardActionLevel(cardRaw);
			const guardLevel = guardRaw === undefined ? undefined : asToolGuardLevel(guardRaw);
			const switchValue = switchRaw === undefined ? undefined : asBoolean(switchRaw);

			if (cardRaw === undefined && guardRaw === undefined && switchRaw === undefined) {
				sendFailure(
					res,
					failure(
						ErrorCode.FIELD_REQUIRED,
						'至少要给 cardActionLevel / toolGuardLevel / aiStateChangeAllowed 之一。',
						{ issues: [{ path: '', message: 'body 里没有任何档位或开关字段' }] },
					),
					400,
				);
				return;
			}

			if (cardRaw !== undefined && cardLevel === undefined) {
				sendFailure(
					res,
					failure(
						ErrorCode.FIELD_REQUIRED,
						`cardActionLevel 非法：${String(cardRaw)}。可用：${CARD_ACTION_OPTIONS.map((one) => one.value).join(' / ')}。`,
						{ issues: [{ path: '/cardActionLevel', message: '不是合法档位' }] },
					),
					400,
				);
				return;
			}

			if (guardRaw !== undefined && guardLevel === undefined) {
				sendFailure(
					res,
					failure(
						ErrorCode.FIELD_REQUIRED,
						`toolGuardLevel 非法：${String(guardRaw)}。可用：${TOOL_GUARD_OPTIONS.map((one) => one.value).join(' / ')}。`,
						{ issues: [{ path: '/toolGuardLevel', message: '不是合法档位' }] },
					),
					400,
				);
				return;
			}

			if (switchRaw !== undefined && switchValue === undefined) {
				sendFailure(
					res,
					failure(
						ErrorCode.FIELD_REQUIRED,
						`aiStateChangeAllowed 非法：${String(switchRaw)}。必须是布尔 true / false。`,
						{ issues: [{ path: '/aiStateChangeAllowed', message: '不是布尔' }] },
					),
					400,
				);
				return;
			}

			/*
			 * 两个写各自落 kv（core 负责持久化 + 更新缓存）。
			 * 只改传了的那个；没传的保持原值 —— 这是 PATCH 语义，
			 * 但 HTTP 方法用 POST（与其它写端点一致，且 body 是完整声明）。
			 */
			if (cardLevel !== undefined) await taskboard.setCardActionLevel(cardLevel);
			if (guardLevel !== undefined) await taskboard.setToolGuardLevel(guardLevel);
			if (switchValue !== undefined) await taskboard.setAiStateChangeAllowed(switchValue);

			sendOk(res, permissionStateOf(taskboard));
			return;
		}
		return sendMethodNotAllowed(res, 'GET, POST');
	}

	/* ── POST /api/render-check —— UI 报告它能渲染什么，Host 比对模板需求 ── */
	if (tail === '/render-check') {
		if (method !== 'POST') return sendMethodNotAllowed(res, 'POST');

		const body = await readJson(req);
		/*
		 * 请求体 `{ registered: string[] }`。
		 *
		 * ⚠ 不信 UI 传的任何东西的语义 —— 它只提供「我能画哪些 type」这一个事实，
		 *   判定（缺了什么）在 Host 侧算。反过来让 UI 自己算就等于让它自证清白。
		 *
		 * ⚠ 非字符串项**静默滤掉**而不是报错：UI 版本不一致时多传一个怪值，
		 *   不该让整个检查失败（那会让 ① 完全失效）。
		 */
		const raw = rawField(body, 'registered');
		const registered = Array.isArray(raw)
			? raw.filter((one): one is string => typeof one === 'string')
			: [];

		const required = taskboard.requiredActions();
		const missing = missingRenderers(required, registered);

		/*
		 * ① 的警告 —— **Host 侧一份**。
		 *
		 * 为什么不在这里抛：这是**预防性检查**，不阻塞任何东西。
		 * 面板照常能用，只是那几个 action 的章节会走 ③（红块 + JSON 兜底）。
		 */
		if (missing.length > 0) {
			console.warn(
				`[taskboard3] 有 ${String(missing.length)} 个 action 没有注册渲染器，` +
					`相关章节会降级成 JSON：${missing.join('、')}`,
			);
		}

		sendOk(res, { required, missing });
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

	/* ── 旧「权限编辑开关」端点已删除 ──
	 *
	 * 用户 `2026-11-14`：
	 *
	 * > 能不能只留三个权限。开发者权限由dsh自己的完全权限去操作？
	 * > 没有必要为此就让我们再开一个新的权限。
	 *
	 * ⇒ 没有一个「改权限」的内存开关。现在的形态是两条正交轴（`2026-11-19`）：
	 *   · **档位**读写 → `GET/POST /api/permission`（本文件上面那一段）；
	 *   · **四档策略** → AI 工具 `taskboard_tool_policy_*`，只由宿主轴
	 *     `manage-edit` 放行。
	 *
	 * 所以原来的 `GET /api/policy-edit` 与 `POST /api/policy-edit/toggle`
	 * 两个端点连同 core 的内存开关一起删掉了。不要往回加。
	 */

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
		 * AI 的已读由 AI 工具 `taskboard_mark_seen` 自己做（那边有真实 agent 身份）。
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
		/*
		 * 返回标记之后的**未读状态**（`{ ai, user }` 两个 bool）。
		 *
		 * ⚠ 曾经这里返回 `{ at }`（读游标时间）。那个机制已被用户裁定推翻 ——
		 *   未读现在是卡自己的字段（`Card.unread`），不是卡外的 kv 游标。
		 *   见 `core/src/card.ts` 的 `CardUnread` 注释。
		 */
		sendOk(res, { unread: result.unread });
		return;
	}

	/* ── POST /api/cards ── */
	if (tail === '/cards') {
		if (method !== 'POST') return sendMethodNotAllowed(res, 'POST');
		const body = await readJson(req);
		const workspaceId = str(body, 'workspaceId') ?? (await deps.defaultWorkspaceId());
		const content = rawField(body, 'content');
		const relations = rawField(body, 'relations');
		const note = str(body, 'note');
		const kind = str(body, 'kind');
		const domain = str(body, 'domain');
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
			/* 面板建的卡 ⇒ origin 固定 `'panel'`（派生/导入是别的入口）。 */
			origin: 'panel',
			...(content === undefined ? {} : { content }),
			/*
			 * 关系和备注**必须透传**：不过去的话，用户在建卡页填的关系和备注
			 * 会被静默丢掉（界面上填了、卡上没有）。`taskboard.create()` 内部的
			 * `checkRelations` 会校验关系目标存在性。
			 */
			...(relations === undefined ? {} : { relations }),
			...(note === undefined ? {} : { note }),
			/*
			 * `kind` / `domain` 只对**空模板**有意义（模板没声明分类/领域时
			 * 必须由入参补，否则发号拿不到字母）。模板已声明时传了会被 core 拒绝
			 * （不一致 = 调用方选错模板），所以这里原样透传、由 core 裁决。
			 */
			...(kind === undefined ? {} : { kind }),
			...(domain === undefined ? {} : { domain }),
		} as Parameters<typeof taskboard.create>[0]);
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
			const title = rawField(body, 'title');
			const note = rawField(body, 'note');
			const content = rawField(body, 'content');
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
		 * ── 采纳走 `adopt()`，不走 `transition()` ──
		 *
		 * 用户点的「采纳」按钮在表里的 `method` 是 `'adopt'`。它和普通转移的
		 * 区别是**要同时写 `adoptedAt`**（`core/src/transition.ts:138`：
		 * 时间必须与 history 里那条 `action:'adopt'` 用同一个 `at`）。
		 *
		 * ⚠ 如果这里走 `transition()`，状态会变但 `adoptedAt` 仍是 `null` ——
		 *   而 `search` 的排序键是 `adoptedAt ?? createdAt` ⇒ **排序错乱**，
		 *   且不报错。这是静默错误，所以必须分开走。
		 *
		 * ⚠ 人点按钮 ⇒ `actor: 'user'`，**不传 `allowAiAdopt`**：
		 *   那个开关只对 AI 有意义（用户本来就有这个按钮）。
		 */
		const adopt = isAdoptTransition(card.template.kind, card.status, to);
		if (adopt) {
			const adopted = await taskboard.adopt(workspaceId, cardId, 'user');
			if (!adopted.ok) return sendFailure(res, adopted);
			sendOk(res, { card: adopted.card });
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
