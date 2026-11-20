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

import { useRef, useState, type ReactNode } from 'react';

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
				<AskGroupCard
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
export function AskGroupCard(props: {
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
			/*
			 * 「激活」= 不是「未选择」⇒ 左边加竖边框（用户 2026-11-21，
			 * 对着 `detail-ask-states.png` 说的）。
			 */
			/* 第 8 条：只有**可交互**且已作答时才给整页打边框（冻结态不打）。 */
			data-ask-active={String(props.interactive && group.pickedState !== 'none')}
		>
			{/*
			 * 问题行（用户 2026-11-21 第 3 条：**不要「单选」「多选」胶囊**）。
			 * 用户第 4 条：状态位置放**纯按钮「未选择」**，不是动态的「已选 N」，
			 * 也**不要写「都不要」** —— 真正的「都不要」是「否决任务卡」或「自填不要」，
			 * 不是这个按钮的语义。
			 */}
			<div className="ask-group__qrow">
				{group.question === '' ? null : (
					<div className="ask-group__question">{group.question}</div>
				)}
				{props.interactive ? (
					<button
						type="button"
						className="ghost-btn ask-group__state-btn"
						data-ask-state-btn="reset"
						title="把这一题重置成「未选择」"
						onClick={() => props.onAnswer?.(props.sectionId, NO_ANSWER)}
					>
						未选择
					</button>
				) : null}
			</div>

			{group.header === '' ? null : <div className="ask-group__header">{group.header}</div>}

			<div className="ask-group__options">
				{group.options.map((option) => (
					<AskOptionRow
						key={option.label}
						sectionId={props.sectionId}
						label={option.label}
						description={option.description}
						picked={option.picked}
						multiSelect={group.multiSelect}
						{...(props.interactive ? { onAnswer: props.onAnswer } : {})}
					/>
				))}

				{/*
				 * 自填框 = **一个带圆圈的选项**，圈里是文本框（用户 2026-11-21）。
				 * 只在可交互时出现；只读时自填值在下面单独一行。
				 */}
				{props.interactive ? (
					<CustomOption
						sectionId={props.sectionId}
						group={group}
						{...(props.onAnswer === undefined ? {} : { onAnswer: props.onAnswer })}
					/>
				) : null}
			</div>

			{props.interactive ? null : <CustomValuesReadonly values={group.custom} />}
		</div>
	);
}

/** 一个选项（可点 / 只读）。 */
/**
 * 一个选项行 —— **普通选项和自填共用这一个外壳**。
 *
 * 用户 2026-11-21：
 * > 「把选项组件抽出来。不要开那么多胶水代码。他们的逻辑应该是很一致的。」
 *
 * ⇒ 圆圈 / 方框 / 勾、`is-picked` 类、整行热区全在这里决定；
 *   普通选项的 body 是「标题 + 说明」，自填的 body 是传进来的 `<input>`
 *   （`children`）。两者的**选中逻辑完全一致**（点整行 = 选中）。
 *
 * 标记的形状是**相位 + 多选**共同决定的：
 *
 * | 相位 | 单选 | 多选 |
 * |---|---|---|
 * | 可选择（active）| ○ / ● | □ / ■ |
 * | 冻结（ended）| ✓（选中时）| ✓（选中时）|
 *
 * @param props label / description / picked / multiSelect / children / onAnswer / onSelect
 */
