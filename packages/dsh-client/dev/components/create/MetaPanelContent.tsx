/**
 * 「关系 / 高级设置」两个面板的**内容** —— ⑤ 和 ⑥ 共用。
 *
 * ## 为什么抽出来
 *
 * 用户要对比的是**这两个面板怎么被藏起来**：
 *
 * | 变体 | 外壳 |
 * |---|---|
 * | ⑤ `MetaTabs` | 两个标签按钮 + **下面一块共用折叠区**（旧版做法）|
 * | ⑥ `MetaAccordion` | 两个手风琴段，内容**贴在各自标题下面** |
 *
 * ⇒ 里面装的东西完全一样，只有外壳不同。内容写两份的话，改一处「关联行少删一个按钮」
 *   就会变成两个变体之间的假差异 —— 用户一对比就问「为什么这个能删那个不能」。
 *
 * ## 计数规则在 `dev/pure/create-meta.ts`
 *
 * 「关系 N」的 N 是**已选目标的行数**（空行不算），提交清单用同一个判断。
 * 那条规则有 34 条单测，**不在组件里重算**。
 */

import type { ReactNode } from 'react';

import {
	RELATION_KINDS,
	linksOf,
	removeRelationAt,
	setRelationKind,
	setRelationTarget,
	type RelationDraft,
} from '../../pure/create-meta.ts';
import { CardPicker, type PickableCard } from './CardPicker.tsx';

/* ══════════════════════════════════════════════════════════
   关系
   ══════════════════════════════════════════════════════════ */

/** 组件属性。 */
export interface RelationPanelProps {
	readonly relations: readonly RelationDraft[];
	readonly onRelationsChange: (rows: readonly RelationDraft[]) => void;
	readonly cards: readonly PickableCard[];
}

/**
 * 关系面板内容（提示 + 行列表 + 添加 + 提交摘要）。
 *
 * @param props 见 `RelationPanelProps`
 */
export function RelationPanel(props: RelationPanelProps): ReactNode {
	const links = linksOf(props.relations);

	return (
		<div className="meta__panel" data-panel="rel">
			<div className="meta__hint">
				箭头从先决指向依赖方。「依赖」= 它不做完，这件事不能开始
			</div>

			{props.relations.length === 0 ? (
				<div className="meta__empty">还没有关联。</div>
			) : (
				<div className="meta__rel-list">
					{props.relations.map((one, index) => (
						<div className="meta__rel-row" key={`rel-${String(index)}`}>
							<select
								className="meta__rel-kind"
								value={one.kind}
								onChange={(event) => {
									props.onRelationsChange(setRelationKind(props.relations, index, event.target.value));
								}}
							>
								{RELATION_KINDS.map((kind) => (
									<option key={kind.value} value={kind.value}>
										{kind.label}
									</option>
								))}
							</select>
							<CardPicker
								value={one.to}
								cards={props.cards}
								placeholder="选择目标卡…"
								onChange={(cardId) => {
									props.onRelationsChange(setRelationTarget(props.relations, index, cardId));
								}}
							/>
							<button
								type="button"
								className="meta__rel-del"
								title="删除这条关联"
								onClick={() => {
									props.onRelationsChange(removeRelationAt(props.relations, index));
								}}
							>
								✕
							</button>
						</div>
					))}
				</div>
			)}

			<button
				type="button"
				className="meta__rel-add"
				onClick={() => {
					const first = RELATION_KINDS[0];
					props.onRelationsChange([
						...props.relations,
						{ kind: first?.value ?? 'dependsOn', to: '' },
					]);
				}}
			>
				＋ 添加关联
			</button>

			{links.length === 0 ? null : (
				<div className="meta__rel-summary" data-link-count={String(links.length)}>
					将提交 {links.length} 条关联
				</div>
			)}
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   高级设置
   ══════════════════════════════════════════════════════════ */

/**
 * 高级设置面板内容。
 *
 * 现在是空的 —— 原文（旧版）有「任务权限 / 额外子工作区」，本期后端未实现。
 * **明说没有**，不装作能点。
 */
export function AdvancedPanel(): ReactNode {
	return (
		<div className="meta__panel meta__panel--empty" data-panel="adv">
			<div className="meta__empty">暂无设置项</div>
			<div className="meta__empty-hint">原：任务权限 / 额外子工作区 —— 本期后端未实现</div>
		</div>
	);
}
