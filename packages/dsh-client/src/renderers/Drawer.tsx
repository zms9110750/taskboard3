/**
 * 抽屉（V5 重做）—— **从输入框上方向外展开**的面板 + **输入框左外侧的正方形入口**。
 *
 * ## 形状（用户 `2026-11-20` 画图标注）
 *
 * ```
 *          ┌──────────────────────────────────┐
 *          │  抽屉面板                          │ ← 宽度 = 输入框宽（父容器的 100%）
 *          │  高度 ≈ 屏幕一半                   │   底边贴输入框上边缘 + 形态间距
 *          │  浮层遮挡后方内容                  │
 *          └──────────────────────────────────┘
 *                  ↑ 底边在输入框上边缘
 *   ┌─┐   ┌──────────────────────────────┬───┐
 *   │▣│   │ 发消息或创建任务…              │ ➤ │ ← 正方形入口贴着输入框左边缘
 *   └─┘   └──────────────────────────────┴───┘   在 composer 工具行里、`+` 左边
 * ```
 *
 * ## ⚠ 挂载点（已查证，asar 原文见 `pure/drawer-view.ts` 文件头）
 *
 * | 部件 | 槽 | 谁注册 |
 * |---|---|---|
 * | 正方形入口 | `conversation.input.left` | `register-drawer.tsx` 的 `DrawerEntrySlot` |
 * | 面板 | `conversation.input.overlay` | `register-drawer.tsx` 的 `DrawerPanelSlot` |
 *
 * **不用 `shell.overlay`** —— 那是整帧浮层，会横跨窗口（V4 因此被用户否了）。
 *
 * ## 几何怎么来的（都不是拍脑袋）
 *
 * - **宽度**：DSH 的 `.overlayAnchor{position:absolute;inset:0 0 auto;height:0}` 在
 *   composer 卡片顶部、宽度等于卡片；官方注释说浮层条目「position themselves against
 *   the card (bottom: 100% + gap)」⇒ 面板 `left:0;right:0;bottom:calc(100% + gap)`
 *   就**自动等于输入框宽**，不需要知道具体像素。
 * - **入口位置**：卡片是 `position:relative`，入口由 `conversation.input.left`
 *   渲染在工具行里 ⇒ 用 `position:absolute;left:-32px;bottom:4px` 抬到卡片左外侧、
 *   与 28px 的 `+` 垂直居中。
 * - **高度**：`min(50vh, 480px)` 或 `50vh`，公式在纯逻辑里（`drawerHeightCssOf`）。
 *
 * ## 受控
 *
 * 组件自己不持 `open`：`open` / `onToggle` / `onClose` 由调用方给。
 * 产品里两个槽通过同一个 `DrawerStore` 共享状态（`register-drawer.tsx`）；
 * 预览里用 `createDrawerStore` + `useDrawerStore`。
 *
 * ## 三个候选形态
 *
 * `variant` prop 决定图标 / 间距 / 圆角 / 高度 / 遮罩 / 动画（数值在
 * `pure/drawer-view.ts` 的 `DRAWER_VARIANTS`）。**不要替用户选** —— 预览页三列并排。
 */

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

import {
	closesDrawerOn,
	drawerVariantOf,
	isDrawerCloseKey,
} from '../pure/drawer-view.ts';
import type {
	DrawerHitTarget,
	DrawerIconId,
	DrawerStore,
	DrawerVariant,
} from '../pure/drawer-view.ts';
import { Workspace } from './Workspace.tsx';
import type { WorkspaceProps } from './Workspace.tsx';

/** 面板 DOM id —— 入口按钮的 `aria-controls` 指向它。 */
export const DRAWER_PANEL_ID = 'tb3d-drawer-panel';

/** 点外部时要跳过的 DOM 钩子：工作区的状态菜单 portal 到 body，但它属于抽屉。 */
const STATUS_MENU_SELECTOR = '[data-menu="status"]';

/** 入口按钮自己的 DOM 钩子（它自己 toggle，不能被「点外部」抢先关一次）。 */
const TRIGGER_SELECTOR = '[data-drawer-trigger]';

/* ══════════════════════════════════════════════════════════
   1. 入口（conversation.input.left）—— 正方形按钮
   ══════════════════════════════════════════════════════════ */

/** 入口按钮属性。 */
export interface DrawerEntryProps {
	/** 和面板**同一个** open 状态。 */
	readonly open: boolean;
	/** 和面板**同一个** toggle 动作。 */
	readonly onToggle: () => void;
	/** 候选形态（决定图标）。 */
	readonly variant: DrawerVariant;
	/** 无障碍名 / 悬停提示；省略 = 按开合状态给一句。 */
	readonly label?: string;
}

