/**
 * composer 拟真骨架 —— **布局照真实 DSH，组件是真的**。
 *
 * ## 用户 2026-11-20 的最新要求
 *
 * > 「drawer 预览拟真 dsh 的布局。要引用视口组件。」
 * > （视口组件 = `dev/preview/vp-drawer/index.html` 那个 1200 × 476 的 Workspace 视口）
 *
 * 所以这个文件做两件事：
 *
 * 1. **拟真**：卡片里画输入框 / 工具行 / `+` / 拖拽把手 / 发送按钮 ——
 *    位置和尺寸照 asar 原文（`.GRgSLq_row{padding:2px 8px 6px}`、
 *    `.GRgSLq_add{width:28px;height:28px}`、`.GRgSLq_primary{width:34px;height:34px}`）。
 *    这些是**宿主的样子**，不是组件 —— 组件只有抽屉本身。
 * 2. **引用视口**：抽屉面板里放的就是 `vp-drawer` 那个视口的内容
 *    （`Workspace` 在 1200 × 476 里渲染，和那个预览页同一份）。
 *
 * ⚠ 和旧 `mock-composer.tsx` 的区别：旧版画了假对话（两条消息气泡）。
 *   那些不是宿主的样子，是编的内容 —— 去掉了。
 */

import type { ReactNode } from 'react';

import type { DrawerVariant } from '../../../src/pure/drawer-view.ts';
import { Drawer, DrawerEntry } from '../../../src/renderers/Drawer.tsx';
import type { WorkspaceProps } from '../../../src/renderers/Workspace.tsx';

/** 视口尺寸 —— 和 `dev/preview/vp-drawer` 同一个数。 */
export const DRAWER_VIEWPORT_WIDTH = 1200;
export const DRAWER_VIEWPORT_HEIGHT = 476;

/** 组件属性。 */
export interface ComposerFrameProps {
	readonly variant: DrawerVariant;
	readonly open: boolean;
	readonly onToggle: () => void;
	readonly onClose: () => void;
	/** 抽屉面板里的 Workspace（真组件，props 由调用方给）。 */
	readonly workspace: WorkspaceProps;
	readonly title?: string;
	readonly onRefresh?: () => void;
	/** 卡片宽度 = 视口宽度（真 composer 的 chat-content-width）。 */
	readonly cardWidth?: number;
}

/**
 * 渲染「拟真 composer 卡片 + overlayAnchor + 真抽屉组件」。
 *
 * @param props 见 `ComposerFrameProps`
 */
export function ComposerFrame(props: ComposerFrameProps): ReactNode {
	const width = props.cardWidth ?? DRAWER_VIEWPORT_WIDTH;

	return (
		<div className="pvf" data-composer-frame="1">
			{/* 视口标签：说明这块就是 vp-drawer 那个视口 */}
			<div className="pvf-tag" data-viewport-tag="1">
				视口 {String(DRAWER_VIEWPORT_WIDTH)} × {String(DRAWER_VIEWPORT_HEIGHT)}
				· 面板内容与 dev/preview/vp-drawer 同一份
			</div>

			{/*
			 * 卡片：`position:relative` 是入口的包含块（asar 原文）。
			 * 里面按真实 DSH 结构画输入框 + 工具行。
			 */}
			<div className="pvf-card" data-composer-card="1" style={{ width: `${String(width)}px` }}>
				{/* overlayAnchor：真 DSH 原文 `.overlayAnchor{height:0;position:absolute;inset:0 0 auto}` */}
				<div className="pvf-anchor" data-overlay-anchor="1">
					<Drawer
						open={props.open}
						onClose={props.onClose}
						variant={props.variant}
						workspace={props.workspace}
						{...(props.title === undefined ? {} : { title: props.title })}
						{...(props.onRefresh === undefined ? {} : { onRefresh: props.onRefresh })}
					/>
				</div>

				{/* 输入框（拟真：占位文字，不是组件） */}
				<div className="pvf-editor" data-composer-editor="1">
					<span className="pvf-editor__placeholder">发消息或创建任务…</span>
				</div>

				{/* 工具行（拟真：+ / 权限 / 模型 / 发送） */}
				<div className="pvf-row" data-composer-row="1">
					<div className="pvf-tools">
						{/*
						 * 入口：真组件挂在卡片里（`position:absolute`，
						 * `left:-32px; top:4px` 相对卡片生效 —— 和挂在工具行里等价）。
						 */}
						<DrawerEntry open={props.open} onToggle={props.onToggle} variant={props.variant} />
						<button type="button" className="pvf-add" aria-label="添加">
							＋
						</button>
						<span className="pvf-mode">完全权限 ▾</span>
					</div>
					<div className="pvf-trailing">
						<span className="pvf-model">DeepSeek V4.1 Flash ▾</span>
						<button type="button" className="pvf-send" aria-label="发送">
							↑
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
