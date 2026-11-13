/**
 * 错误码。
 *
 * ## 一条规则：错误码要说清「下一步做什么」
 *
 * 判据：`CARD_NOT_FOUND` 与 `TEMPLATES_UNAVAILABLE` 是两类 ——
 * 前者是**调用方传错了**（可修），后者是**装配坏了**（不是用户的问题）。
 * 两类不能混成一个码，否则消费方没法决定「重试 / 提示 / 忽略」。
 *
 * ## 形状：判别联合，不是 `{ ok, error }`
 *
 * 所有返回 `Failure` 的方法都返回本文件的形状。不要用
 *
 * ```ts
 * { ok: false, error: { code: string } }   // ❌ code 是 string，拼错不报错
 * ```
 *
 * 而用
 *
 * ```ts
 * { ok: false, code: 'CARD_NOT_FOUND', ... }   // ✅ code 是字面量联合
 * ```
 */

/** 全部错误码。新增时**必须**在 `ERROR_HINTS` 里补一条（编译期强制）。 */
export const ErrorCode = {
	/* ── 调用方可修的 ── */
	CARD_NOT_FOUND: 'CARD_NOT_FOUND',
	WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
	TEMPLATE_NOT_FOUND: 'TEMPLATE_NOT_FOUND',
	/** 章节名不属于该模板，或 payload 形状不对（`issues` 里有细节）。 */
	CONTENT_INVALID: 'CONTENT_INVALID',
	/** 状态转移被拒（`reason` 是拒绝原因，来自状态机）。 */
	TRANSITION_REJECTED: 'TRANSITION_REJECTED',
	/** 关系目标非法（不存在 / 是草稿 / 目标就是自己）。 */
	RELATION_TARGET_INVALID: 'RELATION_TARGET_INVALID',
	/** 该卡当前不可领取（依赖未完成 / 已有持有者 / 配额已满）。 */
	CLAIM_REJECTED: 'CLAIM_REJECTED',
	/** 建卡时必填项缺失。 */
	FIELD_REQUIRED: 'FIELD_REQUIRED',

	/* ── 装配方的问题（不是用户能修的） ── */
	/** 模板注册表不可用（YAML 解析失败 / 尚未加载）。 */
	TEMPLATES_UNAVAILABLE: 'TEMPLATES_UNAVAILABLE',
	/** 请求的 action 没注册。 */
	ACTION_NOT_FOUND: 'ACTION_NOT_FOUND',
	/** port 没提供（替换实现违约）。 */
	PORT_UNAVAILABLE: 'PORT_UNAVAILABLE',

	/* ── 兜底 ── */
	INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** 错误码的联合类型。 */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * 每个错误码的**默认下一步**。
 *
 * 给 AI 工具和 UI 用：AI 工具把它拼进返回文字（「下一步可以……」），
 * UI 用它决定「显示重试按钮 / 显示下拉 / 什么都不做」。
 */
export const ERROR_HINTS: Readonly<Record<ErrorCode, string>> = Object.freeze({
	CARD_NOT_FOUND: '编号不存在。用列表工具查一下可用编号。',
	WORKSPACE_NOT_FOUND: '空间不存在或已归档。用空间列表确认。',
	TEMPLATE_NOT_FOUND: '模板不存在。用注册表工具查可用模板。',
	CONTENT_INVALID: '按 issues 里的章节名与字段修正后重试。',
	TRANSITION_REJECTED: '该状态转移不被允许；先满足 reason 里说的条件。',
	RELATION_TARGET_INVALID: '换一个目标卡编号，或改为不建这条关系。',
	CLAIM_REJECTED: '先完成依赖，或释放手上另一个处理中的卡。',
	FIELD_REQUIRED: '补上缺失字段后重试。',
	TEMPLATES_UNAVAILABLE: '模板注册表未就绪；这是安装问题，不是调用问题。',
	ACTION_NOT_FOUND: 'action 未注册。用注册表工具查可用 action。',
	PORT_UNAVAILABLE: '该能力未装配；检查插件是否完整。',
	INTERNAL_ERROR: '内部错误；这是缺陷，请报告。',
});

/**
 * 一条字段级问题（UI 标红 / AI 读文字）。
 *
 * `path` 用 JSON Pointer 风格（`/content/要查什么/value`），
 * 与 DSH 的 schema 校验诊断同形，两边可以互相翻译。
 */
export interface FieldIssue {
	/** 出问题的位置。空串 = 整个入参。 */
	readonly path: string;
	/** 人话说明（中文，这句会直接展示）。 */
	readonly message: string;
}

/**
 * 失败的统一形状。
 *
 * 调用方一律先判 `ok`，再读 `code` —— 判别联合保证 `code` 存在。
 */
export interface Failure {
	readonly ok: false;
	readonly code: ErrorCode;
	/** 人话说明；已包含 `ERROR_HINTS[code]` 之外的上下文。 */
	readonly message: string;
	/** 字段级问题（`CONTENT_INVALID` 时必有）。 */
	readonly issues?: readonly FieldIssue[];
	/** 额外的结构化细节，形状随 `code` 而定。 */
	readonly detail?: unknown;
}

/** 造一个失败结果。 */
export function failure(
	code: ErrorCode,
	message: string,
	extra?: { readonly issues?: readonly FieldIssue[]; readonly detail?: unknown },
): Failure {
	return {
		ok: false,
		code,
		message,
		...(extra?.issues === undefined ? {} : { issues: extra.issues }),
		...(extra?.detail === undefined ? {} : { detail: extra.detail }),
	};
}

/** 是否是失败结果。 */
export function isFailure(value: unknown): value is Failure {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { ok?: unknown }).ok === false &&
		typeof (value as { code?: unknown }).code === 'string'
	);
}
