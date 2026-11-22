/**
 * 强调色 `--accent` 的**取值来源** —— 防回退到「借 DSH 的 brand-primary」。
 *
 * ## 背景（`2026-11-23`，隔离 profile 实测）
 *
 * 用户看到筛选条（状态 / 类别 / 领域）是**黑字**，问「为什么他们的字是黑的不是蓝色的。
 * css 拼对了吗？工作了吗？」
 *
 * 排查结论：CSS **拼对了、也工作了** ——
 *
 * ```
 * .tb3w-root .filter-box__title{ … color:var(--accent) … }   ← 规则在、选择器匹配、无竞争对手
 * ```
 *
 * 坏的是**变量取值**：原来写
 *
 * ```css
 * --accent: var(--dsw-alias-brand-primary, #2563eb);
 * ```
 *
 * 而 DSH 当前主题把 `--dsw-alias-brand-primary` 定义成 `#0f1115`（近黑，
 * 是它的**文字/主色**，不是强调蓝）⇒ 蓝色 fallback **永远不生效**。
 *
 * 症状指纹：`.filter-box__title` 渲染 `rgb(15, 17, 21)` 黑字，
 * 而它的 hover 规则用 `--accent-strong`（`--dsw-alias-brand-hover` 未定义 ⇒
 * 走 fallback `#1d4ed8`）反而是**蓝**的 —— 同一个控件「静止黑、hover 蓝」。
 *
 * ## 为什么断言「源」而不是只断言「值」
 *
 * 只断言 `--accent` 展开后是蓝的，需要模拟宿主 CSS 变量，测试跑不起来；
 * 而**错误的写法本身**（把 accent 绑到宿主 brand-primary）可以被字符串级检查钉死。
 * 这两条断言一起，既钉住我们自己的设计值，也钉住「不许再借宿主的 brand-primary」。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WORKSPACE_CSS } from '../src/styles.ts';

/** 取出某个自定义属性的声明值（只找 `--x:value;` 这种最简形态）。 */
function customProperty(css: string, name: string): string | undefined {
	const match = new RegExp(`${name}\\s*:\\s*([^;}]+)`).exec(css);
	return match?.[1]?.trim();
}

void test('--accent 是自己的强调蓝 #2563eb（不借宿主变量）', () => {
	assert.equal(customProperty(WORKSPACE_CSS, '--accent'), '#2563eb');
});

void test('--accent-strong 是自己的深一档蓝 #1d4ed8', () => {
	assert.equal(customProperty(WORKSPACE_CSS, '--accent-strong'), '#1d4ed8');
});

void test('--accent 不再引 --dsw-alias-brand-primary（借错源会渲染成黑字）', () => {
	/*
	 * 这是本测试存在的原因：DSH 的 brand-primary 是「主题主色」，
	 * 当前主题里恰好是近黑 #0f1115。把它当强调色 ⇒ 蓝色 fallback 永不生效。
	 */
	assert.equal(
		/--accent\s*:\s*var\(\s*--dsw-alias-brand-primary/.test(WORKSPACE_CSS),
		false,
		'--accent 不许再绑定 --dsw-alias-brand-primary —— 它在 DSH 当前主题里是 #0f1115（黑）',
	);
});

void test('筛选条标题用的是 --accent（用户看到的「状态 / 类别 / 领域」）', () => {
	const rule = /\.filter-box__title\{([^}]*)\}/.exec(WORKSPACE_CSS);
	assert.notEqual(rule, null, '找不到 .filter-box__title 规则');
	assert.match(rule?.[1] ?? '', /color:var\(--accent\)/);
});
