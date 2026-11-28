/**
 * 工具组图的**持久化 + 生效集**（issue #66 第 2、3 点）。
 *
 * 钉住四件事：
 *
 * 1. 键不存在 ⇒ 空图（**不是错误**，旧 profile 的正常状态）
 * 2. 写入走 store 的 kv，**重开实例能读回**
 * 3. 坏数据 ⇒ 空图 + warn，**不覆盖**；第一次写入前先备份到 `toolGraph:corrupt:<时间戳>`
 * 4. 组工具集：有图 = 包含闭包，无图 = 旧 `groups[g]` 增量（并集语义不变）
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTaskboard, effectiveToolsOf, type CardStore, type Taskboard } from '../src/index.ts';
import { createMemoryStore } from './memory-store.ts';
import { makeTemplate } from './support-v2.ts';

/** 坏数据备份用的固定时间戳（`now` 注入 ⇒ 备份键可断言）。 */
const AT = 1_700_000_000_000;

/** 合法图：编码工具 → 写操作 → tool:write。 */
const VALID_DOC = {
	groups: [
		{ name: '编码工具', column: 0 },
		{ name: '写操作', column: 1 },
	],
	edges: [
		{ from: 'group:编码工具', to: 'group:写操作' },
		{ from: 'group:写操作', to: 'tool:write' },
	],
};

/** 建一个内存任务板（可预置 kv，可注入 now）。 */
function board(store: CardStore = createMemoryStore()): Taskboard {
	return createTaskboard({ store, now: () => AT });
}

/** 预置 kv 的 store。 */
function storeWith(kv: Record<string, string>): CardStore {
	const store = createMemoryStore();
	for (const [key, value] of Object.entries(kv)) void store.kvSet(key, value);
	return store;
}

/** 建一个任务板 + 注册一个工作模板（生效集用例要按模板命中组）。 */
function boardWithWorkTemplate(store: CardStore = createMemoryStore()): Taskboard {
	const tb = board(store);
	tb.templates().register(makeTemplate({ ref: 't-work', kind: 'work' }));
	return tb;
}

/** 建任务板并收集启动期的 `console.warn`。 */
function boardReadingBadKv(store: CardStore): { readonly tb: Taskboard; readonly warnings: readonly string[] } {
	const warnings: string[] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]): void => {
		warnings.push(args.map((one) => String(one)).join(' '));
	};
	try {
		return { tb: board(store), warnings };
	} finally {
		console.warn = original;
	}
}

/* ────────────────────────── 读写 ────────────────────────── */

describe('toolGraph:v1 持久化', () => {
	it('键不存在 ⇒ 空图，不告警、不是错误', () => {
		const { tb, warnings } = boardReadingBadKv(createMemoryStore());
		assert.deepEqual(tb.getToolGraph(), { groups: [], edges: [] });
		assert.deepEqual(warnings, [], '没有键是正常状态（旧 profile），不该 warn');
	});

	it('写入 ⇒ 重开实例能读回（走 store.kvSet，不是内存黑箱）', async () => {
		const store = createMemoryStore();
		const first = board(store);
		const saved = await first.setToolGraph(VALID_DOC);
		assert.equal(saved.ok, true);

		const second = board(store);
		assert.deepEqual(second.getToolGraph(), {
			groups: [
				{ name: '编码工具', column: 0 },
				{ name: '写操作', column: 1 },
			],
			edges: [
				{ from: 'group:编码工具', to: 'group:写操作' },
				{ from: 'group:写操作', to: 'tool:write' },
			],
		});
	});

	it('返回的是**规范化后**的图（组名 trim / column 补 0）', async () => {
		const tb = board();
		const saved = await tb.setToolGraph({
			groups: [{ name: ' 编码工具 ' }],
			edges: [],
		});
		assert.equal(saved.ok, true);
		if (!saved.ok) return;
		assert.deepEqual(saved.doc.groups, [{ name: '编码工具', column: 0 }]);
		assert.deepEqual(tb.getToolGraph(), saved.doc);
	});

	it('非法图被拒 ⇒ **不落库**，缓存也不变', async () => {
		const store = createMemoryStore();
		const tb = board(store);
		await tb.setToolGraph(VALID_DOC);
		const before = store.kvGet('toolGraph:v1');

		const rejected = await tb.setToolGraph({
			groups: [{ name: 'A', column: 0 }],
			edges: [{ from: 'group:A', to: 'group:A' }],
		});
		assert.equal(rejected.ok, false);
		if (!rejected.ok) assert.equal(rejected.code, 'SELF_LOOP');

		assert.equal(store.kvGet('toolGraph:v1'), before, '被拒的图绝不能写进 kv');
		assert.deepEqual(tb.getToolGraph(), VALID_DOC, '缓存保持上一份合法的图');
	});
});

