/**
 * `packages/search` 的测试。
 *
 * 跑法（Node 24 直接执行 `.ts`）：
 *
 * ```powershell
 * & $env:DSH_NODE_EXECUTABLE --test packages/search/test/match.test.ts
 * ```
 *
 * ## 测试覆盖什么
 *
 * | 组 | 用例 |
 * |---|---|
 * | 标题 | 子串、大小写、中文、空串不筛 |
 * | 状态 | 单状态、多状态 OR、组 id、组 id × 状态 id 混用 |
 * | **草稿可见性** | 三态（无 status / 含草稿 / 不含草稿）+ 组 id `draft` |
 * | 多字段 | AND 语义 |
 * | 排序 | 采纳时间优先于创建时间、倒序、缺时间戳不丢卡 |
 * | 纯函数性 | 不 mutate 入参、同输入同输出 |
 * | 无 node 依赖 | 源码里不出现 `from 'node:` |
 *
 * ## 测试里的 `groupOf` 从哪来
 *
 * 本包不再自带状态分组表（见 `src/types.ts` 顶部）。测试**直接 import
 * protocol 的 `status.ts` 源码** —— 它零 import，Node 24 能直接跑。
 * 这同时证明了 `groupOf` 的注入路径可用。
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { STATUS_GROUP_OF } from '../../protocol/src/status.ts';
import {
	createSearch,
	includesDrafts,
	isStatusGroup,
	titleMatches,
	DEFAULT_DRAFT_STATE,
} from '../src/index.ts';
import type { SearchableCard, SearchOptions } from '../src/index.ts';

const DRAFT = DEFAULT_DRAFT_STATE;

/** 唯一的注入点：状态 → 组名，真值来自 protocol。 */
const GROUPS: SearchOptions = {
	groupOf: (status) => STATUS_GROUP_OF[status as keyof typeof STATUS_GROUP_OF],
};

/** 造一张卡，只写关心的字段。 */
function card(
	id: string,
	title: string,
	status: string,
	extra: Partial<SearchableCard> = {},
): SearchableCard {
	return { id, title, status, ...extra };
}

/** 一组覆盖各状态、各类别、各时间戳的样本卡。 */
function sample(): SearchableCard[] {
	return [
		card('GU01', '用户任务一', 'TASK_STATE_SUBMITTED', {
			template: { ref: 'userNeed', kind: 'goal', domain: '核心' },
			createdAt: 1000,
		}),
		card('GU02', '用户任务二', 'TASK_STATE_WORKING', {
			template: { ref: 'userNeed', kind: 'goal', domain: '核心' },
			createdAt: 2000,
			adoptedAt: 2500,
		}),
		card('S01', '调研任务', 'TASK_STATE_COMPLETED', {
			template: { ref: 'research', kind: 'work', domain: '核心' },
			createdAt: 3000,
			adoptedAt: 9000,
		}),
		card('WD01', '写代码', 'TASK_STATE_WORKING', {
			template: { ref: 'writeCode', kind: 'work', domain: '代码' },
			createdAt: 4000,
		}),
		card('G01', '草稿一张', DRAFT, {
			template: { ref: '', kind: 'goal', domain: '核心' },
			createdAt: 5000,
		}),
		card('QD01', '问题卡', 'TASK_STATE_AUTH_REQUIRED', {
			template: { ref: 'question', kind: 'design', domain: '核心' },
			createdAt: 6000,
		}),
		card('RD01', '记录卡', 'TASK_STATE_REJECTED', {
			template: { ref: 'record', kind: 'record', domain: '核心' },
			createdAt: 7000,
		}),
	];
}

const ids = (cards: readonly SearchableCard[]): string[] => cards.map((one) => one.id);

/* ────────────────────────── 标题 ────────────────────────── */

test('标题：子串命中', () => {
	const search = createSearch(GROUPS);
	/* 样本里含「任务」的有三张：用户任务一 / 用户任务二 / 调研任务 */
	const got = search(sample(), { title: '任务' });
	assert.deepEqual(ids(got).sort(), ['GU01', 'GU02', 'S01']);
});

