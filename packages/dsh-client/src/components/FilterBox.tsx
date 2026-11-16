/**
 * 筛选方框 —— **一个按钮为一个单位**的组件（不是「一排按钮」为单位）。
 *
 * ## 它自己管什么、不管什么
 *
 * | 管 | 不管 |
 * |---|---|
 * | 收起态 / 展开态怎么画 | **开合状态本身**（由 `FilterRow` 通过 `open` 传入）|
 * | 宽度动画 | 「同时只开一个」（那是 `FilterRow` 的 `openId` 保证的）|
 * | 把点击翻译成 `onChange` / `onOpenChange` | 「点外面收起」（`FilterRow` 挂 document 监听）|
 *
 * ⇒ **受控组件**。开合是从外面灌进来的 —— 这样「点 B 时 A 收起」
 *   是 `openId` 只有一个值的构造性结果，不依赖任何副作用时序。
 *
 * 用户 `2026-11-16`：
 * > 「组件应该是以一个按钮为单位的。而不是这一坨按钮组为单位。」
 *
 * ## 语义（用户 `2026-11-16` 定义）
 *
 * > 在有东西选中时，点击那个选中的状态：展开到选中他（例如以后如果有4级，5级，
 * > 在点击第3级的时候，就展开3的子，并选中3）。点击最左边的组名时，展开并取消所有
 * > 选择（换句话说，组等于第0级，语义和点击第x级时选择第x级并展开第x的子是一样的逻辑）
 *
 * ⇒ 统一规则：点第 N 级 = 选中它 + 展开它的子（第 N+1 级）。
 *
 * | 点哪里 | 结果 |
 * |---|---|
 * | 组（第 0 级） | 清空选择，进入这个组 |
 * | 有子节点的节点 | 选中它，并展开它的子 |
 * | 叶子 | 选中它 |
 * | 已选中的节点 | 幂等 —— 仍选中，子照常展开 |
 *
 * ⚠ **没有「再点一次取消」。** 取消入口只有：点组名、点收起态的「清空」区。
 *
 * ## 判决全部在 `pure/filter-box.ts`（已单测）
 *
 * 组件只做三件事：画行、画分隔符、把 `next` 交给 `onChange`。
 * 「点一下会变成什么」不在这里判断 —— 逻辑层已算好放在 `item.next` 里。
 *
 * ## 宽度动画
 *
 * 两套「脸」（收起 / 展开）都 `position: absolute` ⇒ 都不参与盒宽。
 * `useLayoutEffect` 量**当前那张脸**的宽度写到方框上，CSS 对 `width` 做 180ms 过渡。
 * ⇒ 视觉上是「方块按钮变宽露出内容」，不是「内容把布局挤开」。
 */

import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import {
	clearPicked,
	hasSelection,
	rowsOf,
	selectionText,
} from '../pure/filter-box.ts';
import type { FilterNode, FilterState } from '../pure/filter-box.ts';

/** 组件属性。 */
export interface FilterBoxProps {
	/** 稳定 id（`FilterRow` 用它做互斥；同时写到 DOM 的 `data-box-id`）。 */
	readonly boxId: string;
	/** 方框标题（`状态` / `类别` / `领域`）。 */
	readonly title: string;
	/** 全部节点。有 `children` 的就是组 / 中间层。 */
	readonly nodes: readonly FilterNode[];
	/** 当前状态（进入了哪个组 + 选中路径）。 */
	readonly value: FilterState;
	/** **开合状态由外面给**（受控）。 */
	readonly open: boolean;
	/** 状态变化。 */
	readonly onChange: (next: FilterState) => void;
	/** 请求开 / 合。组件从不自己改 `open`。 */
	readonly onOpenChange: (next: boolean) => void;
}

/**
 * 一个筛选方框。
 *
 * @param props 见 `FilterBoxProps`
 */
