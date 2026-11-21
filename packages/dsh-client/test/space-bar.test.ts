/**
 * `pure/space-bar.ts` 的测试 —— **纯函数，零 DOM、零 mock**。
 *
 * 重点就是任务描述里那张表（显示已归档 × 选中空间 → 按钮文案 / 禁用 / 行为）。
 * 逐行断言，一行一条 `it`，不合并 —— 表改了测试必须变红。
 *
 * 语义来源：旧版 `taskboard2/packages/browser/public/views/card-list/board-row.js`
 * 的 `spaceActionButton()`（125-183 行）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	actionButtonOf,
	archivedToggleOf,
	chipsOf,
	dispatchOf,
	resolveViewingId,
	visibleWorkspaces,
} from '../src/pure/space-bar.ts';
import type { Workspace } from '../src/types.ts';

/* ── 夹具 ── */

const ws = (id: string, displayName: string, archived: boolean): Workspace => ({
	id,
	displayName,
	archived,
	createdAt: 0,
});

/*
 * A = 当前空间（未归档）
 * B = 普通空间（未归档）
 * C = 已归档空间
 * D = **异常态**：当前激活 + 已归档
 */
const A = ws('A', '当前空间', false);
const B = ws('B', '另一个空间', false);
const C = ws('C', '归档空间', true);
const D = ws('D', '当前且归档', true);

const LIST: readonly Workspace[] = [A, B, C];
const WITH_ANOMALY: readonly Workspace[] = [A, B, D];

/* ══════════════════════════════════════════════════════════ */
/* ① chip 点击 = 查看，不是激活                                */
/* ══════════════════════════════════════════════════════════ */

