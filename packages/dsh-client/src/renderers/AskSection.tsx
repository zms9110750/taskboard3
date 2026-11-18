/**
 * `ask` 类型章节的内容 —— **选项列表 + 三态徽标 + 「都不要」+ 自填框**。
 *
 * ## 为什么单独一个文件
 *
 * text / markdown 只有「画文字」，而 ask 有**交互**：选项要能点、要有选中态、
 * 要能提交自填值。把它塞在 `Section.tsx` 的 switch 里会让那个文件同时管
 * 三种画法 + 一种交互，改一处要读全篇。
 *
 * ## 语义仍然全在 pure
 *
 * `dev/pure/section.ts` 的 `askSectionOf()` 已经把 payload 翻成
 * `AskGroupView`（含 `pickedState` 三态、每个选项的 `picked`、`multiSelect`、
 * `custom`）。本文件**不判断**「这个 payload 是什么意思」，只做三件事：
 *
 * ```ts
 * 点选项   → onAnswer(sectionId, option.label)   // 单选/多选由父层按 payload 解释
 * 点都不要 → onAnswer(sectionId, NO_ANSWER)      // NO_ANSWER === ''
 * 自填提交 → onAnswer(sectionId, 输入的文字)
 * ```
 *
 * ⚠ **组件不改 payload**：它不自己算新 `picked`、不发请求。新 payload 由父层
 *   根据 `onAnswer` 拼出来再灌回来 —— 与旧版「渲染器给完整 payload」相反，
 *   这里是「组件只上报被点了哪个」。理由：组件的参数只有 `value: string`，
 *   它拿不到「多选时该 append 还是覆盖」的策略，那是父层/领域的事。
 *
 * ## picked 三态必须区分显示（core 的注释原文）
 *
 * | `picked` | 含义 | 界面 |
 * |---|---|---|
 * | 不存在 | 未选择 | 徽标「未选择」 |
 * | `[]` | 看了但都不要 | 徽标「都不要」 |
 * | `["A"]` | 选了 A | 徽标「单选·已选 1」/「多选·已答 N」+ 选项高亮 |
 *
 * ## 只读时不假装可点
 *
 * `readonly` 为真 ⇒ 选项渲染成 `<div>`（不是 `<button>`）、没有自填框、
 * 没有「都不要」。**不用 `disabled` + 仍可点** 那种半吊子形态。
 */

import { useState, type ReactNode } from 'react';

import {
	NO_ANSWER,
	askStateLabelOf,
	type AskGroupView,
	type AskOptionView,
	type AskSectionView,
} from '../pure/section.ts';

/** `AskSection` 的属性。 */
export interface AskSectionProps {
	/** 章节 id（回调原样带回）。 */
	readonly sectionId: string;
	/** pure 已经翻好的 ask 视图。 */
	readonly view: AskSectionView;
	/** 只读：只显示，不给点、不给填。 */
	readonly readonly: boolean;
	/** 选项 / 都不要 / 自填被提交。没接就什么都不发（但也不假装能点）。 */
	readonly onAnswer?: (sectionId: string, value: string) => void;
}

/**
 * 一个 ask 章节。
 *
 * @param props 见 `AskSectionProps`
 */
export function AskSection(props: AskSectionProps): ReactNode {
	const interactive = !props.readonly && props.onAnswer !== undefined;

	/* items 为空（脏数据 / options 缺失）也要有话说，不白屏。 */
	if (props.view.empty) {
		return (
			<div className="ask" data-ask-empty="1">
				<div className="section-block__placeholder">这一章没有可显示的问题。</div>
			</div>
		);
	}

	return (
		<div className="ask" data-ask-interactive={String(interactive)}>
			{props.view.groups.map((group, index) => (
				<AskGroupBlock
					key={index}
					sectionId={props.sectionId}
					group={group}
					interactive={interactive}
					{...(props.onAnswer === undefined ? {} : { onAnswer: props.onAnswer })}
				/>
			))}
		</div>
	);
}