export function FilterBox(props: FilterBoxProps): ReactNode {
	const boxRef = useRef<HTMLDivElement>(null);
	const collapsedRef = useRef<HTMLDivElement>(null);
	const expandedRef = useRef<HTMLDivElement>(null);

	const text = selectionText(props.nodes, props.value);
	const hasValue = hasSelection(props.value);
	const rows = rowsOf(props.nodes, props.value);

	/*
	 * 量当前那张脸，把宽度写到方框上。
	 *
	 * 依赖必须包含「会让宽度变的东西」：开合、收起态文字、行内容。
	 * `rows` 每次渲染都是新数组 ⇒ 用 JSON 字符串当依赖（比 useMemo 简单，
	 * 且宽度计算本来每次都要跑）。
	 */
	const rowsKey = JSON.stringify(rows.map((row) => row.items.map((one) => one.label)));
	useLayoutEffect(() => {
		const box = boxRef.current;
		const face = props.open ? expandedRef.current : collapsedRef.current;
		if (box === null || face === null) return;

		/* +24 = 左右各 12px 内边距。 */
		const width = Math.ceil(face.getBoundingClientRect().width) + 24;
		box.style.width = `${width}px`;
	}, [props.open, text, rowsKey]);

	const pick = (next: FilterState): void => {
		props.onChange(next);
	};

	return (
		<div
			ref={boxRef}
			data-box-id={props.boxId}
			className={props.open ? 'filter-box is-open' : 'filter-box'}
			/*
			 * 点方框本身（含框内空白）：
			 * · 收起态 ⇒ 请求展开
			 * · 展开态 ⇒ 保持（收起只由外面点 / 点别的方框触发）
			 */
			onClick={() => {
				if (!props.open) props.onOpenChange(true);
			}}
		>
			{/* ── 收起态 ── */}
			<div ref={collapsedRef} className="filter-box__face filter-box__face--collapsed">
				{/*
				 * 主体：**永远只是「展开」，清不清值由用户另外点 ✕。**
				 *
				 * ⚠ 这里踩过一个坑：上一版做成「有值时点主体 = 清空并展开」，
				 *   结果用户点开一个已筛选的方框想看选项，值被清掉了。
				 *   方框主体是**最大的点击目标**，它不能带破坏性副作用。
				 */}
				<span className="filter-box__zone" title="展开（不改筛选）">
					<span className="filter-box__title">{props.title}</span>
					{hasValue && (
						<>
							<span className="filter-box__colon">：</span>
							<span className="filter-box__value">{text}</span>
						</>
					)}
					<span className="filter-box__caret">▾</span>
				</span>
				{/* 清空：一个**独立的小按钮**，只在有值时出现。 */}
				{hasValue && (
					<span
						className="filter-box__clear"
						title="清空筛选"
						role="button"
						tabIndex={0}
						onClick={(event) => {
							event.stopPropagation();
							pick(clearPicked(props.value));
						}}
						onKeyDown={(event) => {
							if (event.key !== 'Enter' && event.key !== ' ') return;
							event.preventDefault();
							event.stopPropagation();
							pick(clearPicked(props.value));
						}}
					>
						✕
					</span>
				)}
			</div>

			{/* ── 展开态 ── */}
			<div ref={expandedRef} className="filter-box__face filter-box__face--expanded">
				<span className="filter-box__title">{props.title}</span>
				<span className="filter-box__colon">：</span>
				{rows.map((row) => (
					<Row
						key={`row-${row.level}`}
						level={row.level}
						items={row.items}
						/* 组行（第 0 级）用 |，往下每一级用 /（沿用旧版语言）。 */
						sep={row.level === 0 ? '|' : '/'}
						showVline={row.level > 0}
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
					<span key={`cell-${item.value}`} style={{ display: 'contents' }}>
						{index > 0 && <span className="filter-box__sep">{props.sep}</span>}
						<Item
							label={item.label}
							picked={item.picked}
							branch={item.branch}
							hasChildren={item.hasChildren}
							onClick={() => props.onPick(item.next)}
						/>
					</span>
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
				 * `stopPropagation` 是双保险：`composedPath` 已解决「点自己被误判成点外面」，
				 * 但别让冒泡触到方框的 onClick（那会重复请求展开）。
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
