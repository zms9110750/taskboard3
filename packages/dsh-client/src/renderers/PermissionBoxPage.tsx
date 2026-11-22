/**
 * 权限框的**全屏页** —— 用户 2026-11-22：
 *
 * > 「权限选择只能在全屏下开一个页面。」
 *
 * ## 为什么全屏而不是抽屉/模态
 *
 * 用户原话同上。另一个理由是**两条轴要同时看清**（正交）：
 * 抽屉那点高度塞不下 2 轴 × 3 档 × 每档一句说明；模态框会遮住 composer
 * 而权限判断要参照「我现在要发什么指令」。
 *
 * ## 内容是哪份组件
 *
 * **直接复用 `PermissionPanel`**（395 行，已定稿、有 441 行纯逻辑测试）。
 * 本文件只做**容器**：全屏壳 + 顶栏 + 关闭。
 *
 * ⚠ 不复制面板内容 —— 内容改一处，两个入口（这里 / 未来的 agent 侧）都会变。
 *
 * ## ⚠ 两轴都显示
 *
 * `PermissionPanel` 的 `axes` prop **省略 = 两轴都显示**，这里就省略。
 *
 * 历史注意：`PermissionPanelProps.axes` 的注释记着用户 2026-11-22 说过
 * 「工具管控档位是做在 dsh 里面的…所以 ui 不放这个」。**2026-11-23 用户改了主意**：
 * 他要在 composer 里看到「任务板干涉工具 / 限制工具 / ai 可改档位」——
 * 那是宿主轴的三档。⇒ 现在两轴都给，旧注释的解释已过时。
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
					两条轴互相独立：上面管「AI 能不能领卡 / 采纳」，下面管「任务板要不要拦工具」。
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
					 * ⚠ 不传 `axes` ⇒ 两条轴都显示（正交的可见性）。
					 *   点哪一档立刻保存，没有「保存」按钮 —— 那是面板自己的约定。
					 */}
					<PermissionPanel
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
