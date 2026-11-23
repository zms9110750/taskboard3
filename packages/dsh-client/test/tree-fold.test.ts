/**
 * `pure/tree-fold.ts` 的测试。
 *
 * 钉的是用户 `2026-11-24` 定的规则：
 * 三个默认折叠条件、expanded 压过默认判据、折叠是整棵子树、逐层展开、
 * 以及「没有子卡的根卡折不起来」这个必须如实承认的边界。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { badgeCountOf, treeFoldOf, type FoldableNode } from '../src/pure/tree-fold.ts';

/** 造节点：`[id, parent, ended?, unread?]`。 */
function node(id: string, parent: string | null, ended = false, userUnread = false): FoldableNode {
	return { id, parent, ended, userUnread };
}

describe('treeFoldOf：默认判据', () => {
	it('全终结且无未读的父 ⇒ 默认折叠，整棵子树隐藏', () => {
		const nodes = [node('A', null, true), node('B', 'A', true), node('C', 'A', true)];
		const state = treeFoldOf(nodes, [], []);
		assert.equal(state.folded.has('A'), true);
		assert.deepEqual([...state.hidden].sort(), ['B', 'C']);
		assert.deepEqual([...state.visible].sort(), ['A']);
	});

	it('父终结但有一个子卡没终结 ⇒ 不折叠（别把活埋了）', () => {
		const nodes = [node('A', null, true), node('B', 'A', true), node('C', 'A', false)];
		const state = treeFoldOf(nodes, [], []);
		assert.equal(state.folded.has('A'), false);
		assert.equal(state.hidden.size, 0);
	});

	it('父和子都终结，但子树里有用户未读 ⇒ 不折叠', () => {
		const nodes = [node('A', null, true), node('B', 'A', true, true)];
		const state = treeFoldOf(nodes, [], []);
		assert.equal(state.folded.has('A'), false);
	});

	it('自己没终结 ⇒ 不折叠', () => {
		const nodes = [node('A', null, false), node('B', 'A', true)];
		const state = treeFoldOf(nodes, [], []);
		assert.equal(state.folded.has('A'), false);
	});

	it('没有子卡的根卡不可折叠（40 个独立根卡的边界必须如实）', () => {
		const nodes = Array.from({ length: 40 }, (_, index) => node(`R${String(index)}`, null, true));
		const state = treeFoldOf(nodes, [], []);
		assert.equal(state.foldable.size, 0);
		assert.equal(state.folded.size, 0);
		assert.equal(state.hidden.size, 0);
		assert.equal(state.visible.size, 40);
	});
});

describe('treeFoldOf：三态优先级', () => {
	it('expanded 压过默认判据', () => {
		const nodes = [node('A', null, true), node('B', 'A', true)];
		const state = treeFoldOf(nodes, [], ['A']);
		assert.equal(state.folded.has('A'), false);
		assert.equal(state.hidden.size, 0);
	});

	it('expanded 也压过用户显式折叠（最后点的那个赢）', () => {
		const nodes = [node('A', null, true), node('B', 'A', true)];
		const state = treeFoldOf(nodes, ['A'], ['A']);
		assert.equal(state.folded.has('A'), false);
	});

	it('用户显式折叠一个「默认不该折」的节点 ⇒ 折叠生效', () => {
		const nodes = [node('A', null, false), node('B', 'A', false)];
		const state = treeFoldOf(nodes, ['A'], []);
		assert.equal(state.folded.has('A'), true);
		assert.deepEqual([...state.hidden], ['B']);
	});
});

describe('treeFoldOf：逐层展开（VS 那样）', () => {
	it('展开外层后，内层若仍满足默认判据则是折叠的', () => {
		/*  A ── B ── C
		 *        └── D
		 *  A 与 B 都是「全终结」，所以默认都折；把 A 强制展开后 B 仍折。
		 */
		const nodes = [node('A', null, true), node('B', 'A', true), node('C', 'B', true), node('D', 'B', true)];
		const state = treeFoldOf(nodes, [], ['A']);
		assert.equal(state.folded.has('A'), false);
		assert.equal(state.folded.has('B'), true);
		assert.deepEqual([...state.visible].sort(), ['A', 'B']);
		assert.deepEqual([...state.hidden].sort(), ['C', 'D']);
	});

	it('再展开 B ⇒ C / D 出现，且没有更深层可折', () => {
		const nodes = [node('A', null, true), node('B', 'A', true), node('C', 'B', true), node('D', 'B', true)];
		const state = treeFoldOf(nodes, [], ['A', 'B']);
		assert.equal(state.folded.size, 0);
		assert.deepEqual([...state.visible].sort(), ['A', 'B', 'C', 'D']);
	});
});

describe('treeFoldOf：徽标与脏数据', () => {
	it('「N 张」= 后代数量（不含自己，含更深层）', () => {
		const nodes = [node('A', null, true), node('B', 'A', true), node('C', 'B', true), node('D', 'C', true)];
		const state = treeFoldOf(nodes, [], ['A', 'B', 'C']);
		/* 全部展开，但 descendantCount 仍要算对。 */
		assert.equal(badgeCountOf(state, 'A'), 3);
		assert.equal(badgeCountOf(state, 'B'), 2);
		assert.equal(badgeCountOf(state, 'C'), 1);
		assert.equal(badgeCountOf(state, 'D'), 0);
	});

	it('父 id 指向不存在的卡 ⇒ 当根卡，不制造孤儿', () => {
		const nodes = [node('A', 'GHOST'), node('B', 'A')];
		const state = treeFoldOf(nodes, [], []);
		assert.equal(state.visible.has('A'), true);
		assert.equal(state.visible.has('B'), true);
	});

	it('空输入 ⇒ 空状态', () => {
		const state = treeFoldOf([], [], []);
		assert.equal(state.visible.size, 0);
		assert.equal(state.folded.size, 0);
	});

	it('脏数据成环也不死循环', () => {
		const nodes = [node('A', 'B'), node('B', 'A')];
		const state = treeFoldOf(nodes, [], []);
		assert.equal(state.visible.size, 2);
	});
});
