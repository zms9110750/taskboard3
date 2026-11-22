/**
 * CSS 归属 —— 用户 2026-11-22 要求「CSS 必须跟着组件走」。
 *
 * ## 历史
 *
 * 40 个组件的样式曾全堆在 `src/styles.ts`（1600 行、7 个巨型字符串常量），
 * 组件文件里只有类名字符串 —— 改了组件要去另一个文件里找对应规则，
 * 改了 CSS 也不知道它属于谁。
 *
 * ## 现在的形态
 *
 * 一段 CSS 一个文件，放在它所属的组件目录下：
 *
 * ```
 * src/renderers/searchbox-css.ts          SEARCHBOX_CSS
 * src/renderers/section-css.ts            SECTION_CSS
 * src/renderers/fallback-css.ts           FALLBACK_CSS
 * src/renderers/create/create-css.ts      CREATE_CSS
 * src/pure/techtree-css.ts                TECHTREE_CSS
 * src/renderers/drawer-css.ts              DRAWER_CSS
 * src/pure/techtree-css.ts                TECHTREE_CSS
 * ```
 *
 * `styles.ts` 只 import 同一份，再拼进 `injectStyles()`，并**转发 export**
 * 给既有 import 方（测试和组件都从 `styles.ts` 拿）。
 *
 * ## 断言的是「同一份」（相等），不是「内容一样」
 *
 * 前者物理上不可能漂移，后者还得有人去逐字比。
 *
 * ## ⚠ 为什么真值是纯 `.ts` 而不是 `.tsx`
 *
 * `node --test` 直接跑 TS 源码（AGENTS 规则 6），Node 的类型剥离只认 `.ts`；
 * `styles.ts` 一旦 import `.tsx` 就会 `ERR_UNKNOWN_FILE_EXTENSION`。
 * 这一点和 `pure/techtree-css.ts` 是同一个理由。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CREATE_CSS as CREATE_FROM_NEW } from '../src/renderers/create/create-css.ts';
import { CREATE_SHELL_CSS as CREATE_SHELL_FROM_NEW } from '../src/renderers/create/create-shell-css.ts';
import { DERIVE_MENU_CSS as DERIVE_MENU_FROM_NEW } from '../src/renderers/derive-menu-css.ts';
import { DRAWER_CSS as DRAWER_FROM_NEW } from '../src/renderers/drawer-css.ts';
import { FALLBACK_CSS as FALLBACK_FROM_NEW } from '../src/renderers/fallback-css.ts';
import { SEARCHBOX_CSS as SEARCHBOX_FROM_NEW } from '../src/renderers/searchbox-css.ts';
import { SECTION_CSS as SECTION_FROM_NEW } from '../src/renderers/section-css.ts';
import {
	CREATE_CSS as CREATE_FROM_STYLES,
	CREATE_SHELL_CSS as CREATE_SHELL_FROM_STYLES,
	DERIVE_MENU_CSS as DERIVE_MENU_FROM_STYLES,
	DRAWER_CSS as DRAWER_FROM_STYLES,
	FALLBACK_CSS as FALLBACK_FROM_STYLES,
	SEARCHBOX_CSS as SEARCHBOX_FROM_STYLES,
	SECTION_CSS as SECTION_FROM_STYLES,
} from '../src/styles.ts';

/* ══════════════════════════════════════════════════════════
   ① 同一份真值（不是复制）
   ══════════════════════════════════════════════════════════ */

void test('styles.ts 与组件目录里的是同一份（SEARCHBOX_CSS）', () => {
	assert.equal(SEARCHBOX_FROM_STYLES, SEARCHBOX_FROM_NEW);
});

void test('styles.ts 与组件目录里的是同一份（SECTION_CSS）', () => {
	assert.equal(SECTION_FROM_STYLES, SECTION_FROM_NEW);
});

void test('styles.ts 与组件目录里的是同一份（FALLBACK_CSS）', () => {
	assert.equal(FALLBACK_FROM_STYLES, FALLBACK_FROM_NEW);
});

void test('styles.ts 与组件目录里的是同一份（CREATE_CSS）', () => {
	assert.equal(CREATE_FROM_STYLES, CREATE_FROM_NEW);
});

