/**
 * ask 的**建卡编辑器**（`askCompose`）—— 产品版。
 *
 * ## 用户 2026-11-22 的裁定
 *
 * > 「C12 建卡面板的 ask 编辑器 这个东西应该可以更新了。并且就按照这个做。
 * >   在创建页面在章节的右边选择控件。但是在提交到了草稿的时候就只能编辑不能改控件了。」
 *
 * ⇒ 两条规则：
 *   1. **章节右边可以选控件**（`SectionFormItem` 的 `select`，已存在）
 *   2. **提交成草稿之后只能编辑内容、不能改控件**（`readonly` 时只显示类型名）
 *
 * ## 它编辑什么
 *
 * payload 就是 `askItemSchema` 的形状：
 * ```
 * { $type: 'ask', items: [{ header?, question?, options: [{label, description?}], multi_select?, placeholder? }] }
 * ```
 * 这里编辑的是**问卷本身**（题目 / 选项 / 单选多选 / 灰字），不是答案。
 *
 * ## 为什么不复用 `AskSection`
 *
 * `AskSection` 是**作答**视图（`askEditable`），它的 `customActive` / `picked` 是答案语义。
 * 建卡编辑的是**题目**，两者字段重叠但语义不同 —— 混在一起会又出现「胶水」。
 * （`AskSection.tsx` 文件头第 32 行也写着「askCompose 走另一条渲染路径，不经过本文件」。）
 */

import type { ReactNode } from 'react';

/* ══════════════════════════════════════════════════════════
   类型 —— 就是模板 action 的 payload 形状
   ══════════════════════════════════════════════════════════ */

/** ask 的一个选项。 */
export interface AskEditorOption {
	readonly label: string;
	readonly description?: string | undefined;
}

/** ask 的一个问题组。 */
export interface AskEditorItem {
	readonly header?: string | undefined;
	readonly question?: string | undefined;
	readonly options: readonly AskEditorOption[];
	readonly multi_select?: boolean | undefined;
	readonly placeholder?: string | undefined;
}

/** 空问题组（新加一组时用）。 */
export const EMPTY_ASK_ITEM: AskEditorItem = {
	header: '',
	question: '',
	options: [{ label: '' }, { label: '' }],
	multi_select: false,
	placeholder: '',
};

/**
 * 从 payload 里读出 items（脏数据兜底成一组空的）。
 *
 * @param payload 章节 payload
 */
export function askItemsOf(payload: unknown): readonly AskEditorItem[] {
	if (typeof payload !== 'object' || payload === null) return [EMPTY_ASK_ITEM];
	const items = (payload as { items?: unknown }).items;
	if (!Array.isArray(items) || items.length === 0) return [EMPTY_ASK_ITEM];

	return items.map(function one(raw): AskEditorItem {
		const item = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
		const options = Array.isArray(item['options']) ? item['options'] : [];
		return {
			header: typeof item['header'] === 'string' ? item['header'] : '',
			question: typeof item['question'] === 'string' ? item['question'] : '',
			options:
				options.length === 0
					? [{ label: '' }]
					: options.map(function opt(rawOption): AskEditorOption {
							const option =
								typeof rawOption === 'object' && rawOption !== null
									? (rawOption as Record<string, unknown>)
									: {};
							return {
								label: typeof option['label'] === 'string' ? option['label'] : '',
								...(typeof option['description'] === 'string'
									? { description: option['description'] }
									: {}),
							};
						}),
			multi_select: item['multi_select'] === true,
			placeholder: typeof item['placeholder'] === 'string' ? item['placeholder'] : '',
		};
	});
}

/** 把编辑器 items 写回 payload。 */
export function askPayloadOf(items: readonly AskEditorItem[]): {
	readonly $type: 'ask';
	readonly items: readonly AskEditorItem[];
} {
	return { $type: 'ask', items };
}

/* ══════════════════════════════════════════════════════════
   组件
   ══════════════════════════════════════════════════════════ */

/** 组件属性。 */
export interface SectionEditorAskProps {
	/** 当前 payload。 */
	readonly payload: unknown;
	/**
	 * 只读 —— **草稿提交后**不能改题目/选项/多选，只能看。
	 *
	 * ⚠ 但「草稿后只能编辑不能改控件」的**控件**在这里指 `SectionFormItem`
	 *   的内容类型下拉；ask 的题目/选项在草稿后**仍然可编辑**（那是内容）。
	 */
	readonly readonly?: boolean;
	/** payload 变更。 */
	readonly onPayloadChange: (payload: unknown) => void;
}

/**
 * ask 建卡编辑器。
 *
 * @param props 见 `SectionEditorAskProps`
 */
