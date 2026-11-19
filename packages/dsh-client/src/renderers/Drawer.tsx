/**
 * 抽屉（V4）—— 会话级**底部浮层**，里面是**第二个 `<Workspace />` 实例**。
 *
 * ## 形状
 *
 * ```
 * ┌──────────────────────────── 1200 × 400（圆角 14、贴底居中）──────────────┐
 * │ 任务板                                            [⟳] [×]   ← 顶栏 36px     │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │ <Workspace />（第二个实例）                                                │
 * │   空间 chip 行 + 工具栏（列表 · 科技树 / 新建）                            │
 * │   ├ 左列表（宽版固定 320，自己滚）┬ 右详情（自己滚）┤                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## ⚠ 挂载点（查证过；完整证据在 `pure/drawer-view.ts` 文件头）
 *
 * 设计图（`X:\temp\view-4-drawer.svg:257`）写的是「挂 `shell.overlay`（root scope）」。
 * 对运行中的 DSH `app.asar` 做字节搜索：**`shell.overlay` 命中 165 处**，槽存在，
 * 官方 doc 原文是「Frame-wide floating layer, above every column and outside their
 * scroll containers… click-through — entries opt back into pointer events」；
 * 层实现是 `.overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}`
 * —— **absolute，不是 fixed**；子元素才 `pointer-events:auto`。
 *
 * ⇒ 本组件**不需要 `position:fixed`**（用户 `2026-11-19` 否掉了 fixed：会逃出父容器）。
 *   它是一棵「`absolute` 贴底」的子树 —— 宿主把它挂进 `shell.overlay` 就是帧级浮层：
 *
 *   ```ts
 *   ctx.slots.inject('shell.overlay', () => ctx.slots.register(
 *     { name: 'shell.overlay', id: 'taskboard3-drawer', order: 100 },
 *     DrawerEntry,   // DrawerEntry 里用 useBoardState / 宿主 store 喂 props
 *   ));
 *   ```
 *
 *   预览里挂在舞台里就是「tab 内浮起」。两种挂载**同一个组件、同一份 CSS**。
 *   产品接线（`client.tsx`）本任务没做 —— 本文件只交组件。
 *
 * ## 为什么是受控的 `open`
 *
 * 设计图 ②：输入框左侧 Chevron / 工具栏 / 右栏入口**共用同一个 open 状态**、
 * 派生**同一个动作**。所以本组件不自己持状态：
 *
 * ```tsx
 * const drawer = useDrawerState();          // 或宿主自己的 store
 * <DrawerToggle open={drawer.open} onToggle={drawer.toggle} />
 * <Drawer open={drawer.open} onClose={drawer.close} workspace={…} />
 * ```
 *
 * 两个入口都从**同一个 `drawer`** 取值 ⇒ 不可能各写一套开合逻辑。
 * 状态机本身在 `pure/drawer-view.ts`（纯函数，`node --test` 直接测）。
 *
 * ## 复用 `<Workspace />`，不复制
 *
 * 抽屉里**没有**第二套列表 / 详情 / 工具栏代码 —— 只有一个 `<Workspace {...workspace} />`。
 * 于是「选中卡、滚动位置、视图（列表 / 科技树）」天然各存一份（那是 `Workspace` 自持的 UI 状态），
 * 这就是设计图 ④ 的「状态独立」。压缩只发生在 CSS（`styles.ts` 的 `DRAWER_CSS`，作用域 `.tb3d-*`）。
 *
 * ## 关闭方式（设计图 ②）
 *
 * - 再点 Chevron：`toggle`（同一个动作）。
 * - **Esc**：`document` keydown，组字中不关（输入法 Esc 是取消候选词）。
 * - **点外部**：`document` pointerdown 判决；**不渲染遮罩** —— 设计图里抽屉下方的
 *   输入框「仍可用」（`view-4-drawer.svg:126`），遮罩会拦掉滚轮 / 点击，
 *   违反「不抢焦点、不锁页面滚动」。
 * - 不抢焦点：不做 `autoFocus` / `focus()`；打开后焦点留在原处。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import {
	DRAWER_CLOSE_EVENT,
	DRAWER_HEIGHT,
	DRAWER_OPEN_EVENT,
	DRAWER_TOGGLE_EVENT,
	DRAWER_WIDTH,
	closesDrawerOn,
	drawerTierOf,
	initialDrawerState,
	isDrawerCloseKey,
	reduceDrawer,
} from '../pure/drawer-view.ts';
import type { DrawerEvent, DrawerHitTarget, DrawerState } from '../pure/drawer-view.ts';
import { Workspace } from './Workspace.tsx';
import type { WorkspaceProps } from './Workspace.tsx';

/** 面板 DOM id —— `DrawerToggle` 的 `aria-controls` 指向它。 */
export const DRAWER_PANEL_ID = 'tb3d-drawer';

