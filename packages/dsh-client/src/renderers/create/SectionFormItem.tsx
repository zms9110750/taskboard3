/**
 * 单章外壳 —— 章节名（模板给的）+ 内容类型入口 + 编辑区。
 *
 * ## 内容类型入口用**产品词**，不出现 `action:` 字段名
 *
 * `ux-review/action-picker-inside-dialog.png` 左半的建议：
 *
 * | 旧 | 新 |
 * |---|---|
 * | `action: text ▾` | `内容类型：纯文本（text） ▾` |
 *
 * ⇒ 中文名 + 括号里英文小字。用户不需要知道「action」这个词。
 *
 * ## 校验错误挂在哪
 *
 * 挂在**章节外壳**上（一条红边 + 一行红字），不弹 toast ——
 * 章节多的时候 toast 会被后面的操作盖掉，而用户需要知道**哪一章**错了。
 */

import type { ReactNode } from 'react';

import type { SectionKind } from '../../pure/create-types.ts';
import type { CreateError } from '../../pure/create-validate.ts';
import type { SectionDraft } from '../../pure/create-types.ts';

/** 内容类型的中文名（产品词）。 */
const KIND_LABEL: Readonly<Record<SectionKind, string>> = Object.freeze({
	text: '纯文本',
	markdown: 'Markdown',
	ask: '选项',
});

/** 下拉里的顺序（和 core 的 `BUILTIN_ACTIONS` 一致）。 */
const KIND_ORDER: readonly SectionKind[] = Object.freeze(['text', 'markdown', 'ask']);

/** 组件属性。 */
export interface SectionFormItemProps {
	readonly section: SectionDraft;
	/** 章节序号（1 起）。 */
	readonly index: number;
	/** 这个章节的错误（没有则 `undefined`）。 */
	readonly error: CreateError | undefined;
	/** 类型切换。 */
	readonly onKindChange: (sectionId: string, kind: SectionKind) => void;
	/** 编辑区（由 `SectionFormList` 按 kind 选）。 */
	readonly children: ReactNode;
}

/**
 * 一个章节的表单外壳。
 *
 * @param props 见 `SectionFormItemProps`
 */
export function SectionFormItem(props: SectionFormItemProps): ReactNode {
	const section = props.section;
	const hasError = props.error !== undefined;

	return (
		<section className={`create-sec${hasError ? ' has-error' : ''}`} data-section-id={section.sectionId}>
			<header className="create-sec__head">
				<div className="create-sec__title">
					<span className="create-sec__no">{props.index}</span>
					<span className="create-sec__label">{section.label}</span>
				</div>
				<label className="create-sec__kind">
					<span className="create-sec__kind-label">内容类型：</span>
					<select
						className="create-sec__kind-select"
						value={section.kind}
						onChange={(event) => {
							props.onKindChange(section.sectionId, event.target.value as SectionKind);
						}}
					>
						{KIND_ORDER.map((one) => (
							<option key={one} value={one}>
								{KIND_LABEL[one]}（{one}）
							</option>
						))}
					</select>
				</label>
			</header>

			<div className="create-sec__body">{props.children}</div>

			{hasError ? <div className="create-sec__error">{props.error.message}</div> : null}
		</section>
	);
}
