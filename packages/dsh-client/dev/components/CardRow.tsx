/**
 * 列表条目 —— **一行一张卡**。
 *
 * ## 列结构（用户 `2026-11-10` 采纳子 AI UX 第 1 条）
 *
 * ```
 * 编号 分类徽章 领域徽章 标题……………… 最后动过  ●状态文字
 * ```
 *
 * | 列 | 宽度 | 为什么 |
 * |---|---|---|
 * | 编号 | 自适应 | 等宽 + 分类色 + 粗体 |
 * | 分类徽章 | 自适应 | 色块 |
 * | 领域徽章 | 自适应 | 中性灰 |
 * | 标题 | **flex:1** | 唯一弹性列，长了省略 |
 * | 最后动过 | **固定 90px** | 右对齐；列名常显（只有时间会看不懂）|
 * | 状态 | **固定 96px** | 扫视不横跨整行 |
 *
 * ## 草稿无边框
 *
 * 用户 `2026-11-10`：「草稿无边框、选中用强调色」。
 * ⚠ 用**透明边框**而不是 `border: none` —— 保留 2px 占位，
 *   否则草稿/非草稿切换时整行会跳 2px。
 *
 * ## ⚠ 不在组件里判「能不能选中」
 *
 * 组件只上报 `onSelect(id)`。选中之后做什么（加载详情、清空关系展开…）
 * 是父层的事。**这是「一个按钮为一个单位」的延续**。
 */

import type { ReactNode } from 'react';

import {
	cardTimes,
	fmtDateTime,
	isDraftStatus,
	kindTone,
} from '../pure/card-view.ts';
import type { Card } from '../../src/types.ts';
import { StatusCell } from './StatusCell.tsx';

/** 组件属性。 */
export interface CardRowProps {
	readonly card: Card;
	/** 是否是当前选中的那张。 */
	readonly selected: boolean;
	/** 是否未读（AI 改过、我还没看）。 */
	readonly unread: boolean;
	/** 分类的中文名。**由调用方从模板清单查**，本组件不持有词表。 */
	readonly kindLabel: string;
	readonly onSelect: (cardId: string) => void;
}

/**
 * 一行卡片。
 *
 * @param props 见 `CardRowProps`
 */
export function CardRow(props: CardRowProps): ReactNode {
	const card = props.card;
	const draft = isDraftStatus(card.status);
	const time = cardTimes(card.history).last;
	const tone = kindTone(card.template.kind);

	const cls = ['task-card'];
	if (props.selected) cls.push('is-selected');
	if (props.unread) cls.push('is-unread');
	if (draft) cls.push('is-draft');

	return (
		<button
			type="button"
			className={cls.join(' ')}
			data-card-id={card.id}
			onClick={() => props.onSelect(card.id)}
		>
			<div className="task-card__head">
				<span className={`card-id card-id--${tone}`}>{card.id}</span>
				<span className={`badge badge--${tone}`}>{props.kindLabel}</span>
				<span className="badge badge--domain">{card.template.domain}</span>
				<span className="task-card__title" title={card.title}>
					{card.title}
				</span>
				<span className="task-card__when">
					<span className="task-card__when-label">最后动过</span>
					{fmtDateTime(time)}
				</span>
				<StatusCell status={card.status} />
			</div>
		</button>
	);
}
