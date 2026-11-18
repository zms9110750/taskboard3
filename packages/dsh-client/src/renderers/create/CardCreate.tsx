/**
 * 建卡整页骨架 —— **满屏，不是弹窗**。
 *
 * ## 用户原话（`2026-11-18`）
 *
 * > 「新建任务卡肯定是左右分栏的。重点是左边他摆什么东西。
 * >  原来是这样的
 * >  标题：
 * >  模板：
 * >  父任务：
 * >  关系|高级设置
 * >  关系和高级设置是两个按钮。点开了，在下面会有额外内容。
 * >  也就是说他们的内容是折叠的而且共用展示的。」
 *
 * 以及更早的一条（这条决定了「满屏」）：
 *
 * > 「新建页面要是一个占满的屏幕。不是模态框。」
 *
 * ## ⚠ 左栏是**插槽**，不是内建
 *
 * 用户还没挑完左栏变体（另一个 AI 在做展厅）。把这个组件做成只认
 * `leftPane: ReactNode`，好处是**用户挑完只需换那块内容，本文件不用改**。
 *
 * 反过来（把左栏排法写死在这里）会导致：用户选了变体 B ⇒ 要改这个文件 ⇒
 * 而它已经和右栏、底栏、错误展示耦合在一起了，改它风险大。
 *
 * ## 布局（顶栏/底栏固定，中间两个滚动区）
 *
 * ```
 * ┌──────────────────────────────────────────────┐
 * │ 新建事项                                [×]  │ ← 固定
 * ├───────────────┬──────────────────────────────┤
 * │ leftPane      │ 章节表单                      │
 * │ 320px         │ flex:1                        │ ← 右栏滚动
 * │               │                               │
 * ├───────────────┴──────────────────────────────┤
 * │                        [取消] [提交]          │ ← 固定
 * └──────────────────────────────────────────────┘
 * ```
 *
 * ⚠ **关键 CSS 是 `.tb3cc-page__body { min-height: 0 }`** —— flex 子元素默认
 *   `min-height: auto`，不设 `0` 的话它会被内容撑高，`overflow-y: auto` **永远不生效**
 *   （整页变成滚动，顶栏底栏跟着滚走）。这是 flex 布局里最常见的坑之一。
 *
 * ## 错误展示的分工
 *
 * | `field` | 谁显示 |
 * |---|---|
 * | `/sections/<id>` | **本文件**（右栏，挂在该章下面）|
 * | 其它（`/title`、`/templateRef`）| **左栏调用方**（本文件把 errors 通过 render prop 给它）|
 *
 * `leftPane` 支持两种形态：
 *
 * - `ReactNode` —— 调用方自己排左栏（拿不到 errors，左栏不显示逐字段错误）
 * - `(ctx: LeftPaneContext) => ReactNode` —— 调用方拿得到 errors 和 `errorOf()`
 *
 * ⇒ 不是硬塞一种。等用户挑完左栏变体，用函数形态就能把标题/模板的错误
 *   显示到对应输入框下面。
 */

import type { ReactNode } from 'react';

import type { CreateDraft, SectionKind } from '../../pure/create-types.ts';
import { switchSectionKind, type CreateError } from '../../pure/create-validate.ts';
import { CreateActions } from './CreateActions.tsx';
import { SectionFormList } from './SectionFormList.tsx';

/** 左栏能拿到的上下文（只有函数形态才有）。 */
export interface LeftPaneContext {
	/** 全部错误（调用方可能想自己统一处理）。 */
	readonly errors: readonly CreateError[];
	/**
	 * 取某个字段的错误。
	 *
	 * @param field 字段路径（`/title`、`/templateRef`）
	 */
	readonly errorOf: (field: string) => CreateError | undefined;
}

