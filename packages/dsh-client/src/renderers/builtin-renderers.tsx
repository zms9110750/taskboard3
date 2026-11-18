/**
 * 三个内置 action 的渲染器 —— **注册表里 `text` / `markdown` / `ask` 对应的组件**。
 *
 * ## 为什么是三个薄包装，而不是直接把 `Section` 注册三次
 *
 * `Section` 是**通用**渲染器：它内部按 `payloadKindOf` 分发到 text / markdown / ask。
 * 把同一个 `Section` 注册成三个 key 是能跑的，但那是错的：
 *
 * - `rendererOf('text')` 拿到的组件**也能画 markdown** —— 注册表失去意义
 * - 注册表存在的理由就是「一个 type 一个组件」，三个 key 指同一个东西等于没注册
 *
 * ⇒ 每个 type 一个**独立组件**，各自只认自己那一种。
 *
 * ## 但外壳复用 `Section`
 *
 * 章节外壳（label 行 / 编辑提示 / 只读态 / class 名）三边完全一样，
 * 抄三遍是没意义的重复。所以包装做的事是：
 *
 * 1. **类型断言**：payload 判出来不是我这个 kind ⇒ 渲染 `KindMismatch`
 *    （正常路径下不可能发生 —— 路由由注册表按 `$type` 决定；这是不变量守卫）
 * 2. **委托渲染**：断言通过后交给 `Section`
 *
 * ⚠ **这不是最终形态。** 真正干净的做法是把 `Section` 拆成
 *   `SectionShell`（外壳）+ `TextContent` / `MarkdownContent` / `AskContent`，
 *   三个渲染器各拿自己的那一半。现在拆的代价是动一个过了 90 条 CDP 断言的
 *   组件，而收益只是「少一次内部 switch」。
 *
 *   ⇒ 等第 7 步（差集断言）跑通、注册表真的成为唯一入口之后再做拆分。
 *     那时 `Section` 的内部 switch 会变成死代码，删它是自然的。
 */

import type { ReactNode } from 'react';

import { sectionViewOf, type SectionKind } from '../pure/section.ts';
import type { RendererProps } from '../render-registry.ts';
import { Section } from './Section.tsx';

/**
 * payload 判出来的 kind 和注册的 key 不一致 —— **不变量被破坏**。
 *
 * 正常路径下不会出现：注册表按 `payload.$type` 选渲染器，
 * 而 `sectionViewOf()` 也按同一个字段判 kind ⇒ 两边必然一致。
 *
 * 出现这种情况说明：
 * - 有人手动 `rendererOf('text')` 拿到组件却塞了 markdown 的 payload
 * - 或者 `$type` 和 payload 实际形状不符（模板校验漏了）
 *
 * ⚠ **不静默降级成正确的那一种** —— 那会把这个 bug 藏起来。
 */
function KindMismatch(props: { readonly expected: SectionKind; readonly actual: SectionKind }): ReactNode {
	return (
		<div className="section-block__mismatch" data-expected={props.expected} data-actual={props.actual}>
			⚠ 渲染器不匹配：注册在「{props.expected}」下，但 payload 是「{props.actual}」。
			这是 bug（注册表路由与实际 payload 不一致），已拒绝渲染。
		</div>
	);
}

/**
 * 造一个「只认某一种 kind」的渲染器。
 *
 * @param expected 这个渲染器负责的 kind
 * @returns 一个 React 组件
 */
function makeKindRenderer(expected: SectionKind): (props: RendererProps) => ReactNode {
	function KindRenderer(props: RendererProps): ReactNode {
		const view = sectionViewOf(props.section.payload);
		if (view.kind !== expected) return <KindMismatch expected={expected} actual={view.kind} />;
		return <Section {...props} />;
	}
	KindRenderer.displayName = `${expected[0]?.toUpperCase() ?? ''}${expected.slice(1)}Renderer`;
	return KindRenderer;
}

/** `text` payload 的渲染器。 */
export const TextRenderer = makeKindRenderer('text');

/** `markdown` payload 的渲染器。 */
export const MarkdownRenderer = makeKindRenderer('markdown');

/** `ask` payload 的渲染器。 */
export const AskRenderer = makeKindRenderer('ask');
