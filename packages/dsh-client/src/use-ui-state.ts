/**
 * UI 状态（组 + 折叠态）的 **React 绑定**：`useUiState(workspaceId)`。
 *
 * ## 为什么是这个形状（裁定 B-8；lead `2026-11-28`）
 *
 * 产品意图（`locale/zh.json`）：三处入口「各持自己的选中状态：**在一处切空间，
 * 不会改掉另一处正在看的东西**」。
 *
 * ⇒ 组件**把「我正在看哪个空间」传进来**（`WorkspaceBody` / `Workspace` 本来就各自
 *   持有 `viewingId`），本 hook 只订阅**那个键**、只对**那个键**发操作。
 *   入口 A 切空间 ⇒ A 的订阅键变了 ⇒ 只有 A 重订阅；B 的键没动，看不到任何变化。
 *
 * 这也顺带消掉了老写法 `useSyncExternalStore(uiStateStore.subscribe, uiStateStore.getSnapshot)`
 * 的根因：那个 `getSnapshot` 没有参数，读的是全局「当前快照」——「当前」是谁，store 自己猜。
 *
 * ## 为什么不放在 `ui-state-store.ts`
 *
 * 那个文件要被 `node --test` 直接跑（防抖 / 保存 / 失败回退都是真逻辑），
 * 所以坚持**不 import React**。本文件是薄薄一层绑定，没有可测的真逻辑。
 *
 * ## 生命周期
 *
 * · 挂载 / `workspaceId` 变化 ⇒ `ensureLoaded(workspaceId)` 一次（幂等：已加载或已在飞
 *   的空间不会再发请求）。
 * · SSR：`getServerSnapshot` 用同一个 `getSnapshot`（返回 store 里那个稳定的空快照），
 *   服务端不发请求、不加载。
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import type { TreeGroup } from './pure/ui-state.ts';
import { uiStateStore } from './ui-state-store.ts';
import type { UiStateSnapshot } from './ui-state-store.ts';

/**
 * `useUiState(workspaceId)` 的返回值：**该空间**的快照 + 绑好空间的写操作。
 *
 * ⚠ 操作函数**不接受 `workspaceId`** —— 它们已经绑在这个 hook 的键上。
 *   想改别的空间？那属于那个空间的组件，不属于这里。
 */
export interface UiStateBindings {
	/** 正在看的那个空间的快照（同一空间不变时是同一对象）。 */
	readonly snapshot: UiStateSnapshot;
	readonly toggleFolded: (id: string) => void;
	/** 显式设置折叠态（维护 folded / expanded 互斥）。UI 用这个。 */
	readonly setFolded: (id: string, folded: boolean) => void;
	readonly addGroup: (group: TreeGroup) => void;
	readonly removeGroup: (groupId: string) => void;
	readonly renameGroup: (groupId: string, name: string | undefined) => void;
	readonly addMember: (groupId: string, cardId: string) => void;
	readonly removeMember: (groupId: string, cardId: string) => void;
}

/**
 * 订阅「我正在看的那个空间」的 UI 状态。
 *
 * @param workspaceId 组件**自己**正在看的空间 id（`''` = 还没有空间：不加载、不保存，
 *   操作只在内存里生效 —— 与「加载失败 ≠ 空状态」同一条：没加载过的空间不是保存基线）
 * @returns 该空间的快照 + 绑好空间的写操作
 */
export function useUiState(workspaceId: string): UiStateBindings {
	/* 引用稳定：否则 `useSyncExternalStore` 每次渲染都要重新订阅。 */
	const subscribe = useCallback(
		(listener: () => void) => uiStateStore.subscribe(listener),
		[],
	);
	const getSnapshot = useCallback(() => uiStateStore.getSnapshot(workspaceId), [workspaceId]);

	const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	/* 幂等：同一个空间重复进 effect 不会再拉一次（store 里按空间去重在飞请求）。 */
	useEffect(() => {
		uiStateStore.ensureLoaded(workspaceId);
	}, [workspaceId]);

	const operations = useMemo<Omit<UiStateBindings, 'snapshot'>>(
		() => ({
			toggleFolded: (id: string) => {
				uiStateStore.toggleFolded(workspaceId, id);
			},
			setFolded: (id: string, folded: boolean) => {
				uiStateStore.setFolded(workspaceId, id, folded);
			},
			addGroup: (group: TreeGroup) => {
				uiStateStore.addGroup(workspaceId, group);
			},
			removeGroup: (groupId: string) => {
				uiStateStore.removeGroup(workspaceId, groupId);
			},
			renameGroup: (groupId: string, name: string | undefined) => {
				uiStateStore.renameGroup(workspaceId, groupId, name);
			},
			addMember: (groupId: string, cardId: string) => {
				uiStateStore.addMember(workspaceId, groupId, cardId);
			},
			removeMember: (groupId: string, cardId: string) => {
				uiStateStore.removeMember(workspaceId, groupId, cardId);
			},
		}),
		[workspaceId],
	);

	return { snapshot, ...operations };
}
