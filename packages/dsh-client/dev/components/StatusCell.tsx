/**
 * 状态列 —— **圆点 + 中文名**。
 *
 * 两种排法：
 * - 默认（`compact=false`）：横排，用于旧版列表行
 * - `compact`：上下两行都靠左的小号，用于 CardRow 左侧那个正方形
 */

import type { ReactNode } from 'react';

import { stateLabel } from '../pure/card-view.ts';
import { StatusDot } from './StatusDot.tsx';

/** 组件属性。 */
export interface StatusCellProps {
	/** A2A 状态全名。 */
	readonly status: string;
	/** `true` = 紧凑模式（正方形里用，小一号）。 */
	readonly compact?: boolean;
}

/**
 * 一个状态（点 + 文字）。
 *
 * @param props 见 `StatusCellProps`
 */
export function StatusCell(props: StatusCellProps): ReactNode {
	const cls = props.compact ? 'task-card__status is-compact' : 'task-card__status';
	return (
		<span className={cls}>
			<StatusDot status={props.status} size={props.compact === true ? 6 : undefined} />
			<span className="task-card__status-label">{stateLabel(props.status)}</span>
		</span>
	);
}
