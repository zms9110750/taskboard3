/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * 模板选择器的**零件**：裸下拉、常驻说明块、组合体、章节外壳。
 *
 * ## 为什么不只是一个 `TemplateField`
 *
 * 用户 `2026-11-19` 要的是「**左栏里模板这块的几种排法**」：
 *
 * | 要对比的东西 | 本文件提供 |
 * |---|---|
 * | 模板控件本身（普通下拉 vs 三级联选弹层） | `TemplateSelect`（弹层见 `TemplatePickerPopover.tsx`）|
 * | 控件下面的说明块放哪 | `TemplateNote` |
 * | 控件 + 说明粘在一起 | `TemplateField`（旧组合体，`CreateLayoutFinal` 还在用）|
 *
 * ⇒ 排法（同行 / 分行）在 `TemplateFieldInline.tsx` / `TemplateFieldStacked.tsx`，
 *   它们**只吃 `picker` 这个槽**，所以「用下拉还是用弹层」和「怎么排」是两件正交的事。
 *   （用户要的正是这个正交对比：① ② 比排法，③ ④ 比控件。）
 *
 * ⚠ **模板说明必须常显**（`create-modal-height.png` 第 ③ 条：
 *   「模板说明常驻在选择器下方：一句话说明 + 编号前缀 + 段数」——
 *   现状是「现在只在弹层里看得到，选完就消失」）。
 */

import type { ReactNode } from 'react';

import { KIND_LABEL, TEMPLATES, type FakeTemplate } from './data.ts';

/* ══════════════════════════════════════════════════════════
   裸控件
   ══════════════════════════════════════════════════════════ */

/** 组件属性。 */
export interface TemplateSelectProps {
	readonly value: FakeTemplate;
	readonly onChange: (ref: string) => void;
}

/**
 * 模板的**普通下拉**（原生 `<select>`）—— 变体 ③。
 *
 * 旧版是三级联选弹层（`template-picker.js` 242 行）；这一版先给一个 `<select>`：
 * 选项按「领域 · 名称」分组显示，简单、零 JS、能用键盘。
 *
 * ⚠ 它**不带 label、不带说明块** —— 那是排法组件（`TemplateFieldInline/Stacked`）的事。
 *   带上就会和排法打架（同行排法里说明块要横跨两列）。
 *
 * @param props 见 `TemplateSelectProps`
 */
export function TemplateSelect(props: TemplateSelectProps): ReactNode {
	return (
		<select
			className="tpl__select"
			data-template-select=""
			value={props.value.ref}
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
	);
}

/* ══════════════════════════════════════════════════════════
   常驻说明块
   ══════════════════════════════════════════════════════════ */

/** 组件属性。 */
export interface TemplateNoteProps {
	/** 一句话说明。 */
	readonly usage: string;
	/** 编号前缀字母；**空串是合法值**（= 该模板不提供字母段），显示成「—」。 */
	readonly codePrefix: string;
	/** 段数。 */
	readonly sectionCount: number;
	/** 窄栏里用（说明压到两行）。 */
	readonly compact?: boolean;
}

/**
 * 说明块要的三个值 —— **不含「模板」这个类型**。
 *
 * ⚠ 为什么不用 `FakeTemplate` 当参数：说明块的来源有两处
 *   （假模板 `TEMPLATES` / 真目录 `TEMPLATE_CATALOG`），两者形状不同。
 *   让排法组件只认「三个值」，弹层和下拉就能共用同一套排法。
 */
export interface TemplateNoteData {
	readonly usage: string;
	/** 空串 = 该模板不提供字母段。 */
	readonly codePrefix: string;
	readonly sectionCount: number;
}

/**
 * 说明块的三个值（从假模板取）。
 *
 * @param template 假模板
 */
export function noteOfTemplate(template: FakeTemplate): TemplateNoteData {
	return {
		usage: template.usage,
		codePrefix: template.codePrefix,
		sectionCount: template.sections.length,
	};
}

/**
 * 模板说明块（**常驻**，不是弹层里看一次就没了）。
 *
 * ⚠ 前缀**拿不到时不猜**：空串显示成「—」，不显示成 `-01`
 *   （旧版 `prefixLetterOf` 的同一条判据：猜字母会让用户以为编号是确定的）。
 *
 * @param props 见 `TemplateNoteProps`
 */
export function TemplateNote(props: TemplateNoteProps): ReactNode {
	const prefix = props.codePrefix === '' ? '—' : props.codePrefix;

	return (
		<div className={`tpl__desc${props.compact === true ? ' tpl--compact' : ''}`} data-template-note="">
			<div className="tpl__usage">{props.usage}</div>
			<div className="tpl__meta">
				<span className="tpl__code">
					编号前缀 <b>{prefix}</b> · 最终编号形如{' '}
					<code>{props.codePrefix === '' ? '（由系统分配）' : `${props.codePrefix}-01`}</code>
				</span>
				<span className="tpl__segs" data-note-segs={String(props.sectionCount)}>
					共 {props.sectionCount} 段
				</span>
			</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   组合体（旧 API，`CreateLayoutFinal` 还在用）
   ══════════════════════════════════════════════════════════ */

/** 组件属性。 */
export interface TemplateFieldProps {
	readonly value: FakeTemplate;
	readonly onChange: (ref: string) => void;
	/** 紧凑模式（布局 A / Final 的左栏用）。 */
	readonly compact?: boolean;
}

/**
 * 模板选择 + 常驻说明（label 在上、控件在下、说明在最后）。
 *
 * @param props 见 `TemplateFieldProps`
 */
export function TemplateField(props: TemplateFieldProps): ReactNode {
	const template = props.value;

	return (
		<div className={`tpl${props.compact === true ? ' tpl--compact' : ''}`}>
			<label className="tpl__row">
				<span className="tpl__label">模板</span>
				<TemplateSelect value={template} onChange={props.onChange} />
			</label>

			<TemplateNote
				usage={template.usage}
				codePrefix={template.codePrefix}
				sectionCount={template.sections.length}
				{...(props.compact === true ? { compact: true } : {})}
			/>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   章节外壳
   ══════════════════════════════════════════════════════════ */

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
