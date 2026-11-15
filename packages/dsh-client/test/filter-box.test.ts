/**
 * `pure/filter-box.ts` 的测试 —— **纯函数，零 DOM、零 mock**。
 *
 * 每条用例对应旧版 `filter-box.ts` 里一条用户确认过的行为。
 * 旧版没有测试，这些坑只写在注释里；现在变成断言。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	activeGroup,
	collapsedSplit,
	groupKeyOf,
	groupOf,
	hasGroups,
	isGroupPicked,
	labelOf,
	levelOne,
	levelTwo,
	pickGroup,
	pickOption,
	selectionText,
} from '../src/pure/filter-box.ts';
import type { FilterOption } from '../src/pure/filter-box.ts';

/* ── 测试夹具：状态方框（有组）与类别方框（无组） ── */

const STATUS: readonly FilterOption[] = [
	{ value: 'unspecified', label: '未指定', group: '草稿' },
	{ value: 'submitted', label: '提交', group: '进行' },
	{ value: 'working', label: '处理中', group: '进行' },
	{ value: 'input-required', label: '需要信息', group: '搁置' },
	{ value: 'auth-required', label: '需要授权', group: '搁置' },
	{ value: 'completed', label: '成功', group: '完成' },
	{ value: 'failed', label: '失败', group: '完成' },
	{ value: 'canceled', label: '取消', group: '完成' },
	{ value: 'rejected', label: '拒绝', group: '完成' },
];

const KINDS: readonly FilterOption[] = [
	{ value: 'goal', label: '目标' },
	{ value: 'design', label: '设计' },
	{ value: 'work', label: '工作' },
	{ value: 'record', label: '记录' },
];

describe('groupKeyOf', () => {
	it('有 group 就给 group', () => {
		assert.equal(groupKeyOf({ value: 'x', label: 'X', group: '甲' }), '甲');
	});

	it('没有 group 给空串', () => {
		assert.equal(groupKeyOf({ value: 'x', label: 'X' }), '');
	});

	it('group 是空串也给空串', () => {
		assert.equal(groupKeyOf({ value: 'x', label: 'X', group: '' }), '');
	});
});

describe('groupOf', () => {
	it('状态方框分成四组，顺序按首次出现', () => {
		const groups = groupOf(STATUS);
		assert.deepEqual(
			groups.map((one) => one.key),
			['草稿', '进行', '搁置', '完成'],
		);
	});

	it('每组里的选项保持原顺序', () => {
		const groups = groupOf(STATUS);
		const ended = groups.find((one) => one.key === '完成');
		assert.deepEqual(
			ended?.options.map((one) => one.label),
			['成功', '失败', '取消', '拒绝'],
		);
	});

	it('无组方框只有一组，key 是空串', () => {
		const groups = groupOf(KINDS);
		assert.equal(groups.length, 1);
		assert.equal(groups[0]?.key, '');
		assert.equal(groups[0]?.options.length, 4);
	});

	it('空输入给空数组', () => {
		assert.deepEqual(groupOf([]), []);
	});
});

describe('hasGroups', () => {
	it('状态方框有组', () => assert.equal(hasGroups(STATUS), true));
	it('类别方框没组', () => assert.equal(hasGroups(KINDS), false));
	it('空输入没组', () => assert.equal(hasGroups([]), false));
});

describe('isGroupPicked', () => {
	const ended = { key: '完成', options: STATUS.filter((one) => one.group === '完成') };

	it('整组全选 = true', () => {
		assert.equal(
			isGroupPicked(ended, ['completed', 'failed', 'canceled', 'rejected']),
			true,
		);
	});

	it('只选一部分 = false', () => {
		assert.equal(isGroupPicked(ended, ['completed']), false);
	});

	it('空组永远 false（不能被当成全选）', () => {
		assert.equal(isGroupPicked({ key: '空', options: [] }, []), false);
	});

	it('多选但含组外的值仍然 true（组内每项都在）', () => {
		assert.equal(
			isGroupPicked(ended, ['completed', 'failed', 'canceled', 'rejected', 'working']),
			true,
		);
	});
});

describe('activeGroup —— 该展开哪个组的二级', () => {
	it('什么都没选 ⇒ 不展开', () => {
		assert.equal(activeGroup(STATUS, []), undefined);
	});

	it('整组选中 ⇒ 展开那个组', () => {
		assert.equal(activeGroup(STATUS, ['completed', 'failed', 'canceled', 'rejected']), '完成');
	});

	it('只选一项 ⇒ 展开它所属的组', () => {
		assert.equal(activeGroup(STATUS, ['failed']), '完成');
	});

	it('选一项但那一项无组 ⇒ 不展开', () => {
		assert.equal(activeGroup(KINDS, ['goal']), undefined);
	});

	it('多值但不构成整组 ⇒ 不展开', () => {
		assert.equal(activeGroup(STATUS, ['failed', 'completed']), undefined);
	});
});

describe('labelOf', () => {
	it('找得到就用 label', () => assert.equal(labelOf(KINDS, 'work'), '工作'));
	it('找不到回落 value（脏数据也能显示）', () => {
		assert.equal(labelOf(KINDS, 'ghost'), 'ghost');
	});
});

describe('selectionText —— 收起态显示什么', () => {
	it('没选 ⇒ 空串（只画标题）', () => {
		assert.equal(selectionText(STATUS, []), '');
	});

	it('整组选中 ⇒ 组名', () => {
		assert.equal(
			selectionText(STATUS, ['completed', 'failed', 'canceled', 'rejected']),
			'完成',
		);
	});

	it('单项（有组）⇒ 组/项', () => {
		assert.equal(selectionText(STATUS, ['failed']), '完成/失败');
	});

	it('单项（无组）⇒ 项名', () => {
		assert.equal(selectionText(KINDS, ['work']), '工作');
	});

	it('多项不构成整组 ⇒ 项名用 / 连', () => {
		assert.equal(selectionText(STATUS, ['failed', 'completed']), '失败/成功');
	});

	it('值是野的 ⇒ 回落 value', () => {
		assert.equal(selectionText(STATUS, ['ghost']), 'ghost');
	});
});

