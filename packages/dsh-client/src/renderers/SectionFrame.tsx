/**
 * `SectionFrame` —— **按注册表选渲染器的入口**。
 *
 * ## 它做什么
 *
 * ```
 * payload.$type
 *    ↓
 * rendererOf(type)
 *    ├── 命中  → <Renderer {...props} />
 *    └── 未命中 → console.error（每 type 一次）+ <MissingRendererBlock>
 *                                            └ 内含 JsonFallback
 * ```
 *
 * 这是 `docs/渲染注册表.md` 里 **③「真渲染到没注册的」** 那一行。
 *
 * ## 为什么不在这里 `throw`
 *
 * `dsh-client` **一个 ErrorBoundary 都没有**（grep 过）。
 * 在渲染路径上 throw ⇒ 整棵 React 树卸载 ⇒ **白屏** ——
 * 而那正好是设计要避免的。
 *
 * ⇒ `console.error` + 可见红块 + JSON 兜底。
 *   **真正的防线是 CI 差集断言**（第 7 步），不是这里的运行时兜底。
 *
 * ## `$type` 缺失也要走 ③
 *
 * `payload.$type` 不是字符串（缺失 / 数字 / 对象）⇒ 没有可查的 key
 * ⇒ 同样进 `MissingRendererBlock`，只是 headline 不同。
 *
 * ⚠ **不猜成 text**。旧版 `payloadKindOf` 有一条「没 $type 但有 value ⇒ text」
 *   的兼容规则，那是给「未校验的模板默认值」用的。
 *   注册表这里**不做那个猜测** —— 缺 `$type` 是数据问题，要让它可见。
 */

import type { ReactNode } from 'react';

import { rendererOf, type RendererProps } from '../render-registry.ts';
import { jsonPreviewOf } from '../pure/json-preview.ts';
import { MissingRendererBlock } from './MissingRendererBlock.tsx';

/**
 * 从 payload 取 `$type`。
 *
 * @param payload 任意 payload
 * @returns `$type` 字符串；缺失或非字符串时返回空串
 */
export function payloadTypeOf(payload: unknown): string {
	if (payload === null || typeof payload !== 'object') return '';
	const type = (payload as Record<string, unknown>)['$type'];
	return typeof type === 'string' ? type : '';
}

/**
 * 一个章节的渲染入口。
 *
 * @param props 见 `RendererProps`
 */
export function SectionFrame(props: RendererProps): ReactNode {
	const type = payloadTypeOf(props.section.payload);

	if (type !== '') {
		const Renderer = rendererOf(type);
		if (Renderer !== undefined) return <Renderer {...props} />;
	}

	/* ③ 真渲染到没注册的（或 $type 缺失）。不 throw，见文件头。 */
	return <MissingRendererBlock type={type} preview={jsonPreviewOf(props.section.payload)} />;
}
