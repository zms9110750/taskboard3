/**
 * 两个 composer 槽的**注册代码** —— 照 DSH 斜杠命令菜单 / 反馈弹窗的写法。
 *
 * ## 槽（已查证，asar 原文见 `pure/drawer-view.ts` 文件头）
 *
 * | 部件 | 槽 | kind / scope |
 * |---|---|---|
 * | 正方形入口 | `conversation.input.left` | list / session |
 * | 抽屉面板 | `conversation.input.overlay` | list / session |
 *
 * ## 为什么写成函数（而不是在 `client.tsx` 里直接注册）
 *
 * 面板里要放一个**真的 `<Workspace />`**，而 Workspace 的数据 / 回调目前由宿主
 * （页签 body）持 —— 本包还没有「把同一份数据也给抽屉」的接线。
 * ⇒ 先把注册做成一个可复用的函数，参数里要 `WorkspaceProps`；
 *   产品接线的人在拿到数据后调一行即可：
 *
 * ```ts
 * registerDrawerSlots(ctx, { workspace: drawerWorkspaceProps })
 * ```
 *
 * **本任务没有在 `client.tsx` 里调用它**（数据源未定，见报告「没做到」）。
 *
 * ## 两个槽怎么共享一个 `open`
 *
 * 入口与面板是**两个独立的 slot 条目**，渲染位置不同，不能靠 props 共享状态。
 * 而用户要求「点入口开 / 再点关 / Esc 关」是**同一个状态**。
 *
 * ⇒ 本文件按 session 各造一个 `DrawerStore`（`pure/drawer-view.ts`），两个槽的
 *   `inject(sessionId)` 从**同一个 Map** 取 —— 于是它们拿到的是**同一个对象**，
 *   不可能出现「入口开了、面板不知道」。单测 `test/register-drawer.test.ts` 钉住这条。
 *
 * ## 与斜杠菜单写法的逐行对应
 *
 * ```
 * scope.slots.inject('conversation.input.overlay', () => scope.slots.register({
 *   name: 'conversation.input.overlay',
 *   id: 'command-popup',
 *   order: 1,
 *   locale: NS,
 *   inject: (sessionId) => { … },
 * }, PopupSelectView))
 * ```
 *
 * 这里没有 `locale`（文案直接写中文，MVP 约定）；`inject` 返回 `{ hooks, … }`。
 */

import type { Context } from '@deepseek-ai/cordis';
import type { ReactNode } from 'react';

import { createDrawerStore, DRAWER_DEFAULT_VARIANT_ID } from './pure/drawer-view.ts';
import type { DrawerStore, DrawerVariantId } from './pure/drawer-view.ts';
import { DRAWER_PANEL_ID, Drawer, DrawerEntry, useDrawerStore } from './renderers/Drawer.tsx';
import type { WorkspaceProps } from './renderers/Workspace.tsx';

/** 入口按钮注册进哪个槽。 */
export const DRAWER_ENTRY_SLOT = 'conversation.input.left';

/** 抽屉面板注册进哪个槽。 */
export const DRAWER_PANEL_SLOT = 'conversation.input.overlay';

/** 入口条目 id（list 槽内唯一）。 */
export const DRAWER_ENTRY_REGISTRATION_ID = 'taskboard3-drawer-entry';

/** 面板条目 id（list 槽内唯一）。 */
export const DRAWER_PANEL_REGISTRATION_ID = 'taskboard3-drawer-panel';

/** 入口排序（同槽里越靠前越靠左）。 */
export const DRAWER_ENTRY_ORDER = 100;

/**
 * 面板排序 —— 和斜杠菜单（0）、命令弹窗（1）、反馈弹窗（2）同槽。
 * 我们排后面：任务板抽屉是「大面板」，让菜单优先命中。
 */
export const DRAWER_PANEL_ORDER = 50;

/** `registerDrawerSlots()` 的参数。 */
export interface DrawerSlotOptions {
	/** 面板里那个压缩版 `<Workspace />` 的数据 / 回调（宿主给）。 */
	readonly workspace: WorkspaceProps;
	/** 候选形态；不传 = `DRAWER_DEFAULT_VARIANT_ID`（占位，等用户裁定）。 */
	readonly variant?: DrawerVariantId;
	/** 顶栏标题。 */
	readonly title?: string;
	/** 顶栏刷新回调（省略 = 不画刷新按钮）。 */
	readonly onRefresh?: () => void;
}

