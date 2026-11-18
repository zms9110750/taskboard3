/**
 * 左栏元数据块的纯逻辑测试。
 *
 * ## 为什么这一块值得测
 *
 * 三个地方都会「看着对其实错」：
 *
 * | 失效方式 | 症状 |
 * |---|---|
 * | 用两个 boolean 表示两个标签 | 能同时开 —— **不该能表示的非法状态** |
 * | 再点已开的标签不收起 | 用户点第二下期待收起，结果没反应 |
 * | 计数算「加了几行」而不是「选了几个目标」 | 点「添加」数字就变，但什么都没加 |
 *
 * 三种都不报错，只是界面对不上。⇒ 逐条钉住。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	RELATION_KINDS,
	isAdvOpen,
	isRelOpen,
	linksOf,
	nextTab,
	relationCountOf,
	removeRelationAt,
	setRelationKind,
	setRelationTarget,
	type RelationDraft,
} from '../pure/create-meta.ts';

/* ══════════════════════════════════════════════════════════
   三值 active —— 互斥 + 可收起
   ══════════════════════════════════════════════════════════ */

describe('nextTab —— 互斥且可收起', () => {
	it('都收起时点「关系」⇒ 开关系', () => {
		assert.equal(nextTab(null, 'rel'), 'rel');
	});

	it('都收起时点「高级设置」⇒ 开高级', () => {
		assert.equal(nextTab(null, 'adv'), 'adv');
	});

	it('⚠ 关系开着时点「高级设置」⇒ 直接切过去（互斥）', () => {
		assert.equal(nextTab('rel', 'adv'), 'adv');
	});

	it('⚠ 高级开着时点「关系」⇒ 直接切过去（互斥）', () => {
		assert.equal(nextTab('adv', 'rel'), 'rel');
	});

	it('⚠ 再点已开的「关系」⇒ 收起（null）', () => {
		assert.equal(nextTab('rel', 'rel'), null);
	});

	it('⚠ 再点已开的「高级设置」⇒ 收起（null）', () => {
		assert.equal(nextTab('adv', 'adv'), null);
	});

	it('⚠ 任何时刻最多一个开着（穷举所有状态 × 所有点击）', () => {
		const states: (null | 'rel' | 'adv')[] = [null, 'rel', 'adv'];
		const clicks: ('rel' | 'adv')[] = ['rel', 'adv'];

		for (const state of states) {
			for (const click of clicks) {
				const next = nextTab(state, click);
				/* 关键不变量：新状态要么是 null，要么正好是被点的那个。 */
				assert.equal(next === null || next === click, true, `${String(state)} + ${click} => ${String(next)}`);
				/* 另一个必须关着。 */
				if (click === 'rel') assert.equal(isAdvOpen(next), false);
				else assert.equal(isRelOpen(next), false);
			}
		}
	});

	it('点另一个标签不会先把当前那个关掉再开 —— 是直接切换', () => {
		/* 这条防的是「先 setTab(null) 再 setTab(next)」那种两步写法：
		 * 中间状态会导致面板闪一下（重渲染两次）。 */
		const next = nextTab('rel', 'adv');
		assert.equal(next, 'adv');
		assert.equal(isRelOpen(next), false);
		assert.equal(isAdvOpen(next), true);
	});
});

describe('isRelOpen / isAdvOpen —— 与 nextTab 一致', () => {
	it('null ⇒ 两个都关', () => {
		assert.equal(isRelOpen(null), false);
		assert.equal(isAdvOpen(null), false);
	});

	it("'rel' ⇒ 只有关系开", () => {
		assert.equal(isRelOpen('rel'), true);
		assert.equal(isAdvOpen('rel'), false);
	});

	it("'adv' ⇒ 只有高级开", () => {
		assert.equal(isRelOpen('adv'), false);
		assert.equal(isAdvOpen('adv'), true);
	});
});

/* ══════════════════════════════════════════════════════════
   关系计数 + 提交清单
   ══════════════════════════════════════════════════════════ */

/** 造一行关系草稿。 */
function row(kind: string, to: string): RelationDraft {
	return { kind, to };
}

describe('relationCountOf —— 只算已选目标的', () => {
	it('空列表 ⇒ 0', () => {
		assert.equal(relationCountOf([]), 0);
	});

	it('⚠ 加了一行但没选目标 ⇒ 仍然是 0（这条最容易做错）', () => {
		assert.equal(relationCountOf([row('dependsOn', '')]), 0);
	});

	it('选了一个目标 ⇒ 1', () => {
		assert.equal(relationCountOf([row('dependsOn', 'AB-01')]), 1);
	});

	it('三行里两个选了 ⇒ 2', () => {
		assert.equal(
			relationCountOf([row('dependsOn', 'AB-01'), row('related', ''), row('references', 'AB-02')]),
			2,
		);
	});

	it('全都没选 ⇒ 0（不管有几行）', () => {
		assert.equal(relationCountOf([row('dependsOn', ''), row('related', '')]), 0);
	});
});

