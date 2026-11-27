/**
 * 卡片正文里的**一个章节**：章节名 + 内容（text / markdown / ask / 未知降级）。
 *
 * ## 这个组件只做「渲染决定」
 *
 * 全部判决在 `pure/section.ts`：
 *
 * ```ts
 * const view = sectionViewOf(section.payload);   // 三种形态 + 降级，纯函数
 * switch (view.kind) { … }                       // 这里只有「画什么」
 * ```
 *
 * ⇒ 组件里没有 `if ($type === …)`、没有「这个 payload 算什么」——
 *   那些都在 pure 里，改一处不用改两遍。
 *
 * ## 三条用户指令
 *
 * ① **章节名用模板给的**（`section.label`），不编「正文」这种容器词。
 *    用户 `2026-11-15`：「那个『正文』那两个字。存在那里的意义是什么。他起到了什么作用？」
 *    ⇒ 没有作用。label 为空就**不画标题行**（不是画一个空标题）。
 * ② **ask 的选项能点**，点回调 `onAnswer(sectionId, optionValue)`。
 * ③ **组件不判「能不能编辑」** —— 只上报 `onEdit(sectionId)`，由父层决定
 *    （`readonly` 是父层灌进来的，组件不读卡片状态）。
 *
 * ## markdown 走 `renderers/Markdown.tsx`
 *
 * `markdown` 章节只把源码交给 `<Markdown source={…} />`；解析（marked + GFM）
 * 与白名单净化在 `pure/markdown-tokens.ts`（用户 `2026-11-10` 要求
 * 「找正规的 md 渲染器」）。**本文件永远不用 `dangerouslySetInnerHTML`**
 * —— 文字一律走子节点，结构上没有注入这条路。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
	canEditOf,
	sectionViewOf,
	type AskGroupView,
	type MarkdownSectionView,
	type SectionKind,
	type SectionView,
	type TextSectionView,
} from '../pure/section.ts';
import type { CardSection } from '../types.ts';
import { AskSection } from './AskSection.tsx';
import type { AskAction } from '../pure/section.ts';
import { Markdown } from './Markdown.tsx';
import { rendererOf, type RendererProps } from '../render-registry.ts';

/** 组件属性（任务描述给的那一份，一个不多一个不少）。 */
export interface SectionProps {
	/** 章节 id（`Card.sections` 的 key）—— 回调原样带回它。 */
	readonly sectionId: string;
	/** 卡上的章节（`{ label, payload }`）。 */
	readonly section: CardSection;
	/**
	 * 生命周期相位（用户 2026-11-21 采纳）：
	 * `create` = 草稿 / `active` = 进行·搁置 / `ended` = 完成。
	 *
	 * 省略时按 `readonly` 推导（`readonly === true` ⇒ `ended`，否则 `active`）——
	 * 保老调用方不传也照旧。
	 */
	readonly phase?: SectionPhase;
	/** `true` = 只读显示，`false` = 可点编辑（老口径；新代码优先用 `phase`）。 */
	readonly readonly?: boolean;
	/** 点这一章要编辑时上报（组件不判该不该编辑）。 */
	readonly onEdit?: (sectionId: string) => void;
	/**
	 * 内联编辑回写（`create` / `active` 相位用）。
	 *
	 * `patch` 是**要合并进 payload 的字段**（`text` 的 `value` / `placeholder`、
	 * `markdown` 的 `source`），组件不重算整份 payload。
	 */
	readonly onChange?: (sectionId: string, patch: Readonly<Record<string, unknown>>) => void;
	/** ask 选项被点（`value` 是选项的 label；`NO_ANSWER` = 都不要）。 */
	/**
	 * ask 作答动作。带 `groupIndex` —— 答案写在 `items[groupIndex]`。
	 */
	readonly onAsk?: (sectionId: string, groupIndex: number, action: AskAction) => void;
}

/** 三个生命周期相位。 */
export type SectionPhase = 'create' | 'active' | 'ended';

/**
 * 内容类型的中文名 —— 已建卡/草稿里「控件不可改」，但要让用户看见现在是什么控件。
 *
 * `satisfies` 保证 key 覆盖 `SectionKind`（少一个会红，多一个也会红）。
 */
