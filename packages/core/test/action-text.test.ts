/**
 * `ActionTextRegistry` —— 「action payload → tool 文字」的分发器。
 *
 * 用户 2026-11-22：
 * > 「渲染器有两部分。一部分在 ui 上面。一部分，多出来的 action，
 * >   翻译为 tool 的文字，这个也是渲染器。也要有分发器。有分发器吗？」
 *
 * UI 那一半是 `dsh-client/src/render-registry.ts`；
 * 这一半是 `core/src/action-text.ts`。两边结构相同：
 *
 * ```
 * payload.$type
 *     ↓ 查表
 * ActionTextFn(payload) → string
 *     ↓ 查不到
 * JSON.stringify（兜底）
 * ```
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	DEFAULT_ACTION_TEXT,
	createActionTextRegistry,
	textOfAction,
	type ActionTextFn,
} from '../src/action-text.ts';

describe('内置三件（text / markdown / ask）', () => {
	it('text：原样输出 value', () => {
		assert.equal(textOfAction({ $type: 'text', value: '正文内容' }), '正文内容');
	});

	it('markdown：原样输出源码（不渲染、不剥标记）', () => {
		assert.equal(textOfAction({ $type: 'markdown', value: '# 标题' }), '# 标题');
	});

	it('ask：问题、选项、已选、状态', () => {
		const text = textOfAction({
			$type: 'ask',
			items: [
				{
					header: '选一个',
					question: '你要哪个？',
					multi_select: true,
					options: [
						{ label: 'A', description: '第一个' },
						{ label: 'B' },
					],
					picked: ['A'],
				},
			],
		});
		assert.match(text, /选一个/);
		assert.match(text, /你要哪个？/);
		assert.match(text, /可多选/);
		assert.match(text, /1\. A — 第一个/);
		assert.match(text, /2\. B/);
		assert.match(text, /已选：A/);
	});

	it('ask：没选 ⇒ 「状态：未选择」', () => {
		const text = textOfAction({
			$type: 'ask',
			items: [{ question: '选哪个', options: [{ label: 'A' }, { label: 'B' }] }],
		});
		assert.match(text, /状态：未选择/);
	});
});

describe('第三方 action —— 运行时注册', () => {
	it('⚠ 注册后 textOfAction 立刻能翻译（证明是查表，不是硬编码）', () => {
		const registry = createActionTextRegistry();
		const before = textOfAction({ $type: 'rating', stars: 4 }, registry);
		/* 没注册 ⇒ 兜底 JSON。 */
		assert.equal(before, JSON.stringify({ $type: 'rating', stars: 4 }));

		registry.register('rating', (payload: Record<string, unknown>) => `${String(payload['stars'])} 星`);

		const after = textOfAction({ $type: 'rating', stars: 4 }, registry);
		assert.equal(after, '4 星');
	});

	it('注册表能列出已注册的 type', () => {
		const registry = createActionTextRegistry([['foo', () => 'foo']]);
		assert.deepEqual(registry.types(), ['foo']);
		assert.equal(registry.has('foo'), true);
		assert.equal(registry.has('bar'), false);
	});

	it('同名注册覆盖旧的（不是抛错 —— 和 UI 注册表不同）', () => {
		const registry = createActionTextRegistry();
		registry.register('x', () => '第一版');
		registry.register('x', () => '第二版');
		assert.equal(textOfAction({ $type: 'x' }, registry), '第二版');
	});
});

describe('兜底', () => {
	it('未知 $type ⇒ JSON.stringify（不白屏、不猜）', () => {
		const text = textOfAction({ $type: 'unknown-thing', a: 1 });
		assert.equal(text, JSON.stringify({ $type: 'unknown-thing', a: 1 }));
	});

	it('没有 $type ⇒ JSON.stringify', () => {
		const text = textOfAction({ value: 'x' });
		assert.equal(text, JSON.stringify({ value: 'x' }));
	});

	it('非对象 ⇒ 空串', () => {
		assert.equal(textOfAction(null), '');
		assert.equal(textOfAction('string'), '');
		assert.equal(textOfAction(42), '');
	});

	it('DEFAULT_ACTION_TEXT 允许第三方继续注册', () => {
		const fn: ActionTextFn = () => '自定义';
		DEFAULT_ACTION_TEXT.register('__test__', fn);
		assert.equal(textOfAction({ $type: '__test__' }), '自定义');
	});
});
