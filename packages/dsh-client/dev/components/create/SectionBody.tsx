/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * 一个章节的**编辑区** —— 三个布局共用。
 *
 * 布局只管「画在哪」，这里管「画什么」。分开的好处：改编辑器不会碰布局。
 */

import type { ReactNode } from 'react';

import { SectionShell } from './TemplateField.tsx';
import { SectionEditorText, SectionEditorMarkdown } from './SectionEditorText.tsx';
import { SectionEditorAskV1 } from './SectionEditorAskV1.tsx';
import { SectionEditorAskV2 } from './SectionEditorAskV2.tsx';
import type { CreateForm, CreateFormActions } from './useCreateForm.ts';
import type { FakeSection } from './data.ts';

/** ask 编辑器用哪一版。 */
export type AskVariant = 'v1' | 'v2';

/** 组件属性。 */
export interface SectionBodyProps {
	readonly section: FakeSection;
	/** 章节序号（1 起）。 */
	readonly index: number;
	readonly form: CreateForm;
	readonly actions: CreateFormActions;
	readonly askVariant: AskVariant;
}

/**
 * 一个章节（外壳 + 对应编辑区）。
 *
 * @param props 见 `SectionBodyProps`
 */
export function SectionBody(props: SectionBodyProps): ReactNode {
	const section = props.section;

	let editor: ReactNode;
	if (section.kind === 'text') {
		editor = (
			<SectionEditorText
				section={section}
				value={props.form.values[section.id] ?? ''}
				onChange={(value) => {
					props.actions.setValue(section.id, value);
				}}
			/>
		);
	} else if (section.kind === 'markdown') {
		editor = (
			<SectionEditorMarkdown
				section={section}
				value={props.form.values[section.id] ?? ''}
				onChange={(value) => {
					props.actions.setValue(section.id, value);
				}}
			/>
		);
	} else if (props.askVariant === 'v1') {
		editor = (
			<SectionEditorAskV1
				section={section}
				question={props.form.question}
				onQuestionChange={props.actions.setQuestion}
				options={props.form.askOptions.map((one) => one.label)}
				onOptionsChange={(labels) => {
					props.actions.setAskOptions(
						labels.map((label, i) => ({
							label,
							description: props.form.askOptions[i]?.description ?? '',
						})),
					);
				}}
				picked={props.form.askPicked}
				onPickedChange={props.actions.setAskPicked}
			/>
		);
	} else {
		editor = (
			<SectionEditorAskV2
				question={props.form.question}
				onQuestionChange={props.actions.setQuestion}
				placeholder={props.form.askPlaceholder}
				onPlaceholderChange={props.actions.setAskPlaceholder}
				multi={props.form.askMulti}
				onMultiChange={props.actions.setAskMulti}
				options={props.form.askOptions}
				onOptionsChange={props.actions.setAskOptions}
				allowCustom={props.form.askAllowCustom}
				onAllowCustomChange={props.actions.setAskAllowCustom}
				picked={props.form.askPicked}
				onPickedChange={props.actions.setAskPicked}
			/>
		);
	}

	return (
		<SectionShell label={section.label} index={props.index} kind={section.kind}>
			{editor}
		</SectionShell>
	);
}
