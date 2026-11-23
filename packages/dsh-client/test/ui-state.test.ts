/**
 * UI 状态（组 + 折叠态）：纯函数 + store 行为。
 *
 * store 的防抖 / 保存 / 切空间缓存都是**真逻辑**（丢改动就是用户整理白做），
 * 所以用注入的 fetch + 手动定时器测，不依赖 React、不依赖真网络。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	EMPTY_UI_STATE,
	foldedSetOf,
	groupOfCard,
	parseUiState,
	shareSameParent,
	toSaveBody,
	withFoldedToggled,
	withGroupAdded,
	withGroupRemoved,
	withGroupRenamed,
	withMemberAdded,
	withMemberRemoved,
	withMissingCardsPruned,
} from '../src/pure/ui-state.ts';
import { createUiStateStore, type UiStateFetch } from '../src/ui-state-store.ts';

/* ────────────────────────────── 纯函数 ────────────────────────────── */

describe('UI 状态：解析（网络边界，必须容错）', () => {
	it('乱七八糟的输入 ⇒ 空状态，不抛', () => {
		assert.deepEqual(parseUiState(undefined), EMPTY_UI_STATE);
		assert.deepEqual(parseUiState(null), EMPTY_UI_STATE);
		assert.deepEqual(parseUiState('x'), EMPTY_UI_STATE);
		assert.deepEqual(parseUiState({ groups: 'nope', folded: 3 }), EMPTY_UI_STATE);
	});

	it('脏组被跳过，好组留下；名字空 ⇒ 不出现 name 键', () => {
		const data = parseUiState({
			groups: [
				{ id: 'g1', memberIds: ['A'], name: '' },
				{ nope: 1 },
				{ id: '', memberIds: [] },
				{ id: 'g2', memberIds: ['B', 'B', ''] },
			],
			folded: ['g1', 'g1', '', 7],
		});
		assert.deepEqual(data.groups, [
			{ id: 'g1', memberIds: ['A'] },
			{ id: 'g2', memberIds: ['B'] },
		]);
		assert.deepEqual(data.folded, ['g1']);
	});

	it('一张卡出现在两个组 ⇒ 后出现的那个丢掉这张卡', () => {
		const data = parseUiState({
			groups: [
				{ id: 'g1', memberIds: ['A', 'B'] },
				{ id: 'g2', memberIds: ['B', 'C'] },
			],
			folded: [],
		});
		assert.deepEqual(data.groups, [
			{ id: 'g1', memberIds: ['A', 'B'] },
			{ id: 'g2', memberIds: ['C'] },
		]);
	});
});

describe('UI 状态：折叠', () => {
	it('切换加入 / 移出', () => {
		const on = withFoldedToggled(EMPTY_UI_STATE, 'g1');
		assert.deepEqual(on.folded, ['g1']);
		const off = withFoldedToggled(on, 'g1');
		assert.deepEqual(off.folded, []);
	});

	it('foldedSetOf 用于 O(1) 查询', () => {
		assert.equal(foldedSetOf(['a']).has('a'), true);
		assert.equal(foldedSetOf(['a']).has('b'), false);
	});
});

