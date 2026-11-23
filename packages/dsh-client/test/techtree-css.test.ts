/**
 * `pure/techtree-css.ts` —— 科技树 CSS 的**唯一真值**。
 *
 * ## 这个测试存在的唯一目的：防止「又变成两份」
 *
 * 历史（`2026-11-20`）：这份 CSS 曾经在两个文件里各复制一份 ——
 * `src/styles.ts`（产品注入用）和 `src/renderers/TechTree.tsx`（组件自注入用），
 * 因为 `styles.ts` 不能 import `.tsx`（`node --test` 跑 TS 源码时不认 `.tsx`）。
 *
 * 两份复制的问题不是难看，是**改了不会被任何测试发现**：
 * 预览用组件那份、产品用 `styles.ts` 那份，会静默不一致。
 *
 * 现在抽成纯 `.ts`，两处都 import 它 ⇒ 物理上不可能漂移。
 * 下面的断言钉住「`styles.ts` 拿到的是同一份」，而不是「内容一样」——
 * 前者连漂移的**可能**都没有，后者还得有人去比。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TECHTREE_CSS as FROM_PURE } from '../src/pure/techtree-css.ts';
import { TECHTREE_CSS as FROM_STYLES } from '../src/styles.ts';

void test('styles.ts 与 pure/techtree-css.ts 是同一份真值（不是复制）', () => {
	// 严格相等：不只内容一样，是同一个字符串值；谁改了另一处都会在这里红。
	assert.equal(FROM_STYLES, FROM_PURE);
});

void test('TECHTREE_CSS 非空，且关键规则在（不是空壳骗过相等）', () => {
	assert.ok(FROM_PURE.length > 4000, `CSS 太短（${FROM_PURE.length}），可能被截断`);

	// 挑三条「行为契约」级的规则，删掉任何一条都会让功能明显坏掉。
	for (const rule of [
		'.tb3t-edge.is-dim{opacity:0.25}', // 用户 2026-11-19：hover 时无关的边淡到 25%
		'.tb3t-card.is-draft{border-color:transparent;box-shadow:none}', // 用户 2026-11-10：草稿无边框
		'.tb3t-links{position:absolute;z-index:1;left:0;pointer-events:none;overflow:visible}', // 线层不吃鼠标事件
	]) {
		assert.ok(FROM_PURE.includes(rule), `缺少关键规则：${rule}`);
	}
});

void test('CSS 里没有反引号（模板字符串会被提前截断）', () => {
	// 这个文件自己是模板字符串。以前就有过「注释里写反引号」导致
	// 字符串提前结束、tsc 报 TS1005 的事故。这里从产物侧兜一层。
	assert.ok(!FROM_PURE.includes('`'), 'CSS 里出现了反引号 —— 会把外层模板字符串截断');
});
