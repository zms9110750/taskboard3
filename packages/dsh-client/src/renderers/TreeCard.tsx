/**
 * 科技树的一张卡 —— **独立组件**（从 `TechTree.tsx` 的内部函数 `CardButton` 抽出来）。
 *
 * ## ⚠ 名字撞车不是笔误
 *
 * `pure/tree-layout.ts` 也有一个 `TreeCard` 类型，那是**布局输入**
 * （`{ id, parent, title }`，只要三样东西）。本文件是**渲染组件**，收整张 `Card`。
 * 两者不互相 import：布局不认识 React，组件也不该认识布局的内部类型。
 *
 * ## 位置 / 尺寸不是本组件算的
 *
 * 卡片是 `position:absolute`，`left / top / width / height` 由 `TechTree` 用
 * `tree-layout.ts` 的 `layoutTree()` + `boxOf()` 算好后**作为 `style` 传进来**。
 * 本组件**不做任何布局计算** —— 这样单独预览它时给一组固定 `style` 就能画。
 *
 * ## ⚠ DOM / 类名是**契约**，别改
 *
 * ```
 * button.tb3t-card[.is-draft][.is-selected]
 *  ├ span.tb3t-card__top
 *  │   ├ span.card-id.card-id--{tone}
 *  │   ├ span.tb3t-card__warn[data-card-warning]     ← 只有布局警告时才有
 *  │   ├ span.badge.badge--{tone}                     ← 类别（kindLabel 为空时不画）
 *  │   ├ span.badge.badge--domain                     ← 领域
 *  │   ├ span.badge.badge--template                   ← 模板（templateLabel 为空时不画）
 *  │   ├ span.tb3t-card__spacer
 *  │   └ StatusButton(.status-button.is-static)      ← 状态按钮（#63，圆点 + 中文名 + 边框）
 *  └ span.tb3t-card__title
 * ```
 *
 * 这些类名被 `pure/techtree-css.ts` 的规则和 `dev/preview/techtree/ssr.tsx` 的断言
 * 依赖。改类名 / 改层级 = 样式静默失效 + 断言变红。
 *
 * ## `templateLabel` 为什么可以缺
 *
 * 列表行（`CardRow`）的三个 label 是用户 `2026-11-17` 定的：类别 / 领域 / **模板名**。
 * 科技树的设计图（`view-1-tech-tree.svg`）卡片上只画了类别 + 领域，所以：
 *
 * - 调用方**不传** `templateLabel`（传空串）⇒ 只画两个 badge，DOM 和抽取前**逐字节一致**；
 * - 调用方传了（比如预览、或将来产品要补）⇒ 多画一个 `badge--template`。
 *
 * ⚠ 这个「空串不画」的分支是**有意的**：它让「抽取组件」不改变产品现有外观。
 */

import type { CSSProperties, ReactNode } from 'react';

import { isDraftStatus, isEndedStatus, kindTone, unreadSides } from '../pure/card-view.ts';
import type { TreeLayoutWarning } from '../pure/tree-layout.ts';
import type { Card } from '../types.ts';
import { StatusButton } from './StatusButton.tsx';
import { taskStateOf } from './status-button-model.ts';

/**
 * 布局警告（孤儿 / 环）。
 *
 * **唯一来源**是 `tree-layout.ts` 的 `TreeLayoutWarning`（`layoutTree()` 的产物），
 * 这里只换个短名字 —— 不重新定义形状，否则两处会漂移。
 */
export type TreeWarning = TreeLayoutWarning;

