/**
 * 筛选行 —— **协调「同时只有一个方框展开」** 的地方。
 *
 * ## 为什么「只开一个」不能靠每个方框各挂一个 document 监听
 *
 * 上一版就是这个写法：每个 `FilterBox` 自己 `addEventListener('click')`，
 * 互相靠「点到我在外面 ⇒ 收起」来收敛。
 *
 * **它错了。** 用户 `2026-11-16`：
 * > 「点开一个按钮的时候点开另一个按钮，之前的不会收回去。」
 * > 「组件应该是以一个按钮为单位的。而不是这一坨按钮组为单位。」
 *
 * 那种「靠副作用互相通知」的收敛是**涌现行为**，不是保证 ——
 * 顺序、事件传播、重渲染任一处变动就可能失效，而且没法用单元测试证明。
 *
 * ## 正确做法：把「谁开着」变成一个显式的值
 *
 * ```ts
 * const [openId, setOpenId] = useState<string | null>(null);
 * ```
 *
 * · 点某个方框 ⇒ `setOpenId(那个 id)` ⇒ **其它方框自动变 `open=false`**（构造上互斥）
 * · 点「当前开着的那个」外面 ⇒ `setOpenId(null)`
 *
 * ⇒ 「点 B 时 A 收起」不需要任何额外逻辑，它是 `openId` 只有一个值的直接结果。
 *
 * ## 「外面」= 按钮外面，不是这一行
 *
 * 用户 `2026-11-16`：
 * > 「『外面』说的是按钮外面，不是放按钮的这一行。」
 *
 * ⇒ 判断依据是「点击路径里有没有**当前那个方框的 DOM 节点**」，
 *   而不是「在不在这一行里」。点行内空白 ⇒ 收起。
 *
 * ⚠ 用 `composedPath()`，不用 `contains()`：点方框里的项时 React 会换掉那个节点，
 *   冒泡到 document 时 `box.contains(target)` 已是 `false`（旧版注释记过这个坑）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { FilterBox } from './FilterBox.tsx';
import type { FilterNode, FilterState } from '../pure/filter-box.ts';

/** 一个方框的配置。 */
export interface FilterSpec {
	/** 稳定 id（互斥靠它，不要用标题当 id —— 标题可能重复）。 */
	readonly id: string;
	readonly title: string;
	readonly nodes: readonly FilterNode[];
	readonly value: FilterState;
}

/** 属性。 */
export interface FilterRowProps {
	readonly filters: readonly FilterSpec[];
	readonly onChange: (id: string, next: FilterState) => void;
	/** 行尾放什么（搜索框之类）。 */
	readonly trailing?: ReactNode;
}

/**
 * 一行筛选方框。
 *
 * @param props 方框清单、变化回调、行尾内容
 */
export function FilterRow(props: FilterRowProps): ReactNode {
	const [openId, setOpenId] = useState<string | null>(null);
	const rowRef = useRef<HTMLDivElement>(null);

	const handleOpenChange = useCallback((id: string, next: boolean) => {
		/* 打开时把 openId 设成自己 —— 别的方框因此必然是 false。 */
		setOpenId(next ? id : null);
	}, []);

	/*
	 * 点「当前开着的那个方框」外面 ⇒ 收起。
	 *
	 * ⚠ 依赖只有 `openId` —— 换方框时重新挂载，指向新的那个节点。
	 * ⚠ 事件挂在 `document` 上（而不是行上），因为「外面」包括这一行的空白处。
	 */
	useEffect(() => {
		if (openId === null) return;

		const onDocClick = (event: MouseEvent): void => {
			const row = rowRef.current;
			if (row === null) return;
			const openBox = row.querySelector(`[data-box-id="${openId}"]`);
			if (openBox === null) return;
			if (event.composedPath().includes(openBox)) return;
			setOpenId(null);
		};

		document.addEventListener('click', onDocClick);
		return () => {
			document.removeEventListener('click', onDocClick);
		};
	}, [openId]);

	return (
		<div ref={rowRef} className="filter-row">
			{props.filters.map((spec) => (
				<FilterBox
					key={spec.id}
					boxId={spec.id}
					title={spec.title}
					nodes={spec.nodes}
					value={spec.value}
					onChange={(next) => props.onChange(spec.id, next)}
					open={openId === spec.id}
					onOpenChange={(next) => handleOpenChange(spec.id, next)}
				/>
			))}
			{props.trailing !== undefined && <span className="filter-row__spacer" />}
			{props.trailing}
		</div>
	);
}