/* ────────────────────────── 坏数据 ────────────────────────── */

describe('坏数据：空图 + warn + 不覆盖（写之前先备份）', () => {
	it('非法 JSON ⇒ 空图 + warn，启动时原值不动', () => {
		const store = storeWith({ 'toolGraph:v1': '{ 这不是 JSON' });
		const { tb, warnings } = boardReadingBadKv(store);

		assert.deepEqual(tb.getToolGraph(), { groups: [], edges: [] });
		assert.equal(warnings.length, 1, '必须留痕，不许静默');
		assert.match(warnings[0] ?? '', /toolGraph:v1/);
		assert.match(warnings[0] ?? '', /备份/);
		assert.equal(store.kvGet('toolGraph:v1'), '{ 这不是 JSON', '启动只读不写 ⇒ 坏数据不被覆盖');
	});

	it('结构合法但成环 ⇒ 同样按坏数据对待', () => {
		const cyclic = JSON.stringify({
			groups: [
				{ name: 'A', column: 0 },
				{ name: 'B', column: 1 },
			],
			edges: [
				{ from: 'group:A', to: 'group:B' },
				{ from: 'group:B', to: 'group:A' },
			],
		});
		const { tb, warnings } = boardReadingBadKv(storeWith({ 'toolGraph:v1': cyclic }));
		assert.deepEqual(tb.getToolGraph(), { groups: [], edges: [] });
		assert.equal(warnings.length, 1);
		assert.match(warnings[0] ?? '', /会成环/);
	});

	it('第一次写入前备份到 toolGraph:corrupt:<时间戳>，然后才覆盖主键', async () => {
		const store = storeWith({ 'toolGraph:v1': '{ 坏掉的' });
		const tb = board(store);

		const saved = await tb.setToolGraph(VALID_DOC);
		assert.equal(saved.ok, true);

		assert.equal(store.kvGet(`toolGraph:corrupt:${String(AT)}`), '{ 坏掉的', '原值必须能找回来');
		assert.deepEqual(JSON.parse(store.kvGet('toolGraph:v1') ?? 'null'), VALID_DOC, '主键已是新图');
	});

	it('备份只做一次：第二次写入不再产生新备份键', async () => {
		const store = storeWith({ 'toolGraph:v1': '坏' });
		const tb = board(store);
		await tb.setToolGraph(VALID_DOC);
		await tb.setToolGraph({ groups: [], edges: [] });
		assert.equal(store.kvGet(`toolGraph:corrupt:${String(AT)}`), '坏');
	});
});

/* ────────────────────────── 生效集：图接入 / 旧行为回退 ────────────────────────── */

