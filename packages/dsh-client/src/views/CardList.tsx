/**
 * 卡片列表 —— 编号 + 标题 + 状态徽章。
 *
 * 只做列表：不判状态（规则 3）、不排序（顺序 = 服务端给的顺序）、
 * 不判可用操作（那是详情里状态菜单的事）。
 */

import type { ReactNode } from 'react';

import { groupOf } from '@taskboard/protocol';

import { CLS } from '../styles.ts';
import type { Card } from '../types.ts';
import { StatusBadge } from './StatusBadge.tsx';

/** 列表属性。 */
export interface CardListProps {
	readonly cards: readonly Card[];
	readonly selectedId: string | null;
	readonly onSelect: (cardId: string) => void;
}

/**
 * 卡列表。
 *
 * @param props 卡数组、选中 id、选中回调
 */
export function CardList(props: CardListProps): ReactNode {
	if (props.cards.length === 0) {
		return <div className={CLS.empty}>这个空间还没有卡。</div>;
	}
	return (
		<div>
			{props.cards.map((card) => (
				<CardRow
					key={card.id}
					card={card}
					selected={card.id === props.selectedId}
					onSelect={props.onSelect}
				/>
			))}
		</div>
	);
}

/** 单行。 */
function CardRow(props: {
	readonly card: Card;
	readonly selected: boolean;
	readonly onSelect: (cardId: string) => void;
}): ReactNode {
	const done = isDone(props.card.status);
	return (
		<button
			type="button"
			className={props.selected ? `${CLS.row} ${CLS.rowSelected}` : CLS.row}
			onClick={() => props.onSelect(props.card.id)}
		>
			<span className={CLS.rowId}>{props.card.id}</span>
			<span className={done ? `${CLS.rowTitle} ${CLS.rowTitleDone}` : CLS.rowTitle} title={props.card.title}>
				{props.card.title}
			</span>
			<StatusBadge status={props.card.status} />
		</button>
	);
}

/** 状态是否已收尾（`ended` 组）。未知状态当未收尾处理。 */
function isDone(status: string): boolean {
	try {
		return groupOf(status as Parameters<typeof groupOf>[0]) === 'ended';
	} catch {
		return false;
	}
}
