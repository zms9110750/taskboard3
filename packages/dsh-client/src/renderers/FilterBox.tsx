/**
 * 筛选方框 —— **一个按钮为一个单位**的面包屑筛选控件。
 *
 * ## 唯一的操作
 *
 * 用户 `2026-11-16`：
 * > 「点他的效果是选中他。既然选中了他，那他就应该展开。」
 * > 「我要的逻辑是完全具有一致性的。你套了多少if」
 *
 * ⇒ 这个组件**只有一个动作**：
 *
 * ```ts
 * const select = (next: Picked): void => {
 *     props.onChange(next);      // 选中
 *     props.onOpenChange(true);  // 既然选中了，就展开
 * };
 * ```
 *
 * 所有可点的地方（标题、面包屑每一段、当前层每一项、子层每一项）
 * **都调这一个函数**，区别只是传进去的 `next` 路径不同 ——
 * 而路径是 `pure/filter-box.ts` 算好的，写在每一项的 `next` 字段里。
 *
 * | 点哪里 | next |
 * |---|---|
 * | 标题（第 0 级）| `[]`（清空）|
 * | 面包屑第 i 段 | `picked.slice(0, i+1)` |
 * | 当前层 / 子层的项 | 该项的路径 |
 *
 * **没有任何 `if (点的是标题) … else if (点的是面包屑) …`。**
 *
 * ## 渲染：只 map 一遍
 *
 * 展开态是**若干段**（0–3 个），段之间一条竖线。段由 `segmentsOf()` 给出，
 * 组件只 `map`，**竖线规则写一次**（`index > 0` 就画）。
 *
 * 收起态是一条面包屑，由 `collapsedCrumbs()` 给出，同样只 `map`。
 *
 * 组件里剩下的 `if` 只有两类，都是**渲染必需**、不含语义的：
 * 1. `if (face === null) return` —— ref 还没挂上；
 * 2. `hasValue && …` / `picked ? cls : cls` —— 决定画什么、加哪个 class。
 *
 * ## 宽度动画
 *
 * 两套「脸」（收起 / 展开）都 `position: absolute` ⇒ 不参与盒宽。
 * `useLayoutEffect` 量**当前那张脸**的宽度写到方框上，CSS 对 `width` 做 180ms 过渡。
 * ⇒ 视觉上是「方块按钮变宽露出内容」，不是「内容把布局挤开」。
 */

