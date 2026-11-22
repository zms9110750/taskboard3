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

	it('⚠ 重复注册 ⇒ 抛错（用户 2026-11-22：一个 type 只能有一个提供者）', () => {
		const registry = createActionTextRegistry();
		registry.register('x', () => '第一版');
		assert.throws(
			() => { registry.register('x', () => '第二版'); },
			/重复注册/,
		);
		/* 抛错后原来的还在，没被覆盖。 */
		assert.equal(textOfAction({ $type: 'x' }, registry), '第一版');
	});

	it('空白 type ⇒ 抛错', () => {
		const registry = createActionTextRegistry();
		assert.throws(() => { registry.register('   ', () => ''); }, /不能是空白/);
	});

	it('seed 里的重复 type 也抛错（启动时就不允许抢）', () => {
		assert.throws(
			() => createActionTextRegistry([['dup', () => 'a'], ['dup', () => 'b']]),
			/重复注册/,
		);
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

/* ══════════════════════════════════════════════════════════
   降级函数进注册表（用户 2026-11-22）

   > 「分发器写了逻辑。但是找不到注册的渲染器，降级的降级渲染器应该是组件。
   >   UI 和 tool 的两边都应该如此。」
   ══════════════════════════════════════════════════════════ */

describe('降级函数是注册表的一等公民（不是硬编码）', () => {
	it('默认降级函数存在，且行为 = JSON 格式化', () => {
		const registry = createActionTextRegistry();
		assert.equal(registry.fallback()({ $type: 'x', a: 1 }), '{"$type":"x","a":1}');
	});

	it('⭐ 证明题：setFallback 后，未注册 $type 的输出跟着换', () => {
		const registry = createActionTextRegistry();
		registry.register('text', () => '正文');

		/* 换之前：走默认降级 = JSON */
		assert.equal(
			textOfAction({ $type: 'rating', stars: 4 }, registry),
			JSON.stringify({ $type: 'rating', stars: 4 }),
		);

		registry.setFallback((payload) => `＜未注册的动作：${String(payload['$type'])}＞`);

		/* 换之后：同一个 payload，输出变了 —— 这就是「不是硬编码」的证明。 */
		assert.equal(textOfAction({ $type: 'rating', stars: 4 }, registry), '＜未注册的动作：rating＞');
		/* 已注册的 type 不受影响（降级函数只作用于「查不到」那条路径）。 */
		assert.equal(textOfAction({ $type: 'text', value: 'x' }, registry), '正文');
	});

	it('⭐ 证明题：没有 $type 的 payload 也走降级函数（不是另一条硬编码）', () => {
		const registry = createActionTextRegistry();
		registry.setFallback(() => '（没有类型）');
		assert.equal(textOfAction({ value: 'x' }, registry), '（没有类型）');
		assert.equal(textOfAction({ a: 1, b: 2 }, registry), '（没有类型）');
	});

	it('构造时可以给降级函数（省略 = 内置 JSON）', () => {
		const custom = createActionTextRegistry([], () => '构造时给的');
		assert.equal(textOfAction({ $type: 'nope' }, custom), '构造时给的');

		const builtin = createActionTextRegistry([]);
		assert.equal(textOfAction({ $type: 'nope' }, builtin), JSON.stringify({ $type: 'nope' }));
	});

	it('⚠ 重复 setFallback ⇒ 抛错（降级函数也只有一个提供者）', () => {
		const registry = createActionTextRegistry();
		registry.setFallback(() => '第一版');
		assert.throws(() => { registry.setFallback(() => '第二版'); }, /降级函数已经设置过/);
		/* 抛错后原来的还在，没被覆盖。 */
		assert.equal(textOfAction({ $type: 'nope' }, registry), '第一版');
	});

	it('⚠ 构造时给了降级函数 ⇒ 再 setFallback 也抛（不能让构造和运行时各说一个）', () => {
		const registry = createActionTextRegistry([], () => '构造时给的');
		assert.throws(() => { registry.setFallback(() => '运行时给的'); }, /降级函数已经设置过/);
		assert.equal(textOfAction({ $type: 'nope' }, registry), '构造时给的');
	});

	it('fallback() 永远有值（未设置时返回内置默认）', () => {
		const registry = createActionTextRegistry();
		assert.equal(typeof registry.fallback(), 'function');
	});

	it('渲染器表本身不受 setFallback 影响（不会凭空多出 type）', () => {
		const registry = createActionTextRegistry([['a', () => 'A']]);
		registry.setFallback(() => '兜底');
		assert.deepEqual(registry.types(), ['a']);
		assert.equal(registry.has('b'), false);
	});
});
