/**
 * 任务板标签页的 body —— **新 UI 的产品入口**。
 *
 * ## 它是什么
 *
 * 把「数据层」和「界面」焊在一起的那一层：
 *
 * ```
 * useBoardState()                    ← store.ts：调 API、存结果、loading/error/pending
 *        ↓
 * <Workspace ... />                  ← renderers/Workspace.tsx：全部视觉与交互
 * ```
 *
 * 用户 `2026-11-22`：
 * > 「我看不懂。产品在哪？有入口吗？我一直在改 UI。你写了入口吗？如果写了，那就接。」
 *
 * ⇒ 本文件就是那个「接」。它**不含任何视觉**（一个 className 都不新增），
 *   只做三件事：取数据、管本地 UI 状态、把回调接到 `BoardActions`。
 *
 * ## 为什么 `currentId` 和 `viewingId` 是同一个值
 *
 * 用户 `2026-11-22` 取消了「激活空间」这个设定（工具层的 `workspaceId` 必须显式给，
 * 不再有默认空间）。所以「正在看哪个空间」和「当前空间」在产品里**是同一件事** ——
 * 点一个空间 chip 就是切过去（`switchWorkspace` 会重新拉那个空间的卡）。
 *
 * ⇒ 不保留第二个 state。两个 prop 都传 `state.workspaceId`。
 *
 * ## 本地 UI 状态只有两个
 *
 * | 状态 | 为什么不在 store 里 |
 * |---|---|
 * | `showArchived` | 「显示已归档」是纯视图开关，不写服务端、不影响任何数据 |
 * | `selectedId` | 选中哪张卡看详情，是纯视图状态 |
 *
 * ⚠ 筛选 / 搜索**不在这里** —— `Workspace` 自己按 `pure/card-filter.ts` 就地过滤，
 *   只通过 `onFilterChange` / `onSearchChange` 上报。产品里没人监听，所以不传。
 *
 * ## ⚠ 四个缺口（`BoardActions` 里没有对应动作）
 *
 * 这些回调**没有服务端接口**，所以只能显式告诉用户「这个入口还没接」，
 * 不能静默失败（用户会以为是 bug）：
 *
 * | 回调 | 缺什么 |
 * |---|---|
 * | `onToggleArchived` | `api.ts` 没有归档空间的方法；`dsh` 没有对应 HTTP 路由（`core` 有 `archiveWorkspace`，但没暴露出来）|
 * | `onCreateCard` | 建卡页（`renderers/create/`）存在，但整条「打开建卡页 → 提交」的流程没接 |
 * | `onNoteChange` | `api.patchCard` 存在，但**它和服务端的线格式不一致**（见 `api.ts:232` 发 `{patch}`，`dsh/src/http.ts:600` 读 `title`/`note`/`content`）⇒ 现在调用会 400 |
 * | `onAddRelation` / `onDerive` | 关系编辑、派生子任务都还没做 |
 *
 * ⇒ 一律走 `notWired()`：**alert 一句人话**。这是 MVP 的诚实做法 ——
 *   等接口补齐再把对应那一行换掉。
 */

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';

import { toCardAction } from './actions.ts';
import type { TaskboardApi } from './api.ts';
import { useBoardState } from './store.ts';
import type { Card, CardAction } from './types.ts';
import { Workspace } from './renderers/Workspace.tsx';

/** 组件属性。 */
export interface WorkspaceBodyProps {
	/**
	 * 注入 API 实现（**只给预览 / 测试**）。省略 = `createApi()` 走真 `fetch`。
	 *
	 * ⚠ 产品里必须省略 —— 浏览器里没有服务端可达的其他入口。
	 *   存在的理由：`useBoardState(apiImpl)` 本来就支持注入（见 `store.ts` 文件头），
	 *   但产品入口一旦写死 `createApi()`，就**没有任何办法在不启服务端的情况下
	 *   验证这个 body 真的画得出来**（预览页是 `file://`，fetch 必失败）。
	 */
	readonly api?: TaskboardApi;
}

/**
 * 一个「入口还没接」的提示。
 *
 * ⚠ 用 `alert` 而不是静默 return：用户点了一个按钮却没反应，
 *   他会以为界面坏了。说清楚「没接」比装作无事发生好。
 *
 * @param what 缺的是什么入口
 */
function notWired(what: string): void {
	globalThis.alert(`${what}：这个入口还没接（数据层还没有对应的接口）。\n\n不是界面坏了。`);
}

