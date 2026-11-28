/**
 * 章节外壳 —— **全产品唯一一套章节外观**。
 *
 * ## 为什么要有它（issue #59 / #60）
 *
 * 用户 `2026-11-28` 原话：
 *
 * > 「编辑内容没有适用CSS」
 * > 「在草稿页面有CSS。说明建卡编辑期间和草稿编辑期间没有使用同一个CSS」
 *
 * 事实正是如此：建卡页用 `.tb3cc-sec*`（另一套边框 / 内边距 / 头行），
 * 详情页用 `.section-block`（另一套）。**同一个章节类型在两处长得不一样**，
 * 而且建卡页的 ask 编辑区连 CSS 都没有（`.tb3cc-ask*` 只有类名、零规则）。
 *
 * ⇒ 三处（建卡 / 详情未终结 / 详情终结）**只剩这一个外壳**：
 *
 * | 位置 | 谁用它 | mode |
 * |---|---|---|
 * | 建卡页 | `SectionFormItem` | `edit` |
 * | 详情未终结 | `Section` | `interactive` |
 * | 详情终结 | `Section` | `readonly` |
 *
 * ## 三种 mode **只影响可交互性，不影响任何视觉属性**
 *
 * | mode | 额外 class | data 属性 | 说明 |
 * |---|---|---|---|
 * | `edit` | 无 | `data-section-mode="edit"` | 控件换成 input，外观与交互态同源 |
 * | `interactive` | 无 | `data-section-mode="interactive"` | 可点 / 可答 |
 * | `readonly` | `.tb3-sec--readonly` | `data-section-mode="readonly"` | 只加 `cursor` 等交互属性 |
 *
 * ⇒ `.tb3-sec--readonly` 的 CSS **只有 `cursor` / `user-select`**，
 *   没有 padding / border-radius / font-size / margin / background / color。
 *   这条由 `dev/preview/section-shell/verify.mjs` 的 SSR + CSS 文本断言钉住。
 *
 * ## 类名
 *
 * `.tb3-sec` / `.tb3-sec__head` / `.tb3-sec__index` / `.tb3-sec__title` /
 * `.tb3-sec__type` / `.tb3-sec__body` / `.tb3-sec--readonly`
 * —— 唯一一套，CSS 在同目录 `section-shell-css.ts`。
 *
 * ## 为什么 `typeControl` / `error` 是「插槽」而不是 mode 分支
 *
 * 建卡页的章节头要能**选内容类型**（用户 `2026-11-22`：「在创建页面在章节的右边
 * 选择控件」），详情页只显示类型名。两处**外壳结构相同**，差别只在右端放什么：
 * 传 `typeControl` 就放控件，传 `typeLabel` 就放徽章。
 * 校验错误同理 —— 它是**这一章的状态**，不是另一种章节。
 */

import type { ReactNode } from 'react';

/** 章节外壳的三种交互模式（只影响可交互性，不影响视觉）。 */
export type SectionShellMode = 'edit' | 'interactive' | 'readonly';

/** 组件属性。 */
export interface SectionShellProps {
	/** 章节序号（圆点里的数字，1 起）。 */
	readonly index: number;
	/** 章节名（模板给的 `label`）。空串 ⇒ 不画标题行。 */
	readonly title: string;
	/** 内容类型徽章（「选项」「富文本」…）。与 `typeControl` 二选一。 */
	readonly typeLabel?: string;
	/** 交互模式（见文件头）。 */
	readonly mode: SectionShellMode;
	/** 提示文字（模板给的 hint，可选）。 */
	readonly hint?: string;
	/** 章节正文。 */
	readonly children: ReactNode;
	/**
	 * 建卡页用：内容类型**选择控件**（`<select>`）。
	 *
	 * 传了它就替换 `typeLabel` 徽章 —— 同一块位置，两种内容。
	 */
	readonly typeControl?: ReactNode;
	/** 这一章的校验错误（建卡页用）—— 一条红边 + 一行红字。 */
	readonly error?: string;
	/** 章节 id，挂 `data-section-id`（测试 / 预览的稳定钩子）。 */
	readonly sectionId?: string;
	/** 内容形态（`text` / `markdown` / `ask` / `unknown`），挂 `data-section-kind`。 */
	readonly kind?: string;
	/** 整章点击回调（详情里「点这一章去编辑」）。 */
	readonly onClick?: () => void;
}

/**
 * 一个章节的外壳。
 *
 * @param props 见 `SectionShellProps`
 */
export function SectionShell(props: SectionShellProps): ReactNode {
	const className = ['tb3-sec'];
	if (props.mode === 'readonly') className.push('tb3-sec--readonly');
	if (props.onClick !== undefined) className.push('is-editable');
	if (props.error !== undefined) className.push('has-error');

	const hasHead =
		props.title !== '' || props.typeLabel !== undefined || props.typeControl !== undefined;

	return (
		<section
			className={className.join(' ')}
			data-section-shell="1"
			data-section-mode={props.mode}
			data-section-readonly={String(props.mode === 'readonly')}
			{...(props.sectionId === undefined ? {} : { 'data-section-id': props.sectionId })}
			{...(props.kind === undefined ? {} : { 'data-section-kind': props.kind })}
			{...(props.onClick === undefined ? {} : { onClick: props.onClick })}
		>
			{hasHead ? (
				<header className="tb3-sec__head">
					<span className="tb3-sec__index" aria-hidden="true">
						{props.index}
					</span>
					{props.title === '' ? null : <span className="tb3-sec__title">{props.title}</span>}
					{props.typeControl !== undefined ? (
						<span className="tb3-sec__type">{props.typeControl}</span>
					) : props.typeLabel === undefined ? null : (
						<span className="tb3-sec__type">{props.typeLabel}</span>
					)}
				</header>
			) : null}

			{props.hint === undefined || props.hint === '' ? null : (
				<div className="tb3-sec__hint">{props.hint}</div>
			)}

			<div className="tb3-sec__body">{props.children}</div>

			{props.error === undefined ? null : <div className="tb3-sec__error">{props.error}</div>}
		</section>
	);
}
