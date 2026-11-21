/**
 * 措辞测试 —— 失败翻译与未读方向。
 *
 * 这两件事看起来是「文案」，其实是**接口**：AI 靠它们决定下一步改什么。
 * 尤其 `describeUnread` 的字段方向（`ai: true` = AI 改过、**用户**待读）
 * 是最容易搞反的地方，必须有断言钉住。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { describeFailure, describeUnread } from '../src/index.ts';

describe('describeFailure', () => {
	it('带 issues 时逐条列出（空 path 翻成「整体」）', () => {
		const text = describeFailure({
			ok: false,
			code: 'CONTENT_INVALID',
			message: '充数不对',
			issues: [
				{ path: '/content/要查什么', message: '必填' },
				{ path: '', message: '整体不对' },
			],
		});
		assert.ok(text.includes('充数不对'), text);
		assert.ok(text.includes('下一步'), text);
		assert.ok(text.includes('/content/要查什么：必填'), text);
		assert.ok(text.includes('(整体)：整体不对'), text);
	});

	it('无 issues 时不出现「具体问题」段', () => {
		const text = describeFailure({ ok: false, code: 'CARD_NOT_FOUND', message: '找不到' });
		assert.ok(!text.includes('具体问题'), text);
	});
});

describe('describeUnread', () => {
	it('四种组合的措辞（字段名说的是「谁改的」，不是「谁没读」）', () => {
		assert.equal(describeUnread({ ai: false, user: false }), '双方都已读');
		assert.equal(describeUnread({ ai: false, user: true }), '用户改过，AI 待读');
		assert.equal(describeUnread({ ai: true, user: false }), 'AI 改过，用户待读');
		assert.equal(describeUnread({ ai: true, user: true }), '双方都有未读');
	});
});