/** 点外部时要跳过的 DOM 钩子：工作区的状态菜单 portal 到 body，但它属于抽屉。 */
const STATUS_MENU_SELECTOR = '[data-menu="status"]';

/** 触发器自己的 DOM 钩子（它自己 toggle，不能被「点外部」抢先关一次）。 */
const TRIGGER_SELECTOR = '[data-drawer-trigger]';

/* ══════════════════════════════════════════════════════════
   1. 抽屉
   ══════════════════════════════════════════════════════════ */

/** 抽屉属性。 */
export interface DrawerProps {
	/** 是否打开（受控 —— 和 Chevron 共用同一个状态）。 */
	readonly open: boolean;
	/** 关闭动作（Esc / 点外部 / ×）。 */
	readonly onClose: () => void;
	/**
	 * **第二个 `<Workspace />` 实例**的全部参数。
	 *
	 * 和右栏页签是同一个组件、同一个 props 形状；数据 / 回调由宿主给，
	 * 选中卡等 UI 状态由这个实例自己持（所以和页签那份互不影响）。
	 */
	readonly workspace: WorkspaceProps;
	/** 顶栏标题（设计图上是「任务板」）。 */
	readonly title?: string;
	/** 顶栏 ⟳；省略 = 不画这个按钮（不知道刷新什么的时候不假装有）。 */
	readonly onRefresh?: () => void;
	/**
	 * 面板底边距**父容器**底边的距离（px）。
	 *
	 * 设计图把抽屉底边放在输入框上方 8px（`view-4-drawer.svg:242-245` 的 28 边距同理）——
	 * 那个值取决于宿主输入框多高，所以由宿主传；组件默认贴父容器底边 16px。
	 */
	readonly bottomOffset?: number;
}

