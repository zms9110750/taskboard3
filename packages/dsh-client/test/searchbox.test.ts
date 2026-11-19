/**
 * `pure/search-box.ts` 的测试 —— **纯函数，零 DOM、零 mock**。
 *
 * ## 为什么能测这些
 *
 * 「空输入 / 纯空格不提交」「提交参数 trim 过」「disabled 时按钮不可点」
 * 三条判决全部在纯函数里（组件 `SearchBox.tsx` 只调它们），
 * ⇒ 不需要浏览器就能直接断言，也不会出现「按钮亮着但提交空串」这种不一致。
 *
 * ⚠ 这正是 `AGENTS.md` 规则 6 要的形态：测试 import `../src/` 源码，不 import `lib/`。
 *
 * 用户 `2026-11-19` 原话：
 * > 「加一个按钮。为搜索框加一个框内图标。别的组件框架都提供这种插槽的。
 * >  你应该知道框内图标长啥样。」
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_SEARCH_PLACEHOLDER, canSubmitOf, submitQueryOf } from '../src/pure/search-box.ts';

describe('submitQueryOf —— 提交参数 = trim 过的值', () => {
	it('前后空格被去掉', () => {
		assert.equal(submitQueryOf('  K-1024  '), 'K-1024');
	});

	it('中间的空格保留（只 trim 两端）', () => {
		assert.equal(submitQueryOf('  K 1024  '), 'K 1024');
	});

	it('空串 ⇒ null', () => {
		assert.equal(submitQueryOf(''), null);
	});

	it('纯空格 ⇒ null', () => {
		assert.equal(submitQueryOf('   '), null);
	});

	it('混合空白（Tab / 换行 / 回车）⇒ null', () => {
		assert.equal(submitQueryOf('\t\n  \r'), null);
	});

	it('全角空格 ⇒ null（`String.prototype.trim` 会去掉 U+3000）', () => {
		assert.equal(submitQueryOf('\u3000\u3000'), null);
	});

	it('trim 幂等', () => {
		const once = submitQueryOf('  a  ');
		assert.notEqual(once, null);
		assert.equal(submitQueryOf(once ?? ''), 'a');
	});
});

describe('canSubmitOf —— 按钮能不能点 / 回车会不会提交', () => {
	it('空输入 ⇒ false', () => {
		assert.equal(canSubmitOf('', false), false);
	});

	it('纯空格 ⇒ false（trim 后为空）', () => {
		assert.equal(canSubmitOf('   ', false), false);
	});

	it('有内容 ⇒ true', () => {
		assert.equal(canSubmitOf('K-1024', false), true);
	});

	it('前后有空格但有内容 ⇒ true', () => {
		assert.equal(canSubmitOf('  K-1024  ', false), true);
	});

	it('⭐ disabled 压过内容 ⇒ false（即使输入框里有字也不提交）', () => {
		assert.equal(canSubmitOf('K-1024', true), false);
	});

	it('disabled + 纯空格 ⇒ false', () => {
		assert.equal(canSubmitOf('   ', true), false);
	});
});

describe('DEFAULT_SEARCH_PLACEHOLDER', () => {
	it('文案里提到「回车」（用户描述里那句的落点）', () => {
		assert.match(DEFAULT_SEARCH_PLACEHOLDER, /回车/);
	});

	it('不是空串', () => {
		assert.ok(DEFAULT_SEARCH_PLACEHOLDER.length > 0);
	});
});
