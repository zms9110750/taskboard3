/**
 * 分段选择 —— 「科技树 | 列表」这类互斥切换。
 *
 * ## 为什么单独成组件（用户 `2026-11-20`）
 *
 * 原来它是 `Workspace.tsx` 里两个内联 `<button>` 手搓的：
 *
 * ```
 * <span className="tb3w-seg">
 *   <button className="tb3w-seg__btn is-on">科技树</button>
 *   <button className="tb3w-seg__btn">列表</button>
 * </span>
 * ```
 *
 * 用户原话：「这个分组按钮是你自己写的还是引用了我已经选取过的候选组件的？
 * 现在他的逻辑不对」。
 *
 * ❌ 手搓版缺的东西：
 *   · `role="group"` + `aria-label` —— 屏幕阅读器不知道这是一组
 *   · `role="radio"` / `aria-checked` —— 只说 `aria-pressed`，语义是「按钮」不是「单选」
 *   · **方向键切换** —— 一组单选控件该能用 ←/→ 走
 *   · **roving tabindex** —— Tab 只停在选中项，不是每个都停
 *
 * ⇒ 这些是「分组按钮」和「一排按钮」的区别，不是样式问题。
 *
 * ## 键盘行为（WAI-ARIA radio group 惯例）
 *
 * | 键 | 行为 |
 * |---|---|
 * | ← / → | 上一个 / 下一个（循环）**并立即选中** |
 * | Home / End | 第一个 / 最后一个 |
 * | Tab | 只进/出整组（roving tabindex） |
 *
 * ⚠ 只处理「2 项以上」的情况；1 项时退化成普通按钮组。
 */

import type { KeyboardEvent, ReactNode } from 'react';

/** 一个选项。 */
export interface SegmentedOption<T extends string> {
	readonly value: T;
	readonly label: string;
	/** 悬停提示。 */
	readonly title?: string;
}

/** props。 */
export interface SegmentedControlProps<T extends string> {
	/** 可选项，至少 1 个。 */
	readonly options: readonly SegmentedOption<T>[];
	/** 当前选中值。 */
	readonly value: T;
	readonly onChange: (next: T) => void;
	/** 无障碍名字（`aria-label`）。例如「视图切换」。 */
	readonly label: string;
	/** 额外的 data 钩子（测试/预览用）。 */
	readonly dataAttr?: string;
}

/**
 * 渲染一个单选分段控件。
 *
 * @param props 选项 / 当前值 / onChange / 无障碍名
 * @returns `role="group"` 包着若干 `role="radio"`
 */
export function SegmentedControl<T extends string>(props: SegmentedControlProps<T>): ReactNode {
	const index = props.options.findIndex((one) => one.value === props.value);
	const current = index >= 0 ? index : 0;

	/**
	 * 键盘导航。
	 *
	 * ⚠ 这里**立即选中**（不是「移到焦点、再回车确认」）——
	 * 视图切换是即时反馈的操作，多一次确认反而碍事。
	 */
	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
		const count = props.options.length;
		if (count < 2) return;

		let next = -1;
		if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % count;
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + count) % count;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = count - 1;
		else return;

		event.preventDefault();
		const picked = props.options[next];
		if (picked !== undefined) props.onChange(picked.value);
	};

	return (
		<span className="tb3w-seg" role="group" aria-label={props.label} data-attr={props.dataAttr}>
			{props.options.map((one) => {
				const on = one.value === props.value;
				return (
					<button
						key={one.value}
						type="button"
						className={on ? 'tb3w-seg__btn is-on' : 'tb3w-seg__btn'}
						role="radio"
						aria-checked={on}
						/*
						 * roving tabindex：整组只留一个可 Tab 进入的点（选中项）。
						 * 若选中项不在组里（值非法）则落到第一项，避免整组 Tab 不进去。
						 */
						tabIndex={on || (index < 0 && one.value === props.options[0]?.value) ? 0 : -1}
						title={one.title ?? one.label}
						onKeyDown={onKeyDown}
						onClick={() => {
							props.onChange(one.value);
						}}
					>
						{one.label}
					</button>
				);
			})}
		</span>
	);
}
