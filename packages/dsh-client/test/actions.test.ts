/**
 * 按钮 → 动作的映射测试，以及**按钮过滤**的测试。
 *
 * 这两块出错的表现：
 *   · 映射错 ⇒ 点「成功」却发了「取消」（不可逆，最严重）
 *   · 过滤错 ⇒ 不该显示的按钮出现了，点了被服务端拒
 *
 * 断言直接跑 `protocol` 的真实表，不是我们维护的第二份副本。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BUTTON_ACTIONS, TaskState, buttonsOf, isEndedState } from '@taskboard/protocol';

import { isFinishingButton, toCardAction } from '../src/actions.ts';

describe('toCardAction —— 按钮语义 → API 动作', () => {
	it('adopt 映射成 { kind: adopt }', () => {
		const button = BUTTON_ACTIONS.find((one) => one.method === 'adopt');
		assert.ok(button !== undefined, '按钮表里必须有 adopt');
		assert.deepEqual(toCardAction(button), { kind: 'adopt' });
	});

	it('claim 映射成 { kind: claim }', () => {
		const button = BUTTON_ACTIONS.find((one) => one.method === 'claim');
		assert.ok(button !== undefined, '按钮表里必须有 claim');
		assert.deepEqual(toCardAction(button), { kind: 'claim' });
	});

	it('release 映射成 { kind: release }', () => {
		const button = BUTTON_ACTIONS.find((one) => one.method === 'release');
		assert.ok(button !== undefined, '按钮表里必须有 release');
		assert.deepEqual(toCardAction(button), { kind: 'release' });
	});

	it('transition 带上目标状态', () => {
		const button = BUTTON_ACTIONS.find(
			(one) => one.method === 'transition' && one.kind === 'work' && one.to === TaskState.COMPLETED,
		);
		assert.ok(button !== undefined);
		assert.deepEqual(toCardAction(button), { kind: 'transition', to: TaskState.COMPLETED });
	});

	it('每条按钮都能被映射（无遗漏）', () => {
		for (const button of BUTTON_ACTIONS) {
			const action = toCardAction(button);
			assert.ok(typeof action.kind === 'string');
			if (action.kind === 'transition') {
				assert.equal(action.to, button.to);
			}
		}
	});
});

describe('isFinishingButton —— 是否进终结态', () => {
	it('成功 / 失败 / 取消 / 拒绝 都是收尾', () => {
		const ending = BUTTON_ACTIONS.filter((one) => isEndedState(one.to));
		assert.ok(ending.length > 0);
		for (const button of ending) {
			assert.equal(isFinishingButton(button), true, `${button.kind} → ${button.to} 应算收尾`);
		}
	});

	it('采纳 / 领取 / 搁置 不是收尾', () => {
		const proceeding = BUTTON_ACTIONS.filter((one) => !isEndedState(one.to));
		assert.ok(proceeding.length > 0);
		for (const button of proceeding) {
			assert.equal(isFinishingButton(button), false, `${button.kind} → ${button.to} 不算收尾`);
		}
	});
});

describe('buttonsOf —— UI 拿到的按钮清单', () => {
	it('任何人能点的按钮都含 user（用户是唯一能操作 UI 的 actor）', () => {
		for (const button of BUTTON_ACTIONS) {
			assert.ok(button.actors.includes('user'), `${button.kind} ${button.from}→${button.to} 必须可被 user 点`);
		}
	});

	it('草稿目标有「采纳」按钮', () => {
		const labels = buttonsOf('goal', TaskState.UNSPECIFIED, 'user').map((one) => one.label);
		assert.ok(labels.includes('采纳'), `实际：${labels.join('/')}`);
	});

	it('处理中的工作卡有「成功」和「搁置」', () => {
		const labels = buttonsOf('work', TaskState.WORKING, 'user').map((one) => one.label);
		assert.ok(labels.includes('成功'), `实际：${labels.join('/')}`);
		assert.ok(labels.includes('搁置'), `实际：${labels.join('/')}`);
	});

	it('目标在提交态能收尾（成功 / 失败 / 取消）', () => {
		const labels = buttonsOf('goal', TaskState.SUBMITTED, 'user').map((one) => one.label);
		assert.ok(labels.includes('成功'), `实际：${labels.join('/')}`);
		assert.ok(labels.includes('失败'), `实际：${labels.join('/')}`);
		assert.ok(labels.includes('取消'), `实际：${labels.join('/')}`);
	});

	it('结束的工作卡没有可用按钮（终态粘滞）', () => {
		for (const state of [TaskState.COMPLETED, TaskState.FAILED, TaskState.REJECTED] as const) {
			const buttons = buttonsOf('work', state, 'user');
			assert.equal(buttons.length, 0, `work@${state} 不该有按钮`);
		}
	});

	it('AI 拿不到任何到终结态的按钮', () => {
		for (const button of buttonsOf('work', TaskState.SUBMITTED, 'ai')) {
			assert.equal(isEndedState(button.to), false, `AI 不该能 ${button.label}`);
		}
	});

	it('未知类别给空数组（不抛）', () => {
		assert.deepEqual(buttonsOf('不存在的类别', TaskState.SUBMITTED, 'user'), []);
	});
});
