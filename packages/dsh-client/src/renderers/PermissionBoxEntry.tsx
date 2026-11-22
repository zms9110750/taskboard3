/**
 * 权限框的**入口按钮** —— composer 工具行里那颗，显示两条正交轴的当前档位。
 *
 * ## 用户裁决（`2026-11-23`）
 *
 * > 「这里要有一个权限框。任务板干涉工具。任务板限制工具。ai可改任务板工作权限。
 * >   之前说的权限正交问题。」
 *
 * ⇒ 这个按钮**同时反映两条轴**（正交的可见性），点开是全屏页。
 *   不是「一个总开关」，因为两条轴必须能各自取任何值。
 *
 * ## 为什么摘要不写「权限」二字
 *
 * 按钮本身就在 composer 里，上下文足够；写全会让按钮比旁边的
 * `完全权限 ▾` 长太多，把工具行撑变形。
 *
 * ⚠ 这个组件**不自己拉数据** —— 状态在 `pure/permission-box-state.ts`（模块级），
 *   因为入口和全屏页是两个独立槽条目，靠 props 传不了。
 */

import type { ReactNode } from 'react';

import { isNonDefault, summaryOf } from '../pure/permission-box.ts';
import { openPermissionBox, usePermissionBox } from '../pure/permission-box-state.ts';

/** 盾牌图标（20×20，和 DSH 其它图标同 stroke 风格）。 */
function ShieldIcon(): ReactNode {
	return (
		<svg
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M12 3 4.5 6.2v5.3c0 4.4 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5.1 7.5-9.5V6.2L12 3Z" />
			<path d="M9.2 12.1l2 2 3.6-3.9" />
		</svg>
	);
}

/**
 * 权限框入口按钮。
 *
 * @returns 按钮（加载中 / 加载失败时显示简写，不显示假档位）
 */
export function PermissionBoxEntry(): ReactNode {
	const { state } = usePermissionBox();

	/*
	 * ⚠ 只有 ready 才显示真实档位摘要。
	 *
	 * 加载中 / 加载失败时显示「权限」两个字 —— **不编造档位**。
	 * 显示「不允许领卡 · 任务板不管理」而实际不知道，比显示「权限」坏得多：
	 * 用户会以为那就是当前设置。
	 */
	const ready = state.phase === 'ready';
	const summary = ready ? summaryOf(state.snapshot) : '权限';
	const nonDefault = ready && isNonDefault(state.snapshot);

	return (
		<button
			type="button"
			className="tb3pbox-entry"
			data-permission-entry="1"
			data-phase={state.phase}
			data-non-default={String(nonDefault)}
			aria-haspopup="dialog"
			aria-label={`任务板权限：${summary}`}
			title={`任务板权限：${summary}（点击修改）`}
			onClick={openPermissionBox}
		>
			<ShieldIcon />
			<span className="tb3pbox-entry__summary" data-permission-summary="1">
				{summary}
			</span>
		</button>
	);
}