import { Fragment, useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { collapsedCrumbs, segmentsOf } from '../pure/filter-box.ts';
import type { FilterNode, PickItem, Picked } from '../pure/filter-box.ts';

/** 组件属性。 */
export interface FilterBoxProps {
	/** 稳定 id（写到 DOM 的 `data-box-id`，预览 / 验证脚本用它定位）。 */
	readonly boxId: string;
	/** 方框标题（`状态` / `类别` / `领域`）。它本身就是第 0 级。 */
	readonly title: string;
	/** 全部节点。有 `children` 的就是能下探的。 */
	readonly nodes: readonly FilterNode[];
	/** 当前选中路径（从根往下）。 */
	readonly picked: Picked;
	/** **开合状态由外面给**（受控）。 */
	readonly open: boolean;
	/** 选中变化。 */
	readonly onChange: (next: Picked) => void;
	/** 请求开 / 合。 */
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

	const crumbs = collapsedCrumbs(props.nodes, props.picked);
	const segments = segmentsOf(props.nodes, props.picked);
	const hasValue = crumbs.length > 0;

	/*
	 * 「点外面收起」是**本组件自己的职责**（用户 2026-11-20）：
	 *
	 * > 「哪怕是同一行的别的这个筛选框。只要不是点他自己身上，他就要收起。
	 * >   他管焦点在不在他自己身上难道都管不到嘛？还要父容器去监听？」
	 *
	 * ⇒ 不再由 `FilterRow` 挂 document 监听。每个框自己盯自己的 DOM 边界
	 *   （`boxRef`），点到自己身外（含同一行的其他框、行内空白、页面任何地方）
	 *   就请求收起。这样组件挂在哪都成立，父容器不需要知道别的框存在。
	 */
	const onOpenChangeRef = useRef(props.onOpenChange);
	onOpenChangeRef.current = props.onOpenChange;

	useEffect(() => {
		if (!props.open) return;
		const onDocPointerDown = (event: PointerEvent): void => {
			const root = boxRef.current;
			if (root === null) return;
			/* 点在自身内部（按钮 / 展开的面板 / 面包屑）⇒ 不算外面。 */
			if (event.target instanceof Node && root.contains(event.target)) return;
			onOpenChangeRef.current(false);
		};
		/*
		 * capture 阶段：抢在别处的 click 之前收起，视觉上不会「先展开另一个再收自己」。
		 */
		document.addEventListener('pointerdown', onDocPointerDown, true);
		return () => {
			document.removeEventListener('pointerdown', onDocPointerDown, true);
		};
	}, [props.open]);

	/**
	 * **唯一的动作**：选中一条路径，并展开。
	 *
	 * ⚠ 不要在这里加分支。任何「点的是哪一类东西」的区分都已经体现在 `next` 里了。
	 */
	const select = (next: Picked): void => {
		props.onChange(next);
		props.onOpenChange(true);
	};

	/* 量当前那张脸，把宽度写到方框上。 */
	const signature = JSON.stringify([
		crumbs.map((one) => one.label),
		segments.map((seg) => seg.items.map((one) => one.label)),
	]);
	useLayoutEffect(() => {
		const box = boxRef.current;
		const face = props.open ? expandedRef.current : collapsedRef.current;
		if (box === null || face === null) return;
		/* +24 = 左右各 12px 内边距。 */
		box.style.width = `${Math.ceil(face.getBoundingClientRect().width) + 24}px`;
	}, [props.open, signature]);

	return (
		<div
			ref={boxRef}
			data-box-id={props.boxId}
			className={props.open ? 'filter-box is-open' : 'filter-box'}
			onClick={() => props.onOpenChange(true)}
		>
			{/* ══ 收起态：标题 + 面包屑 ══ */}
			<div ref={collapsedRef} className="filter-box__face filter-box__face--collapsed">
				{/* 标题 = 第 0 级。点它 = 选中第 0 级 = 清空。 */}
				<button
					type="button"
					className="filter-box__title"
					title={hasValue ? '清空筛选' : props.title}
					onClick={(event) => {
						event.stopPropagation();
						select([]);
					}}
				>
					{props.title}
				</button>
				{hasValue && (
					<>
						<span className="filter-box__colon">：</span>
						<Crumbs items={crumbs} onPick={select} />
					</>
				)}
			</div>

			{/* ══ 展开态：若干段 ══ */}
			<div ref={expandedRef} className="filter-box__face filter-box__face--expanded">
				<button
					type="button"
					className="filter-box__title"
					title="清空筛选"
					onClick={(event) => {
						event.stopPropagation();
						select([]);
					}}
				>
					{props.title}
				</button>
				<span className="filter-box__colon">：</span>
				{segments.map((seg, index) => (
					/*
					 * ⚠ 必须用 `Fragment`，不能用 `<span style={{display:'contents'}}>` 包一层。
					 *   包了之后 `.filter-box__items` 就不是 expanded 的直接子元素 ——
					 *   竖线 `:scope > .filter-box__vline` 和段选择器都会取不到，
					 *   而且「段」和「竖线」的兄弟关系会变形。
					 *   （这个坑我踩过两次，写在这里当警示。）
					 */
					<Fragment key={`seg-${index}`}>
						{index > 0 && <span className="filter-box__vline" />}
						<Items items={seg.items} sep={seg.sep} onPick={select} />
					</Fragment>
				))}
			</div>
		</div>
	);
}

/** 收起态面包屑。 */
function Crumbs(props: {
	readonly items: readonly PickItem[];
	readonly onPick: (next: Picked) => void;
}): ReactNode {
	return (
		<span className="filter-box__crumbs">
			{props.items.map((item, index) => (
				<span key={`c-${item.value}`} style={{ display: 'contents' }}>
					{index > 0 && <span className="filter-box__csep">/</span>}
					<Pick
						item={item}
						variant="crumb"
						onPick={props.onPick}
					/>
				</span>
			))}
		</span>
	);
}

/** 一段（当前层 / 子层）。 */
function Items(props: {
	readonly items: readonly PickItem[];
	readonly sep: string;
	readonly onPick: (next: Picked) => void;
}): ReactNode {
	return (
		<span className="filter-box__items">
			{props.items.map((item, index) => (
				<span key={`i-${item.value}`} style={{ display: 'contents' }}>
					{index > 0 && <span className="filter-box__sep">{props.sep}</span>}
					<Pick item={item} variant="option" onPick={props.onPick} />
				</span>
			))}
		</span>
	);
}

/**
 * 一个可点的项。
 *
 * ⚠ **不是胶囊、不是按钮外观** —— 无边框、无底色，hover 才有淡底。
 * 用户原话：「里面不是纸片，他们都在方框里面，不是一个可以点击的按钮，
 * 而是可以点击的内容」。
 *
 * `variant` 只影响样式 class，**不影响行为** —— 行为永远是 `onPick(item.next)`。
 */
function Pick(props: {
	readonly item: PickItem;
	readonly variant: 'crumb' | 'option';
	readonly onPick: (next: Picked) => void;
}): ReactNode {
	const cls = ['filter-box__item', `filter-box__item--${props.variant}`];
	if (props.item.picked) cls.push('is-picked');

	return (
		<button
			type="button"
			className={cls.join(' ')}
			onClick={(event) => {
				/* 别让冒泡触到方框的 onClick（那会重复请求展开）。 */
				event.stopPropagation();
				props.onPick(props.item.next);
			}}
		>
			{props.item.label}
			{props.item.hasChildren && <span className="filter-box__more">›</span>}
		</button>
	);
}
