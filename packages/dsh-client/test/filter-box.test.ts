/**
 * `pure/filter-box.ts` 的测试 —— **纯函数，零 DOM、零 mock**。
 *
 * ## 语义来源（用户 `2026-11-16`，第三版定义）
 *
 * > 「你不知道面包屑导航吗？我说的是点到谁就选中谁。点到完成，就选中完成。
 * >  那么完成的子级的选中就要取消掉。列出『完成』的子项。」
 * > 「除此以外，只展示两个层级。」
 * > 「比如选中了 1/2/3/2/4，那么就要这样列出
 * >  1/2/3/2 | 1 / 2 / 3 / 4 | 1 / 2 / 3」
 *
 * ⇒ 三段：①面包屑（祖先）②当前层兄弟（含选中）③选中项的子
 *   ②③是可点的，①只用于「跳回上层」。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	hasChildren,
	hasSelection,
	pickOf,
	resolvePath,
	selectionText,
	viewOf,
} from '../src/pure/filter-box.ts';
import type { FilterNode } from '../src/pure/filter-box.ts';

/* ── 夹具一：状态（两级：组 + 状态） ── */

const STATUS: readonly FilterNode[] = [
	{ value: 'draft', label: '草稿', children: [{ value: 'unspecified', label: '未指定' }] },
	{
		value: 'active',
		label: '进行',
		children: [
			{ value: 'submitted', label: '提交' },
			{ value: 'working', label: '处理中' },
		],
	},
	{
		value: 'shelved',
		label: '搁置',
		children: [
			{ value: 'input-required', label: '需要信息' },
			{ value: 'auth-required', label: '需要授权' },
		],
	},
	{
		value: 'ended',
		label: '完成',
		children: [
			{ value: 'completed', label: '成功' },
			{ value: 'failed', label: '失败' },
			{ value: 'canceled', label: '取消' },
			{ value: 'rejected', label: '拒绝' },
		],
	},
];

/* ── 夹具二：类别（一层平铺） ── */

const KINDS: readonly FilterNode[] = [
	{ value: 'goal', label: '目标' },
	{ value: 'design', label: '设计' },
	{ value: 'work', label: '工作' },
	{ value: 'record', label: '记录' },
];

/* ── 夹具三：深四层（对应用户举的 1/2/3/2/4） ── */

const N: FilterNode = (v: string, kids?: readonly FilterNode[]): FilterNode =>
	kids === undefined
		? { value: v, label: v }
		: { value: v, label: v, children: kids };

const DEEP: readonly FilterNode[] = [
	N('1', [
		N('2', [N('3', [N('2', [N('4'), N('5')]), N('6')]), N('7')]),
		N('8'),
	]),
	N('9'),
];

/* ══════════════════════════════════════════════════════════ */

