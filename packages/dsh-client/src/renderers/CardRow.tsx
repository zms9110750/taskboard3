/**
 * 列表条目 —— **一行一张卡**。
 *
 * ## 布局（用户 `2026-11-17` 定）
 *
 * ```
 * ┌──────┬───────────────────────────────────────────┐
 * │GU-01 │ [目标] [核心] [用户任务]  标题………  最后动过│
 * │● 提交 │                                           │
 * └──────┴───────────────────────────────────────────┘
 *   ↑ 正方形：编号在上、状态在下
 * ```
 *
 * ## 四条规则（都是用户原话）
 *
 * **① 编号 + 状态在一个正方形里，上下两行**
 * > 「右边的当前状态，挪到左边，放在编号的下面。
 * >  也就是说状态和编号放在一个正方形里面，作为上下两行。」
 *
 * **② 三个 label 横着摆一排**
 * > 「label 先一行横的摆着。摆三个。我怕这三个到时候因为都是自定义命名，
 * >  长度不一样，不能上下行的摆放。」
 *
 * ⇒ 分类 / 领域 / 模板名 —— **不换行、不堆叠**，挤不下就省略。
 *
 * **③ 未读用边框表达**
 * > 「如果是『AI改过，我没读过』。那么左边框需要加厚和上色。
 * >  如果是『我改过，AI没读过』。那么给右边的边框进行加厚和上色。」
 *
 * ⇒ `unread.ai` ⇒ 左边框；`unread.user` ⇒ 右边框。两个都真就两边都亮。
 *   边框是**已存在的 2px 边框加厚到 4px 并上色**，不是额外画一条线
 *   （画额外线条会和选中框、hover 框打架）。
 *
 * **④ label 里要显示模板名字**
 * > 「这个列表，我需要他的 label 里面显示模板名字。所以参数里面要有模板名字。」
 *
 * ## ⚠ 未读从 `card.unread` 读，不是参数
 *
 * `card.unread` 是**卡的字段**（core `withHistory` 唯一维护点）。
 * 再从外部传一个 `unread` 参数 = 两个来源 ⇒ 迟早不一致。
 */

import type { ReactNode } from 'react';

import { cardTimes, fmtDateTime, isDraftStatus, kindTone, unreadSide } from '../pure/card-view.ts';
import type { Card } from '../types.ts';
import { StatusCell } from './StatusCell.tsx';

/** 组件属性。 */
export interface CardRowProps {
	readonly card: Card;
	/** 是否是当前选中的那张。 */
	readonly selected: boolean;
	/** 分类的中文名。由调用方从模板清单查 —— 本组件不持有词表。 */
	readonly kindLabel: string;
	/** 模板的显示名（`displayName`）。同上，由调用方传。 */
	readonly templateLabel: string;
	readonly onSelect: (cardId: string) => void;
}

/**
 * 一行卡片。
 *
 * @param props 见 `CardRowProps`
 */
export function CardRow(props: CardRowProps): ReactNode {
	const card = props.card;
	const time = cardTimes(card.history).last;
	const tone = kindTone(card.template.kind);

	const cls = ['task-card'];
	if (props.selected) cls.push('is-selected');
	if (isDraftStatus(card.status)) cls.push('is-draft');
	/*
	 * 未读只亮**一边**。
	 *
	 * 用户 `2026-11-17`：「两边都改过是不可能的。这个东西是，一边改了而且另一边没读。
	 * 他要改肯定会读啊。不点开读怎么改？」
	 *
	 * ⇒ 判决在 `unreadSide()`（已单测）—— 两边都真时只亮左边。
	 *   组件这里不做任何判断。
	 */
	const side = unreadSide(card.unread);
	if (side === 'left') cls.push('is-unread-ai');
	if (side === 'right') cls.push('is-unread-user');

	return (
		<button
			type="button"
			className={cls.join(' ')}
			data-card-id={card.id}
			onClick={() => props.onSelect(card.id)}
		>
			{/* 左：正方形（编号 / 状态 上下两行） */}
			<span className="task-card__square">
				<span className={`task-card__square-id card-id card-id--${tone}`}>{card.id}</span>
				<StatusCell status={card.status} compact />
			</span>

			{/* 右：三个 label 横排 + 标题 + 时间 */}
			<span className="task-card__body">
				<span className="task-card__line">
					<span className={`badge badge--${tone}`}>{props.kindLabel}</span>
					<span className="badge badge--domain">{card.template.domain}</span>
					<span className="badge badge--template" title={props.templateLabel}>
						{props.templateLabel}
					</span>
					<span className="task-card__title" title={card.title}>
						{card.title}
					</span>
					<span className="task-card__when">
						<span className="task-card__when-label">最后动过</span>
						{fmtDateTime(time)}
					</span>
				</span>
			</span>
		</button>
	);
}
