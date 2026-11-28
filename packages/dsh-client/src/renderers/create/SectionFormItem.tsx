/**
 * 单章外壳 —— 章节名（模板给的）+ 内容类型入口 + 编辑区。
 *
 * ## 用 `SectionShell`，不再自己画一套
 *
 * 用户 `2026-11-28`：
 *
 * > 「编辑内容没有适用CSS」
 * > 「在草稿页面有CSS。说明建卡编辑期间和草稿编辑期间没有使用同一个CSS」
 *
 * 以前这里画的是 `.tb3cc-sec*`（另一套头行 / 边框 / 内边距），详情页画
 * `.section-block` ⇒ 同一个章节两处两种长相。现在**外壳只有 `SectionShell`**
 * （`.tb3-sec*`，CSS 在 `section-shell-css.ts`），建卡只是 `mode="edit"`。
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
 * 控件挂在 `SectionShell` 的 `typeControl` 插槽里（与详情页的类型徽章同一位置）。
 *
 * ## 校验错误挂在哪
 *
 * 挂在**章节外壳**上（一条红边 + 一行红字），不弹 toast ——
 * 章节多的时候 toast 会被后面的操作盖掉，而用户需要知道**哪一章**错了。
 * 错误是**这一章的状态**，不是另一种章节 ⇒ 仍走同一个 `SectionShell`。
 */

import type { ReactNode } from 'react';

import type { SectionKind } from '../../pure/create-types.ts';
import type { CreateError } from '../../pure/create-validate.ts';
import type { SectionDraft } from '../../pure/create-types.ts';
import { SectionShell } from '../SectionShell.tsx';

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

	return (
		<SectionShell
			index={props.index}
			title={section.label}
			mode="edit"
			sectionId={section.sectionId}
			kind={section.kind}
			hint={section.hint}
			{...(props.error === undefined ? {} : { error: props.error.message })}
			typeControl={
				<>
					<span className="tb3-sec__type-name">内容类型：</span>
					<select
						className="tb3-sec__type-select"
						aria-label="内容类型"
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
				</>
			}
		>
			{props.children}
		</SectionShell>
	);
}
