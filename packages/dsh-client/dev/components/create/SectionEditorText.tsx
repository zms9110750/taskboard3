/**
 * `text` 章节的编辑区 —— 三个布局、两个方案都用这一个。
 *
 * ## 为什么 text 不需要两套
 *
 * 用户要对比的是 **ask 编辑器**。text 就是一行输入框，没有设计空间。
 * 给它做两个变体只会稀释对比。
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import type { FakeSection } from './data.ts';

/** 组件属性。 */
export interface SectionEditorTextProps {
	readonly section: FakeSection;
	/** 受控值。 */
	readonly value: string;
	readonly onChange: (value: string) => void;
}

/**
 * 纯文本编辑区。
 *
 * @param props 见 `SectionEditorTextProps`
 */
export function SectionEditorText(props: SectionEditorTextProps): ReactNode {
	return (
		<textarea
			className="ed ed--text"
			value={props.value}
			placeholder={props.section.hint}
			rows={2}
			onChange={(event) => {
				props.onChange(event.target.value);
			}}
		/>
	);
}

/** markdown 区块的两种模式。 */
type MdMode = 'write' | 'preview';

/** markdown 章节的编辑区：源码 / 预览切换。 */
export interface SectionEditorMarkdownProps {
	readonly section: FakeSection;
	readonly value: string;
	readonly onChange: (value: string) => void;
}

/**
 * markdown 编辑区。
 *
 * ⚠ 预览这一版**不引渲染器** —— 展厅只要表现「有预览这回事」。
 *   真渲染要用 `src/renderers/Markdown.tsx`，那是接真 API 之后的事。
 *
 * @param props 见 `SectionEditorMarkdownProps`
 */
export function SectionEditorMarkdown(props: SectionEditorMarkdownProps): ReactNode {
	const [mode, setMode] = useState<MdMode>('write');

	return (
		<div className="ed ed--md">
			<div className="ed__tabs">
				<button
					type="button"
					className={`ed__tab${mode === 'write' ? ' is-on' : ''}`}
					onClick={() => {
						setMode('write');
					}}
				>
					源码
				</button>
				<button
					type="button"
					className={`ed__tab${mode === 'preview' ? ' is-on' : ''}`}
					onClick={() => {
						setMode('preview');
					}}
				>
					预览
				</button>
			</div>
			{mode === 'write' ? (
				<textarea
					className="ed__source"
					value={props.value}
					placeholder={props.section.hint}
					rows={6}
					onChange={(event) => {
						props.onChange(event.target.value);
					}}
				/>
			) : (
				<div className="ed__preview mono">{props.value}</div>
			)}
		</div>
	);
}
