/**
 * 两个 composer 槽的**注册代码**。
 *
 * ## 槽（已查证）
 *
 * | 部件 | 槽 | 说明 |
 * |---|---|---|
 * | 入口按钮 | `conversation.input.left` | composer 工具行左侧 |
 * | 抽屉面板 | `conversation.input.overlay` | composer 卡片内的浮层 |
 *
 * 依据：`pure/drawer-view.ts` 文件头记的 asar 原文 + `taskboard2`
 * （`packages/ui/client.js:224-238`）在 desktop profile 里跑着同样的两个槽。
 *
 * ## ⚠ 为什么不用 `inject(sessionId)` 共享 store（2026-11-23 实测崩了）
 *
 * 原来的写法：
 *
 * ```ts
 * ctx.slots.register({
 *   name: SLOT, id: X, order: N,
 *   inject: (sessionId) => ({ hooks: { drawer: storeOf(sessionId) } }),
 * }, DrawerEntrySlot);
 * ```
 *
 * 实测报错：
 *
 * ```
 * TypeError: Cannot read properties of undefined (reading 'drawer')
 * slot entry crashed in 'conversation.input.left'
 * ```
 *
 * ⇒ DSH 渲染我们的组件时 `props.hooks` 是 `undefined` —— 我们对 `inject`
 *   的契约理解错了。
 *
 * **现在的做法**：模块级状态（`pure/drawer-state.ts`）+ 两个槽各自
 * `useDrawerOpen()`。抄 `taskboard2` 的 `drawerOpen` + `drawerListeners`，
 * 那份代码在同版本 DSH 里跑着 ⇒ 这条路是验证过的。
 *
 * ## 内容为什么是 `content: ReactNode`
 *
 * 原来收一整套 `WorkspaceProps`（数据 + 回调），**那正是接不上的原因**：
 * 宿主拼不出 `WorkspaceProps`（`useBoardState()` 的结果在 `WorkspaceBody` 内部）。
 * ⇒ 现在只传一段内容：产品传 `<WorkspaceBody />`（自己拉数据），
 *   Drawer 只管外壳（遮罩 / Esc / 点外部 / 定位 / 顶栏）。
 */

import type { Context } from '@deepseek-ai/cordis';
import type { ReactNode } from 'react';

import { closeDrawer, toggleDrawer, useDrawerOpen } from './pure/drawer-state.ts';
import { DRAWER_DEFAULT_VARIANT_ID, DRAWER_VARIANTS } from './pure/drawer-view.ts';
import type { DrawerVariantId } from './pure/drawer-view.ts';
import { DRAWER_PANEL_ID, Drawer, DrawerEntry } from './renderers/Drawer.tsx';

/** 入口按钮注册进哪个槽。 */
export const DRAWER_ENTRY_SLOT = 'conversation.input.left';

/** 抽屉面板注册进哪个槽。 */
export const DRAWER_PANEL_SLOT = 'conversation.input.overlay';

/** 入口条目 id（同槽内唯一）。 */
export const DRAWER_ENTRY_REGISTRATION_ID = 'taskboard3-drawer-entry';

/** 面板条目 id（同槽内唯一）。 */
export const DRAWER_PANEL_REGISTRATION_ID = 'taskboard3-drawer-panel';

/** 入口排序（同槽里越靠前越靠左）。 */
export const DRAWER_ENTRY_ORDER = 100;

/** 面板排序 —— 让斜杠菜单（0）、命令弹窗（1）、反馈弹窗（2）优先命中。 */
export const DRAWER_PANEL_ORDER = 50;

/** `registerDrawerSlots()` 的参数。 */
export interface DrawerSlotOptions {
	/**
	 * 面板内容 —— 产品传 `createElement(WorkspaceBody)`。
	 *
	 * 内容组件自己 `useBoardState()`，所以不需要宿主喂数据。
	 */
	readonly content: ReactNode;
	/** 候选形态；不传 = `DRAWER_DEFAULT_VARIANT_ID`。 */
	readonly variant?: DrawerVariantId;
	/** 顶栏标题。 */
	readonly title?: string;
}

/**
 * 入口槽的组件 —— 受控的 `<DrawerEntry>`，状态来自模块级 store。
 *
 * @returns 入口按钮
 */
export function DrawerEntrySlot(): ReactNode {
	const open = useDrawerOpen();
	const variant = DRAWER_VARIANT;
	return <DrawerEntry open={open} onToggle={toggleDrawer} variant={variant} />;
}

/** 面板槽的组件工厂 —— 需要拿到 `content`（由 `registerDrawerSlots` 闭包给）。 */
export interface DrawerPanelSlotProps {
	readonly content: ReactNode;
	readonly variant: DrawerVariantId;
	readonly title?: string;
}

/**
 * 面板槽的组件 —— 受控的 `<Drawer>`，状态来自模块级 store。
 *
 * @param props 内容 + 形态
 * @returns 抽屉面板
 */
export function DrawerPanelSlot(props: DrawerPanelSlotProps): ReactNode {
	const open = useDrawerOpen();
	return (
		<Drawer
			open={open}
			onClose={closeDrawer}
			variant={DRAWER_VARIANTS[props.variant]}
			{...(props.title === undefined ? {} : { title: props.title })}
		>
			{props.content}
		</Drawer>
	);
}

/** 默认形态。 */
const DRAWER_VARIANT = DRAWER_VARIANTS[DRAWER_DEFAULT_VARIANT_ID];

/**
 * 注册「入口 + 面板」两个槽。
 *
 * ⚠ 必须在 slots 服务可用之后调（`client.tsx` 的 `apply(ctx)` 里就可以）。
 *
 * @param ctx 客户端上下文
 * @param options 内容 + 形态
 */
export function registerDrawerSlots(ctx: Context, options: DrawerSlotOptions): void {
	const variant = options.variant ?? DRAWER_DEFAULT_VARIANT_ID;
	const title = options.title ?? '任务板';

	/* ── ① 入口按钮：conversation.input.left ── */
	ctx.slots.inject(DRAWER_ENTRY_SLOT, () =>
		ctx.slots.register(
			{ name: DRAWER_ENTRY_SLOT, id: DRAWER_ENTRY_REGISTRATION_ID, order: DRAWER_ENTRY_ORDER },
			DrawerEntrySlot,
		),
	);

	/* ── ② 面板：conversation.input.overlay ── */
	ctx.slots.inject(DRAWER_PANEL_SLOT, () =>
		ctx.slots.register(
			{ name: DRAWER_PANEL_SLOT, id: DRAWER_PANEL_REGISTRATION_ID, order: DRAWER_PANEL_ORDER },
			() => <DrawerPanelSlot content={options.content} variant={variant} title={title} />,
		),
	);
}

/**
 * 面板 DOM id —— 入口的 `aria-controls` 指向它（从组件模块 re-export，方便断言）。
 */
export { DRAWER_PANEL_ID };
