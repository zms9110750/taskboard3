/**
 * 三个内置 action 的**内容渲染器** —— 注册表里 `text` / `markdown` / `ask` 对应的组件。
 *
 * ## 用户 2026-11-22 的要求
 *
 * > 「这种外来的东西按照特征或者头在运行时注册和分发。应该有标准做法吧。
 * >   无论是 DI 还是责任链还是更简单的字典。这个问题很难吗？」
 *
 * ⇒ **一次做完**：注册表就是唯一分发点。
 *
 * ```
 * SectionFrame / SectionContent
 *   └─ rendererOf(payload.$type)   ← 唯一查表
 *        ├─ 'text'     → TextContent
 *        ├─ 'markdown' → MarkdownContent
 *        ├─ 'ask'      → AskContent
 *        └─ 第三方 registerRenderer('foo', FooContent)
 * ```
 *
 * ## 为什么不再是「包装整个 Section」
 *
 * 旧版把 `Section` 注册成三个 kind 的渲染器 —— 那会**环形**：
 *
 * ```
 * Section → SectionContent → rendererOf('text') → KindRenderer → <Section> → …
 * ```
 *
 * ⇒ 现在注册的是**内容组件**（不带章节外壳），`Section` 只管外壳。
 *   外层一次查表、内层一次查表，各自职责单一，没有环。
 *
 * ## `KindMismatch` 还要不要
 *
 * 不要了。旧版需要它是因为「三个 key 都指向 `Section`」，`Section` 可能拿到
 * 不是自己 kind 的 payload。现在每个内容组件**只可能被自己那个 key 选中**，
 * 注册表路由与 payload 形状由 `$type` 唯一决定 —— 不变量从「运行时守卫」
 * 变成了「结构上不可能」。
 */

import type { ReactNode } from 'react';

import type { RendererComponent, RendererProps } from '../render-registry.ts';
import { AskSection } from './AskSection.tsx';
import { MarkdownBlock, TextBlock } from './Section.tsx';
import type { BuiltinType } from './builtin-types.ts';

/* ══════════════════════════════════════════════════════════
   三个内容组件（薄适配：把 RegistryProps 的字段铺给内容组件）
   ══════════════════════════════════════════════════════════ */

// TODO(审查): `view={view as never}`（下面还有 :76、:97 两处）是 render-registry.ts:91 `view?: unknown` 导致的断言，不是真实类型关系；view 收窄成 SectionView 后三处都能删。
/** `text` 内容。 */
export function TextContent(props: RendererProps): ReactNode {
	const view = props.view;
	if (view === undefined) return null;
	return (
		<TextBlock
			view={view as never}
			phase={props.phase ?? 'active'}
			readonly={props.readonly === true}
			{...(props.onChange === undefined
				? {}
				: {
						onPatch: (fields: Readonly<Record<string, unknown>>) => {
							props.onChange?.(props.sectionId, fields);
						},
					})}
		/>
	);
}

/** `markdown` 内容。 */
export function MarkdownContent(props: RendererProps): ReactNode {
	const view = props.view;
	if (view === undefined) return null;
	return (
		<MarkdownBlock
			view={view as never}
			phase={props.phase ?? 'active'}
			readonly={props.readonly === true}
			{...(props.onChange === undefined
				? {}
				: {
						onPatch: (fields: Readonly<Record<string, unknown>>) => {
							props.onChange?.(props.sectionId, fields);
						},
					})}
		/>
	);
}

/** `ask` 内容。 */
export function AskContent(props: RendererProps): ReactNode {
	const view = props.view;
	if (view === undefined) return null;
	return (
		<AskSection
			sectionId={props.sectionId}
			view={view as never}
			readonly={props.readonly === true}
			{...(props.onAsk === undefined ? {} : { onAsk: props.onAsk })}
		/>
	);
}

/* ══════════════════════════════════════════════════════════
   注册表
   ══════════════════════════════════════════════════════════ */

/**
 * **清单 → 组件** 的映射表。
 *
 * ⚠ 用 `satisfies` 而不是类型注解 —— 三个方向都会红（见 AGENTS.md §3.7）：
 *
 * | 谁改了什么 | `tsc` |
 * |---|---|
 * | `BUILTIN_TYPES` 加了新 type | 这里缺键 ⇒ **红** |
 * | 这里加了组件但 `BUILTIN_TYPES` 没有它 | 多余的键 ⇒ **红** |
 * | 这里漏写一个组件 | 缺键 ⇒ **红** |
 */
const RENDERER_BY_TYPE = {
	text: TextContent,
	markdown: MarkdownContent,
	ask: AskContent,
} satisfies Record<BuiltinType, RendererComponent>;

/**
 * 导出给 `initRenderers()` 遍历用。
 *
 * @returns 形如 `[['text', TextContent], …]` 的条目数组
 */
export function builtinRendererEntries(): readonly (readonly [BuiltinType, RendererComponent])[] {
	return (Object.entries(RENDERER_BY_TYPE) as [BuiltinType, RendererComponent][]).map(
		([type, Comp]) => [type, Comp] as const,
	);
}
