/**
 * `ask` 章节的渲染 —— 拆成 7 个小件，每个只干一件事。
 *
 * ## 数据流（单向，全受控）
 *
 * ```
 * payload(picked / custom) → view → 组件渲染
 * 用户动作 → onAsk(AskAction) → 父层写 payload → 新 view 灌回来
 * ```
 *
 * **选中态是 `AskGroupView.picked` / `.customActive`（答案字段）**，只能从 payload
 * 来、往 payload 去。唯一的例外是**自填框草稿**（`AskGroupCard` 里的一个
 * `useState<AskCustomDraft | undefined>`，issue #61「输入即选中」）：
 *
 * ```
 * 草稿 ──askDraftViewOf()──▶ 这一帧画的东西（自填选中 / 同组选项取消 / 未选择熄灭）
 * 草稿 ──askCustomCommitOf()─▶ 失焦那一次 PATCH（只聚焦不打字 ⇒ 没有 PATCH）
 * ```
 *
 * 草稿**不落库**，所以「一次编辑一次 PATCH」的既有节奏不变；两个判决都在
 * `src/pure/section.ts`，组件只调用。
 *
 * > 用户 2026-11-21：「重构这个组件。还继续细分组件的就细分。不要写胶水代码。
 * > 拿来那么多奇奇怪怪的逻辑。这个组件很难写吗？公开几个参数然后保证内部状态，
 * > 保持逻辑一致性。」
 *
 * ## 组件
 *
 * | 组件 | 职责 | 参数 |
 * |---|---|---|
 * | `AskMark` | 画标记（圆圈 / 方框 / 勾）| picked, multiSelect, readonly |
 * | `AskRow` | 行外壳：标记 + body + 整行点击 | picked, multiSelect, readonly, onSelect?, children |
 * | `AskOptionRow` | 普通选项 = AskRow + 标题/说明 | option, multiSelect, readonly, onPick? |
 * | `AskCustomRow` | 自填行 = AskRow + 输入框 | group, picked, draft, readonly, onDraft?, onAsk? |
 * | `AskGroupHead` | 问题行：问题 + 未选择按钮 | group, readonly, onClear? |
 * | `AskGroupCard` | 问题页 = Head + 若干 Row（**草稿在这里**）| group, readonly, onAsk? |
 * | `AskSection` | 章节 = 若干 GroupCard | sectionId, view, readonly, onAsk? |
 *
 * ## 契约
 *
 * - `askCompose`（create）走另一条渲染路径，不经过本文件。
 * - 字段以 `packages/core/src/template/actions.ts` 的 `askItemSchema` 为准：
 *   `picked` / `custom`，**没有** `custom_active`。
 * - 单选组任一时刻只有一处「已选」：点选项 ⇒ 自填行取消；点自填 ⇒ 清掉选项。
 *   这条规则由父层应用 `AskAction` 时保证（本文件只上报动作）；输入草稿的叠加
 *   由 `askDraftViewOf()` 保证**同一帧**一致。
 */

import { useState, type ReactNode } from 'react';

import {
	askCustomCommitOf,
	askDraftViewOf,
	askStateLabelOf,
	type AskAction,
	type AskCustomDraft,
	type AskGroupView,
	type AskOptionView,
} from '../pure/section.ts';

/* ══════════════════════════════════════════════════════════
   ① 标记
   ══════════════════════════════════════════════════════════ */

/**
 * 选中标记。
 *
 * | 相位 | 单选 | 多选 |
 * |---|---|---|
 * | 可作答 | ○ / ● | □ / ■ |
 * | 冻结 | ✓（选中时）| ✓（选中时）|
 */
function AskMark(props: {
	readonly picked: boolean;
	readonly multiSelect: boolean;
	readonly readonly: boolean;
}): ReactNode {
	if (props.readonly) {
		/*
		 * 冻结态：**只有选中项画 ✓**，未选中什么都不画。
		 *
		 * 用户 2026-11-21：「冻结的未选中不需要圆点啊。我什么时候说过要了？
		 * 冻结都不给你动了，你要一个示意"可选择"的东西做什么？
		 * 所以这里的已选择是勾，跟可选择态的圆圈不一样了啊。暗示不可交互」
		 *
		 * ⇒ 空 span 保留只为**占位对齐**（14px），不画任何形状。
		 */
		return (
			<span className="ask-option__mark ask-option__mark--check" aria-hidden="true">
				{props.picked ? '✓' : ''}
			</span>
		);
	}
	/* 可交互：圆圈（单选）/ 方框（多选） */
	return (
		<span
			className="ask-option__mark ask-option__mark--box"
			data-multi={String(props.multiSelect)}
			aria-hidden="true"
		/>
	);
}

