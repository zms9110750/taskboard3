/**
 * 详情**头部** —— 标题行 / meta 行 / 动作行 / 墓碑横幅。
 *
 * ## 三行是**三个兄弟 div**，不是一个 flex-wrap 容器
 *
 * 用户 `2026-11-15`：
 * > 「标题独占一行」
 *
 * 旧版 `header.js:69-108` 里标题已经是独立的一行（`detail__head-row`），
 * 但**关系按钮藏在第三行的右端小按钮里**（用户第 2 条：「太隐蔽」）。
 * ⇒ 本组件的结构：
 *
 * ```
 * detail-head
 *  ├ detail-title-row    h2 标题 ……………… ⧉ ×   ← 只有标题 + 图标按钮
 *  ├ detail-meta-row     固定宽度状态列 │ 编号 │ 类别 领域 模板
 *  ├ detail-actions      关系 N（primary）  + 派生子任务
 *  └ detail-banner       墓碑说明（有才显示）
 * ```
 *
 * 标题和 meta **不在同一个父容器的同一行**里 —— 这是结构保证，
 * 不是「CSS 让它看起来像两行」。CDP 断言会量两者的矩形是否纵向重叠。
 *
 * ## ⚠ 状态在最左，是**固定宽度列**（用户 `2026-11-18`）
 *
 * > 「状态需要放在最左边。可交互的东西被 label 顺位放在右边是不合理的。
 * >  如果 label 太长，那么状态按钮的位置甚至会变化。所以他至少放在 label 的左边。
 * >  但我希望他放在编号的左边。」
 *
 * 根因是**「label 太长，状态按钮的位置会变化」**。所以光把它挪到 label 左边
 * 不够 —— 它必须在**不受 label 宽度影响**的容器里。
 *
 * ⇒ `.detail-status-col` 是 `flex: 0 0 92px`（固定宽度），是 meta 行的**第一个**
 *   子元素。它的 left 只由容器的 padding 决定，和后面几个 label 多宽完全无关。
 *   两条 CDP 断言钉住：① status.left < id.left ② 超长 label 下 status.left 不变。
 *
 * ⚠ 结构上还有一道保险：状态是 `head.status`（独立字段），**不在 `head.meta` 数组里**
 *   ⇒ 本文件里只有一个地方能画它，想把它混进 label 行得先改类型。
 *
 * ## 只 map `pure/card-detail.ts` 的表
 *
 * 这里没有「meta 该显示哪几格」「哪个按钮重要」的判断 ——
 * 那些在 `headOf()` / `actionsOf()`，有 55 条单测钉着。
 * 组件只做两件机械的事：
 *
 * 1. `DetailMetaItem.kind` → 一个 DOM 形状（联合类型，`switch` 穷尽）；
 * 2. `DetailAction.kind` → 一个回调。
 */

import type { ReactNode } from 'react';

import type { DetailAction, DetailHeadView, DetailMetaItem } from '../pure/card-detail.ts';
import { StatusCell } from './StatusCell.tsx';

/** 组件属性。 */
export interface DetailHeadProps {
	/** `headOf()` 的产物 —— 全部显示决定。 */
	readonly head: DetailHeadView;
	/** 点「关系 N」。 */
	readonly onAddRelation: () => void;
	/** 点「+ 派生子任务」。 */
	readonly onDerive: () => void;
	/** 点「×」；`undefined` = 不显示这个按钮。 */
	readonly onClose: (() => void) | undefined;
	/** 点「⧉」（放大）；`undefined` = 不显示这个按钮。 */
	readonly onExpand: (() => void) | undefined;
}

/**
 * 详情头部。
 *
 * ⚠ `onClose` / `onExpand` 的类型是 `(() => void) | undefined` 而**不是** `?: () => void`
 *   —— `exactOptionalPropertyTypes: true` 下，往可选属性上显式传一个「可能 undefined」
 *   的值会报错（`StatusCell` 的 `size={undefined}` 就是被这条抓住的）。
 *   写成「必选但可为 undefined」就不用条件展开，调用点也不会传错。
 *
 * @param props 见 `DetailHeadProps`
 */
