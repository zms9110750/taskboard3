/**
 * `ask` 交互规则的纯逻辑测试。
 *
 * 覆盖 `askPatchOf` / `applyAskAction` —— 单选互斥、`custom_active`、
 * 「未选择必须删 `picked` 字段」这几条契约。
 *
 * 契约来源：taskboard2 `docs/02-action.md:488-500`。
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
	it('单选：新选中替换旧的', () => {
		const group = groupOf(payloadOf(['A', 'B'], { picked: ['A'] }));
		const patch = askPatchOf(group, { type: 'pick', label: 'B' });
		assert.deepEqual(patch['picked'], ['B']);
		assert.equal(patch['custom_active'], false);
	});

	it('多选：新选中追加', () => {
		const group = groupOf(payloadOf(['A', 'B'], { multi_select: true, picked: ['A'] }));
		const patch = askPatchOf(group, { type: 'pick', label: 'B' });
		assert.deepEqual(patch['picked'], ['A', 'B']);
	});

	it('多选：再点已选 = 取消', () => {
		const group = groupOf(payloadOf(['A', 'B'], { multi_select: true, picked: ['A', 'B'] }));
		const patch = askPatchOf(group, { type: 'pick', label: 'A' });
		assert.deepEqual(patch['picked'], ['B']);
	});

	it('单选 pick 会取消自填行', () => {
		const group = groupOf(payloadOf(['A'], { picked: [], custom_active: true }));
		const patch = askPatchOf(group, { type: 'pick', label: 'A' });
		assert.equal(patch['custom_active'], false);
	});
});

describe('askPatchOf · clear', () => {
	it('未选择 = 删 picked 字段（不是空数组）', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'] }));
		const patch = askPatchOf(group, { type: 'clear' });
		assert.ok('picked' in patch);
		assert.equal(patch['picked'], undefined);
		assert.equal(patch['custom_active'], false);
	});

	it('clear 不动 custom 文字', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'], custom: ['自己写的'] }));
		const patch = askPatchOf(group, { type: 'clear' });
		assert.ok(!('custom' in patch));
	});
});

describe('askPatchOf · custom-toggle', () => {
	it('单选：选中自填 ⇒ 清掉选项', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'] }));
		const patch = askPatchOf(group, { type: 'custom-toggle' });
		assert.equal(patch['custom_active'], true);
		assert.deepEqual(patch['picked'], []);
	});

	it('单选：再点一次 ⇒ 取消自填', () => {
		const group = groupOf(payloadOf(['A'], { picked: [], custom_active: true }));
		const patch = askPatchOf(group, { type: 'custom-toggle' });
		assert.equal(patch['custom_active'], false);
	});

	it('多选：不自填不碰 picked（可以共存）', () => {
		const group = groupOf(payloadOf(['A'], { multi_select: true, picked: ['A'] }));
		const patch = askPatchOf(group, { type: 'custom-toggle' });
		assert.equal(patch['custom_active'], true);
		assert.ok(!('picked' in patch));
	});
});

describe('askPatchOf · custom-input', () => {
	it('输入即选中，且单选组清掉选项', () => {
		const group = groupOf(payloadOf(['A'], { picked: ['A'] }));
		const patch = askPatchOf(group, { type: 'custom-input', text: '自己写的' });
		assert.deepEqual(patch['custom'], ['自己写的']);
		assert.equal(patch['custom_active'], true);
		assert.deepEqual(patch['picked'], []);
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
		const group = groupOf(next);
		assert.equal(group.pickedState, 'unset');
		assert.ok(!('picked' in ((next as { items: Record<string, unknown>[] }).items[0] ?? {})));
	});

	it('自填：custom 存文字，customActive 为真', () => {
		const next = applyAskAction(payloadOf(['A']), 0, { type: 'custom-input', text: 'hi' });
		const group = groupOf(next);
		assert.deepEqual(group.custom, ['hi']);
		assert.equal(group.customActive, true);
	});

	it('单选：先选 A 再点自填 ⇒ A 不再选中', () => {
		let payload = applyAskAction(payloadOf(['A', 'B']), 0, { type: 'pick', label: 'A' });
		payload = applyAskAction(payload, 0, { type: 'custom-toggle' });
		const group = groupOf(payload);
		assert.equal(group.customActive, true);
		assert.equal(group.pickedState, 'none');
	});

	it('形状不对时原样返回', () => {
		const bad = { $type: 'ask' };
		assert.equal(applyAskAction(bad, 0, { type: 'clear' }), bad);
	});
});
