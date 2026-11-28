/**
 * 权限面的 HTTP 传输层 —— **一个信封解析入口**。
 *
 * ## 为什么单独一个文件（不在 `.tsx` 里）
 *
 * 两个页面（组图 / 授权）都要发 `GET` / `PUT`，并且都要把失败信封翻译成
 * 「能显示给用户的一句话」。原来各自在 `.tsx` 里写 `fetchJson`（只有 GET）
 * ⇒ 一加 PUT 就会出现第二份解析逻辑。**信封只有一种形状，解析也只留一处。**
 *
 * ## 信封
 *
 * ```
 * 成功  { ok: true, data: … }
 * 失败  { ok: false, code, message, issues?, detail? }
 * ```
 *
 * `detail` 是**结构化的二次判定**（比如组图的 `detail.code = CYCLE` +
 * `detail.cycle` 环路径）。它是「服务端的判定码」，与 `code`（`@taskboard/protocol`
 * 的闭集合错误码）不是一回事 —— 两个都原样带出，由调用方决定怎么显示。
 *
 * ## 为什么不用 `createApi()`
 *
 * `createApi()` 只覆盖 `permission` 两条轴（见 `api.ts`），而且它把失败信封
 * 压成一个 `ApiError`，会丢掉 `detail`。组图失败必须看 `detail.code` /
 * `detail.cycle` ⇒ 这里保留完整失败结构。
 */

import { buildPath } from './api.ts';
import type { TemplateSummary } from './types.ts';

/** 一次失败（结构见文件头）。 */
export interface WireFailure {
	/** HTTP 状态；`0` = 没连上（网络 / 取消）。 */
	readonly status: number;
	/** 能直接显示的一句话（来自服务端 `message`，或传输层自己的说明）。 */
	readonly message: string;
	/** 协议错误码（`{ ok:false, code }` 的 `code`）。 */
	readonly code?: string;
	/** 判定码（`detail.code`，如 `CYCLE`）。 */
	readonly detailCode?: string;
	/** 成环时的环路径（首尾闭合的节点 id）。 */
	readonly cycle?: readonly string[];
}

/** 一次请求的结果。 */
export type WireResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly failure: WireFailure };

function failureOf(status: number, message: string): WireFailure {
	return { status, message };
}

/** 从失败信封里挖 `detail`（形状不可信，逐字段看类型）。 */
function detailOf(body: Record<string, unknown>): Pick<WireFailure, 'detailCode' | 'cycle'> {
	const detail = body['detail'];
	if (typeof detail !== 'object' || detail === null) return {};
	const record = detail as Record<string, unknown>;
	const rawCode = record['code'];
	const rawCycle = record['cycle'];
	const cycle = Array.isArray(rawCycle) ? rawCycle.filter((one): one is string => typeof one === 'string') : undefined;
	return {
		...(typeof rawCode === 'string' ? { detailCode: rawCode } : {}),
		...(cycle === undefined || cycle.length === 0 ? {} : { cycle }),
	};
}

/**
 * 一次 JSON 往返（失败返回结构，不抛）。
 *
 * @param method `GET` / `PUT` / `POST`
 * @param path `buildPath()` 的相对路径（如 `tool-graph`）
 * @param options `signal` 用于卸载时取消；`body` 会被 `JSON.stringify`
 */
export async function requestJson(
	method: string,
	path: string,
	options?: {
		readonly signal?: AbortSignal;
		readonly body?: unknown;
	},
): Promise<WireResult<unknown>> {
	const hasBody = options?.body !== undefined;
	let response: Response;
	try {
		response = await fetch(buildPath(path), {
			method,
			...(options?.signal === undefined ? {} : { signal: options.signal }),
			headers: {
				accept: 'application/json',
				...(hasBody ? { 'content-type': 'application/json' } : {}),
			},
			...(hasBody ? { body: JSON.stringify(options.body) } : {}),
		});
	} catch (cause) {
		if (cause instanceof DOMException && cause.name === 'AbortError') return { ok: false, failure: failureOf(0, '已取消') };
		return {
			ok: false,
			failure: failureOf(0, `无法连接任务板服务：${cause instanceof Error ? cause.message : String(cause)}`),
		};
	}

	let text: string;
	try {
		text = await response.text();
	} catch (cause) {
		return { ok: false, failure: failureOf(response.status, `读取响应失败：${cause instanceof Error ? cause.message : String(cause)}`) };
	}

	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return { ok: false, failure: failureOf(response.status, `服务返回了非 JSON 内容（HTTP ${String(response.status)}）。`) };
	}
	if (typeof body !== 'object' || body === null) {
		return { ok: false, failure: failureOf(response.status, `服务的响应不是一个信封对象（HTTP ${String(response.status)}）。`) };
	}

	const record = body as Record<string, unknown>;
	if (record['ok'] === true) return { ok: true, data: record['data'] };

	const rawCode = record['code'];
	const rawMessage = record['message'];
	return {
		ok: false,
		failure: {
			status: response.status,
			message:
				typeof rawMessage === 'string' && rawMessage !== ''
					? rawMessage
					: `服务返回 HTTP ${String(response.status)}`,
			...(typeof rawCode === 'string' ? { code: rawCode } : {}),
			...detailOf(record),
		},
	};
}

/** 从标准信封里取 `data`（历史形状；`requestJson` 已经解过一层）。 */
export function dataOf(raw: unknown): unknown {
	if (typeof raw !== 'object' || raw === null) return undefined;
	return (raw as Record<string, unknown>)['data'];
}

/**
 * 从 `{ ok, data: { templates: [...] } }` 里取模板清单（只认形状对的条目）。
 *
 * @param raw `requestJson()` 的 `data`
 */
export function templatesOf(raw: unknown): readonly TemplateSummary[] {
	const body = typeof raw === 'object' && raw !== null && 'templates' in raw ? raw : dataOf(raw);
	if (typeof body !== 'object' || body === null) return [];
	const list = (body as Record<string, unknown>)['templates'];
	if (!Array.isArray(list)) return [];
	const out: TemplateSummary[] = [];
	for (const one of list) {
		if (typeof one !== 'object' || one === null) continue;
		const record = one as Record<string, unknown>;
		const ref = record['ref'];
		const displayName = record['displayName'];
		const kind = record['kind'];
		const domain = record['domain'];
		if (
			typeof ref !== 'string' ||
			typeof displayName !== 'string' ||
			typeof kind !== 'string' ||
			typeof domain !== 'string'
		) {
			continue;
		}
		out.push({ ref, displayName, kind, domain });
	}
	return out;
}
