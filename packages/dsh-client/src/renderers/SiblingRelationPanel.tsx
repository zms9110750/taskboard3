/**
 * 兄弟关系区 —— 「同一父下的卡」的点选 + 归组。
 *
 * ## 两处共用（用户 `2026-11-24`）
 *
 * > 「最好的做法是放在卡的关系的那个折叠组件里面。在那里面进行点选。」
 * > 「然后问题就是根的怎么办。没有这个面板」
 * > 「那就加一个列头吧。一个很窄的一个列。可以点击。进去以后只有一个关系区作为详情。」
 *
 * ⇒ 父卡详情的「关系」折叠区里（`parentId = 父卡 id`），和科技树最左窄列点开的
 *   「根卡关系」视图（`parentId = null`）**是同一个组件**，只是父不同。
 *
 * ## 只管 UI 状态
 *
 * 组的增删改全走 `uiStateStore`（SQLite kv，AI 与 MCP 读不到）。
 * 本组件**不发卡数据请求、不改卡、不进 `/api/state`**。
 */

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';

import type { Card } from '../types.ts';
import {
	checkGroupMembers,
	groupLabelOf,
	groupsOfParent,
	nextGroupIdOf,
	ungroupedSiblings,
	type GroupableCard,
} from '../pure/sibling-groups.ts';
import { uiStateStore } from '../ui-state-store.ts';

/** 组件 props。 */
export interface SiblingRelationPanelProps {
	/** 全量卡（算兄弟用）。 */
	readonly cards: readonly Card[];
	/** 父卡 id；`null` = 根卡层。 */
	readonly parentId: string | null;
	/** 标题（省略 ⇒ 「根卡关系」/「子卡关系」）。 */
	readonly title?: string;
	/** 关掉面板（只有根卡视图需要）。 */
	readonly onClose?: () => void;
}

/**
 * 把卡投影成归组需要的最小结构。
 *
 * @param cards 全量卡
 */
function groupableOf(cards: readonly Card[]): readonly GroupableCard[] {
	return cards.map((card) => ({
		id: card.id,
		title: card.title,
		parent: card.relations.parent,
	}));
}

/**
 * 兄弟关系区。
 *
 * @param props 见 `SiblingRelationPanelProps`
 */