test('标题：子串命中不要求从头匹配', () => {
	const search = createSearch(GROUPS);
	assert.deepEqual(ids(search(sample(), { title: '调研' })), ['S01']);
	assert.deepEqual(ids(search(sample(), { title: '一张' })), []); // 「草稿一张」是草稿，默认不可见
	assert.deepEqual(ids(search(sample(), { title: '一张', status: ['draft'] })), ['G01']);
});

test('标题：大小写不敏感', () => {
	const search = createSearch(GROUPS);
	const cards = [card('A1', 'Hello World', 'TASK_STATE_SUBMITTED')];
	assert.equal(search(cards, { title: 'hello' }).length, 1);
	assert.equal(search(cards, { title: 'WORLD' }).length, 1);
	assert.equal(search(cards, { title: 'helloworld' }).length, 0);
});

test('标题：中文子串 + 前后空白忽略', () => {
	const search = createSearch(GROUPS);
	assert.equal(search(sample(), { title: '  调研  ' }).length, 1);
});

test('标题：空串不筛', () => {
	const search = createSearch(GROUPS);
	assert.equal(search(sample(), { title: '' }).length, 6); // 草稿仍被可见性规则排除
});

test('titleMatches：直接调用的边界', () => {
	assert.equal(titleMatches('abc', undefined), true);
	assert.equal(titleMatches('abc', '   '), true);
	assert.equal(titleMatches('abc', 'b'), true);
	assert.equal(titleMatches('abc', 'z'), false);
});

/* ────────────────────────── 状态 ────────────────────────── */

test('状态：单个状态 id', () => {
	const search = createSearch(GROUPS);
	assert.deepEqual(ids(search(sample(), { status: ['TASK_STATE_COMPLETED'] })), ['S01']);
});

test('状态：数组内 OR', () => {
	const search = createSearch(GROUPS);
	const got = ids(search(sample(), { status: ['TASK_STATE_COMPLETED', 'TASK_STATE_WORKING'] }));
	assert.deepEqual(got.sort(), ['GU02', 'S01', 'WD01']);
});

test('状态：组 id 命中组内全部', () => {
	const search = createSearch(GROUPS);
	/* active = 提交 + 处理中 */
	const got = ids(search(sample(), { status: ['active'] }));
	assert.deepEqual(got.sort(), ['GU01', 'GU02', 'WD01']);
});

test('状态：组 id 与状态 id 混用', () => {
	const search = createSearch(GROUPS);
	/* ended = 成功/失败/取消/拒绝；再加一个独立的「需要授权」 */
	const got = ids(search(sample(), { status: ['ended', 'TASK_STATE_AUTH_REQUIRED'] }));
	assert.deepEqual(got.sort(), ['QD01', 'RD01', 'S01']);
});

test('状态：未知值不命中任何卡（不静默放行）', () => {
	const search = createSearch(GROUPS);
	assert.deepEqual(ids(search(sample(), { status: ['NOT_A_STATE'] })), []);
});

test('状态：groupOf 返回 undefined 时只按状态 id 精确判定', () => {
	const search = createSearch({ groupOf: () => undefined });
	const cards = [card('A1', '甲', 'TASK_STATE_WORKING'), card('A2', '乙', 'TASK_STATE_SUBMITTED')];
	/* 组 id 匹配不上任何卡（没有映射），状态 id 仍能精确命中 */
	assert.deepEqual(ids(search(cards, { status: ['active'] })), []);
	assert.deepEqual(ids(search(cards, { status: ['TASK_STATE_WORKING'] })), ['A1']);
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
	const search = createSearch(GROUPS);
	const got = ids(search(sample(), {}));
	assert.equal(got.includes('G01'), false);
	assert.equal(got.length, 6);
});

test('草稿可见性：指定草稿 id 时只出草稿', () => {
	const search = createSearch(GROUPS);
	assert.deepEqual(ids(search(sample(), { status: [DRAFT] })), ['G01']);
});

test('草稿可见性：指定 draft 组时只出草稿', () => {
	const search = createSearch(GROUPS);
	assert.deepEqual(ids(search(sample(), { status: ['draft'] })), ['G01']);
});

test('草稿可见性：草稿 + 进行 一起要 ⇒ 两者都出', () => {
	const search = createSearch(GROUPS);
	const got = ids(search(sample(), { status: ['draft', 'active'] }));
	assert.deepEqual(got.sort(), ['G01', 'GU01', 'GU02', 'WD01']);
});

