/**
 * 本包自己的数据形状（**不依赖 core / 不依赖 dsh-client**）。
 *
 * 与 `@taskboard/dsh-client/src/types.ts` 同一理由：浏览器包不 import core
 * （会把 `node:sqlite` 拖进 bundle）。这里只声明权限面用到的字段 ——
 * `TemplateSummary` 与信封形状是**逐字对应**的 wire 契约子集。
 */

/** 模板摘要（模板授权页用；字段与 `@taskboard/dsh-client` 的同名类型一致）。 */
export interface TemplateSummary {
	readonly ref: string;
	readonly displayName: string;
	readonly kind: string;
	readonly domain: string;
}

/** 失败信封。 */
export interface FailEnvelope {
	readonly ok: false;
	readonly code: string;
	readonly message: string;
	readonly issues?: readonly { readonly path: string; readonly message: string }[];
}

/** 成功信封。 */
export interface OkEnvelope<T> {
	readonly ok: true;
	readonly data: T;
}

/** 服务端返回的两种信封。 */
export type Envelope<T> = OkEnvelope<T> | FailEnvelope;
