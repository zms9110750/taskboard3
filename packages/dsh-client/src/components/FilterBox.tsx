/**
 * 筛选方框 —— **内联展开**的一个方框控件（不是下拉弹窗）。
 *
 * ## 全部行为来自旧版用户逐版确认的 v4 设计
 *
 * ```
 * 收起： [状态]
 * 展开： [状态：草稿 | 进行 | 搁置 | 完成]        ← 同一方框变宽，文字可点
 * 二级： [状态：草稿 | 进行 | 搁置 | 完成 │ 成功 / 失败 / 取消 / 拒绝]
 *                                        ↑ 贯通上下的结构竖线
 * ```
 *
 * | 行为 | 在哪实现 |
 * |---|---|
 * | 收起态显示什么 / 点一下变成什么 / 二级展开谁 | **`pure/filter-box.ts`（已单测）** |
 * | 画分隔符、量宽度、动画、点外面收起 | 本文件 |
 *
 * ## 宽度动画怎么做的
 *
 * 两套「脸」（收起态 / 展开态）**都 `position: absolute`** —— 都不参与盒宽。
 * ⇒ `useLayoutEffect` 量**当前那张脸**的宽度，写到 `.filter-box` 上，
 *   CSS 对 `width` 做 180ms 过渡。
 * ⇒ 视觉上是「方块按钮变宽露出内容」，而不是「内容突然出现把布局挤开」。
 *
 * ⚠ **量宽度必须量当前那张脸。** 量错了会得到一个偏大/偏小的方框，
 *   而且只在特定选项组合下错（很难发现）。
 *
 * ## 点外面收起：必须用 `composedPath()`
 *
 * ⚠ **不能用「点击后的 DOM 判断里外」。**
 * 点方框里的某项时，项自己的 `onClick` 会触发重渲染（React 会换掉那个节点）
 * ⇒ 冒泡到 `document` 时 `boxRef.current.contains(target)` 已是 `false`
 * ⇒ 若用它判断，**点别的方框时本框会被误判成「点在自己身上」而赖着不收**。
 *
 * `event.composedPath()` 是**事件派发那一刻**的祖先快照，不受后续重渲染影响。
 * （旧版注释里明确记了这个坑；我们照抄，因为它是对的。）
 *
 * ## 一次只展开一个
 *
 * 「一次只应该能拉起一个组的子内容」（用户原话）。
 * 实现：每个方框各挂一个 document 监听，点任何别的方框时前一个收到「点在外面」⇒ 收起。
 * 这样不需要一个全局的「谁开着」注册表 —— 少一份要维护的状态。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
	collapsedSplit,
	levelOne,
	levelTwo,
	selectionText,
} from '../pure/filter-box.ts';
import type { FilterOption, Picked } from '../pure/filter-box.ts';

/** 组件属性。 */
export interface FilterBoxProps {
	/** 方框标题（`状态` / `类别` / `领域`）。 */
	readonly title: string;
	/** 全部选项。分组信息挂在 `option.group` 上。 */
	readonly options: readonly FilterOption[];
	/** 当前已选值（数据契约永远是数组；UI 上是单选语义）。 */
	readonly picked: Picked;
	/** 已选变化。组件只调这一个回调，不改任何状态。 */
	readonly onChange: (next: Picked) => void;
}

/**
 * 一个筛选方框。
 *
 * @param props 标题、选项、已选、变化回调
 */
