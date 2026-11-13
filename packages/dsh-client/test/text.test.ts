/**
 * `pure.ts` 里**剩余纯函数**的测试（`pure.test.ts` 覆盖合并/初始化，这里只补文本提取）。
 *
 * ## `extractText` 为什么值得单测
 *
 * 它把 action payload 转成可显示文字。写错的表现是：
 *   · 返回空串 ⇒ 章节显示「（空）」，但数据其实是有的
 *   · 返回 `[object Object]` ⇒ 界面上出现垃圾
 *   · 返回一坨 JSON ⇒ 看起来像数据坏了
 *
 * 三种都不报错。所以形状表必须钉住。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractText } from '../src/pure.ts';

describe('extractText —— action payload → 纯文本', () => {
	it('text 的 payload', () => {
		assert.equal(extractText({ $type: 'text', value: '去查 X 怎么实现' }), '去查 X 怎么实现');
	});

	it('markdown 的 payload（同样是 value）', () => {
		assert.equal(extractText({ $type: 'markdown', value: '# 标题' }), '# 标题');
	});

	it('裸字符串原样返回', () => {
		assert.equal(extractText('直接是字符串'), '直接是字符串');
	});

	it('ask 的 payload：标题 + 选项', () => {
		const text = extractText({
			$type: 'ask',
			title: '选一个方向',
			case: ['方案 A', '方案 B'],
		});
		assert.ok(text.includes('选一个方向'), `实际：${text}`);
		assert.ok(text.includes('方案 A'), `实际：${text}`);
		assert.ok(text.includes('方案 B'), `实际：${text}`);
	});

	it('ask 的 options 字段也认', () => {
		const text = extractText({ title: '选', options: ['A'] });
		assert.ok(text.includes('选'));
		assert.ok(text.includes('A'));
	});

	it('空 payload 返回空串', () => {
		assert.equal(extractText(null), '');
		assert.equal(extractText(undefined), '');
		assert.equal(extractText({}), '');
	});

	it('数字 / 布尔返回空串（不 stringify 成垃圾）', () => {
		assert.equal(extractText(42), '');
		assert.equal(extractText(true), '');
	});

	it('不认识的形状返回空串（不出现 [object Object]）', () => {
		const text = extractText({ 未知字段: { 嵌套: 1 } });
		assert.equal(text, '');
		assert.equal(text.includes('[object'), false);
	});

	it('数组返回空串', () => {
		assert.equal(extractText([1, 2, 3]), '');
	});

	it('value 是对象时走 ask 分支或返回空（不 stringify 对象）', () => {
		const text = extractText({ value: { nested: true } });
		assert.equal(text.includes('[object'), false);
	});
});
