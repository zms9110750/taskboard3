/**
 * 搜索框 —— **框内放大镜图标 + 「前往」按钮 + 回车提交**。
 *
 * 用户 `2026-11-19`：
 * > 「加一个按钮。为搜索框加一个框内图标。别的组件框架都提供这种插槽的。
 * >  你应该知道框内图标长啥样。」
 *
 * ## 它是什么 / 不是什么
 *
 * - **受控**：`value` 由外面持有，组件不 `useState`；输入后不清空。
 * - **零依赖**：图标是 inline SVG（本仓库不引图标库）。
 * - **一个提交入口**：回车和「前往」都走同一个 `submit()`；
 *   「空 / 纯空格算不算提交」的判决在 `src/pure/search-box.ts`，组件里不判第二次。
 *
 * ## 框内图标的「框」是哪一层
 *
 * ```
 * .search-box                        ← 一行：[输入框] [前往]
 * ├─ .search-box__field             ← 有边框的框；图标和 input 都在它里面
 * │  ├─ .search-box__icon (svg)     ← 绝对定位在左侧
 * │  └─ input.search-box__input     ← 铺满 field，左内边距让开图标
 * └─ button.search-box__go
 * ```
 *
 * ⚠ **图标的矩形必须完全落在 `input` 的 border-box 内** ——
 *   `input` 铺满 `.search-box__field`，图标绝对定位在 field 左内边距区，
 *   ⇒ 几何上「图标在输入框内部」。
 *
 *   为什么不是把 `<svg>` 写成 `<input>` 的子节点：`<input>` 是 void 元素，
 *   不可能有子节点（HTML 层面做不到）。主流框架也都是「带边框的 field 里
 *   塞一个 adornment」：MUI `InputAdornment position="start"` /
 *   Ant Design `prefix` / shadcn 绝对定位 `<Icon>`。
 *   ⇒ 结构上图标是 **field 的子节点**，不是「框外面那个 label」。
 */

import type { ReactNode } from 'react';

import { DEFAULT_SEARCH_PLACEHOLDER, canSubmitOf, submitQueryOf } from '../pure/search-box.ts';

/** 组件属性。 */
export interface SearchBoxProps {
	/** 当前输入值（受控，由调用方持有）。 */
	readonly value: string;
	/** 输入变化。 */
	readonly onChange: (next: string) => void;
	/** 回车 或 点「前往」时触发。参数是 **trim 过** 的值。 */
	readonly onSubmit: (query: string) => void;
	/** 占位文字。省略用默认。 */
	readonly placeholder?: string;
	/** 整框禁用（比如没有空间时）。 */
	readonly disabled?: boolean;
}

/**
 * 任务板搜索框。
 *
 * @param props 见 `SearchBoxProps`
 */
export function SearchBox(props: SearchBoxProps): ReactNode {
	const disabled = props.disabled === true;

	/*
	 * 两个局部量都来自 `pure/search-box.ts` ——
	 * 这里**不再**出现 `trim()` / `length === 0` / 「空也算能提交吗」的判断。
	 */
	const query = submitQueryOf(props.value);
	const canSubmit = canSubmitOf(props.value, disabled);

	/**
	 * **唯一的提交入口**：回车 / 点「前往」都调它。
	 *
	 * 两个前置条件缺一不可：有 trim 过的词（`query !== null`）、
	 * 且没有被禁用（`canSubmit`）。不满足就**不触发 `onSubmit`**。
	 */
	const submit = (): void => {
		if (!canSubmit || query === null) return;
		props.onSubmit(query);
	};

	return (
		<div className="search-box" data-search-box="1" data-search-disabled={String(disabled)}>
			<div className="search-box__field">
				{/*
				 * 框内图标（装饰性）⇒ `aria-hidden`，读屏不要念「放大镜」。
				 * 形状 / 尺寸的视觉决定写在 `dev/preview/searchbox/style.css`。
				 */}
				<span className="search-box__icon" data-search-icon="1" aria-hidden="true">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth={2}
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<circle cx="11" cy="11" r="8" />
						<path d="M21 21l-4.35-4.35" />
					</svg>
				</span>

				<input
					className="search-box__input"
					data-search-input="1"
					type="text"
					value={props.value}
					placeholder={props.placeholder ?? DEFAULT_SEARCH_PLACEHOLDER}
					disabled={disabled}
					aria-label="搜索任务板"
					onChange={(event) => {
						props.onChange(event.target.value);
					}}
					onKeyDown={(event) => {
						if (event.key !== 'Enter') return;
						/*
						 * 阻止默认：输入框在表单里时 Enter 会提交表单；这里只有一个提交入口，
						 * 不让浏览器再走一遍别的路径。
						 */
						event.preventDefault();
						submit();
					}}
				/>
			</div>

			<button
				type="button"
				className="search-box__go"
				data-search-go="1"
				disabled={!canSubmit}
				title={
					disabled
						? '搜索不可用'
						: query === null
							? '先输入搜索词'
							: `搜索「${query}」`
				}
				onClick={submit}
			>
				前往
			</button>
		</div>
	);
}
