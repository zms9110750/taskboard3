/**
 * 卡片正文里的**一个章节**：章节名 + 内容（text / markdown / ask / 未知降级）。
 *
 * ## 这个组件只做「渲染决定」
 *
 * 全部判决在 `dev/pure/section.ts`（67 条单测）：
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
 * ## markdown 是临时实现
 *
 * `markdownLinesOf()` 只支持换行 / `**粗体**` / `` `代码` ``。正式版要换 marked
 * （用户 `2026-11-10` 要求「找正规的 md 渲染器」）。换库点只有那个纯函数；
 * **本文件永远不用 `dangerouslySetInnerHTML`** —— 文字一律走子节点，结构上
 * 没有注入这条路。
 */

import { useState, type ReactNode } from 'react';

import {
	canEditOf,
	emptyHintOf,
	sectionViewOf,
	type MarkdownLine,
	type MarkdownToken,
	type SectionView,
} from '../pure/section.ts';
import type { CardSection } from '../types.ts';
import { AskSection } from './AskSection.tsx';

/** 组件属性（任务描述给的那一份，一个不多一个不少）。 */
export interface SectionProps {
	/** 章节 id（`Card.sections` 的 key）—— 回调原样带回它。 */
	readonly sectionId: string;
	/** 卡上的章节（`{ label, payload }`）。 */
	readonly section: CardSection;
	/** `true` = 只读显示，`false` = 可点编辑。 */
	readonly readonly?: boolean;
	/** 点这一章要编辑时上报（组件不判该不该编辑）。 */
	readonly onEdit?: (sectionId: string) => void;
	/** ask 选项被点（`value` 是选项的 label；`NO_ANSWER` = 都不要）。 */
	readonly onAnswer?: (sectionId: string, value: string) => void;
}

/**
 * 一个章节。
 *
 * @param props 见 `SectionProps`
 */
export function Section(props: SectionProps): ReactNode {
	const section = props.section;
	const readonlyFlag = props.readonly === true;
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
					{clickToEdit ? <span className="section-block__edit-hint">编辑</span> : null}
				</div>
			)}

			<div className="section-block__content">
				<SectionContent
					view={view}
					sectionId={props.sectionId}
					readonly={readonlyFlag}
					{...(props.onAnswer === undefined ? {} : { onAnswer: props.onAnswer })}
				/>
			</div>
		</div>
	);
}

/** 按 pure 判出来的形态选渲染器。 */
function SectionContent(props: {
	readonly view: SectionView;
	readonly sectionId: string;
	readonly readonly: boolean;
	readonly onAnswer?: (sectionId: string, value: string) => void;
}): ReactNode {
	const view = props.view;

	switch (view.kind) {
		case 'text': {
			if (view.empty) {
				return (
					<div className="section-block__placeholder">
						{emptyHintOf(view, props.readonly)}
					</div>
				);
			}
			/* `white-space: pre-wrap` 由 CSS 给（text 要保留换行与缩进）。 */
			return <div className="section-block__text">{view.value}</div>;
		}

		case 'markdown': {
			if (view.empty) {
				return (
					<div className="section-block__placeholder">
						{emptyHintOf(view, props.readonly)}
					</div>
				);
			}
			return (
				<div className="md">
					{view.lines.map((line, index) => (
						<MarkdownLineView key={index} line={line} />
					))}
				</div>
			);
		}

		case 'ask':
			return (
				<AskSection
					sectionId={props.sectionId}
					view={view}
					readonly={props.readonly}
					{...(props.onAnswer === undefined ? {} : { onAnswer: props.onAnswer })}
				/>
			);

		case 'unknown':
			return <UnknownBlock title={view.title} json={view.json} />;
	}
}

/** markdown 一行。空行画 `<br>`（与段落间距一致）。 */
function MarkdownLineView(props: { readonly line: MarkdownLine }): ReactNode {
	if (props.line.blank) return <br />;
	return (
		<div className="md-line">
			{props.line.tokens.map((token, index) => (
				<MarkdownTokenView key={index} token={token} />
			))}
		</div>
	);
}

/**
 * markdown 行内 token —— **建元素、文字走子节点**，没有 innerHTML。
 *
 * @param token `pure/section.ts` 的 `markdownLinesOf()` 切出来的片段
 */
function MarkdownTokenView(props: { readonly token: MarkdownToken }): ReactNode {
	const token = props.token;
	if (token.kind === 'strong') return <strong>{token.text}</strong>;
	if (token.kind === 'code') return <code className="md-code-inline">{token.text}</code>;
	return <>{token.text}</>;
}

/**
 * 未知 `$type` / 脏 payload —— **展开原始 JSON**，不白屏、不猜成文本。
 *
 * 旧版 `section-render.js` 对 `unregistered` / `raw` 就是这个形态
 * （按钮 + 点开看 JSON），这里照做，但用 React 状态而不是手动改 `style.display`。
 */
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
