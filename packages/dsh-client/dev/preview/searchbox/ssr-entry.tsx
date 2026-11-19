/**
 * SSR 断言入口 —— 给 `verify.mjs` 用。
 *
 * ## 为什么有这个东西
 *
 * `2026-11-19` 这个沙箱里 **headless Edge 起不来**（DSH 沙箱禁止命名管道，
 * Chromium 的 mojo IPC 直接 FATAL），⇒ 原来的 CDP 方案（`spacebar/verify.mjs` 那种）
 * 跑不了，也就量不了 `getBoundingClientRect`。
 *
 * 退而求其次：**用 SSR 把组件渲染成 HTML 字符串**，断言 DOM 结构。
 * 能证明的：图标在 field 内部 / input 内部；`disabled` 的挂载；占位文字；SVG 形状。
 * 不能证明的：像素位置、同一行几何 —— 那些**不假装测了**，报告里写明。
 *
 * ⚠ 这个文件在 `dev/` 下，不进产品构建；它只是给 `node verify.mjs` 打包用的。
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SearchBox } from '../../../src/renderers/SearchBox.tsx';
import type { SearchBoxProps } from '../../../src/renderers/SearchBox.tsx';
import {
	DEFAULT_SEARCH_PLACEHOLDER,
	canSubmitOf,
	submitQueryOf,
} from '../../../src/pure/search-box.ts';

/*
 * 纯逻辑也 re-export 出来：verify.mjs 里顺手再断言一遍，
 * 保证「组件用的那份判决」和测试里那份是**同一份**（同一模块）。
 */
export { DEFAULT_SEARCH_PLACEHOLDER, canSubmitOf, submitQueryOf };

/** SSR 入参：只收数据，回调在内部给 noop（结构断言不看回调）。 */
export interface SsrProps {
	readonly value: string;
	readonly disabled?: boolean;
	readonly placeholder?: string;
}

const noop = (): void => {};

/**
 * 把 `SearchBox` 渲染成 HTML 字符串。
 *
 * @param props 数据型 props
 */
export function renderSearchBox(props: SsrProps): string {
	const full: SearchBoxProps = {
		value: props.value,
		onChange: noop,
		onSubmit: noop,
		...(props.placeholder === undefined ? {} : { placeholder: props.placeholder }),
		...(props.disabled === undefined ? {} : { disabled: props.disabled }),
	};
	return renderToStaticMarkup(createElement(SearchBox, full));
}