export function SiblingRelationPanel(props: SiblingRelationPanelProps): ReactNode {
	const snapshot = useSyncExternalStore(uiStateStore.subscribe, uiStateStore.getSnapshot);
	const [picked, setPicked] = useState<readonly string[]>([]);
	const [error, setError] = useState<string | undefined>(undefined);
	const [renaming, setRenaming] = useState<string | undefined>(undefined);
	const [draftName, setDraftName] = useState('');
	const [addingTo, setAddingTo] = useState<string | undefined>(undefined);

	const cards = useMemo(() => groupableOf(props.cards), [props.cards]);
	const groups = useMemo(
		() => groupsOfParent(cards, snapshot.groups, props.parentId),
		[cards, snapshot.groups, props.parentId],
	);
	const loose = useMemo(
		() => ungroupedSiblings(cards, snapshot.groups, props.parentId),
		[cards, snapshot.groups, props.parentId],
	);

	const folded = useMemo(() => new Set(snapshot.folded), [snapshot.folded]);
	const title = props.title ?? (props.parentId === null ? '根卡关系' : '子卡关系');

	const togglePicked = (cardId: string): void => {
		setError(undefined);
		setPicked((current) =>
			current.includes(cardId)
				? current.filter((id) => id !== cardId)
				: [...current, cardId],
		);
	};

	const createGroup = (): void => {
		const check = checkGroupMembers(cards, picked);
		if (!check.ok) {
			setError(check.message);
			return;
		}
		const group = { id: nextGroupIdOf(snapshot.groups), memberIds: picked };
		uiStateStore.addGroup(group);
		/* 新组默认折叠（用户：「组总是折叠的。需要打开」） */
		uiStateStore.setFolded(group.id, true);
		setPicked([]);
		setError(undefined);
	};

	const addToExisting = (groupId: string): void => {
		const check = checkGroupMembers(cards, picked);
		if (!check.ok) {
			setError(check.message);
			return;
		}
		for (const id of picked) uiStateStore.addMember(groupId, id);
		setPicked([]);
		setAddingTo(undefined);
		setError(undefined);
	};

	return (
		<div className="tb3g-panel" data-sibling-panel data-parent={props.parentId ?? 'root'}>
			<div className="tb3g-panel__head">
				<span className="tb3g-panel__title">{title}</span>
				<span className="tb3g-panel__count" data-sibling-count>
					{String(
						groups.length === 0 ? loose.length : loose.length + groups.length,
					)}{' '}
					项
				</span>
				{props.onClose === undefined ? null : (
					<button
						type="button"
						className="tb3g-panel__close"
						data-sibling-close
						title="关闭"
						onClick={props.onClose}
					>
						×
					</button>
				)}
			</div>

			{groups.length === 0 ? null : (
				<div className="tb3g-groups" data-sibling-groups>
					{groups.map((group, index) => {
						const isFolded = folded.has(group.id);
						const label = groupLabelOf(group, index);
						return (
							<div className="tb3g-group" key={group.id} data-sibling-group={group.id}>
								<div className="tb3g-group__row">
									<button
										type="button"
										className="tb3g-group__toggle"
										data-group-toggle={group.id}
										title={isFolded ? '展开组' : '折叠组'}
										onClick={() => {
											uiStateStore.setFolded(group.id, !isFolded);
										}}
									>
										{isFolded ? '▸' : '▾'}
									</button>
									{renaming === group.id ? (
										<input
											className="tb3g-group__input"
											data-group-rename-input={group.id}
											value={draftName}
											autoFocus
											placeholder="组名（可空）"
											onChange={(event) => {
												setDraftName(event.target.value);
											}}
											onBlur={() => {
												uiStateStore.renameGroup(group.id, draftName);
												setRenaming(undefined);
											}}
											onKeyDown={(event) => {
												if (event.key === 'Enter') {
													uiStateStore.renameGroup(group.id, draftName);
													setRenaming(undefined);
												}
												if (event.key === 'Escape') setRenaming(undefined);
											}}
										/>
									) : (
										<button
											type="button"
											className="tb3g-group__name"
											data-group-name={group.id}
											title="点一下改名"
											onClick={() => {
												setRenaming(group.id);
												setDraftName(group.name ?? '');
											}}
										>
											{label}
										</button>
									)}
									<span className="tb3g-group__size">
										{String(group.memberIds.length)} 张
									</span>
									<button
										type="button"
										className="tb3g-group__action"
										data-group-delete={group.id}
										title="删组（成员回到未分组）"
										onClick={() => {
											uiStateStore.removeGroup(group.id);
										}}
									>
										删
									</button>
								</div>
								{isFolded ? null : (
									<div className="tb3g-group__body">
										{group.memberIds.map((id) => {
											const card = props.cards.find((one) => one.id === id);
											if (card === undefined) return null;
											return (
												<label className="tb3g-row" key={id} data-group-member={id}>
													<input
														type="checkbox"
														checked={picked.includes(id)}
														onChange={() => {
															togglePicked(id);
														}}
													/>
													<span className="tb3g-row__id">{id}</span>
													<span className="tb3g-row__title">{card.title}</span>
													<button
														type="button"
														className="tb3g-row__remove"
														data-group-member-remove={id}
														title="从组里移出"
														onClick={(event) => {
															event.preventDefault();
															uiStateStore.removeMember(group.id, id);
														}}
													>
														移出
													</button>
												</label>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}

			{loose.length === 0 ? (
				<div className="tb3g-empty">这里没有未分组的卡。</div>
			) : (
				<div className="tb3g-loose" data-sibling-loose>
					{loose.map((card) => (
						<label className="tb3g-row" key={card.id} data-loose-card={card.id}>
							<input
								type="checkbox"
								checked={picked.includes(card.id)}
								onChange={() => {
									togglePicked(card.id);
								}}
							/>
							<span className="tb3g-row__id">{card.id}</span>
							<span className="tb3g-row__title">{card.title}</span>
						</label>
					))}
				</div>
			)}

			{error === undefined ? null : (
				<div className="tb3g-error" data-sibling-error>
					{error}
				</div>
			)}

			<div className="tb3g-actions">
				<span className="tb3g-actions__picked">已选 {String(picked.length)} 张</span>
				<button
					type="button"
					className="ghost-btn"
					data-group-create
					disabled={picked.length < 2}
					onClick={createGroup}
				>
					成组
				</button>
				{groups.length === 0 ? null : addingTo === undefined ? (
					<button
						type="button"
						className="ghost-btn"
						data-group-add-open
						disabled={picked.length < 2}
						onClick={() => {
							setAddingTo(groups[0]?.id ?? '');
						}}
					>
						加入已有组
					</button>
				) : (
					<select
						className="tb3g-actions__select"
						data-group-add-select
						value={addingTo}
						onChange={(event) => {
							const id = event.target.value;
							setAddingTo(id);
							addToExisting(id);
						}}
					>
						{groups.map((group, index) => (
							<option key={group.id} value={group.id}>
								{groupLabelOf(group, index)}
							</option>
						))}
					</select>
				)}
			</div>
		</div>
	);
}
