/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * 变体 ⑤：「关系 / 高级设置」= **两个标签按钮 + 下面一块共用折叠区**（旧版做法）。
 *
 * ## 用户原话（`2026-11-18`）
 *
 * > 「关系和高级设置是两个按钮。点开了，在下面会有额外内容。
 * >  也就是说他们的内容是折叠的而且**共用展示**的。」
 *
 * ⇒ 两个按钮**互斥**、同一时间只有一块折叠区、再点已开的那个收起。
 *
 * ## 三值 `active` 而不是两个 boolean
 *
 * 判决在 `dev/pure/create-meta.ts` 的 `nextTab()`（34 条单测）。
 * 两个 boolean 能表示「两个都开」—— **能表示非法状态的类型迟早会表示出非法状态**。
 *
 * ## 和 ⑥ 的差别只有外壳
 *
 * 面板内容两版都是 `MetaPanelContent.tsx` 那两个组件。这里折叠区在**按钮下面**；
 * ⑥ 里内容**贴在各自标题下面**（手风琴）。
 */

import { useState, type ReactNode } from 'react';

import {
	isAdvOpen,
	isRelOpen,
	nextTab,
	relationCountOf,
	type MetaTab,
	type RelationDraft,
} from '../../pure/create-meta.ts';
import type { PickableCard } from './CardPicker.tsx';
import { AdvancedPanel, RelationPanel } from './MetaPanelContent.tsx';

/** 组件属性。 */
export interface MetaTabsProps {
	readonly relations: readonly RelationDraft[];
	readonly onRelationsChange: (rows: readonly RelationDraft[]) => void;
	readonly cards: readonly PickableCard[];
	/** 初始展开哪个（展厅截图用；默认都收起）。 */
	readonly initial?: MetaTab | null;
}

/**
 * 关系 / 高级设置 —— 按钮 + 共用折叠区。
 *
 * @param props 见 `MetaTabsProps`
 */
export function MetaTabs(props: MetaTabsProps): ReactNode {
	/** `null` = 都收起。**一个状态保证互斥 + 可收起。** */
	const [active, setActive] = useState<MetaTab | null>(props.initial ?? null);

	const count = relationCountOf(props.relations);

	return (
		<div className="meta" data-variant="meta-tabs">
			<div className="meta__tabs">
				<button
					type="button"
					className={`meta__tab${isRelOpen(active) ? ' is-on' : ''}`}
					aria-pressed={isRelOpen(active)}
					onClick={() => {
						setActive((current) => nextTab(current, 'rel'));
					}}
				>
					关系 <span className="meta__count">{count}</span>
				</button>
				<button
					type="button"
					className={`meta__tab${isAdvOpen(active) ? ' is-on' : ''}`}
					aria-pressed={isAdvOpen(active)}
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
