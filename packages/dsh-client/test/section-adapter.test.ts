/**
 * `pure/section-adapter.ts` 的测试 —— 纯函数，零 DOM、零 React。
 *
 * 适配层只有一件事：**把表里拆开的两个字段合回 `CardSection`**。
 * 但它容易悄悄做多（解析 payload / 用 `text` 字段兜底 / 丢掉 label），
 * 所以每条「不该做的事」都有断言钉着。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sectionInputOf } from '../src/pure/section-adapter.ts';
import { sectionViewOf } from '../src/pure/section.ts';
import type { DetailSection } from '../src/pure/card-detail.ts';

/** 造一个表里的章节。 */
function detail(over: Partial<DetailSection> = {}): DetailSection {
	return {
		id: 'goal',
		label: '目标',
		text: '纯文本兜底',
		empty: false,
		payload: { $type: 'text', value: '正文' },
		...over,
	};
}

describe('sectionInputOf —— 形状适配', () => {
	it('id → sectionId（原名，不加前缀）', () => {
		assert.equal(sectionInputOf(detail({ id: 'whyThis' })).sectionId, 'whyThis');
	});

	it('label + payload 合成 CardSection（label 原样，不加工）', () => {
		const input = sectionInputOf(detail({ label: '为什么这么想' }));
		assert.equal(input.section.label, '为什么这么想');
		assert.deepEqual(input.section.payload, { $type: 'text', value: '正文' });
	});

	it('label 为空 ⇒ 保持空串（**不编「正文」**，空标题由组件决定不画）', () => {
		assert.equal(sectionInputOf(detail({ label: '' })).section.label, '');
	});

	it('payload 是**原对象的引用**（不解析、不深拷贝）', () => {
		const payload = { $type: 'markdown', value: '## 标题' };
		const input = sectionInputOf(detail({ payload }));
		assert.strictEqual(input.section.payload, payload);
	});

	it('**不看** text / empty：text 是空串也不影响 payload 的解析结果', () => {
		const payload = { $type: 'markdown', value: '## 有内容' };
		const input = sectionInputOf(detail({ text: '', empty: true, payload }));

		const view = sectionViewOf(input.section.payload);
		assert.equal(view.kind, 'markdown');
		assert.equal(view.kind === 'markdown' ? view.source : '', '## 有内容');
	});

	it('未知 $type 原样交给 Section 降级（适配层不猜成文本）', () => {
		const input = sectionInputOf(detail({ payload: { $type: 'third-party', data: 1 } }));
		assert.equal(sectionViewOf(input.section.payload).kind, 'unknown');
	});
});