export function DetailHead(props: DetailHeadProps): ReactNode {
	const head = props.head;

	/** `DetailAction.kind` → 回调。**唯一**的机械映射（没有第二个判据）。 */
	const runAction = (action: DetailAction): void => {
		if (action.disabled) return;
		if (action.kind === 'relations') {
			props.onAddRelation();
			return;
		}
		props.onDerive();
	};

	return (
		<div className="detail-head">
			{/* ① 标题独占一行：这一行里**没有** meta、没有徽章、没有编号 */}
			<div className="detail-title-row">
				<h2 className="detail-title" data-detail-title>
					{head.title}
				</h2>
				<span className="detail-title-row__spacer" />
				{props.onExpand === undefined ? null : (
					<button
						type="button"
						className="icon-btn"
						data-detail-expand
						title="放大详情"
						onClick={props.onExpand}
					>
						⧉
					</button>
				)}
				{props.onClose === undefined ? null : (
					<button
						type="button"
						className="icon-btn"
						data-detail-close
						title="关闭详情"
						onClick={props.onClose}
					>
						×
					</button>
				)}
			</div>

			{/*
			 * ② meta 行：**状态在最左的固定宽度列**，然后是四格。
			 *
			 * ⚠ 状态**不在** `head.meta` 里（它是 `head.status`）——
			 *   这是类型级保证：本文件里只有这一处能画状态。
			 *   `.detail-status-col` 的 `flex: 0 0 92px` 保证它的 left
			 *   不随后面 label 变宽而漂移（用户 `2026-11-18` 的根因）。
			 */}
			<div className="detail-meta" data-detail-meta>
				<span className="detail-status-col" data-meta="status" title="当前状态">
					<StatusCell status={head.status.status} />
				</span>
				{head.meta.map((item) => (
					<MetaItem key={item.kind} item={item} />
				))}
			</div>

			{/* ③ 动作行：关系（primary）+ 派生子任务 */}
			<div className="detail-actions" data-detail-actions>
				{head.actions.map((action) => (
					<button
						key={action.kind}
						type="button"
						className={[
							'ghost-btn',
							'detail-action',
							action.emphasis === 'primary' ? 'is-primary' : '',
						]
							.filter((one) => one !== '')
							.join(' ')}
						data-action-kind={action.kind}
						data-emphasis={action.emphasis}
						disabled={action.disabled}
						title={action.title}
						onClick={() => runAction(action)}
					>
						<span className="detail-action__label">{action.label}</span>
						{action.badge === null ? null : (
							<span className="detail-action__badge">{action.badge}</span>
						)}
					</button>
				))}
			</div>

			{/* ④ 墓碑横幅：`banner` 为 null 时不渲染（pure 判的） */}
			{head.banner === null ? null : (
				<div className="detail-banner" data-detail-banner>
					{head.banner}
				</div>
			)}
		</div>
	);
}

/**
 * 一格 meta。
 *
 * `switch` 是穷尽的 —— `DetailMetaItem` 加一个成员，这里 `tsc` 会报
 * `never` 不可赋值（`noFallthroughCasesInSwitch` + 显式返回类型）。
 *
 * @param props 一格
 */
function MetaItem(props: { readonly item: DetailMetaItem }): ReactNode {
	const item = props.item;

	switch (item.kind) {
		case 'id':
			return (
				<span className={`card-id card-id--${item.tone}`} data-meta="id">
					{item.text}
				</span>
			);
		case 'kind':
			return (
				<span className={`badge badge--${item.tone}`} data-meta="kind">
					{item.text}
				</span>
			);
		case 'domain':
			return (
				<span className="badge badge--domain" data-meta="domain">
					{item.text}
				</span>
			);
		case 'template':
			return (
				<span className="badge badge--template" data-meta="template" title={item.title}>
					{item.text}
				</span>
			);
		default:
			/* 穷尽检查：加成员时下面的断言编译失败。 */
			return exhaustive(item);
	}
}

/** 穷尽检查的落点（`switch` 漏成员时 `item` 不是 `never`）。 */
function exhaustive(item: never): ReactNode {
	throw new Error(`未处理的 meta 种类: ${JSON.stringify(item)}`);
}
