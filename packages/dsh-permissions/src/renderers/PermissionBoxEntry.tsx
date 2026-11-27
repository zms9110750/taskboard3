/**
 * 权限框的**入口按钮** —— composer 工具行里那颗，显示 **agent 侧**档位。
 *
 * ## 用户裁决（`2026-11-23`）
 *
 * > 「这里要有一个权限框。任务板干涉工具。任务板限制工具。ai可改任务板工作权限。
 * >   之前说的权限正交问题。」
 *
 * 后来又分流（同一天）：
 *
 * > 「是否允许领卡的那个权限。放在工作空间这个按钮的左边。
 * >   他是一般ui提供的权限。影响的工具是通用tool的。所以放在一般ui里面。」
 *
 * ⇒ **card 轴搬去任务板工具栏**（`CardActionControl`），
 *   这个按钮**只反映 agent 侧那一条轴**（三个 tool 档位）。
 *
 * ⚠ 摘要必须用 `toolSummaryOf()` / `isToolNonDefault()` —— 不能用两轴版本：
 *   否则按钮上会显示一个「点开这个框也改不了」的档位。
 *
 * ## 为什么摘要不写「权限」二字
 *
 * 按钮本身就在 composer 里，上下文足够；写全会让按钮比旁边的
 * `完全权限 ▾` 长太多，把工具行撑变形。
 *
 * ## 浮层就长在这个组件里（`2026-11-23` 之后）
 *
 * 用户：
 *
 * > 「他还是全屏的。」
 *
 * ⇒ 从「portal 铺满视口的全屏页」改成「贴在按钮旁边的浮层」。
 *   浮层必须锚在按钮上，所以**和按钮放在同一个 DOM 子树**里
 *   （`.tb3pbox-anchor{position:relative}`），不再走 `conversation.input.overlay` 槽。
 *
 * ⚠ 这个组件**不自己拉数据** —— 状态在 `pure/permission-box-state.ts`（模块级）。
 */

import type { ReactNode } from 'react';

import { isToolNonDefault, toolSummaryOf } from '../pure/permission-box.ts';
import { togglePermissionBox, usePermissionBox } from '../pure/permission-box-state.ts';
import { PermissionBoxPopover } from './PermissionBoxPopover.tsx';

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
	const { open, state } = usePermissionBox();

	/*
	 * ⚠ 只有 ready 才显示真实档位摘要。
	 *
	 * 加载中 / 加载失败时显示「权限」两个字 —— **不编造档位**。
	 * 显示「任务板不管理」而实际不知道，比显示「权限」坏得多：
	 * 用户会以为那就是当前设置。
	 */
	const ready = state.phase === 'ready';
	const summary = ready ? toolSummaryOf(state.snapshot) : '权限';
	const nonDefault = ready && isToolNonDefault(state.snapshot);

	return (
		/*
		 * ⚠ 锚点容器：浮层用 `position:absolute;bottom:calc(100% + 8px)` 相对它定位。
		 *   `display:inline-flex` 让容器正好裹住按钮，不占额外高度。
		 */
		<span className="tb3pbox-anchor" data-permission-anchor="1">
			<button
				type="button"
				className="tb3pbox-entry"
				data-permission-entry="1"
				data-phase={state.phase}
				data-non-default={String(nonDefault)}
				data-open={String(open)}
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-label={`任务板权限：${summary}`}
				title={`任务板权限：${summary}（点击修改）`}
				onClick={togglePermissionBox}
			>
				<ShieldIcon />
				<span className="tb3pbox-entry__summary" data-permission-summary="1">
					{summary}
				</span>
			</button>
			<PermissionBoxPopover />
		</span>
	);
}
