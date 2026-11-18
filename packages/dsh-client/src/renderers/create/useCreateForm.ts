/**
 * 建卡表单的**状态** —— 产品级（不是展厅版）。
 *
 * ## 和展厅版 `dev/components/create/useCreateForm.ts` 的区别
 *
 * | | 展厅版 | 本文件 |
 * |---|---|---|
 * | 目的 | 展示布局 | **真能用** |
 * | 数据 | 假数据写死 | 由 `template` prop 驱动 |
 * | 章节 | 三种固定假章节 | 按模板的 `sections[]` 生成 |
 * | 提交 | 按钮不响应 | `onSubmit(submission)` |
 * | 校验 | 无 | `errors` 字段（调 `validateCreate`）|
 * | 类型切换 | 无 | `setSectionKind`（保留/重置规则在 pure 里）|
 *
 * ## ⚠ 为什么不接真 API
 *
 * 这个 hook 只产出**提交结构**，由调用方决定怎么送（`onSubmit` 回调）。
 * 好处：能单测（`node --test` 跑 `.ts`）、能在展厅里用假数据、将来换 HTTP 不用改这里。
 *
 * ## ⚠ 模板变了怎么办
 *
 * 用户换模板时，章节清单要跟着换。而**已填内容**按 `sectionId` 能对上的就保留 ——
 * 不同模板的章节 id 一般不重合，所以实际效果是「换模板基本等于清空」。
 * 这个行为**不提示**（换模板本来就是大动作，用户预期会变）。
 */

import { useCallback, useMemo, useState } from 'react';

import type { CreateDraft, CreateSubmission, SectionDraft, SectionKind } from '../../pure/create-types.ts';
import {
	emptyPayloadOf,
	switchSectionKind,
	toCreateSubmission,
	validateCreate,
	type CreateError,
} from '../../pure/create-validate.ts';

/**
 * 模板在表单里的**窄投影**。
 *
 * ⚠ 不用 `TemplateMeta`（那是 core 的形状）：本包只能拿到 HTTP 给的
 * `TemplateSummary`（不含 sections）+ 单独请求的模板详情。用一个**刚好够用**的形状，
 * 免得绑定到 core 的类型上。
 */
export interface FormTemplate {
	readonly ref: string;
	readonly displayName: string;
	/** 编号前缀（`E` → `E-01`）。 */
	readonly codePrefix: string;
	readonly kind: string;
	readonly domain: string;
	/** 使用说明（选中模板后常显）。 */
	readonly usage: string;
	readonly sections: readonly {
		readonly id: string;
		readonly label: string;
		readonly hint: string;
		/** 模板声明这一章该用哪个 action。 */
		readonly action: SectionKind;
		/**
		 * 模板给的默认 payload。
		 *
		 * ⚠ 可能缺失（core 的 `default` 在 validate 第 ④ 步**不校验**就塞进卡），
		 *   缺失时用 `emptyPayloadOf(action)`。
		 */
		readonly defaultPayload?: unknown;
	}[];
}

/** 组件属性（回调都从外面给）。 */
export interface UseCreateFormOptions {
	/** 当前模板（`undefined` = 还没选）。 */
	readonly template: FormTemplate | undefined;
	/** 可选的候选卡（父任务 / 关系目标）。 */
	readonly pickableCards: readonly { readonly id: string; readonly title: string }[];
	/** 提交（**已通过校验**才会调）。 */
	readonly onSubmit?: (submission: CreateSubmission) => void;
	/** 取消。 */
	readonly onCancel?: () => void;
}

/** hook 的返回。 */
export interface CreateFormHandle {
	readonly draft: CreateDraft;
	/** 当前校验错误（**没点过提交时为空** —— 别一打开就标红）。 */
	readonly errors: readonly CreateError[];
	/** 章节类型被切换时丢过内容（给提示条用，`undefined` = 没发生）。 */
	readonly lostNotice: string | undefined;
	readonly actions: {
		setTitle: (title: string) => void;
		setTemplateRef: (ref: string) => void;
		setParentId: (cardId: string) => void;
		setNote: (note: string) => void;
		/** 改某一章的 payload。 */
		setSectionPayload: (sectionId: string, payload: unknown) => void;
		/** 切某一章的内容类型（保留/重置规则在 pure 里）。 */
		setSectionKind: (sectionId: string, kind: SectionKind) => void;
		/** 关系行整体替换（增删改都由它）。 */
		setRelations: (relations: CreateDraft['relations']) => void;
		/** 点提交：先校验，通过才调 `onSubmit`。 */
		submit: () => void;
		/** 关掉「丢内容」提示。 */
		dismissLostNotice: () => void;
	};
}

