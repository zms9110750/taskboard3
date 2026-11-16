/**
 * 筛选方框 —— **内联展开**的一个方框控件（不是下拉弹窗）。
 *
 * ## 语义（用户 `2026-11-16` 重新定义）
 *
 * > 在有东西选中时，点击那个选中的状态：展开到选中他（例如以后如果有4级，5级，
 * > 在点击第3级的时候，就展开3的子，并选中3）。点击最左边的组名时，展开并取消所有
 * > 选择（换句话说，组等于第0级，语义和点击第x级时选择第x级并展开第x的子是一样的逻辑）
 *
 * ⇒ **统一规则**：点第 N 级的节点 = 选中它 + 展开它的子（第 N+1 级）。
 *
 * | 点哪里 | 结果 |
 * |---|---|
 * | 组（第 0 级） | 清空选择，进入这个组（展开它的子）|
 * | 任何有子节点的节点 | 选中它，并展开它的子 |
 * | 叶子 | 选中它 |
 * | 已选中的节点 | 幂等 —— 仍选中，子照常展开 |
 *
 * ⚠ **没有「再点一次取消」。** 取消只有两个入口：点组名、点收起态的「✕」区。
 *
 * ## 全部判决在 `pure/filter-box.ts`（已单测）
 *
 * 组件只做三件事：**画行**、**画分隔符**、**把 `next` 交给 `onChange`**。
 * 「点一下会变成什么」不在这里判断 —— 逻辑层已经算好放在 `item.next` 里。
 *
 * ## 宽度动画
 *
 * 两套「脸」（收起态 / 展开态）**都 `position: absolute`** ⇒ 都不参与盒宽。
 * `useLayoutEffect` 量**当前那张脸**的宽度写到方框上，CSS 对 `width` 做 180ms 过渡。
 * ⇒ 视觉上是「方块按钮变宽露出内容」，不是「内容把布局挤开」。
 *
 * ## 点「外面」= 点**这个按钮外面**
 *
 * 用户 `2026-11-16`：
 * > 「外面」说的是按钮外面，不是放按钮的这一行。
 *
 * ⇒ 三个方框各自独立判断：点 A 之外任何地方（**包括同一行的空白处、另一个方框**）
 *   A 就收起。所以「点第二个时第一个自动收」是这条规则的推论，不是额外逻辑。
 *
 * ⚠ **不能用 `contains()` 判里外。** 点方框里某一项时 React 会重渲染换掉那个节点
 * ⇒ 冒泡到 `document` 时 `box.contains(target)` 已是 `false` ⇒ 误判成「点在外面」。
 * `event.composedPath()` 是事件派发那一刻的祖先快照，不受重渲染影响。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
	collapsedSplit,
	clearPicked,
	rowsOf,
	selectionText,
} from '../pure/filter-box.ts';
import type { FilterNode, FilterState } from '../pure/filter-box.ts';

/** 组件属性。 */
export interface FilterBoxProps {
	/** 方框标题（`状态` / `类别` / `领域`）。 */
	readonly title: string;
	/** 全部节点。有 `children` 的就是组 / 中间层。 */
	readonly nodes: readonly FilterNode[];
	/** 当前状态（进入了哪个组 + 选中路径）。 */
	readonly value: FilterState;
	/** 状态变化。组件只调这一个回调。 */
	readonly onChange: (next: FilterState) => void;
}

/**
 * 一个筛选方框。
 *
 * @param props 标题、节点、状态、变化回调
 */
