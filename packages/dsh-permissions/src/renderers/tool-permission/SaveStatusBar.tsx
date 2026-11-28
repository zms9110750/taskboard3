/**
 * 保存状态条（issue #58）—— 「保存中 / 已保存 / 失败可重试」必须**看得见**。
 *
 * 用户 `2026-11-28`（issue #58）：页面原来写着「组图改动暂不持久化」——
 * 最坏的一种状态是「能改但改了不算数」。后端做通之后，**保存本身的状态**
 * 就成了唯一能让用户放心的东西：
 *
 * | 状态 | 显示 | 为什么 |
 * |---|---|---|
 * | 保存中 | 转圈 +「保存中…」 | 防抖窗口里用户可能已经刷新页面 |
 * | 已保存 | ✓ 已保存（悬停给时间） | 静默成功 = 用户不知道有没有存上 |
 * | 失败 | 原因 + 「重试」 | 只报「失败」等于让用户自己猜 |
 *
 * 组件只吃 props，不认识「图」还是「授权」—— 两处共用同一条状态机。
 */

import type { ReactNode } from 'react';

/** 保存状态的四种结局。 */
export type SaveState =
	| { readonly kind: 'idle' }
	| { readonly kind: 'saving' }
	| { readonly kind: 'saved'; readonly at: string }
	| { readonly kind: 'failed'; readonly message: string; readonly code?: string };

/** `SaveStatusBar` 的 props。 */
export interface SaveStatusBarProps {
	readonly state: SaveState;
	/** 失败时的重试入口；省略 ⇒ 只显示原因（没有可重试的东西）。 */
	readonly onRetry?: (() => void) | undefined;
	/** 空闲时的一句话（如「改动会自动保存」）。 */
	readonly idleText?: string;
}

/**
 * 保存状态条。
 *
 * @param props 见 `SaveStatusBarProps`
 */
export function SaveStatusBar(props: SaveStatusBarProps): ReactNode {
	const { state } = props;

	if (state.kind === 'saving') {
		return (
			<span className="tb3g-save" data-save-state="saving" data-testid="save-status" role="status" aria-live="polite">
				<span className="tb3g-save__spinner" aria-hidden="true" />
				保存中…
			</span>
		);
	}
	if (state.kind === 'saved') {
		return (
			<span className="tb3g-save is-ok" data-save-state="saved" data-testid="save-status" role="status" aria-live="polite" title={state.at}>
				✓ 已保存
			</span>
		);
	}
	if (state.kind === 'failed') {
		return (
			<span className="tb3g-save is-bad" data-save-state="failed" data-testid="save-status" role="alert" title={state.message}>
				<span className="tb3g-save__text">
					{state.code === undefined ? null : <code className="tb3g-save__code">{state.code}</code>}
					保存失败：{state.message}
				</span>
				{props.onRetry === undefined ? null : (
					<button type="button" className="tb3g-btn tb3g-btn--tiny" data-action="retry-save" onClick={props.onRetry}>
						重试
					</button>
				)}
			</span>
		);
	}
	return (
		<span className="tb3g-save" data-save-state="idle" data-testid="save-status">
			{props.idleText ?? '改动会自动保存'}
		</span>
	);
}
