/**
 * markdown 渲染组件 —— **薄到不需要单测的机械映射**。
 *
 * ```tsx
 * <Markdown source={card.note} />
 * // ⇒ <div class="md">…</div>
 * ```
 *
 * ## 为什么这么薄
 *
 * 所有**判决**（哪些标签允许、哪些链接放行、哪些整棵丢弃）都在
 * `dev/pure/markdown-tokens.ts` —— 那是纯函数，`node --test` 直接跑，
 * 46 条测试含 12 条 XSS 用例。
 *
 * 本文件只做 `MdNode → ReactNode` 的 1:1 映射：
 *
 * - `MdElement.tag` 的类型是 `MdTag`（`MD_TAGS` 的联合）⇒ **不可能**渲染出白名单外的标签，
 *   这是**编译期**保证，不是运行时检查。
 * - 属性只来自 `MdProps`（`MD_PROP_KEYS` 的 Partial）⇒ 结构上就没有 `onClick`/`dangerouslySetInnerHTML`
 *   这类位置可放。**不 `innerHTML`** —— React 的 `children` 是文本节点，不是 HTML 字符串。
 *
 * ⇒ 组件里没有任何 `dangerouslySetInnerHTML`、没有任何 `eval`、没有任何 URL 拼接。
 *   谁要在这里加安全逻辑，先问「为什么不能放进 `markdown-tokens.ts`」。
 *
 * ## 为什么用 `createElement` 而不是 JSX
 *
 * 标签名是**运行时变量**（`node.tag`），JSX 需要 `React.createElement(node.tag, …)`；
 * 直接调用 `createElement` 比 `const Tag = node.tag; <Tag/>` 少一层「大写开头」的伪装，
 * 而且能在文件头一眼看清「这里没有 JSX 注入」。
 */

import { createElement, type ReactNode } from 'react';

import { renderMarkdownNodes, type MdElement, type MdNode } from '../pure/markdown-tokens.ts';

/** 组件属性。 */
export interface MarkdownProps {
	/** markdown 源码。空串 / 纯空白 ⇒ 渲染成空的 `.md` 容器。 */
	readonly source: string;
	/** 额外类名（追加在 `md` 后面，如章节正文用 `md md--section`）。 */
	readonly className?: string;
}

/**
 * 渲染一个节点。
 *
 * ⚠ `props` 直接透传 —— 但 `MdProps` 的**类型**已经限定只能是
 * `class` / `align` / `href` / `target` / `rel` / `data-lang`。
 * 所以这里不需要、也不该再做一次过滤（重复过滤会让「谁负责安全」变模糊）。
 */
function renderNode(node: MdNode, key: number): ReactNode {
	if (node.kind === 'text') return node.value;

	const { tag, props, children } = node;
	return createElement(
		tag,
		{
			key,
			className: props.class,
			align: props.align,
			href: props.href,
			target: props.target,
			rel: props.rel,
			'data-lang': props['data-lang'],
		},
		children.length === 0 ? null : children.map(renderNode),
	);
}

/**
 * 一个 markdown 块（`.md` 容器 + 净化后的节点树）。
 *
 * @param props 见 `MarkdownProps`
 */
export function Markdown(props: MarkdownProps): ReactNode {
	const nodes = renderMarkdownNodes(props.source);
	const className = props.className === undefined ? 'md' : `md ${props.className}`;
	return createElement('div', { className }, nodes.map(renderNode));
}

/**
 * 只拿节点、不套 `.md` 容器 —— 给「外面已经有容器」的场合用。
 *
 * @param source markdown 源码
 */
export function markdownChildren(source: string): ReactNode[] {
	return renderMarkdownNodes(source).map(renderNode);
}

/**
 * `renderMarkdown(source): ReactNode` —— 任务的**收敛点**（旧版同名函数）。
 *
 * 与 `<Markdown source={…} />` 等价，给「不在 JSX 里」的调用方用
 * （比如以后 `section.ts` 要返回 `ReactNode` 而不是自己拼字符串）。
 *
 * ⚠ **换库点只有这一个**：将来若把 marked 换成别的库，
 * 改 `dev/pure/markdown-tokens.ts` 就够了，本函数与所有调用方都不用动。
 *
 * @param source markdown 源码
 * @param className 额外类名（可选，追加在 `md` 后面）
 */
export function renderMarkdown(source: string, className?: string): ReactNode {
	return createElement(
		'div',
		{ className: className === undefined ? 'md' : `md ${className}` },
		markdownChildren(source),
	);
}
