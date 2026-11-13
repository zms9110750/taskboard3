/**
 * 搜索测试 —— 从 `packages/search/test/match.test.ts` 搬进 core。
 *
 * ## 搬迁时改了什么
 *
 * | 原来 | 现在 | 为什么 |
 * |---|---|---|
 * | `SearchableCard` 影子类型 | 真正的 `Card` | core 有真类型，不需要结构兼容层 |
 * | `createSearch({ groupOf })` | `createSearch()` | 映射直接 import `STATUS_GROUP_OF`，只有一份 |
 * | `template: [...]` 条件 | `templateRef: [...]` | 两边字段名不一致是**静默失效的 bug** |
 * | 卡上直接有 `adoptedAt` / `createdAt` | 从 `history` 派生 | `Card` 没有这两个字段 |
 * | 「源码不 import node:」 | **删除** | core 本来就 import `node:` |
 * | 「与 protocol 的 STATUS_GROUP_OF 一致」 | **删除** | 现在直接用它，不可能漂 |
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Card } from '../lib/card.js';
import {
	createSearch,
	includesDrafts,
	isStatusGroup,
	titleMatches,
	DEFAULT_DRAFT_STATE,
} from '../lib/search.js';

const DRAFT = DEFAULT_DRAFT_STATE;

/** 造一张卡：只写搜索关心的字段，其余给最小合法值。 */
function card(
	id: string,
	title: string,
	status: string,
	extra: {
		ref?: string;
		kind?: string;
		domain?: string;
		createdAt?: number;
		adoptedAt?: number;
	} = {},
): Card {
	const history: Card['history'][number][] = [];
	if (extra.createdAt !== undefined) history.push({ at: extra.createdAt, action: 'create' });
	if (extra.adoptedAt !== undefined) history.push({ at: extra.adoptedAt, action: 'adopt' });
	return {
		id,
		title,
		status: status as Card['status'],
		template: {
			ref: extra.ref ?? '',
			kind: extra.kind ?? '',
			domain: extra.domain ?? '',
		},
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		history,
		deleted: false,
		claimedBy: null,
		claimedAt: null,
	};
}

/** 一组覆盖各状态、各类别、各时间戳的样本卡。 */
function sample(): Card[] {
	return [
		card('GU01', '用户任务一', 'TASK_STATE_SUBMITTED', {
			ref: 'userNeed',
			kind: 'goal',
			domain: '核心',
			createdAt: 1000,
		}),
		card('GU02', '用户任务二', 'TASK_STATE_WORKING', {
			ref: 'userNeed',
			kind: 'goal',
			domain: '核心',
			createdAt: 2000,
			adoptedAt: 2500,
		}),
		card('S01', '调研任务', 'TASK_STATE_COMPLETED', {
			ref: 'research',
			kind: 'work',
			domain: '核心',
			createdAt: 3000,
			adoptedAt: 9000,
		}),
		card('WD01', '写代码', 'TASK_STATE_WORKING', {
			ref: 'writeCode',
			kind: 'work',
			domain: '代码',
			createdAt: 4000,
		}),
		card('G01', '草稿一张', DRAFT, {
			ref: '',
			kind: 'goal',
			domain: '核心',
			createdAt: 5000,
		}),
		card('QD01', '问题卡', 'TASK_STATE_AUTH_REQUIRED', {
			ref: 'question',
			kind: 'design',
			domain: '核心',
			createdAt: 6000,
		}),
		card('RD01', '记录卡', 'TASK_STATE_REJECTED', {
			ref: 'record',
			kind: 'record',
			domain: '核心',
			createdAt: 7000,
		}),
	];
}

const ids = (cards: readonly Card[]): string[] => cards.map((one) => one.id);

/* ────────────────────────── 标题 ────────────────────────── */

test('标题：子串命中', () => {
	const search = createSearch();
	const got = search(sample(), { title: '任务' });
	assert.deepEqual(ids(got).sort(), ['GU01', 'GU02', 'S01']);
});

test('标题：子串命中不要求从头匹配', () => {
	const search = createSearch();
	assert.deepEqual(ids(search(sample(), { title: '调研' })), ['S01']);
	assert.deepEqual(ids(search(sample(), { title: '一张' })), []);
	assert.deepEqual(ids(search(sample(), { title: '一张', status: ['draft'] })), ['G01']);
});

test('标题：大小写不敏感', () => {
	const search = createSearch();
	const cards = [card('A1', 'Hello World', 'TASK_STATE_SUBMITTED')];
	assert.equal(search(cards, { title: 'hello' }).length, 1);
	assert.equal(search(cards, { title: 'WORLD' }).length, 1);
	assert.equal(search(cards, { title: 'helloworld' }).length, 0);
});

test('标题：中文子串 + 前后空白忽略', () => {
	const search = createSearch();
	assert.equal(search(sample(), { title: '  调研  ' }).length, 1);
});

test('标题：空串不筛', () => {
	const search = createSearch();
	assert.equal(search(sample(), { title: '' }).length, 6);
});

