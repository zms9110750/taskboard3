/**
 * `ask` 交互规则的纯逻辑测试。
 *
 * ⚠ 字段以 **action 架构** 为准：`packages/core/src/template/actions.ts` 的
 * `askItemSchema` —— `header` / `question` / `options` / `multi_select` /
 * `picked` / `custom` / `placeholder`。
 *
 * **没有 `custom_active`**。「自填行选中」在架构里表达成
 * `picked` 里有一个不是任何选项 label 的值（= 被选中的自填文字）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyAskAction, askPatchOf, askSectionOf } from '../src/pure/section.ts';

/** 造一个 ask payload。 */
function payloadOf(options: readonly string[], extra: Readonly<Record<string, unknown>> = {}): unknown {
	return {
		$type: 'ask',
		items: [
			{
				question: '这个卡的目的是什么？',
				options: options.map((label) => ({ label })),
				...extra,
			},
		],
	};
}

/** 取第 0 组的 view。 */
function groupOf(payload: unknown) {
	const view = askSectionOf(payload);
	assert.equal(view.kind, 'ask');
	const group = view.groups[0];
	assert.ok(group !== undefined);
	return group;
}

describe('askPatchOf · pick', () => {
	it('单选：新选中替换旧的，且不写 custom_active', () => {
		const group = groupOf(payloadOf(['A', 'B'], { picked: ['A'] }));
		const patch = askPatchOf(group, { type: 'pick', label: 'B' });
		assert.deepEqual(patch['picked'], ['B']);
		assert.ok(!('custom_active' in patch), '架构里没有 custom_active');
	});

	it('多选：新选中追加', () => {
		const group = groupOf(payloadOf(['A', 'B'], { multi_select: true, picked: ['A'] }));
		assert.deepEqual(askPatchOf(group, { type: 'pick', label: 'B' })['picked'], ['A', 'B']);
	});

	it('多选：再点已选 = 取消', () => {
		const group = groupOf(payloadOf(['A', 'B'], { multi_select: true, picked: ['A', 'B'] }));
		assert.deepEqual(askPatchOf(group, { type: 'pick', label: 'A' })['picked'], ['B']);
	});

	it('单选 pick 会把自填文字挤出 picked（互斥）', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['自己写的'], custom: ['自己写的'] }));
		assert.equal(group.customActive, true);
		const patch = askPatchOf(group, { type: 'pick', label: 'A' });
		assert.deepEqual(patch['picked'], ['A']);
	});
});

describe('askPatchOf · clear', () => {
	it('未选择 = 删 picked 字段（不是空数组）', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'] }));
		const patch = askPatchOf(group, { type: 'clear' });
		assert.ok('picked' in patch);
		assert.equal(patch['picked'], undefined);
	});

	it('clear 不动 custom 文字', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'], custom: ['自己写的'] }));
		assert.ok(!('custom' in askPatchOf(group, { type: 'clear' })));
	});
});

describe('askPatchOf · custom-toggle', () => {
	it('没有自填文字时无法表达选中（返回空补丁）', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'] }));
		assert.deepEqual(askPatchOf(group, { type: 'custom-toggle' }), {});
	});

	it('单选：自填文字进 picked，选项让位', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'], custom: ['自己写的'] }));
		assert.deepEqual(askPatchOf(group, { type: 'custom-toggle' })['picked'], ['自己写的']);
	});

	it('单选：再点一次 ⇒ 删 picked（回到未选择），custom 保留', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['自己写的'], custom: ['自己写的'] }));
		const patch = askPatchOf(group, { type: 'custom-toggle' });
		assert.equal(patch['picked'], undefined);
		assert.ok(!('custom' in patch));
	});

	it('多选：自填文字追加进 picked，选项保留', () => {
		const group = groupOf(payloadOf(['A'], { multi_select: true, picked: ['A'], custom: ['自己写的'] }));
		assert.deepEqual(askPatchOf(group, { type: 'custom-toggle' })['picked'], ['A', '自己写的']);
	});
});

describe('askPatchOf · custom-input', () => {
	it('输入即选中：custom + picked 都写', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'] }));
		const patch = askPatchOf(group, { type: 'custom-input', text: '自己写的' });
		assert.deepEqual(patch['custom'], ['自己写的']);
		assert.deepEqual(patch['picked'], ['自己写的']);
	});

	it('清空文字 ⇒ custom 清空，picked 回到未选择', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['自己写的'], custom: ['自己写的'] }));
		const patch = askPatchOf(group, { type: 'custom-input', text: '' });
		assert.deepEqual(patch['custom'], []);
		assert.equal(patch['picked'], undefined);
	});
});

describe('applyAskAction', () => {
	it('pick 写回 payload', () => {
		const next = applyAskAction(payloadOf(['A', 'B']), 0, { type: 'pick', label: 'B' });
		const group = groupOf(next);
		assert.equal(group.pickedState, 'picked');
		assert.equal(group.options.find((one) => one.label === 'B')?.picked, true);
	});

	it('clear 后 payload 里没有 picked 字段（= unset）', () => {
		const next = applyAskAction(payloadOf(['A'], { picked: ['A'] }), 0, { type: 'clear' });
		assert.equal(groupOf(next).pickedState, 'unset');
		assert.ok(!('picked' in ((next as { items: Record<string, unknown>[] }).items[0] ?? {})));
	});

	it('自填：custom 存文字，customActive 由 picked 派生', () => {
		const next = applyAskAction(payloadOf(['A']), 0, { type: 'custom-input', text: 'hi' });
		const group = groupOf(next);
		assert.deepEqual(group.custom, ['hi']);
		assert.equal(group.customActive, true);
	});

	it('单选：先选 A 再填自填 ⇒ A 不再选中', () => {
		let payload = applyAskAction(payloadOf(['A', 'B']), 0, { type: 'pick', label: 'A' });
		payload = applyAskAction(payload, 0, { type: 'custom-input', text: 'hi' });
		const group = groupOf(payload);
		assert.equal(group.customActive, true);
		assert.equal(group.options.find((one) => one.label === 'A')?.picked, false);
	});

	it('形状不对时原样返回', () => {
		const bad = { $type: 'ask' };
		assert.equal(applyAskAction(bad, 0, { type: 'clear' }), bad);
	});
});
