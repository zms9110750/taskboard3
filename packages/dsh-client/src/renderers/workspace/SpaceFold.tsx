/**
 * 空间折叠栏 —— **用户 2026-11-22 选定的 A 款**。
 *
 * ## 用户原话
 *
 * > 「工作空间点开以后应该是打开折叠的隐藏栏，而不是悬浮窗。」
 * > 「空间选择器 · 折叠隐藏栏 · 3 个候选 —— 就选 A 款式。」
 *
 * A 款 = **工具栏下一行整行展开**：点「工作空间 ▾」，展开区出现在工具栏**下方**，
 * 占满宽度、**推挤**筛选行（不是绝对定位、不盖内容）。
 *
 * ## 为什么和新开一个文件而不是改 `SpacePicker`
 *
 * `SpacePicker` 是旧实现（悬浮窗 + 自己管 open + 自己盯 document），
 * 还被 `dev/preview/workspace-parts`、`dev/preview/gallery` 当展品用。
 *
 * ⇒ 本文件是**产品用的新实现**，两个组件：
 *   - `SpaceFoldToggle`：按钮（受控 `open` / `onToggle`）
 *   - `SpaceFoldBody`：展开区（就是 `SpaceBar`，加一层容器）
 *
 * **开合状态由调用方（`Workspace`）持有** —— 因为展开区要渲染在工具栏**外面**，
 * 组件内部管不了。这和旧 `SpacePicker`「自己盯 DOM 边界」的规则不冲突：
 * 这里「点外面收起」由 `Workspace` 的 document 监听负责（见那边注释）。
 */

import type { ReactNode } from 'react';

import type { Workspace as SpaceEntity } from '../../types.ts';
import { SpaceBar } from '../SpaceBar.tsx';

/* ══════════════════════════════════════════════════════════
   ① 按钮
   ══════════════════════════════════════════════════════════ */

/** `SpaceFoldToggle` 的属性。 */
export interface SpaceFoldToggleProps {
	/** 展开中（受控）。 */
	readonly open: boolean;
	/** 点按钮。 */
	readonly onToggle: () => void;
}

/**
 * 「工作空间 ▾」开关按钮。
 *
 * @param props 见 `SpaceFoldToggleProps`
 */
export function SpaceFoldToggle(props: SpaceFoldToggleProps): ReactNode {
	return (
		<button
			type="button"
			className={props.open ? 'ghost-btn tb3w-space-toggle is-open' : 'ghost-btn tb3w-space-toggle'}
			data-space-toggle
			aria-expanded={props.open}
			aria-controls="tb3w-space-fold"
			onClick={props.onToggle}
		>
			{props.open ? '工作空间 ▴' : '工作空间 ▾'}
		</button>
	);
}

/* ══════════════════════════════════════════════════════════
   ② 展开区
   ══════════════════════════════════════════════════════════ */

/** `SpaceFoldBody` 的属性 —— 就是 `SpaceBar` 那一份，原样转发。 */
export interface SpaceFoldBodyProps {
	readonly workspaces: readonly SpaceEntity[];
	readonly currentId: string;
	readonly viewingId: string;
	readonly showArchived: boolean;
	readonly cardCount: number;
	readonly onView: (id: string) => void;
	readonly onToggleArchived: (id: string) => void;
	readonly onToggleShowArchived: () => void;
	readonly onCreate: () => void;
}

/**
 * 展开区 —— 整行、推挤下面的内容。
 *
 * 里面就是**定稿的 `SpaceBar`**：不复制判决、不改行为，只换容器。
 *
 * @param props 见 `SpaceFoldBodyProps`
 */
export function SpaceFoldBody(props: SpaceFoldBodyProps): ReactNode {
	return (
		<div className="tb3w-space-fold" id="tb3w-space-fold" data-space-fold>
			<SpaceBar
				workspaces={props.workspaces}
				currentId={props.currentId}
				viewingId={props.viewingId}
				showArchived={props.showArchived}
				cardCount={props.cardCount}
				onView={props.onView}
				onToggleArchived={props.onToggleArchived}
				onToggleShowArchived={props.onToggleShowArchived}
				onCreate={props.onCreate}
			/>
		</div>
	);
}
