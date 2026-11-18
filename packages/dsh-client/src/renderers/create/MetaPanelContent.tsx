/**
 * 「关系 / 高级设置」两个面板的**内容** —— 外壳换、内容不换。
 *
 * ## 为什么内容和外壳分开
 *
 * 左栏这块有两种外壳（展厅里用户对比过 ⑤ / ⑥）：
 *
 * | 外壳 | 样子 |
 * |---|---|
 * | 按钮 + 共用折叠区（**用户选定的 = ⑤**）| 两个标签按钮，内容在下方一块共用区域 |
 * | 手风琴（变体 ⑥，未采用，留在 `dev/`）| 内容贴在自己标题下面 |
 *
 * ⇒ 里面装的东西完全一样，只有外壳不同。内容写两份的话，改一处「关联行少删一个按钮」
 *   就会变成两个变体之间的假差异 —— 用户一对比就问「为什么这个能删那个不能」。
 *
 * ## 计数规则不在这里
 *
 * 「关系 N」的 N 是**已选目标的行数**（空行不算）。判决在
 * `src/pure/create-validate.ts` 的 `relationCountOf()`（和提交清单用同一个判据，有单测），
 * **不在组件里重算**。
 *
 * ## 关系类型词表也不在这里
 *
 * 在 `src/pure/create-meta.ts` 的 `RELATION_KINDS`（从协议的 `LINK_KINDS` 派生，
 * 排除不许手写的「取代」）。
 */

import type { ReactNode } from 'react';

import {
	RELATION_KINDS,
	addRelation,
	removeRelationAt,
	setRelationKind,
	setRelationTarget,
} from '../../pure/create-meta.ts';
import type { RelationDraft } from '../../pure/create-types.ts';
import { CardPicker, type PickableCard } from './CardPicker.tsx';

/* ══════════════════════════════════════════════════════════
   关系面板
   ══════════════════════════════════════════════════════════ */

/** 组件属性。 */
export interface RelationPanelProps {
	readonly relations: readonly RelationDraft[];
	readonly onRelationsChange: (rows: readonly RelationDraft[]) => void;
	/** 关系目标候选卡。 */
	readonly cards: readonly PickableCard[];
}

/**
 * 关系面板内容（提示 + 行列表 + 添加）。
 *
 * ⚠ **不显示「将提交 N 条」** —— 那是展厅里为了验证计数写的一句调试文案。
 *   产品里「关系 N」这个数字已经在标签按钮上了，再写一遍是重复。
 *
 * @param props 见 `RelationPanelProps`
 */
export function RelationPanel(props: RelationPanelProps): ReactNode {
	return (
		<div className="tb3cc-meta__panel" data-panel="rel">
			<div className="tb3cc-meta__hint">
				箭头从先决指向依赖方。「依赖」= 它不做完，这件事不能开始
			</div>

			{props.relations.length === 0 ? (
				<div className="tb3cc-meta__empty">还没有关联。</div>
			) : (
				<div className="tb3cc-meta__rel-list">
					{props.relations.map((one, index) => (
						<div className="tb3cc-meta__rel-row" key={`rel-${String(index)}`}>
							<select
								className="tb3cc-meta__rel-kind"
								value={one.label}
								aria-label="关系类型"
								onChange={(event) => {
									props.onRelationsChange(
										setRelationKind(props.relations, index, event.target.value),
									);
								}}
							>
								{RELATION_KINDS.map((kind) => (
									<option key={kind.id} value={kind.id}>
										{kind.label}
									</option>
								))}
							</select>
							<CardPicker
								value={one.to}
								cards={props.cards}
								placeholder="选择目标卡…"
								name={`rel-${String(index)}`}
								onChange={(cardId) => {
									props.onRelationsChange(setRelationTarget(props.relations, index, cardId));
								}}
							/>
							<button
								type="button"
								className="tb3cc-meta__rel-del"
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
				className="tb3cc-meta__rel-add"
				onClick={() => {
					props.onRelationsChange(addRelation(props.relations));
				}}
			>
				＋ 添加关联
			</button>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   高级设置
   ══════════════════════════════════════════════════════════ */

/**
 * 高级设置面板内容。
 *
 * 现在是空的 —— 旧版有「任务权限 / 额外子工作区」，本期后端未实现。
 * **明说没有**，不装作能点（旧版 `meta-panel.ts` 的口径：「里面什么也没有」）。
 */
export function AdvancedPanel(): ReactNode {
	return (
		<div className="tb3cc-meta__panel tb3cc-meta__panel--empty" data-panel="adv">
			<div className="tb3cc-meta__empty">暂无设置项</div>
			<div className="tb3cc-meta__empty-hint">原：任务权限 / 额外子工作区 —— 本期后端未实现</div>
		</div>
	);
}
