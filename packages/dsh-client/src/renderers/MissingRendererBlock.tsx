/**
 * 「这一章没有渲染器」的**降级渲染器** —— ③ 那条路径的界面。
 *
 * ## 它是渲染器，不是 if 分支（用户 2026-11-22）
 *
 * > 「分发器写了逻辑。但是找不到注册的渲染器，降级的降级渲染器应该是组件。
 * >   UI 和 tool 的两边都应该如此。」
 *
 * ⇒ 它接受 `RendererProps`（和 `TextContent` / `MarkdownContent` / `AskContent`
 *   同一个签名），所以能**直接**注册进 `setFallbackRenderer()`，不需要 adapter。
 *   需要的东西从 `props.section.payload` 现推：`$type` 和 JSON 树。
 *
 * ## 设计要求（`docs/渲染注册表.md` 8.4 节）
 *
 * > 降级块**必须看起来像出问题了**，不能长得像一个正常章节 ——
 * > 否则「没注册」这个事实永远没人发现。
 *
 * ⇒ 三条视觉信号，缺一条就够不着「看起来像出错」：
 *
 * | # | 信号 | 为什么 |
 * |---|---|---|
 * | 1 | 左边一条橙红竖条 | 和 `CardRow` 的未读边框同一套视觉语言 |
 * | 2 | 「⚠」+ 人话 | 用户要知道「这不是内容坏了，是插件缺东西」 |
 * | 3 | **把 `$type` 打出来** | 报 bug 时能直接说「缺的是 table」 |
 *
 * ## 行为（用户 2026-11-22 最终口径）
 *
 * > 「一个折叠栏一个标题，说未注册。然后点击打开以后显示格式化的 json。」
 *
 * ⇒ 头部常驻（⚠ + 标题 + 人话），正文是**折叠栏**，展开才画 JSON 树。
 *
 * ## 为什么里面还要套 JSON
 *
 * ③ 提供**诊断**（哪个 type 缺、这是 bug），④ 提供**内容**（用户仍能读到 payload）。
 * 两者不是二选一 —— 只显示错误信息会让用户看不到数据，
 * 而那是最容易让人以为「数据丢了」的写法。
 *
 * ## ⚠ 只 `console.error` 一次（每 type）
 *
 * 一屏 20 个章节都缺同一个 type，会刷 20 条日志。
 * 去重表在 `reportMissingRenderer()` 里，模块级 `Set`。
 *
 * 但注意：**界面上的错误块每次都画**（不给用户省）——
 * 只有日志去重。用户看到 20 个红块是对的，那本来就有 20 章缺渲染器。
 */

import { useState, type ReactNode } from 'react';

import { jsonPreviewOf } from '../pure/json-preview.ts';
import { payloadTypeOf } from '../pure/section.ts';
import type { RendererProps } from '../render-registry.ts';
import { JsonFallback } from './JsonFallback.tsx';

/**
 * 已报告过的 type（防刷屏）。
 *
 * ⚠ 模块级可变状态。测试要能清 —— 见 `__resetMissingReportsForTest()`。
 */
const REPORTED = new Set<string>();

/**
 * 报一次「缺渲染器」。
 *
 * @param type 缺的 `$type`（空串 = payload 没有 `$type`）
 */
export function reportMissingRenderer(type: string): void {
	const key = type === '' ? '<no-$type>' : type;
	if (REPORTED.has(key)) return;
	REPORTED.add(key);

	if (type === '') {
		console.error(
			'[taskboard3] 有一个章节的 payload 没有 $type，无法判断该用哪个渲染器。' +
				'这是 bug（模板校验没拦住，或卡上的数据被改坏）。面板仍会显示降级 JSON。',
		);
		return;
	}
	console.error(
		`[taskboard3] action「${type}」没有注册渲染器。` +
			'这是 bug（加了新 action 却忘了 registerRenderer）。面板仍会显示降级 JSON。',
	);
}

/**
 * 清空「已报告」表 —— 只给测试用。
 *
 * 不提供的话，测试之间会互相污染（第一个用例报了 text，第二个用例就不再报）。
 */
export function __resetMissingReportsForTest(): void {
	REPORTED.clear();
}

/**
 * 组件属性 —— **就是 `RendererProps`**。
 *
 * 降级块是渲染器，和三个内置内容组件同等待遇 ⇒ 签名必须一样。
 */
export type MissingRendererBlockProps = RendererProps;

/**
 * 缺渲染器的降级块。
 *
 * @param props 见 `MissingRendererBlockProps`
 */
export function MissingRendererBlock(props: MissingRendererBlockProps): ReactNode {
	const payload = props.section.payload;
	const type = payloadTypeOf(payload);
	reportMissingRenderer(type);

	/* 用户：「点击打开以后显示格式化的 json」⇒ 折叠栏，默认收起。 */
	const [open, setOpen] = useState(false);

	const headline =
		type === ''
			? '这一章的 payload 没有 $type，无法判断用哪个渲染器'
			: `这一章没有渲染器：action「${type}」`;

	return (
		<div className="missing-renderer" data-missing-type={type}>
			<div className="missing-renderer__bar" aria-hidden="true" />
			<div className="missing-renderer__head">
				<span className="missing-renderer__icon" aria-hidden="true">
					⚠
				</span>
				<div className="missing-renderer__text">
					<div className="missing-renderer__title">{headline}</div>
					<div className="missing-renderer__hint">
						这是插件 bug，不是你的数据坏了。展开可以看到原始内容。
					</div>
				</div>
			</div>
			<div className="missing-renderer__body">
				<button
					type="button"
					className="ghost-btn missing-renderer__toggle"
					data-json-toggle
					aria-expanded={open}
					onClick={(event) => {
						/* 别让「展开 JSON」顺手把整章点成编辑。 */
						event.stopPropagation();
						setOpen((one) => !one);
					}}
				>
					{open ? '收起原始 JSON ▴' : '展开原始 JSON ▾'}
				</button>
				{open ? (
					/*
					 * ⚠ 用 div 不用 pre —— JsonFallback 渲染的是 div 树，
					 *   pre 里套 div 是非法的 HTML 嵌套（浏览器会自己纠正，
					 *   结果不可预测）。等宽字体由 CSS 的 font-family 给。
					 */
					<div className="payload-box missing-renderer__json" data-missing-json>
						<JsonFallback preview={jsonPreviewOf(payload)} />
					</div>
				) : null}
			</div>
		</div>
	);
}
