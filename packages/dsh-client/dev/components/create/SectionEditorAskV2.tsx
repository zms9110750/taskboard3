/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * ask 编辑器 **② 设计稿 B**（`ux-review/detail-ask-editor.png`）。
 *
 * ## 相对 ① 改了什么（照图右侧那五条）
 *
 * | # | 改动 |
 * |---|---|
 * | ① | **单选 / 多选提升为块级控件**，不再飘在网格右上角 |
 * | ② | **问题、灰字提示各有 label 和独立一行**，占位符不再兼任列头 |
 * | ③ | 选项行有**序号 + 拖拽把手 + 常显的删除键**，顺序调整不用猜 |
 * | ④ | **「其它（自己填）」改成开关 + 提示文案**，不再伪装成第三条选项 |
 * | ⑤ | **「删除这组」移到区块层**，与单条删除分开，避免误点 |
 *
 * ## 核心结构变化：问题 / 选项是**两层**
 *
 * ```
 * ┌─ 一句话描述 ──────────────── [单选框][多选框] ─┐   ← 块级控件（改①）
 * │ 问题 *                                          │   ← 独立 label（改②）
 * │ [这次要解决什么问题？                        ] │
 * │ 灰字提示      选项，显示在问题下方              │
 * │ [一句话说清，别写背景                         ] │
 * │                                                 │
 * │ 选项  3 项 · 拖动排序              [+ 添加选项] │   ← 区块头
 * │ ≡ 1 [任务板分组为空        ][选项说明（可空）] × │   ← 序号+把手+常显删除（改③）
 * │ ≡ 2 [卡片顺序不对          ][选项说明（可空）] × │
 * │ ≡ 3 [分组里已经有内容      ][选项说明（可空）] × │
 * │                                                 │
 * │ 其它（自己填）              [开关]              │   ← 开关（改④）
 * │ 允许填写不在列表里的答案                          │
 * │ [输入框提示文案（默认「其它（自己填）」）      ] │
 * │                                     删除这组    │   ← 区块层（改⑤）
 * └─────────────────────────────────────────────────┘
 * ```
 *
 * ⚠ **没做的**：拖拽真交互（图上画了把手，但这一版只画不响应）。
 *   真拖拽要引 dnd 库或写 pointer 事件，展厅阶段不值得 —— 用户先挑样式。
 */

import type { ReactNode } from 'react';

/** 一个选项（带说明）。 */
export interface AskOptionDraft {
	readonly label: string;
	readonly description: string;
}

/** 组件属性。 */
export interface SectionEditorAskV2Props {
	/** 问题标题。 */
	readonly question: string;
	readonly onQuestionChange: (value: string) => void;
	/** 问题下方的灰字提示。 */
	readonly placeholder: string;
	readonly onPlaceholderChange: (value: string) => void;
	/** 是否多选。 */
	readonly multi: boolean;
	readonly onMultiChange: (multi: boolean) => void;
	readonly options: readonly AskOptionDraft[];
	readonly onOptionsChange: (options: readonly AskOptionDraft[]) => void;
	/** 「其它（自己填）」开关。 */
	readonly allowCustom: boolean;
	readonly onAllowCustomChange: (allow: boolean) => void;
	/** 当前选中（多选时是数组；单选时最多一个）。 */
	readonly picked: readonly string[];
	readonly onPickedChange: (picked: readonly string[]) => void;
}

/**
 * ask 编辑器 —— 设计稿 B。
 *
 * @param props 见 `SectionEditorAskV2Props`
 */