/** 组件属性。 */
export interface CardCreateProps {
	readonly draft: CreateDraft;
	/** 草稿变了（整个替换，不给细粒度 setter）。 */
	readonly onChange: (next: CreateDraft) => void;
	/**
	 * 左栏内容。
	 *
	 * - 传 `ReactNode`：调用方自己排（拿不到逐字段错误）
	 * - 传函数：拿到 `LeftPaneContext`，能把标题/模板的错误显示到输入框下
	 */
	readonly leftPane: ReactNode | ((ctx: LeftPaneContext) => ReactNode);
	readonly errors: readonly CreateError[];
	/** 点提交（**已经过 `validateCreate`** —— 由调用方决定什么时候校验）。 */
	readonly onSubmit: () => void;
	readonly onCancel: () => void;
	/** 提交中（防连点）。 */
	readonly pending?: boolean;
	/**
	 * 切类型时**丢了内容**的通知。
	 *
	 * ⚠ 可选，但**强烈建议接**：不接就等于静默丢用户写的东西。
	 *   本组件只管「丢了」这个事实，怎么提示（toast / 顶部条 / 行内）由调用方定。
	 *
	 * @param sectionLabel 丢内容的章节名（要能说出是哪一章）
	 */
	readonly onLostContent?: (sectionLabel: string) => void;
}

/**
 * 建卡页。
 *
 * @param props 见 `CardCreateProps`
 */
export function CardCreate(props: CardCreateProps): ReactNode {
	const draft = props.draft;

	/* 右栏拿 `/sections/<id>` 开头的那批；其余归左栏。 */
	const sectionErrors = props.errors.filter((one) => one.field.startsWith('/sections/'));

	const errorOf = (field: string): CreateError | undefined =>
		props.errors.find((one) => one.field === field);

	const left =
		typeof props.leftPane === 'function'
			? props.leftPane({ errors: props.errors, errorOf })
			: props.leftPane;

	const setSections = (sections: CreateDraft['sections']): void => {
		props.onChange({ ...draft, sections });
	};

	return (
		<div className="tb3cc-page">
			<header className="tb3cc-page__top">
				<h2 className="tb3cc-page__title">新建事项</h2>
				<button
					type="button"
					className="tb3cc-page__close"
					title="关闭"
					onClick={props.onCancel}
				>
					×
				</button>
			</header>

			<div className="tb3cc-page__body">
				<aside className="tb3cc-page__left">{left}</aside>

				<main className="tb3cc-page__right">
					<SectionFormList
						sections={draft.sections}
						errors={sectionErrors}
						onKindChange={(sectionId, kind) => {
							const result = changeKind(draft.sections, sectionId, kind);
							if (result.sections !== draft.sections) {
								props.onChange({ ...draft, sections: result.sections });
							}
							if (result.lostLabel !== undefined) {
								props.onLostContent?.(result.lostLabel);
							}
						}}
						onPayloadChange={(sectionId, payload) => {
							setSections(
								draft.sections.map((one) =>
									one.sectionId === sectionId ? { ...one, payload } : one,
								),
							);
						}}
					/>
				</main>
			</div>

			<footer className="tb3cc-page__foot">
				<CreateActions
					onCancel={props.onCancel}
					onSubmit={props.onSubmit}
					errorCount={props.errors.length}
					{...(props.pending === undefined ? {} : { pending: props.pending })}
				/>
			</footer>
		</div>
	);
}

/**
 * 换某一章的类型。
 *
 * ## ⚠ 保留/重置的判决**不在这里**
 *
 * 那套规则在 `pure/create-validate.ts` 的 `switchSectionKind`（5 条规则 + 单测）。
 * 但那个文件也不该被本文件直接调 —— 它的返回值包含 `lostContent`，
 * 而**要不要提示用户**是调用方的决定（本组件不知道有没有 toast 系统）。
 *
 * ⇒ 本文件调 `switchSectionKind` 拿到判决，然后：
 *   · 用 `result.section` 更新
 *   · 若 `result.lostContent` ⇒ 调 `onLostContent(label)` 上报
 *
 * 这样「丢不丢」由 pure 决定（有测试钉住），「怎么提示」由调用方决定。
 *
 * @param sections 原章节
 * @param sectionId 目标章节
 * @param kind 新类型
 * @returns 判决结果（新章节 + 是否丢了内容）
 */
function changeKind(
	sections: CreateDraft['sections'],
	sectionId: string,
	kind: SectionKind,
): { readonly sections: CreateDraft['sections']; readonly lostLabel: string | undefined } {
	const target = sections.find((one) => one.sectionId === sectionId);
	if (target === undefined || target.kind === kind) return { sections, lostLabel: undefined };

	const result = switchSectionKind(target, kind);
	return {
		sections: sections.map((one) => (one.sectionId === sectionId ? result.section : one)),
		lostLabel: result.lostContent ? target.label : undefined,
	};
}
