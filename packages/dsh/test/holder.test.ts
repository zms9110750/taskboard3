/**
 * `holderOf` 的测试。
 *
 * 四种情况各自对应一条**回落路径**，每一条都有真实场景：
 *
 * | 情况 | 场景 |
 * |---|---|
 * | 有名字 | 正常：agent 在 subagent 树里（`lead` / `reviewer/checker`） |
 * | `namesOf` 抛错 | agent 是独立会话，不在任何 subagent 树里 |
 * | `agent` 缺席 | 工具被程序化调用（不经模型），如 workflow / 测试 |
 * | `subagents` 为 `undefined` | 单 agent profile，没装 subagent 服务 |
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { holderOf, type SubagentsLike } from '../src/holder.ts';

/** 造一个 `namesOf` 返回指定名字的 subagents 替身。 */
function stubSubagents(self: string): SubagentsLike & { readonly calls: unknown[] } {
	const calls: unknown[] = [];
	return {
		calls,
		namesOf(agent: unknown) {
			calls.push(agent);
			return { self };
		},
	};
}

/** 造一个 `namesOf` 抛错的 subagents 替身（agent 不在树里）。 */
function throwingSubagents(message = 'AGENT_NOT_IN_TREE'): SubagentsLike {
	return {
		namesOf() {
			throw new Error(message);
		},
	};
}

/** 造一份 `exec`。 */
function execWith(id: string): { readonly agent: { readonly id: string } } {
	return { agent: { id } };
}

describe('holderOf', () => {
	it('agent 在 subagent 树里 ⇒ 用名字', () => {
		const subagents = stubSubagents('reviewer/checker');
		const holder = holderOf(subagents, execWith('uuid-1'));
		assert.equal(holder, 'reviewer/checker');
		/* 传给 namesOf 的是 agent 本身（不是 id 字符串）。 */
		assert.deepEqual(subagents.calls, [{ id: 'uuid-1' }]);
	});

	it('namesOf 抛错 ⇒ 回落 agent.id', () => {
		const holder = holderOf(throwingSubagents(), execWith('uuid-2'));
		assert.equal(holder, 'uuid-2');
	});

	it('agent 缺席 ⇒ unknown', () => {
		assert.equal(holderOf(stubSubagents('lead'), {}), 'unknown');
		assert.equal(holderOf(stubSubagents('lead'), undefined), 'unknown');
		assert.equal(holderOf(stubSubagents('lead'), null), 'unknown');
	});

	it('agent 存在但没有 id：名字优先（namesOf 能答就用它）', () => {
		/*
		 * `{ agent: {} }` 不是「缺席」—— agent 对象在，只是缺 id。
		 * 此时若 `namesOf` 能给出名字，那个名字是真实的 ⇒ 用它。
		 * 只有 `namesOf` 也给不出时，才因为没有 id 而回落 `'unknown'`。
		 */
		assert.equal(holderOf(stubSubagents('lead'), { agent: {} }), 'lead');
		assert.equal(holderOf(throwingSubagents(), { agent: {} }), 'unknown');
	});

	it('subagents 为 undefined ⇒ 回落 agent.id', () => {
		assert.equal(holderOf(undefined, execWith('uuid-3')), 'uuid-3');
	});

	it('subagents 形状不对（没有 namesOf）⇒ 回落 agent.id', () => {
		assert.equal(holderOf({}, execWith('uuid-4')), 'uuid-4');
		assert.equal(holderOf({ namesOf: '不是函数' }, execWith('uuid-4')), 'uuid-4');
		assert.equal(holderOf('字符串', execWith('uuid-4')), 'uuid-4');
	});

	it('不编名字：拿不到真标识时统一回落，不猜', () => {
		/*
		 * 猜名字会让两个不同 agent 撞到同一个 holder —— 那比报错坏。
		 * ⇒ 只认两种来源：namesOf 的 self，或 agent.id。
		 */
		assert.equal(holderOf(undefined, {}), 'unknown');
		assert.equal(holderOf(throwingSubagents(), { agent: { id: '' } }), 'unknown');
	});
});
