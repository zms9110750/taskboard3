/**
 * 状态徽章 —— 状态的可视化。
 *
 * ## 颜色按**状态组**分（4 组），不按 9 个状态各给一色
 *
 * 9 种颜色没人分得清，而组的语义用户已经定了（草稿 / 进行 / 搁置 / 完成）。
 * 组名与成员来自 `@taskboard/protocol`，这里不写第二份。
 */

import type { ReactNode } from 'react';

import { groupOf, labelOf, type StatusGroup, type TaskState } from '@taskboard/protocol';

import { CLS } from '../styles.ts';

/** 组 → 额外的类名（`tb3-badge` 是共用的基类）。 */
const GROUP_CLASS: Readonly<Record<StatusGroup, string>> = {
	draft: '',
	active: CLS.badgeActive,
	shelved: CLS.badgeShelved,
	ended: CLS.badgeEnded,
};

/**
 * 一个状态徽章。
 *
 * @param props.status A2A 状态全名
 */
export function StatusBadge({ status }: { readonly status: string }): ReactNode {
	const group: StatusGroup = isStatus(status) ? groupOf(status) : 'ended';
	const extra = GROUP_CLASS[group];
	return (
		<span className={extra === '' ? CLS.badge : `${CLS.badge} ${extra}`} title={status}>
			{labelOf(status)}
		</span>
	);
}

/**
 * 是否是已知的九个状态之一。
 *
 * 脏数据（未知状态）不能让整个列表崩掉 —— 回落 `ended` 的样式（更淡）。
 * `labelOf` 对未知值返回原值，所以「返回值和输入相同」就是未知。
 */
function isStatus(value: string): value is TaskState {
	return labelOf(value) !== value;
}
