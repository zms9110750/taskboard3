/**
 * 折叠组件 —— **胶囊 + 容器矩形**，两块都只吃 props，不认识任何业务。
 *
 * 用户 `2026-11-28` 的裁定：
 * > 「折叠态是要有一个胶囊形状的。我说的没有底色。说的是他作为容器包裹展开的
 * >   隐藏区域的那个矩形。这个矩形在折叠时应该是不存在的。在展开时，这个胶囊
 * >   也应该正好覆盖在这个矩形的顶部。矩形……左右的宽对齐胶囊的宽。」
 *
 * ⇒ 三条硬约束：
 * 1. `FoldPill` 折叠/展开都在，class / 形状 / 样式完全一样，只换 caret；
 * 2. `FoldRect` 在 `open === false` 时 **返回 null**（DOM 里没有这个节点）；
 * 3. 展开时矩形顶边落在胶囊中线上（CSS 用负 margin 实现），
 *    `FoldPill` 与 `FoldRect` 拿**同一个 `width`**（调用方只算一次）。
 *
 * 计数默认只渲染裸数字；量词（「张」）由调用方用 `countSuffix` 传进来，
 * 本组件不决定业务文案。
 *
 * DOM 契约（测试 / 样式依赖，别改）：
 *
 * ```text
 * button.tb3-fold-pill[data-tone][aria-expanded]
 *  ├ span.tb3-fold-pill__caret
 *  ├ span.tb3-fold-pill__name
 *  └ span.tb3-fold-pill__count
 *
 * div.tb3-fold-rect[data-fold-rect]
 *  └ children
 * ```
 */

import type { ReactNode } from 'react';

import {
	foldPillModelOf,
	foldRectModelOf,
	type FoldTone,
} from './fold-pill-model.ts';

export type { FoldTone } from './fold-pill-model.ts';

/** 胶囊属性。 */
export interface FoldPillProps {
	/** 是否展开（只影响 caret / aria；不改 class / 样式）。 */
	readonly open: boolean;
	/** 标题（不认业务含义）。 */
	readonly label: string;
	/** 计数（只渲染数字，不认「张 / 个 / 项」这类业务量词）。 */
	readonly count: number;
	/**
	 * 计数的后缀 / 量词（如 `' 张'`）。省略 = 不附加任何业务文案；
	 * 由调用方决定，组件仍然不认识「卡 / 组 / 子任务」。
	 */
	readonly countSuffix?: string;
	/** 语义色档位；省略 = `plain`。 */
	readonly tone?: FoldTone;
	/** 点击开合。 */
	readonly onToggle: () => void;
	/**
	 * 宽度。**必须与 `FoldRect` 的宽度是同一个值**（调用方只算一次）。
	 * 省略 = 由 CSS / 父容器决定。
	 */
	readonly width?: number;
}

/**
 * 折叠胶囊。
 *
 * @param props 见 `FoldPillProps`
 */
export function FoldPill(props: FoldPillProps): ReactNode {
	const model = foldPillModelOf(props.open, props.tone);
	return (
		<button
			type="button"
			className={model.className}
			data-fold-pill={props.open ? 'open' : 'closed'}
			data-tone={model.tone}
			aria-expanded={model.ariaExpanded}
			title={props.open ? '收起' : '展开'}
			onClick={props.onToggle}
			{...(props.width === undefined ? {} : { style: { width: props.width } })}
		>
			<span className="tb3-fold-pill__caret" aria-hidden="true">
				{model.caret}
			</span>
			<span className="tb3-fold-pill__name">{props.label}</span>
			<span className="tb3-fold-pill__count">
				{String(props.count)}
				{props.countSuffix ?? ''}
			</span>
		</button>
	);
}

/** 容器矩形属性。 */
export interface FoldRectProps {
	/** 是否展开。`false` ⇒ **返回 null，DOM 里没有这个矩形**。 */
	readonly open: boolean;
	/** 宽度；与胶囊同源。 */
	readonly width?: number;
	/** 展开区的内容（通常是成员卡）。 */
	readonly children?: ReactNode;
}

/**
 * 展开区的容器矩形（虚线块）。
 *
 * @param props 见 `FoldRectProps`
 */
export function FoldRect(props: FoldRectProps): ReactNode {
	const model = foldRectModelOf(props.open);
	if (model === null) return null;
	return (
		<div
			className={model.className}
			data-fold-rect=""
			{...(props.width === undefined ? {} : { style: { width: props.width } })}
		>
			{props.children}
		</div>
	);
}