export function SectionEditorAsk(props: SectionEditorAskProps): ReactNode {
	const items = askItemsOf(props.payload);
	const readonly = props.readonly === true;

	/**
	 * 整体替换 items 并回写。
	 *
	 * @param next 新 items
	 */
	const commit = (next: readonly AskEditorItem[]): void => {
		props.onPayloadChange(askPayloadOf(next));
	};

	/**
	 * 改一组。
	 *
	 * @param index 组下标
	 * @param patch 字段
	 */
	const patchItem = (index: number, patch: Partial<AskEditorItem>): void => {
		commit(items.map(function one(item, i) {
			return i === index ? { ...item, ...patch } : item;
		}));
	};

	/**
	 * 改一个选项。
	 *
	 * @param itemIndex 组下标
	 * @param optionIndex 选项下标
	 * @param patch 字段
	 */
	const patchOption = (itemIndex: number, optionIndex: number, patch: Partial<AskEditorOption>): void => {
		commit(
			items.map(function one(item, i) {
				if (i !== itemIndex) return item;
				return {
					...item,
					options: item.options.map(function opt(option, j) {
						return j === optionIndex ? { ...option, ...patch } : option;
					}),
				};
			}),
		);
	};

	return (
		<div className="tb3cc-ask" data-ask-editor>
			{items.map(function renderItem(item, itemIndex) {
				return (
					<div className="tb3cc-ask__group" key={itemIndex} data-ask-group={String(itemIndex)}>
						<div className="tb3cc-ask__bar">
							<span className="tb3cc-ask__no">
								问题组 {itemIndex + 1} / {items.length}
							</span>
							{readonly ? null : (
								<button
									type="button"
									className="tb3cc-ask__del-group"
									title="删除这一组"
									onClick={() => {
										if (items.length <= 1) return;
										commit(items.filter(function keep(_, i) {
											return i !== itemIndex;
										}));
									}}
								>
									删除这组
								</button>
							)}
						</div>

						<label className="tb3cc-ask__field">
							<span className="tb3cc-ask__label">问题</span>
							<input
								className="tb3cc-ask__input"
								value={item.question ?? ''}
								readOnly={readonly}
								placeholder="这次要解决什么问题？"
								onChange={(event) => {
									patchItem(itemIndex, { question: event.target.value });
								}}
							/>
						</label>

						<label className="tb3cc-ask__field">
							<span className="tb3cc-ask__label">灰字提示</span>
							<input
								className="tb3cc-ask__input"
								value={item.placeholder ?? ''}
								readOnly={readonly}
								placeholder="一句话说清，别写背景"
								onChange={(event) => {
									patchItem(itemIndex, { placeholder: event.target.value });
								}}
							/>
						</label>

						<div className="tb3cc-ask__field">
							<span className="tb3cc-ask__label">选项</span>
							<div className="tb3cc-ask__toggle">
								<label className="tb3cc-ask__radio">
									<input
										type="radio"
										name={`ask-mode-${String(itemIndex)}`}
										checked={item.multi_select !== true}
										disabled={readonly}
										onChange={() => {
											patchItem(itemIndex, { multi_select: false });
										}}
									/>
									单选
								</label>
								<label className="tb3cc-ask__radio">
									<input
										type="radio"
										name={`ask-mode-${String(itemIndex)}`}
										checked={item.multi_select === true}
										disabled={readonly}
										onChange={() => {
											patchItem(itemIndex, { multi_select: true });
										}}
									/>
									多选
								</label>
							</div>
						</div>

						<div className="tb3cc-ask__options">
							{item.options.map(function renderOption(option, optionIndex) {
								return (
									<div className="tb3cc-ask__option" key={optionIndex}>
										<span className="tb3cc-ask__option-no">{optionIndex + 1}</span>
										<input
											className="tb3cc-ask__option-label"
											value={option.label}
											readOnly={readonly}
											placeholder="选项文字"
											onChange={(event) => {
												patchOption(itemIndex, optionIndex, { label: event.target.value });
											}}
										/>
										<input
											className="tb3cc-ask__option-desc"
											value={option.description ?? ''}
											readOnly={readonly}
											placeholder="说明（可空）"
											onChange={(event) => {
												patchOption(itemIndex, optionIndex, {
													description: event.target.value,
												});
											}}
										/>
										{readonly ? null : (
											<button
												type="button"
												className="tb3cc-ask__option-del"
												title="删除这个选项"
												onClick={() => {
													if (item.options.length <= 1) return;
													patchItem(itemIndex, {
														options: item.options.filter(function keep(_, i) {
															return i !== optionIndex;
														}),
													});
												}}
											>
												×
											</button>
										)}
									</div>
								);
							})}

							{readonly ? null : (
								<button
									type="button"
									className="tb3cc-ask__add-option"
									onClick={() => {
										patchItem(itemIndex, { options: [...item.options, { label: '' }] });
									}}
								>
									+ 添加选项
								</button>
							)}
						</div>
					</div>
				);
			})}

			{readonly ? null : (
				<button
					type="button"
					className="tb3cc-ask__add-group"
					onClick={() => {
						commit([...items, EMPTY_ASK_ITEM]);
					}}
				>
					+ 添加问题组
				</button>
			)}
		</div>
	);
}
