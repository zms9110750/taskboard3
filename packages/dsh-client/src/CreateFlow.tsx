/**
 * 建卡流程 —— **打开建卡页 → 内存攒草稿 → 提交走 core 的同一校验入口**。
 *
 * ## 用户裁决（`2026-11-22`，逐条都是硬要求）
 *
 * > 「我记得，新建是做了 ui，有组件的吧。那应该接进去啊。」
 * > 「点击新建以后不是模态框，而是**新建要占满视口**。」
 * > 「而且他是**内存操作**。点了提交以后，这个建卡参数**都要进 core**，
 * >  也要**过架构校验**。而且是**跟 ai tool 一样的校验入口**。过了校验才能建卡。
 * >  建了才能进持久化。才有数据同步。」
 *
 * | 要求 | 怎么落实 |
 * |---|---|
 * | 接进去 | `WorkspaceBody` 的 `onCreateCard` 挂载本组件 |
 * | 占满视口 | 本组件**替换**整个 `<Workspace>`；`CardCreate` 是 `height:100%` 的整页 |
 * | 内存操作 | 草稿在 `useCreateForm()` 的 `useState` 里；填字期间**零请求** |
 * | 同一校验入口 | 提交 → `POST /api/cards` → `taskboard.create()` → `core/create.ts` 的 `buildCard()`；**AI tool `taskboard_create` 调的是同一个方法** |
 * | 过了才持久化 | `buildCard()` 第 7 步才是 `persist`；1–6 步任何一步失败都返回 `Failure` |
 *
 * ## 为什么客户端还要 `validateCreate()`
 *
 * 那是**体验优化**（标题空了立刻标红，不用等往返）。裁决权在 core ——
 * 见 `pure/create-validate.ts` 文件头的「一致性靠结构对齐，不靠共享代码」。
 *
 * ## ⚠ 换模板要**重新取详情**
 *
 * `TemplateSummary`（`GET /api/state` 给的）**没有章节清单** ⇒ 建卡必须再发
 * `GET /api/templates?ref=<ref>`：
 *
 * ```
 * 选模板 → getTemplate(ref) → TemplateDetail.sections
 *        → formTemplateOf(detail) → FormTemplate
 *        → sectionsOfTemplate(template, 旧章节) → 章节草稿
 * ```
 *
 * 取详情失败时**不清空已填内容**（用户可能只是网络抖了），只显示错误。
 *
 * ## ⚠ core 的错误怎么回来
 *
 * `POST /api/cards` 失败 → `api.ts` 的 `unwrap()` 抛 `ApiError`（带 `issues`）
 * → `errorsFromFailure()` 把 core 的 JSON Pointer 翻成表单的 `field`
 * → 错误落到**对应的输入框/章节**下面，而不是一句「创建失败」。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { TaskboardApi, TemplateDetail } from './api.ts';
import { getApi } from './api-client.ts';
import { errorsFromFailure, hasGeneralError, isFailureLike } from './pure/create-failure.ts';
import type { CreateDraft } from './pure/create-types.ts';
import type { PickerTemplate } from './pure/template-picker.ts';
import { toCreateSubmission, type CreateError } from './pure/create-validate.ts';
import { CardCreate } from './renderers/create/CardCreate.tsx';
import type { PickableCard } from './renderers/create/CardPicker.tsx';
import { CreateLeftColumn } from './renderers/create/CreateLeftColumn.tsx';
import type { TemplateHintData } from './renderers/create/TemplateHint.tsx';
import {
	sectionsOfTemplate,
	useCreateForm,
	type FormTemplate,
} from './renderers/create/useCreateForm.ts';
import type { Card, TemplateSummary } from './types.ts';

/** 建卡页的**预填值**（`派生` 那条路用；`onCreateCard` 那条路不传）。 */
export interface CreateInitial {
	/** 父卡 id。空串 / 省略 = 顶层。 */
	readonly parentId?: string;
	/** 预填标题。 */
	readonly title?: string;
	/** 预填模板 ref。空串 / 省略 = 让用户选。 */
	readonly templateRef?: string;
}

