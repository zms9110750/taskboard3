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
	ActionResult,
	Card,
	Envelope,
	FailEnvelope,
	OkEnvelope,
	StateData,
	Workspace,
} from './types.ts';

// TODO(审查): 无前导斜杠依赖「文档 URL 在站点根」；lead 已确认当前 GUI 在 `/` 可用，但一旦 DSH 上深路径/子路径，会解析到 `/chat/taskboard3/api/...`。可直接改成可注入 base（或从宿主拿 mount base），是否现在做需用户决定。
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

// TODO(审查): isOk/isFail 在 src 内零调用，只有 test/api.test.ts:25-26,119-123 用；是测试专用导出。可内联到测试或标 @internal（同 pure.ts 的 activeWorkspaces 等三个 helper）。
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
// TODO(审查): 手写 Error 再强转挂 code/issues（apiError 同款）可换成 `class ApiError extends Error`，无需外部库；可直接改，属低风险整理。
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
	/**
	 * 派生声明（**顺序 = 菜单顺序**）。
	 *
	 * ⚠ **只有展开视图有它**（`TemplateSummary` 没有）—— 摘要不带章节也不带派生。
	 *   所以「+ 派生子任务」必须先 `getTemplate(卡片模板的 ref)` 才能拿到菜单项。
	 *
	 * ⚠ **可以为空**：模板没写 `derive` 时是 `[]`（core 的 `parseDerives` 兜底）。
	 *   UI 要为这个情况留一个「派生空模板」的保留项 —— 见 `DeriveMenu.tsx`。
	 */
	readonly derives: readonly TemplateDerive[];
}

