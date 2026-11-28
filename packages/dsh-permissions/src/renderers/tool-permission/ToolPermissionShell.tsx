/**
 * 「工具权限」页的外壳（issue #55 / #58）—— **只负责说真话**。
 *
 * ## 它说什么
 *
 * | 行 | 什么时候出现 | 内容 |
 * |---|---|---|
 * | 工具来源 | 永远 | 「共 N 个工具，来自宿主 /api/tools」 |
 * | 降级红条 | `/api/tools` 取不到 | 原因 + 「当前显示内置示例」 |
 *
 * ## 它不说什么
 *
 * 原来这里有一条常驻黄条：「组图改动暂不持久化（后端存储待实现）」。
 * 那条提示存在的唯一理由就是后端没实现 —— issue #58 把后端做通了，
 * **黄条必须摘掉**（留着等于继续骗用户）。改动有没有存上，由画布上的
 * `SaveStatusBar` 按真实结果说。
 *
 * ## 为什么工具来源要做成一行常驻说明
 *
 * issue #55：右栏工具「不是 DSH 全集」的观感，一部分来自**旧 profile 少注册了行**，
 * 一部分来自清单本身只在右栏、没有出处。⇒ 把「几个 / 从哪来」写在页头，
 * 用户能自己判断「是宿主只给了 26 个」还是「页面吃掉了」。
 */

import type { ReactNode } from 'react';

import type { ToolEntry } from '../../pure/tool-permission.ts';

/** 工具清单的来路。 */
export type ToolOrigin = 'host' | 'fallback';

/** `ToolPermissionShell` 的 props。 */
export interface ToolPermissionShellProps {
	/** 当前页面实际拿到的工具条目（宿主全集或内置示例）。 */
	readonly tools: readonly ToolEntry[];
	/** 清单来路：宿主接口 / 内置示例。 */
	readonly origin: ToolOrigin;
	/** 降级原因（`origin === 'fallback'` 时显示）。 */
	readonly fallbackReason?: string | undefined;
	/** 页面主体。 */
	readonly children?: ReactNode;
}

/**
 * 页面外壳。
 *
 * @param props 见 `ToolPermissionShellProps`
 */
export function ToolPermissionShell(props: ToolPermissionShellProps): ReactNode {
	return (
		<div className="tb3g-shell" data-testid="tool-permission-page">
			{props.origin === 'fallback' ? (
				<p className="tb3g-banner tb3g-banner--bad" data-testid="tools-fallback-notice" role="alert">
					工具清单取不到（{props.fallbackReason ?? '原因未知'}），当前显示内置示例 —— 它<b>不是</b>宿主全量。
				</p>
			) : null}
			<p className="tb3g-source" data-testid="tools-source" data-origin={props.origin}>
				共 <b data-testid="tools-total">{String(props.tools.length)}</b> 个工具，
				{props.origin === 'host' ? '来自宿主 /api/tools' : '来自内置示例（宿主接口没读到）'}
			</p>
			{props.children}
		</div>
	);
}