test('草稿可见性：可注入不同的草稿状态 id', () => {
	const search = createSearch({ ...GROUPS, draftState: 'CUSTOM_DRAFT' });
	const cards = [card('X1', '甲', 'CUSTOM_DRAFT'), card('X2', '乙', 'TASK_STATE_SUBMITTED')];
	assert.deepEqual(ids(search(cards, {})), ['X2']);
	assert.deepEqual(ids(search(cards, { status: ['CUSTOM_DRAFT'] })), ['X1']);
});

/* ─────────────────── 多字段 AND ─────────────────── */

test('多字段：AND 语义', () => {
	const search = createSearch(GROUPS);
	/* 标题含「任务」∩ 领域=核心 ∩ 状态组=进行 */
	const got = ids(search(sample(), { title: '任务', domain: ['核心'], status: ['active'] }));
	assert.deepEqual(got.sort(), ['GU01', 'GU02']);
});

test('多字段：任一不满足即排除', () => {
	const search = createSearch(GROUPS);
	/* 「写代码」在代码领域、work 类别 —— 加「核心」领域就排除它 */
	assert.deepEqual(ids(search(sample(), { domain: ['代码'] })), ['WD01']);
	assert.deepEqual(ids(search(sample(), { domain: ['代码'], kind: ['goal'] })), []);
});

test('多字段：kind / template 同时生效', () => {
	const search = createSearch(GROUPS);
	assert.deepEqual(ids(search(sample(), { kind: ['work'] })).sort(), ['S01', 'WD01']);
	assert.deepEqual(ids(search(sample(), { template: ['research'] })), ['S01']);
});

test('多字段：数组内 OR、数组间 AND', () => {
	const search = createSearch(GROUPS);
	const got = ids(search(sample(), { kind: ['work', 'record'], domain: ['核心'] }));
	assert.deepEqual(got.sort(), ['RD01', 'S01']);
});

test('多字段：领域缺失的卡在领域筛选下被排除', () => {
	const search = createSearch(GROUPS);
	const cards = [card('N1', '无模板', 'TASK_STATE_SUBMITTED')];
	assert.deepEqual(ids(search(cards, {})), ['N1']);
	assert.deepEqual(ids(search(cards, { domain: ['核心'] })), []);
});

/* ────────────────────────── 空条件 ────────────────────────── */

test('空条件：返回全部非草稿卡', () => {
	const search = createSearch(GROUPS);
	const got = search(sample(), {});
	assert.equal(got.length, 6);
	assert.equal(ids(got).includes('G01'), false);
});

test('空条件：空数组等于不筛', () => {
	const search = createSearch(GROUPS);
	const a = ids(search(sample(), { status: [], domain: [], kind: [], template: [] }));
	const b = ids(search(sample(), {}));
	assert.deepEqual(a.sort(), b.sort());
});

test('空条件：空输入返回空', () => {
	const search = createSearch(GROUPS);
	assert.deepEqual(search([], {}), []);
});

/* ─────────────────── updatedBy（事件维度） ─────────────────── */

test('updatedBy：给了结果集才命中', () => {
	const search = createSearch(GROUPS);
	const got = ids(search(sample(), { updatedBy: ['user'], updatedCardIds: ['GU01', 'S01'] }));
	assert.deepEqual(got.sort(), ['GU01', 'S01']);
});

test('updatedBy：给了条件却没给结果集 ⇒ 空（不静默放行全量）', () => {
	const search = createSearch(GROUPS);
	assert.deepEqual(search(sample(), { updatedBy: ['ai'] }), []);
});

test('updatedBy：结果集为空数组 ⇒ 空', () => {
	const search = createSearch(GROUPS);
	assert.deepEqual(search(sample(), { updatedBy: ['ai'], updatedCardIds: [] }), []);
});

/* ────────────────────────── 排序 ────────────────────────── */

test('排序：采纳时间优先于创建时间，倒序', () => {
	const search = createSearch(GROUPS);
	const cards = [
		card('A', '甲', 'TASK_STATE_SUBMITTED', { createdAt: 100 }),
		card('B', '乙', 'TASK_STATE_SUBMITTED', { createdAt: 200, adoptedAt: 900 }),
		card('C', '丙', 'TASK_STATE_SUBMITTED', { createdAt: 300, adoptedAt: 50 }),
	];
	/* B(900) > A(100) > C(50) —— C 有采纳时间就用采纳时间，不用创建时间 */
	assert.deepEqual(ids(search(cards, {})), ['B', 'A', 'C']);
});

