/**
 * card 轴（`cardActionLevel`）的**模块级状态** —— `CardActionControl` 的唯一数据入口。
 *
 * ## 为什么存在（2026-11-27，#4 分包裁定之后的拆分）
 *
 * 原先这里和 composer 权限框共用 `pure/permission-box-state.ts` 的两轴 store。
 * 权限框已搬去 `@taskboard/dsh-permissions`，本包**不能 import 那个包**（方向反了：
 * 一般 UI 行必须能在权限行关闭时独立工作）⇒ card 轴自建一个单轴 store。
 *
 * ## 与旧 store 的语义差异（只有一条，故意的）
 *
 * - 旧：composer 权限面板改了 card 轴，工具栏控件**立即**跟着变（共享 store）。
 * - 新：两个 store 各自独立。**跨面不再实时同步** —— 补偿是 `refreshCardPermission()`：
 *   `CardActionControl` 每次打开下拉都强制重拉一次（见组件里的调用）。
 *   关闭着的显示面晚一拍，打开的那刻一定是对的。
 *
 * ## 语义保持（逐条对应旧实现）
 *
 * · GET `/permission`（两轴一起回，本 store 只读 card 轴字段）；
 * · POST **只带 `cardActionLevel`**（PATCH 语义 —— 两轴正交在网络层的落点）；
 * · 四个「不发」：没就绪 / 点的就是当前档 / 已有保存在飞 / 值不在选项表；
 * · 乐观更新 + 失败回滚（`beginSave` 语义），保存中整条轴锁；
 * · `ensureCardPermissionLoaded()` 幂等 + 在飞闸 + `load-error` 可重试；
 * · `api === null`（还没 attach）时**不进 `load-error`** —— 不污染 store。
 */

import { useSyncExternalStore } from 'react';

import type { TaskboardApi } from '../api.ts';
import { labelOf, type CardActionOption } from './card-permission.ts';

/** 一次正在进行的保存。 */
interface CardPending {
	/** 想改成哪一档。 */
	readonly value: string;
	/** 改之前是哪一档（失败时回滚到它）。 */
	readonly previousLevel: string;
}

/** 数据已加载。 */
interface CardReady {
	readonly phase: 'ready';
	readonly level: string;
	readonly options: readonly CardActionOption[];
	/** 在飞的保存；`null` = 没有。 */
	readonly pending: CardPending | null;
	/** 最近一次保存失败的提示；`null` = 没有错误。 */
	readonly saveError: { readonly message: string } | null;
}

/** 正在 GET。 */
interface CardLoading {
	readonly phase: 'loading';
}

/** GET 失败（可重试）。 */
interface CardLoadError {
	readonly phase: 'load-error';
	readonly message: string;
}

/** card 轴 store 的完整状态。 */
export type CardPermissionState = CardLoading | CardLoadError | CardReady;

let store: CardPermissionState = { phase: 'loading' };

/** 注入的 API（`client.tsx` 注册时给；测试可换成假的）。 */
let api: TaskboardApi | null = null;

/** 订阅者。 */
const listeners = new Set<() => void>();

/** 写状态并广播。 */
function set(next: CardPermissionState): void {
	store = next;
	for (const listener of listeners) listener();
}

/**
 * 装 API（`client.tsx` 注册时调一次）。
 *
 * @param impl 任务板 API
 */
export function attachCardPermissionApi(impl: TaskboardApi): void {
	api = impl;
}

/** 拉一次 card 轴。失败 ⇒ `load-error`。 */
async function loadCardPermission(): Promise<void> {
	if (api === null) {
		set({ ...store, phase: 'load-error', message: '还没接上任务板服务。' } as CardPermissionState);
		return;
	}
	set({ phase: 'loading' });
	try {
		const data = await api.getPermission();
		if (store.phase !== 'loading') return;
		set({
			phase: 'ready',
			level: data.cardActionLevel,
			options: data.cardActionOptions,
			pending: null,
			saveError: null,
		});
	} catch (cause) {
		set({ phase: 'load-error', message: cause instanceof Error ? cause.message : String(cause) });
	}
}

/** 在飞闸。 */
let inFlight = false;

