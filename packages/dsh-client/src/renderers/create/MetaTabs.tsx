/**
 * 「关系 | 高级设置」= **两个标签按钮 + 下面一块共用折叠区**（用户选定的 ⑤）。
 *
 * ## 用户裁定（`2026-11-19`）
 *
 * > 「用 245。也就是说跟旧版一样。」
 *
 * ⇒ 排法 ②（模板/父任务分行）+ 模板选择 ④（三级联选弹层）+ 折叠区 **⑤**（本文件）。
 *
 * 旧版口径（`2026-11-18` 用户原话）：
 * > 「关系和高级设置是两个按钮。点开了，在下面会有额外内容。
 * >  也就是说他们的内容是折叠的而且**共用展示**的。」
 *
 * ⇒ 两个按钮**互斥**、同一时间只有一块折叠区、再点已开的那个收起。
 *
 * ## 三值 `active` 而不是两个 boolean
 *
 * 判决在 `src/pure/create-meta.ts` 的 `nextTab()`（34 条单测）。两个 boolean 能表示
 * 「两个都开」——**能表示非法状态的类型迟早会表示出非法状态**。
 *
 * ## 和展厅变体 ⑥（手风琴）的差别只有外壳
 *
 * 面板内容两版都是 `MetaPanelContent.tsx` 那两个组件。用户没选手风琴 ⇒
 * 那个实现留在 `dev/components/create/MetaAccordion.tsx` 作历史参考，**不进 src**。
 */

import { useState, type ReactNode } from 'react';

import {
	isAdvOpen,
	isRelOpen,
	nextTab,
	type MetaTab,
} from '../../pure/create-meta.ts';
import type { RelationDraft } from '../../pure/create-types.ts';
import { relationCountOf } from '../../pure/create-validate.ts';
import type { PickableCard } from './CardPicker.tsx';
import { AdvancedPanel, RelationPanel } from './MetaPanelContent.tsx';

/** 组件属性。 */
export interface MetaTabsProps {
	/** 关系草稿（受控：父层持有，提交时一起送）。 */
	readonly relations: readonly RelationDraft[];
	readonly onRelationsChange: (rows: readonly RelationDraft[]) => void;
	/** 关系目标候选卡。 */
	readonly cards: readonly PickableCard[];
}

/**
 * 关系 / 高级设置 —— 按钮 + 共用折叠区。
 *
 * @param props 见 `MetaTabsProps`
 */
export function MetaTabs(props: MetaTabsProps): ReactNode {
	/** `null` = 都收起。**一个状态保证互斥 + 可收起。** */
	const [active, setActive] = useState<MetaTab | null>(null);

	const count = relationCountOf(props.relations);

	return (
		<div className="tb3cc-meta" data-meta-tabs="">
			<div className="tb3cc-meta__tabs">
				<button
					type="button"
					className={`tb3cc-meta__tab${isRelOpen(active) ? ' is-on' : ''}`}
					aria-pressed={isRelOpen(active)}
					data-meta-tab="rel"
					onClick={() => {
						setActive((current) => nextTab(current, 'rel'));
					}}
				>
					关系 <span className="tb3cc-meta__count" data-rel-count="">{count}</span>
				</button>
				<button
					type="button"
					className={`tb3cc-meta__tab${isAdvOpen(active) ? ' is-on' : ''}`}
					aria-pressed={isAdvOpen(active)}
					data-meta-tab="adv"
					onClick={() => {
						setActive((current) => nextTab(current, 'adv'));
					}}
				>
					高级设置
				</button>
			</div>

			{/* 折叠区 —— 两个面板共用这一块位置，同一时间只可能有一个存在 */}
			{isRelOpen(active) ? (
				<RelationPanel
					relations={props.relations}
					onRelationsChange={props.onRelationsChange}
					cards={props.cards}
				/>
			) : null}
			{isAdvOpen(active) ? <AdvancedPanel /> : null}
		</div>
	);
}
