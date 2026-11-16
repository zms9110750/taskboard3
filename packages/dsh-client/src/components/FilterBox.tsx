/**
 * 筛选方框 —— **面包屑导航**控件。
 *
 * ## 用户 `2026-11-16`（第三版，最终定义）
 *
 * > 「你不知道面包屑导航吗？我说的是点到谁就选中谁。点到完成，就选中完成。
 * >  那么完成的子级的选中就要取消掉。列出『完成』的子项。」
 * > 「除此以外，只展示两个层级。」
 * > 「比如选中了 1/2/3/2/4，那么就要这样列出
 * >  1/2/3/2 | 1 / 2 / 3 / 4 | 1 / 2 / 3」
 *
 * ## 一个方框永远是三段
 *
 * ```
 *   ①面包屑          ②当前层兄弟         ③选中项的子
 *   1/2/3/2     |    1 / 2 / 3 / 4   |   1 / 2 / 3
 *   紧斜杠             空格斜杠             空格斜杠
 * ```
 *
 * | 段 | 内容 | 可点 | 点了之后 |
 * |---|---|---|---|
 * | ① | 路径上**除自己外**的祖先 | ✅ | 跳回那一层（截断路径）|
 * | ② | **当前层的全部兄弟**（选中的高亮）| ✅ | 选中它 + 丢掉它下面那层 |
 * | ③ | **选中项的子** | ✅ | 下探一层 |
 *
 * ⚠ **只有 ②③ 是可点层**（「只展示两个层级」）。爷爷辈只以面包屑形式存在，
 *   不再展开成选项 —— 否则四级就是四排文字，方框会失控。
 *
 * ## 区别靠什么表达
 *
 * 用户问：「你让他就一个按钮，那你怎么区分点到了谁身上？」
 *
 * ⇒ **靠三个视觉信号**，不用边框或色块：
 * 1. **分隔符不同**：① 用紧斜杠 `/`，②③ 用空格斜杠 ` / `；
 * 2. **一条竖线**把 ① 和 ②③ 分开（结构分隔，比颜色可靠）；
 * 3. **选中项蓝字加粗**，其余黑字。
 *
 * ## 全部判决在 `pure/filter-box.ts`（30 条单测）
 *
 * 组件只做四件事：画三段、画分隔符、量宽度、把 `next` 交给 `onChange`。
 */

import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { collapsedCrumbs, hasSelection, viewOf } from '../pure/filter-box.ts';
import type { FilterNode, Picked } from '../pure/filter-box.ts';

/** 组件属性。 */
export interface FilterBoxProps {
	/** 稳定 id（`FilterRow` 用它做互斥；同时写到 DOM 的 `data-box-id`）。 */
	readonly boxId: string;
	/** 方框标题（`状态` / `类别` / `领域`）。 */
	readonly title: string;
	/** 全部节点。有 `children` 的就是能下探的。 */
	readonly nodes: readonly FilterNode[];
	/** 当前选中路径（从根往下）。 */
	readonly picked: Picked;
	/** **开合状态由外面给**（受控）。 */
	readonly open: boolean;
	/** 选中变化。 */
	readonly onChange: (next: Picked) => void;
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

	const hasValue = hasSelection(props.picked);
	const view = viewOf(props.nodes, props.picked);

	/*
	 * 收起态是**面包屑**，不是一串字符串。
	 *
	 * 用户 `2026-11-16`：
	 * > 「我要的是，『进行』，可以点。『提交』，可以点。
	 * >  不是『进行/提交』这一个按钮。……每一层，虽然他写的是文字。
	 * >  但是文字都是可以单独点击的。」
	 */
	const crumbsCollapsed = collapsedCrumbs(props.nodes, props.picked);

	const key = JSON.stringify([
		crumbsCollapsed.map((one) => one.label),
		view.crumbs.map((one) => one.label),
		view.currentLevel.map((one) => one.label),
		view.childLevel.map((one) => one.label),
	]);

	/* 量当前那张脸，把宽度写到方框上（两套脸都 absolute，不参与盒宽）。 */
	useLayoutEffect(() => {
		const box = boxRef.current;
		const face = props.open ? expandedRef.current : collapsedRef.current;
		if (box === null || face === null) return;
		/* +24 = 左右各 12px 内边距。 */
		box.style.width = `${Math.ceil(face.getBoundingClientRect().width) + 24}px`;
	}, [props.open, key]);

	const pick = (next: Picked): void => {
		props.onChange(next);
	};

