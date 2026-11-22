/**
 * 任务板标签页的 body —— **旧 MVP，已被 `WorkspaceBody` 取代**。
 *
 * ⚠ 用户 `2026-11-22`：「产品在哪？有入口吗？我一直在改 UI。你写了入口吗？如果写了，那就接。」
 *   ⇒ `client.tsx` 现在挂的是 `WorkspaceBody`（新 UI）。本文件**不再被产品使用**。
 *
 * 保留它的理由：
 *
 * 1. **旧 MVP 的连线范本** —— 它演示 `useBoardState` 怎么接 UI
 *    （`switchWorkspace` / `runAction` / `createWorkspace` / `clearError` 的用法）。
 * 2. **兜底** —— 新 UI 出问题时可以一行改回来对照。
 *
 * 它用的是 `views/` 下那批旧组件（`CardList` / `CardDetail` / `StatusMenu` / `WorkspaceBar`），
 * 那批组件同样只剩本文件在用。**不要在新代码里引它们** —— 新 UI 用 `renderers/`。
 *
 * ## 职责边界（原文，保留）
 *
 * 这个组件**只组装**：顶部栏、列表 + 详情、状态菜单。
 * 它不判状态、不做转移规则、不碰 HTTP 细节 —— 那些在 `protocol` / `pure` / `store` / `api`。
 *
 * ## 为什么不接 `useTabInfo()`
 *
 * 它要求这个 tab 已提交进 layout，否则会抛「tab "…" is not committed」。
 * MVP 用不到 `sidebar.expanded` / `panel.id` / `tab.actions` 里任何东西
 * ⇒ 不引入，避免未提交时白屏。等需要 `tab.actions.openResource` 再接。
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { templateLabelOf } from './pure.ts';
import { useBoardState } from './store.ts';
import { CLS } from './styles.ts';
import type { CardAction } from './types.ts';
import { CardDetail } from './views/CardDetail.tsx';
import { CardList } from './views/CardList.tsx';
import { StatusMenu } from './views/StatusMenu.tsx';
import { WorkspaceBar } from './views/WorkspaceBar.tsx';

/** body 组件（无 props —— 一切都是自己拉的数据）。 */
export function BoardBody(): ReactNode {
	const { state, actions } = useBoardState();
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const selected = useMemo(
		() => state.cards.find((card) => card.id === selectedId) ?? null,
		[state.cards, selectedId],
	);

	const busy = state.pending > 0;

	const onPickAction = useCallback(
		(cardId: string, action: CardAction): void => {
			void actions.runAction({ cardId, action });
		},
		[actions],
	);

	const onCreate = useCallback((): void => {
		const name = globalThis.prompt('新工作空间的名称');
		if (name === null || name.trim() === '') return;
		void actions.createWorkspace(name.trim());
	}, [actions]);

	if (state.loading) {
		return (
			<div className={CLS.board}>
				<div className={CLS.empty}>正在加载任务板…</div>
			</div>
		);
	}

	return (
		<div className={CLS.board}>
			<WorkspaceBar
				workspaces={state.workspaces}
				workspaceId={state.workspaceId}
				disabled={busy}
				onSwitch={actions.switchWorkspace}
				onReload={() => actions.reload()}
				onCreate={onCreate}
			/>

			{state.error !== undefined ? (
				<div className={CLS.error}>
					<span className={CLS.errorText}>{state.error}</span>
					<button type="button" className={CLS.btn} onClick={actions.clearError}>
						关闭
					</button>
				</div>
			) : null}

			{state.workspaceId === '' ? (
				<div className={CLS.empty}>还没有工作空间。点右上角「＋」新建一个。</div>
			) : (
				<div className={CLS.body}>
					<div className={CLS.list}>
						<CardList
							cards={state.cards}
							selectedId={selectedId}
							onSelect={(cardId) => setSelectedId((prev) => (prev === cardId ? null : cardId))}
						/>
					</div>
					<div className={CLS.detail}>
						{selected === null ? (
							<div className={CLS.empty}>点左边一张卡看详情。</div>
						) : (
							<CardDetail
								card={selected}
								templateLabel={templateLabelOf(state.templates, selected.template.ref)}
								menu={
									<StatusMenu
										kind={selected.template.kind}
										from={selected.status}
										disabled={busy}
										onPick={(action) => onPickAction(selected.id, action)}
									/>
								}
							/>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
