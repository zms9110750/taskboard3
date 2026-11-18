/**
 * `pure/filter-box.ts` 的测试 —— **纯函数，零 DOM、零 mock**。
 *
 * ## 只有一个操作
 *
 * 用户 `2026-11-16`：
 * > 「点他的效果是选中他。既然选中了他，那他就应该展开。」
 * > 「我要的逻辑是完全具有一致性的。你套了多少if」
 *
 * ⇒ 每个可点项都带 `next` 路径；组件对它们做同一件事。
 *   本文件把所有 `next` 都断言一遍。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	collapsedCrumbs,
	hasChildren,
	resolvePath,
	selectionText,
	segmentsOf,
} from '../src/pure/filter-box.ts';
import type { FilterNode } from '../src/pure/filter-box.ts';

/* ── 夹具一：状态（两级） ── */

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

/* ── 夹具三：四层（用户举的 1/2/3/2/4） ── */

const n = (v: string, kids?: readonly FilterNode[]): FilterNode =>
	kids === undefined ? { value: v, label: v } : { value: v, label: v, children: kids };

const DEEP: readonly FilterNode[] = [
	n('1', [n('2', [n('3', [n('2', [n('4'), n('5')]), n('6')]), n('7')]), n('8')]),
	n('9'),
];

const labels = (items: readonly { label: string }[]): string[] => items.map((one) => one.label);
const nexts = (items: readonly { next: readonly string[] }[]): (readonly string[])[] =>
	items.map((one) => one.next);

/* ══════════════════════════════════════════════════════════ */

