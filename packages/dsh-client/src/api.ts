/**
 * HTTP 客户端 —— **纯逻辑与网络分离**。
 *
 * ## 为什么路径是相对的（不带前导 `/`）
 *
 * DSH 的页面可能挂在子路径下（不保证在站点根）。绝对路径 `/taskboard3/api/...`
 * 会跳出挂载点，请求打到别处。
 *
 * ⇒ 常量 `API_BASE = 'taskboard3/api'`（**无前导斜杠**），
 *   浏览器相对当前文档 URL 解析 ⇒ 挂在哪都对。
 *
 * 依据：`docs/通道方案.md` 的 Q2（照抄 `dsh-host-open-in-app/src/shared.ts:10-26`
 * 的 PATH / ROUTE 成对写法）。
 *
 * ## 为什么把 pure 部分单独导出
 *
 * Node 里跑不了 `fetch` 到真实服务，但**路径拼接与信封解包**是纯函数，
 * 必须能被单测覆盖 —— 这两块出错的表现是「静默空白」，最难查。
 */

import type {
	ActionRequest,
	ActionResult,
	Card,
	Envelope,
	FailEnvelope,
	OkEnvelope,
	StateData,
	Workspace,
} from './types.ts';

/**
 * API 根路径。**没有前导斜杠** —— 相对文档 URL 解析。
 *
 * ⚠ 不要改成 `/taskboard3/api`。改了在子路径挂载时就坏。
 */
export const API_BASE = 'taskboard3/api';

/** 带业务错误码的异常。 */
export interface ApiError extends Error {
	/** 后端错误码（与 `@taskboard/protocol` 的 `ErrorCode` 同值域）。 */
	readonly code: string;
	/** 字段级问题（建卡校验失败时有）。 */
	readonly issues?: readonly { readonly path: string; readonly message: string }[];
}

/**
 * 拼一个 API 路径（纯函数）。
 *
 * @param path 相对片段，可带也可不带前导 `/`
 * @param query 查询参数；`undefined` / 空串的值会被跳过
 * @returns `taskboard3/api/<path>?a=1&b=2`，或 `taskboard3/api/<path>`
 *
 * ## 行为约定（由测试钉住）
 *
 * · 前导 `/` 会被**吃掉**（不会有 `//`）
 * · 空 query 不产生 `?`
 * · 值会被 `encodeURIComponent`
 * · 数组用重复参数（`status=a&status=b`）—— 服务端按 `getAll` 读
 */