describe('pickOption —— 点一个项', () => {
	it('没选过 ⇒ 选中它', () => {
		assert.deepEqual(pickOption([], 'failed'), ['failed']);
	});

	it('选的是别的 ⇒ 替换（单选）', () => {
		assert.deepEqual(pickOption(['completed'], 'failed'), ['failed']);
	});

	it('再点当前唯一选中项 ⇒ 取消', () => {
		assert.deepEqual(pickOption(['failed'], 'failed'), []);
	});

	it('⚠ 点整组后再点组内一项 ⇒ 收窄到这一项，不是全清', () => {
		/* 旧版注释里的坑：用 includes 判会判成「已选 ⇒ 取消 ⇒ 全清」 */
		const whole = ['completed', 'failed', 'canceled', 'rejected'];
		assert.deepEqual(pickOption(whole, 'failed'), ['failed']);
	});

	it('⚠ 点整组后再点组内一项，再点它自己 ⇒ 才清空', () => {
		assert.deepEqual(pickOption(['failed'], 'failed'), []);
	});
});

describe('pickGroup —— 点一个组', () => {
	const ended = { key: '完成', options: STATUS.filter((one) => one.group === '完成') };

	it('没选过 ⇒ 选中整组全部值', () => {
		assert.deepEqual(pickGroup(ended, []), ['completed', 'failed', 'canceled', 'rejected']);
	});

	it('整组已选中 ⇒ 取消', () => {
		assert.deepEqual(
			pickGroup(ended, ['completed', 'failed', 'canceled', 'rejected']),
			[],
		);
	});

	it('只选了组里一项 ⇒ 补成整组', () => {
		assert.deepEqual(
			pickGroup(ended, ['failed']),
			['completed', 'failed', 'canceled', 'rejected'],
		);
	});

	it('选了别的组 ⇒ 换成这一组（单选）', () => {
		assert.deepEqual(pickGroup(ended, ['submitted']), [
			'completed',
			'failed',
			'canceled',
			'rejected',
		]);
	});
});

describe('levelOne —— 一级画什么', () => {
	it('有组的方框：一级是四个组名', () => {
		const items = levelOne(STATUS, []);
		assert.deepEqual(
			items.map((one) => one.label),
			['草稿', '进行', '搁置', '完成'],
		);
		assert.equal(items.every((one) => one.kind === 'group'), true);
	});

	it('无组的方框：一级是各项', () => {
		const items = levelOne(KINDS, []);
		assert.deepEqual(
			items.map((one) => one.label),
			['目标', '设计', '工作', '记录'],
		);
		assert.equal(items.every((one) => one.kind === 'option'), true);
	});

	it('整组选中 ⇒ 该组 picked = true，其余 false', () => {
		const items = levelOne(STATUS, ['completed', 'failed', 'canceled', 'rejected']);
		assert.equal(items.find((one) => one.label === '完成')?.picked, true);
		assert.equal(items.find((one) => one.label === '进行')?.picked, false);
	});

	it('每项自带「点它会变成什么」', () => {
		const items = levelOne(KINDS, []);
		const work = items.find((one) => one.label === '工作');
		assert.deepEqual(work?.next, ['work']);
	});
});

describe('levelTwo —— 二级画什么', () => {
	it('没选 ⇒ 不画', () => {
		assert.equal(levelTwo(STATUS, []), undefined);
	});

	it('整组选中 ⇒ 画组内各项', () => {
		const items = levelTwo(STATUS, ['completed', 'failed', 'canceled', 'rejected']);
		assert.deepEqual(items?.map((one) => one.label), ['成功', '失败', '取消', '拒绝']);
	});

	it('单项选中 ⇒ 画它所在组的各项，且该项 picked', () => {
		const items = levelTwo(STATUS, ['failed']);
		assert.deepEqual(items?.map((one) => one.label), ['成功', '失败', '取消', '拒绝']);
		assert.equal(items?.find((one) => one.label === '失败')?.picked, true);
		assert.equal(items?.find((one) => one.label === '成功')?.picked, false);
	});

	it('⚠ 整组选中后点组内一项 ⇒ 收窄成单项，不是清空', () => {
		const whole = ['completed', 'failed', 'canceled', 'rejected'];
		const items = levelTwo(STATUS, whole);
		const failed = items?.find((one) => one.label === '失败');
		assert.deepEqual(failed?.next, ['failed']);
	});

	it('⚠ 整组选中时每项都显示选中', () => {
		const whole = ['completed', 'failed', 'canceled', 'rejected'];
		const items = levelTwo(STATUS, whole);
		assert.equal(items?.every((one) => one.picked), true);
	});

	it('已是唯一选中项 ⇒ 再点它取消', () => {
		const items = levelTwo(STATUS, ['failed']);
		const failed = items?.find((one) => one.label === '失败');
		assert.equal(failed?.picked, true);
		assert.deepEqual(failed?.next, []);
	});

	it('无组方框 ⇒ 不画二级', () => {
		assert.equal(levelTwo(KINDS, ['goal']), undefined);
	});
});

describe('collapsedSplit —— 收起态拆不拆两个可点区', () => {
	it('没选 ⇒ 不拆', () => assert.equal(collapsedSplit([]), false));
	it('选了 ⇒ 拆（左=取消并展开，右=只展开）', () => {
		assert.equal(collapsedSplit(['failed']), true);
	});
});
