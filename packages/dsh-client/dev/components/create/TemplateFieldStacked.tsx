/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * 变体 ②：**模板 + 父任务 分行**（用户 `2026-11-18` / `2026-11-19` 要的）。
 *
 * ## 用户原话
 *
 * `2026-11-19`：
 * > 「和我要求的父任务和模板分行。」
 *
 * `2026-11-18`：
 * > 「新建任务卡肯定是左右分栏的。重点是左边他摆什么东西。
 * >  原来是这样的
 * >  标题：/ 模板：/ 父任务：/ 关系|高级设置」
 *
 * ⇒ 竖着四项，模板和父任务**各占一行**（和 `CreateLayoutFinal` 的左栏一致）。
 *   本文件把它做成**可复用的独立组件**，这样展厅能单独演示「分行」这一件事。
 *
 * ## 形状
 *
 * ```
 * 模板
 * [下拉        ]
 * [说明块                        共 3 段]
 * 父任务
 * [（无，顶层）                  ]
 * ```
 *
 * ⚠ 顺序照用户说的：**模板在父任务上面**。不要因为「父任务更重要」把它提前 ——
 *   用户列的原始顺序就是标题 → 模板 → 父任务。
 *
 * ## 和 ① 的唯一差别
 *
 * ①是两列网格 + 说明块横跨；这里是单列流式。控件是槽、说明是数据，两者同一套。
 */

import type { ReactNode } from 'react';

import { CardPicker, type PickableCard } from './CardPicker.tsx';
import { TemplateNote, type TemplateNoteData } from './TemplateField.tsx';

/** 组件属性。 */
export interface TemplateFieldStackedProps {
	readonly picker: ReactNode;
	readonly note: TemplateNoteData;
	readonly parentId: string;
	readonly onParentChange: (cardId: string) => void;
	readonly cards: readonly PickableCard[];
}

/**
 * 模板 + 父任务分行（竖排）。
 *
 * @param props 见 `TemplateFieldStackedProps`
 */
export function TemplateFieldStacked(props: TemplateFieldStackedProps): ReactNode {
	return (
		<div className="tv tv--stacked" data-variant="template-stacked">
			<div className="tv__cell">
				<span className="a__label">模板</span>
				{props.picker}
			</div>

			<TemplateNote
				usage={props.note.usage}
				codePrefix={props.note.codePrefix}
				sectionCount={props.note.sectionCount}
				compact
			/>

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
	);
}
