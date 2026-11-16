/**
 * `pure/filter-box.ts` 的测试 —— **纯函数，零 DOM、零 mock**。
 *
 * ## 语义来源（用户 `2026-11-16`）
 *
 * > 在有东西选中时，点击那个选中的状态：展开到选中他（例如以后如果有4级，5级，
 * > 在点击第3级的时候，就展开3的子，并选中3）。点击最左边的组名时，展开并取消所有
 * > 选择（换句话说，组等于第0级，语义和点击第x级时选择第x级并展开第x的子是一样的逻辑）
 *
 * ⇒ 统一规则：点第 N 级 = 选中它 + 展开它的子。
 *   点组（第 0 级）= 清空选择 + 进入这个组。
 *
 * **旧版的「再点同一项 = 取消」已被这条指令推翻** —— 取消只有「点组名」一个入口。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	EMPTY_FILTER,
	collapsedSplit,
	clearPicked,
	filterValuesOf,
	findNode,
	groupsOf,
	hasChildren,
	hasGroups,
	rowsOf,
	selectionText,
} from '../src/pure/filter-box.ts';
import type { FilterNode, FilterState } from '../src/pure/filter-box.ts';

/* ── 夹具一：状态（两级，有组） ── */

const STATUS: readonly FilterNode[] = [
	{
		value: 'draft',
		label: '草稿',
		children: [{ value: 'unspecified', label: '未指定' }],
	},
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

/* ── 夹具二：类别（一层平铺，无组） ── */

const KINDS: readonly FilterNode[] = [
	{ value: 'goal', label: '目标' },
	{ value: 'design', label: '设计' },
	{ value: 'work', label: '工作' },
	{ value: 'record', label: '记录' },
];

/* ── 夹具三：三级（验证「无限层级」） ── */

const DEEP: readonly FilterNode[] = [
	{
		value: 'g',
		label: '组',
		children: [
			{
				value: 'a',
				label: '甲',
				children: [
					{ value: 'a1', label: '甲一' },
					{ value: 'a2', label: '甲二' },
				],
			},
			{
				value: 'b',
				label: '乙',
				children: [{ value: 'b1', label: '乙一' }],
			},
		],
	},
];

const st = (group: string, picked: readonly string[]): FilterState => ({ group, picked });

/* ══════════════════════════════════════════════════════════ */
describe('hasChildren / groupsOf / hasGroups', () => {
	it('有 children 才算有下一级', () => {
		assert.equal(hasChildren(STATUS[0] as FilterNode), true);
		assert.equal(hasChildren({ value: 'x', label: 'X' }), false);
		assert.equal(hasChildren({ value: 'x', label: 'X', children: [] }), false);
	});

	it('groupsOf 只挑有子的', () => {
		assert.deepEqual(
			groupsOf(STATUS).map((one) => one.label),
			['草稿', '进行', '搁置', '完成'],
		);
	});

	it('状态方框有组', () => assert.equal(hasGroups(STATUS), true));
	it('类别方框没组', () => assert.equal(hasGroups(KINDS), false));
});

describe('findNode', () => {
	it('按路径找到叶子', () => {
		assert.equal(findNode(STATUS, ['ended', 'failed'])?.label, '失败');
	});

	it('路径断了返回 undefined（不抛）', () => {
		assert.equal(findNode(STATUS, ['ended', 'ghost']), undefined);
		assert.equal(findNode(STATUS, ['ghost']), undefined);
	});

	it('三级也能找到', () => {
		assert.equal(findNode(DEEP, ['g', 'a', 'a2'])?.label, '甲二');
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('rowsOf —— 要画几行、每行什么', () => {
	it('空状态：只有一行（组）', () => {
		const rows = rowsOf(STATUS, EMPTY_FILTER);
		assert.equal(rows.length, 1);
		assert.equal(rows[0]?.level, 0);
		assert.deepEqual(
			rows[0]?.items.map((one) => one.label),
			['草稿', '进行', '搁置', '完成'],
		);
	});

	it('空状态：组不算 picked（组不是筛选值）', () => {
		const rows = rowsOf(STATUS, EMPTY_FILTER);
		assert.equal(rows[0]?.items.every((one) => one.picked === false), true);
	});

	it('进入组、没选值：两行（组 + 子），子全未选', () => {
		const rows = rowsOf(STATUS, st('ended', []));
		assert.equal(rows.length, 2);
		assert.deepEqual(
			rows[1]?.items.map((one) => one.label),
			['成功', '失败', '取消', '拒绝'],
		);
		assert.equal(rows[1]?.items.every((one) => one.picked === false), true);
	});

	it('选了叶子：子行里它 picked', () => {
		const rows = rowsOf(STATUS, st('ended', ['failed']));
		const line = rows[1];
		assert.equal(line?.items.find((one) => one.label === '失败')?.picked, true);
		assert.equal(line?.items.find((one) => one.label === '成功')?.picked, false);
	});

	it('进入的组标 branch（视觉上知道子行属于谁）', () => {
		const rows = rowsOf(STATUS, st('ended', ['failed']));
		assert.equal(rows[0]?.items.find((one) => one.label === '完成')?.branch, true);
		assert.equal(rows[0]?.items.find((one) => one.label === '进行')?.branch, false);
	});

	it('⚠ 点组 ⇒ 清空选择（next.picked 一定是空）', () => {
		const rows = rowsOf(STATUS, st('ended', ['failed']));
		const endedGroup = rows[0]?.items.find((one) => one.label === '完成');
		assert.deepEqual(endedGroup?.next, { group: 'ended', picked: [] });
	});

	it('⚠ 点另一个组 ⇒ 也是清空（换组即换筛选）', () => {
		const rows = rowsOf(STATUS, st('ended', ['failed']));
		const activeGroup = rows[0]?.items.find((one) => one.label === '进行');
		assert.deepEqual(activeGroup?.next, { group: 'active', picked: [] });
	});

	it('点叶子 ⇒ 选中它（next.picked 是含它的路径）', () => {
		const rows = rowsOf(STATUS, st('ended', ['failed']));
		const completed = rows[1]?.items.find((one) => one.label === '成功');
		assert.deepEqual(completed?.next, { group: 'ended', picked: ['completed'] });
	});

	it('⚠ 点已选中的那个 ⇒ 幂等（不会取消）', () => {
		const rows = rowsOf(STATUS, st('ended', ['failed']));
		const failed = rows[1]?.items.find((one) => one.label === '失败');
		assert.equal(failed?.picked, true);
		assert.deepEqual(failed?.next, { group: 'ended', picked: ['failed'] });
	});

	it('无组方框：只有一行，选中就是选中', () => {
		const rows = rowsOf(KINDS, EMPTY_FILTER);
		assert.equal(rows.length, 1);
		const work = rows[0]?.items.find((one) => one.label === '工作');
		assert.deepEqual(work?.next, { group: '', picked: ['work'] });
	});

	it('无组方框：切换选中是替换', () => {
		const rows = rowsOf(KINDS, st('', ['work']));
		const goal = rows[0]?.items.find((one) => one.label === '目标');
		assert.equal(goal?.picked, false);
		assert.deepEqual(goal?.next, { group: '', picked: ['goal'] });
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('rowsOf —— 三级（验证层级不是一个写死的数字）', () => {
	it('空状态：一行', () => {
		assert.equal(rowsOf(DEEP, EMPTY_FILTER).length, 1);
	});

	it('进入组：两行', () => {
		const rows = rowsOf(DEEP, st('g', []));
		assert.equal(rows.length, 2);
		assert.deepEqual(
			rows[1]?.items.map((one) => one.label),
			['甲', '乙'],
		);
	});

	it('⚠ 选中第 1 级「甲」⇒ 自动展开第 2 级（三级）', () => {
		const rows = rowsOf(DEEP, st('g', ['a']));
		assert.equal(rows.length, 3);
		assert.deepEqual(
			rows[2]?.items.map((one) => one.label),
			['甲一', '甲二'],
		);
	});

	it('⚠「甲」既是选中，也是分支（它有子 ⇒ 展开）', () => {
		const rows = rowsOf(DEEP, st('g', ['a']));
		const a = rows[1]?.items.find((one) => one.label === '甲');
		assert.equal(a?.picked, true);
		assert.equal(a?.branch, true);
		assert.equal(a?.hasChildren, true);
	});

	it('选中叶子「甲一」⇒ 三级行里它 picked', () => {
		const rows = rowsOf(DEEP, st('g', ['a', 'a1']));
		const a1 = rows[2]?.items.find((one) => one.label === '甲一');
		assert.equal(a1?.picked, true);
		assert.equal(a1?.hasChildren, false);
	});

	it('选中叶子后不再多出第 4 行', () => {
		const rows = rowsOf(DEEP, st('g', ['a', 'a1']));
		assert.equal(rows.length, 3);
	});

	it('点第 1 级「乙」⇒ 带上一级的路径（只换这一级）', () => {
		const rows = rowsOf(DEEP, st('g', ['a']));
		const b = rows[1]?.items.find((one) => one.label === '乙');
		assert.deepEqual(b?.next, { group: 'g', picked: ['b'] });
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('selectionText —— 收起态显示什么', () => {
	it('没选 ⇒ 空串（只画标题）', () => {
		assert.equal(selectionText(STATUS, EMPTY_FILTER), '');
		assert.equal(selectionText(STATUS, st('ended', [])), '');
	});

	it('选了叶子 ⇒ 组/项', () => {
		assert.equal(selectionText(STATUS, st('ended', ['failed'])), '完成/失败');
	});

	it('无组方框 ⇒ 只有项名', () => {
		assert.equal(selectionText(KINDS, st('', ['work'])), '工作');
	});

	it('三级 ⇒ 组/一级/二级/叶子', () => {
		assert.equal(selectionText(DEEP, st('g', ['a', 'a1'])), '组/甲/甲一');
	});
});

describe('collapsedSplit / clearPicked', () => {
	it('没选不拆', () => assert.equal(collapsedSplit(EMPTY_FILTER), false));
	it('选了就拆', () => assert.equal(collapsedSplit(st('ended', ['failed'])), true));

	it('清空选择但保留组（不想退出组）', () => {
		assert.deepEqual(clearPicked(st('ended', ['failed'])), { group: 'ended', picked: [] });
	});
});

describe('filterValuesOf —— 交给 API 的筛选值', () => {
	it('没选 ⇒ 空数组', () => {
		assert.deepEqual(filterValuesOf(STATUS, EMPTY_FILTER), []);
		assert.deepEqual(filterValuesOf(STATUS, st('ended', [])), []);
	});

	it('选了叶子 ⇒ 那个值', () => {
		assert.deepEqual(filterValuesOf(STATUS, st('ended', ['failed'])), ['failed']);
	});

	it('选了中间层 ⇒ 那个值（将来要展开成子树就在这里改）', () => {
		assert.deepEqual(filterValuesOf(DEEP, st('g', ['a'])), ['a']);
	});
});