/** 一条派生声明（`TemplateDetail.derives` 的元素）。 */
export interface TemplateDerive {
	/** 按钮文字。 */
	readonly label: string;
	/** 悬浮说明。 */
	readonly description?: string;
	/** 目标模板 ref。 */
	readonly template: string;
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
	/**
	 * 改一张卡的**标题 / 备注 / 章节**。
	 *
	 * ## ⚠ 字段是**扁平**的，不要再包一层 `patch`
	 *
	 * 服务端 `PATCH /cards/:id`（`packages/dsh/src/http.ts:600`）直接在**顶层**读
	 * `title` / `note` / `content`，和 `POST /cards` 的格式一致。
	 *
	 * 曾经这里发的是 `{ workspaceId, patch: { … } }` —— 多包了一层。服务端读不到
	 * 那三个字段 ⇒ 传给 `taskboard.update()` 的是空对象 ⇒ **什么都不改但返回成功**。
	 * 用户以为改成功了，刷新才发现没改。**静默无效比报错更坏。**
	 *
	 * 用户 `2026-11-22`：「用服务端的扁平的」。
	 *
	 * @param input 空间 id + 卡编号 + 要改的字段（至少一个）
	 */
	patchCard(input: {
		readonly workspaceId: string;
		readonly cardId: string;
		/** 新标题（trim 后不能为空）。省略 = 不改。 */
		readonly title?: string;
		/** 新备注。省略 = 不改（空串是合法值 —— 那是「清空备注」）。 */
		readonly note?: string;
		/** 新章节内容（整体替换，服务端要过 `schemas.validate`）。省略 = 不改。 */
		readonly content?: Readonly<Record<string, unknown>>;
	}): Promise<Card>;
	/**
	 * 归档一个空间。
	 *
	 * ⚠ **幂等**：已经归档的再归档不算错误，回 `changed: false`。
	 *   调用方据此决定要不要重拉列表。
	 *
	 * @param id 空间 id
	 */
	archiveWorkspace(id: string): Promise<ArchiveResult>;
	/** 取消归档（同样幂等）。 */
	unarchiveWorkspace(id: string): Promise<ArchiveResult>;
	/**
	 * 点一个状态按钮。
	 *
	 * ## ⚠ 发的是**顶层 `to`**，不是 `action` 对象
	 *
	 * 服务端（`packages/dsh/src/http.ts` 的 `POST /cards/:id/action`）在顶层读：
	 *
	 * ```ts
	 * const to = str(body, 'to') ?? '';
	 * if (!isTaskState(to)) → 400「不是已知状态」
	 * ```
	 *
	 * 它**不读 `kind`** —— 靠 `isAdoptTransition(kind, from, to)` 反推这次是不是采纳。
	 *
	 * ⇒ 曾经这里发 `{ workspaceId, action: { kind, to } }`，服务端读不到 `to`
	 *   ⇒ `to` 空串 ⇒ **点任何状态按钮都 400**。和 `patchCard` 那个 bug 同一类。
	 *
	 * ⇒ `CardAction` → `to` 的换算在**调用方**（`store.ts` 的 `runAction`，
	 *   那里能查到被点的卡：`adopt` 要 `template.kind` + `status`）。
	 *
	 * @param input `to` 已经算好；算不出来时调用方不该调到这
	 */
	act(input: {
		readonly workspaceId: string;
		readonly cardId: string;
		readonly to: string;
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
	/**
	 * 读两条权限轴的当前档位 + 选项表。
	 *
	 * 契约（`packages/dsh/src/http.ts` 的 `GET /permission`）：
	 *
	 * ```
	 * → { ok:true, data:{ cardActionLevel, toolGuardLevel,
	 *                     cardActionOptions, toolGuardOptions } }
	 * ```
	 *
	 * ⚠ **选项表跟数据一起返回**，不要在客户端硬编码档位文案 ——
	 *   第二份文案漂移时不会报错，只会静默显示一个存不进去的档。
	 */
	getPermission(): Promise<PermissionData>;
	/**
	 * 写一条或两条轴的档位（**PATCH 语义**：只改传了的）。
	 *
	 * 契约（`POST /permission`，body `{ cardActionLevel?, toolGuardLevel? }`）：
	 *
	 * ```
	 * → { ok:true, data:{ cardActionLevel, toolGuardLevel } }   // 回声不带选项表
	 * ```
	 *
	 * ⚠ **只发被改的那一条轴。** 两条都发等于「用 UI 里的旧值覆盖另一条」，
	 *   两个人同时改不同轴时会互相回滚 —— 正交模型在网络层的落点就是这里。
	 *
	 * @param input 至少给一条轴
	 */
	setPermission(input: {
		readonly cardActionLevel?: string;
		readonly toolGuardLevel?: string;
	}): Promise<PermissionLevels>;
}

/**
 * `GET /permission` 的响应。
 *
 * 字段名逐字对齐服务端的 `PermissionState`（`packages/dsh/src/http.ts:179`）。
 */
export interface PermissionData {
	readonly cardActionLevel: string;
	readonly toolGuardLevel: string;
	readonly cardActionOptions: readonly PermissionAxisOption[];
	readonly toolGuardOptions: readonly PermissionAxisOption[];
}

/** 一个档位的渲染素材（服务端 options 数组的元素）。 */
export interface PermissionAxisOption {
	readonly value: string;
	readonly label: string;
	readonly description: string;
}

/** `POST /permission` 的回声（只有两条轴的值，不含选项表）。 */
export interface PermissionLevels {
	readonly cardActionLevel: string;
	readonly toolGuardLevel: string;
}

/** `POST /render-check` 的响应。 */
export interface RenderCheckResult {
	/** 模板实际用到的 `$type`（去重、字母序）。 */
	readonly required: readonly string[];
	/** 需要但 UI 没注册的 `$type`（去重、字母序）。空数组 = 全都有。 */
	readonly missing: readonly string[];
}

/**
 * `POST /workspaces/:id/archive` / `/unarchive` 的响应。
 *
 * ## 为什么带 `workspace` 而不只给 `changed`
 *
 * 客户端归档后要立刻用新的 `archived` 标记重画 chip。只给 `changed: true`
 * 它还得再发一次 `GET /state` 才能知道新状态 —— 而服务端手上就有这张空间。
 */
export interface ArchiveResult {
	/**
	 * 这次调用**真的改了状态**吗。
	 *
	 * `false` = 本来就已是目标状态（幂等，**不是错误**）。
	 */
	readonly changed: boolean;
	/** 归档 / 取消归档之后的空间（`archived` 已是新值）。 */
	readonly workspace: Workspace | undefined;
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
			/*
			 * ⚠ **query 名是 `workspace`，不是 `workspaceId`。**
			 *
			 * 服务端（`dsh/src/http.ts:283`）读的是 `query.get('workspace')`：
			 *
			 * ```ts
			 * const workspaceId = query.get('workspace') ?? (await deps.defaultWorkspaceId());
			 * ```
			 *
			 * 发 `?workspaceId=ws2` 时服务端读不到 ⇒ **静默回落到默认空间（第一个）**。
			 *
			 * 症状（2026-11-23 在隔离 profile 里实测）：
			 *   用户在「验收空间」里建了卡 ⇒ 切过去 ⇒ 仍然显示「共 0 条」。
			 *   而 `GET /state?workspace=ws2` 直接请求能拿到 2 张卡。
			 *
			 * 「静默回落」比报错坏得多 —— 用户看到的是「我的卡没了」。
			 */
			return request<StateData>('state', workspaceId === undefined ? undefined : { query: { workspace: workspaceId } });
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
		async archiveWorkspace(id) {
			return request<ArchiveResult>(`workspaces/${encodeURIComponent(id)}/archive`, {
				method: 'POST',
			});
		},
		async unarchiveWorkspace(id) {
			return request<ArchiveResult>(`workspaces/${encodeURIComponent(id)}/unarchive`, {
				method: 'POST',
			});
		},
		async patchCard(input) {
			/*
			 * ⚠ **扁平展开**，不包 `patch` 字段。
			 *
			 * 服务端在顶层读 `title` / `note` / `content`。包一层的话它全读到
			 * `undefined` ⇒ 空对象 patch ⇒ 静默不改。见 `TaskboardApi.patchCard` 的注释。
			 */
			return request<Card>(`cards/${encodeURIComponent(input.cardId)}`, {
				method: 'PATCH',
				body: {
					workspaceId: input.workspaceId,
					...(input.title === undefined ? {} : { title: input.title }),
					...(input.note === undefined ? {} : { note: input.note }),
					...(input.content === undefined ? {} : { content: input.content }),
				},
			});
		},
		async act(input) {
			return request<ActionResult>(`cards/${encodeURIComponent(input.cardId)}/action`, {
				method: 'POST',
				body: { workspaceId: input.workspaceId, to: input.to },
			});
		},
		async renderCheck(registered) {
			return request<RenderCheckResult>('render-check', {
				method: 'POST',
				body: { registered: [...registered] },
			});
		},
		async getPermission() {
			return request<PermissionData>('permission');
		},
		async setPermission(input) {
			/*
			 * ⚠ **只带传了的字段**（PATCH 语义）。
			 *
			 * 两条都发 = 用 UI 里的值覆盖另一条轴 ⇒ 两个人同时改不同轴会互相回滚。
			 * 服务端也要求「至少要给一个」：两个都不给会 400。
			 */
			return request<PermissionLevels>('permission', {
				method: 'POST',
				body: {
					...(input.cardActionLevel === undefined ? {} : { cardActionLevel: input.cardActionLevel }),
					...(input.toolGuardLevel === undefined ? {} : { toolGuardLevel: input.toolGuardLevel }),
				},
			});
		},
	};
}