test('titleMatches：直接调用的边界', () => {
	assert.equal(titleMatches('abc', undefined), true);
	assert.equal(titleMatches('abc', '   '), true);
	assert.equal(titleMatches('abc', 'b'), true);
	assert.equal(titleMatches('abc', 'z'), false);
});

/* ────────────────────────── 状态 ────────────────────────── */

test('状态：单个状态 id', () => {
	const search = createSearch();
	assert.deepEqual(ids(search(sample(), { status: ['TASK_STATE_COMPLETED'] })), ['S01']);
});

test('状态：数组内 OR', () => {
	const search = createSearch();
	const got = ids(search(sample(), { status: ['TASK_STATE_COMPLETED', 'TASK_STATE_WORKING'] }));
	assert.deepEqual(got.sort(), ['GU02', 'S01', 'WD01']);
});

test('状态：组 id 命中组内全部', () => {
	const search = createSearch();
	const got = ids(search(sample(), { status: ['active'] }));
	assert.deepEqual(got.sort(), ['GU01', 'GU02', 'WD01']);
});

test('状态：组 id 与状态 id 混用', () => {
	const search = createSearch();
	const got = ids(search(sample(), { status: ['ended', 'TASK_STATE_AUTH_REQUIRED'] }));
	assert.deepEqual(got.sort(), ['QD01', 'RD01', 'S01']);
});

test('状态：未知值不命中任何卡（不静默放行）', () => {
	const search = createSearch();
	assert.deepEqual(ids(search(sample(), { status: ['NOT_A_STATE'] })), []);
});

test('isStatusGroup', () => {
	assert.equal(isStatusGroup('draft'), true);
	assert.equal(isStatusGroup('ended'), true);
	assert.equal(isStatusGroup('TASK_STATE_WORKING'), false);
});

/* ─────────────────── 草稿可见性（三态） ─────────────────── */

test('includesDrafts：无 status ⇒ 不含草稿', () => {
	assert.equal(includesDrafts({}), false);
	assert.equal(includesDrafts({ title: 'x' }), false);
	assert.equal(includesDrafts({ status: [] }), false);
});

test('includesDrafts：status 含草稿 id ⇒ 含草稿', () => {
	assert.equal(includesDrafts({ status: [DRAFT] }), true);
});

test('includesDrafts：status 含组 id draft ⇒ 含草稿', () => {
	assert.equal(includesDrafts({ status: ['draft'] }), true);
});

test('includesDrafts：status 只含其它状态 ⇒ 不含草稿', () => {
	assert.equal(includesDrafts({ status: ['TASK_STATE_WORKING'] }), false);
	assert.equal(includesDrafts({ status: ['active', 'ended'] }), false);
});

test('草稿可见性：无 status 时草稿不出现', () => {
	const search = createSearch();
	const got = ids(search(sample(), {}));
	assert.equal(got.includes('G01'), false);
	assert.equal(got.length, 6);
});

test('草稿可见性：指定草稿 id 时只出草稿', () => {
	const search = createSearch();
	assert.deepEqual(ids(search(sample(), { status: [DRAFT] })), ['G01']);
});

test('草稿可见性：指定 draft 组时只出草稿', () => {
	const search = createSearch();
	assert.deepEqual(ids(search(sample(), { status: ['draft'] })), ['G01']);
});

test('草稿可见性：草稿 + 进行 一起要 ⇒ 两者都出', () => {
	const search = createSearch();
	const got = ids(search(sample(), { status: ['draft', 'active'] }));
	assert.deepEqual(got.sort(), ['G01', 'GU01', 'GU02', 'WD01']);
});

test('草稿可见性：可注入不同的草稿状态 id', () => {
	const search = createSearch({ draftState: 'CUSTOM_DRAFT' });
	const cards = [card('X1', '甲', 'CUSTOM_DRAFT'), card('X2', '乙', 'TASK_STATE_SUBMITTED')];
	assert.deepEqual(ids(search(cards, {})), ['X2']);
	assert.deepEqual(ids(search(cards, { status: ['CUSTOM_DRAFT'] })), ['X1']);
});

/* ─────────────────── 多字段 AND ─────────────────── */

test('多字段：AND 语义', () => {
	const search = createSearch();
	const got = ids(search(sample(), { title: '任务', domain: ['核心'], status: ['active'] }));
	assert.deepEqual(got.sort(), ['GU01', 'GU02']);
});

test('多字段：任一不满足即排除', () => {
	const search = createSearch();
	assert.deepEqual(ids(search(sample(), { domain: ['代码'] })), ['WD01']);
	assert.deepEqual(ids(search(sample(), { domain: ['代码'], kind: ['goal'] })), []);
});

test('多字段：kind / templateRef 同时生效', () => {
	const search = createSearch();
	assert.deepEqual(ids(search(sample(), { kind: ['work'] })).sort(), ['S01', 'WD01']);
	/* ⚠ 条件字段是 `templateRef`（不是 `template`）—— 这是搬运前的 bug。 */
	assert.deepEqual(ids(search(sample(), { templateRef: ['research'] })), ['S01']);
});

test('多字段：数组内 OR、数组间 AND', () => {
	const search = createSearch();
	const got = ids(search(sample(), { kind: ['work', 'record'], domain: ['核心'] }));
	assert.deepEqual(got.sort(), ['RD01', 'S01']);
});

