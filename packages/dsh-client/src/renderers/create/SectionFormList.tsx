/**
 * 章节表单列表 —— 逐章渲染，**编辑区按 kind 选**。
 *
 * ## 三种编辑区从哪来
 *
 * 本文件**不重复实现** text / markdown / ask 的编辑器，而是复用
 * `src/renderers/` 里已有的渲染组件（`Section`）。那些组件现在是**只读渲染**，
 * 所以「编辑」这一层由本目录的 `SectionEditor*` 提供。
 *
 * ⚠ **阶段说明**：目前 `src/renderers/create/` 只带 text / markdown 的编辑器
 * （ask 编辑器还在 `dev/components/create/` 里，等左栏变体定稿后一起迁）。
 * 遇到 `ask` 时渲染一个**明确的占位**（「ask 编辑器待迁入」），不假装它能用。
 *
 * ## 为什么占位而不是直接不渲染
 *
 * 不渲染的话，用户会以为「这个模板没有这一章」。占位说清了「有这一章但编辑器还没好」。
 */

import type { ReactNode } from 'react';

import type { CreateError } from '../../pure/create-validate.ts';
import type { SectionDraft } from '../../pure/create-types.ts';
import { SectionFormItem } from './SectionFormItem.tsx';

/** 组件属性。 */
export interface SectionFormListProps {
	readonly sections: readonly SectionDraft[];
	readonly errors: readonly CreateError[];
	readonly onKindChange: (sectionId: string, kind: SectionDraft['kind']) => void;
	readonly onPayloadChange: (sectionId: string, payload: unknown) => void;
}

/**
 * 章节列表。
 *
 * @param props 见 `SectionFormListProps`
 */
export function SectionFormList(props: SectionFormListProps): ReactNode {
	if (props.sections.length === 0) {
		return <div className="tb3cc-sec-list__empty">这个模板没有章节（或者还没选模板）。</div>;
	}

	/* 错误按 field 索引一次 —— 逐章查就不必每章扫一遍数组。 */
	const errorByField = new Map(props.errors.map((one) => [one.field, one]));

	return (
		<div className="tb3cc-sec-list">
			{props.sections.map((section, index) => (
				<SectionFormItem
					key={section.sectionId}
					section={section}
					index={index + 1}
					error={errorByField.get(`/sections/${section.sectionId}`)}
					onKindChange={props.onKindChange}
				>
					<SectionEditor
						section={section}
						onPayloadChange={props.onPayloadChange}
					/>
				</SectionFormItem>
			))}
		</div>
	);
}

/**
 * 按 kind 选编辑区。
 *
 * @param props 章节 + 回调
 */
function SectionEditor(props: {
	readonly section: SectionDraft;
	readonly onPayloadChange: (sectionId: string, payload: unknown) => void;
}): ReactNode {
	const section = props.section;

	if (section.kind === 'ask') {
		/*
		 * ⚠ 待迁入。**明确占位**，不假装能用 ——
		 *   假装的话用户填不了却不知道为什么提交不了。
		 */
		return (
			<div className="tb3cc-sec__pending" data-pending-kind="ask">
				⚠ 选项（ask）的编辑器还没迁进来（等左栏变体定稿后一起做）。
				这一章暂时保持模板默认值。
			</div>
		);
	}

	/* text / markdown 共用同一个编辑框：差别只在渲染，不在输入。 */
	return (
		<textarea
			className={`tb3cc-sec__input tb3cc-sec__input--${section.kind}`}
			value={valueOf(section.payload)}
			placeholder={section.hint}
			rows={section.kind === 'markdown' ? 6 : 3}
			onChange={(event) => {
				props.onPayloadChange(section.sectionId, {
					$type: section.kind,
					value: event.target.value,
				});
			}}
		/>
	);
}

/** 取 `{ value }` 里的字符串（脏数据 ⇒ 空串）。 */
function valueOf(payload: unknown): string {
	if (payload === null || typeof payload !== 'object') return '';
	const value = (payload as Record<string, unknown>)['value'];
	return typeof value === 'string' ? value : '';
}