/** 组件属性。 */
export interface CreateFlowProps {
	/** 当前空间（提交时必带）。 */
	readonly workspaceId: string;
	/** 模板清单（`state.templates`）。 */
	readonly templates: readonly TemplateSummary[];
	/** 候选卡（父任务 / 关系目标）。 */
	readonly cards: readonly Card[];
	/**
	 * 预填值（**可选**）。
	 *
	 * ## 谁用（用户 `2026-11-22`）
	 *
	 * > 「派生的模板定义是为 ui 服务的快捷入口。从这里点击的派生就是走新建。
	 * >   自动设置父任务和标题和模板。只有这个效果。」
	 * > 「点进去了以后模板可以换标题可以换父任务也可以换。」
	 *
	 * ⇒ 「+ 派生子任务」点菜单项后打开建卡页时传它；工具栏「新建」**不传**。
	 *   传了也只是**初值** —— 页面上三样都能改（不是只读，不是隐藏）。
	 */
	readonly initial?: CreateInitial;
	/** 类别 id → 中文名（省略 = 显示英文 id）。 */
	readonly kindLabelOf?: (kind: string) => string;
	/** 类别 id → 字母（省略 = 首字母大写兜底）。 */
	readonly kindLetterOf?: (kind: string) => string;
	/** API（**只给预览 / 测试注入**；产品里必须省略）。 */
	readonly api?: TaskboardApi;
	/** 提交成功：新卡已落库。 */
	readonly onCreated: (cardId: string) => void;
	/** 关闭（丢弃草稿）。 */
	readonly onCancel: () => void;
}

/**
 * `TemplateDetail` → `FormTemplate`（表单要的窄投影）。
 *
 * 不认识的 `action` 跳过（建卡页只能编辑三种），那几章由 core 填模板默认值。
 *
 * @param detail core 的模板展开视图
 */
export function formTemplateOf(detail: TemplateDetail): FormTemplate {
	const sections: {
		id: string;
		label: string;
		hint: string;
		action: 'text' | 'markdown' | 'ask';
	}[] = [];
	for (const one of detail.sections) {
		if (one.action !== 'text' && one.action !== 'markdown' && one.action !== 'ask') continue;
		sections.push({ id: one.id, label: one.label, hint: one.hint, action: one.action });
	}
	return {
		ref: detail.ref,
		displayName: detail.displayName,
		codePrefix: '',
		kind: detail.kind,
		domain: detail.domain,
		usage: detail.usage,
		sections,
	};
}

/**
 * `state.templates` → 模板选择器要的形状。
 *
 * @param templates 摘要清单
 */
function pickerTemplatesOf(templates: readonly TemplateSummary[]): readonly PickerTemplate[] {
	return templates.map((one) => ({
		ref: one.ref,
		displayName: one.displayName,
		kind: one.kind,
		domain: one.domain,
	}));
}

/**
 * `Card[]` → 候选卡（父任务 / 关系目标）。
 *
 * @param cards 当前空间的卡
 */
function pickableOf(cards: readonly Card[]): readonly PickableCard[] {
	return cards.map((one) => ({
		id: one.id,
		title: one.title,
		status: one.status,
		deleted: one.deleted,
	}));
}

/**
 * 建卡流程（**整页**，不是模态框）。
 *
 * @param props 见 `CreateFlowProps`
 */
