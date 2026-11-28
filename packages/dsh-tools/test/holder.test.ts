/**
 * `holderOf` 的测试。
 *
 * 只认 `namesOf` 给的**名字**；拿不到名字一律 `''`（无 holder）——
 * issue #42 Bug 2 + lead `2026-11-28` 裁定（fail-safe：不猜 UUID）。
 *
 * | 情况 | 期望 | 场景 |
 * |---|---|---|
 * | 有名字 | `lead` / `reviewer/checker` | 正常：agent 在 subagent 树里 |
 * | `namesOf` 抛错 | `''` | agent 是独立会话，不在任何 subagent 树里 |
 * | `namesOf` 返回空串 / self 缺席 | `''` | 名字解析不出来 |
 * | `subagents` 缺席 / 形状不对 | `''` | 单 agent profile，没装 subagent 服务 |
 * | `agent` 缺席 | `''` | 工具被程序化调用（不经模型），如 workflow / 测试 |
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

	it('namesOf 抛错 ⇒ 无 holder（空串，不回落 agent.id）', () => {
		const holder = holderOf(throwingSubagents(), execWith('uuid-2'));
		assert.equal(holder, '');
	});

	it('agent 缺席 ⇒ 无 holder（空串；不编名字）', () => {
		assert.equal(holderOf(stubSubagents('lead'), {}), '');
		assert.equal(holderOf(stubSubagents('lead'), undefined), '');
		assert.equal(holderOf(stubSubagents('lead'), null), '');
	});

	it('agent 存在但没有 id：名字优先（namesOf 能答就用它）', () => {
		/*
		 * `{ agent: {} }` 不是「缺席」—— agent 对象在，只是缺 id。
		 * 名字与 id 无关：namesOf 能答就用名字；答不出就是无 holder。
		 */
		assert.equal(holderOf(stubSubagents('lead'), { agent: {} }), 'lead');
		assert.equal(holderOf(throwingSubagents(), { agent: {} }), '');
	});

	it('subagents 为 undefined ⇒ 无 holder（不猜 UUID）', () => {
		assert.equal(holderOf(undefined, execWith('uuid-3')), '');
	});

	it('subagents 形状不对（没有 namesOf）⇒ 无 holder（不猜 UUID）', () => {
		assert.equal(holderOf({}, execWith('uuid-4')), '');
		assert.equal(holderOf({ namesOf: '不是函数' }, execWith('uuid-4')), '');
		assert.equal(holderOf('字符串', execWith('uuid-4')), '');
	});

	it('namesOf 返回空串 ⇒ 无 holder（issue #42 Bug 2）', () => {
		assert.equal(holderOf(stubSubagents(''), execWith('uuid-5')), '');
	});

	it('namesOf 的 self 缺席（非字符串）⇒ 无 holder', () => {
		const subagents = { namesOf: () => ({}) } as unknown as SubagentsLike;
		assert.equal(holderOf(subagents, execWith('uuid-6')), '');
	});

	it('不猜：拿不到名字就是无 holder，不做 UUID 兜底', () => {
		/*
		 * 猜名字会让两个不同 agent 撞到同一个 holder；
		 * 回落 UUID 则会让卡存进 guard 永远匹配不到的标识。
		 * ⇒ 只认 namesOf 的 self；其余（含 agent 缺席）一律 ''。
		 */
		assert.equal(holderOf(undefined, {}), '');
		assert.equal(holderOf(throwingSubagents(), { agent: { id: '' } }), '');
	});
});
