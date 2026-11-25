/**
 * **模块级抽屉状态** —— 入口按钮和面板是**两个独立的槽条目**，
 * 渲染在不同位置，不能靠 props 共享状态。
 *
 * ## 为什么不用 `inject(sessionId)`
 *
 * `register-drawer.tsx` 原来用 `inject: (sessionId) => ({ hooks: { drawer } })`
 * 让 DSH 按 session 注入 store。**实测崩了**（2026-11-23）：
 *
 * ```
 * TypeError: Cannot read properties of undefined (reading 'drawer')
 *   at DrawerEntrySlot / DrawerPanelSlot
 * slot entry crashed in 'conversation.input.left'
 * ```
 *
 * ⇒ DSH 调组件时 `props` 里没有 `hooks` —— 我们对 `inject` 的契约理解错了。
 *
 * ## 现在的做法（抄 `taskboard2`，它在 desktop profile 里跑着）
 *
 * 模块级变量 + 订阅（`packages/ui/client.js:27-39`）：
 *
 * ```js
 * let drawerOpen = false;
 * const drawerListeners = new Set();
 * const setDrawerOpen = (next) => { drawerOpen = next; for (const l of drawerListeners) l(); };
 * const useDrawerOpen = () => useSyncExternalStore(subscribe, () => drawerOpen, () => false);
 * ```
 *
 * ⇒ 一个模块只有一份「开着吗」，两个槽各自 `useSyncExternalStore` 它 ——
 *   **不可能出现「入口开了、面板不知道」**，也不需要 DSH 注入任何东西。
 *
 * ⚠ 副作用：多个会话同时开抽屉会共享同一个状态。产品里 DSH 一次只显示一个
 *   会话的 composer，所以这不是问题；且 `taskboard2` 已经这样跑着。
 */

import { useSyncExternalStore } from 'react';

/** 抽屉是否打开（模块级唯一真值）。 */
let drawerOpen = false;

// TODO(审查): 本文件的 listeners/subscribe/useSyncExternalStore 样板与 permission-box-state.ts、ui-state-store.ts 重复三份；可抽一个 `createExternalStore<T>()` 统一（可直接改，低风险）。另「多会话共享同一 drawerOpen」是已知副作用（见上方注释），是否需要按会话隔离需用户决定。
/** 订阅者（两个槽各一个 React 实例）。 */
const listeners = new Set<() => void>();

/**
 * 设置开合状态并广播。
 *
 * @param next 打开吗
 */
export function setDrawerOpen(next: boolean): void {
	if (drawerOpen === next) return;
	drawerOpen = next;
	for (const listener of listeners) listener();
}

/**
 * 切换开合。
 */
export function toggleDrawer(): void {
	setDrawerOpen(!drawerOpen);
}

/**
 * 关掉（Esc / 点外部 / ×）。
 */
export function closeDrawer(): void {
	setDrawerOpen(false);
}

/**
 * 订阅变化 —— `useSyncExternalStore` 用；也供测试直接观察广播。
 *
 * @param listener 回调
 * @returns 退订函数
 */
export function subscribeDrawer(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * 读当前状态 —— `useSyncExternalStore` 用；也供测试直接断言。
 *
 * @returns 打开吗
 */
export function isDrawerOpen(): boolean {
	return drawerOpen;
}

/**
 * SSR 快照 —— 服务端渲染时一律「关着」（和 `useDrawerStore` 同一取舍）。
 *
 * @returns 恒 `false`
 */
function getServerSnapshot(): boolean {
	return false;
}

/**
 * 读抽屉开合状态的 React hook。
 *
 * @returns 打开吗
 */
export function useDrawerOpen(): boolean {
	return useSyncExternalStore(subscribeDrawer, isDrawerOpen, getServerSnapshot);
}
