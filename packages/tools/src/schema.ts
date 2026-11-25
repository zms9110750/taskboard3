/**
 * 输出形状 + schema 冻结 + JSON Schema 小工具。
 *
 * 所有工具共用一份 output schema（只回一段文字给模型）。
 * `inputSchema` 在工厂里**深冻结**：schema 在 prompt 前缀里，一动就击穿
 * KV cache（用户裁定）⇒ 不允许宿主在运行时改到。
 */

import type { JsonObjectSchema, JsonSchema } from './types.ts';

// TODO(审查): TEXT_OUTPUT_SCHEMA 在本包内除测试外零消费（只有 contract.test.ts 引用），
// TaskboardTool 也没有 outputSchema 字段。若适配层同样不用，这就是死导出。需 lead / 适配层确认。
/** 所有工具共用的 output schema。 */
export const TEXT_OUTPUT_SCHEMA: JsonObjectSchema = Object.freeze({
	type: 'object',
	additionalProperties: false,
	properties: Object.freeze({
		text: Object.freeze({ type: 'string', description: '给模型看的文字结果。' }),
	}),
	required: Object.freeze(['text']),
});

/** 一个文本 content 块（MCP 的 `{ type: 'text', text }`，DSH render 同形）。 */
export interface TextContentBlock {
	readonly type: 'text';
	readonly text: string;
}

/** 把工具结果翻成宿主的 content 块数组。 */
export function textContentBlocks(value: unknown): readonly TextContentBlock[] {
	const text =
		typeof value === 'object' && value !== null && typeof (value as { text?: unknown }).text === 'string'
			? (value as { text: string }).text
			: String(value);
	return [{ type: 'text', text }];
}

/** 深冻结一个 schema（对象 + 数组，递归）。 */
export function freezeSchema<T extends JsonSchema>(schema: T): T {
	deepFreeze(schema);
	return schema;
}

/** 递归冻结任意 JSON 值。 */
function deepFreeze(value: unknown): void {
	if (typeof value !== 'object' || value === null) return;
	if (Object.isFrozen(value)) return;
	// TODO(审查): 这里「已冻结就整棵子树跳过」是浅冻结泄漏 —— 外层被冻结、内层仍有可变节点时，
	// 深冻结实际没发生（宿主可偷偷改 schema 击穿 prompt 前缀的 KV cache）。可直接改：冻结后继续递归子节点。
	Object.freeze(value);
	if (Array.isArray(value)) {
		for (const item of value) deepFreeze(item);
		return;
	}
	for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
}

/** 成功结果。 */
export function okText(text: string): { readonly text: string } {
	return { text };
}