void test('styles.ts 与组件目录里的是同一份（DRAWER_CSS）', () => {
	assert.equal(DRAWER_FROM_STYLES, DRAWER_FROM_NEW);
});

void test('styles.ts 与组件目录里的是同一份（CREATE_SHELL_CSS）', () => {
	assert.equal(CREATE_SHELL_FROM_STYLES, CREATE_SHELL_FROM_NEW);
});

void test('styles.ts 与组件目录里的是同一份（DERIVE_MENU_CSS）', () => {
	assert.equal(DERIVE_MENU_FROM_STYLES, DERIVE_MENU_FROM_NEW);
	assert.ok(
		DERIVE_MENU_FROM_NEW.includes('[data-menu="derive"]'),
		'派生子任务菜单的容器规则要在',
	);
	assert.ok(
		DERIVE_MENU_FROM_NEW.includes('width:280px'),
		'宽度必须 = placeMenu 的 MENU_WIDTH(280)，否则右侧会溢出',
	);
});

/* ══════════════════════════════════════════════════════════
   ② 非空 + 关键规则在（不是空壳骗过相等）
   ══════════════════════════════════════════════════════════ */

void test('SEARCHBOX_CSS 非空，且关键规则在', () => {
	assert.ok(SEARCHBOX_FROM_NEW.length > 800, `CSS 太短（${SEARCHBOX_FROM_NEW.length}）`);
	for (const rule of ['.search-box__field', '.search-box__input', "[data-search-disabled='true']"]) {
		assert.ok(SEARCHBOX_FROM_NEW.includes(rule), `缺少关键规则：${rule}`);
	}
});

void test('SECTION_CSS 非空，且关键规则在', () => {
	assert.ok(SECTION_FROM_NEW.length > 5000, `CSS 太短（${SECTION_FROM_NEW.length}）`);
	for (const rule of ['.section-block', '.ask-option', '.payload-box']) {
		assert.ok(SECTION_FROM_NEW.includes(rule), `缺少关键规则：${rule}`);
	}
});

void test('FALLBACK_CSS 非空，且关键规则在', () => {
	assert.ok(FALLBACK_FROM_NEW.length > 1000, `CSS 太短（${FALLBACK_FROM_NEW.length}）`);
	for (const rule of ['.missing-renderer', '.json-fallback']) {
		assert.ok(FALLBACK_FROM_NEW.includes(rule), `缺少关键规则：${rule}`);
	}
});

void test('CREATE_CSS 非空，且关键规则在', () => {
	assert.ok(CREATE_FROM_NEW.length > 15000, `CSS 太短（${CREATE_FROM_NEW.length}）`);
	for (const rule of [
		/* flex 子元素 min-height:auto 的坑 —— 少了这条整页会滚、顶栏底栏跟着滚走 */
		'.tb3cc-page__body{',
		/* 建卡页填满父容器（不是 position:fixed 铺满浏览器） */
		'container-type:size',
		/* 容器查询：窄容器下的单栏布局 */
		'@container tb3cc (max-width: 700px)',
	]) {
		assert.ok(CREATE_FROM_NEW.includes(rule), `缺少关键规则：${rule}`);
	}
});


/* ══════════════════════════════════════════════════════════
   ③ 模板字符串安全
   ══════════════════════════════════════════════════════════ */

void test('CSS 里没有反引号（会把外层模板字符串截断 ⇒ TS1005）', () => {
	/*
	 * 这些 CSS 都是模板字符串字面量。以前有过「注释里写反引号」导致
	 * 字符串提前结束、tsc 报 TS1005 的事故。这里从产物侧兜一层。
	 */
	const all = {
		SEARCHBOX_CSS: SEARCHBOX_FROM_NEW,
		SECTION_CSS: SECTION_FROM_NEW,
		FALLBACK_CSS: FALLBACK_FROM_NEW,
		CREATE_CSS: CREATE_FROM_NEW,
		DRAWER_CSS: DRAWER_FROM_NEW,
	};
	for (const [name, css] of Object.entries(all)) {
		assert.ok(!css.includes('`'), `${name} 里出现了反引号`);
	}
});
