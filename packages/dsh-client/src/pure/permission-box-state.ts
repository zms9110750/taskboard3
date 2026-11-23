/**
 * 权限框的**模块级状态** —— 入口按钮和全屏页是两个独立的槽条目，
 * 渲染在不同位置，不能靠 props 共享状态。
 *
 * ## 为什么模块级（和 `drawer-state.ts` 同一套理由）
 *
 * 试过用 `inject: (sessionId) => ({ hooks: {...} })` 让 DSH 注入 store，
 * **实测崩了**（2026-11-23）：
 *
 * ```
 * TypeError: Cannot read properties of undefined (reading 'drawer')
 * slot entry crashed in 'conversation.input.left'
 * ```
 *
 * ⇒ DSH 调组件时 `props` 里没有 `hooks`。现在的做法是模块级变量 + 订阅，
 * 两个槽各自 `useSyncExternalStore` 它 —— `taskboard2` 在同版本 DSH 里就是这么跑的。
 *
 * ## 职责
 *
 * · 持有两轴快照 + 保存中的 pending（数据形状来自 `permission-view.ts`）
 * · 把「用户点了某一档」翻译成一次 POST（PATCH 语义，只发那一条轴）
 * · 加载失败可重试；保存失败由 `failSave()` 回滚
 *
 * ## 不做什么
 *
 * 不判「这一档能不能点」—— 那是 `permission-view.ts` 的
 * `shouldSaveOnSelect()` 的事，本文件只调它。
 */

import { useSyncExternalStore } from 'react';

import type { TaskboardApi } from '../api.ts';
import {
	beginSave,
	commitSave,
	failSave,
	dismissSaveError,
	type AxisKey,
	type PanelState,
	type PermissionSnapshot,
	requestBodyOf,
	shouldSaveOnSelect,
} from './permission-view.ts';

/** 模块级唯一真值。 */
interface BoxStore {
	/** 全屏页开着吗。 */
	readonly open: boolean;
	/** 面板状态（`PermissionPanel` 的唯一数据入口）。 */
	readonly state: PanelState;
}

let store: BoxStore = {
	open: false,
	state: { phase: 'loading' },
};

/** 注入的 API（`client.tsx` 注册时给；测试可换成假的）。 */
let api: TaskboardApi | null = null;

/** 订阅者（入口按钮 + 全屏页各一个 React 实例）。 */
const listeners = new Set<() => void>();

/**
 * 写状态并广播。
 *
 * @param next 新状态
 */
function set(next: BoxStore): void {
	store = next;
	for (const listener of listeners) listener();
}

/** 只改 `open`，`state` 原样保留。 */
function setOpen(open: boolean): void {
	set({ ...store, open });
}

/**
 * 装 API（注册时调一次）。
 *
 * @param impl 任务板 API
 */
export function attachPermissionApi(impl: TaskboardApi): void {
	api = impl;
}

/**
 * 拉一次两轴档位。
 *
 * 成功 ⇒ `ready`；失败 ⇒ `load-error`（面板显示「重试」）。
 * 已经在加载中时重复调用不会叠加请求（服务端不受影响，但没必要）。
 */
export async function loadPermission(): Promise<void> {
	if (api === null) {
		set({ ...store, state: { phase: 'load-error', message: '还没接上任务板服务。' } });
		return;
	}
	set({ ...store, state: { phase: 'loading' } });
	try {
		const data = await api.getPermission();
		set({
			...store,
			state: {
				phase: 'ready',
				snapshot: data satisfies PermissionSnapshot,
				pending: { card: null, tool: null },
				saveError: null,
			},
		});
	} catch (cause) {
		set({
			...store,
			state: {
				phase: 'load-error',
				message: cause instanceof Error ? cause.message : String(cause),
			},
		});
	}
}

