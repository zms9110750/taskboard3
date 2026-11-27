/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * ask 编辑器 **① 旧版式**。
 *
 * ## 旧版长什么样（`card-create/section-form.js` + `section-actions.js`）
 *
 * ```
 * ┌────────────────────────────────────────────┐
 * │ 为什么这么想          [内容类型：选项 ▾]     │
 * │ 这个预期的依据                              │
 * │ ┌────────────────────────────────────────┐ │
 * │ │ 选项 1                             ×   │ │
 * │ ├────────────────────────────────────────┤ │
 * │ │ 选项 2                             ×   │ │
 * │ └────────────────────────────────────────┘ │
 * │ + 添加选项                                  │
 * └────────────────────────────────────────────┘
 * ```
 *
 * ## 旧版的四个毛病（UX 评审 `detail-ask-editor.png` 列的）
 *
 * | # | 毛病 |
 * |---|---|
 * | 1 | **问题**和**选项**挤在同一张网格里，列头是占位符；用户填完问题后，问题框和选项框长得一模一样 |
 * | 2 | 「多选」勾选框**飘在网格右上角** |
 * | 3 | 「其它（自己填）」**伪装成第三条选项** |
 * | 4 | **删除链接压在输入框边缘** |
 *
 * ⚠ 这一版**故意照抄旧版**（包括这四个毛病），因为用户要对比的就是
 *   「旧版式 vs 设计稿 B」的差别。美化它会让对比失去意义。
 */

import type { ReactNode } from 'react';

import type { FakeSection } from './data.ts';

/** 组件属性。 */
export interface SectionEditorAskV1Props {
	readonly section: FakeSection;
	/** 问题标题。 */
	readonly question: string;
	readonly onQuestionChange: (value: string) => void;
	/** 选项 label 列表（旧版没有「选项说明」这一层）。 */
	readonly options: readonly string[];
	readonly onOptionsChange: (options: readonly string[]) => void;
	/** 当前选中的项。 */
	readonly picked: readonly string[];
	readonly onPickedChange: (picked: readonly string[]) => void;
}

/**
 * ask 编辑器 —— 旧版式。
 *
 * @param props 见 `SectionEditorAskV1Props`
 */
export function SectionEditorAskV1(props: SectionEditorAskV1Props): ReactNode {
	const addOption = (): void => {
		props.onOptionsChange([...props.options, `选项 ${props.options.length + 1}`]);
	};

	const removeOption = (index: number): void => {
		const label = props.options[index];
		props.onOptionsChange(props.options.filter((_one, i) => i !== index));
		/* 删掉的项如果已被选中，一并清掉 —— 旧版也是这么做的。 */
		if (label !== undefined) {
			props.onPickedChange(props.picked.filter((one) => one !== label));
		}
	};

	const renameOption = (index: number, value: string): void => {
		const before = props.options[index];
		props.onOptionsChange(props.options.map((one, i) => (i === index ? value : one)));
		/* 改名要同步跟着改选中项，否则选中会凭空消失。 */
		if (before !== undefined && props.picked.includes(before)) {
			props.onPickedChange(props.picked.map((one) => (one === before ? value : one)));
		}
	};

	const toggle = (label: string): void => {
		props.onPickedChange(
			props.picked.includes(label)
				? props.picked.filter((one) => one !== label)
				: [...props.picked, label],
		);
	};

	return (
		<div className="ask ask--v1">
			{/* 问题栏 —— 旧版和选项同一张网格，所以这里没有独立的分层。 */}
			<div className="ask__row ask__row--head">
				<input
					className="ask__question-inline"
					value={props.question}
					placeholder="问题"
					onChange={(event) => {
						props.onQuestionChange(event.target.value);
					}}
				/>
				{/* 多选勾选框 —— 旧版就飘在这里（毛病 ②） */}
				<label className="ask__multi-inline">
					<input type="checkbox" /> 多选
				</label>
			</div>

			{props.options.map((label, index) => (
				<div className="ask__row" key={`${label}-${String(index)}`}>
					<input
						className="ask__hit"
						type="checkbox"
						checked={props.picked.includes(label)}
						onChange={() => {
							toggle(label);
						}}
					/>
					<input
						className="ask__opt-inline"
						value={label}
						onChange={(event) => {
							renameOption(index, event.target.value);
						}}
					/>
					{/* 删除压在输入框边缘 —— 旧版就是这样（毛病 ④） */}
					<button
						type="button"
						className="ask__del-inline"
						onClick={() => {
							removeOption(index);
						}}
					>
						×
					</button>
				</div>
			))}

			<button type="button" className="ask__add" onClick={addOption}>
				+ 添加选项
			</button>
		</div>
	);
}