describe('hasChildren / resolvePath', () => {
	it('有 children 才算能下探', () => {
		assert.equal(hasChildren(STATUS[0] as FilterNode), true);
		assert.equal(hasChildren(N('x')), false);
		assert.equal(hasChildren(N('x', [])), false);
	});

	it('按路径取出每层节点', () => {
		const nodes = resolvePath(STATUS, ['ended', 'failed']);
		assert.deepEqual(nodes?.map((one) => one.label), ['完成', '失败']);
	});

	it('路径断了返回 undefined（不抛）', () => {
		assert.equal(resolvePath(STATUS, ['ended', 'ghost']), undefined);
		assert.equal(resolvePath(STATUS, ['ghost']), undefined);
	});

	it('空路径返回空数组（不是 undefined）', () => {
		assert.deepEqual(resolvePath(STATUS, []), []);
	});

	it('四层也能取', () => {
		assert.deepEqual(
			resolvePath(DEEP, ['1', '2', '3', '2'])?.map((one) => one.label),
			['1', '2', '3', '2'],
		);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('viewOf —— 三段分别是什么', () => {
	it('没选：当前层 = 全部根，无面包屑、无子层', () => {
		const v = viewOf(STATUS, []);
		assert.deepEqual(v.crumbs, []);
		assert.deepEqual(
			v.currentLevel.map((one) => one.label),
			['草稿', '进行', '搁置', '完成'],
		);
		assert.deepEqual(v.childLevel, []);
	});

	it('⚠ 选中第 1 级「完成」：没有面包屑，当前层是整个根，子层是它的子', () => {
		const v = viewOf(STATUS, ['ended']);
		assert.deepEqual(v.crumbs, []);
		assert.deepEqual(
			v.currentLevel.map((one) => one.label),
			['草稿', '进行', '搁置', '完成'],
		);
		assert.equal(v.currentLevel.find((one) => one.label === '完成')?.picked, true);
		assert.deepEqual(
			v.childLevel.map((one) => one.label),
			['成功', '失败', '取消', '拒绝'],
		);
		assert.equal(v.childLevel.every((one) => one.picked === false), true);
	});

	it('⚠ 选中第 2 级「失败」：面包屑 = 完成，当前层 = 完成的子，子层 = 空', () => {
		const v = viewOf(STATUS, ['ended', 'failed']);
		assert.deepEqual(v.crumbs.map((one) => one.label), ['完成']);
		assert.deepEqual(
			v.currentLevel.map((one) => one.label),
			['成功', '失败', '取消', '拒绝'],
		);
		assert.equal(v.currentLevel.find((one) => one.label === '失败')?.picked, true);
		assert.deepEqual(v.childLevel, []);
	});

	it('无组方框：选一个项后当前层仍是全部项', () => {
		const v = viewOf(KINDS, ['work']);
		assert.deepEqual(v.crumbs, []);
		assert.deepEqual(
			v.currentLevel.map((one) => one.label),
			['目标', '设计', '工作', '记录'],
		);
		assert.equal(v.currentLevel.find((one) => one.label === '工作')?.picked, true);
		assert.deepEqual(v.childLevel, []);
	});

	it('脏路径 ⇒ 三段都空（不炸）', () => {
		const v = viewOf(STATUS, ['nope']);
		assert.deepEqual(v.crumbs, []);
		assert.deepEqual(v.currentLevel, []);
		assert.deepEqual(v.childLevel, []);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('viewOf —— 用户的例子 1/2/3/2/4', () => {
	/*
	 * 树：
	 *   1 ─ 2 ─ 3 ─ 2 ─ 4 / 5
	 *             └ 6
	 *       └ 8
	 *   9
	 *
	 * 选中路径 1/2/3/2/4 ⇒
	 *   ①面包屑 1/2/3/2
	 *   ②当前层 1 / 2 / 3 / 4   ← wait，当前层应是「2」的兄弟？
	 */
	it('选中 1/2/3/2/4：面包屑 = 1/2/3/2（不含自己）', () => {
		const v = viewOf(DEEP, ['1', '2', '3', '2', '4']);
		assert.deepEqual(v.crumbs.map((one) => one.label), ['1', '2', '3', '2']);
	});

	it('选中 1/2/3/2/4：当前层 = 父节点(2)的子 = 4/5，4 被选中', () => {
		const v = viewOf(DEEP, ['1', '2', '3', '2', '4']);
		assert.deepEqual(v.currentLevel.map((one) => one.label), ['4', '5']);
		assert.equal(v.currentLevel.find((one) => one.label === '4')?.picked, true);
	});

	it('选中 1/2/3/2/4：子层 = 4 的子 = 空', () => {
		const v = viewOf(DEEP, ['1', '2', '3', '2', '4']);
		assert.deepEqual(v.childLevel, []);
	});

	it('⭐ 选中 1/2/3/2（中间层）：面包屑 = 1/2/3，当前层 = 2/6，子层 = 4/5', () => {
		const v = viewOf(DEEP, ['1', '2', '3', '2']);
		assert.deepEqual(v.crumbs.map((one) => one.label), ['1', '2', '3']);
		assert.deepEqual(v.currentLevel.map((one) => one.label), ['2', '6']);
		assert.equal(v.currentLevel.find((one) => one.label === '2')?.picked, true);
		assert.deepEqual(v.childLevel.map((one) => one.label), ['4', '5']);
	});

	it('⭐ 这就是用户要的三段：1/2/3 | 2 / 6 | 4 / 5', () => {
		const v = viewOf(DEEP, ['1', '2', '3', '2']);
		const crumbs = v.crumbs.map((one) => one.label).join('/');
		const current = v.currentLevel.map((one) => one.label).join(' / ');
		const child = v.childLevel.map((one) => one.label).join(' / ');
		assert.equal(`${crumbs} | ${current} | ${child}`, '1/2/3 | 2 / 6 | 4 / 5');
	});

	it('点②里的兄弟「6」⇒ 丢掉它下面那层（路径变 1/2/3/6）', () => {
		const v = viewOf(DEEP, ['1', '2', '3', '2']);
		const six = v.currentLevel.find((one) => one.label === '6');
		assert.deepEqual(six?.next, ['1', '2', '3', '6']);
	});

	it('点③里的子「5」⇒ 下探一层（路径变 1/2/3/2/5）', () => {
		const v = viewOf(DEEP, ['1', '2', '3', '2']);
		const five = v.childLevel.find((one) => one.label === '5');
		assert.deepEqual(five?.next, ['1', '2', '3', '2', '5']);
	});

	it('点①里第一段「1」⇒ 跳回根（路径变 1）', () => {
		const v = viewOf(DEEP, ['1', '2', '3', '2']);
		assert.deepEqual(v.crumbs[0]?.next, ['1']);
	});

	it('点①里第三段「3」⇒ 跳回那层（路径变 1/2/3）', () => {
		const v = viewOf(DEEP, ['1', '2', '3', '2']);
		assert.deepEqual(v.crumbs[2]?.next, ['1', '2', '3']);
	});

	it('跳回后再算一次 ⇒ 面包屑变短、子层变成刚离开的那支', () => {
		const before = viewOf(DEEP, ['1', '2', '3', '2']);
		const jumped = viewOf(DEEP, before.crumbs[2]?.next ?? []);
		assert.deepEqual(jumped.crumbs.map((one) => one.label), ['1', '2']);
		assert.deepEqual(jumped.childLevel.map((one) => one.label), ['2', '6']);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('selectionText —— 收起态显示完整路径', () => {
	it('没选 ⇒ 空串', () => {
		assert.equal(selectionText(STATUS, []), '');
	});

	it('选第 1 级 ⇒ 只有它', () => {
		assert.equal(selectionText(STATUS, ['ended']), '完成');
	});

	it('选第 2 级 ⇒ 完整路径', () => {
		assert.equal(selectionText(STATUS, ['ended', 'failed']), '完成/失败');
	});

	it('四层 ⇒ 四段', () => {
		assert.equal(selectionText(DEEP, ['1', '2', '3', '2', '4']), '1/2/3/2/4');
	});

	it('无组方框 ⇒ 项名', () => {
		assert.equal(selectionText(KINDS, ['work']), '工作');
	});
});

describe('hasSelection / pickOf', () => {
	it('没选 false', () => assert.equal(hasSelection([]), false));
	it('选了 true', () => assert.equal(hasSelection(['ended']), true));

	it('pickOf 从当前层找得到', () => {
		const v = viewOf(STATUS, ['ended']);
		assert.deepEqual(pickOf(v, 'active'), ['active']);
	});

	it('pickOf 从子层找得到', () => {
		const v = viewOf(STATUS, ['ended']);
		assert.deepEqual(pickOf(v, 'failed'), ['ended', 'failed']);
	});

	it('pickOf 找不到 ⇒ 空路径（清空）', () => {
		const v = viewOf(STATUS, ['ended']);
		assert.deepEqual(pickOf(v, 'ghost'), []);
	});
});