describe('hasChildren / resolvePath', () => {
	it('有 children 才算能下探', () => {
		assert.equal(hasChildren(STATUS[0] as FilterNode), true);
		assert.equal(hasChildren(n('x')), false);
		assert.equal(hasChildren(n('x', [])), false);
	});

	it('按路径取出每层节点', () => {
		assert.deepEqual(resolvePath(STATUS, ['ended', 'failed'])?.map((one) => one.label), [
			'完成',
			'失败',
		]);
	});

	it('路径断了返回 undefined', () => {
		assert.equal(resolvePath(STATUS, ['ended', 'ghost']), undefined);
	});

	it('空路径返回空数组', () => {
		assert.deepEqual(resolvePath(STATUS, []), []);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('segmentsOf —— 展开态画几段', () => {
	it('没选：一段（根），每项 next 是自己', () => {
		const segs = segmentsOf(STATUS, []);
		assert.equal(segs.length, 1);
		assert.deepEqual(labels(segs[0]?.items ?? []), ['草稿', '进行', '搁置', '完成']);
		assert.deepEqual(nexts(segs[0]?.items ?? []), [
			['draft'],
			['active'],
			['shelved'],
			['ended'],
		]);
	});

	it('⚠ 选中第 1 级「完成」：两段（根 + 它的子）', () => {
		const segs = segmentsOf(STATUS, ['ended']);
		assert.equal(segs.length, 2);
		assert.equal(segs[0]?.kind, 'level');
		assert.equal(segs[1]?.kind, 'level');
		assert.deepEqual(labels(segs[1]?.items ?? []), ['成功', '失败', '取消', '拒绝']);
	});

	it('⚠ 选中项在 ② 里是 picked', () => {
		const segs = segmentsOf(STATUS, ['ended']);
		const ended = segs[0]?.items.find((one) => one.label === '完成');
		assert.equal(ended?.picked, true);
	});

	it('⭐ 点第 1 级后它的子都在子层里，next = 父 + 自己', () => {
		const segs = segmentsOf(STATUS, ['ended']);
		assert.deepEqual(nexts(segs[1]?.items ?? []), [
			['ended', 'completed'],
			['ended', 'failed'],
			['ended', 'canceled'],
			['ended', 'rejected'],
		]);
	});

	it('⚠ 选中第 2 级「失败」：三段（面包屑 + 当前层 + 无子层 ⇒ 实为两段）', () => {
		const segs = segmentsOf(STATUS, ['ended', 'failed']);
		assert.equal(segs.length, 2);
		assert.equal(segs[0]?.kind, 'crumbs');
		assert.deepEqual(labels(segs[0]?.items ?? []), ['完成']);
		assert.equal(segs[1]?.kind, 'level');
		assert.deepEqual(labels(segs[1]?.items ?? []), ['成功', '失败', '取消', '拒绝']);
	});

	it('面包屑的 next = 截断到那一段', () => {
		const segs = segmentsOf(STATUS, ['ended', 'failed']);
		assert.deepEqual(nexts(segs[0]?.items ?? []), [['ended']]);
	});

	it('面包屑不算 picked（它只是路径）', () => {
		const segs = segmentsOf(STATUS, ['ended', 'failed']);
		assert.equal(segs[0]?.items[0]?.picked, false);
	});

	it('无组方框：选中后还是一段', () => {
		const segs = segmentsOf(KINDS, ['work']);
		assert.equal(segs.length, 1);
		assert.equal(segs[0]?.items.find((one) => one.label === '工作')?.picked, true);
		assert.deepEqual(nexts(segs[0]?.items ?? []), [
			['goal'],
			['design'],
			['work'],
			['record'],
		]);
	});

	it('脏路径 ⇒ 空（不炸）', () => {
		assert.deepEqual(segmentsOf(STATUS, ['nope']), []);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('segmentsOf —— 用户的例子 1/2/3/2/4', () => {
	it('⭐ 选中 1/2/3/2：面包屑 1/2/3 | 当前层 2/6 | 子层 4/5', () => {
		const segs = segmentsOf(DEEP, ['1', '2', '3', '2']);
		assert.equal(segs.length, 3);
		assert.deepEqual(labels(segs[0]?.items ?? []), ['1', '2', '3']);
		assert.deepEqual(labels(segs[1]?.items ?? []), ['2', '6']);
		assert.deepEqual(labels(segs[2]?.items ?? []), ['4', '5']);
	});

	it('⭐ 三段的 next 全部正确', () => {
		const segs = segmentsOf(DEEP, ['1', '2', '3', '2']);
		/* 面包屑：逐级截断 */
		assert.deepEqual(nexts(segs[0]?.items ?? []), [['1'], ['1', '2'], ['1', '2', '3']]);
		/* 当前层：兄弟替换（前缀 = 父路径） */
		assert.deepEqual(nexts(segs[1]?.items ?? []), [
			['1', '2', '3', '2'],
			['1', '2', '3', '6'],
		]);
		/* 子层：下探 */
		assert.deepEqual(nexts(segs[2]?.items ?? []), [
			['1', '2', '3', '2', '4'],
			['1', '2', '3', '2', '5'],
		]);
	});

	it('选中 1/2/3/2/4（叶子）：面包屑 4 段 + 当前层 4/5，无子层', () => {
		const segs = segmentsOf(DEEP, ['1', '2', '3', '2', '4']);
		assert.equal(segs.length, 2);
		assert.deepEqual(labels(segs[0]?.items ?? []), ['1', '2', '3', '2']);
		assert.deepEqual(labels(segs[1]?.items ?? []), ['4', '5']);
	});

	it('点面包屑第 1 段「1」⇒ next 只有 1', () => {
		const segs = segmentsOf(DEEP, ['1', '2', '3', '2']);
		assert.deepEqual(segs[0]?.items[0]?.next, ['1']);
	});

	it('点当前层「6」⇒ next = 1/2/3/6（丢掉 2 那支）', () => {
		const segs = segmentsOf(DEEP, ['1', '2', '3', '2']);
		assert.deepEqual(segs[1]?.items[1]?.next, ['1', '2', '3', '6']);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('collapsedCrumbs —— 收起态每段独立可点', () => {
	it('没选 ⇒ 空', () => {
		assert.deepEqual(collapsedCrumbs(STATUS, []), []);
	});

	it('选一层 ⇒ 一段，next 是自己', () => {
		const c = collapsedCrumbs(STATUS, ['ended']);
		assert.deepEqual(labels(c), ['完成']);
		assert.deepEqual(nexts(c), [['ended']]);
		assert.equal(c[0]?.picked, true);
	});

	it('⚠ 选两层 ⇒ 两段，各段 next 逐级截断', () => {
		const c = collapsedCrumbs(STATUS, ['active', 'submitted']);
		assert.deepEqual(labels(c), ['进行', '提交']);
		assert.deepEqual(nexts(c), [['active'], ['active', 'submitted']]);
	});

	it('只有最后一段是 picked', () => {
		const c = collapsedCrumbs(STATUS, ['active', 'submitted']);
		assert.deepEqual(c.map((one) => one.picked), [false, true]);
	});

	it('四层 ⇒ 四段', () => {
		const c = collapsedCrumbs(DEEP, ['1', '2', '3', '2', '4']);
		assert.deepEqual(labels(c), ['1', '2', '3', '2', '4']);
	});

	it('无组方框：一层就是一段', () => {
		assert.deepEqual(labels(collapsedCrumbs(KINDS, ['work'])), ['工作']);
	});
});

describe('selectionText', () => {
	it('没选 ⇒ 空串', () => assert.equal(selectionText(STATUS, []), ''));
	it('一层 ⇒ 名字', () => assert.equal(selectionText(STATUS, ['ended']), '完成'));
	it('两层 ⇒ 斜杠连', () => {
		assert.equal(selectionText(STATUS, ['ended', 'failed']), '完成/失败');
	});
});

