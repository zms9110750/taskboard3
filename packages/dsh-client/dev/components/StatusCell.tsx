/**
 * 状态列 —— **圆点 + 中文名**，固定宽度。
 *
 * ## 为什么不是「行尾一个小圆点」
 *
 * 旧版旧版状态只在行尾一个小圆点（离标题 ~1000px，9 个状态只剩「蓝 / 灰」两档）。
 * 用户 `2026-11-10` 采纳的修法：
 *
 * ```
 * 编号 分类徽章 领域徽章 标题……………… 最后动过  ●状态文字
 *                                              ↑ 固定 96px
 * ```
 *
 * ⇒ 状态列**固定宽度**，扫视时不用横跨整行；文字带上，不再只靠颜色区分。
 */

import type { ReactNode } from 'react';

import { stateLabel } from '../pure/card-view.ts';
import { StatusDot } from './StatusDot.tsx';

/** 组件属性。 */
export interface StatusCellProps {
	/** A2A 状态全名。 */
	readonly status: string;
}

/**
 * 一个状态列（点 + 文字）。
 *
 * @param props 见 `StatusCellProps`
 */
export function StatusCell(props: StatusCellProps): ReactNode {
	return (
		<span className="task-card__status">
			<StatusDot status={props.status} />
			<span className="task-card__status-label">{stateLabel(props.status)}</span>
		</span>
	);
}
