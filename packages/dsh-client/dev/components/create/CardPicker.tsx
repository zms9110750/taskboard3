/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * 卡片选择器（combobox）—— **输入框 + 下面列表 + 输入即筛选**。
 *
 * ## 用户原话（`【用户指令，2026-11-09】`，旧版 `card-picker.ts:3-7` 逐字抄的）
 *
 * > 「点开以后是输入框。然后下面显示列表。输入以后有筛选。这样的的有列表的输入框
 * >  应该有这种东西。比如搜索引擎的搜索栏都是这种组件。」
 *
 * ⇒ **不是 select**。select 不能输入筛选，这是硬差别。
 *
 * ## 三处细节（每处都有原因）
 *
 * | # | 细节 | 原因 |
 * |---|---|---|
 * | 1 | 点「外面」用 `composedPath()` 不用 `contains()` | 选一项后本组件会重画列表，被点的那个按钮**脱离了文档**；`contains()` 会把它当成「外面」⇒ 选完立刻又关上 |
 * | 2 | 列表排除**草稿**和**已删除**的卡 | 草稿不能当关系目标（协议规则）；墓碑只能按编号查详情 |
 * | 3 | 当前已选的那张**不出现在列表里** | 否则列表里有一个「点了没变化」的项 |
 *
 * ## 数据从哪来
 *
 * 父层传 `cards`（当前空间已加载的卡）。本组件**不请求后端** ——
 * 父任务 / 关系目标只能是**同一个空间**里的卡。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** 可选的卡（本组件只关心这两个字段）。 */
export interface PickableCard {
	readonly id: string;
	readonly title: string;
	/** 状态（用来滤掉草稿）。 */
	readonly status: string;
	readonly deleted: boolean;
}

/** 组件属性。 */
export interface CardPickerProps {
	/** 当前选中的卡 id；空串 = 没选。 */
	readonly value: string;
	/** 候选卡（全量，本组件自己过滤）。 */
	readonly cards: readonly PickableCard[];
	/** 没选时显示的文字（「（无，顶层）」「选择目标卡…」）。 */
	readonly placeholder: string;
	/** 允许清空（父任务要，关系目标不要）。 */
	readonly allowEmpty?: boolean;
	/** 选中变化（清空时传空串）。 */
	readonly onChange: (cardId: string) => void;
}

/** 草稿的协议名 —— 草稿不能当父任务/关系目标。 */
const DRAFT_STATUS = 'TASK_STATE_UNSPECIFIED';

/**
 * 卡片选择器。
 *
 * @param props 见 `CardPickerProps`
 */
export function CardPicker(props: CardPickerProps): ReactNode {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const rootRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	/* 打开时自动聚焦输入框 —— 用户点开就是想打字筛选。 */
	useEffect(() => {
		if (open) inputRef.current?.focus();
	}, [open]);

	/*
	 * 点外面关闭。
	 *
	 * ⚠ **必须用 `composedPath()`**：选中一项后列表会重画，被点的按钮脱离文档，
	 *   `contains(target)` 会误判成「点外面」⇒ 选完立刻又关上。
	 */
	useEffect(() => {
		if (!open) return;
		const onDocClick = (event: MouseEvent): void => {
			const root = rootRef.current;
			if (root === null) return;
			if (event.composedPath().includes(root)) return;
			setOpen(false);
			setQuery('');
		};
		document.addEventListener('click', onDocClick);
		return () => {
			document.removeEventListener('click', onDocClick);
		};
	}, [open]);

	/** 候选卡：非草稿、未删除、不是当前已选的那张。 */
	const candidates = props.cards.filter(
		(one) => !one.deleted && one.status !== DRAFT_STATUS && one.id !== props.value,
	);

	const text = query.trim().toLowerCase();
	const found =
		text === ''
			? candidates
			: candidates.filter(
					(one) => one.id.toLowerCase().includes(text) || one.title.toLowerCase().includes(text),
				);

	const selected = props.cards.find((one) => one.id === props.value);

	const pick = useCallback(
		(cardId: string): void => {
			props.onChange(cardId);
			setOpen(false);
			setQuery('');
		},
		[props],
	);

	const display =
		selected === undefined
			? /* 卡可能已不在当前列表（空间切换）：至少显示 id，不装作没选。 */
				props.value === ''
				? props.placeholder
				: props.value
			: `${selected.id} ${selected.title}`;

	return (
		<div className="picker" ref={rootRef}>
			<button
				type="button"
				className={`picker__display${props.value === '' ? ' is-empty' : ''}${open ? ' is-open' : ''}`}
				onClick={() => {
					setOpen((one) => !one);
				}}
			>
				<span className="picker__value">{display}</span>
				<span className="picker__caret">⌄</span>
			</button>

			{open ? (
				<div className="picker__pop">
					<input
						ref={inputRef}
						className="picker__input"
						type="search"
						placeholder="输入编号或标题筛选…"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
						}}
						onKeyDown={(event) => {
							if (event.key === 'Escape') {
								setOpen(false);
								setQuery('');
							}
						}}
					/>
					<div className="picker__list">
						{props.allowEmpty === true ? (
							<button
								type="button"
								className="picker__item picker__item--clear"
								onClick={() => {
									pick('');
								}}
							>
								{props.placeholder}
							</button>
						) : null}

						{found.length === 0 ? (
							<div className="picker__empty">没有匹配的卡</div>
						) : (
							found.map((card) => (
								<button
									type="button"
									className="picker__item"
									key={card.id}
									onClick={() => {
										pick(card.id);
									}}
								>
									<span className="picker__id">{card.id}</span>
									<span className="picker__title">{card.title}</span>
								</button>
							))
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}