describe('UI 状态：组', () => {
	it('加组：id 重复 ⇒ 幂等（不覆盖已有）', () => {
		const base = withGroupAdded(EMPTY_UI_STATE, { id: 'g1', memberIds: ['A'] });
		const again = withGroupAdded(base, { id: 'g1', memberIds: ['B'] });
		assert.equal(again, base);
	});

	it('加组：成员从别的组里被摘走（一张卡最多一个组）', () => {
		let state = withGroupAdded(EMPTY_UI_STATE, { id: 'g1', memberIds: ['A', 'B'] });
		state = withGroupAdded(state, { id: 'g2', memberIds: ['B', 'C'] });
		assert.deepEqual(state.groups, [
			{ id: 'g1', memberIds: ['A'] },
			{ id: 'g2', memberIds: ['B', 'C'] },
		]);
	});

	it('删组：成员回到未分组，折叠集合里的同名 id 也清掉', () => {
		let state = withGroupAdded(EMPTY_UI_STATE, { id: 'g1', memberIds: ['A'] });
		state = withFoldedToggled(state, 'g1');
		const next = withGroupRemoved(state, 'g1');
		assert.deepEqual(next.groups, []);
		assert.deepEqual(next.folded, []);
	});

	it('改名：undefined / 空串 ⇒ name 键消失（不写空串）', () => {
		let state = withGroupAdded(EMPTY_UI_STATE, { id: 'g1', name: '根卡', memberIds: ['A'] });
		assert.equal(state.groups[0]?.name, '根卡');
		state = withGroupRenamed(state, 'g1', '  ');
		assert.equal('name' in (state.groups[0] ?? {}), false);
		state = withGroupRenamed(state, 'g1', '  新名字  ');
		assert.equal(state.groups[0]?.name, '新名字');
	});

	it('加成员：从别的组摘走；同组已有 ⇒ 原样', () => {
		let state = withGroupAdded(EMPTY_UI_STATE, { id: 'g1', memberIds: ['A'] });
		state = withGroupAdded(state, { id: 'g2', memberIds: ['B'] });
		const moved = withMemberAdded(state, 'g2', 'A');
		assert.deepEqual(moved.groups, [
			{ id: 'g1', memberIds: [] },
			{ id: 'g2', memberIds: ['B', 'A'] },
		]);
		assert.equal(withMemberAdded(moved, 'g2', 'A'), moved);
	});

	it('移成员：组空了就删组（不留空壳）', () => {
		const state = withGroupAdded(EMPTY_UI_STATE, { id: 'g1', memberIds: ['A'] });
		assert.deepEqual(withMemberRemoved(state, 'g1', 'A').groups, []);
	});

	it('按现有卡清理：卡没了 ⇒ 剔除；组空了 ⇒ 删组；折叠态不动', () => {
		let state = withGroupAdded(EMPTY_UI_STATE, { id: 'g1', memberIds: ['A', 'B'] });
		state = withFoldedToggled(state, 'A');
		const pruned = withMissingCardsPruned(state, new Set(['A']));
		assert.deepEqual(pruned.groups, [{ id: 'g1', memberIds: ['A'] }]);
		assert.deepEqual(pruned.folded, ['A']);
		assert.deepEqual(withMissingCardsPruned(pruned, new Set(['X'])).groups, []);
	});

	it('groupOfCard 查归属', () => {
		const state = withGroupAdded(EMPTY_UI_STATE, { id: 'g1', memberIds: ['A'] });
		assert.equal(groupOfCard(state.groups, 'A')?.id, 'g1');
		assert.equal(groupOfCard(state.groups, 'B'), undefined);
	});
});

describe('UI 状态：同父才可成组（用户 2026-11-24）', () => {
	const parents = new Map<string, string | null>([
		['A', null],
		['B', null],
		['C', 'P1'],
		['D', 'P1'],
		['E', 'P2'],
	]);
	const parentOf = (id: string): string | null | undefined => parents.get(id);

	it('全是根卡 ⇒ 可以', () => {
		assert.equal(shareSameParent(['A', 'B'], parentOf), true);
	});

	it('同一个父 ⇒ 可以', () => {
		assert.equal(shareSameParent(['C', 'D'], parentOf), true);
	});

	it('不同父 / 根卡混有父卡 ⇒ 不行', () => {
		assert.equal(shareSameParent(['C', 'E'], parentOf), false);
		assert.equal(shareSameParent(['A', 'C'], parentOf), false);
	});

	it('不存在的卡 / 空集合 ⇒ 不行', () => {
		assert.equal(shareSameParent(['A', 'ZZ'], parentOf), false);
		assert.equal(shareSameParent([], parentOf), false);
	});
});

describe('UI 状态：PUT body', () => {
	it('没名字的组不带 name 键', () => {
		const body = toSaveBody('ws1', { groups: [{ id: 'g1', memberIds: ['A'] }], folded: [], expanded: [] });
		assert.equal(JSON.stringify(body), '{"workspace":"ws1","groups":[{"id":"g1","memberIds":["A"]}],"folded":[],"expanded":[]}');
	});
});

/* ────────────────────────────── store ────────────────────────────── */

interface FakeCall {
	readonly url: string;
	readonly method: string;
	readonly body: string | undefined;
}

/** 假 fetch：GET 返回给定数据，PUT 记录并回 ok。 */
function makeFetch(initial: { groups?: unknown[]; folded?: unknown[] } = {}): {
	readonly fetchImpl: UiStateFetch;
	readonly calls: FakeCall[];
	putOk: boolean;
} {
	const calls: FakeCall[] = [];
	let putOk = true;
	const fetchImpl: UiStateFetch = (url, init) => {
		const method = init?.method ?? 'GET';
		calls.push({ url, method, body: init?.body });
		if (method === 'PUT') {
			return Promise.resolve({
				ok: putOk,
				status: putOk ? 200 : 500,
				text: () => Promise.resolve(JSON.stringify({ ok: putOk, data: { saved: putOk } })),
			});
		}
		return Promise.resolve({
			ok: true,
			status: 200,
			text: () =>
				Promise.resolve(
					JSON.stringify({
						ok: true,
						data: { groups: initial.groups ?? [], folded: initial.folded ?? [] },
					}),
				),
		});
	};
	return {
		fetchImpl,
		calls,
		get putOk() {
			return putOk;
		},
		set putOk(value: boolean) {
			putOk = value;
		},
	};
}