/** 组件属性。 */
export interface TreeCardProps {
	/** 整张卡（渲染要 id / 标题 / 状态 / 模板）。 */
	readonly card: Card;
	/** 类别中文名。由调用方从模板清单查 —— 本组件不持有词表。 */
	readonly kindLabel: string;
	/**
	 * 模板显示名（`displayName`）。
	 *
	 * 空串 = **不画这个 badge**（科技树设计图卡片上只有类别 + 领域）。
	 */
	readonly templateLabel: string;
	/** 是否是当前选中的那张。 */
	readonly selected: boolean;
	/** 布局警告（孤儿 / 环）；没有就是 `undefined`（不画 ▲）。 */
	readonly warning?: TreeWarning | undefined;
	/** 点这张卡。 */
	readonly onSelect: (cardId: string) => void;
	/**
	 * 位置 + 尺寸。**必须由布局算好后传进来**（本组件不碰 `tree-layout.ts`）。
	 *
	 * 形态：`{ left, top, width, height }`（数字，React 序列化成 px）。
	 */
	readonly style: CSSProperties;
	/**
	 * 逻辑层号 → `data-layer`（诊断 / 断言用）。省略时渲染空值。
	 *
	 * 是「可选附加」，不在任务书给的 7 个 props 里，但现有 DOM 一直带这个属性，
	 * 抽组件时不能丢。
	 */
	readonly layer?: number | undefined;
	/**
	 * hover 变化（进入传 id、离开传 `null`）。
	 *
	 * ⚠ `TechTree` 的 hover 是**受控 prop**：卡片只负责把事件报出去，不自己存状态。
	 *   省略 = 这张卡不响应 hover（仍可点）。
	 */
	readonly onHoverChange?: ((cardId: string | null) => void) | undefined;
}

/**
 * 科技树的一张卡。
 *
 * @param props 见 `TreeCardProps`
 */
export function TreeCard(props: TreeCardProps): ReactNode {
	const card = props.card;
	const warning = props.warning;
	const tone = kindTone(card.template.kind);

	/* 类名顺序是契约的一部分：`tb3t-card` → `is-draft` → `is-selected` → 未读两侧。 */
	const sides = unreadSides(card.unread);
	const className = [
		'tb3t-card',
		isDraftStatus(card.status) ? 'is-draft' : '',
		props.selected ? 'is-selected' : '',
		/*
		 * 用户 2026-11-21：「用户未读的在卡左侧加边框。AI 未读的在卡右侧加边框。」
		 * ⇒ 树卡跟列表卡用**同一套**两侧判决（`unreadSides`），不要各写一份。
		 */
		sides.left ? 'is-unread-user' : '',
		sides.right ? 'is-unread-ai' : '',
	]
		.filter((one) => one !== '')
		.join(' ');

	return (
		<button
			type="button"
			className={className}
			data-card-id={card.id}
			data-layer={props.layer === undefined ? '' : String(props.layer)}
			data-selected={props.selected ? 'true' : 'false'}
			data-warning={warning === undefined ? '' : warning.kind}
			style={props.style}
			title={`${card.id} ${card.title}${warning === undefined ? '' : `\n▲ ${warning.detail}`}`}
			onClick={() => {
				props.onSelect(card.id);
			}}
			onMouseEnter={() => {
				props.onHoverChange?.(card.id);
			}}
			onMouseLeave={() => {
				props.onHoverChange?.(null);
			}}
		>
			<span className="tb3t-card__top">
				<span className={`card-id card-id--${tone}`}>{card.id}</span>
				{warning === undefined ? null : (
					<span className="tb3t-card__warn" data-card-warning={warning.kind} title={warning.detail}>
						▲
					</span>
				)}
				{/*
				 * 用户 2026-11-20：「label 只显示模板的 label」——
				 * 类别 / 领域两个 badge 不再画。类别信息已经在编号颜色里（card-id--{kindTone}）。
				 */}
				{props.templateLabel === '' ? null : (
					<span className="badge badge--template" title={props.templateLabel}>
						{props.templateLabel}
					</span>
				)}
				<span className="tb3t-card__spacer" />
				{/*
				 * 状态：独立组件（#63）。树卡根节点也是 `<button>` ⇒ 里面不能再嵌按钮，
				 * 所以是只读态；`disabledReason` 按是否收尾（冻结）给不同说法。
				 */}
				<StatusButton
					status={taskStateOf(card.status)}
					size="sm"
					interactive={false}
					disabledReason={
						isEndedStatus(card.status)
							? '卡已收尾（冻结），状态不能再改'
							: '在详情里改状态'
					}
				/>
			</span>
			<span className="tb3t-card__title">{card.title}</span>
		</button>
	);
}
