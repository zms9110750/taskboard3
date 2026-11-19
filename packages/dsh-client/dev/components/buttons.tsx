/**
 * 按钮组件 —— **候选形态**。
 *
 * ## 为什么做这个
 *
 * `Workspace.tsx` 的工具栏里有 4 个内联 `<button>`（权限与约定 / 科技树 / 列表 / 新建），
 * 它们不是独立组件 —— 用户 2026-11-20 指出「如果不是组件，接入组件」。
 *
 * 这里先把它们做成候选，**两套配色并排**让用户选：
 *
 * | 主题 | 强调色 | 依据 |
 * |---|---|---|
 * | `dark` | 深色（#1f2328） | 设计图 `view-3-workspace` 与 taskboard2 截图一致（「核心12」「新建」都是深色实心）|
 * | `blue` | 蓝色（#2563eb） | 当前实现用的体系（我把主色做成了蓝色）|
 *
 * ## 三类按钮（按设计图归纳）
 *
 * 1. `SegmentedControl` —— 分段选择（科技树 | 列表）
 * 2. `ActionButton` —— primary / secondary / accent-outline（新建 / 权限与约定 / 当前空间）
 * 3. `CountChip` —— 带计数的 chip（核心 12）
 *
 * ⚠ 这些是 **dev/ 下的候选**，不是产品组件。用户选定后才迁到 `src/renderers/`。
 */

import type { ReactNode } from 'react';

/** 配色主题。 */
export type BtnTheme = 'dark' | 'blue';

/* ────────────────────────── 分段选择 ────────────────────────── */

export interface SegmentedOption<T extends string> {
	readonly value: T;
	readonly label: string;
}

export interface SegmentedControlProps<T extends string> {
	readonly theme: BtnTheme;
	readonly options: readonly SegmentedOption<T>[];
	readonly value: T;
	readonly onChange: (next: T) => void;
	readonly label?: string;
}

/**
 * 分段选择（「科技树 | 列表」）。
 *
 * @returns 一个圆角分组；选中项实心，未选透明
 */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>): ReactNode {
	return (
		<span className="seg" role="group" aria-label={props.label ?? '分段选择'} data-theme={props.theme}>
			{props.options.map((one) => (
				<button
					key={one.value}
					type="button"
					className={one.value === props.value ? 'seg__btn is-on' : 'seg__btn'}
					aria-pressed={one.value === props.value}
					onClick={() => {
						props.onChange(one.value);
					}}
				>
					{one.label}
				</button>
			))}
		</span>
	);
}

/* ────────────────────────── 动作按钮 ────────────────────────── */

/** 按钮层级。 */
export type ButtonVariant = 'primary' | 'secondary' | 'accent-outline';

export interface ActionButtonProps {
	readonly theme: BtnTheme;
	readonly variant: ButtonVariant;
	readonly children: ReactNode;
	readonly onClick?: () => void;
	readonly disabled?: boolean;
}

/**
 * 动作按钮。
 *
 * - `primary`：实心（新建）
 * - `secondary`：白底灰边（权限与约定 / 显示已归档）
 * - `accent-outline`：白底 + 强调色边框与文字（当前空间 —— 设计图里这是**唯一**用 accent 的地方）
 */
export function ActionButton(props: ActionButtonProps): ReactNode {
	return (
		<button
			type="button"
			className={`btn btn--${props.variant}`}
			data-theme={props.theme}
			disabled={props.disabled === true}
			onClick={props.onClick}
		>
			{props.children}
		</button>
	);
}

/* ────────────────────────── 计数 chip ────────────────────────── */

export interface CountChipProps {
	readonly theme: BtnTheme;
	readonly label: string;
	readonly count: number;
	readonly onClick?: () => void;
}

/**
 * 带计数的 chip（「核心 12」）。
 *
 * ⚠ 和 `SpaceBar` 里那个 chip 不是一回事：这个是**工具栏上的空间切换器**候选，
 * 数字是卡片数。`SpaceBar` 的 chip 由 `src/renderers/SpaceBar.tsx` 渲染。
 */
export function CountChip(props: CountChipProps): ReactNode {
	return (
		<button type="button" className="chip" data-theme={props.theme} onClick={props.onClick}>
			<span className="chip__label">{props.label}</span>
			<span className="chip__count">{props.count}</span>
		</button>
	);
}
