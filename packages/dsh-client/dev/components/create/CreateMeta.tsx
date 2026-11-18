/**
 * 左栏的「元数据」块：**父任务 + 两个折叠标签**。
 *
 * ## 用户原话（`2026-11-18`，本次裁定）
 *
 * > 「新建任务卡肯定是左右分栏的。重点是左边他摆什么东西。
 * >  原来是这样的
 * >  标题：
 * >  模板：
 * >  父任务：
 * >  关系|高级设置
 * >  关系和高级设置是两个按钮。点开了，在下面会有额外内容。
 * >  也就是说他们的内容是折叠的而且共用展示的。」
 *
 * ⚠ **顺序是竖的**：标题 → 模板 → 父任务 → [关系|高级设置] → 折叠区。
 *   `ux-review/create-modal-height.png` 的旧建议是「模板 / 父任务」横排一行，
 *   **那个已作废**（那是 2026-11-10 的建议，用户刚说了竖着）。
 *
 * 但本文件只管**父任务及以下**那一段 —— 标题和模板在 `CreateLayoutFinal` 里，
 * 因为它们的样子和别的布局共用。
 *
 * ## 三值 `active` 而不是两个 boolean
 *
 * 判决在 `dev/pure/create-meta.ts` 的 `nextTab()`（有 34 条单测）。
 * 那里能表达「两个都开」这种非法状态吗？**不能** —— 类型就只有三个值。
 */

import { useState, type ReactNode } from 'react';

import {
	RELATION_KINDS,
	isAdvOpen,
	isRelOpen,
	linksOf,
	nextTab,
	relationCountOf,
	removeRelationAt,
	setRelationKind,
	setRelationTarget,
	type MetaTab,
	type RelationDraft,
} from '../../pure/create-meta.ts';
import { CardPicker, type PickableCard } from './CardPicker.tsx';

/** 组件属性。 */
export interface CreateMetaProps {
	/** 父任务卡 id（空串 = 顶层）。 */
	readonly parentId: string;
	readonly onParentChange: (cardId: string) => void;
	/** 关系草稿（受控，父层持有）。 */
	readonly relations: readonly RelationDraft[];
	readonly onRelationsChange: (rows: readonly RelationDraft[]) => void;
	/** 候选卡（当前空间的全部卡，本组件自己过滤）。 */
	readonly cards: readonly PickableCard[];
}

/**
 * 左栏元数据块。
 *
 * @param props 见 `CreateMetaProps`
 */
export function CreateMeta(props: CreateMetaProps): ReactNode {
	/** 当前展开的标签。`null` = 都收起。**一个状态保证互斥 + 可收起。** */
	const [active, setActive] = useState<MetaTab | null>(null);

	const count = relationCountOf(props.relations);
	const links = linksOf(props.relations);

	const addRow = (): void => {
		props.onRelationsChange([...props.relations, { kind: RELATION_KINDS[0]?.value ?? 'dependsOn', to: '' }]);
	};

	return (
		<div className="meta">
			{/* ① 父任务 —— combobox，不是 select */}
			<div className="meta__field">
				<label className="a__label">父任务</label>
				<CardPicker
					value={props.parentId}
					cards={props.cards}
					placeholder="（无，顶层）"
					allowEmpty
					onChange={props.onParentChange}
				/>
			</div>

			{/* ② 两个标签按钮 —— 互斥，再点已开的收起 */}
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

			{/* ③ 折叠区 —— 共用同一块位置，同一时间只可能显示一个 */}
			{isRelOpen(active) ? (
				<div className="meta__panel">
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

					<button type="button" className="meta__rel-add" onClick={addRow}>
						＋ 添加关联
					</button>

					{/* 提交时要送出去的清单（也用来验证「计数 == 实际条数」） */}
					{links.length === 0 ? null : (
						<div className="meta__rel-summary" data-link-count={String(links.length)}>
							将提交 {links.length} 条关联
						</div>
					)}
				</div>
			) : null}

			{isAdvOpen(active) ? (
				<div className="meta__panel meta__panel--empty">
					<div className="meta__empty">暂无设置项</div>
					<div className="meta__empty-hint">原：任务权限 / 额外子工作区 —— 本期后端未实现</div>
				</div>
			) : null}
		</div>
	);
}
