/**
 * 「这一章没有渲染器」的**错误块** —— ③ 那条路径的界面。
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
 * | 1 | 左边一条橙红竖条 | 和 `CardRow` 的未读边框同一套视觉语言（加粗上色，不画装饰） |
 * | 2 | 「⚠」+ 人话 | 用户要知道「这不是内容坏了，是插件缺东西」 |
 * | 3 | **把 `$type` 打出来** | 报 bug 时能直接说「缺的是 ask」 |
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

import { type ReactNode } from 'react';

import type { JsonPreview } from '../pure/json-preview.ts';
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

/** 组件属性。 */
export interface MissingRendererBlockProps {
	/** 缺渲染器的 `$type`。空串 = payload 里根本没有 `$type`。 */
	readonly type: string;
	/** payload 的描述树（`jsonPreviewOf()` 的产物）。 */
	readonly preview: JsonPreview;
}

/**
 * 缺渲染器的降级块。
 *
 * @param props 见 `MissingRendererBlockProps`
 */
export function MissingRendererBlock(props: MissingRendererBlockProps): ReactNode {
	reportMissingRenderer(props.type);

	const headline =
		props.type === ''
			? '这一章的 payload 没有 $type，无法判断用哪个渲染器'
			: `这一章没有渲染器：action「${props.type}」`;

	return (
		<div className="missing-renderer" data-missing-type={props.type}>
			<div className="missing-renderer__head">
				<span className="missing-renderer__icon">⚠</span>
				<div className="missing-renderer__text">
					<div className="missing-renderer__title">{headline}</div>
					<div className="missing-renderer__hint">
						这是插件 bug，不是你的数据坏了。下面是降级显示的原始内容。
					</div>
				</div>
			</div>
			<div className="missing-renderer__body">
				<JsonFallback preview={props.preview} />
			</div>
		</div>
	);
}
