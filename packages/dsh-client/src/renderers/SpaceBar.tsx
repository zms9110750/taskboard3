/**
 * 空间 chip 行 —— **chip 列表 + 单个操作按钮 + 「显示已归档」开关 + 「+」新建**。
 *
 * ## 布局（用户 `2026-11-18` 定，只剩这一种）
 *
 * > 「SpaceBar 布局方案，我希望他直接按顺序换行和列出。
 * >  但是最开头的那两个按钮，归档和激活空间，也在视图里，
 * >  也就是说换行不是从那两个按钮右边才开始换行。」
 *
 * ```
 * ┌──────────────────────────────────────────────────────┐
 * │ [当前空间][显示已归档][核心][代码][写作]                  │
 * │ [调研][归档区][设计稿][+]                                │
 * └──────────────────────────────────────────────────────┘
 *        ↑ 全部在同一层，按这个顺序换行
 * ```
 *
 * ⚠ **四个东西是 `.space-bar` 的直接子元素**，不是一个左侧固定区 + 一个换行区。
 *   没有 `.space-bar__actions` 包裹层了 —— 那一层会让「换行只发生在右边」。
 *
 * ⚠ **不用 `display: contents`**（虽然它也能达到同样效果）：
 *   在 FilterBox 上踩过 —— `:scope >` 选择器失效、竖线画错。直接平铺更稳。
 *
 * ## 为什么只有一种布局
 *
 * 之前做了四个候选（wrap / scroll / arrows / compact）让用户选。
 * 用户 `2026-11-18` 定了 wrap：**换行就没有滚动条，不存在「拖不到」这个问题**。
 * 另外三个已删除 —— 不留成「以后可能用」。
 *
 * ## 这个组件只做「渲染决定」
 *
 * 全部判决在 `dev/pure/space-bar.ts`（有单测，其中那张六行表逐行断言）。
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
 * ② **只有一个**操作按钮 —— 不是两个、不是下拉、不是菜单。
 * ③ 归档 chip 也只 `onView`（点它要的是「取消归档」，不是激活）。
 */

import type { ReactNode } from 'react';

import {
	actionButtonOf,
	archivedToggleOf,
	chipsOf,
	dispatchOf,
} from '../pure/space-bar.ts';
import type { Workspace } from '../types.ts';

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
	/** 点操作按钮（归档态）：切换该空间的归档状态。 */
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

	/** 操作按钮被点了（只剩归档；「激活空间」已取消 —— 用户 2026-11-22）。 */
	const runAction = (): void => {
		if (action === undefined) return;
		const hit = dispatchOf(action);
		if (hit === undefined) return;
		props.onToggleArchived(hit.id);
	};

	const actionCls = action === undefined
		? ['ghost-btn', 'space-action', 'is-emphasis-plain']
		: ['ghost-btn', 'space-action', `is-emphasis-${action.emphasis}`];
	if (action?.checked === true) actionCls.push('is-on');

	return (
		/*
		 * `.space-bar` **本身**就是那个 `flex-wrap: wrap` 容器。
		 * 四个东西（操作按钮 / 显示已归档 / chips / +）全是它的**直接子元素**，
		 * 所以换行发生在整个序列里，不是「从某个容器右边才开始」。
		 */
		<div
			className="space-bar"
			data-current={props.currentId}
			data-viewing={props.viewingId}
			data-show-archived={String(props.showArchived)}
		>
			{action !== undefined ? (
				/*
				 * ① 只有一个操作按钮（用户：「不是两个独立按钮，是一个独立按钮」）。
				 *   ⚠ 用户 2026-11-22 取消了「激活空间」设定 ⇒ 这里只剩归档切换。
				 */
				<button
					type="button"
					className={actionCls.join(' ')}
					data-space-action="1"
					data-action-kind={action.kind}
					data-checked={String(action.checked)}
					data-emphasis={action.emphasis}
					disabled={action.disabled}
					title={action.title}
					onClick={runAction}
				>
					{action.label}
				</button>
			) : null}

			{/* ② 「显示已归档」开关 */}
			<button
				type="button"
				className={`ghost-btn space-toggle${toggle.active ? ' is-active' : ''}`}
				aria-pressed={toggle.active}
				title={toggle.title}
				onClick={props.onToggleShowArchived}
			>
				{toggle.label}
			</button>

			{/* ③ chips —— 直接平铺，不套容器 */}
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
						 * ③ 点 chip **只**查看（用户：「查看和激活是要分离的」）。
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

			{/* ④ 「+」 —— 顺序上永远最后 */}
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
	);
}
