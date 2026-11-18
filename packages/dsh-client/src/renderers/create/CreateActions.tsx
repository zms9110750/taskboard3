/**
 * 底部按钮区 —— 取消 / 提交。
 *
 * ## 为什么「提交」是**默认按钮**
 *
 * 表单里改了一堆东西之后，用户想的就是「交」。让提交按钮最显眼、位置固定，
 * 是这一屏唯一的终点。
 *
 * ## ⚠ 提交按钮**不禁用**
 *
 * 常见做法是「校验没过就禁用提交」。这里**不这么做**，原因：
 *
 * | 禁用 | 不禁用（选这个） |
 * |---|---|
 * | 用户不知道为什么点不了 | 点了会列出**具体哪几处**有问题 |
 * | 校验错误要在输入过程中就算（一打开就标红） | 只在**点了提交之后**才标红 |
 *
 * ⇒ 不禁用 + 点了才校验。这样用户不会「一打开就满屏红」，也不会「按钮灰着不知为何」。
 */

import type { ReactNode } from 'react';

/** 组件属性。 */
export interface CreateActionsProps {
	readonly onCancel: () => void;
	readonly onSubmit: () => void;
	/** 提交中（防止连点）。 */
	readonly pending?: boolean;
	/** 错误条数（> 0 时在左边显示「还有 N 处要改」）。 */
	readonly errorCount: number;
}

/**
 * 底部按钮。
 *
 * @param props 见 `CreateActionsProps`
 */
export function CreateActions(props: CreateActionsProps): ReactNode {
	const pending = props.pending === true;

	return (
		<div className="tb3cc-actions">
			<div className="tb3cc-actions__msg">
				{props.errorCount === 0 ? null : (
					<span className="tb3cc-actions__err">还有 {props.errorCount} 处要改</span>
				)}
			</div>
			<div className="tb3cc-actions__buttons">
				<button type="button" className="tb3cc-btn" disabled={pending} onClick={props.onCancel}>
					取消
				</button>
				<button type="button" className="tb3cc-btn tb3cc-btn--primary" disabled={pending} onClick={props.onSubmit}>
					{pending ? '提交中…' : '提交'}
				</button>
			</div>
		</div>
	);
}
