/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * 新建页的**表单状态** —— 三个布局共用。
 *
 * ## 为什么抽出来
 *
 * A/B/C 三个布局的差别只在**摆放**，表单数据完全一样。
 * 如果每个布局各写一份 `useState`，改一处字段就要改三遍 ——
 * 而且用户对比时会发现「A 能改选项说明、B 不能」这种假差异。
 *
 * ⇒ 状态在这里唯一，布局只决定「画在哪」。
 *
 * ⚠ 这一版**不做校验、不做提交** —— 展厅只要可编辑、看着对。
 */

import { useCallback, useMemo, useState } from 'react';

import {
	ASK_OPTIONS,
	ASK_PICKED,
	DEFAULT_TEMPLATE_REF,
	INITIAL_VALUES,
	TEMPLATES,
	type FakeSection,
	type FakeTemplate,
} from './data.ts';
import type { AskOptionDraft } from './SectionEditorAskV2.tsx';

/** 表单的唯一状态。 */
export interface CreateForm {
	readonly title: string;
	readonly template: FakeTemplate;
	/** 章节 id → 纯文本 / markdown 源码。 */
	readonly values: Readonly<Record<string, string>>;
	/** ask 章节的问题。 */
	readonly question: string;
	/** ask 章节的灰字提示。 */
	readonly askPlaceholder: string;
	/** ask 是否多选。 */
	readonly askMulti: boolean;
	/** ask 的选项（带说明）。 */
	readonly askOptions: readonly AskOptionDraft[];
	/** ask 的选中项。 */
	readonly askPicked: readonly string[];
	/** 「其它（自己填）」开关。 */
	readonly askAllowCustom: boolean;
}

/** 表单动作。 */
export interface CreateFormActions {
	setTitle: (title: string) => void;
	setTemplate: (ref: string) => void;
	setValue: (sectionId: string, value: string) => void;
	setQuestion: (question: string) => void;
	setAskPlaceholder: (value: string) => void;
	setAskMulti: (multi: boolean) => void;
	setAskOptions: (options: readonly AskOptionDraft[]) => void;
	setAskPicked: (picked: readonly string[]) => void;
	setAskAllowCustom: (allow: boolean) => void;
}

/** hook 返回。 */
export interface CreateHandle {
	readonly form: CreateForm;
	readonly actions: CreateFormActions;
	/** 当前模板的 ask 章节（没有则 `undefined`）。 */
	readonly askSection: FakeSection | undefined;
}

/** 初始模板。 */
function initialTemplate(): FakeTemplate {
	const hit = TEMPLATES.find((one) => one.ref === DEFAULT_TEMPLATE_REF);
	return hit ?? (TEMPLATES[0] as FakeTemplate);
}

/** 一个固定初值，避免每次渲染都新建对象。 */
function initialForm(): CreateForm {
	const template = initialTemplate();
	return {
		title: '',
		template,
		values: { ...INITIAL_VALUES },
		question: '这个预期的依据',
		askPlaceholder: '选项，显示在问题下方',
		askMulti: false,
		askOptions: ASK_OPTIONS.map((one) => ({ label: one.label, description: one.description })),
		askPicked: [...ASK_PICKED],
		askAllowCustom: true,
	};
}

/**
 * 新建页表单。
 *
 * @returns 状态 + 动作 + 当前模板的 ask 章节
 */
export function useCreateForm(): CreateHandle {
	const [form, setForm] = useState<CreateForm>(initialForm);

	const setTitle = useCallback((title: string): void => {
		setForm((prev) => ({ ...prev, title }));
	}, []);

	const setTemplate = useCallback((ref: string): void => {
		const next = TEMPLATES.find((one) => one.ref === ref);
		if (next === undefined) return;
		setForm((prev) => ({ ...prev, template: next }));
	}, []);

	const setValue = useCallback((sectionId: string, value: string): void => {
		setForm((prev) => ({ ...prev, values: { ...prev.values, [sectionId]: value } }));
	}, []);

	const setQuestion = useCallback((question: string): void => {
		setForm((prev) => ({ ...prev, question }));
	}, []);

	const setAskPlaceholder = useCallback((askPlaceholder: string): void => {
		setForm((prev) => ({ ...prev, askPlaceholder }));
	}, []);

	const setAskMulti = useCallback((askMulti: boolean): void => {
		setForm((prev) => ({ ...prev, askMulti }));
	}, []);

	const setAskOptions = useCallback((askOptions: readonly AskOptionDraft[]): void => {
		setForm((prev) => ({ ...prev, askOptions }));
	}, []);

	const setAskPicked = useCallback((askPicked: readonly string[]): void => {
		setForm((prev) => ({ ...prev, askPicked }));
	}, []);

	const setAskAllowCustom = useCallback((askAllowCustom: boolean): void => {
		setForm((prev) => ({ ...prev, askAllowCustom }));
	}, []);

	const askSection = useMemo(
		() => form.template.sections.find((one) => one.kind === 'ask'),
		[form.template],
	);

	return {
		form,
		actions: {
			setTitle,
			setTemplate,
			setValue,
			setQuestion,
			setAskPlaceholder,
			setAskMulti,
			setAskOptions,
			setAskPicked,
			setAskAllowCustom,
		},
		askSection,
	};
}
