/**
 * HTTP 客户端（权限面）—— 与 `@taskboard/dsh-client/src/api.ts` 同一契约的**子集**。
 *
 * ## 为什么是复制而不是 import dsh-client
 *
 * 本行（`taskboard3-permissions`）必须能在 dsh-client 行关闭时独立激活——
 * 依赖它的 api 模块就把两条行的命运焊死，拆分失去意义。两份 buildPath 共约 20 行，
 * 契约（相对路径解析 + 信封解包）逐字相同；漂移由两个包各自的测试钉住。
 *
 * ⚠ 本包只保留权限面需要的成员：`buildPath`（工具页/授权页自己 fetch）+
 *   `getPermission` / `setPermission`（权限框的 store 用）。
 */

import type { Envelope, FailEnvelope, OkEnvelope } from './types.ts';

/**
 * API 根路径。**没有前导斜杠** —— 相对文档 URL 解析（同 dsh-client 的理由：
 * DSH 页面可能挂在子路径下，绝对路径会跳出挂载点）。
 */
export const API_BASE = 'taskboard3/api';

/** 带业务错误码的异常。 */
export interface ApiError extends Error {
	/** 后端错误码（与 `@taskboard/protocol` 的 `ErrorCode` 同值域）。 */
	readonly code: string;
}

/**
 * 拼一个 API 路径（纯函数）。
 *
 * 行为与 dsh-client 的同名函数逐字一致：前导 `/` 吃掉、空 query 不产生 `?`、
 * 值 `encodeURIComponent`、数组用重复参数。
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

/** 解包信封（纯函数）。失败信封抛 `ApiError`，`code` / `message` 原样带出。 */
export function unwrap<T>(envelope: Envelope<T>): T {
	if (envelope.ok) return envelope.data;
	const error = new Error(envelope.message) as ApiError & { code: string };
	(error as { code: string }).code = envelope.code;
	throw error;
}

/** 造一个 `ApiError`（网络层异常也用这个形状，调用方只需处理一种错误）。 */
export function apiError(code: string, message: string): ApiError {
	const error = new Error(message) as ApiError & { code: string };
	(error as { code: string }).code = code;
	return error;
}

/** 一次 HTTP 往返的最小抽象（测试可注入假的）。 */
export type FetchLike = (
	url: string,
	init?: { readonly method?: string; readonly body?: string; readonly headers?: Record<string, string> },
) => Promise<{ readonly ok: boolean; readonly status: number; readonly text: () => Promise<string> }>;

/**
 * `GET /permission` 的响应（字段逐字对齐服务端的 `PermissionState`）。
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

/** 权限面客户端。 */
export interface PermissionsApi {
	getPermission(): Promise<PermissionData>;
	setPermission(input: {
		readonly cardActionLevel?: string;
		readonly toolGuardLevel?: string;
	}): Promise<PermissionLevels>;
}

/**
 * 造一个权限面客户端。
 *
 * @param fetchImpl 可选注入（测试用）；省略则用全局 `fetch`
 */
export function createApi(fetchImpl?: FetchLike): PermissionsApi {
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

	/** 一次请求：拼路径 → fetch → 解析 JSON → 解包（三层失败统一成 `ApiError`）。 */
	async function request<T>(
		path: string,
		options?: {
			readonly method?: string;
			readonly body?: unknown;
		},
	): Promise<T> {
		const url = buildPath(path);
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
		async getPermission() {
			return request<PermissionData>('permission');
		},
		async setPermission(input) {
			/* PATCH 语义：只带传了的字段（两条都发 = 用 UI 旧值覆盖另一条轴）。 */
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
