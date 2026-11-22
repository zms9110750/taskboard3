/**
 * `renderers/create/create-css.ts` —— 建卡页 CSS 的**唯一真值**。
 *
 * ## 这个测试存在的唯一目的：钉住「CSS 跟着组件走，且只有一份」
 *
 * 用户要求：**CSS 必须跟着组件走**。历史上 40 个组件的样式全堆在
 * `src/styles.ts`（1600 行、7 个巨型字符串常量），组件文件里只有类名字符串 ——
 * 改了组件要去另一个文件里找对应规则，改了 CSS 也不知道它属于谁。
 *
 * 现在建卡页那段（前缀 `tb3cc-`）的真值搬到了组件目录
 * `src/renderers/create/create-css.ts`，`styles.ts` 只 import + 转发。
 *
 * 下面的断言钉的是「`styles.ts` 拿到的是**同一份**」，而不是「内容一样」：
 * 前者连漂移的**可能**都没有，后者还得有人去比。
 *
 * ## ⚠ 为什么真值是纯 `.ts` 而不是 `.tsx`
 *
 * `node --test` 直接跑 TS 源码（AGENTS 规则 6），Node 的类型剥离只认 `.ts`；
 * `styles.ts` 一旦 import `.tsx` 就会 `ERR_UNKNOWN_FILE_EXTENSION`。
 * 这一点和 `pure/techtree-css.ts` 是同一个理由。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CREATE_CSS as FROM_CREATE } from '../src/renderers/create/create-css.ts';
import { CREATE_CSS as FROM_STYLES } from '../src/styles.ts';

void test('styles.ts 与 renderers/create/create-css.ts 是同一份真值（不是复制）', () => {
	// 严格相等：不只内容一样，是同一个字符串值；谁改了另一处都会在这里红。
	assert.equal(FROM_STYLES, FROM_CREATE);
});

void test('CREATE_CSS 非空，且关键规则在（不是空壳骗过相等）', () => {
	assert.ok(
		FROM_CREATE.length > 15000,
		`CSS 太短（${FROM_CREATE.length}），可能被截断`,
	);

	// 挑三条「行为契约」级的规则，删掉任何一条都会让建卡页明显坏掉。
	for (const rule of [
		// flex 子元素 min-height:auto 的坑 —— 少了这条整页会滚、顶栏底栏跟着滚走
		'.tb3cc-page__body{',
		// 建卡页填满父容器（不是 position:fixed 铺满浏览器）
		'container-type:size',
		// 容器查询：窄容器下的单栏布局
		'@container tb3cc (max-width: 700px)',
	]) {
		assert.ok(FROM_CREATE.includes(rule), `缺少关键规则：${rule}`);
	}
});

void test('CSS 里没有反引号（模板字符串会被提前截断）', () => {
	// 这个文件自己是模板字符串。以前就有过「注释里写反引号」导致
	// 字符串提前结束、tsc 报 TS1005 的事故。这里从产物侧兜一层。
	assert.ok(
		!FROM_CREATE.includes('`'),
		'CSS 里出现了反引号 —— 会把外层模板字符串截断',
	);
});