describe('① chip 的意图恒为 view（查看 ≠ 激活）', () => {
	it('⭐ 每个 chip 的 intent 都是 view —— 没有第二个意图', () => {
		/* 关态下 C 不可见 ⇒ 两个 chip；开态下三个。两种都断言。 */
		assert.deepEqual(
			chipsOf(LIST, 'A', 'B', false, 3).map((one) => one.intent),
			['view', 'view'],
		);
		assert.deepEqual(
			chipsOf(LIST, 'A', 'B', true, 3).map((one) => one.intent),
			['view', 'view', 'view'],
		);
	});

	it('⭐ 点当前空间的 chip 也是 view（不是「已经激活」之类）', () => {
		const chips = chipsOf(LIST, 'A', 'A', false, 3);
		const current = chips.find((one) => one.id === 'A');
		assert.equal(current?.intent, 'view');
		assert.equal(current?.isCurrent, true);
	});

	it('⭐ 点已归档的 chip 也是 view（归档 chip 只选中、不激活）', () => {
		const chips = chipsOf(LIST, 'A', 'B', true, 3);
		const archived = chips.find((one) => one.id === 'C');
		assert.equal(archived?.intent, 'view');
		assert.equal(archived?.isArchived, true);
		/* 查看它也不代表它是当前空间 */
		assert.equal(archived?.isCurrent, false);
	});

	it('chip 的 title 明说「不会激活它」', () => {
		const chips = chipsOf(LIST, 'A', 'A', false, 3);
		const other = chips.find((one) => one.id === 'B');
		assert.match(other?.title ?? '', /不会激活/);
	});

	it('已归档 chip 的 title 指向左侧那个按钮', () => {
		const chips = chipsOf(LIST, 'A', 'A', true, 0);
		const archived = chips.find((one) => one.id === 'C');
		assert.match(archived?.title ?? '', /已归档/);
		assert.match(archived?.title ?? '', /取消归档/);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ② 那张四行表                                                */
/* ══════════════════════════════════════════════════════════ */

describe('② 显示已归档=关 ⇒ **没有操作按钮**（用户 2026-11-22 取消「激活空间」设定）', () => {
	it('⭐ 关态一律返回 undefined（激活按钮已删除）', () => {
		assert.equal(actionButtonOf(LIST, 'A', 'B', false), undefined);
		assert.equal(actionButtonOf(LIST, 'A', 'A', false), undefined);
		assert.equal(actionButtonOf(LIST, 'A', 'C', false), undefined);
		assert.equal(actionButtonOf([], '', '', false), undefined);
	});

	it('关态不可能产出 activate（类型层已收窄）', () => {
		/* `SpaceActionKind` 现在只剩 toggle-archived —— 这条是防回退。 */
		const open = actionButtonOf(LIST, 'A', 'B', true);
		assert.ok(open !== undefined, 'open 不该是 undefined');
		assert.notEqual(open, undefined);
		if (open !== undefined) assert.equal(open!.kind, 'toggle-archived');
	});
});

describe('② 表第二行：显示已归档=开 ⇒ 非当前空间切归档状态', () => {
	it('⭐ 开 + 非当前、未归档 ⇒ 「已归档」+ 可用 + 未选中', () => {
		const a = actionButtonOf(LIST, 'A', 'B', true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
		assert.equal(a!.label, '已归档');
		assert.equal(a!.disabled, false);
		assert.equal(a!.kind, 'toggle-archived');
		assert.equal(a!.checked, false);
		assert.equal(a!.workspaceId, 'B');
		assert.match(a!.title, /点一下归档/);
	});

	it('⭐ 开 + 非当前、已归档 ⇒ 「已归档」+ 可用 + 选中', () => {
		const a = actionButtonOf(LIST, 'A', 'C', true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
		assert.equal(a!.label, '已归档');
		assert.equal(a!.disabled, false);
		assert.equal(a!.kind, 'toggle-archived');
		assert.equal(a!.checked, true);
		assert.equal(a!.workspaceId, 'C');
		assert.match(a!.title, /取消归档/);
	});

	it('⭐ 开 + 非当前 ⇒ 按钮**永远**可用（归档和取消归档都是它）', () => {
		for (const view of ['B', 'C']) {
			const a = actionButtonOf(LIST, 'A', view, true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
			assert.equal(a!.disabled, false, `viewing=${view}`);
			assert.equal(a!.kind, 'toggle-archived', `viewing=${view}`);
		}
	});
});

describe('② 表第三行：显示已归档=开 + 当前空间（未归档）⇒ 「当前空间」禁用', () => {
	it('⭐ 文案必须是「当前空间」，**不是**「已归档」（防误导）', () => {
		const a = actionButtonOf(LIST, 'A', 'A', true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
		assert.equal(a!.label, '当前空间');
		assert.notEqual(a!.label, '已归档');
	});

	it('⭐ 必须禁用', () => {
		const a = actionButtonOf(LIST, 'A', 'A', true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
		assert.equal(a!.disabled, true);
	});

	it('⚠ 未归档 ⇒ checked 必须是 false（不能画成选中态）', () => {
		const a = actionButtonOf(LIST, 'A', 'A', true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
		assert.equal(a!.checked, false);
	});

	it('title 说明「当前激活的任务空间不能归档」', () => {
		const a = actionButtonOf(LIST, 'A', 'A', true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
		assert.match(a!.title, /不能归档/);
	});

	it('kind 仍是 toggle-archived（同一张表、同一个按钮，只是禁用）', () => {
		assert.equal(actionButtonOf(LIST, 'A', 'A', true).kind, 'toggle-archived');
	});
});

describe('② 表第四行：显示已归档=开 + 当前空间（已归档，异常态）⇒ 「已归档」可点', () => {
	it('⭐ 异常态必须**可点**（否则用户死锁，没法取消归档）', () => {
		const a = actionButtonOf(WITH_ANOMALY, 'D', 'D', true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
		assert.equal(a!.disabled, false);
	});

	it('⭐ 文案是「已归档」+ 选中态', () => {
		const a = actionButtonOf(WITH_ANOMALY, 'D', 'D', true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
		assert.equal(a!.label, '已归档');
		assert.equal(a!.checked, true);
		assert.equal(a!.kind, 'toggle-archived');
	});

	it('⚠ 与第三行只差一个 archived 标记 —— 这是「允许点」的唯一判据', () => {
		const normal = actionButtonOf(LIST, 'A', 'A', true); // 当前 + 未归档
		const anomaly = actionButtonOf(WITH_ANOMALY, 'D', 'D', true); // 当前 + 已归档
		assert.equal(normal!.disabled, true);
		assert.equal(anomaly!.disabled, false);
		assert.equal(normal!.checked, false);
		assert.equal(anomaly!.checked, true);
	});

	it('title 是「取消归档」（不是「不能归档」）', () => {
		const a = actionButtonOf(WITH_ANOMALY, 'D', 'D', true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
		assert.match(a!.title, /取消归档/);
		assert.doesNotMatch(a!.title, /不能归档/);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ② 表的完整性：一个按钮、两种 kind                           */
/* ══════════════════════════════════════════════════════════ */

describe('② 只有一个按钮（不是两个独立按钮）', () => {
	it('开态返回的是单个对象，不是数组', () => {
		const a = actionButtonOf(LIST, 'A', 'B', true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
		assert.equal(Array.isArray(a), false);
		assert.notEqual(a, undefined);
		if (a !== undefined) assert.equal(typeof a!.label, 'string');
	});

	it('开态所有组合的 kind 只能是 toggle-archived', () => {
		const kinds = new Set<string>();
		for (const view of ['A', 'B', 'C']) {
			const a = actionButtonOf(LIST, 'A', view, true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
			if (a !== undefined) kinds.add(a!.kind);
		}
		assert.deepEqual([...kinds].sort(), ['toggle-archived']);
	});

	it('⭐ kind 只由「显示已归档」决定，与选中哪个空间无关', () => {
		for (const view of ['A', 'B', 'C']) {
			assert.equal(actionButtonOf(LIST, 'A', view, false), undefined, `关态没有按钮 viewing=${view}`);
			assert.equal(actionButtonOf(LIST, 'A', view, true)?.kind, 'toggle-archived', `viewing=${view}`);
		}
	});
});

/* ══════════════════════════════════════════════════════════ */
/* 禁用 ⇒ 不触发任何回调（行为断言，不只看视觉）               */
/* ══════════════════════════════════════════════════════════ */

describe('② 禁用时按钮什么都不做', () => {
	it('⭐ 关 + 任何空间 ⇒ 没有按钮（actionButtonOf 直接返回 undefined）', () => {
		assert.equal(actionButtonOf(LIST, 'A', 'A', false), undefined);
		assert.equal(actionButtonOf(LIST, 'A', 'B', false), undefined);
	});

	it('⭐ 开 + 当前空间（未归档）⇒ dispatchOf 返回 undefined', () => {
		assert.equal(dispatchOf(actionButtonOf(LIST, 'A', 'A', true)), undefined);
	});

	it('⭐ 没有空间 ⇒ dispatchOf 返回 undefined', () => {
		assert.equal(dispatchOf(actionButtonOf([], '', '', true)), undefined);
	});

	it('⭐ 开 + 非当前 ⇒ 派发 toggle-archived 到正在查看的那个', () => {
		assert.deepEqual(dispatchOf(actionButtonOf(LIST, 'A', 'B', true)), {
			kind: 'toggle-archived',
			id: 'B',
		});
	});

	it('⭐ 开 + 非当前已归档 ⇒ 派发 toggle-archived（取消归档）', () => {
		assert.deepEqual(dispatchOf(actionButtonOf(LIST, 'A', 'C', true)), {
			kind: 'toggle-archived',
			id: 'C',
		});
	});

	it('⭐ 开 + 异常态 ⇒ 派发 toggle-archived（点了取消归档）', () => {
		assert.deepEqual(dispatchOf(actionButtonOf(WITH_ANOMALY, 'D', 'D', true)), {
			kind: 'toggle-archived',
			id: 'D',
		});
	});

	it('派发目标是「正在查看」的空间，不是当前空间', () => {
		const a = actionButtonOf(LIST, 'A', 'B', true);
		assert.ok(a !== undefined, 'a 不该是 undefined');
		assert.equal(dispatchOf(a)?.id, 'B');
		assert.notEqual(dispatchOf(a)?.id, 'A');
	});
});

/* ══════════════════════════════════════════════════════════ */
/* 显示已归档开关的过滤                                        */
/* ══════════════════════════════════════════════════════════ */

describe('显示已归档 = 列表过滤', () => {
	it('关 ⇒ 归档的一个都不显示', () => {
		assert.deepEqual(
			visibleWorkspaces(LIST, false).map((one) => one.id),
			['A', 'B'],
		);
	});

	it('开 ⇒ 全显示（含归档）', () => {
		assert.deepEqual(
			visibleWorkspaces(LIST, true).map((one) => one.id),
			['A', 'B', 'C'],
		);
	});

	it('关态下 chips 里没有归档空间', () => {
		assert.deepEqual(
			chipsOf(LIST, 'A', 'A', false, 0).map((one) => one.id),
			['A', 'B'],
		);
	});

	it('开关的文案是翻面的（关着说「显示」，开着说「隐藏」）', () => {
		assert.equal(archivedToggleOf(false).label, '显示已归档');
		assert.equal(archivedToggleOf(true).label, '隐藏已归档');
		assert.equal(archivedToggleOf(false).active, false);
		assert.equal(archivedToggleOf(true).active, true);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* 「正在查看」的回落链                                        */
/* ══════════════════════════════════════════════════════════ */

describe('resolveViewingId —— 正在查看落在谁头上', () => {
	it('显式 viewingId 可见 ⇒ 就是它', () => {
		assert.equal(resolveViewingId(LIST, 'A', 'B', false), 'B');
	});

	it('⭐ viewingId 不可见（归档且没开显示）⇒ 回落到当前空间', () => {
		assert.equal(resolveViewingId(LIST, 'A', 'C', false), 'A');
	});

	it('viewingId 可见（开了显示）⇒ 不回落到当前空间', () => {
		assert.equal(resolveViewingId(LIST, 'A', 'C', true), 'C');
	});

	it('viewingId 和 currentId 都不可见 ⇒ undefined', () => {
		assert.equal(resolveViewingId([C], 'C', 'C', false), undefined);
	});

	it('空列表 ⇒ undefined', () => {
		assert.equal(resolveViewingId([], '', '', false), undefined);
	});

	it('⚠ 判定用**可见列表**，不是全量列表（否则会选中一个看不见的空间）', () => {
		/* C 已归档，关着显示 ⇒ 不可见 ⇒ 回落 A */
		assert.equal(resolveViewingId(LIST, 'A', 'C', false), 'A');
		assert.equal(visibleWorkspaces(LIST, false).some((one) => one.id === 'C'), false);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* chip 的三种状态 + 计数                                      */
/* ══════════════════════════════════════════════════════════ */

describe('chipsOf —— isCurrent / isArchived / isViewing 是三件独立的事', () => {
	it('⭐ 当前空间和正在查看是两个 chip（查看 ≠ 激活）', () => {
		const chips = chipsOf(LIST, 'A', 'B', false, 7);
		const a = chips.find((one) => one.id === 'A');
		const b = chips.find((one) => one.id === 'B');
		assert.equal(a?.isCurrent, true);
		assert.equal(a?.isViewing, false);
		assert.equal(b?.isCurrent, false);
		assert.equal(b?.isViewing, true);
	});

	it('⭐ 计数只显示在正在查看的 chip 上', () => {
		const chips = chipsOf(LIST, 'A', 'B', false, 7);
		assert.equal(chips.find((one) => one.id === 'B')?.count, 7);
		assert.equal(chips.find((one) => one.id === 'A')?.count, null);
	});

	it('⭐ 当前空间和正在查看是同一个 ⇒ 那一个 chip 同时 isCurrent + isViewing', () => {
		const chips = chipsOf(LIST, 'A', 'A', false, 5);
		const a = chips.find((one) => one.id === 'A');
		assert.equal(a?.isCurrent, true);
		assert.equal(a?.isViewing, true);
		assert.equal(a?.count, 5);
	});

	it('已归档 chip 同时可以有 isArchived + isCurrent（异常态）', () => {
		const chips = chipsOf(WITH_ANOMALY, 'D', 'D', true, 2);
		const d = chips.find((one) => one.id === 'D');
		assert.equal(d?.isArchived, true);
		assert.equal(d?.isCurrent, true);
		assert.equal(d?.isViewing, true);
	});

	it('计数可以是 0（不是 falsy 就隐藏）', () => {
		const chips = chipsOf(LIST, 'A', 'B', false, 0);
		assert.equal(chips.find((one) => one.id === 'B')?.count, 0);
	});

	it('viewingId 不可见 ⇒ 计入回落到当前空间', () => {
		const chips = chipsOf(LIST, 'A', 'C', false, 4);
		assert.equal(chips.find((one) => one.id === 'A')?.count, 4);
	});

	it('顺序与入参一致（不重排）', () => {
		assert.deepEqual(
			chipsOf(LIST, 'A', 'B', false, 1).map((one) => one.id),
			['A', 'B'],
		);
	});

	it('label 用 displayName', () => {
		assert.deepEqual(
			chipsOf(LIST, 'A', 'A', false, 0).map((one) => one.label),
			['当前空间', '另一个空间'],
		);
	});
});
