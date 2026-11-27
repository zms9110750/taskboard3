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

/** 假 fetch：GET 返回给定数据（可切换成失败），PUT 记录并回 ok。 */
function makeFetch(
	initial: { groups?: unknown[]; folded?: unknown[] } = {},
	initialGet: { readonly ok?: boolean; readonly envelopeOk?: boolean } = {},
): {
	readonly fetchImpl: UiStateFetch;
	readonly calls: FakeCall[];
	putOk: boolean;
	getOk: boolean;
	envelopeOk: boolean;
} {
	const calls: FakeCall[] = [];
	let putOk = true;
	let getOk = initialGet.ok ?? true;
	let envelopeOk = initialGet.envelopeOk ?? true;
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
		if (!getOk) {
			return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
		}
		return Promise.resolve({
			ok: true,
			status: 200,
			text: () =>
				Promise.resolve(
					JSON.stringify({
						ok: envelopeOk,
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
		get getOk() {
			return getOk;
		},
		set getOk(value: boolean) {
			getOk = value;
		},
		get envelopeOk() {
			return envelopeOk;
		},
		set envelopeOk(value: boolean) {
			envelopeOk = value;
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

/*
 * 裁定（todo-audit 2026-11-27 逐行核实、2026-11-28 修复）：**加载失败 ≠ 空状态**。
 *
 * 这几条钉的是数据丢失契约，不是实现细节：
 * · GET 失败 ⇒ 一次写回都不许发生（PUT 调用次数必须是 0）；
 * · 失败得到的「空」不能当这个空间的值（不能被缓存成已加载）；
 * · 加载成功之后，正常的折叠 / 组操作照常保存，且基线是**服务端数据**；
 * · 失败期间的本地改动不是保存基线 —— 重试成功后以服务端为准。
 */
describe('ui-state store：加载失败不得触发任何写回（裁定：加载失败 ≠ 空状态）', () => {
	it('GET 失败 ⇒ 未加载态；之后的折叠 / 加组不排保存，PUT 次数 0', async () => {
		const fake = makeFetch(
			{ groups: [{ id: 'g1', memberIds: ['A'] }], folded: ['g1'] },
			{ ok: false },
		);
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		store.setWorkspace('ws28');
		await tick();
		await tick();

		const failed = store.getSnapshot();
		assert.equal(failed.loaded, false, '加载失败必须保持「未加载」态，不能伪装成已加载的空态');
		assert.deepEqual(failed.groups, []);
		assert.ok((failed.error ?? '').includes('读取失败'), failed.error ?? '(无错误)');

		/* 用户随后任意一次本地整理 —— 旧行为会把空 groups PUT 回服务端。 */
		store.toggleFolded('A');
		store.addGroup({ id: 'g1', memberIds: ['A'] });
		assert.equal(scheduler.pending(), 0, '未加载的空间连防抖都不该排');
		scheduler.fire();
		await tick();
		await tick();
		await store.flush();

		assert.equal(fake.calls.filter((one) => one.method === 'PUT').length, 0);
		assert.equal(fake.calls.length, 1, '只应有那一次失败的 GET');
		assert.equal(store.getSnapshot().loaded, false);
	});

	it('HTTP 200 但信封 ok:false ⇒ 同样算读取失败，不写回', async () => {
		const fake = makeFetch(
			{ groups: [{ id: 'g1', memberIds: ['A'] }] },
			{ envelopeOk: false },
		);
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		store.setWorkspace('ws28');
		await tick();
		await tick();

		assert.equal(store.getSnapshot().loaded, false);
		assert.ok((store.getSnapshot().error ?? '').includes('读取失败'));

		store.toggleFolded('A');
		scheduler.fire();
		await store.flush();
		assert.equal(fake.calls.filter((one) => one.method === 'PUT').length, 0);
	});

	it('加载成功后正常变更仍会保存，且基线是服务端数据（不是空态）', async () => {
		const fake = makeFetch({ groups: [{ id: 'g1', memberIds: ['A'] }], folded: ['g1'] });
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		store.setWorkspace('ws28');
		await tick();
		await tick();
		assert.equal(store.getSnapshot().loaded, true);

		store.toggleFolded('B');
		assert.equal(scheduler.pending(), 1);
		scheduler.fire();
		await tick();
		await tick();

		const puts = fake.calls.filter((one) => one.method === 'PUT');
		assert.equal(puts.length, 1);
		assert.deepEqual(JSON.parse(puts[0]?.body ?? '{}'), {
			workspace: 'ws28',
			groups: [{ id: 'g1', memberIds: ['A'] }],
			folded: ['g1', 'B'],
			expanded: [],
		});
	});

	it('失败后重试成功 ⇒ 重新 GET（不信本地草稿），重试成功后照常保存', async () => {
		const fake = makeFetch(
			{ groups: [{ id: 'g1', memberIds: ['A'] }], folded: ['g1'] },
			{ ok: false },
		);
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		store.setWorkspace('ws28');
		await tick();
		await tick();
		assert.equal(store.getSnapshot().loaded, false);

		/* 未加载期间的本地改动：只留在内存，不排保存。 */
		store.toggleFolded('X');
		assert.equal(scheduler.pending(), 0);
		assert.deepEqual(store.getSnapshot().folded, ['X']);

		/* 网络恢复：同空间再 setWorkspace 必须重新请求，不能拿草稿冒充「已加载」。 */
		fake.getOk = true;
		store.setWorkspace('ws28');
		await tick();
		await tick();

		const loaded = store.getSnapshot();
		assert.equal(loaded.loaded, true);
		assert.deepEqual(loaded.groups, [{ id: 'g1', memberIds: ['A'] }]);
		assert.deepEqual(loaded.folded, ['g1'], '服务端数据覆盖本地草稿 —— 草稿不是保存基线');
		assert.equal(fake.calls.filter((one) => one.method === 'GET').length, 2);
		assert.equal(fake.calls.filter((one) => one.method === 'PUT').length, 0);

		/* 之后的正常变更照常保存，PUT 里是服务端数据 + 这次改动。 */
		store.toggleFolded('X');
		scheduler.fire();
		await tick();
		await tick();

		const puts = fake.calls.filter((one) => one.method === 'PUT');
		assert.equal(puts.length, 1);
		assert.deepEqual(JSON.parse(puts[0]?.body ?? '{}'), {
			workspace: 'ws28',
			groups: [{ id: 'g1', memberIds: ['A'] }],
			folded: ['g1', 'X'],
			expanded: [],
		});
	});
});