/** 手动定时器：记录并允许「触发」。 */
function makeScheduler(): {
	readonly schedule: (run: () => void, delayMs: number) => () => void;
	readonly pending: () => number;
	readonly fire: () => void;
} {
	let queued: (() => void) | undefined;
	return {
		schedule: (run) => {
			queued = run;
			return () => {
				queued = undefined;
			};
		},
		pending: () => (queued === undefined ? 0 : 1),
		fire: () => {
			const run = queued;
			queued = undefined;
			run?.();
		},
	};
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('ui-state store：加载与保存', () => {
	it('setWorkspace ⇒ GET 一次，快照变成 loaded', async () => {
		const fake = makeFetch({ groups: [{ id: 'g1', memberIds: ['A'] }], folded: ['g1'] });
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl });
		store.setWorkspace('ws28');
		await tick();
		await tick();
		const snap = store.getSnapshot();
		assert.equal(snap.loaded, true);
		assert.deepEqual(snap.groups, [{ id: 'g1', memberIds: ['A'] }]);
		assert.deepEqual(snap.folded, ['g1']);
		assert.equal(fake.calls.length, 1);
		assert.ok(fake.calls[0]?.url.includes('ui-state'));
		assert.ok(fake.calls[0]?.url.includes('workspace=ws28'));
	});

	it('连点两次只发一次 PUT（防抖）', async () => {
		const fake = makeFetch();
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });
		store.setWorkspace('ws28');
		await tick();
		await tick();

		store.toggleFolded('A');
		store.toggleFolded('B');
		assert.equal(scheduler.pending(), 1);
		scheduler.fire();
		await tick();
		await tick();

		const puts = fake.calls.filter((one) => one.method === 'PUT');
		assert.equal(puts.length, 1);
		assert.deepEqual(JSON.parse(puts[0]?.body ?? '{}'), { workspace: 'ws28', groups: [], folded: ['A', 'B'], expanded: [] });
	});

	it('PUT 失败 ⇒ error 有原因，但本地整理结果不回滚', async () => {
		const fake = makeFetch();
		fake.putOk = false;
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });
		store.setWorkspace('ws28');
		await tick();
		await tick();

		store.addGroup({ id: 'g1', memberIds: ['A'] });
		scheduler.fire();
		await tick();
		await tick();

		const snap = store.getSnapshot();
		assert.deepEqual(snap.groups, [{ id: 'g1', memberIds: ['A'] }]);
		assert.ok((snap.error ?? '').includes('保存失败'), snap.error ?? '(无错误)');
	});

	it('切空间各存一份缓存：切回来不重新 GET', async () => {
		const fake = makeFetch();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl });
		store.setWorkspace('ws1');
		await tick();
		await tick();
		store.setWorkspace('ws2');
		await tick();
		await tick();
		const before = fake.calls.filter((one) => one.method === 'GET').length;
		assert.equal(before, 2);

		store.setWorkspace('ws1');
		await tick();
		assert.equal(fake.calls.filter((one) => one.method === 'GET').length, 2);
		assert.equal(store.getSnapshot().workspaceId, 'ws1');
	});

	it('flush 立刻把挂起的保存发出去', async () => {
		const fake = makeFetch();
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });
		store.setWorkspace('ws28');
		await tick();
		await tick();
		store.toggleFolded('A');
		await store.flush();
		assert.equal(fake.calls.filter((one) => one.method === 'PUT').length, 1);
	});

	it('三个订阅者都能收到变更（三入口同一份数据）', async () => {
		const fake = makeFetch();
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });
		let hits = 0;
		const unsubscribeA = store.subscribe(() => {
			hits += 1;
		});
		const unsubscribeB = store.subscribe(() => {
			hits += 1;
		});
		store.setWorkspace('ws28');
		await tick();
		await tick();
		const baseline = hits;
		store.toggleFolded('A');
		assert.equal(hits - baseline, 2);
		unsubscribeA();
		unsubscribeB();
		store.toggleFolded('B');
		assert.equal(hits - baseline, 2);
	});
});