const KIND_LABEL = {
	text: '文本',
	markdown: '富文本',
	ask: '选项',
	unknown: '未知',
} satisfies Record<SectionKind, string>;

/**
 * 一个章节。
 *
 * @param props 见 `SectionProps`
 */
export function Section(props: SectionProps): ReactNode {
	const section = props.section;
	/* 相位：新口径优先；老调用方只传 readonly 时按它推导。 */
	const phase: SectionPhase = props.phase ?? (props.readonly === true ? 'ended' : 'active');
	/*
	 * 只读判定：**任一来源说冻结就冻结**。
	 *
	 * `phase === 'ended'` 是生命周期判决（#10 冻结期）；`props.readonly` 是
	 * 父层按更细的规则灌进来的结论（lead `2026-11-28`：详情页 markdown 永远只读
	 * —— markdown 在 #10 的「可编辑期」本来可改，但详情不是建卡页）。
	 * 两者取「或」：readonly 只能比 phase 更严，不能把冻结态放开。
	 */
	const readonlyFlag = phase === 'ended' || props.readonly === true;
	const view = sectionViewOf(section.payload);
	const label = typeof section.label === 'string' ? section.label : '';
	/*
	 * 能不能点进编辑：**结构**（只读 / 有没有回调）翻出来就完了，
	 * 判决在父层（`readonly` 就是它的结论）。ask 那一块自己管点击，
	 * 不把整章点成编辑入口 —— 否则点选项会同时触发编辑。
	 */
	const clickToEdit = canEditOf(readonlyFlag, props.onEdit !== undefined) && view.kind !== 'ask';

	const openEditor = (): void => {
		if (!clickToEdit) return;
		props.onEdit?.(props.sectionId);
	};

	const className = ['section-block'];
	if (readonlyFlag) className.push('is-readonly');
	if (clickToEdit) className.push('is-editable');

	return (
		<div
			className={className.join(' ')}
			data-section-id={props.sectionId}
			data-section-kind={view.kind}
			data-section-readonly={String(readonlyFlag)}
			onClick={clickToEdit ? openEditor : undefined}
		>
			{/*
			 * ① 章节名用模板给的 label。**空 label 不画那一行** ——
			 *   画一个空标题只会让人以为「这一章没名字」，而事实是「本来就没有名字」。
			 */}
			{label === '' ? null : (
				<div className="section-block__label">
					<span className="section-block__label-text">{label}</span>
					{/* 内容类型：已建卡/草稿里只显示、不可改（用户 2026-11-22）。 */}
					<span className="section-block__kind" data-section-kind-label={view.kind}>
						{KIND_LABEL[view.kind] ?? view.kind}
					</span>
					{clickToEdit ? <span className="section-block__edit-hint">编辑</span> : null}
				</div>
			)}

			<div className="section-block__content">
				<SectionContent
					view={view}
					section={section}
					sectionId={props.sectionId}
					phase={phase}
					readonly={readonlyFlag}
					rawPayload={section.payload}
					{...(props.onChange === undefined ? {} : { onChange: props.onChange })}
					{...(props.onAsk === undefined ? {} : { onAsk: props.onAsk })}
				/>
			</div>
		</div>
	);
}

/** `SectionContent` 的属性 —— 内容组件共享同一份。 */
interface SectionContentProps {
	readonly view: SectionView;
	readonly section: CardSection;
	readonly sectionId: string;
	readonly phase: SectionPhase;
	readonly readonly: boolean;
	readonly rawPayload: unknown;
	readonly onChange?: (sectionId: string, patch: Readonly<Record<string, unknown>>) => void;
	readonly onAsk?: (sectionId: string, groupIndex: number, action: AskAction) => void;
}

/**
 * 内容分发 —— **查运行时注册表**，不是查本地字典。
 *
 * 用户 2026-11-22：
 * > 「这种外来的东西按照特征或者头在运行时注册和分发。应该有标准做法吧。
 * >   无论是 DI 还是责任链还是更简单的字典。这个问题很难吗？」
 *
 * ⇒ 唯一分发点：`rendererOf(kind)`。内置三件由 `initRenderers()` 注册，
 *   第三方可以 `registerRenderer('foo', FooContent)` 追加。
 *   没注册的 kind 走 `UnknownBlock`（展开原始 JSON，不白屏）。
 */
