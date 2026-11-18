/**
 * 左栏的「模板 + 父任务」块 —— **分行**（模板在上、父任务在下）。
 *
 * ## 用户裁定
 *
 * `2026-11-19`：
 * > 「用 245。也就是说跟旧版一样。」
 *
 * `2026-11-18`（他列的顺序，就是竖排的依据）：
 * > 「原来是这样的
 * >  标题：
 * >  模板：
 * >  父任务：
 * >  关系|高级设置」
 *
 * ⇒ 展厅变体 **② 分行**（不是 ① 同行）。同行那个（`TemplateFieldInline`）留在
 * `dev/components/create/` 作历史，**不进 src**。
 *
 * ## 形状
 *
 * ```
 * 模板
 * [触发器：核心 · 用户任务  ▾]
 * [说明块：一句话 + 编号前缀 + 段数]
 * 父任务
 * [（无，顶层）                 ⌄]
 * ```
 *
 * ⚠ 顺序是**用户列的那个**：模板在父任务**上面**。不要因为「父任务更重要」提前它。
 *
 * ## 为什么模板控件是槽（`picker`）
 *
 * 「怎么排」和「用什么控件」是**正交**的两件事（用户在展厅里正是分开比的：
 * ①② 比排法，③④ 比控件）。⇒ 排法组件收一个 `ReactNode` 槽，
 * 传 `TemplatePickerPopover` 就是三级联选，传一个 `<select>` 也能用。
 *
 * ## 错误挂在哪
 *
 * 标题 / 模板的错误由 `CardCreate` 通过 `LeftPaneContext.errorOf` 交下来，
 * **挂在各自字段下面**（不弹 toast —— 左栏窄，用户需要知道是哪个框）。
 */

import type { ReactNode } from 'react';

import { CardPicker, type PickableCard } from './CardPicker.tsx';
import { TemplateHint, type TemplateHintData } from './TemplateHint.tsx';

/** 组件属性。 */
export interface TemplateFieldProps {
	/** 模板选择控件（调用方给：`TemplatePickerPopover` 等）。 */
	readonly picker: ReactNode;
	/** 选中模板的说明数据（`undefined` = 还没选）。 */
	readonly hint: TemplateHintData | undefined;
	/** 模板字段的错误（`errorOf('/templateRef')` 的结果）。 */
	readonly error: string | undefined;
	/** 父任务卡 id（空串 = 顶层）。 */
	readonly parentId: string;
	readonly onParentChange: (cardId: string) => void;
	/** 父任务候选卡（`CardPicker` 自己过滤草稿 / 墓碑）。 */
	readonly cards: readonly PickableCard[];
}

/**
 * 模板 + 父任务（分行）。
 *
 * @param props 见 `TemplateFieldProps`
 */
export function TemplateField(props: TemplateFieldProps): ReactNode {
	return (
		<div className="tb3cc-tfield" data-template-field="stacked">
			<div className="tb3cc-tfield__cell">
				<span className="tb3cc-label">模板</span>
				{props.picker}
				<TemplateHint
					data={props.hint}
					{...(props.error === undefined ? {} : { error: props.error })}
				/>
			</div>

			<div className="tb3cc-tfield__cell">
				<span className="tb3cc-label">父任务</span>
				<CardPicker
					value={props.parentId}
					cards={props.cards}
					placeholder="（无，顶层）"
					allowEmpty
					name="parent"
					onChange={props.onParentChange}
				/>
			</div>
		</div>
	);
}
