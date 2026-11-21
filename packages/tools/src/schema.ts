/**
 * 输出形状 + schema 冻结。
 *
 * ## 所有工具共用一份 output schema
 *
 * 工具只回一段文字给模型（理由见 `types.ts` 的 `TaskboardToolResult`）。
 * 若每个工具各写一份 output schema，那是把同一件事抄十六遍，而且改一次
 * 文案就要同步改十六处。
 *
 * ## 为什么在这里冻结 schema
 *
 * 用户裁定（见 `packages/dsh/src/tools.ts` 文件头）：工具 schema 在 prompt
 * 前缀里，**一动就击穿 KV cache**。⇒ 参数表不仅要「写死」，还不能被宿主
 * 在运行时改到。深冻结成本极低（每个工具只做一次），换来一条硬保证：
 * 任何人对 schema 赋值都会在严格模式下当场抛错，而不是静默改掉下一个宿主的
 * prompt 前缀。
 */

import type { JsonObjectSchema, JsonSchema, TaskboardToolResult } from './types.ts';

/**
 * 所有工具共用的 output schema。
 *
 * `additionalProperties: false` + 只声明 `text` ⇒ 宿主若做输出校验，形状是封闭的。
 */
export const TEXT_OUTPUT_SCHEMA: JsonObjectSchema = Object.freeze({
	type: 'object',
	additionalProperties: false,
	properties: Object.freeze({
		text: Object.freeze({ type: 'string', description: '给模型看的文字结果。' }),
	}),
	required: Object.freeze(['text']),
});

/** 一个文本 content 块（MCP 的 `{ type: 'text', text }`，DSH 的 render 同形）。 */
export interface TextContentBlock {
	readonly type: 'text';
	readonly text: string;
}

/**
 * 把工具结果翻成宿主的 content 块数组。
 *
 * DSH 适配层：`render: (_args, value) => textContentBlocks(value)`；
 * MCP 适配层：`content: textContentBlocks(result)`。
 *
 * ⚠ 故意**不**读 `isError` —— 那是块的兄弟字段（MCP 的 result 级 `isError`），
 *   不是块自己的字段。宿主自己决定怎么用。
 */
export function textContentBlocks(value: unknown): readonly TextContentBlock[] {
	const text =
		typeof value === 'object' && value !== null && typeof (value as { text?: unknown }).text === 'string'
			? (value as { text: string }).text
			: String(value);
	return [{ type: 'text', text }];
}

/**
 * 深冻结一个 schema 节点（对象 + 数组，递归）。
 *
 * 只处理 JSON 值：本包产出的 schema 里没有函数 / Date / Map。
 *
 * @returns 同一个引用（便于内联使用）
 */
export function freezeSchema<T extends JsonSchema>(schema: T): T {
	deepFreeze(schema);
	return schema;
}

/** 递归冻结任意 JSON 值。 */
function deepFreeze(value: unknown): void {
	/* 原始值与函数无需处理（本包的 schema 里也不会出现后者的嵌套）。 */
	if (typeof value !== 'object' || value === null) return;
	if (Object.isFrozen(value)) return;
	Object.freeze(value);
	if (Array.isArray(value)) {
		for (const item of value) deepFreeze(item);
		return;
	}
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
}

/**
 * 工具结果的规范化（目前只保证 `isError` 不出现 `undefined` 键）。
 *
 * `exactOptionalPropertyTypes` 下 `{ isError: undefined }` 与「没有这个键」
 * 是两回事；宿主若做 `'isError' in result` 的判断，前者会让它误判。
 * 本包所有 handler 都经 `ok()` / `fail()` 产出，不会手写这个对象。
 */
export function textResult(text: string): TaskboardToolResult {
	return { text };
}

/** 失败结果（`isError: true`）。 */
export function errorResult(text: string): TaskboardToolResult {
	return { text, isError: true };
}