// TODO(审查): 这里两处断言（:194 的 `as unknown as {title,json}`、:202 的 `props as unknown as RendererProps`）都是 render-registry.ts:91 `view?: unknown` 的连带成本，不是语言固有摩擦；把 view/onAsk 收紧成具体类型后应能删掉，需先定注册表公共类型。
function SectionContent(props: SectionContentProps): ReactNode {
	const Content = rendererOf(props.view.kind);
	if (Content === undefined) {
		const view = props.view as unknown as { readonly title: string; readonly json: string };
		return <UnknownBlock title={view.title} json={view.json} />;
	}
	/*
	 * `onAsk` 在 `RendererProps` 上是 `unknown`（第三方可注册任意 action），
	 * 这里传的是 `AskAction`（比 `unknown` 窄）—— 逆变位置需要一次断言。
	 * 断言在**类型层**，运行时是同一个对象，不改语义。
	 */
	return <Content {...(props as unknown as RendererProps)} />;
}

function UnknownBlock(props: { readonly title: string; readonly json: string }): ReactNode {
	const [open, setOpen] = useState(false);
	return (
		<div className="section-block__unknown">
			<button
				type="button"
				className="ghost-btn"
				data-json-toggle
				aria-expanded={open}
				onClick={(event) => {
					/* 别让「展开 JSON」顺手把整章点成编辑。 */
					event.stopPropagation();
					setOpen((one) => !one);
				}}
			>
				{props.title} · {open ? '收起原始 JSON ▴' : '展开原始 JSON ▾'}
			</button>
			{open ? <pre className="payload-box">{props.json}</pre> : null}
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   text / markdown 的三相位渲染（用户 2026-11-21 采纳）
   ══════════════════════════════════════════════════════════ */

/**
 * `text` 章节的三相位。
 *
 * 采纳的候选：
 * - **create 候选 3**：可编辑正文 + 灰字做成**可折叠区**（默认只显示一行灰字，点开才编辑）
 * - **active 候选 1**：单框可编辑正文，灰字 = HTML `placeholder`
 * - **ended 候选 2**：只读 `textarea`（保留框形状，value 和 placeholder 都还在框里）
 *
 * ## 提交口径（lead `2026-11-28` 裁定）
 *
 * **输入框失焦才提交**，不在每次按键时回写 —— 一次编辑一次 PATCH。
 * 本地草稿只活在这个组件里；`view.value` 因服务端回声变化时同步回来，
 * 但**正在输入的那一格不被覆盖**（否则保存回来的旧值会打断打字）。
 *
 * @param props view / phase / readonly / onPatch
 */
export function TextBlock(props: {
	readonly view: TextSectionView;
	readonly phase: SectionPhase;
	readonly readonly: boolean;
	readonly onPatch?: (fields: Readonly<Record<string, unknown>>) => void;
}): ReactNode {
	const view = props.view;
	/* 父层没接线（`onPatch` 缺省）时不假装能改 —— 和冻结态同一个只读形状。 */
	const editable = !props.readonly && props.onPatch !== undefined;

	const [draft, setDraft] = useState(view.value);
	const [placeholderDraft, setPlaceholderDraft] = useState(view.placeholder);
	const valueFocused = useRef(false);
	const placeholderFocused = useRef(false);

	useEffect(() => {
		if (!valueFocused.current) setDraft(view.value);
	}, [view.value]);
	useEffect(() => {
		if (!placeholderFocused.current) setPlaceholderDraft(view.placeholder);
	}, [view.placeholder]);

	const commitValue = (): void => {
		valueFocused.current = false;
		if (draft !== view.value) props.onPatch?.({ value: draft });
	};
	const commitPlaceholder = (): void => {
		placeholderFocused.current = false;
		if (placeholderDraft !== view.placeholder) {
			props.onPatch?.({ placeholder: placeholderDraft });
		}
	};

	/* ended（或父层没接线）：只读 textarea（候选 2 —— 保留框形状）。 */
	if (!editable) {
		return (
			<div className="section-block__field">
				<textarea
					className="section-block__textarea is-readonly"
					value={view.value}
					placeholder={view.placeholder}
					rows={Math.max(2, view.value.split('\n').length)}
					readOnly
					data-section-phase={props.phase}
				/>
			</div>
		);
	}

	/* active：单框 + 灰字 = placeholder（候选 1）。 */
	if (props.phase === 'active') {
		return (
			<div className="section-block__field">
				<textarea
					className="section-block__textarea"
					value={draft}
					placeholder={view.placeholder}
					rows={Math.max(2, draft.split('\n').length)}
					onFocus={() => {
						valueFocused.current = true;
					}}
					onChange={(event) => {
						setDraft(event.target.value);
					}}
					onBlur={commitValue}
					data-section-phase="active"
				/>
			</div>
		);
	}

	/* create：正文 textarea + 灰字折叠区（候选 3）。 */
	return (
		<div className="section-block__field">
			<textarea
				className="section-block__textarea"
				value={draft}
				rows={Math.max(2, draft.split('\n').length)}
				onFocus={() => {
					valueFocused.current = true;
				}}
				onChange={(event) => {
					setDraft(event.target.value);
				}}
				onBlur={commitValue}
				data-section-phase="create"
			/>
			<details className="section-block__decl">
				<summary>
					声明（灰字）：
					{placeholderDraft === '' ? '（未设置）' : placeholderDraft}
				</summary>
				<input
					className="section-block__decl-input"
					value={placeholderDraft}
					placeholder="清空正文后，框里显示这句灰字"
					onFocus={() => {
						placeholderFocused.current = true;
					}}
					onChange={(event) => {
						setPlaceholderDraft(event.target.value);
					}}
					onBlur={commitPlaceholder}
				/>
			</details>
		</div>
	);
}

/**
 * `markdown` 章节的三相位。
 *
 * 采纳的候选：**create 候选 1**（源码框 + 「查看预览」按钮）；active / ended 只读渲染。
 *
 * @param props view / phase / readonly / onPatch
 */
export function MarkdownBlock(props: {
	readonly view: MarkdownSectionView;
	readonly phase: SectionPhase;
	readonly readonly: boolean;
	readonly onPatch?: (fields: Readonly<Record<string, unknown>>) => void;
}): ReactNode {
	const [preview, setPreview] = useState(false);
	const view = props.view;
	/*
	 * ⚠ 只有 **create** 相位可编辑（契约 `02-action.md:263-265`：
	 *   create = 源码框 + 查看预览；active / ended 都是**只读渲染**）。
	 *   不能只用 `!readonly && onPatch` 判 —— 那样 active 也会变成源码框。
	 */
	const editable = props.phase === 'create' && !props.readonly && props.onPatch !== undefined;

	if (!editable) {
		if (view.empty) {
			return <div className="section-block__placeholder">{view.placeholder}</div>;
		}
		return <Markdown source={view.source} />;
	}

	return (
		<div className="section-block__field">
			{preview ? (
				view.empty ? (
					<div className="section-block__placeholder">{view.placeholder}</div>
				) : (
					<Markdown source={view.source} />
				)
			) : (
				<textarea
					className="section-block__textarea is-mono"
					value={view.source}
					placeholder={view.placeholder}
					rows={Math.max(4, view.source.split('\n').length)}
					onChange={(event) => {
						/*
						 * ⚠ 字段名必须是 `value`（markdownSchema 是 `{ value, placeholder }`）。
						 * 之前写的是 `source` —— 那是**渲染视图**的字段名，不是 payload 字段，
						 * 写进去等于丢数据（网页级 DOM 测试抓到的）。
						 */
						props.onPatch?.({ value: event.target.value });
					}}
					data-section-phase={props.phase}
				/>
			)}
			<div className="section-block__actions">
				<button
					type="button"
					className="ghost-btn"
					onClick={() => {
						setPreview(!preview);
					}}
				>
					{preview ? '← 回源码' : '查看预览'}
				</button>
			</div>
		</div>
	);
}
