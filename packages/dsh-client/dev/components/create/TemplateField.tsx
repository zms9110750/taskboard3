/**
 * 模板选择器 —— **三个布局共用**。
 *
 * ## 简化了什么（相对旧版）
 *
 * 旧版是**三级联选弹层**（`template-picker.js` 242 行）：
 * 点开是一个三列面板（领域 → 类别 → 模板），每列一个列表。
 *
 * 这一版**先用一个 `<select>` 分组下拉 + 选中后的模板说明**。
 * 理由：用户这次要挑的是**页面布局**，不是挑模板选择器的交互。
 * 三级联选留到布局定了之后再做。
 *
 * ⚠ **但模板说明必须常显**（`create-modal-height.png` 第 ③ 条：
 *   「模板说明常驻在选择器下方：一句话说明 + 编号前缀 + 段数」——
 *   现状是「现在只在弹层里看得到，选完就消失」）。
 */

import type { ReactNode } from 'react';

import { KIND_LABEL, TEMPLATES, type FakeTemplate } from './data.ts';

/** 组件属性。 */
export interface TemplateFieldProps {
	readonly value: FakeTemplate;
	readonly onChange: (ref: string) => void;
	/** 紧凑模式（布局 A 的左栏用）。 */
	readonly compact?: boolean;
}

/**
 * 模板选择 + 常驻说明。
 *
 * @param props 见 `TemplateFieldProps`
 */
export function TemplateField(props: TemplateFieldProps): ReactNode {
	const template = props.value;

	return (
		<div className={`tpl${props.compact === true ? ' tpl--compact' : ''}`}>
			<label className="tpl__row">
				<span className="tpl__label">模板</span>
				<select
					className="tpl__select"
					value={template.ref}
					onChange={(event) => {
						props.onChange(event.target.value);
					}}
				>
					{TEMPLATES.map((one) => (
						<option key={one.ref} value={one.ref}>
							{one.domain} · {one.displayName}
						</option>
					))}
				</select>
			</label>

			{/* 常驻说明（不是弹层里看一次就没了） */}
			<div className="tpl__desc">
				<div className="tpl__usage">{template.usage}</div>
				<div className="tpl__meta">
					<span className="tpl__code">
						编号前缀 <b>{template.codePrefix}</b> · 最终编号形如 <code>{template.codePrefix}-01</code>
					</span>
					<span className="tpl__segs">共 {template.sections.length} 段</span>
				</div>
			</div>
		</div>
	);
}

/**
 * 一个章节的**外壳**：章节名 + 内容类型下拉 + 编辑区。
 *
 * ## `action-picker-inside-dialog.png` 左半的建议（照做）
 *
 * | 旧 | 新 |
 * |---|---|
 * | `action: text ▾` | `内容类型：纯文本（text） ▾` |
 *
 * ⇒ **入口用产品词，英文名放括号里当小字。不出现 `action:` 字段名。**
 */
export interface SectionShellProps {
	readonly label: string;
	/** 章节序号（1 起）。 */
	readonly index: number;
	readonly kind: keyof typeof KIND_LABEL;
	readonly children: ReactNode;
}

/**
 * 章节外壳。
 *
 * @param props 见 `SectionShellProps`
 */
export function SectionShell(props: SectionShellProps): ReactNode {
	return (
		<section className="sec">
			<header className="sec__head">
				<div className="sec__title">
					<span className="sec__no">{props.index}</span>
					<span className="sec__label">{props.label}</span>
				</div>
				<button type="button" className="sec__kind">
					内容类型：{KIND_LABEL[props.kind]}
					<span className="sec__kind-tag">（{props.kind}）</span>
					<span className="sec__caret">▾</span>
				</button>
			</header>
			<div className="sec__body">{props.children}</div>
		</section>
	);
}