/* ══════════════════════════════════════════════════════════
   ② 行外壳（普通选项和自填**共用**这一个）
   ══════════════════════════════════════════════════════════ */

/**
 * 一行可选项。
 *
 * 普通选项和自填行的**唯一差别是 body**：这里只负责
 * 标记 / `is-picked` / 整行热区 —— 两者行为完全一致。
 *
 * 用 `div` + `role="button"` 而不是 `<button>`：自填行的 body 里有 `<input>`，
 * `button` 不能嵌交互控件。用同一种元素就能让两者走完全相同的代码路径。
 */
function AskRow(props: {
	/** 行的种类 —— 测试/样式用的稳定钩子，不参与行为判断。 */
	readonly kind: 'option' | 'custom';
	readonly picked: boolean;
	readonly multiSelect: boolean;
	readonly readonly: boolean;
	readonly onSelect?: () => void;
	readonly children: ReactNode;
}): ReactNode {
	const className = ['ask-option'];
	if (props.picked) className.push('is-picked');
	if (props.readonly) className.push('is-readonly');

	const interactive = !props.readonly && props.onSelect !== undefined;

	return (
		<div
			className={className.join(' ')}
			data-row-kind={props.kind}
			data-picked={String(props.picked)}
			{...(interactive
				? {
						role: 'button',
						tabIndex: 0,
						onClick: props.onSelect,
						onKeyDown: (event: React.KeyboardEvent) => {
							if (event.key !== 'Enter' && event.key !== ' ') return;
							event.preventDefault();
							props.onSelect?.();
						},
					}
				: {})}
		>
			<AskMark picked={props.picked} multiSelect={props.multiSelect} readonly={props.readonly} />
			{props.children}
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   ③ 普通选项行
   ══════════════════════════════════════════════════════════ */

/**
 * 一个普通选项。
 *
 * @param props option / multiSelect / readonly / onPick
 */
export function AskOptionRow(props: {
	readonly option: AskOptionView;
	readonly multiSelect: boolean;
	readonly readonly: boolean;
	readonly onPick?: (label: string) => void;
}): ReactNode {
	const label = props.option.label;

	return (
		<AskRow
			kind="option"
			picked={props.option.picked}
			multiSelect={props.multiSelect}
			readonly={props.readonly}
			{...(props.onPick === undefined ? {} : { onSelect: () => props.onPick?.(label) })}
		>
			<span className="ask-option__body">
				<span className="ask-option__label">{label}</span>
				{props.option.description === '' ? null : (
					<span className="ask-option__desc">{props.option.description}</span>
				)}
			</span>
		</AskRow>
	);
}

/* ══════════════════════════════════════════════════════════
   ④ 自填行
   ══════════════════════════════════════════════════════════ */

/**
 * 「其它（自己填）」行 = `AskRow` + 受控输入框。
 *
 * - 文字：输入中显示 `draft.text`（**组件级草稿**，见 `AskGroupCard`），
 *   不在输入时显示 `group.custom[0]`（答案字段）
 * - **输入即选中**（issue #61）：`onFocus` / `onInput` 任一触发 ⇒ 交给 `onDraft`
 *   记下草稿，同一次渲染里这一行就是选中态（叠加规则在 `askDraftViewOf()`）
 * - **落库节奏不变**：只有「真的打过字」的那一轮，才在失焦时发一次 `custom-input`
 *   （lead `2026-11-28`：一次编辑一次 PATCH；否则每敲一个字都写一次库）。
 *   只聚焦不打字 ⇒ 界面选了一下、失焦回到原答案，**不产生 PATCH**
 *   （用户 `2026-11-21`：「点输入框不是选择（可能只是想刮取/看文字）」）
 * - 点整行 / 点「自己填：」⇒ 上报 `custom-toggle`，父层决定互斥
 * - 点输入框本身**不是 toggle**（不会把已选中的自填取消掉）；它只是聚焦 ⇒ 选中
 *
 * @param props group / picked / draft / readonly / onDraft / onAsk
 */
export function AskCustomRow(props: {
	/** 真值视图（`stored` 文字 / 多选标记）。 */
	readonly group: AskGroupView;
	/** 这一行当前是否选中 —— 可能是草稿叠加后的结果。 */
	readonly picked: boolean;
	/** 输入中的草稿；`undefined` = 没在输入。 */
	readonly draft: AskCustomDraft | undefined;
	readonly readonly: boolean;
	/** 草稿变化（`undefined` = 结束输入）。省略 = 这一行不可作答。 */
	readonly onDraft?: (next: AskCustomDraft | undefined) => void;
	readonly onAsk?: (action: AskAction) => void;
}): ReactNode {
	const stored = props.group.custom[0] ?? '';
	const placeholder = props.group.placeholder === '' ? '其它（自己填）…' : props.group.placeholder;
	/** 输入框该显示什么：输入中用草稿，否则用答案里的文字。 */
	const value = props.draft?.text ?? stored;

	/**
	 * 结束输入：先把草稿清掉（回到「跟着答案走」），再按 pure 的判决落库。
	 */
	const commit = (): void => {
		const action = askCustomCommitOf(props.group, props.draft);
		props.onDraft?.(undefined);
		if (action !== undefined) props.onAsk?.(action);
	};

	return (
		<AskRow
			kind="custom"
			picked={props.picked}
			multiSelect={props.group.multiSelect}
			readonly={props.readonly}
			{...(props.onAsk === undefined ? {} : { onSelect: () => props.onAsk?.({ type: 'custom-toggle' }) })}
		>
			{props.readonly ? (
				<span className="ask-option__body">
					<span className="ask-option__label">{stored === '' ? '（未填写）' : stored}</span>
				</span>
			) : (
				<>
					{/*
					 * 「自己填：」是**可点的选中入口**（用户 2026-11-21 第 2 条）。
					 * 没有它的话整行都是输入框，只能往里打字、没法「选」这一行。
					 */}
					<button
						type="button"
						className="ask-option__custom-label"
						data-ask-custom-label
						onClick={(event) => {
							/* 别冒泡到 AskRow —— 否则会 toggle 两次（选中又取消）。 */
							event.stopPropagation();
							props.onAsk?.({ type: 'custom-toggle' });
						}}
					>
						自己填：
					</button>
					<input
						type="text"
						className="ask-group__custom"
						data-ask-custom
						value={value}
						/* 占位符就是空框里的灰字；不再重复「自己填」 */
						placeholder={placeholder}
						/*
						 * 点输入框不 toggle（stopPropagation 阻止外层选中）——
						 * 它只是聚焦；**聚焦本身就等于选中这一行**（issue #61）。
						 */
						onClick={(event) => event.stopPropagation()}
						onMouseDown={(event) => event.stopPropagation()}
						onFocus={() => {
							/*
							 * 聚焦 ⇒ 草稿 = 当前文字（`edited: false`）⇒ 同一帧切到 custom。
							 * 没打字就失焦 ⇒ 不落库（见 `AskCustomDraft.edited` 的说明）。
							 */
							props.onDraft?.({ text: value, edited: false });
						}}
						onChange={(event) => {
							/* 每次按键更新草稿（`edited: true`）⇒ 选中态立刻跟着走，但仍不落库。 */
							props.onDraft?.({ text: event.target.value, edited: true });
						}}
						onBlur={commit}
						onKeyDown={(event) => {
							/* 别让回车冒泡到父层（比如关详情）。 */
							if (event.key === 'Enter') event.stopPropagation();
						}}
					/>
				</>
			)}
		</AskRow>
	);
}

/* ══════════════════════════════════════════════════════════
   ⑤ 问题行
   ══════════════════════════════════════════════════════════ */

/**
 * 问题 + 「未选择」按钮。
 *
 * 「未选择」按钮当前就是未选择时**亮起**（黑底白字），点它回到这个状态。
 *
 * @param props group / readonly / onClear
 */
export function AskGroupHead(props: {
	readonly group: AskGroupView;
	readonly readonly: boolean;
	readonly onClear?: () => void;
}): ReactNode {
	const unset = props.group.pickedState === 'unset';

	return (
		<div className="ask-group__qrow">
			{props.group.question === '' ? null : (
				<div className="ask-group__question">{props.group.question}</div>
			)}
			{props.group.header === '' ? null : (
				<div className="ask-group__header">{props.group.header}</div>
			)}
			{props.onClear === undefined ? null : (
				<button
					type="button"
					className={`ghost-btn ask-group__state-btn${unset ? ' is-on' : ''}`}
					title="把这一题重置成「未选择」"
					onClick={props.onClear}
				>
					未选择
				</button>
			)}
			{props.readonly ? (
				<span className="ask-group__state-text">{askStateLabelOf(props.group)}</span>
			) : null}
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   ⑥ 问题页
   ══════════════════════════════════════════════════════════ */

/**
 * 一个问题页 = 问题行 + 选项行们 + 自填行。
 *
 * ## 唯一的组件级 state：自填框草稿
 *
 * 「输入即选中」（issue #61）要求**同一帧**里三件事一起发生：自填行选中、
 * 同组其它选项取消、`未选择` 熄灭。选中态只能从 payload 来，而 payload 要等失焦
 * 才写 ⇒ 这里存一份**不落库的草稿**，渲染时用 `askDraftViewOf()` 叠上去：
 *
 * ```
 * draft ──askDraftViewOf()──▶ shown（这一帧真正画的东西）
 * draft ──askCustomCommitOf()─▶ 失焦那一次 PATCH（打过字才有，仍是 custom-input）
 * ```
 *
 * 规则一条都不在这里判：单选清同组、多选共存、多选空文字不算选中、只聚焦不落库，
 * 全在 pure 里（`AskCustomDraft`）。
 *
 * @param props sectionId / group / readonly / onAsk
 */
export function AskGroupCard(props: {
	readonly sectionId: string;
	readonly group: AskGroupView;
	readonly readonly: boolean;
	readonly onAsk?: (sectionId: string, action: AskAction) => void;
}): ReactNode {
	const group = props.group;
	const ask = props.onAsk === undefined ? undefined : (action: AskAction) => props.onAsk?.(props.sectionId, action);

	/**
	 * 自填框的输入草稿；`undefined` = 没在输入（一切跟着答案走）。
	 *
	 * ⚠ 草稿是**纯视觉**的：它不写 payload。只有「真的打过字」的那一轮才在失焦时
	 * 落一次 `custom-input` ⇒ 「一次编辑一次 PATCH」的节奏不变。
	 */
	const [draft, setDraft] = useState<AskCustomDraft | undefined>(undefined);

	if (group.empty) {
		return (
			<div className="ask-group" data-ask-group-empty="1">
				<div className="section-block__placeholder">还没有选项。</div>
			</div>
		);
	}

	/* 没接作答回调 / 冻结态 ⇒ 没有草稿这回事。 */
	const shown = askDraftViewOf(group, props.readonly || ask === undefined ? undefined : draft);

	return (
		<div
			className="ask-group"
			data-ask-multi={String(shown.multiSelect)}
			data-ask-state={shown.pickedState}
			/*
			 * 选择态：只要**不是未选择**（`picked` / `none`）⇒ 整个问题页左边打边框。
			 * 冻结态不打整页，改打选中选项（见 `AskRow` 的 `is-readonly` + CSS）。
			 */
			data-ask-active={String(!props.readonly && shown.pickedState !== 'unset')}
		>
			<AskGroupHead
				group={shown}
				readonly={props.readonly}
				{...(ask === undefined ? {} : { onClear: () => ask({ type: 'clear' }) })}
			/>

			<div className="ask-group__options">
				{shown.options.map((option) => (
					<AskOptionRow
						key={option.label}
						option={option}
						multiSelect={shown.multiSelect}
						readonly={props.readonly}
						{...(ask === undefined ? {} : { onPick: (label) => ask({ type: 'pick', label }) })}
					/>
				))}
				<AskCustomRow
					group={group}
					picked={shown.customActive}
					/*
					 * 草稿原样给它 —— 即使叠加结果「没有可见变化」（多选 + 空文字：
					 * 比如把「还有配色」删空），输入框也必须跟着草稿显示空串。
					 */
					draft={draft}
					readonly={props.readonly}
					{...(ask === undefined ? {} : { onAsk: ask, onDraft: setDraft })}
				/>
			</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   ⑦ 章节
   ══════════════════════════════════════════════════════════ */

/** `AskSection` 的属性。 */
export interface AskSectionProps {
	/** 章节 id（回调原样带回）。 */
	readonly sectionId: string;
	/** pure 已经翻好的 ask 视图。 */
	readonly view: { readonly groups: readonly AskGroupView[]; readonly empty: boolean };
	/** 只读：只显示，不给点、不给填。 */
	readonly readonly: boolean;
	/**
	 * 一次作答动作。省略 = 只读。
	 *
	 * 带 `groupIndex`：答案要写进 `items[groupIndex]`，父层必须知道改哪一组。
	 */
	readonly onAsk?: (sectionId: string, groupIndex: number, action: AskAction) => void;
}

/**
 * 一个 ask 章节。
 *
 * @param props 见 `AskSectionProps`
 */
export function AskSection(props: AskSectionProps): ReactNode {
	const interactive = !props.readonly && props.onAsk !== undefined;

	if (props.view.empty) {
		return (
			<div className="ask" data-ask-empty="1">
				<div className="section-block__placeholder">这一章没有可显示的问题。</div>
			</div>
		);
	}

	return (
		<div className="ask" data-ask-readonly={String(!interactive)}>
			{props.view.groups.map((group, index) => (
				<AskGroupCard
					key={index}
					sectionId={props.sectionId}
					group={group}
					readonly={!interactive}
					{...(interactive && props.onAsk !== undefined
						? {
								onAsk: (sectionId: string, action: AskAction) => {
									props.onAsk?.(sectionId, index, action);
								},
							}
						: {})}
				/>
			))}
		</div>
	);
}
