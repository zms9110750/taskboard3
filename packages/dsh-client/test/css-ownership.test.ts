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
 * src/renderers/section-css.ts            SECTION_CSS（markdown / 降级 JSON）
 * src/renderers/section-shell-css.ts      SECTION_SHELL_CSS（章节外壳 + ask 控件）
 * src/renderers/fallback-css.ts           FALLBACK_CSS
 * src/renderers/create/create-css.ts      CREATE_CSS
 * src/renderers/create/create-shell-css.ts CREATE_SHELL_CSS
 * src/renderers/workspace/card-action-css.ts CARD_ACTION_CSS
 * src/renderers/sibling-groups-css.ts     SIBLING_GROUPS_CSS
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
import { CARD_ACTION_CSS as CARD_ACTION_FROM_NEW } from '../src/renderers/workspace/card-action-css.ts';
import { DERIVE_MENU_CSS as DERIVE_MENU_FROM_NEW } from '../src/renderers/derive-menu-css.ts';
import { DRAWER_CSS as DRAWER_FROM_NEW } from '../src/renderers/drawer-css.ts';
import { FALLBACK_CSS as FALLBACK_FROM_NEW } from '../src/renderers/fallback-css.ts';
import { SEARCHBOX_CSS as SEARCHBOX_FROM_NEW } from '../src/renderers/searchbox-css.ts';
import { SECTION_CSS as SECTION_FROM_NEW } from '../src/renderers/section-css.ts';
import { SECTION_SHELL_CSS as SECTION_SHELL_FROM_NEW } from '../src/renderers/section-shell-css.ts';
import { SIBLING_GROUPS_CSS as SIBLING_GROUPS_FROM_NEW } from '../src/renderers/sibling-groups-css.ts';
import { STATUS_BUTTON_CSS as STATUS_BUTTON_FROM_NEW } from '../src/renderers/status-button-css.ts';
import {
	CARD_ACTION_CSS as CARD_ACTION_FROM_STYLES,
	CREATE_CSS as CREATE_FROM_STYLES,
	CREATE_SHELL_CSS as CREATE_SHELL_FROM_STYLES,
	DERIVE_MENU_CSS as DERIVE_MENU_FROM_STYLES,
	DRAWER_CSS as DRAWER_FROM_STYLES,
	FALLBACK_CSS as FALLBACK_FROM_STYLES,
	SEARCHBOX_CSS as SEARCHBOX_FROM_STYLES,
	SECTION_CSS as SECTION_FROM_STYLES,
	SECTION_SHELL_CSS as SECTION_SHELL_FROM_STYLES,
	SIBLING_GROUPS_CSS as SIBLING_GROUPS_FROM_STYLES,
	STATUS_BUTTON_CSS as STATUS_BUTTON_FROM_STYLES,
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

void test('styles.ts 与组件目录里的是同一份（SECTION_SHELL_CSS）', () => {
	assert.equal(SECTION_SHELL_FROM_STYLES, SECTION_SHELL_FROM_NEW);
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

void test('styles.ts 与组件目录里的是同一份（CARD_ACTION_CSS）', () => {
	assert.equal(CARD_ACTION_FROM_STYLES, CARD_ACTION_FROM_NEW);
});

void test('styles.ts 与组件目录里的是同一份（SIBLING_GROUPS_CSS）', () => {
	assert.equal(SIBLING_GROUPS_FROM_STYLES, SIBLING_GROUPS_FROM_NEW);
});

void test('styles.ts 与组件目录里的是同一份（STATUS_BUTTON_CSS）', () => {
	assert.equal(STATUS_BUTTON_FROM_STYLES, STATUS_BUTTON_FROM_NEW);
	/* #62：按钮必须有边框 + 可点反馈，不是「圆点 + 文字」 */
	for (const rule of [
		'.tb3w-root .status-button{',
		'border:1px solid var(--status-button-border',
		'.tb3w-root .status-button.is-interactive:hover',
		'.tb3w-root .status-button:focus-visible',
	]) {
		assert.ok(STATUS_BUTTON_FROM_NEW.includes(rule), `缺少关键规则：${rule}`);
	}
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

void test('SECTION_CSS 非空，且关键规则在（只剩 markdown / 降级 JSON）', () => {
	assert.ok(SECTION_FROM_NEW.length > 2000, `CSS 太短（${SECTION_FROM_NEW.length}）`);
	for (const rule of ['.md', '.md pre.md-code', '.payload-box']) {
		assert.ok(SECTION_FROM_NEW.includes(rule), `缺少关键规则：${rule}`);
	}
	/* issue #59 / #60：章节外壳与 ask 已搬走，这里不许再出现（两套样式会漂）。
	 *
	 * ⚠ 判的是**规则**，不是注释：`section-css.ts` 的文件头/段首注释里为了讲清
	 *   "这两套已删"会把 `.section-block` 写成字面量，直接 `includes` 会误伤
	 *   （CI run #48 就是这样挂的）。所以先把 CSS 注释剥掉再查。
	 */
	const sectionRulesOnly = SECTION_FROM_NEW.replace(/\/\*[\s\S]*?\*\//g, '');
	for (const gone of ['.section-block', '.ask-option']) {
		assert.equal(
			sectionRulesOnly.includes(gone),
			false,
			`章节样式应只在 SECTION_SHELL_CSS：${gone}`,
		);
	}
});

void test('SECTION_SHELL_CSS 非空，且三处共用的类都在', () => {
	assert.ok(SECTION_SHELL_FROM_NEW.length > 4000, `CSS 太短（${SECTION_SHELL_FROM_NEW.length}）`);
	for (const rule of [
		'.tb3-sec{',
		'.tb3-sec__head{',
		'.tb3-sec__index{',
		'.tb3-sec__title{',
		'.tb3-sec__type{',
		'.tb3-sec__body{',
		'.tb3-sec--readonly{',
		'.tb3-ask__option{',
		'.tb3-ask__custom{',
	]) {
		assert.ok(SECTION_SHELL_FROM_NEW.includes(rule), `缺少关键规则：${rule}`);
	}
	/* 三种 mode 只影响可交互性 —— readonly 那条不许改变盒子 / 字号 / 颜色 */
	const readonlyRule = SECTION_SHELL_FROM_NEW.slice(
		SECTION_SHELL_FROM_NEW.indexOf('.tb3-sec--readonly{'),
		SECTION_SHELL_FROM_NEW.indexOf('}', SECTION_SHELL_FROM_NEW.indexOf('.tb3-sec--readonly{')),
	);
	for (const visual of ['padding', 'margin', 'border-radius', 'font-size', 'background', 'color']) {
		assert.equal(
			readonlyRule.includes(visual),
			false,
			`.tb3-sec--readonly 不许改视觉属性 ${visual}：${readonlyRule}`,
		);
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
		SECTION_SHELL_CSS: SECTION_SHELL_FROM_NEW,
		FALLBACK_CSS: FALLBACK_FROM_NEW,
		CREATE_CSS: CREATE_FROM_NEW,
		DRAWER_CSS: DRAWER_FROM_NEW,
	};
	for (const [name, css] of Object.entries(all)) {
		assert.ok(!css.includes('`'), `${name} 里出现了反引号`);
	}
});