	return (
		<div
			ref={boxRef}
			data-box-id={props.boxId}
			className={props.open ? 'filter-box is-open' : 'filter-box'}
			onClick={() => {
				if (!props.open) props.onOpenChange(true);
			}}
		>
			{/*
			 * ── 收起态：标题 + 面包屑 ──
			 *
			 * ## 「标题 = 第 0 级」——用户 `2026-11-16` 定的
			 *
			 * > 「这个标题本身就是第0级。选中第0级，展开第1级，这个意思就是清空。」
			 *
			 * ⇒ 点标题 = **清空所有选择**并展开（= 选中第 0 级）。
			 *   这是**唯一**的全清入口，所以不再需要独立的 ✕ 按钮，
			 *   也不再需要 `▾`（它没有独立语义）。
			 *
			 * 层级图：
			 *
			 * ```
			 *   状态：  [进行] / [提交]
			 *   └第0级   └第1级  └第2级
			 *    点它
			 *    =清空
			 * ```
			 */}
			<div ref={collapsedRef} className="filter-box__face filter-box__face--collapsed">
				<button
					type="button"
					className="filter-box__title filter-box__title--clickable"
					title={hasValue ? '清空筛选（选中第 0 级）' : '展开'}
					onClick={(event) => {
						event.stopPropagation();
						if (hasValue) pick([]);
						props.onOpenChange(true);
					}}
				>
					{props.title}
				</button>
				{hasValue && (
					<>
						<span className="filter-box__colon">：</span>
						<span className="filter-box__crumbs">
							{crumbsCollapsed.map((crumb, index) => (
								<span key={`cc-${crumb.value}`} style={{ display: 'contents' }}>
									{index > 0 && <span className="filter-box__csep">/</span>}
									<button
										type="button"
										className={index === crumbsCollapsed.length - 1
											? 'filter-box__item is-picked'
											: 'filter-box__item'}
										title={`选中 ${crumb.label}（丢弃它下面的）`}
										onClick={(event) => {
											event.stopPropagation();
											pick(crumb.next);
										}}
									>
										{crumb.label}
									</button>
								</span>
							))}
						</span>
					</>
				)}
				{/* 没值时点空白处也能展开（标题已经是按钮了，这里只是兜住右侧留白）。 */}
				{!hasValue && <span className="filter-box__caret" />}
			</div>

			{/* ── 展开态：三段 ── */}
			<div ref={expandedRef} className="filter-box__face filter-box__face--expanded">
				<span className="filter-box__title">{props.title}</span>
				<span className="filter-box__colon">：</span>

				{/* ① 面包屑（祖先，紧斜杠） */}
				{view.crumbs.length > 0 && (
					<>
						<span className="filter-box__crumbs">
							{view.crumbs.map((crumb, index) => (
								<span key={`crumb-${crumb.value}`} style={{ display: 'contents' }}>
									{index > 0 && <span className="filter-box__csep">/</span>}
									<button
										type="button"
										className="filter-box__item"
										title={`跳回 ${crumb.label}`}
										onClick={(event) => {
											event.stopPropagation();
											pick(crumb.next);
										}}
									>
										{crumb.label}
									</button>
								</span>
							))}
						</span>
						{/* ① 与 ②③ 之间的结构竖线 */}
						<span className="filter-box__vline" />
					</>
				)}

				{/* ② 当前层兄弟（空格斜杠） */}
				<span className="filter-box__items">
					{view.currentLevel.map((option, index) => (
						<span key={`cur-${option.value}`} style={{ display: 'contents' }}>
							{index > 0 && <span className="filter-box__sep"> / </span>}
							<Option
								label={option.label}
								picked={option.picked}
								hasChildren={option.hasChildren}
								onClick={() => pick(option.next)}
							/>
						</span>
					))}
				</span>

				{/* ② 与 ③ 之间的结构竖线（只在有子层时画） */}
				{view.childLevel.length > 0 && <span className="filter-box__vline" />}

				{/* ③ 选中项的子（空格斜杠） */}
				{view.childLevel.length > 0 && (
					<span className="filter-box__items">
						{view.childLevel.map((option, index) => (
							<span key={`child-${option.value}`} style={{ display: 'contents' }}>
								{index > 0 && <span className="filter-box__sep"> / </span>}
								<Option
									label={option.label}
									picked={option.picked}
									hasChildren={option.hasChildren}
									onClick={() => pick(option.next)}
								/>
							</span>
						))}
					</span>
				)}
			</div>
		</div>
	);
}

/**
 * 一个可点的文字。
 *
 * ⚠ **不是胶囊、不是按钮外观** —— 无边框、无底色，hover 才有淡底。
 * 用户原话：「里面不是纸片，他们都在方框里面，不是一个可以点击的按钮，
 * 而是可以点击的内容」。
 *
 * · `picked` —— 蓝字 + 加粗
 * · 有子节点 —— 名字后面一个小 `›`
 */
function Option(props: {
	readonly label: string;
	readonly picked: boolean;
	readonly hasChildren: boolean;
	readonly onClick: () => void;
}): ReactNode {
	return (
		<button
			type="button"
			className={props.picked ? 'filter-box__item is-picked' : 'filter-box__item'}
			onClick={(event) => {
				/* 别让冒泡触到方框的 onClick（那会重复请求展开）。 */
				event.stopPropagation();
				props.onClick();
			}}
		>
			{props.label}
			{props.hasChildren && <span className="filter-box__more">›</span>}
		</button>
	);
}