/** 两个槽共同的注入形状：一份共享 store。 */
export interface DrawerInjected {
	readonly hooks: {
		readonly drawer: DrawerStore;
	};
}

/** 面板槽的注入形状：共享 store + Workspace 数据。 */
export interface DrawerPanelInjected extends DrawerInjected {
	readonly workspace: WorkspaceProps;
	readonly title?: string;
	readonly onRefresh?: () => void;
}

/**
 * 入口槽的组件 —— 把 store 接到受控的 `<DrawerEntry>`。
 *
 * @param props DSH 按 `inject(sessionId)` 的结果注入
 */
export function DrawerEntrySlot(props: DrawerInjected): ReactNode {
	const drawer = useDrawerStore(props.hooks.drawer);
	return <DrawerEntry open={drawer.open} onToggle={drawer.toggle} variant={drawer.variant} />;
}

/**
 * 面板槽的组件 —— 把 store 接到受控的 `<Drawer>`。
 *
 * @param props DSH 按 `inject(sessionId)` 的结果注入
 */
export function DrawerPanelSlot(props: DrawerPanelInjected): ReactNode {
	const drawer = useDrawerStore(props.hooks.drawer);
	return (
		<Drawer
			open={drawer.open}
			onClose={drawer.close}
			variant={drawer.variant}
			workspace={props.workspace}
			{...(props.title === undefined ? {} : { title: props.title })}
			{...(props.onRefresh === undefined ? {} : { onRefresh: props.onRefresh })}
		/>
	);
}

/**
 * 注册「入口 + 面板」两个槽。
 *
 * ⚠ 必须在 slots 服务可用之后调（`client.tsx` 的 `apply(ctx)` 里就可以）。
 *   注册本身跟随 owner 声明的坍缩 / 恢复（`slots.inject` 的语义，见边栏 tab 的写法）。
 *
 * @param ctx 客户端上下文
 * @param options Workspace 数据 + 形态
 */
export function registerDrawerSlots(ctx: Context, options: DrawerSlotOptions): void {
	const variant = options.variant ?? DRAWER_DEFAULT_VARIANT_ID;

	/*
	 * sessionId → store。两个槽的 inject 都从这里取 ⇒ 同一 session 拿到**同一个对象**。
	 * 用 Map 而不是 WeakMap：sessionId 是字符串；Map 在插件卸载时随闭包一起释放。
	 */
	const stores = new Map<string, DrawerStore>();

	/**
	 * 取这个 session 的 store（没有就造）。
	 *
	 * @param sessionId 会话 id
	 */
	const storeOf = (sessionId: string): DrawerStore => {
		const existing = stores.get(sessionId);
		if (existing !== undefined) return existing;
		const created = createDrawerStore(variant);
		stores.set(sessionId, created);
		return created;
	};

	/* ── ① 入口按钮：conversation.input.left ── */
	ctx.slots.inject(DRAWER_ENTRY_SLOT, () =>
		ctx.slots.register(
			{
				name: DRAWER_ENTRY_SLOT,
				id: DRAWER_ENTRY_REGISTRATION_ID,
				order: DRAWER_ENTRY_ORDER,
				label: '任务板抽屉',
				inject: (sessionId: string): DrawerInjected => ({
					hooks: { drawer: storeOf(sessionId) },
				}),
			},
			DrawerEntrySlot,
		),
	);

	/* ── ② 面板：conversation.input.overlay ── */
	ctx.slots.inject(DRAWER_PANEL_SLOT, () =>
		ctx.slots.register(
			{
				name: DRAWER_PANEL_SLOT,
				id: DRAWER_PANEL_REGISTRATION_ID,
				order: DRAWER_PANEL_ORDER,
				label: '任务板抽屉面板',
				inject: (sessionId: string): DrawerPanelInjected => ({
					hooks: { drawer: storeOf(sessionId) },
					workspace: options.workspace,
					...(options.title === undefined ? {} : { title: options.title }),
					...(options.onRefresh === undefined ? {} : { onRefresh: options.onRefresh }),
				}),
			},
			DrawerPanelSlot,
		),
	);
}

/**
 * 面板 DOM id —— 入口的 `aria-controls` 指向它（从组件模块 re-export，方便调用方断言）。
 */
export { DRAWER_PANEL_ID };