export function CreateFlow(props: CreateFlowProps): ReactNode {
	const api = props.api ?? getApi();

	/** 已取到详情的模板。 */
	const [template, setTemplate] = useState<FormTemplate | undefined>(undefined);
	/** 取模板详情失败的原因（不清草稿）。 */
	const [templateError, setTemplateError] = useState<string | undefined>(undefined);
	/** core 拒绝时那条映射不到字段的统错（要显示原话）。 */
	const [banner, setBanner] = useState<string | undefined>(undefined);
	const [pending, setPending] = useState(false);
	/** 当前草稿对应的模板 ref（守卫异步详情回来时用户又换过模板）。 */
	const pickedRef = useRef('');

	const pickable = pickableOf(props.cards);

	const form = useCreateForm({
		template,
		pickableCards: pickable,
		onSubmit: (submission) => {
			void submitToCore(submission);
		},
	});
	/** 最新的草稿（给异步回调读，避免闭包过期）。 */
	const draftRef = useRef<CreateDraft>(form.draft);
	draftRef.current = form.draft;

	/* 预填只跑一次（定义在 `onChange` 之后 —— 那个函数是本文件的依赖链末端）。 */

	/**
	 * 提交 —— **真正进 core 的那一步**。
	 *
	 * 调用链（和 AI tool `taskboard_create` **同一条**）：
	 *
	 * ```
	 * api.createCard()  →  POST /api/cards
	 *   → dsh/src/http.ts     taskboard.create()
	 *   → core/src/create.ts  buildCard()   ← AI tool 也调这个
	 *       1 模板存在 2 标题非空 2.5 分类/领域 3 content 三规则
	 *       4 schemas.validate 5 关系目标 6 发号 7 withHistory + persist
	 *   → core 拒绝 ⇒ Failure（带 issues，JSON Pointer）
	 * ```
	 *
	 * @param submission `toCreateSubmission()` 的产物
	 * @returns 是否成功（失败时错误已落到界面上）
	 */
	const submitToCore = useCallback(
		async (submission: ReturnType<typeof toCreateSubmission>): Promise<boolean> => {
			setBanner(undefined);
			setPending(true);
			try {
				const card = await api.createCard({
					workspaceId: props.workspaceId,
					templateRef: submission.templateRef,
					title: submission.title,
					content: submission.content,
					relations: submission.relations,
					note: submission.note,
				});
				setPending(false);
				props.onCreated(card.id);
				return true;
			} catch (cause) {
				setPending(false);
				if (isFailureLike(cause)) {
					/* core 的 JSON Pointer → 表单字段路径 ⇒ 错误落到对应输入框下面。 */
					const mapped = errorsFromFailure(cause, draftRef.current);
					form.actions.setErrors(mapped);
					/* 有映射不到字段的错误 ⇒ 必须显示 core 原话，否则用户找不到那一处。 */
					if (hasGeneralError(mapped)) setBanner(cause.message);
					return false;
				}
				setBanner(`提交失败：${cause instanceof Error ? cause.message : String(cause)}`);
				return false;
			}
		},
		[api, props, form.actions],
	);

	/**
	 * 取某个模板的详情并切成表单模板。
	 *
	 * @param ref 模板 ref（空串 = 清掉）
	 */
	const loadTemplate = useCallback(
		(ref: string): void => {
			if (ref === '') {
				setTemplate(undefined);
				setTemplateError(undefined);
				return;
			}
			void api.getTemplate(ref).then(
				(detail) => {
					setTemplate(formTemplateOf(detail));
					setTemplateError(undefined);
				},
				(cause: unknown) => {
					setTemplateError(
						isFailureLike(cause) ? cause.message : `取模板详情失败：${String(cause)}`,
					);
				},
			);
		},
		[api],
	);

	/**
	 * 草稿变了（`CardCreate` 的 `onChange` 是**整份替换**）。
	 *
	 * 换模板时不在这里重建章节 —— 详情还没取到。等 `template` 变了再重建。
	 *
	 * @param next 新草稿
	 */
	const onChange = useCallback(
		(next: CreateDraft): void => {
			if (next.templateRef === pickedRef.current) {
				form.actions.applyDraft(next);
				return;
			}
			/*
			 * 换了模板：先清空章节（新模板的章节还没取到），再去取详情。
			 * ⚠ 不清空旧的 —— 旧章节属于旧模板，留着会让 core 报「模板里没有这个章节」。
			 */
			pickedRef.current = next.templateRef;
			form.actions.applyDraft({ ...next, sections: [] });
			loadTemplate(next.templateRef);
		},
		[form.actions, loadTemplate],
	);

	/*
	 * 详情回来 ⇒ 按新模板重建章节（同 id 且同类型保留已填 payload）。
	 *
	 * ⚠ 守卫 `template.ref === pickedRef.current`：详情是异步的，
	 *   用户可能在等待期间又换了一次模板 ⇒ 旧请求的结果不能覆盖新的。
	 */
	useEffect(() => {
		if (template === undefined) return;
		if (template.ref !== pickedRef.current) return;
		form.actions.applyDraft({
			...form.draft,
			sections: sectionsOfTemplate(template, form.draft.sections),
		});
		// 只在 template 变时重建 —— 依赖 form 会死循环（applyDraft 改 draft）。
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [template]);

	/*
	 * ── 预填（`派生` 那条路，用户 2026-11-22） ──
	 *
	 * 只在**挂载后跑一次**：它是「初值」不是「受控值」——
	 * 用户随后改了什么，不能被这个 effect 再盖回去。
	 *
	 * 三样分别处理：
	 *   · 父任务 / 标题 ⇒ 直接写进草稿（不需要异步）
	 *   · 模板         ⇒ 必须走 `onChange`：它会 `pickedRef.current = ref` 再取详情，
	 *                    详情回来后上面那个 effect 才按新模板重建章节。
	 *                    直接 `applyDraft({ templateRef })` 会留下
	 *                    「ref 有了、template 还是 undefined」——
	 *                    界面上模板显示已选但章节清单空着，提交会被 core 拒。
	 *
	 * ⚠ 用 `applyDraft` 一次写两个字段：分两次 setter 会让中间那一帧草稿不一致。
	 */
	const prefilled = useRef(false);
	useEffect(() => {
		if (prefilled.current) return;
		prefilled.current = true;

		const initial = props.initial;
		if (initial === undefined) return;

		const next: CreateDraft = {
			...draftRef.current,
			title: initial.title ?? draftRef.current.title,
			parentId: initial.parentId ?? draftRef.current.parentId,
		};

		if (initial.templateRef === undefined || initial.templateRef === '') {
			form.actions.applyDraft(next);
			return;
		}
		onChange({ ...next, templateRef: initial.templateRef });
		// 只跑一次：props 变了也不重跑（预填是初值）。
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/** 说明块的数据（只有当前选中的模板有）。 */
	const hint = (ref: string): TemplateHintData | undefined =>
		template === undefined || template.ref !== ref
			? undefined
			: {
					usage: template.usage,
					codePrefix: template.codePrefix,
					sectionCount: template.sections.length,
				};

	return (
		<div className="tb3w-root tb3w-create" data-create-flow="1">
			<CardCreate
				draft={form.draft}
				onChange={onChange}
				errors={form.errors}
				leftPane={(ctx) => (
					<CreateLeftColumn
						draft={form.draft}
						onChange={onChange}
						ctx={ctx}
						templates={pickerTemplatesOf(props.templates)}
						cards={pickable}
						hintOf={hint}
						{...(props.kindLabelOf === undefined ? {} : { kindLabelOf: props.kindLabelOf })}
						{...(props.kindLetterOf === undefined ? {} : { kindLetterOf: props.kindLetterOf })}
					/>
				)}
				onSubmit={form.actions.submit}
				onCancel={props.onCancel}
				pending={pending}
				onLostContent={(label) => {
					setBanner(`「${label}」原来的内容已清空（新类型的数据结构与它不兼容）。`);
				}}
			/>

			{templateError === undefined ? null : (
				<div className="tb3cc-actions__err" data-template-err="1">
					{templateError}
				</div>
			)}
			{banner === undefined ? null : (
				<div className="tb3cc-actions__err" data-create-banner="1">
					{banner}
				</div>
			)}
		</div>
	);
}