export function FilterBox(props: FilterBoxProps): ReactNode {
	const [open, setOpen] = useState(false);
	const boxRef = useRef<HTMLDivElement>(null);
	const collapsedRef = useRef<HTMLDivElement>(null);
	const expandedRef = useRef<HTMLDivElement>(null);

	const text = selectionText(props.nodes, props.value);
	const split = collapsedSplit(props.value);
	const rows = rowsOf(props.nodes, props.value);

	/*
	 * 量当前那张脸，把宽度写到方框上。
	 *
	 * 依赖必须包含「会让宽度变的东西」：开合、收起态文字、行内容。
	 * `rows` 是每次渲染新建的数组 ⇒ 用 JSON 当依赖，避免无限循环
	 * （比 `useMemo` 包一层更简单，且这里宽度计算本来就要跑）。
	 */
	const rowsKey = JSON.stringify(rows.map((row) => row.items.map((one) => one.label)));
	useLayoutEffect(() => {
		const box = boxRef.current;
		const face = open ? expandedRef.current : collapsedRef.current;
		if (box === null || face === null) return;

		/* +24 = 左右各 12px 内边距。 */
		const width = Math.ceil(face.getBoundingClientRect().width) + 24;
		box.style.width = `${width}px`;
	}, [open, text, rowsKey]);

	/* 点这个按钮外面 ⇒ 收起（包括同一行的空白、别的方框）。 */
	useEffect(() => {
		if (!open) return;
		const onDocClick = (event: MouseEvent): void => {
			const box = boxRef.current;
			if (box === null) return;
			if (event.composedPath().includes(box)) return;
			setOpen(false);
		};
		document.addEventListener('click', onDocClick);
		return () => {
			document.removeEventListener('click', onDocClick);
		};
	}, [open]);

	const pick = (next: FilterState): void => {
		props.onChange(next);
	};

	return (
		<div
			ref={boxRef}
			className={open ? 'filter-box is-open' : 'filter-box'}
			/*
			 * 点方框本身（含框内空白）：收起态 ⇒ 展开；展开态 ⇒ 保持。
			 *
			 * ⚠ **不 `stopPropagation`** —— 让 document 上「点按钮外面」自己生效，
			 *   这样点另一个方框时前一个会收起。
			 */
			onClick={() => {
				if (!open) setOpen(true);
			}}
		>
			{/* ── 收起态 ── */}
			<div ref={collapsedRef} className="filter-box__face filter-box__face--collapsed">
				{split ? (
					<>
						<span
							className="filter-box__zone"
							title="点一下清空筛选并展开"
							onClick={(event) => {
								event.stopPropagation();
								pick(clearPicked(props.value));
								setOpen(true);
							}}
						>
							<span className="filter-box__title">{props.title}</span>
							<span className="filter-box__colon">：</span>
							<span className="filter-box__value">{text}</span>
						</span>
						<span
							className="filter-box__zone filter-box__caret"
							title="只展开（不改筛选）"
							onClick={(event) => {
								event.stopPropagation();
								setOpen(true);
							}}
						>
							▾
						</span>
					</>
				) : (
					<span className="filter-box__zone">
						<span className="filter-box__title">{props.title}</span>
					</span>
				)}
			</div>

			{/* ── 展开态 ── */}
			<div ref={expandedRef} className="filter-box__face filter-box__face--expanded">
				<span className="filter-box__title">{props.title}</span>
				<span className="filter-box__colon">：</span>
				{rows.map((row, rowIndex) => (
					<Row
						key={`row-${row.level}`}
						level={row.level}
						items={row.items}
						/* 组行内部用 |，往下每一级用 /（沿用旧版语言）。 */
						sep={row.level === 0 ? '|' : '/'}
						showVline={rowIndex > 0}
						onPick={pick}
					/>
				))}
			</div>
		</div>
	);
}

/**
 * 一行。
 *
 * 第 0 行前面不画竖线；后续每一行前面画一条**贯通上下的结构竖线**。
 *
 * ⚠ 层级是无限的 —— 三级就画两条竖线。横排而不是换行，
 *   因为方框的隐喻是「按钮变宽」，换行会破坏它。
 *   （若三级以后宽度不可接受，改成纵排只动这里 + CSS。）
 */
function Row(props: {
	readonly level: number;
	readonly items: readonly {
		readonly value: string;
		readonly label: string;
		readonly picked: boolean;
		readonly branch: boolean;
		readonly hasChildren: boolean;
		readonly next: FilterState;
	}[];
	readonly sep: string;
	readonly showVline: boolean;
	readonly onPick: (next: FilterState) => void;
}): ReactNode {
	return (
		<>
			{props.showVline && <span className="filter-box__vline" />}
			<span className="filter-box__items">
				{props.items.map((item, index) => (
					<>
						{index > 0 && (
							<span key={`sep-${item.value}`} className="filter-box__sep">
								{props.sep}
							</span>
						)}
						<Item
							key={`${props.level}-${item.value}`}
							label={item.label}
							picked={item.picked}
							branch={item.branch}
							hasChildren={item.hasChildren}
							onClick={() => props.onPick(item.next)}
						/>
					</>
				))}
			</span>
		</>
	);
}

/**
 * 一个可点的文字。
 *
 * ⚠ **不是胶囊、不是按钮外观** —— 无边框、无底色，hover 才有淡底。
 * 用户原话：「里面不是纸片，他们都在方框里面，不是一个可以点击的按钮，
 * 而是可以点击的内容」。
 *
 * 三种视觉：
 * · `picked`  —— 蓝字 + 加粗（选中的那个值）
 * · `branch`  —— 蓝字 + 淡蓝底（有子节点且被进入，子行属于它）
 * · 其它      —— 常规黑字
 */
function Item(props: {
	readonly label: string;
	readonly picked: boolean;
	readonly branch: boolean;
	readonly hasChildren: boolean;
	readonly onClick: () => void;
}): ReactNode {
	const cls = ['filter-box__item'];
	if (props.picked) cls.push('is-picked');
	if (props.branch) cls.push('is-branch');

	return (
		<button
			type="button"
			className={cls.join(' ')}
			onClick={(event) => {
				/*
				 * ⚠ `stopPropagation` 是双保险：`composedPath` 已经解决了
				 * 「点自己被误判成点外面」的问题，但别让冒泡触到方框的 onClick。
				 */
				event.stopPropagation();
				props.onClick();
			}}
		>
			{props.label}
			{/* 有下一级时给一个小提示，让用户知道还能往里点。 */}
			{props.hasChildren && <span className="filter-box__more">›</span>}
		</button>
	);
}