/**
 * 「确保已经拉过一次」—— 工具栏那个领卡控件用。
 *
 * ## 为什么需要它（和 `openPermissionBox()` 的区别）
 *
 * `openPermissionBox()` 是「打开全屏页」，会顺带拉数据；
 * 但工具栏上的 `CardActionControl` **不打开任何页面**，它挂在任务板工具栏里，
 * 一渲染就要显示当前档位 ⇒ 需要一个「只拉数据、不开页面」的入口。
 *
 * ## 幂等
 *
 * · 已 `ready` ⇒ 直接返回（不重复请求）
 * · 正在飞的请求还在 ⇒ 直接返回（三个入口各挂一个控件，会同时调它，
 *   没有这个闸就是三倍请求）
 * · 上次失败（`load-error`）⇒ **允许重试**（否则一次网络抖动就永远空着）
 *
 * ⚠ `api === null`（还没 `attachPermissionApi`）时什么都不做 —— 不进入
 *   `load-error`，否则模块级 store 会被这个「还没接上」污染，
 *   后面 `openPermissionBox()` 会显示假的错误。
 */
let inFlight = false;

export async function ensurePermissionLoaded(): Promise<void> {
	if (api === null || inFlight || store.state.phase === 'ready') return;
	inFlight = true;
	try {
		await loadPermission();
	} finally {
		inFlight = false;
	}
}

/**
 * 打开全屏权限页。
 *
 * ⚠ 打开时才 `loadPermission()` —— 不是启动就拉。
 *   大多数会话从不改权限，启动就拉是白花一次请求。
 */
export function openPermissionBox(): void {
	setOpen(true);
	void loadPermission();
}

/** 关掉全屏页。 */
export function closePermissionBox(): void {
	setOpen(false);
}

/** 切换（入口按钮点一下开、再点一下关）。 */
export function togglePermissionBox(): void {
	if (store.open) closePermissionBox();
	else openPermissionBox();
}

/**
 * 用户点了某一档 ⇒ 乐观更新 + POST + 成功覆盖 / 失败回滚。
 *
 * 判决（能不能点）全在 `shouldSaveOnSelect()`；本函数只执行。
 *
 * @param axis 哪条轴
 * @param value 新档位
 */
export async function selectPermissionLevel(axis: AxisKey, value: string): Promise<void> {
	const before = store.state;
	if (!shouldSaveOnSelect(before, axis, value)) return;

	/* ① 乐观：选中态立刻变（`beginSave` 记下 previousLevel 供回滚）。 */
	set({ ...store, state: beginSave(before, axis, value) });
	const saving = store.state;

	if (api === null) {
		set({ ...store, state: failSave(saving, axis, '还没接上任务板服务。') });
		return;
	}

	try {
		const levels = await api.setPermission(requestBodyOf(axis, value));
		set({ ...store, state: commitSave(store.state, axis, levels) });
	} catch (cause) {
		set({
			...store,
			state: failSave(store.state, axis, cause instanceof Error ? cause.message : String(cause)),
		});
	}
}

/** 关掉保存失败横幅（回滚已经发生，只清提示）。 */
export function dismissPermissionSaveError(): void {
	set({ ...store, state: dismissSaveError(store.state) });
}

/** 读当前状态 —— `useSyncExternalStore` 用；也供测试直接断言。 */
export function permissionBoxStore(): BoxStore {
	return store;
}

/**
 * 订阅变化。
 *
 * @param listener 回调
 * @returns 退订函数
 */
export function subscribePermissionBox(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** SSR 快照 —— 服务端渲染时一律「关着 + 加载中」。 */
const SERVER_SNAPSHOT: BoxStore = { open: false, state: { phase: 'loading' } };

function getServerSnapshot(): BoxStore {
	return SERVER_SNAPSHOT;
}

/**
 * 读权限框状态的 React hook。
 *
 * @returns `{ open, state }`
 */
export function usePermissionBox(): BoxStore {
	return useSyncExternalStore(subscribePermissionBox, permissionBoxStore, getServerSnapshot);
}

/**
 * 测试用：把模块级状态恢复成初始值。
 *
 * ⚠ 只给测试调 —— 产品里没有「重置权限」这回事。
 */
export function resetPermissionBoxForTest(): void {
	store = { open: false, state: { phase: 'loading' } };
	api = null;
	inFlight = false;
	listeners.clear();
}
