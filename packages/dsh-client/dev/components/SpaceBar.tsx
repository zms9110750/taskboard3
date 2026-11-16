/**
 * 空间 chip 行 —— **chip 列表 + 左侧单个操作按钮 + 「显示已归档」开关 + 「+」新建**。
 *
 * ## 这个组件只做「渲染决定」
 *
 * 全部判决在 `dev/pure/space-bar.ts`（有 50 条单测，其中那张四行表逐行断言）。
 * 这里只把 `pure` 给出的字段**原样画出来**，外加一个**机械映射**：
 *
 * ```ts
 * const hit = dispatchOf(action);           // pure 已经判完「禁用 / 做哪件事」
 * if (hit === undefined) return;            // 禁用 ⇒ 什么都不做
 * hit.kind === 'activate' ? onActivate(hit.id) : onToggleArchived(hit.id);
 * ```
 *
 * ⇒ 组件里没有 `if (showArchived) … else …`，也没有 `if (isCurrent) …` ——
 *   那些都是语义判决，改一处就得改两遍。
 *
 * ## 三条它必须守住的用户指令
 *
 * ① 点 chip **只**调 `onView`（查看），永远不调 `onActivate`。
 *    类型级保证：`chip.intent` 恒为 `'view'`，没有别的分支可写。
 * ② 左侧**只有一个** `<button class="space-action">` —— 不是两个、不是下拉、不是菜单。
 * ③ 归档 chip 也只 `onView`（点它要的是「取消归档」，不是激活）。
 */

import type { ReactNode } from 'react';

import {
	actionButtonOf,
	archivedToggleOf,
	chipsOf,
	dispatchOf,
} from '../pure/space-bar.ts';
import type { Workspace } from '../../src/types.ts';

/** 组件属性。 */
export interface SpaceBarProps {
	/** 全部空间（含 `archived` 标记）。 */
	readonly workspaces: readonly Workspace[];
	/** 当前**激活**空间（写操作 / AI 默认空间看它）。 */
	readonly currentId: string;
	/** 正在**查看**的空间（点 chip 改它，不改 `currentId`）。 */
	readonly viewingId: string;
	/** 「显示已归档」开关。 */
	readonly showArchived: boolean;
	/** 正在查看的空间里的卡数（显示在选中 chip 上）。 */
	readonly cardCount: number;
	/** 点 chip：**只**切换正在查看的空间。 */
	readonly onView: (id: string) => void;
	/** 点左侧按钮（激活态）：把正在查看的空间变成当前空间。 */
	readonly onActivate: (id: string) => void;
	/** 点左侧按钮（归档态）：切换该空间的归档状态。 */
	readonly onToggleArchived: (id: string) => void;
	/** 点「显示已归档 / 隐藏已归档」。 */
	readonly onToggleShowArchived: () => void;
	/** 点「+」。 */
	readonly onCreate: () => void;
}

/**
 * 空间 chip 行。
 *
 * @param props 见 `SpaceBarProps`
 */
export function SpaceBar(props: SpaceBarProps): ReactNode {
	const action = actionButtonOf(
		props.workspaces,
		props.currentId,
		props.viewingId,
		props.showArchived,
	);
	const toggle = archivedToggleOf(props.showArchived);
	const chips = chipsOf(
		props.workspaces,
		props.currentId,
		props.viewingId,
		props.showArchived,
		props.cardCount,
	);

	/** 左侧那个按钮被点了：`dispatchOf` 已经判完该不该做事、做哪件事。 */
	const runAction = (): void => {
		const hit = dispatchOf(action);
		if (hit === undefined) return;
		if (hit.kind === 'activate') {
			props.onActivate(hit.id);
			return;
		}
		props.onToggleArchived(hit.id);
	};

	const actionCls = ['ghost-btn', 'space-action'];
	if (action.checked) actionCls.push('is-on');

	return (
		<div
			className="space-bar"
			data-current={props.currentId}
			data-viewing={props.viewingId}
			data-show-archived={String(props.showArchived)}
		>
			{/* 固定在左侧，不随 chip 横向滚动 */}
			<div className="space-bar__actions">
				{/*
				 * ① 只有一个按钮（用户：「不是两个独立按钮，是一个独立按钮」）。
				 *   它今天做激活、明天做归档 —— 由 `showArchived` 决定，组件不判。
				 */}
				<button
					type="button"
					className={actionCls.join(' ')}
					data-space-action="1"
					data-action-kind={action.kind}
					data-checked={String(action.checked)}
					disabled={action.disabled}
					title={action.title}
					onClick={runAction}
				>
					{action.label}
				</button>

				<button
					type="button"
					className={`ghost-btn space-toggle${toggle.active ? ' is-active' : ''}`}
					data-archived-toggle="1"
					aria-pressed={toggle.active}
					title={toggle.title}
					onClick={props.onToggleShowArchived}
				>
					{toggle.label}
				</button>
			</div>

			<div className="space-bar__scroll">
				{chips.map((chip) => {
					const cls = ['space-chip'];
					if (chip.isCurrent) cls.push('is-current');
					if (chip.isArchived) cls.push('is-archived');
					if (chip.isViewing) cls.push('is-viewing');

					return (
						<button
							key={chip.id}
							type="button"
							className={cls.join(' ')}
							data-chip-id={chip.id}
							data-chip-intent={chip.intent}
							data-chip-current={String(chip.isCurrent)}
							data-chip-archived={String(chip.isArchived)}
							data-chip-viewing={String(chip.isViewing)}
							title={chip.title}
							/*
							 * ② 点 chip **只**查看（用户：「查看和激活是要分离的」）。
							 *   这里没有第二个分支 —— `intent` 只有 `'view'`。
							 */
							onClick={() => props.onView(chip.id)}
						>
							<span className="space-chip__name">{chip.label}</span>
							{chip.count === null ? null : (
								<span className="space-chip__count">{chip.count}</span>
							)}
						</button>
					);
				})}

				<button
					type="button"
					className="space-chip space-chip--add"
					data-create="1"
					title="新建任务板"
					onClick={props.onCreate}
				>
					+
				</button>
			</div>
		</div>
	);
}