export function SectionEditorAskV2(props: SectionEditorAskV2Props): ReactNode {
	const patch = (index: number, next: Partial<AskOptionDraft>): void => {
		props.onOptionsChange(props.options.map((one, i) => (i === index ? { ...one, ...next } : one)));
	};

	const remove = (index: number): void => {
		const gone = props.options[index];
		props.onOptionsChange(props.options.filter((_one, i) => i !== index));
		if (gone !== undefined) {
			props.onPickedChange(props.picked.filter((one) => one !== gone.label));
		}
	};

	const add = (): void => {
		props.onOptionsChange([...props.options, { label: '', description: '' }]);
	};

	const move = (index: number, delta: number): void => {
		const target = index + delta;
		if (target < 0 || target >= props.options.length) return;
		const next = [...props.options];
		const [one] = next.splice(index, 1);
		if (one === undefined) return;
		next.splice(target, 0, one);
		props.onOptionsChange(next);
	};

	const pick = (label: string): void => {
		if (props.multi) {
			props.onPickedChange(
				props.picked.includes(label)
					? props.picked.filter((one) => one !== label)
					: [...props.picked, label],
			);
			return;
		}
		props.onPickedChange(props.picked.includes(label) ? [] : [label]);
	};

	return (
		<div className="ask ask--v2">
			{/* ① 块级控件：单选 / 多选（不再飘在右上角） */}
			<div className="ask2__mode">
				<div className="seg">
					<button
						type="button"
						className={`seg__one${props.multi ? '' : ' is-on'}`}
						onClick={() => {
							props.onMultiChange(false);
						}}
					>
						单选
					</button>
					<button
						type="button"
						className={`seg__one${props.multi ? ' is-on' : ''}`}
						onClick={() => {
							props.onMultiChange(true);
						}}
					>
						多选
					</button>
				</div>
			</div>

			{/* ② 问题 + 灰字提示各有独立 label 和一行 */}
			<label className="ask2__field">
				<span className="ask2__label">
					问题 <b className="ask2__req">*</b>
				</span>
				<input
					className="ask2__input"
					value={props.question}
					placeholder="这次要解决什么问题？"
					onChange={(event) => {
						props.onQuestionChange(event.target.value);
					}}
				/>
			</label>

			<label className="ask2__field">
				<span className="ask2__label ask2__label--sub">灰字提示</span>
				<input
					className="ask2__input ask2__input--soft"
					value={props.placeholder}
					placeholder="选项，显示在问题下方"
					onChange={(event) => {
						props.onPlaceholderChange(event.target.value);
					}}
				/>
			</label>

			{/* ③ 选项区：区块头 + 序号 + 把手 + 常显删除 */}
			<div className="ask2__opts">
				<div className="ask2__opts-head">
					<span>
						选项 <b>{props.options.length}</b> 项 · 拖动排序
					</span>
					<button type="button" className="ask2__add" onClick={add}>
						+ 添加选项
					</button>
				</div>

				{props.options.map((opt, index) => (
					<div className="ask2__opt" key={`opt-${String(index)}`}>
						<span className="ask2__grip" title="拖动排序">
							≡
						</span>
						<span className="ask2__no">{index + 1}</span>
						<input
							className="ask2__opt-label"
							value={opt.label}
							placeholder="选项文字"
							onChange={(event) => {
								const before = opt.label;
								patch(index, { label: event.target.value });
								/* 改名同步选中项，否则选中会消失。 */
								if (props.picked.includes(before)) {
									props.onPickedChange(props.picked.map((one) => (one === before ? event.target.value : one)));
								}
							}}
						/>
						<input
							className="ask2__opt-desc"
							value={opt.description}
							placeholder="选项说明（可空）"
							onChange={(event) => {
								patch(index, { description: event.target.value });
							}}
						/>
						<span className="ask2__opt-actions">
							<button
								type="button"
								className="ask2__mini"
								title="上移"
								onClick={() => {
									move(index, -1);
								}}
							>
								↑
							</button>
							<button
								type="button"
								className="ask2__mini"
								title="下移"
								onClick={() => {
									move(index, 1);
								}}
							>
								↓
							</button>
							<button
								type="button"
								className="ask2__mini ask2__mini--del"
								title="删除这一条"
								onClick={() => {
									remove(index);
								}}
							>
								×
							</button>
						</span>
						{/* 选中态：预览里给一个入口，便于看「已选」长什么样 */}
						<button
							type="button"
							className={`ask2__pick${props.picked.includes(opt.label) ? ' is-on' : ''}`}
							onClick={() => {
								pick(opt.label);
							}}
						>
							{props.picked.includes(opt.label) ? '已选' : '选它'}
						</button>
					</div>
				))}
			</div>

			{/* ④ 「其它（自己填）」是开关，不再伪装成第三条选项 */}
			<div className="ask2__custom">
				<div className="ask2__custom-head">
					<div>
						<div className="ask2__custom-title">其它（自己填）</div>
						<div className="ask2__custom-hint">允许填写不在列表里的答案</div>
					</div>
					<button
						type="button"
						className={`switch${props.allowCustom ? ' is-on' : ''}`}
						role="switch"
						aria-checked={props.allowCustom}
						onClick={() => {
							props.onAllowCustomChange(!props.allowCustom);
						}}
					>
						<span className="switch__knob" />
					</button>
				</div>
				{props.allowCustom ? (
					<input className="ask2__input ask2__input--soft" placeholder="输入框提示文案（默认「其它（自己填）」）" />
				) : null}
			</div>

			{/* ⑤ 「删除这组」在区块层，和单条删除分开 */}
			<div className="ask2__foot">
				<button type="button" className="ask2__drop-group">
					删除这组
				</button>
			</div>
		</div>
	);
}