/**
 * 抽屉。
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

	/* ── 关闭态：什么都不渲染（不占位、不拦截事件） ── */
	if (!open) return null;

	const title = props.title ?? '任务板';
	const bottomOffset = props.bottomOffset ?? 16;

	/*
	 * 底边距走 CSS 变量（`DRAWER_CSS` 里 `bottom:var(--tb3d-bottom,16px)` +
	 * `max-height:calc(100% - var(--tb3d-bottom,16px) - 12px)`），默认值 16 与 CSS 一致。
	 *
	 * ⚠ 这里必须有一个类型断言：React 的 `CSSProperties` **不收录自定义属性**
	 *   （`--x`）。这是外部类型的限制，不是我们想绕过检查 —— 变量名和 CSS 里的
	 *   `var(--tb3d-bottom)` 对应，改一处必须改两处（`DRAWER_CSS` 注释里也标了）。
	 */
	const style =
		bottomOffset === 16
			? undefined
			: ({ '--tb3d-bottom': `${String(bottomOffset)}px` } as CSSProperties);

	return (
		/*
		 * 层：`absolute` 撑满父容器、`pointer-events:none` ——
		 * 正好是 DSH `shell.overlay` 的约定（层本身穿透，面板自己 opt-in）。
		 * 预览里父容器是舞台，效果相同。
		 */
		<div className="tb3d-layer" data-drawer-layer="1">
			<section
				className="tb3d-panel"
				id={DRAWER_PANEL_ID}
				ref={panelRef}
				role="dialog"
				aria-label={title}
				aria-modal="false"
				data-drawer="1"
				data-drawer-tier={drawerTierOf(DRAWER_HEIGHT)}
				data-drawer-width={String(DRAWER_WIDTH)}
				data-drawer-height={String(DRAWER_HEIGHT)}
				style={style}
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
   2. 触发器（输入框左侧 Chevron）
   ══════════════════════════════════════════════════════════ */

/** Chevron 触发器属性。 */
export interface DrawerToggleProps {
	/** 和抽屉**同一个** open 状态。 */
	readonly open: boolean;
	/** 和抽屉**同一个** toggle 动作。 */
	readonly onToggle: () => void;
	/** 无障碍名 / 悬停提示；省略 = 按开合状态给一句。 */
	readonly label?: string;
}

/**
 * Chevron 触发器 —— 设计图 ② 里输入框左侧那颗按钮。
 *
 * 它和抽屉共用同一个 `open` / `toggle`；**不自己存状态**。
 *
 * @param props 见 `DrawerToggleProps`
 */
export function DrawerToggle(props: DrawerToggleProps): ReactNode {
	const label = props.label ?? (props.open ? '收起任务板抽屉' : '打开任务板抽屉');

	return (
		<button
			type="button"
			className="tb3d-trigger"
			data-drawer-trigger="chevron"
			data-drawer-open={String(props.open)}
			aria-expanded={props.open}
			aria-controls={DRAWER_PANEL_ID}
			aria-label={label}
			title={label}
			onClick={props.onToggle}
		>
			<svg
				className="tb3d-trigger__icon"
				width="20"
				height="20"
				viewBox="0 0 20 20"
				aria-hidden="true"
			>
				{/* 关着 = 朝上（可展开）；开着 = 朝下（可收起）。 */}
				<path
					d={props.open ? 'M5 7.5 L10 12.5 L15 7.5' : 'M5 12.5 L10 7.5 L15 12.5'}
					fill="none"
					stroke="currentColor"
					strokeWidth="1.7"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</button>
	);
}

/* ══════════════════════════════════════════════════════════
   3. 本地开合状态（预览 / 单挂点场景用）
   ══════════════════════════════════════════════════════════ */

/** `useDrawerState()` 的返回值。 */
export interface DrawerController {
	/** 当前是否打开。 */
	readonly open: boolean;
	/** 完整状态机状态（给需要断言/调试的调用点）。 */
	readonly state: DrawerState;
	/** 派发任意事件（一般不需要直接用）。 */
	readonly dispatch: (event: DrawerEvent) => void;
	/** 开合翻面 —— **三个入口共用这一个动作**。 */
	readonly toggle: () => void;
	/** 只开。 */
	readonly openDrawer: () => void;
	/** 只关。 */
	readonly close: () => void;
}

/**
 * 本地持一份开合状态。
 *
 * ⚠ 产品里如果有「多个插件挂载点共享状态」的需求，应该把状态放到宿主的
 *   store 里再分别传 `open` / `onToggle`；这个 hook 是给「一个组件树里
 *   同时有触发器和抽屉」的场景（预览、单页内集成）。
 *
 * @param initialOpen 初始是否打开
 */
export function useDrawerState(initialOpen = false): DrawerController {
	const [state, setState] = useState<DrawerState>(() => initialDrawerState(initialOpen));

	const dispatch = useCallback((event: DrawerEvent): void => {
		/* 无变化时 `reduceDrawer` 返回原对象 ⇒ React 直接跳过这次重渲染。 */
		setState((prev) => reduceDrawer(prev, event));
	}, []);

	const toggle = useCallback((): void => {
		dispatch(DRAWER_TOGGLE_EVENT);
	}, [dispatch]);
	const openDrawer = useCallback((): void => {
		dispatch(DRAWER_OPEN_EVENT);
	}, [dispatch]);
	const close = useCallback((): void => {
		dispatch(DRAWER_CLOSE_EVENT);
	}, [dispatch]);

	return { open: state.open, state, dispatch, toggle, openDrawer, close };
}

/* ══════════════════════════════════════════════════════════
   4. inline SVG（零依赖）
   ══════════════════════════════════════════════════════════ */

/** 刷新（设计图顶栏那颗 ⟳）。 */
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