/**
 * 正方形入口 —— 用户图里输入框左外侧那颗 `▣`。
 *
 * @param props 见 `DrawerEntryProps`
 */
export function DrawerEntry(props: DrawerEntryProps): ReactNode {
	const label = props.label ?? (props.open ? '收起任务板抽屉' : '打开任务板抽屉');

	return (
		<button
			type="button"
			className="tb3d-entry"
			data-drawer-entry="1"
			data-drawer-trigger="entry"
			data-drawer-variant={props.variant.id}
			data-drawer-entry-icon={props.variant.icon}
			aria-expanded={props.open}
			aria-controls={DRAWER_PANEL_ID}
			aria-label={label}
			title={label}
			onClick={props.onToggle}
		>
			<EntryIcon icon={props.variant.icon} />
		</button>
	);
}

/* ══════════════════════════════════════════════════════════
   2. 面板（conversation.input.overlay）
   ══════════════════════════════════════════════════════════ */

/** 面板属性。 */
export interface DrawerProps {
	/** 是否打开（受控 —— 和入口按钮共用同一个状态）。 */
	readonly open: boolean;
	/** 关闭动作（Esc / 点外部 / ×）。 */
	readonly onClose: () => void;
	/** 候选形态（决定图标以外的一切视觉）。 */
	readonly variant: DrawerVariant;
	/**
	 * 面板里的**压缩版 Workspace** 的全部参数。
	 *
	 * 和右栏页签是同一个组件、同一份 props 形状；数据 / 回调由宿主给，
	 * 选中卡等 UI 状态由这个实例自己持（所以和页签那份互不影响）。
	 */
	readonly workspace: WorkspaceProps;
	/** 顶栏标题（默认「任务板」）。 */
	readonly title?: string;
	/** 顶栏 ⟳；省略 = 不画这个按钮（不知道刷新什么的时候不假装有）。 */
	readonly onRefresh?: () => void;
}

/**
 * 抽屉面板。
 *
 * @param props 见 `DrawerProps`
 */