/**
 * 按模板生成章节草稿。
 *
 * @param template 模板
 * @param previous 上一份章节（换模板时按 id 对齐，能对上的保留 payload）
 */
export function sectionsOfTemplate(
	template: FormTemplate | undefined,
	previous: readonly SectionDraft[] = [],
): readonly SectionDraft[] {
	if (template === undefined) return [];
	const byId = new Map(previous.map((one) => [one.sectionId, one]));

	return template.sections.map((one) => {
		const old = byId.get(one.id);
		/* 同 id 且同类型 ⇒ 保留旧的 payload（换模板时尽量不丢）。 */
		if (old !== undefined && old.kind === one.action) {
			return { ...old, label: one.label, hint: one.hint };
		}
		return {
			sectionId: one.id,
			label: one.label,
			hint: one.hint,
			kind: one.action,
			payload: one.defaultPayload ?? emptyPayloadOf(one.action),
		};
	});
}

/**
 * 建卡表单状态。
 *
 * @param options 见 `UseCreateFormOptions`
 */
export function useCreateForm(options: UseCreateFormOptions): CreateFormHandle {
	const [title, setTitleState] = useState('');
	const [templateRef, setTemplateRefState] = useState(options.template?.ref ?? '');
	const [parentId, setParentIdState] = useState('');
	const [note, setNoteState] = useState('');
	const [relations, setRelationsState] = useState<CreateDraft['relations']>([]);
	const [sections, setSections] = useState<readonly SectionDraft[]>(() =>
		sectionsOfTemplate(options.template),
	);
	const [errors, setErrors] = useState<readonly CreateError[]>([]);
	const [lostNotice, setLostNotice] = useState<string | undefined>(undefined);

	const draft = useMemo<CreateDraft>(
		() => ({ title, templateRef, parentId, relations, sections, note }),
		[title, templateRef, parentId, relations, sections, note],
	);

	const setTitle = useCallback((next: string): void => {
		setTitleState(next);
	}, []);

	const setTemplateRef = useCallback(
		(ref: string): void => {
			setTemplateRefState(ref);
			/*
			 * 换模板 ⇒ 章节按新模板重建。
			 *
			 * ⚠ 用函数式更新读**上一份 sections** —— 用闭包里的 `sections`
			 *   会让依赖数组带上它，每次 sections 变都重建 `setTemplateRef`。
			 */
			if (ref === options.template?.ref) return;
			setSections((prev) => sectionsOfTemplate(options.template, prev));
		},
		[options.template],
	);

	const setParentId = useCallback((cardId: string): void => {
		setParentIdState(cardId);
	}, []);

	const setNote = useCallback((next: string): void => {
		setNoteState(next);
	}, []);

	const setSectionPayload = useCallback((sectionId: string, payload: unknown): void => {
		setSections((prev) =>
			prev.map((one) => (one.sectionId === sectionId ? { ...one, payload } : one)),
		);
	}, []);

	const setSectionKind = useCallback((sectionId: string, kind: SectionKind): void => {
		setSections((prev) =>
			prev.map((one) => {
				if (one.sectionId !== sectionId) return one;
				const result = switchSectionKind(one, kind);
				/*
				 * ⚠ 拿了内容要**明确告诉用户**，不静默丢。
				 *   提示文案里带上章节名 —— 一屏十几个章节，只说「内容已清空」等于没说。
				 */
				if (result.lostContent) {
					setLostNotice(`「${one.label}」原来的内容已清空（新类型的数据结构与它不兼容）。`);
				}
				return result.section;
			}),
		);
	}, []);

	const setRelations = useCallback((next: CreateDraft['relations']): void => {
		setRelationsState(next);
	}, []);

	const submit = useCallback((): void => {
		const found = validateCreate(draft);
		setErrors(found);
		if (found.length > 0) return;
		options.onSubmit?.(toCreateSubmission(draft));
	}, [draft, options]);

	const dismissLostNotice = useCallback((): void => {
		setLostNotice(undefined);
	}, []);

	return {
		draft,
		errors,
		lostNotice,
		actions: {
			setTitle,
			setTemplateRef,
			setParentId,
			setNote,
			setSectionPayload,
			setSectionKind,
			setRelations,
			submit,
			dismissLostNotice,
		},
	};
}
