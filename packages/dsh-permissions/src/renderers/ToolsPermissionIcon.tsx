/**
 * 「工具权限」图标 —— 左侧栏 `sidebar.panellist` 的第二颗图标。
 *
 * ## 形状：三个节点 + 两条包含边
 *
 * 这个入口的页面是**组图编辑器**（组可以包含工具、组可以包含组），
 * 所以图标画成「一上两下的三个圆 + 从上面的圆连到下面两个圆」。
 *
 * ```
 *        ○            ← 一个组
 *       ╱ ╲
 *      ○   ○         ← 它包含的东西
 * ```
 *
 * ## 为什么和 `TaskboardIcon` 一样用 `currentColor`
 *
 * DSH 左侧栏图标靠**继承文字颜色**跟随主题（浅色 / 深色）。写死颜色会在深色主题下
 * 变成一块黑，和宿主其它图标不一致。`stroke-width: 1.6` 也与 `TaskboardIcon` 一致，
 * 两颗图标并排时粗细才一样。
 */

import type { ReactNode } from 'react';

/**
 * 「工具权限」图标（24×24 视框，stroke 风格）。
 *
 * @returns SVG 元素
 */
export function ToolsPermissionIcon(): ReactNode {
	return (
		<svg viewBox="0 0 24 24" width={20} height={20} aria-hidden fill="none">
			{/* 两条包含边先画，让节点圆压在线上 */}
			<path d="M12 7.5 L6.5 16.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
			<path d="M12 7.5 L17.5 16.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
			<circle cx={12} cy={5.5} r={2.6} stroke="currentColor" strokeWidth={1.6} />
			<circle cx={5.5} cy={18.5} r={2.6} stroke="currentColor" strokeWidth={1.6} />
			<circle cx={18.5} cy={18.5} r={2.6} stroke="currentColor" strokeWidth={1.6} />
		</svg>
	);
}
