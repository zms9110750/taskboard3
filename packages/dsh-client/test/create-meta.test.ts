/**
 * 左栏「关系 | 高级设置」的纯逻辑测试（`src/pure/create-meta.ts`）。
 *
 * ## 为什么这一块值得测
 *
 * 四个地方都会「看着对其实错」：
 *
 * | 失效方式 | 症状 |
 * |---|---|---|
 * | 用两个 boolean 表示两个标签 | 能同时开 —— **不该能表示的非法状态** |
 * | 再点已开的标签不收起 | 用户点第二下期待收起，结果没反应 |
 * | 计数算「加了几行」而不是「选了几个目标」 | 点「添加」数字就变，但什么都没加 |
 * | 关系词表手抄一份协议表 | 协议新增一条边，UI 里**选不到它**，不报错 |
 *
 * 四种都不报错，只是界面对不上。⇒ 逐条钉住。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LINK_KINDS } from '@taskboard/protocol';

import {
	DEFAULT_RELATION_KIND,
	NOT_WRITEABLE_LINK_KINDS,
	RELATION_KINDS,
	addRelation,
	isAdvOpen,
	isRelOpen,
	nextTab,
	removeRelationAt,
	setRelationKind,
	setRelationTarget,
} from '../src/pure/create-meta.ts';
import { relationCountOf } from '../src/pure/create-validate.ts';
import type { RelationDraft } from '../src/pure/create-types.ts';

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
		/*
		 * 这条防的是「先 setTab(null) 再 setTab(next)」那种两步写法：
		 * 中间状态会导致面板闪一下（重渲染两次）。
		 */
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
   关系词表
   ══════════════════════════════════════════════════════════ */

describe('RELATION_KINDS —— 从协议派生，不是手抄', () => {
	it('恰好 4 种（协议五条边 - 取代）', () => {
		assert.equal(RELATION_KINDS.length, 4);
	});

	it('顺序跟随协议（依赖 / 约束 / 相关 / 参考）', () => {
		assert.deepEqual(
			RELATION_KINDS.map((one) => one.id),
			['dependsOn', 'constrains', 'related', 'references'],
		);
	});

	it('中文 label 来自协议的 displayName', () => {
		assert.deepEqual(
			RELATION_KINDS.map((one) => one.label),
			['依赖', '约束', '相关', '参考'],
		);
	});

	it('⚠ 不含 supersedes（取代只能由 fork 产生，不许手写）', () => {
		assert.equal(
			RELATION_KINDS.some((one) => one.id === 'supersedes'),
			false,
		);
	});

	it('⭐ 差集断言：协议全部边 = 可手写 + 不可手写（新增边时**这条会红**）', () => {
		/*
		 * 这是 AGENTS 3.6 的「白名单 + 差集断言」：
		 * 协议将来加一条边时，`NOT_WRITEABLE_LINK_KINDS` 不变 ⇒ 这里多出一个 id ⇒ 测试变红
		 * ⇒ 逼着人明确决定「这条新边能不能手写」。
		 *
		 * 反过来（用 `filter` 悄悄漏掉未知边）就永远发现不了。
		 */
		const covered = [...RELATION_KINDS.map((one) => one.id), ...NOT_WRITEABLE_LINK_KINDS].sort();
		const all = LINK_KINDS.map((one) => one.id).sort();
		assert.deepEqual(covered, all, '协议的边有增减，但 RELATION_KINDS / NOT_WRITEABLE 没跟着改');
	});

	it('默认关系类型是第一项，且它真的在表里', () => {
		assert.equal(DEFAULT_RELATION_KIND, RELATION_KINDS[0]?.id);
		assert.ok(RELATION_KINDS.some((one) => one.id === DEFAULT_RELATION_KIND));
	});
});

/* ══════════════════════════════════════════════════════════
   关系计数 + 行操作
   ══════════════════════════════════════════════════════════ */

/** 造一行关系草稿。 */
function row(label: string, to: string): RelationDraft {
	return { label, to };
}

describe('relationCountOf —— 只算已选目标的（与提交清单同一判据）', () => {
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
});

describe('addRelation —— 点「添加」不改变计数', () => {
	it('空 ⇒ 一行空行', () => {
		assert.deepEqual(addRelation([]), [{ label: DEFAULT_RELATION_KIND, to: '' }]);
	});

	it('⚠ 加完计数**不变**（空行不算一条关系）', () => {
		assert.equal(relationCountOf(addRelation([])), 0);
		assert.equal(relationCountOf(addRelation([row('dependsOn', 'A')])), 1);
	});

	it('不改原数组', () => {
		const rows: readonly RelationDraft[] = [];
		addRelation(rows);
		assert.equal(rows.length, 0);
	});
});

describe('removeRelationAt', () => {
	const rows = [row('dependsOn', 'A'), row('related', 'B'), row('references', '')];

	it('删中间那行', () => {
		assert.deepEqual(removeRelationAt(rows, 1), [
			{ label: 'dependsOn', to: 'A' },
			{ label: 'references', to: '' },
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
		assert.equal(relationCountOf(next), 2);
	});

	it('清空目标 ⇒ 计数减一', () => {
		assert.equal(relationCountOf(setRelationTarget(rows, 1, '')), 0);
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
		assert.equal(next[0]?.label, 'related');
		assert.equal(next[0]?.to, 'A');
	});

	it('越界 ⇒ 原样返回', () => {
		assert.equal(setRelationKind(rows, 5, 'related'), rows);
	});
});
