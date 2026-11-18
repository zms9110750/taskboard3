/**
 * 建卡页的左栏 —— **定稿排法**：标题 → 模板 → 父任务 → [关系 | 高级设置]。
 *
 * ## 用户裁定（`2026-11-19`）
 *
 * 展厅里 6 个变体并排给用户看完之后：
 *
 * > 「用 245。也就是说跟旧版一样。」
 *
 * | 维度 | 选定 |
 * |---|---|
 * | 排法 | **②** 模板 + 父任务**分行**（`TemplateField.tsx`）|
 * | 模板选择 | **④** 三级联选弹层（`TemplatePickerPopover.tsx`，独立组件）|
 * | 折叠区 | **⑤** 按钮 + 共用折叠区（`MetaTabs.tsx`）|
 *
 * ⚠ 用户说「跟旧版一样」，而他 `2026-11-18` 列旧版时是**竖着**列的
 *   （「标题：/ 模板：/ 父任务：/ 关系|高级设置」）⇒ 就是**分行**，不是同行。
 *   同行那个变体（①）留在 `dev/` 作历史，不进 src。
 *
 * ## ⚠ 本组件**不持有草稿**，也不做 I/O
 *
 * 它是 `CardCreate` 的 `leftPane` 插槽内容。三种输入全部由外面给：
 *
 * | 输入 | 从哪来 | 用途 |
 * |---|---|---|
 * | `draft` | 调用方（`useCreateForm().draft`）| 显示当前值 |
 * | `onChange` | 调用方 | 每次编辑**整份替换**草稿 |
 * | `ctx` | `CardCreate` 的 render prop（`LeftPaneContext`）| `ctx.errorOf('/title')` 取错误 |
 *
 * ⇒ 「换模板要重新取章节」这种**有副作用**的事**不在这里做**：本组件只把
 *   `templateRef` 改掉交出去，取详情 / 重建章节是调用方的事（那要发请求，
 *   而左栏不该知道有网络）。`CardCreate.tsx` 的注释也是同一个口径。
 *
 * ## 宽 320px 是 `CREATE_CSS` 定的
 *
 * `.tb3cc-page__left{flex:0 0 320px}` —— 左栏宽度**在父层**，本组件撑满即可
 * （不要把宽度写进来，否则换个页面就错位）。
 */

import type { ReactNode } from 'react';

import type { CreateDraft } from '../../pure/create-types.ts';
import type { PickerTemplate } from '../../pure/template-picker.ts';
import type { LeftPaneContext } from './CardCreate.tsx';
import type { PickableCard } from './CardPicker.tsx';
import { MetaTabs } from './MetaTabs.tsx';
import { TemplateField } from './TemplateField.tsx';
import { TemplatePickerPopover } from './TemplatePickerPopover.tsx';
import type { TemplateHintData } from './TemplateHint.tsx';

/** 组件属性。 */
export interface CreateLeftColumnProps {
	/** 当前草稿（受控）。 */
	readonly draft: CreateDraft;
	/** 草稿变了（**整份替换**，不给细粒度 setter）。 */
	readonly onChange: (next: CreateDraft) => void;
	/** `CardCreate` 给左栏的上下文（错误查询）。 */
	readonly ctx: LeftPaneContext;
	/** 模板清单（`GET /api/state` 的 `templates`）。 */
	readonly templates: readonly PickerTemplate[];
	/** 父任务 / 关系目标的候选卡（当前空间的卡）。 */
	readonly cards: readonly PickableCard[];
	/**
	 * 某个模板的说明数据（usage / 段数）。
	 *
	 * ⚠ 摘要在 `GET /api/state` 里**没有** usage 和段数（那是 `GET /api/templates?ref=`）。
	 *   调用方取到详情就传进来，没取到就不传 —— 说明块会只显示编号前缀，**不编**。
	 */
	readonly hintOf?: (ref: string) => TemplateHintData | undefined;
	/** 类别 id → 中文名（省略 ⇒ 显示英文 id）。 */
	readonly kindLabelOf?: (kind: string) => string;
	/** 类别 id → 字母（省略 ⇒ id 首字母大写兜底）。 */
	readonly kindLetterOf?: (kind: string) => string;
}

/**
 * 建卡左栏（定稿排法）。
 *
 * 用法（`CardCreate` 的 `leftPane` 插槽）：
 *
 * ```tsx
 * <CardCreate
 *   draft={draft}
 *   onChange={setDraft}
 *   errors={errors}
 *   leftPane={(ctx) => (
 *     <CreateLeftColumn draft={draft} onChange={setDraft} ctx={ctx} templates={templates} cards={cards} />
 *   )}
 * />
 * ```
 *
 * @param props 见 `CreateLeftColumnProps`
 */
export function CreateLeftColumn(props: CreateLeftColumnProps): ReactNode {
	const { draft, onChange, ctx } = props;

	const titleError = ctx.errorOf('/title');
	const templateError = ctx.errorOf('/templateRef');

	const hint = props.hintOf?.(draft.templateRef);

	/* 换模板只改 `templateRef` —— 「重建章节」是调用方的事（要发请求）。 */
	const changeTemplate = (ref: string): void => {
		onChange({ ...draft, templateRef: ref });
	};

	/* 父任务 / 关系都在草稿里，改完整份回传。 */
	const changeParent = (parentId: string): void => {
		onChange({ ...draft, parentId });
	};

	const changeRelations = (relations: CreateDraft['relations']): void => {
		onChange({ ...draft, relations });
	};

	return (
		<div className="tb3cc-leftcol" data-create-left="">
			{/* ── ① 标题（必填） ── */}
			<label className="tb3cc-field">
				<span className="tb3cc-label">
					标题 <b className="tb3cc-req">*</b>
				</span>
				<input
					className={`tb3cc-input${titleError === undefined ? '' : ' has-error'}`}
					value={draft.title}
					placeholder="例如：修好任务板分组为空时的提示"
					onChange={(event) => {
						onChange({ ...draft, title: event.target.value });
					}}
				/>
				{titleError === undefined ? null : (
					<div className="tb3cc-field-err" data-field-err="title">
						{titleError.message}
					</div>
				)}
			</label>

			{/* ── ② 模板（三级联选）+ ③ 父任务：**分行** ── */}
			<TemplateField
				picker={
					<TemplatePickerPopover
						pickedRef={draft.templateRef}
						templates={props.templates}
						onPick={(one) => {
							changeTemplate(one.ref);
						}}
						{...(props.kindLabelOf === undefined ? {} : { kindLabelOf: props.kindLabelOf })}
						{...(props.kindLetterOf === undefined ? {} : { kindLetterOf: props.kindLetterOf })}
					/>
				}
				hint={hint}
				error={templateError?.message}
				parentId={draft.parentId}
				onParentChange={changeParent}
				cards={props.cards}
			/>

			{/* ── ④ 关系 | 高级设置（按钮 + 共用折叠区） ── */}
			<MetaTabs
				relations={draft.relations}
				onRelationsChange={changeRelations}
				cards={props.cards}
			/>
		</div>
	);
}