describe('linksOf —— 和计数用同一个判断', () => {
	it('空列表 ⇒ 空数组', () => {
		assert.deepEqual(linksOf([]), []);
	});

	it('没选目标的行被滤掉', () => {
		assert.deepEqual(linksOf([row('dependsOn', ''), row('related', 'AB-01')]), [
			{ label: 'related', to: 'AB-01' },
		]);
	});

	it('⚠ 条数恒等于 relationCountOf（两个函数不许分叉）', () => {
		const samples: readonly RelationDraft[][] = [
			[],
			[row('dependsOn', '')],
			[row('dependsOn', 'A')],
			[row('dependsOn', 'A'), row('related', '')],
			[row('dependsOn', 'A'), row('related', 'B'), row('references', '')],
		];
		for (const rows of samples) {
			assert.equal(linksOf(rows).length, relationCountOf(rows));
		}
	});

	it('送的是协议名不是中文 label', () => {
		assert.deepEqual(linksOf([row('dependsOn', 'AB-01')]), [{ label: 'dependsOn', to: 'AB-01' }]);
	});
});

/* ══════════════════════════════════════════════════════════
   行操作
   ══════════════════════════════════════════════════════════ */

describe('removeRelationAt', () => {
	const rows = [row('dependsOn', 'A'), row('related', 'B'), row('references', '')];

	it('删中间那行', () => {
		assert.deepEqual(removeRelationAt(rows, 1), [
			{ kind: 'dependsOn', to: 'A' },
			{ kind: 'references', to: '' },
		]);
	});

	it('⚠ 删完计数自然对（不需要调用方再算）', () => {
		assert.equal(relationCountOf(removeRelationAt(rows, 0)), 1);
	});

	it('越界 ⇒ 原样返回（同一个引用，不是新数组）', () => {
		assert.equal(removeRelationAt(rows, -1), rows);
		assert.equal(removeRelationAt(rows, 99), rows);
	});

	it('不改原数组', () => {
		const before = [...rows];
		removeRelationAt(rows, 0);
		assert.deepEqual(rows, before);
	});
});

describe('setRelationTarget', () => {
	const rows = [row('dependsOn', ''), row('related', 'B')];

	it('给空行选目标 ⇒ 计数从 0 变 1', () => {
		const next = setRelationTarget(rows, 0, 'A');
		assert.equal(relationCountOf(rows), 1);
		assert.equal(relationCountOf(next), 2);
	});

	it('清空目标 ⇒ 计数减一', () => {
		const next = setRelationTarget(rows, 1, '');
		assert.equal(relationCountOf(next), 0);
	});

	it('越界 ⇒ 原样返回', () => {
		assert.equal(setRelationTarget(rows, 9, 'A'), rows);
	});

	it('不改原数组', () => {
		const first = rows[0];
		setRelationTarget(rows, 0, 'Z');
		assert.equal(rows[0], first);
	});
});

describe('setRelationKind', () => {
	const rows = [row('dependsOn', 'A')];

	it('改类型不影响目标', () => {
		const next = setRelationKind(rows, 0, 'related');
		assert.equal(next[0]?.kind, 'related');
		assert.equal(next[0]?.to, 'A');
	});

	it('越界 ⇒ 原样返回', () => {
		assert.equal(setRelationKind(rows, 5, 'related'), rows);
	});
});

/* ══════════════════════════════════════════════════════════
   关系类型词表
   ══════════════════════════════════════════════════════════ */

describe('RELATION_KINDS —— 4 种，不含 supersedes', () => {
	it('恰好 4 种', () => {
		assert.equal(RELATION_KINDS.length, 4);
	});

	it('顺序 = 依赖 / 约束 / 相关 / 参考', () => {
		assert.deepEqual(
			RELATION_KINDS.map((one) => one.value),
			['dependsOn', 'constrains', 'related', 'references'],
		);
	});

	it('⚠ 不含 supersedes（取代只能由 fork 产生，不许手写）', () => {
		assert.equal(
			RELATION_KINDS.some((one) => one.value === 'supersedes'),
			false,
		);
	});

	it('中文 label 都在', () => {
		assert.deepEqual(
			RELATION_KINDS.map((one) => one.label),
			['依赖', '约束', '相关', '参考'],
		);
	});
});