test('多字段：领域缺失的卡在领域筛选下被排除', () => {
	const search = createSearch();
	const cards = [card('N1', '无模板', 'TASK_STATE_SUBMITTED')];
	assert.deepEqual(ids(search(cards, {})), ['N1']);
	assert.deepEqual(ids(search(cards, { domain: ['核心'] })), []);
});

/* ────────────────────────── 空条件 ────────────────────────── */

test('空条件：返回全部非草稿卡', () => {
	const search = createSearch();
	const got = search(sample(), {});
	assert.equal(got.length, 6);
	assert.equal(ids(got).includes('G01'), false);
});

test('空条件：空数组等于不筛', () => {
	const search = createSearch();
	const a = ids(search(sample(), { status: [], domain: [], kind: [], templateRef: [] }));
	const b = ids(search(sample(), {}));
	assert.deepEqual(a.sort(), b.sort());
});

test('空条件：空输入返回空', () => {
	const search = createSearch();
	assert.deepEqual(search([], {}), []);
});

/* ─────────────────── updatedBy（事件维度） ─────────────────── */

test('updatedBy：给了结果集才命中', () => {
	const search = createSearch();
	const got = ids(search(sample(), { updatedBy: ['user'], updatedCardIds: ['GU01', 'S01'] }));
	assert.deepEqual(got.sort(), ['GU01', 'S01']);
});

test('updatedBy：给了条件却没给结果集 ⇒ 空（不静默放行全量）', () => {
	const search = createSearch();
	assert.deepEqual(search(sample(), { updatedBy: ['ai'] }), []);
});

test('updatedBy：结果集为空数组 ⇒ 空', () => {
	const search = createSearch();
	assert.deepEqual(search(sample(), { updatedBy: ['ai'], updatedCardIds: [] }), []);
});

/* ────────────────────────── 排序 ────────────────────────── */

test('排序：采纳时间优先于创建时间，倒序', () => {
	const search = createSearch();
	const cards = [
		card('A', '甲', 'TASK_STATE_SUBMITTED', { createdAt: 100 }),
		card('B', '乙', 'TASK_STATE_SUBMITTED', { createdAt: 200, adoptedAt: 900 }),
		card('C', '丙', 'TASK_STATE_SUBMITTED', { createdAt: 300, adoptedAt: 50 }),
	];
	assert.deepEqual(ids(search(cards, {})), ['B', 'A', 'C']);
});

test('排序：缺采纳时间回落创建时间', () => {
	const search = createSearch();
	const cards = [
		card('A', '甲', 'TASK_STATE_SUBMITTED', { createdAt: 100 }),
		card('B', '乙', 'TASK_STATE_SUBMITTED', { createdAt: 300 }),
		card('C', '丙', 'TASK_STATE_SUBMITTED', { createdAt: 200 }),
	];
	assert.deepEqual(ids(search(cards, {})), ['B', 'C', 'A']);
});

test('排序：两个时间都缺的卡排最后，且内部保持输入顺序', () => {
	const search = createSearch();
	const cards = [
		card('N1', '无时间一', 'TASK_STATE_SUBMITTED'),
		card('T1', '有时间', 'TASK_STATE_SUBMITTED', { createdAt: 500 }),
		card('N2', '无时间二', 'TASK_STATE_SUBMITTED'),
	];
	const got = ids(search(cards, {}));
	assert.equal(got[0], 'T1');
	assert.deepEqual(got.slice(1), ['N1', 'N2']);
});

test('排序：非有限数值的时间戳视为缺失', () => {
	const search = createSearch();
	const cards = [
		card('A', '甲', 'TASK_STATE_SUBMITTED', { createdAt: Number.NaN }),
		card('B', '乙', 'TASK_STATE_SUBMITTED', { createdAt: 100 }),
	];
	assert.deepEqual(ids(search(cards, {})), ['B', 'A']);
});

test('排序：没有 history 的卡视为无时间戳，排最后', () => {
	const search = createSearch();
	const cards = [
		card('X', '无历史', 'TASK_STATE_SUBMITTED'),
		card('Y', '有历史', 'TASK_STATE_SUBMITTED', { createdAt: 10 }),
	];
	assert.deepEqual(ids(search(cards, {})), ['Y', 'X']);
});

/* ────────────────────── 纯函数性 ────────────────────── */

test('纯函数：不 mutate 入参数组与卡对象', () => {
	const search = createSearch();
	const input = sample();
	const snapshot = JSON.stringify(input);
	const before = input.map((one) => one);

	search(input, { status: ['active'], title: '任务' });

	assert.equal(JSON.stringify(input), snapshot);
	assert.deepEqual(input, before);
});

test('纯函数：同输入同输出', () => {
	const search = createSearch();
	const a = ids(search(sample(), { kind: ['work'] }));
	const b = ids(search(sample(), { kind: ['work'] }));
	assert.deepEqual(a, b);
});

test('纯函数：返回新数组（不是入参本身）', () => {
	const search = createSearch();
	const input = sample();
	assert.notEqual(search(input, {}) as unknown, input);
});