describe('effectiveToolsOf：组的工具集从哪来', () => {
	it('有图 ⇒ 用包含闭包（A 含 B、B 含 tool:x ⇒ 命中 A 让 x 生效）', async () => {
		const tb = boardWithWorkTemplate();
		await tb.setGroupMembers('A', ['t-work']);
		const saved = await tb.setToolGraph({
			groups: [
				{ name: 'A', column: 0 },
				{ name: 'B', column: 1 },
			],
			edges: [
				{ from: 'group:A', to: 'group:B' },
				{ from: 'group:B', to: 'tool:x' },
			],
		});
		assert.equal(saved.ok, true);

		assert.ok(tb.effectiveToolsOf('t-work').includes('x'), '闭包里的工具要生效');
	});

	it('无图 ⇒ 回退旧行为：groups[g] 的增量照旧生效', async () => {
		const tb = boardWithWorkTemplate();
		await tb.setGroupMembers('编码工具', ['t-work']);
		await tb.setGroupPolicy('编码工具', ['bash']);

		assert.ok(tb.effectiveToolsOf('t-work').includes('bash'), '旧数据（没有图）必须一个字都不变');
	});

	it('有图 ⇒ 不再叠加 groups[g]（图是组的唯一真值，删掉的工具不会复活）', async () => {
		const tb = boardWithWorkTemplate();
		await tb.setGroupMembers('编码工具', ['t-work']);
		await tb.setGroupPolicy('编码工具', ['bash']);

		/* 有图，但图里没有「编码工具」这一组 ⇒ 闭包为空。 */
		await tb.setToolGraph({
			groups: [{ name: '别的组', column: 0 }],
			edges: [{ from: 'group:别的组', to: 'tool:y' }],
		});
		const effective = tb.effectiveToolsOf('t-work');
		assert.equal(effective.includes('bash'), false, '有图时 groups[g] 不再是真值');
	});

	it('并集语义不变：BASE ∪ 未领取 ∪ common ∪ 命中组 ∪ 独立档', async () => {
		const tb = boardWithWorkTemplate();
		await tb.setToolPolicyScope({ tier: 'unclaimed', allow: ['u'] });
		await tb.setToolPolicyScope({ tier: 'claimed', allow: ['c'] });
		await tb.setGroupMembers('G', ['t-work']);
		await tb.setToolPolicyScope({ templateRef: 't-work', allow: ['own'] });
		await tb.setToolGraph({
			groups: [{ name: 'G', column: 0 }],
			edges: [{ from: 'group:G', to: 'tool:g' }],
		});

		const effective = tb.effectiveToolsOf('t-work');
		for (const tool of ['u', 'c', 'g', 'own']) {
			assert.ok(effective.includes(tool), `${tool} 应该生效`);
		}
	});

	it('getToolPolicies() 带出 graph —— guard 与页面看同一份真值', async () => {
		const tb = boardWithWorkTemplate();
		await tb.setToolGraph(VALID_DOC);
		const policies = tb.getToolPolicies();
		assert.deepEqual(policies.graph, VALID_DOC);
	});

	it('graph 是**可选**字段：不传 ⇒ 旧行为；传 ⇒ 闭包（兼容旧调用方）', () => {
		/*
		 * 旧调用方（或 v2 之前构造的 store 字面量）没有 graph 字段 ——
		 * 那种情况下必须**一个字都不变**地走 `groups[g]`。
		 */
		const legacy = {
			unclaimed: [] as readonly string[],
			common: [] as readonly string[],
			groups: { 编码工具: ['bash'] } as Readonly<Record<string, readonly string[]>>,
			groupMembers: { 编码工具: ['t-work'] } as Readonly<Record<string, readonly string[]>>,
			templates: {} as Readonly<Record<string, readonly string[]>>,
		};

		assert.ok(effectiveToolsOf(legacy, 't-work').includes('bash'), '不传图 ⇒ 读 groups[g]');
		assert.equal(effectiveToolsOf(legacy, 't-work').includes('write'), false);

		const withGraph = {
			...legacy,
			graph: {
				groups: [{ name: '编码工具', column: 0 }],
				edges: [{ from: 'group:编码工具', to: 'tool:write' }],
			},
		};
		assert.ok(effectiveToolsOf(withGraph, 't-work').includes('write'), '传图 ⇒ 用闭包');
		assert.equal(effectiveToolsOf(withGraph, 't-work').includes('bash'), false);
	});
});