export function AskOptionRow(props: {
	readonly sectionId: string;
	/** 普通选项的标题；自填传空串（body 用 `children` 替代）。 */
	readonly label: string;
	/** 普通选项的说明；空串不画。 */
	readonly description?: string;
	/** 是否已选中 —— 决定 `is-picked` 类和标记形态。 */
	readonly picked: boolean;
	/** 多选组：标记画**正方形**（单选画圆圈）。 */
	readonly multiSelect: boolean;
	/** 自填：body 里放输入框（传了就替换 label / description）。 */
	readonly children?: ReactNode;
	/** 自定义点击行为（自填用：点整行 = focus 输入框）。省略 = 点行上报 `onAnswer(label)`。 */
	readonly onSelect?: () => void;
	readonly onAnswer?: (sectionId: string, value: string) => void;
}): ReactNode {
	const interactive = props.onAnswer !== undefined || props.onSelect !== undefined;
	const className = ['ask-option'];
	if (props.picked) className.push('is-picked');
	if (props.children !== undefined) className.push('ask-option--custom');

	const mark = interactive ? (
		<span
			className="ask-option__mark ask-option__mark--box"
			data-multi={String(props.multiSelect)}
			aria-hidden="true"
		/>
	) : (
		<span className="ask-option__mark ask-option__mark--check" aria-hidden="true">
			{props.picked ? '✓' : ''}
		</span>
	);

	const inner =
		props.children === undefined ? (
			<>
				{mark}
				<span className="ask-option__body">
					<span className="ask-option__label">{props.label}</span>
					{props.description === undefined || props.description === '' ? null : (
						<span className="ask-option__desc">{props.description}</span>
					)}
				</span>
			</>
		) : (
			<>
				{mark}
				{props.children}
			</>
		);

	const select = (): void => {
		if (props.onSelect !== undefined) {
			props.onSelect();
			return;
		}
		props.onAnswer?.(props.sectionId, props.label);
	};

	/* 只读：`<div>`（不是 disabled 的 button —— 那会让它看起来「本来能点」）。 */
	if (!interactive) {
		return (
			<div className={className.join(' ')} data-ask-option={props.label} data-picked={String(props.picked)}>
				{inner}
			</div>
		);
	}

	/*
	 * 自填行：body 里有 `<input>` —— `button` 里不能嵌交互控件，所以用 `div`
	 * 加 `role=button`（点击行为由 `onSelect` 接管）。普通选项仍是真 `button`。
	 */
	if (props.children !== undefined) {
		return (
			<div
				className={className.join(' ')}
				data-ask-option={props.label}
				data-picked={String(props.picked)}
				role="button"
				tabIndex={0}
				onClick={select}
				onKeyDown={(event) => {
					if (event.key !== 'Enter' && event.key !== ' ') return;
					event.preventDefault();
					select();
				}}
			>
				{inner}
			</div>
		);
	}

	return (
		<button
			type="button"
			className={className.join(' ')}
			data-ask-option={props.label}
			data-picked={String(props.picked)}
			aria-pressed={props.picked}
			onClick={select}
		>
			{inner}
		</button>
	);
}

/**
 * 自填框 —— **画成一个带圆圈的选项**，圈里是文本框（用户 2026-11-21）。
 *
 * 只在**提交**（回车 / 失焦且有内容）时上报一次 —— 不在每次按键都发，
 * 那会让父层每敲一个字写一次库。
 *
 * ⚠ 输入框的本地状态只活到提交；提交后清空（父层会把新 payload 灌回来，
 *   自填值在 `group.custom` 里显示）。
 */
function CustomOption(props: {
	readonly sectionId: string;
	readonly group: AskGroupView;
	readonly onAnswer?: (sectionId: string, value: string) => void;
}): ReactNode {
	const [draft, setDraft] = useState('');
	const [active, setActive] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const hasValue = props.group.custom.some((one) => one !== '');
	/*
	 * 单选组里别的选项有选中（picked 非空）⇒ 自填不亮 —— 否则点普通选项后
	 * 自填的本地 ctive 还挂着，两个同时亮。多选组可以共存。
	 */
	const customPicked =
		hasValue || (props.group.multiSelect ? active : active && props.group.pickedState !== 'picked');

	const commit = (): void => {
		const value = draft.trim();
		if (value === '') return;
		props.onAnswer?.(props.sectionId, value);
		setDraft('');
		setActive(false);
	};

	/*
	 * 复用 `AskOptionRow` —— 用户 2026-11-21：
	 * > 「把选项组件抽出来。不要开那么多胶水代码。他们的逻辑应该是很一致的。」
	 * > 「自填框不会跟其他的选框互斥」
	 *
	 * ⇒ 圆圈 / 方框 / `is-picked` / 整行热区都由那个组件管；
	 *   点整行 = 选中自己 + focus。**单选组里还要先清空其他选中**
	 *   （否则自填和普通选项会同时亮 —— 这就是「逻辑没统一」）。
	 */
	return (
		<AskOptionRow
			sectionId={props.sectionId}
			label=""
			picked={customPicked}
			multiSelect={props.group.multiSelect}
			onSelect={() => {
				/*
				 * 单选语义：选中自填 ⇒ 其他选项必须取消。
				 * 走 `onAnswer(sectionId, NO_ANSWER)` 让父层把 `picked` 清空；
				 * 多选语义：可以和其他选项共存 ⇒ 不动。
				 */
				if (!props.group.multiSelect) {
					props.onAnswer?.(props.sectionId, NO_ANSWER);
				}
				setActive(true);
				inputRef.current?.focus();
			}}
		>
			<input
				ref={inputRef}
				type="text"
				className="ask-group__custom"
				data-ask-custom
				value={draft}
				placeholder={
					props.group.placeholder === '' ? '其它（自己填）…' : props.group.placeholder
				}
				onClick={() => {
					setActive(true);
				}}
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
		</AskOptionRow>
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