export function buildPath(
	path: string,
	query?: Readonly<Record<string, string | readonly string[] | undefined>>,
): string {
	const trimmed = path.replace(/^\/+/, '');
	const base = trimmed === '' ? API_BASE : `${API_BASE}/${trimmed}`;
	if (query === undefined) return base;

	const parts: string[] = [];
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined) continue;
		for (const one of typeof value === 'string' ? [value] : value) {
			if (one === '') continue;
			parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(one)}`);
		}
	}
	return parts.length === 0 ? base : `${base}?${parts.join('&')}`;
}

/** 是否是失败信封。 */
export function isFail<T>(envelope: Envelope<T>): envelope is FailEnvelope {
	return envelope.ok === false;
}

/** 是否是成功信封。 */
export function isOk<T>(envelope: Envelope<T>): envelope is OkEnvelope<T> {
	return envelope.ok === true;
}

/**
 * 解包信封（纯函数）。
 *
 * @returns 成功时的 `data`
 * @throws {ApiError} 失败信封；`code` / `message` / `issues` 原样带出
 */
export function unwrap<T>(envelope: Envelope<T>): T {
	if (envelope.ok) return envelope.data;
	const error = new Error(envelope.message) as ApiError & { code: string };
	(error as { code: string }).code = envelope.code;
	if (envelope.issues !== undefined) {
		(error as { issues: readonly { path: string; message: string }[] }).issues = envelope.issues;
	}
	throw error;
}

/** 造一个 `ApiError`（网络层异常也用这个形状，调用方只需处理一种错误）。 */
export function apiError(code: string, message: string): ApiError {
	const error = new Error(message) as ApiError & { code: string };
	(error as { code: string }).code = code;
	return error;
}

/**
 * 一次 HTTP 往返的最小抽象。
 *
 * 默认实现用全局 `fetch`；测试可以注入一个假的。
 */
export type FetchLike = (
	url: string,
	init?: { readonly method?: string; readonly body?: string; readonly headers?: Record<string, string> },
) => Promise<{ readonly ok: boolean; readonly status: number; readonly text: () => Promise<string> }>;

/**
 * 模板的**展开视图**（`GET /api/templates?ref=<ref>`）。
 *
 * ⚠ 和 `TemplateSummary` 的区别：摘要只有 `ref/displayName/kind/domain`，
 *   **没有章节清单**。建卡必须知道「这个模板有哪些章节、每章用哪个 action」，
 *   所以要多一次请求。
 *
 * 形状照抄 `core/src/template/types.ts` 的 `TemplateMeta`（字段名逐个对齐）。
 */
export interface TemplateDetail {
	readonly ref: string;
	readonly displayName: string;
	readonly kind: string;
	readonly domain: string;
	readonly usage: string;
	readonly description: string;
	readonly sections: readonly {
		readonly id: string;
		readonly label: string;
		readonly hint: string;
		readonly action: string;
	}[];
}

/** 一个任务板 API 客户端。 */
export interface TaskboardApi {
	getState(workspaceId?: string): Promise<StateData>;
	listWorkspaces(): Promise<readonly Workspace[]>;
	createWorkspace(name: string): Promise<Workspace>;
	/**
	 * 取一个模板的展开视图（章节清单）。
	 *
	 * @param ref 模板 ref
	 * @throws {ApiError} `TEMPLATE_NOT_FOUND`
	 */
	getTemplate(ref: string): Promise<TemplateDetail>;
	createCard(input: {
		readonly workspaceId: string;
		readonly templateRef: string;
		readonly title: string;
		readonly content?: Readonly<Record<string, unknown>>;
		/** 关系。`parent` 是派生父卡；`links` 是五种边。省略 = 没有关系。 */
		readonly relations?: {
			readonly parent?: string | null;
			readonly links?: readonly { readonly label: string; readonly to: string }[];
		};
		/** 备注。省略 = 空。 */
		readonly note?: string;
		/** 空模板必须补的分类 / 领域（模板已声明时省略）。 */
		readonly kind?: string;
		readonly domain?: string;
	}): Promise<Card>;
	patchCard(input: {
		readonly workspaceId: string;
		readonly cardId: string;
		readonly patch: Readonly<Record<string, unknown>>;
	}): Promise<Card>;
	act(input: {
		readonly workspaceId: string;
		readonly request: ActionRequest;
	}): Promise<ActionResult>;
	/**
	 * ① 接通时的渲染器检查 —— 把「UI 能画哪些 `$type`」报给 Host，
	 * Host 比对模板需求后返回缺的。
	 *
	 * ⚠ **不阻塞、不白屏**：调用方用 `void … .then(…).catch(…)`，失败只记日志。
	 *
	 * @param registered 已注册的 `$type` 清单（来自 `registeredTypes()`）
	 */
	renderCheck(registered: readonly string[]): Promise<RenderCheckResult>;
}

/** `POST /render-check` 的响应。 */
export interface RenderCheckResult {
	/** 模板实际用到的 `$type`（去重、字母序）。 */
	readonly required: readonly string[];
	/** 需要但 UI 没注册的 `$type`（去重、字母序）。空数组 = 全都有。 */
	readonly missing: readonly string[];
}

/**
 * 造一个 API 客户端。
 *
 * @param fetchImpl 可选注入（测试用）；省略则用全局 `fetch`
 */
export function createApi(fetchImpl?: FetchLike): TaskboardApi {
	const doFetch: FetchLike =
		fetchImpl ??
		((url, init) =>
			globalThis.fetch(url, {
				method: init?.method ?? 'GET',
				...(init?.body === undefined ? {} : { body: init.body }),
				...(init?.headers === undefined ? {} : { headers: init.headers }),
			}).then(async (response) => ({
				ok: response.ok,
				status: response.status,
				text: () => response.text(),
			})));

	/**
	 * 一次请求：拼路径 → fetch → 解析 JSON → 解包。
	 *
	 * ⚠ 三层失败都要转成 `ApiError`：网络错、非 JSON、后端 `{ ok:false }`。
	 *   调用方只处理一种异常形状。
	 */
	async function request<T>(
		path: string,
		options?: {
			readonly method?: string;
			readonly body?: unknown;
			readonly query?: Readonly<Record<string, string | readonly string[] | undefined>>;
		},
	): Promise<T> {
		const url = buildPath(path, options?.query);
		const hasBody = options?.body !== undefined;
		let response: Awaited<ReturnType<FetchLike>>;
		try {
			response = await doFetch(url, {
				method: options?.method ?? 'GET',
				...(hasBody ? { body: JSON.stringify(options.body) } : {}),
				...(hasBody ? { headers: { 'content-type': 'application/json' } } : {}),
			});
		} catch (cause) {
			throw apiError('NETWORK', `无法连接任务板服务：${cause instanceof Error ? cause.message : String(cause)}`);
		}

		const text = await response.text();
		let envelope: Envelope<T>;
		try {
			envelope = JSON.parse(text) as Envelope<T>;
		} catch {
			throw apiError('BAD_RESPONSE', `任务板服务返回了非 JSON 内容（HTTP ${response.status}）。`);
		}
		return unwrap(envelope);
	}

	return {
		async getState(workspaceId) {
			return request<StateData>('state', workspaceId === undefined ? undefined : { query: { workspaceId } });
		},
		async listWorkspaces() {
			return request<readonly Workspace[]>('workspaces');
		},
		async createWorkspace(name) {
			return request<Workspace>('workspaces', { method: 'POST', body: { name } });
		},
		async createCard(input) {
			return request<Card>('cards', { method: 'POST', body: input });
		},
		async getTemplate(ref) {
			const data = await request<{ template: TemplateDetail }>('templates', {
				query: { ref },
			});
			return data.template;
		},
		async patchCard(input) {
			return request<Card>(`cards/${encodeURIComponent(input.cardId)}`, {
				method: 'PATCH',
				body: { workspaceId: input.workspaceId, patch: input.patch },
			});
		},
		async act(input) {
			return request<ActionResult>(`cards/${encodeURIComponent(input.request.cardId)}/action`, {
				method: 'POST',
				body: { workspaceId: input.workspaceId, action: input.request.action },
			});
		},
		async renderCheck(registered) {
			return request<RenderCheckResult>('render-check', {
				method: 'POST',
				body: { registered: [...registered] },
			});
		},
	};
}
