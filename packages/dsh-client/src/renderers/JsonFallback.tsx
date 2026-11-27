/**
 * JSON 兜底渲染 —— `JsonPreview` 纯数据 → 彩色只读树。
 *
 * ## 什么时候用到
 *
 * `MissingRendererBlock` 里。也就是「③ 真渲染到没注册的 action」那条路径。
 * 用户仍然能看到内容，不会白屏。
 *
 * ## 为什么不是 `JSON.stringify(payload, null, 2)`
 *
 * 因为 `JsonPreview` 已经做了四件 `JSON.stringify` 做不到的事：
 *
 * | 事 | `JSON.stringify` | `JsonPreview` |
 * |---|---|---|
 * | 函数 | 静默丢掉 | 显示 `<function foo>` |
 * | `undefined` | 静默丢掉 / 变 `null` | 单独一种节点，显示 `<undefined>` |
 * | 循环引用 | **抛 TypeError** | 显示 `<循环引用>` |
 * | 超深嵌套 | 抛 / 卡死 | 截断成 `<嵌套超过 12 层>` |
 *
 * ⇒ 直接画 `JsonPreview`，不再 stringify 一遍（那会把已经分好的类型信息丢掉）。
 *
 * ## 深度与折叠
 *
 * 超过 2 层的对象/数组**默认折叠**（点一下展开）。
 * 理由：payload 可能很大，全展开会把兜底块撑成几屏，反而看不到「这是降级块」。
 *
 * ⚠ 折叠状态用 React `useState`，不塞进 `JsonPreview` —— 那是纯数据，不带 UI 状态。
 */

import { useState, type ReactNode } from 'react';

import type { JsonPreview } from '../pure/json-preview.ts';

/** 从第几层开始默认折叠（根是 0）。 */
const COLLAPSE_FROM_DEPTH = 2;

/** 组件属性。 */
export interface JsonFallbackProps {
	/** 描述树（`jsonPreviewOf()` 的产物）。 */
	readonly preview: JsonPreview;
}

/**
 * 只读格式化 JSON 块。
 *
 * @param props 见 `JsonFallbackProps`
 */
export function JsonFallback(props: JsonFallbackProps): ReactNode {
	return <div className="json-fallback">{renderNode(props.preview, 0, '')}</div>;
}

/**
 * 画一个节点。
 *
 * @param node 描述节点
 * @param depth 当前深度（根是 0）
 * @param keyLabel 对象里这个值的键（根为空串）
 */
function renderNode(node: JsonPreview, depth: number, keyLabel: string): ReactNode {
	const key = keyLabel === '' ? null : <span className="json-fallback__key">{keyLabel}: </span>;

	/* object / array：走 Branch（可折叠）。 */
	if (node.kind === 'object' || node.kind === 'array') {
		return (
			<div className="json-fallback__branch" key={undefined}>
				{key}
				<Branch node={node} depth={depth} />
			</div>
		);
	}

	/* string：带引号 + 截断后缀（与其他叶子不同形，独立分支）。 */
	if (node.kind === 'string') {
		return (
			<div className="json-fallback__leaf">
				{key}
				<span className="json-fallback__string">
					&ldquo;{node.value}&rdquo;
					{node.truncated ? <i className="json-fallback__trunc"> …（已截断）</i> : null}
				</span>
			</div>
		);
	}

	/*
	 * 五种「叶子」殊途同归（同一段 DOM，只有类名与文本不同）⇒ 收敛成一次渲染。
	 * ⚠ 表链逐字对应原 case：undefined 复用 __null 类是**原状**，别「顺手修正」。
	 *   string（截断后缀）与 object/array（Branch）不进表，保留独立分支。
	 *
	 * ⚠ opaque 必须画出来，不能留空 —— 「payload 里有怪东西」这个事实被藏起来的
	 *   后果是「界面显示空但没人知道为什么空」（原 case 的注释，随行为一起搬来）。
	 */
	const leaf = node.kind === 'number'
		? { cls: 'json-fallback__number', text: String(node.value) }
		: node.kind === 'boolean'
			? { cls: 'json-fallback__bool', text: String(node.value) }
			: node.kind === 'null'
				? { cls: 'json-fallback__null', text: 'null' }
				: node.kind === 'undefined'
					? { cls: 'json-fallback__null', text: '<undefined>' }
					: { cls: 'json-fallback__opaque', text: node.note };
	return (
		<div className="json-fallback__leaf">
			{key}
			<span className={leaf.cls}>{leaf.text}</span>
		</div>
	);
}

/**
 * 对象 / 数组的分支（可折叠）。
 *
 * @param props 节点 + 深度
 */
function Branch(props: { readonly node: Extract<JsonPreview, { kind: 'object' | 'array' }>; readonly depth: number }): ReactNode {
	const [open, setOpen] = useState(props.depth < COLLAPSE_FROM_DEPTH);
	const node = props.node;
	const isArray = node.kind === 'array';
	const count = isArray ? node.items.length : node.entries.length;
	const bracketOpen = isArray ? '[' : '{';
	const bracketClose = isArray ? ']' : '}';
	const summary = `${bracketOpen}${isArray ? '' : ' '}${String(count)} 项${node.truncated > 0 ? ` · 另有 ${String(node.truncated)} 项被省略` : ''}${isArray ? '' : ' '}${bracketClose}`;

	return (
		<span className="json-fallback__group">
			<button
				type="button"
				className="json-fallback__toggle"
				aria-expanded={open}
				onClick={() => {
					setOpen((one) => !one);
				}}
			>
				<span className="json-fallback__caret">{open ? '▾' : '▸'}</span>
				{summary}
			</button>
			{open ? (
				<div className="json-fallback__children">
					{isArray
						? node.items.map((item, index) => (
								<div className="json-fallback__row" key={index}>
									{renderNode(item, props.depth + 1, String(index))}
								</div>
							))
						: node.entries.map((entry) => (
								<div className="json-fallback__row" key={entry.key}>
									{renderNode(entry.value, props.depth + 1, entry.key)}
								</div>
							))}
					{node.truncated > 0 ? (
						<div className="json-fallback__row json-fallback__trunc">
							… 另有 {node.truncated} 项被省略
						</div>
					) : null}
				</div>
			) : null}
		</span>
	);
}
