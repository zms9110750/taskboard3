/**
 * 变体 ⑥：「关系 / 高级设置」= **手风琴**。
 *
 * ## 为什么值得多做一个
 *
 * ⑤ 的「两个按钮 + 下面一块折叠区」有个副作用：**按钮和内容之间是断开的** ——
 * 内容出现在按钮下方一整块，眼睛要多跳一次才能确认「这块属于刚点的那个按钮」。
 * 手风琴把内容**贴在标题下面**，从属关系是位置本身表达的。
 *
 * ## 仍然是互斥的（**不是**独立折叠）
 *
 * 用户 `2026-11-18` 说的是「共用展示」。真要允许同时展开两块的话，
 * 左栏窄、两块一开就把父任务顶出视野 —— 那不叫更多信息，叫更难用。
 *
 * ⇒ 状态还是 `MetaTab | null`，判决还是 `nextTab()`（`dev/pure/create-meta.ts`）。
 *   和 ⑤ 的差别**只在外壳**：内容跟在自己的标题下面。
 *
 * ## `▾ / ▸` 的方向
 *
 * 展开用 `▾`（朝下 = 内容在下面露出来了），收起用 `▸`。
 * 标题在展开时**变成** `▾ 关系 N` —— 不再额外画一个「关系」小标题
 * （重复一遍只会让窄栏更挤）。
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
export interface MetaAccordionProps {
	readonly relations: readonly RelationDraft[];
	readonly onRelationsChange: (rows: readonly RelationDraft[]) => void;
	readonly cards: readonly PickableCard[];
	/** 初始展开哪个（展厅截图用；默认都收起）。 */
	readonly initial?: MetaTab | null;
}

/**
 * 关系 / 高级设置 —— 手风琴。
 *
 * @param props 见 `MetaAccordionProps`
 */
export function MetaAccordion(props: MetaAccordionProps): ReactNode {
	const [active, setActive] = useState<MetaTab | null>(props.initial ?? null);
	const count = relationCountOf(props.relations);

	const relOn = isRelOpen(active);
	const advOn = isAdvOpen(active);

	return (
		<div className="acc" data-variant="meta-accordion">
			{/* ── 段 1：关系 ── */}
			<section className={`acc__sec${relOn ? ' is-open' : ''}`}>
				<button
					type="button"
					className="acc__head"
					aria-expanded={relOn}
					data-acc-head="rel"
					onClick={() => {
						setActive((current) => nextTab(current, 'rel'));
					}}
				>
					<span className="acc__caret">{relOn ? '▾' : '▸'}</span>
					<span className="acc__title">关系</span>
					<span className="meta__count" data-acc-count="rel">
						{count}
					</span>
				</button>
				{relOn ? (
					<div className="acc__body">
						<RelationPanel
							relations={props.relations}
							onRelationsChange={props.onRelationsChange}
							cards={props.cards}
						/>
					</div>
				) : null}
			</section>

			{/* ── 段 2：高级设置 ── */}
			<section className={`acc__sec${advOn ? ' is-open' : ''}`}>
				<button
					type="button"
					className="acc__head"
					aria-expanded={advOn}
					data-acc-head="adv"
					onClick={() => {
						setActive((current) => nextTab(current, 'adv'));
					}}
				>
					<span className="acc__caret">{advOn ? '▾' : '▸'}</span>
					<span className="acc__title">高级设置</span>
				</button>
				{advOn ? (
					<div className="acc__body">
						<AdvancedPanel />
					</div>
				) : null}
			</section>
		</div>
	);
}
