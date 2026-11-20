/**
 * composer 骨架 —— **只提供两个真实定位父级，不画任何假内容**。
 *
 * ## 为什么要有这个文件（用户 2026-11-20）
 *
 * > 「我要的不是真实dsh。我要的是那个抽屉组件要用已经候选的组件放进去。
 * >   你搓的什么垃圾东西。」
 * > 「渲染旧壳也应该在接入组件的地方接入组件。而不是搓假的」
 *
 * 原来的 `mock-composer.tsx` 画了一整个假 composer：假对话、假输入框、
 * 假工具行、假发送按钮 —— 那些都不是组件，是我画的。而 `Drawer` 面板的
 * 定位**只需要两个真实父级**：
 *
 * | 父级 | asar 原文 | 作用 |
 * |---|---|---|
 * | `.GRgSLq_card`（`position:relative`）| `.GRgSLq_card{…position:relative}` | 入口 `left`/`top` 的包含块 |
 * | `.GRgSLq_overlayAnchor` | `.GRgSLq_overlayAnchor{height:0;position:absolute;inset:0 0 auto}` | 面板 `bottom:100%` 的包含块 |
 *
 * ⇒ 这个文件只摆这两个盒子（**真实尺寸、真实定位语义**），里面放真组件
 *   `Drawer` / `DrawerEntry`。**不画对话、不画输入框、不画工具行。**
 *
 * ⚠ 卡片是空的。空不是缺陷 —— 它是「宿主长什么样不归组件管」的诚实表达。
 */

import type { ReactNode } from 'react';

import type { DrawerVariant } from '../../../src/pure/drawer-view.ts';
import { Drawer, DrawerEntry } from '../../../src/renderers/Drawer.tsx';
import type { WorkspaceProps } from '../../../src/renderers/Workspace.tsx';

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
	/** 卡片宽度（真实 composer 的 `--dsh-chat-content-width`，默认 1200）。 */
	readonly cardWidth?: number;
}

/**
 * 渲染「composer 卡片 + overlayAnchor + 真抽屉组件」。
 *
 * @param props 见 `ComposerFrameProps`
 */
export function ComposerFrame(props: ComposerFrameProps): ReactNode {
	const width = props.cardWidth ?? 1200;

	return (
		<div className="pvf" data-composer-frame="1">
			{/*
			 * 卡片：只提供 `position:relative`。空着 —— 内容不归组件管。
			 * 高度给一个真实量级（textarea + 工具行 ≈ 96px），否则 anchor 无处可落。
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

				{/*
				 * 入口：真组件挂在卡片的 `conversation.input.left` 语义位置上。
				 * 这里直接放在卡片里 —— 它是 `position:absolute`，
				 * `left:-32px; top:4px` 相对卡片生效，和挂在工具行里等价。
				 */}
				<DrawerEntry open={props.open} onToggle={props.onToggle} variant={props.variant} />
			</div>
		</div>
	);
}
