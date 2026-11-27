/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * 变体 ①：**模板 + 父任务 同一行**（旧 SVG 建议的排法）。
 *
 * ## 用户 `2026-11-19`
 *
 * > 「比如 svg 里面的父任务和模板在一行。
 * >  和我要求的父任务和模板分行。」
 *
 * ⇒ 本文件就是「一行」，`TemplateFieldStacked.tsx` 是「分行」。两者**只差排法**，
 *   数据、控件、说明块完全同一套 —— 不然并排对比时会混进实现差异。
 *
 * ## 形状
 *
 * ```
 * 模板              父任务
 * [下拉        ]    [（无，顶层）      ]
 * [说明块                        共 3 段]
 * ```
 *
 * ## 为什么说明块**横跨两列**而不是塞进左列
 *
 * 说明块有「编号前缀 + 共 N 段」两段信息，塞进半宽里会折成三行、还把父任务那列
 * 顶出一个空洞。`create-modal-height.png` 里旧建议的说明块就是整行的。
 *
 * ## 控件是槽（`picker`），说明是数据（`note`）
 *
 * 用户要对比的两件事是**正交**的：
 * - ① vs ② = 排法（模板和父任务同行 or 分行）
 * - ③ vs ④ = 控件（普通下拉 or 三级联选弹层）
 *
 * ⇒ 本文件收一个 `ReactNode` 槽 + 一份 `TemplateNoteData`。
 *   想试「弹层 + 同行」就传弹层 + 弹层那边选中的说明，不用改本文件。
 */

import type { ReactNode } from 'react';

import { CardPicker, type PickableCard } from './CardPicker.tsx';
import { TemplateNote, type TemplateNoteData } from './TemplateField.tsx';

/** 组件属性。 */
export interface TemplateFieldInlineProps {
	/** 模板控件 —— 调用方给（`TemplateSelect` 或 `TemplatePickerPopover`）。 */
	readonly picker: ReactNode;
	/** 常驻说明块的三个值。 */
	readonly note: TemplateNoteData;
	/** 父任务卡 id（空串 = 顶层）。 */
	readonly parentId: string;
	readonly onParentChange: (cardId: string) => void;
	/** 候选卡（`CardPicker` 自己过滤草稿 / 墓碑）。 */
	readonly cards: readonly PickableCard[];
}

/**
 * 模板 + 父任务同一行。
 *
 * @param props 见 `TemplateFieldInlineProps`
 */
export function TemplateFieldInline(props: TemplateFieldInlineProps): ReactNode {
	return (
		<div className="tv tv--inline" data-variant="template-inline">
			<div className="tv__grid">
				<div className="tv__cell">
					<span className="a__label">模板</span>
					{props.picker}
				</div>
				<div className="tv__cell">
					<span className="a__label">父任务</span>
					<CardPicker
						value={props.parentId}
						cards={props.cards}
						placeholder="（无，顶层）"
						allowEmpty
						onChange={props.onParentChange}
					/>
				</div>
			</div>

			<TemplateNote
				usage={props.note.usage}
				codePrefix={props.note.codePrefix}
				sectionCount={props.note.sectionCount}
				compact
			/>
		</div>
	);
}