/**
 * 「确保已经拉过一次」—— 控件挂载就要显示当前档 ⇒ 一渲染就调它。
 *
 * 幂等：已 ready / 在飞 ⇒ 直接返回；`load-error` ⇒ 允许重试。
 * ⚠ `api === null` 时什么都不做 —— 不进 `load-error`（不污染 store）。
 */
export async function ensureCardPermissionLoaded(): Promise<void> {
	if (api === null || inFlight || store.phase === 'ready') return;
	inFlight = true;
	try {
		await loadCardPermission();
	} finally {
		inFlight = false;
	}
}

/**
 * 强制重拉一次 —— 打开下拉时调。
 *
 * 这是拆分后的**补偿机制**：composer 权限面板（另一个包）改了 card 轴时
 * 本 store 不会收到通知；每次打开下拉重拉一次，保证用户看到的至少是
 * 「打开那一刻」的正确值。
 */
export async function refreshCardPermission(): Promise<void> {
	if (api === null) return;
	if (inFlight) return;
	inFlight = true;
	try {
		await loadCardPermission();
	} finally {
		inFlight = false;
	}
}

/**
 * 点了某一档 ⇒ 乐观更新 + POST（只带 cardActionLevel）+ 成功覆盖 / 失败回滚。
 *
 * 四个「不发」同旧实现：没就绪 / 同值 / 已在飞 / 值不在选项表。
 *
 * @param value 新档位
 */
export async function selectCardPermissionLevel(value: string): Promise<void> {
	if (store.phase !== 'ready') return;
	if (store.pending !== null) return;
	if (store.level === value) return;
	if (!store.options.some((one) => one.value === value)) return;

	/* 乐观：选中态立刻变；记下回滚点。 */
	const before = store.level;
	set({ ...store, level: value, pending: { value, previousLevel: before }, saveError: null });
	const saving = store;

	if (api === null) {
		set({ ...saving, pending: null, level: before, saveError: { message: '还没接上任务板服务。' } });
		return;
	}

	try {
		const levels = await api.setPermission({ cardActionLevel: value });
		/*
		 * 回声到达时这条保存可能已经不在 pending（比如中途 refresh 重置过 store）
		 * —— 那就别回写（同旧实现的 commitSave 判定）。
		 */
		const now = cardPermissionStore();
		if (now.phase !== 'ready') return;
		const current = now.pending;
		if (current === null || current.value !== value) return;
		set({ ...now, level: levels.cardActionLevel, pending: null, saveError: null });
	} catch (cause) {
		const now = cardPermissionStore();
		if (now.phase !== 'ready') return;
		const failed = now.pending;
		if (failed === null || failed.value !== value) return;
		const reason = cause instanceof Error ? cause.message : String(cause);
		set({
			...now,
			level: failed.previousLevel,
			pending: null,
			saveError: { message: `保存失败：${reason}。已回滚到「${labelOf(now.options, failed.previousLevel)}」。` },
		});
	}
}

/** 关掉保存失败提示（回滚已发生，只清提示）。 */
export function dismissCardPermissionSaveError(): void {
	if (store.phase !== 'ready' || store.saveError === null) return;
	set({ ...store, saveError: null });
}

/** 读当前状态 —— `useSyncExternalStore` 用；也供测试直接断言。 */
export function cardPermissionStore(): CardPermissionState {
	return store;
}

/**
 * 订阅变化。
 *
 * @param listener 回调
 * @returns 退订函数
 */
export function subscribeCardPermission(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** SSR 快照 —— 服务端渲染时一律「加载中」。 */
const SERVER_SNAPSHOT: CardPermissionState = { phase: 'loading' };

function getServerSnapshot(): CardPermissionState {
	return SERVER_SNAPSHOT;
}

/** 读 card 轴状态的 React hook。 */
export function useCardPermission(): CardPermissionState {
	return useSyncExternalStore(subscribeCardPermission, cardPermissionStore, getServerSnapshot);
}

/**
 * 测试用：把模块级状态恢复成初始值。
 *
 * ⚠ 只给测试调 —— 产品里没有「重置权限」这回事。
 */
export function resetCardPermissionForTest(): void {
	store = { phase: 'loading' };
	api = null;
	inFlight = false;
	listeners.clear();
}
