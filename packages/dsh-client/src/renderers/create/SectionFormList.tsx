/**
 * 章节表单列表 —— 逐章渲染，**编辑区按 kind 选**。
 *
 * ## 三种编辑区从哪来
 *
 * 本文件**不重复实现** text / markdown / ask 的编辑器：
 *
 * - text / markdown：共用 `textarea.tb3-sec__textarea`（与详情页**同一套**控件样式）
 * - ask：`SectionEditorAsk`（题目 / 选项 / 单选多选 / 灰字），
 *   它用的是与 `AskSection` 同一套 `.tb3-ask*` 类（issue #59 / #60）
 *
 * 章节外壳由 `SectionFormItem` → `SectionShell` 统一（`.tb3-sec*`），
 * 与详情页共用 `section-shell-css.ts`。
 */

import type { ReactNode } from 'react';

import type { CreateError } from '../../pure/create-validate.ts';
import type { SectionDraft } from '../../pure/create-types.ts';
import { SectionEditorAsk } from './SectionEditorAsk.tsx';
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
		 * 用户 2026-11-22：「C12 建卡面板的 ask 编辑器 这个东西应该可以更新了。」
		 * ⇒ 产品版 `SectionEditorAsk`（题目 / 选项 / 单选多选 / 灰字）。
		 */
		return (
			<SectionEditorAsk
				payload={section.payload}
				onPayloadChange={(payload) => {
					props.onPayloadChange(section.sectionId, payload);
				}}
			/>
		);
	}

	/* text / markdown 共用同一个编辑框：差别只在渲染，不在输入。 */
	return (
		<textarea
			className={`tb3-sec__textarea${section.kind === 'markdown' ? ' is-mono' : ''}`}
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
