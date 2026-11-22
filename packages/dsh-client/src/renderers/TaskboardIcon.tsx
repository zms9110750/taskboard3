/**
 * 任务板图标 —— 左侧栏 `sidebar.panellist` 的图标。
 *
 * ## 形状从哪来
 *
 * 抄 `taskboard2` 的 `TaskboardIcon`（`packages/ui/client.js:56-64`，已跑通的产品）：
 *
 * ```
 * 一竖长条 + 两个小方块   （「板」的语义：一列 + 两块）
 * ```
 *
 * 三个 `<rect>` 的坐标**逐字照抄**：
 *
 * | rect | x | y | w | h |
 * |---|---|---|---|---|
 * | 左竖条 | 3 | 4 | 7 | 16 |
 * | 右上 | 14 | 4 | 7 | 7 |
 * | 右下 | 14 | 14 | 7 | 6 |
 *
 * ## 为什么用 `currentColor`
 *
 * DSH 左侧栏的图标靠**继承文字颜色**跟随主题（浅色 / 深色）。
 * 写死颜色会在深色主题下变成一块黑 —— 和宿主其它图标不一致。
 *
 * `stroke-width: 1.6` 也是照抄的（DSH 官方图标的常见值，20×20 视觉下不粗不细）。
 */

import type { ReactNode } from 'react';

/**
 * 任务板图标（20×20，stroke 风格）。
 *
 * @returns SVG 元素
 */
export function TaskboardIcon(): ReactNode {
	return (
		<svg viewBox="0 0 24 24" width={20} height={20} aria-hidden fill="none">
			<rect x={3} y={4} width={7} height={16} rx={1.5} stroke="currentColor" strokeWidth={1.6} />
			<rect x={14} y={4} width={7} height={7} rx={1.5} stroke="currentColor" strokeWidth={1.6} />
			<rect x={14} y={14} width={7} height={6} rx={1.5} stroke="currentColor" strokeWidth={1.6} />
		</svg>
	);
}
