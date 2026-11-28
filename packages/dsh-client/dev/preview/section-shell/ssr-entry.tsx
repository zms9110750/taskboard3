/**
 * `SectionShell` 的 SSR 断言入口 —— 给同目录 `verify.mjs` 用。
 *
 * 组件是 `.tsx`，Node 的运行时类型剥离**不处理 JSX** ⇒ 不能直接 `node ssr-entry.tsx`。
 * `verify.mjs` 先用 rolldown 把它打成一个临时 ESM，再动态 import。
 *
 * 这里只导出「把外壳按某种 mode 渲染成 HTML 字符串」一件事 ——
 * 断言全部在 `verify.mjs` 里（读 HTML 文本，不做像素测量）。
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SectionShell, type SectionShellMode } from '../../../src/renderers/SectionShell.tsx';

/** SSR 入参。 */
export interface SsrShellProps {
	readonly title?: string;
	readonly typeLabel?: string;
	readonly hint?: string;
	readonly body?: string;
}

/**
 * 渲染一个章节外壳。
 *
 * @param mode 三种交互模式之一
 * @param props 可选的内容（默认和产品里 ask 章节一致）
 */
export function renderShell(mode: SectionShellMode, props: SsrShellProps = {}): string {
	return renderToStaticMarkup(
		createElement(SectionShell, {
			index: 1,
			title: props.title ?? '需要回答的问题',
			typeLabel: props.typeLabel ?? '选项',
			mode,
			...(props.hint === undefined ? {} : { hint: props.hint }),
			sectionId: 'question',
			kind: 'ask',
			children: createElement('div', { className: 'tb3-ssr-body' }, props.body ?? '正文'),
		}),
	);
}
