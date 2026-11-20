/**
 * `ask` 章节的渲染 —— 拆成 7 个小件，每个只干一件事。
 *
 * ## 数据流（单向，全受控）
 *
 * ```
 * payload(picked / custom / custom_active) → view → 组件渲染
 * 用户动作 → onAsk(AskAction) → 父层写 payload → 新 view 灌回来
 * ```
 *
 * **组件里没有「选中」state**：选中态是 `AskGroupView.picked` /
 * `.customActive`（答案字段），只能从 payload 来、往 payload 去。
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
 * | `AskCustomRow` | 自填行 = AskRow + 输入框 | group, readonly, onAsk? |
 * | `AskGroupHead` | 问题行：问题 + 未选择按钮 | group, readonly, onClear? |
 * | `AskGroupCard` | 问题页 = Head + 若干 Row | group, readonly, onAsk? |
 * | `AskSection` | 章节 = 若干 GroupCard | sectionId, view, readonly, onAsk? |
 *
 * ## 契约
 *
 * - `askCompose`（create）走另一条渲染路径，不经过本文件。
 * - `custom_active` 是答案字段（`02-action.md:436`），`custom` 是自填文字。
 * - 单选组任一时刻只有一处「已选」：点选项 ⇒ 自填行取消；点自填 ⇒ 清掉选项。
 *   这条规则由父层应用 `AskAction` 时保证（本文件只上报动作）。
 */

import { type ReactNode } from 'react';

import { askStateLabelOf, type AskAction, type AskGroupView, type AskOptionView } from '../pure/section.ts';

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
		return (
			<span className="ask-option__mark ask-option__mark--check" aria-hidden="true">
				{props.picked ? '✓' : ''}
			</span>
		);
	}
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
 * - 文字来自 `group.custom[0]`，**输入就上报**（不存草稿 state）
 * - 选中态来自 `group.customActive`（答案字段）
 * - 点整行 / 点输入框 ⇒ 上报 `custom-toggle`，父层决定互斥
 *
 * @param props group / readonly / onAsk
 */
export function AskCustomRow(props: {
	readonly group: AskGroupView;
	readonly readonly: boolean;
	readonly onAsk?: (action: AskAction) => void;
}): ReactNode {
	const text = props.group.custom[0] ?? '';
	const picked = props.group.customActive;
	const placeholder = props.group.placeholder === '' ? '其它（自己填）…' : props.group.placeholder;

	return (
		<AskRow
			picked={picked}
			multiSelect={props.group.multiSelect}
			readonly={props.readonly}
			{...(props.onAsk === undefined ? {} : { onSelect: () => props.onAsk?.({ type: 'custom-toggle' }) })}
		>
			{props.readonly ? (
				<span className="ask-option__body">
					<span className="ask-option__label">{text === '' ? '（未填写）' : text}</span>
				</span>
			) : (
				<input
					type="text"
					className="ask-group__custom"
					value={text}
					placeholder={placeholder}
					onClick={() => props.onAsk?.({ type: 'custom-toggle' })}
					onChange={(event) => props.onAsk?.({ type: 'custom-input', text: event.target.value })}
					onKeyDown={(event) => {
						/* 别让回车冒泡到父层（比如关详情）。 */
						if (event.key === 'Enter') event.stopPropagation();
					}}
				/>
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

	if (group.empty) {
		return (
			<div className="ask-group" data-ask-group-empty="1">
				<div className="section-block__placeholder">还没有选项。</div>
			</div>
		);
	}

	return (
		<div
			className="ask-group"
			data-ask-multi={String(group.multiSelect)}
			data-ask-state={group.pickedState}
			/*
			 * 选择态：只要**不是未选择**（`picked` / `none`）⇒ 整个问题页左边打边框。
			 * 冻结态不打整页，改打选中选项（见 `AskRow` 的 `is-readonly` + CSS）。
			 */
			data-ask-active={String(!props.readonly && group.pickedState !== 'unset')}
		>
			<AskGroupHead
				group={group}
				readonly={props.readonly}
				{...(ask === undefined ? {} : { onClear: () => ask({ type: 'clear' }) })}
			/>

			<div className="ask-group__options">
				{group.options.map((option) => (
					<AskOptionRow
						key={option.label}
						option={option}
						multiSelect={group.multiSelect}
						readonly={props.readonly}
						{...(ask === undefined ? {} : { onPick: (label) => ask({ type: 'pick', label }) })}
					/>
				))}
				<AskCustomRow group={group} readonly={props.readonly} {...(ask === undefined ? {} : { onAsk: ask })} />
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