export function Drawer(props: DrawerProps): ReactNode {
	const panelRef = useRef<HTMLElement>(null);

	/* 解构出来当 effect 依赖 —— 依赖 `props` 对象本身会让监听器每帧重挂。 */
	const { open, onClose } = props;

	/* ── Esc + 点外部：只在打开时挂监听，卸载时摘干净 ── */
	useEffect(() => {
		if (!open) return undefined;

		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.defaultPrevented) return;
			if (!isDrawerCloseKey(event.key, event.isComposing)) return;
			/*
			 * 状态菜单开着时，Esc 先归菜单（它自己有关闭逻辑）。
			 * 这里不抢 —— 否则用户按一下想收菜单，结果整个抽屉没了。
			 */
			if (document.querySelector(STATUS_MENU_SELECTOR) !== null) return;
			onClose();
		};

		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const panel = panelRef.current;
			const hit: DrawerHitTarget = {
				inPanel: panel !== null && panel.contains(target),
				inTrigger: target.closest(TRIGGER_SELECTOR) !== null,
				inStatusMenu: target.closest(STATUS_MENU_SELECTOR) !== null,
			};
			if (!closesDrawerOn(hit)) return;
			onClose();
		};

		/*
		 * capture 阶段挂：子元素就算 stopPropagation 也拦不住
		 * 「点外部 ⇒ 关」这条用户指令；但**不** preventDefault / stopPropagation，
		 * 所以被点的那一下照常生效（输入框仍然可点、可用）。
		 */
		document.addEventListener('keydown', onKeyDown);
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
			document.removeEventListener('pointerdown', onPointerDown, true);
		};
	}, [open, onClose]);

	/* ── 关闭态：什么都不渲染（不占位、不拦截事件；斜杠菜单同款约定） ── */
	if (!open) return null;

	const title = props.title ?? '任务板';

	return (
		/*
		 * 层：绝对定位、零高度 —— 正好长在 DSH 的 `.overlayAnchor` 里
		 * （`height:0;position:absolute;inset:0 0 auto`，宽度 = 输入框卡片宽）。
		 * 面板相对这一层 `bottom:100%` ⇒ 面板底边 = 输入框上边缘。
		 */
		<div className="tb3d-layer" data-drawer-layer="1">
			{props.variant.mask ? <div className="tb3d-mask" data-drawer-mask="1" /> : null}
			<section
				className="tb3d-panel"
				id={DRAWER_PANEL_ID}
				ref={panelRef}
				role="dialog"
				aria-label={title}
				aria-modal={props.variant.mask}
				data-drawer="1"
				data-drawer-variant={props.variant.id}
				data-drawer-gap={String(props.variant.gapPx)}
				data-drawer-radius={String(props.variant.radiusPx)}
				data-drawer-height={props.variant.heightMode}
				data-drawer-animated={String(props.variant.animated)}
			>
				<header className="tb3d-head" data-drawer-head="1">
					<span className="tb3d-head__title" data-drawer-title>
						{title}
					</span>
					<span className="tb3d-head__actions">
						{props.onRefresh === undefined ? null : (
							<button
								type="button"
								className="tb3d-iconbtn"
								data-drawer-refresh="1"
								aria-label="刷新"
								title="刷新"
								onClick={props.onRefresh}
							>
								<RefreshIcon />
							</button>
						)}
						<button
							type="button"
							className="tb3d-iconbtn"
							data-drawer-close="1"
							aria-label="关闭抽屉"
							title="关闭抽屉（Esc）"
							onClick={props.onClose}
						>
							<CloseIcon />
						</button>
					</span>
				</header>

				{/*
				 * ⚠ 这里**只有**一个 Workspace —— 没有第二份列表/详情代码。
				 *   压缩全靠 `.tb3d-panel` 作用域下的 CSS（`DRAWER_CSS`）。
				 */}
				<div className="tb3d-body" data-drawer-body="1">
					<Workspace {...props.workspace} />
				</div>
			</section>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   3. store ⇄ 组件（两个槽共享同一个 open 的接线）
   ══════════════════════════════════════════════════════════ */

/** `useDrawerStore()` 的返回值。 */
export interface DrawerBindings {
	/** 当前是否打开。 */
	readonly open: boolean;
	/** 当前形态（来自 store 的配置）。 */
	readonly variant: DrawerVariant;
	/** 开合翻面。 */
	readonly toggle: () => void;
	/** 只关。 */
	readonly close: () => void;
}

/**
 * 订阅一个 `DrawerStore`，得到两个槽共用的 `open`。
 *
 * ⚠ 产品里**两个槽各调一次**这个 hook、喂**同一个 store** ⇒ 入口与面板不可能不同步。
 *
 * @param store 共享 store（见 `pure/drawer-view.ts` 的 `createDrawerStore`）
 */
export function useDrawerStore(store: DrawerStore): DrawerBindings {
	const open = useSyncExternalStore(
		store.subscribe,
		() => store.getSnapshot().open,
		/* SSR：默认关着渲染（预览/断言里只看显式 open 的那份） */
		() => false,
	);
	return {
		open,
		variant: drawerVariantOf(store.variant),
		toggle: store.toggle,
		close: store.close,
	};
}

/* ══════════════════════════════════════════════════════════
   4. inline SVG（零依赖）
   ══════════════════════════════════════════════════════════ */

/**
 * 入口图标 —— 三个候选形态各一颗。
 *
 * @param props.icon 图标 id
 */
function EntryIcon(props: { readonly icon: DrawerIconId }): ReactNode {
	switch (props.icon) {
		case 'square':
			/* ▣：外框 + 内实心方块 */
			return (
				<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
					<rect
						x="3.25"
						y="3.25"
						width="13.5"
						height="13.5"
						rx="2.4"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
					/>
					<rect x="7.25" y="7.25" width="5.5" height="5.5" rx="1" fill="currentColor" />
				</svg>
			);
		case 'arrow-up':
			/* ▲：向上箭头（「从这里向上展开」）*/
			return (
				<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
					<path
						d="M10 16 V4.6 M5.2 9.4 L10 4.6 L14.8 9.4"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			);
		case 'dots':
			/* ⋯：三点（「更多」）*/
			return (
				<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
					<circle cx="4.6" cy="10" r="1.55" fill="currentColor" />
					<circle cx="10" cy="10" r="1.55" fill="currentColor" />
					<circle cx="15.4" cy="10" r="1.55" fill="currentColor" />
				</svg>
			);
	}
}

/** 刷新（顶栏那颗 ⟳）。 */
function RefreshIcon(): ReactNode {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M13.2 8a5.2 5.2 0 1 1-1.6-3.75"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
			<path
				d="M13.4 2.2v2.9h-2.9"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

/** 关闭 ×。 */
function CloseIcon(): ReactNode {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M4 4l8 8M12 4l-8 8"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
			/>
		</svg>
	);
}