/** 一个整页提示（加载 / 错误 / 没有空间）。零新样式，复用现有的虚线空态框。 */
function PageMessage(props: {
	readonly text: string;
	readonly action?: { readonly label: string; readonly onClick: () => void };
}): ReactNode {
	return (
		<div className="tb3w-root">
			<div className="tb3w-page">
				<div className="tb3w-detail__empty">
					<span>{props.text}</span>
					{props.action === undefined ? null : (
						<button type="button" className="ghost-btn" onClick={props.action.onClick}>
							{props.action.label}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * 任务板 body（产品入口）。
 *
 * @param props 见 `WorkspaceBodyProps`（产品里不传）
 */
export function WorkspaceBody(props: WorkspaceBodyProps): ReactNode {
	const { state, actions } = useBoardState(props.api);
	const [showArchived, setShowArchived] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);

	/**
	 * 点一个空间 chip ⇒ 切过去。
	 *
	 * ⚠ 只 `setViewingId` 不拉数据是不行的 —— 卡是**按空间**取的，
	 *   `switchWorkspace` 会重新 `getState(那个空间)`。
	 */
	const onView = useCallback(
		(id: string): void => {
			actions.switchWorkspace(id);
		},
		[actions],
	);

	const onCreateWorkspace = useCallback((): void => {
		const name = globalThis.prompt('新任务空间的名称');
		if (name === null || name.trim() === '') return;
		void actions.createWorkspace(name.trim());
	}, [actions]);

	/** 菜单里点了一个转移按钮 ⇒ 翻成 `CardAction` ⇒ 发给服务端。 */
	const onAction = useCallback(
		(cardId: string, button: Parameters<typeof toCardAction>[0]): void => {
			const action: CardAction = toCardAction(button);
			void actions.runAction({ cardId, action });
		},
		[actions],
	);

	/**
	 * 点「已归档」按钮 ⇒ 归档 / 取消归档那个空间。
	 *
	 * ⚠ 按钮的语义是**翻转**（不是「设为已归档」）——
	 *   `SpaceBar` 的 `actionButtonOf()` 只在「显示已归档」打开时给这个按钮，
	 *   此时按钮显示的是目标空间的**当前归档状态**，点一下就是反过来。
	 *   所以这里要按当前状态判断传 `archived` 还是 `!archived`。
	 */
	const onToggleArchived = useCallback(
		(id: string): void => {
			const target = state.workspaces.find((one) => one.id === id);
			const next = target?.archived !== true;
			void actions.setWorkspaceArchived(id, next);
		},
		[actions, state.workspaces],
	);

	const onSelect = useCallback((cardId: string | null): void => {
		setSelectedId(cardId);
	}, []);

	if (state.loading) return <PageMessage text="正在加载任务板…" />;

	if (state.error !== undefined) {
		return (
			<PageMessage
				text={state.error}
				action={{ label: '关闭', onClick: actions.clearError }}
			/>
		);
	}

	if (state.workspaceId === '') {
		return (
			<PageMessage
				text="还没有任务空间。"
				action={{ label: '新建', onClick: onCreateWorkspace }}
			/>
		);
	}

	/*
	 * 选中的卡要从**当前空间的卡列表**里找 —— `selectedId` 只是个 id。
	 * `Workspace` 收的是 `selectedId: string | null` 而不是卡对象，所以这里不用 find，
	 * 直接透传（组件内部自己按 id 匹配）。
	 *
	 * ⚠ 切空间后 `selectedId` 可能指向旧空间的卡 ⇒ `Workspace` 里按 id 找不到就
	 *   当作没选中（它的 `selected` 是 `find(...) ?? null`）。不在这里清，
	 *   是因为「切回去还选中原来那张」是更少的惊讶。
	 */
	const cards: readonly Card[] = state.cards;

	return (
		<Workspace
			workspaces={state.workspaces}
			/* 用户取消了「激活空间」⇒ 当前 = 正在查看，同一个值。 */
			currentId={state.workspaceId}
			viewingId={state.workspaceId}
			showArchived={showArchived}
			cards={cards}
			templates={state.templates}
			selectedId={selectedId}
			/*
			 * ⚠ 不传 `kindLabelOf`：v3 的模板只有 `displayName`，**没有类别的中文名**
			 *   （`pure/card-view.ts` 文件头写了为什么）。不传 ⇒ 显示英文 id，
			 *   这是「不编词」的口径，不是漏了。
			 */
			onView={onView}
			onToggleArchived={onToggleArchived}
			onToggleShowArchived={() => {
				setShowArchived((now) => !now);
			}}
			onCreateWorkspace={onCreateWorkspace}
			onSelect={onSelect}
			onCreateCard={() => {
				notWired('新建任务卡');
			}}
			onAction={onAction}
			onAddRelation={() => {
				notWired('添加关系');
			}}
			onDerive={() => {
				notWired('派生子任务');
			}}
			onNoteChange={() => {
				notWired('改备注');
			}}
		/>
	);
}
