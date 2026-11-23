/**
 * 兄弟归组纯逻辑测试。
 *
 * ⚠ 这些是**网络 / 数据边界**的判据（父不一致就不能成组），必须走源码：
 *   `node --test` 直接跑 `.ts`，不依赖构建产物。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	checkGroupMembers,
	collapsedGroupsOf,
	groupLabelOf,
	groupsOfParent,
	hiddenByFoldedGroups,
	nextGroupIdOf,
	parentLookupOf,
	siblingsOf,
	ungroupedSiblings,
	type GroupableCard,
} from '../src/pure/sibling-groups.ts';
import type { TreeGroup } from '../src/pure/ui-state.ts';

const CARDS: readonly GroupableCard[] = Object.freeze([
	{ id: 'A', title: '父 A', parent: null },
	{ id: 'B', title: '子 B', parent: 'A' },
	{ id: 'C', title: '子 C', parent: 'A' },
	{ id: 'D', title: '子 D', parent: 'A' },
	{ id: 'X', title: '根 X', parent: null },
]);

/** 固定 id 的组，便于断言。 */
function groupOf(id: string, memberIds: readonly string[], name?: string): TreeGroup {
	return name === undefined ? { id, memberIds } : { id, name, memberIds };
}

describe('siblingsOf / groupsOfParent', () => {
	it('根卡 = parent 为 null 的那些', () => {
		assert.deepEqual(siblingsOf(CARDS, null).map((c) => c.id), ['A', 'X']);
	});

	it('某父下的兄弟', () => {
		assert.deepEqual(siblingsOf(CARDS, 'A').map((c) => c.id), ['B', 'C', 'D']);
	});

	it('组只按「成员现在真的挂在这个父下」归属（数据被改过时不认脏成员）', () => {
		const groups = [groupOf('g1', ['B', 'C']), groupOf('g2', ['X'])];
		assert.deepEqual(groupsOfParent(CARDS, groups, 'A').map((g) => g.id), ['g1']);
		assert.deepEqual(groupsOfParent(CARDS, groups, null).map((g) => g.id), ['g2']);
	});
});

describe('ungroupedSiblings', () => {
	it('已进组的卡不算未分组', () => {
		const groups = [groupOf('g1', ['B', 'C'])];
		assert.deepEqual(ungroupedSiblings(CARDS, groups, 'A').map((c) => c.id), ['D']);
	});
});

describe('checkGroupMembers（同一父才能成组）', () => {
	it('同父的三张可以', () => {
		assert.equal(checkGroupMembers(CARDS, ['B', 'C', 'D']).ok, true);
	});

	it('两张根卡可以（父都是 null）', () => {
		assert.equal(checkGroupMembers(CARDS, ['A', 'X']).ok, true);
	});

	it('一张都不到 ⇒ 拒', () => {
		const result = checkGroupMembers(CARDS, ['B']);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.message, /至少.*两张/);
	});

	it('★ 不同父 ⇒ 拒（用户 2026-11-24 的作用域规则）', () => {
		const result = checkGroupMembers(CARDS, ['B', 'X']);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.message, /同一个父卡/);
	});

	it('不存在的卡 ⇒ 拒', () => {
		const result = checkGroupMembers(CARDS, ['B', 'NOPE']);
		assert.equal(result.ok, false);
		if (!result.ok) assert.match(result.message, /不存在/);
	});
});

describe('组名与 id', () => {
	it('没名字 ⇒ 显示「组 N」（从 1 起）', () => {
		assert.equal(groupLabelOf(groupOf('g1', ['B']), 0), '组 1');
		assert.equal(groupLabelOf(groupOf('g2', ['C']), 2), '组 3');
	});

	it('有名字 ⇒ 用名字', () => {
		assert.equal(groupLabelOf(groupOf('g1', ['B'], '第一批'), 0), '第一批');
	});

	it('空串名字 ⇒ 当没名字（不显示空行）', () => {
		assert.equal(groupLabelOf(groupOf('g1', ['B'], ''), 1), '组 2');
	});

	it('新 id 不撞已有', () => {
		assert.equal(nextGroupIdOf([]), 'g1');
		assert.equal(nextGroupIdOf([groupOf('g1', []), groupOf('g2', [])]), 'g3');
		assert.equal(nextGroupIdOf([groupOf('g2', [])]), 'g1');
	});
});

describe('折叠的组', () => {
	const groups = [groupOf('g1', ['B', 'C']), groupOf('g2', ['X'])];

	it('折叠的组整组藏起来', () => {
		assert.deepEqual([...hiddenByFoldedGroups(groups, new Set(['g1']))], ['B', 'C']);
	});

	it('没折叠的组不藏', () => {
		assert.equal(hiddenByFoldedGroups(groups, new Set()).size, 0);
	});

	it('collapsedGroupsOf 只给「折叠中且成员在场」的组', () => {
		const collapsed = collapsedGroupsOf(CARDS, groups, new Set(['g1', 'g2']));
		assert.deepEqual(collapsed.map((g) => g.id), ['g1', 'g2']);
		const onlyG1 = collapsedGroupsOf(CARDS, groups, new Set(['g1', 'ghost']));
		assert.deepEqual(onlyG1.map((g) => g.id), ['g1']);
	});
});

describe('parentLookupOf', () => {
	it('不存在的卡返回 undefined（和「根卡 null」区分开）', () => {
		const parentOf = parentLookupOf(CARDS);
		assert.equal(parentOf('A'), null);
		assert.equal(parentOf('B'), 'A');
		assert.equal(parentOf('NOPE'), undefined);
	});
});
