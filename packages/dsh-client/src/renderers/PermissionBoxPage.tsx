/**
 * 权限框的**全屏页** —— 用户 2026-11-22：
 *
 * > 「权限选择只能在全屏下开一个页面。」
 *
 * ## 为什么全屏而不是抽屉/模态
 *
 * 用户原话同上。另一个理由是**三档各带一句说明**：
 * 抽屉那点高度塞不下 3 档 × 每档一句说明；模态框会遮住 composer
 * 而权限判断要参照「我现在要发什么指令」。
 *
 * ## 内容是哪份组件
 *
 * **直接复用 `PermissionPanel`**（395 行，已定稿、有 441 行纯逻辑测试）。
 * 本文件只做**容器**：全屏壳 + 顶栏 + 关闭。
 *
 * ⚠ 不复制面板内容 —— 内容改一处，两个入口（这里 / 未来的 agent 侧）都会变。
 *
 * ## ⚠ 本页**只显示 agent 侧那一条轴**（`2026-11-23` 之后）
 *
 * 用户 `2026-11-23`：
 *
 * > 「是否允许领卡的那个权限。放在工作空间这个按钮的左边。
 * >   他是一般ui提供的权限。影响的工具是通用tool的。所以放在一般ui里面。」
 *
 * ⇒ `cardActionLevel`（一般 UI 的权限）搬去任务板工具栏
 *   （`renderers/workspace/CardActionControl.tsx`）。
 *
 * ⇒ 本页只剩 `toolGuardLevel`（agent 侧三档：不干涉 / 限制工具调用 / AI 可管理）。
 *   传 `axes={['tool']}` —— **不是省略**（省略 = 两轴都画，会把已经搬走的 card 轴画回来）。
 *
 * 历史注意：`PermissionPanelProps.axes` 的注释记着用户 2026-11-22 说过
 * 「工具管控档位是做在 dsh 里面的…所以 ui 不放这个」；2026-11-23 用户改了主意，
 * 要 composer 里能看到宿主轴三档。**现在两侧各管一条轴。**
 */

import type { ReactNode } from 'react';

import {
	closePermissionBox,
	dismissPermissionSaveError,
	loadPermission,
	selectPermissionLevel,
	usePermissionBox,
} from '../pure/permission-box-state.ts';
import { PermissionPanel } from './PermissionPanel.tsx';

/**
 * 权限全屏页。
 *
 * @returns 未打开时 `null`（不占 DOM）；打开时整页
 */
export function PermissionBoxPage(): ReactNode {
	const { open, state } = usePermissionBox();
	if (!open) return null;

	return (
		<div className="tb3pbox-page" data-permission-page="1" role="dialog" aria-modal="true" aria-label="任务板权限">
			<header className="tb3pbox-page__head">
				<span className="tb3pbox-page__title">任务板权限</span>
				<span className="tb3pbox-page__hint">
					只影响 agent 侧：任务板要不要插手 dsh 的工具调用。 「是否允许领卡」在任务板工具栏上。
				</span>
				<button
					type="button"
					className="tb3pbox-page__close"
					data-permission-close="1"
					title="关闭"
					aria-label="关闭"
					onClick={closePermissionBox}
				>
					×
				</button>
			</header>

			<div className="tb3pbox-page__body">
				<div className="tb3pbox-page__inner">
					{/*
					 * ⚠ **必须传 `axes={['tool']}`**：
					 *   省略 = 两轴都画 ⇒ 会把已经搬到工具栏的 card 轴画回来。
					 *   点哪一档立刻保存，没有「保存」按钮 —— 那是面板自己的约定。
					 */}
					<PermissionPanel
						axes={['tool']}
						state={state}
						onSelect={(axis, value) => {
							void selectPermissionLevel(axis, value);
						}}
						onRetry={() => {
							void loadPermission();
						}}
						onDismissSaveError={dismissPermissionSaveError}
					/>
				</div>
			</div>
		</div>
	);
}
