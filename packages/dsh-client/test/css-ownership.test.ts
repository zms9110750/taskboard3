/**
 * CSS 归属 —— 用户 2026-11-22 要求「CSS 必须跟着组件走」。
 *
 * 历史：40 个组件的样式曾全堆在 src/styles.ts（1600 行、7 个巨型字符串常量），
 * 组件文件里只有类名字符串。现在 SEARCHBOX_CSS / SECTION_CSS 搬到了
 * src/renderers/ 下各自的文件，styles.ts 只 import 同一份再拼进 injectStyles()。
 *
 * 断言的是「同一份」（相等），不是「内容一样」—— 前者物理上不可能漂移，
 * 后者还得有人去逐字比。写法照抄 test/techtree-css.test.ts。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SEARCHBOX_CSS as SEARCHBOX_FROM_NEW } from '../src/renderers/searchbox-css.ts';
import { SECTION_CSS as SECTION_FROM_NEW } from '../src/renderers/section-css.ts';
import {
	SEARCHBOX_CSS as SEARCHBOX_FROM_STYLES,
	SECTION_CSS as SECTION_FROM_STYLES,
} from '../src/styles.ts';

void test('styles.ts 与 renderers/searchbox-css.ts 是同一份真值（不是复制）', () => {
	// styles.ts 转发的是 import 进来的同一个值；谁要是又复制一份，这里就红。
	assert.equal(SEARCHBOX_FROM_STYLES, SEARCHBOX_FROM_NEW);
});

void test('styles.ts 与 renderers/section-css.ts 是同一份真值（不是复制）', () => {
	assert.equal(SECTION_FROM_STYLES, SECTION_FROM_NEW);
});

void test('SEARCHBOX_CSS 非空，且关键规则在（不是空壳骗过相等）', () => {
	assert.ok(SEARCHBOX_FROM_NEW.length > 800, `SEARCHBOX_CSS 太短（${SEARCHBOX_FROM_NEW.length}），可能被截断`);

	for (const rule of [
		'.tb3w-root .search-box__field{',
		'.tb3w-root .search-box__input{',
		"[data-search-disabled='true']",
	]) {
		assert.ok(SEARCHBOX_FROM_NEW.includes(rule), `缺少关键规则：${rule}`);
	}
});

void test('SECTION_CSS 非空，且关键规则在（不是空壳骗过相等）', () => {
	assert.ok(SECTION_FROM_NEW.length > 5000, `SECTION_CSS 太短（${SECTION_FROM_NEW.length}），可能被截断`);

	// 挑四条「行为契约」级的规则：章节外框 / markdown 代码块 / ask 选中态 / 未知类型降级。
	for (const rule of [
		'.tb3w-root .section-block{padding:10px 12px',
		'.tb3w-root .md pre.md-code{',
		'.tb3w-root .ask-option.is-picked{border-color:var(--accent)',
		'.tb3w-root .payload-box{',
	]) {
		assert.ok(SECTION_FROM_NEW.includes(rule), `缺少关键规则：${rule}`);
	}
});

void test('CSS 里没有反引号（模板字符串会被提前截断）', () => {
	// 这两个文件自己是模板字符串。以前有过注释里写反引号导致字符串提前结束、
	// tsc 报 TS1005 的事故；这里从产物侧兜一层。
	for (const [name, css] of [
		['SEARCHBOX_CSS', SEARCHBOX_FROM_NEW],
		['SECTION_CSS', SECTION_FROM_NEW],
	] as const) {
		assert.ok(!css.includes('`'), `${name} 里出现了反引号 —— 会把外层模板字符串截断`);
	}
});