/** 一个问卷组。 */
function AskGroupBlock(props: {
	readonly sectionId: string;
	readonly group: AskGroupView;
	readonly interactive: boolean;
	readonly onAnswer?: (sectionId: string, value: string) => void;
}): ReactNode {
	const group = props.group;

	/*
	 * 空壳组（`items:[{options:[]}]`，core 的 defaultPayload 就是这样）：
	 * 画一行「还没有选项」，而不是画一个没有内容的空块。
	 */
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
		>
			{group.header === '' ? null : <div className="ask-group__header">{group.header}</div>}
			{group.question === '' ? null : (
				<div className="ask-group__question">{group.question}</div>
			)}

			<div className="ask-group__options">
				{group.options.map((option) => (
					<AskOption
						key={option.label}
						sectionId={props.sectionId}
						option={option}
						{...(props.interactive ? { onAnswer: props.onAnswer } : {})}
					/>
				))}
			</div>

			{/* 三态徽标 —— 「未选择」/「都不要」/「单选·已选 N」，不只是装饰。 */}
			<div className="ask-group__state" data-ask-state-label={group.pickedState}>
				<span className="ask-group__state-text">{askStateLabelOf(group)}</span>
				{group.custom.length === 0 ? null : (
					<span className="ask-group__custom-values">
						自填：{group.custom.filter((one) => one !== '').join('、')}
					</span>
				)}
			</div>

			{props.interactive ? (
				<div className="ask-group__actions">
					<button
						type="button"
						className="ghost-btn ask-group__none"
						data-ask-none
						title="看了但都不要（与「未选择」不同）"
						onClick={() =>
							props.onAnswer?.(props.sectionId, NO_ANSWER)
						}
					>
						都不要
					</button>
					<CustomInput
						sectionId={props.sectionId}
						group={group}
						{...(props.onAnswer === undefined ? {} : { onAnswer: props.onAnswer })}
					/>
				</div>
			) : (
				<CustomValuesReadonly values={group.custom} />
			)}
		</div>
	);
}

/** 一个选项（可点 / 只读）。 */
function AskOption(props: {
	readonly sectionId: string;
	readonly option: AskOptionView;
	readonly onAnswer?: (sectionId: string, value: string) => void;
}): ReactNode {
	const option = props.option;
	const className = ['ask-option'];
	if (option.picked) className.push('is-picked');

	const inner = (
		<>
			<span className="ask-option__mark" aria-hidden="true">
				{option.picked ? '✓' : ''}
			</span>
			<span className="ask-option__body">
				<span className="ask-option__label">{option.label}</span>
				{option.description === '' ? null : (
					<span className="ask-option__desc">{option.description}</span>
				)}
			</span>
		</>
	);

	/* 只读：`<div>`（不是 disabled 的 button —— 那会让它看起来「本来能点」）。 */
	if (props.onAnswer === undefined) {
		return (
			<div className={className.join(' ')} data-ask-option={option.label} data-picked={String(option.picked)}>
				{inner}
			</div>
		);
	}

	return (
		<button
			type="button"
			className={className.join(' ')}
			data-ask-option={option.label}
			data-picked={String(option.picked)}
			aria-pressed={option.picked}
			onClick={() => props.onAnswer?.(props.sectionId, option.label)}
		>
			{inner}
		</button>
	);
}

/**
 * 自填框。
 *
 * 只在**提交**（回车 / 失焦且有内容）时上报一次 —— 不在每次按键都发，
 * 那会让父层每敲一个字写一次库。
 *
 * ⚠ 输入框的本地状态只活到提交；提交后清空（父层会把新 payload 灌回来，
 *   自填值在 `group.custom` 里显示）。
 */
function CustomInput(props: {
	readonly sectionId: string;
	readonly group: AskGroupView;
	readonly onAnswer?: (sectionId: string, value: string) => void;
}): ReactNode {
	const [draft, setDraft] = useState('');

	const commit = (): void => {
		const value = draft.trim();
		if (value === '') return;
		props.onAnswer?.(props.sectionId, value);
		setDraft('');
	};

	return (
		<input
			type="text"
			className="ask-group__custom"
			data-ask-custom
			value={draft}
			placeholder={props.group.placeholder === '' ? '自填答案…' : props.group.placeholder}
			onChange={(event) => setDraft(event.target.value)}
			onKeyDown={(event) => {
				if (event.key !== 'Enter') return;
				event.preventDefault();
				/* 别让回车冒泡到父层的键盘处理（比如关详情）。 */
				event.stopPropagation();
				commit();
			}}
			onBlur={commit}
		/>
	);
}

/** 只读时的自填值。 */
function CustomValuesReadonly(props: { readonly values: readonly string[] }): ReactNode {
	const values = props.values.filter((one) => one !== '');
	if (values.length === 0) return null;
	return (
		<div className="ask-group__custom-values" data-ask-custom-readonly>
			自填：{values.join('、')}
		</div>
	);
}