export function FilterBox(props: FilterBoxProps): ReactNode {
	const [open, setOpen] = useState(false);
	const boxRef = useRef<HTMLDivElement>(null);
	const collapsedRef = useRef<HTMLDivElement>(null);
	const expandedRef = useRef<HTMLDivElement>(null);

	const text = selectionText(props.options, props.picked);
	const split = collapsedSplit(props.picked);
	const one = levelOne(props.options, props.picked);
	const two = levelTwo(props.options, props.picked);

	/*
	 * 量当前那张脸，把宽度写到方框上。
	 *
	 * 依赖里必须包含 `open` / `text` / `one` / `two` —— 任何一个变了，
	 * 当前那张脸的宽度都可能变（比如「完成」→「完成/成功」变宽）。
	 * 少一个依赖 = 方框宽度不跟着更新 = 内容被裁掉。
	 */
	useLayoutEffect(() => {
		const box = boxRef.current;
		const face = open ? expandedRef.current : collapsedRef.current;
		if (box === null || face === null) return;

		/* +24 = 左右各 12px 内边距（`left: 12px` + 右侧留白）。 */
		const width = Math.ceil(face.getBoundingClientRect().width) + 24;
		box.style.width = `${width}px`;
	}, [open, text, one, two, props.options]);

	/*
	 * 点外面收起。
	 *
	 * ⚠ 用 `composedPath()` 而不是 `contains()`，理由见文件头。
	 * ⚠ 不能在点方框自己时收 —— 那样点开就立刻又被收起来。
	 */
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

	/**
	 * 点一个条目：把逻辑层算好的 `next` 交给调用方。
	 *
	 * ⚠ **点完不收起。** 用户要连着点（比如先点组、再点组里的某一项），
	 *   收起要等「点外面」。
	 */
	const pick = (next: Picked): void => {
		props.onChange(next);
	};

	return (
		<div
			ref={boxRef}
			className={open ? 'filter-box is-open' : 'filter-box'}
			/*
			 * 点方框本身：
			 * · 收起态 ⇒ 展开（`split` 时左边那个区已经自己处理了「取消并展开」，
			 *   这里兜住「点空白处」的情况）；
			 * · 展开态 ⇒ 保持（收起只由「点外面」触发）。
			 *
			 * ⚠ **不 `stopPropagation`** —— 让 document 上「点外面收起」自己生效，
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
							title="点一下取消筛选并展开"
							onClick={(event) => {
								event.stopPropagation();
								pick([]);
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

				{/* 一级：之间用 | */}
				<span className="filter-box__items">
					{one.map((entry, index) => (
						<ItemWrap key={`one-${entry.label}`} first={index === 0} sep="|">
							<Item
								label={entry.label}
								picked={entry.picked}
								onClick={() => pick(entry.next)}
							/>
						</ItemWrap>
					))}
				</span>

				{/* 一级 / 二级之间：贯通上下的结构竖线 */}
				{two !== undefined && <span className="filter-box__vline" />}

				{/* 二级：之间用 / */}
				{two !== undefined && (
					<span className="filter-box__items filter-box__items--children">
						{two.map((entry, index) => (
							<ItemWrap key={`two-${entry.label}`} first={index === 0} sep="/">
								<Item
									label={entry.label}
									picked={entry.picked}
									onClick={() => pick(entry.next)}
								/>
							</ItemWrap>
						))}
					</span>
				)}
			</div>
		</div>
	);
}

/** 分隔符 + 一项。分隔符不画在第一项前面。 */
function ItemWrap(props: {
	readonly first: boolean;
	readonly sep: string;
	readonly children: ReactNode;
}): ReactNode {
	return (
		<>
			{!props.first && <span className="filter-box__sep">{props.sep}</span>}
			{props.children}
		</>
	);
}

/**
 * 一个可点的文字。
 *
 * ⚠ **不是胶囊、不是按钮外观** —— 无边框、无底色，hover 才有淡底。
 * 用户原话：「里面不是纸片，他们都在方框里面，不是一个可以点击的按钮，
 * 而是可以点击的内容」。
 */
function Item(props: {
	readonly label: string;
	readonly picked: boolean;
	readonly onClick: () => void;
}): ReactNode {
	return (
		<button
			type="button"
			className={props.picked ? 'filter-box__item is-picked' : 'filter-box__item'}
			onClick={(event) => {
				/*
				 * ⚠ 必须 `stopPropagation`：否则冒泡到方框的 `onClick`
				 * 会再 `setOpen(true)`（虽然此时已经开着，无害），
				 * 但更重要的是**别让点击被 document 的「点外面收起」误判**。
				 * 实际上 composedPath 已经解决了那个问题，这里是双保险。
				 */
				event.stopPropagation();
				props.onClick();
			}}
		>
			{props.label}
		</button>
	);
}