test('排序：缺采纳时间回落创建时间', () => {
	const search = createSearch(GROUPS);
	const cards = [
		card('A', '甲', 'TASK_STATE_SUBMITTED', { createdAt: 100 }),
		card('B', '乙', 'TASK_STATE_SUBMITTED', { createdAt: 300 }),
		card('C', '丙', 'TASK_STATE_SUBMITTED', { createdAt: 200 }),
	];
	assert.deepEqual(ids(search(cards, {})), ['B', 'C', 'A']);
});

test('排序：两个时间都缺的卡排最后，且内部保持输入顺序', () => {
	const search = createSearch(GROUPS);
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
	const search = createSearch(GROUPS);
	const cards = [
		card('A', '甲', 'TASK_STATE_SUBMITTED', { createdAt: Number.NaN }),
		card('B', '乙', 'TASK_STATE_SUBMITTED', { createdAt: 100 }),
	];
	assert.deepEqual(ids(search(cards, {})), ['B', 'A']);
});

/* ────────────────────── 纯函数性 ────────────────────── */

test('纯函数：不 mutate 入参数组与卡对象', () => {
	const search = createSearch(GROUPS);
	const input = sample();
	const snapshot = JSON.stringify(input);
	const before = input.map((one) => one);

	search(input, { status: ['active'], title: '任务' });

	assert.equal(JSON.stringify(input), snapshot);
	assert.deepEqual(input, before);
});

test('纯函数：同输入同输出', () => {
	const search = createSearch(GROUPS);
	const a = ids(search(sample(), { kind: ['work'] }));
	const b = ids(search(sample(), { kind: ['work'] }));
	assert.deepEqual(a, b);
});

test('纯函数：返回新数组（不是入参本身）', () => {
	const search = createSearch(GROUPS);
	const input = sample();
	assert.notEqual(search(input, {}) as unknown, input);
});

/* ─────────────────── 不依赖 node / 第三方 ─────────────────── */

test('源码不 import node: 或第三方', () => {
	const srcDir = join(import.meta.dirname, '..', 'src');
	const files = readdirSync(srcDir).filter((name) => name.endsWith('.ts'));
	assert.ok(files.length > 0, 'src 下应当有 .ts 文件');

	for (const name of files) {
		/*
		 * 先剥掉注释再匹配：JSDoc 的 `@example` 里会出现
		 * `import { STATUS_GROUP_OF } from '@local/taskboard3-protocol'`
		 * 这类**示范代码**，它不是真实依赖。
		 */
		const raw = readFileSync(join(srcDir, name), 'utf8');
		const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');

		/* 只看真实的 import / export ... from 语句。 */
		const specifiers = [...text.matchAll(/^\s*(?:import|export)[^;]*?from\s+'([^']+)'/gmu)].map(
			(match) => match[1],
		);
		for (const specifier of specifiers) {
			assert.ok(
				specifier !== undefined && specifier.startsWith('.'),
				`${name} 只允许相对 import，发现：${specifier}`,
			);
			assert.equal(
				/^node:/.test(specifier),
				false,
				`${name} 不得 import node: 内置模块，发现：${specifier}`,
			);
		}
	}
});

/* ──────────────── 注入约定的编译期锁定 ──────────────── */

test('createSearch 的 groupOf 是必传项', () => {
	/*
	 * 运行时拿不到类型，这里改为**源码断言**：`createSearch` 的签名里
	 * `groupOf` 不能是可选（`groupOf?:`）。这是「不留第二处真值」的守门人。
	 */
	const src = readFileSync(join(import.meta.dirname, '..', 'src', 'types.ts'), 'utf8');
	assert.equal(
		/readonly groupOf\?:/.test(src),
		false,
		'SearchOptions.groupOf 必须必传，不得写成可选',
	);
	assert.ok(
		/readonly groupOf:/.test(src),
		'SearchOptions.groupOf 应当是必传字段',
	);
});
