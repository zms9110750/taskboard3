/**
 * UI 状态（组 + 折叠态）：纯函数 + store 行为。
 *
 * store 的防抖 / 保存 / 切空间缓存都是**真逻辑**（丢改动就是用户整理白做），
 * 所以用注入的 fetch + 手动定时器测，不依赖 React、不依赖真网络。
 *
 * ⚠ 接口形状跟裁定 B-8（lead `2026-11-28`）走：**每个操作都带 `workspaceId`**
 *   （`getSnapshot(id)` / `ensureLoaded(id)` / `setFolded(id, …)`），
 *   因为「哪个入口在看哪个空间」由调用方持有，store 里没有全局「当前空间」。
 *   最后那一组用例专门钉这个缺陷：一处切空间 / 一处 GET 失败，
 *   **不许**改掉另一处正在看的东西，也不许写到它的名下。
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

/** GET 的 URL 里唯一的「问的是哪个空间」的凭据。 */
function getWorkspaceOf(url: string): string {
	const match = /[?&]workspace=([^&]*)/.exec(url);
	return match?.[1] === undefined ? '' : decodeURIComponent(match[1]);
}

/** PUT 的 body 里写着 `workspace`（URL 上没有）。 */
function putWorkspaceOf(body: string | undefined): string {
	if (body === undefined) return '';
	const parsed = JSON.parse(body) as { workspace?: unknown };
	return typeof parsed.workspace === 'string' ? parsed.workspace : '';
}

/** 每个空间的服务端初始数据。 */
interface FakeData {
	readonly groups?: unknown[];
	readonly folded?: unknown[];
}

interface FakeFetchOptions {
	/** 按空间给 GET 数据；没列到的空间用 `defaultData`。 */
	readonly data?: Readonly<Record<string, FakeData>>;
	/** 默认 GET 数据（省略 = 空状态）。 */
	readonly defaultData?: FakeData;
	/** 初始就失败的空间（也可以事后用 `failing` 增删）。 */
	readonly failing?: readonly string[];
	readonly getOk?: boolean;
	readonly envelopeOk?: boolean;
	readonly putOk?: boolean;
}

/**
 * 假 fetch：GET 按 `workspace=` 返回该空间的数据（可整体 / 按空间失败），
 * PUT 记录并回 ok。
 */
function makeFetch(options: FakeFetchOptions = {}): {
	readonly fetchImpl: UiStateFetch;
	readonly calls: FakeCall[];
	/** 哪些空间的 GET 失败（按空间注入故障 —— B-8 的用例要用它）。 */
	readonly failing: Set<string>;
	putOk: boolean;
	getOk: boolean;
	envelopeOk: boolean;
} {
	const calls: FakeCall[] = [];
	const failing = new Set<string>(options.failing ?? []);
	let putOk = options.putOk ?? true;
	let getOk = options.getOk ?? true;
	let envelopeOk = options.envelopeOk ?? true;
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
		const workspaceId = getWorkspaceOf(url);
		if (!getOk || failing.has(workspaceId)) {
			return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
		}
		const data = options.data?.[workspaceId] ?? options.defaultData ?? {};
		return Promise.resolve({
			ok: true,
			status: 200,
			text: () =>
				Promise.resolve(
					JSON.stringify({
						ok: envelopeOk,
						data: { groups: data.groups ?? [], folded: data.folded ?? [] },
					}),
				),
		});
	};
	return {
		fetchImpl,
		calls,
		failing,
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

/**
 * 手动定时器：可以同时挂多个（**每空间一个防抖槽**，B-8 之后一次可能有多个）。
 *
 * `pending()` = 还挂着的定时器数（不是布尔）；`fire()` = 把当前挂着的全触发。
 */
function makeScheduler(): {
	readonly schedule: (run: () => void, delayMs: number) => () => void;
	readonly pending: () => number;
	readonly fire: () => void;
} {
	const timers = new Map<number, () => void>();
	let nextId = 1;
	return {
		schedule: (run) => {
			const id = nextId;
			nextId += 1;
			timers.set(id, run);
			return () => {
				timers.delete(id);
			};
		},
		pending: () => timers.size,
		fire: () => {
			const runs = [...timers.values()];
			timers.clear();
			for (const run of runs) run();
		},
	};
}

/** 这个空间被 PUT 过几次。 */
function putsOf(calls: readonly FakeCall[], workspaceId: string): FakeCall[] {
	return calls.filter((one) => one.method === 'PUT' && putWorkspaceOf(one.body) === workspaceId);
}

/** 这个空间被 GET 过几次。 */
function getsOf(calls: readonly FakeCall[], workspaceId: string): FakeCall[] {
	return calls.filter((one) => one.method === 'GET' && getWorkspaceOf(one.url) === workspaceId);
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('ui-state store：加载与保存', () => {
	it('ensureLoaded ⇒ GET 一次，该空间的快照变成 loaded（别的空间不受影响）', async () => {
		const fake = makeFetch({
			defaultData: { groups: [{ id: 'g1', memberIds: ['A'] }], folded: ['g1'] },
		});
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl });
		store.ensureLoaded('ws28');
		await tick();
		await tick();
		const snap = store.getSnapshot('ws28');
		assert.equal(snap.loaded, true);
		assert.deepEqual(snap.groups, [{ id: 'g1', memberIds: ['A'] }]);
		assert.deepEqual(snap.folded, ['g1']);
		assert.equal(fake.calls.length, 1);
		assert.ok(fake.calls[0]?.url.includes('ui-state'));
		assert.ok(fake.calls[0]?.url.includes('workspace=ws28'));

		/* 没被指到的空间：快照是空的、未加载，也没发过请求。 */
		const untouched = store.getSnapshot('ws-other');
		assert.equal(untouched.loaded, false);
		assert.equal(untouched.workspaceId, 'ws-other');
		assert.equal(fake.calls.length, 1, '`ensureLoaded` 以外不产生请求');
	});

	it('连点两次只发一次 PUT（同空间防抖）', async () => {
		const fake = makeFetch();
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });
		store.ensureLoaded('ws28');
		await tick();
		await tick();

		store.toggleFolded('ws28', 'A');
		store.toggleFolded('ws28', 'B');
		assert.equal(scheduler.pending(), 1);
		scheduler.fire();
		await tick();
		await tick();

		const puts = putsOf(fake.calls, 'ws28');
		assert.equal(puts.length, 1);
		assert.deepEqual(JSON.parse(puts[0]?.body ?? '{}'), { workspace: 'ws28', groups: [], folded: ['A', 'B'], expanded: [] });
	});

	it('PUT 失败 ⇒ 该空间 error 有原因，但本地整理结果不回滚', async () => {
		const fake = makeFetch({ putOk: false });
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });
		store.ensureLoaded('ws28');
		await tick();
		await tick();

		store.addGroup('ws28', { id: 'g1', memberIds: ['A'] });
		scheduler.fire();
		await tick();
		await tick();

		const snap = store.getSnapshot('ws28');
		assert.deepEqual(snap.groups, [{ id: 'g1', memberIds: ['A'] }]);
		assert.ok((snap.error ?? '').includes('保存失败'), snap.error ?? '(无错误)');
	});

	it('切空间各存一份缓存：切回来不重新 GET', async () => {
		const fake = makeFetch();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl });
		store.ensureLoaded('ws1');
		await tick();
		await tick();
		store.ensureLoaded('ws2');
		await tick();
		await tick();
		const before = fake.calls.filter((one) => one.method === 'GET').length;
		assert.equal(before, 2);

		store.ensureLoaded('ws1');
		await tick();
		assert.equal(fake.calls.filter((one) => one.method === 'GET').length, 2);
		assert.equal(store.getSnapshot('ws1').workspaceId, 'ws1');
		assert.equal(store.getSnapshot('ws1').loaded, true);
	});

	it('flush 立刻把挂起的保存发出去', async () => {
		const fake = makeFetch();
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });
		store.ensureLoaded('ws28');
		await tick();
		await tick();
		store.toggleFolded('ws28', 'A');
		await store.flush();
		assert.equal(putsOf(fake.calls, 'ws28').length, 1);
	});

	it('flush(id) 只落那一个空间；flush() 落所有有挂起保存的空间', async () => {
		const fake = makeFetch();
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });
		store.ensureLoaded('ws1');
		store.ensureLoaded('ws2');
		await tick();
		await tick();

		store.setFolded('ws1', 'A', true);
		store.setFolded('ws2', 'B', true);
		assert.equal(scheduler.pending(), 2, '两个空间各有自己的防抖槽');

		await store.flush('ws1');
		assert.equal(putsOf(fake.calls, 'ws1').length, 1);
		assert.equal(putsOf(fake.calls, 'ws2').length, 0, '没被点名的空间不动');

		await store.flush();
		assert.equal(putsOf(fake.calls, 'ws2').length, 1);
		assert.equal(putsOf(fake.calls, 'ws1').length, 1, '已经落过的空间不会再发一次');
	});

	it('变更广播给所有订阅者（三入口共用一个 store）', async () => {
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
		store.ensureLoaded('ws28');
		await tick();
		await tick();
		const baseline = hits;
		store.toggleFolded('ws28', 'A');
		assert.equal(hits - baseline, 2);
		unsubscribeA();
		unsubscribeB();
		store.toggleFolded('ws28', 'B');
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
		const fake = makeFetch({
			defaultData: { groups: [{ id: 'g1', memberIds: ['A'] }], folded: ['g1'] },
			getOk: false,
		});
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		store.ensureLoaded('ws28');
		await tick();
		await tick();

		const failed = store.getSnapshot('ws28');
		assert.equal(failed.loaded, false, '加载失败必须保持「未加载」态，不能伪装成已加载的空态');
		assert.deepEqual(failed.groups, []);
		assert.ok((failed.error ?? '').includes('读取失败'), failed.error ?? '(无错误)');

		/* 用户随后任意一次本地整理 —— 旧行为会把空 groups PUT 回服务端。 */
		store.toggleFolded('ws28', 'A');
		store.addGroup('ws28', { id: 'g1', memberIds: ['A'] });
		assert.equal(scheduler.pending(), 0, '未加载的空间连防抖都不该排');
		scheduler.fire();
		await tick();
		await tick();
		await store.flush();

		assert.equal(fake.calls.filter((one) => one.method === 'PUT').length, 0);
		assert.equal(fake.calls.length, 1, '只应有那一次失败的 GET');
		assert.equal(store.getSnapshot('ws28').loaded, false);
	});

	it('HTTP 200 但信封 ok:false ⇒ 同样算读取失败，不写回', async () => {
		const fake = makeFetch({
			defaultData: { groups: [{ id: 'g1', memberIds: ['A'] }] },
			envelopeOk: false,
		});
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		store.ensureLoaded('ws28');
		await tick();
		await tick();

		assert.equal(store.getSnapshot('ws28').loaded, false);
		assert.ok((store.getSnapshot('ws28').error ?? '').includes('读取失败'));

		store.toggleFolded('ws28', 'A');
		scheduler.fire();
		await store.flush();
		assert.equal(fake.calls.filter((one) => one.method === 'PUT').length, 0);
	});

	it('加载成功后正常变更仍会保存，且基线是服务端数据（不是空态）', async () => {
		const fake = makeFetch({
			defaultData: { groups: [{ id: 'g1', memberIds: ['A'] }], folded: ['g1'] },
		});
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		store.ensureLoaded('ws28');
		await tick();
		await tick();
		assert.equal(store.getSnapshot('ws28').loaded, true);

		store.toggleFolded('ws28', 'B');
		assert.equal(scheduler.pending(), 1);
		scheduler.fire();
		await tick();
		await tick();

		const puts = putsOf(fake.calls, 'ws28');
		assert.equal(puts.length, 1);
		assert.deepEqual(JSON.parse(puts[0]?.body ?? '{}'), {
			workspace: 'ws28',
			groups: [{ id: 'g1', memberIds: ['A'] }],
			folded: ['g1', 'B'],
			expanded: [],
		});
	});

	it('失败后重试成功 ⇒ 重新 GET（不信本地草稿），重试成功后照常保存', async () => {
		const fake = makeFetch({
			defaultData: { groups: [{ id: 'g1', memberIds: ['A'] }], folded: ['g1'] },
			getOk: false,
		});
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		store.ensureLoaded('ws28');
		await tick();
		await tick();
		assert.equal(store.getSnapshot('ws28').loaded, false);

		/* 未加载期间的本地改动：只留在内存，不排保存。 */
		store.toggleFolded('ws28', 'X');
		assert.equal(scheduler.pending(), 0);
		assert.deepEqual(store.getSnapshot('ws28').folded, ['X']);

		/* 网络恢复：同空间再 ensureLoaded 必须重新请求，不能拿草稿冒充「已加载」。 */
		fake.getOk = true;
		store.ensureLoaded('ws28');
		await tick();
		await tick();

		const loaded = store.getSnapshot('ws28');
		assert.equal(loaded.loaded, true);
		assert.deepEqual(loaded.groups, [{ id: 'g1', memberIds: ['A'] }]);
		assert.deepEqual(loaded.folded, ['g1'], '服务端数据覆盖本地草稿 —— 草稿不是保存基线');
		assert.equal(getsOf(fake.calls, 'ws28').length, 2);
		assert.equal(fake.calls.filter((one) => one.method === 'PUT').length, 0);

		/* 之后的正常变更照常保存，PUT 里是服务端数据 + 这次改动。 */
		store.toggleFolded('ws28', 'X');
		scheduler.fire();
		await tick();
		await tick();

		const puts = putsOf(fake.calls, 'ws28');
		assert.equal(puts.length, 1);
		assert.deepEqual(JSON.parse(puts[0]?.body ?? '{}'), {
			workspace: 'ws28',
			groups: [{ id: 'g1', memberIds: ['A'] }],
			folded: ['g1', 'X'],
			expanded: [],
		});
	});
});

/*
 * 缺陷 B-8（lead `2026-11-28` 裁定）的钉子。
 *
 * 产品意图（`locale/zh.json`）：「三处用同一份数据和同一套组件，但各持自己的选中状态：
 * **在一处切空间，不会改掉另一处正在看的东西。**」
 *
 * 旧实现违背它：store 只有一份「当前快照」，三个入口共享 ⇒ 一处切空间，
 * 另两处正在看的东西被切走，它们的折叠 / 组操作写到**切换后**的空间名下。
 * 现在的核心不变式：**对空间 X 的 commit / saveNow 只碰 X 的快照**。
 */
describe('ui-state store：三入口各看各的空间（缺陷 B-8）', () => {
	it('入口 A 看 ws1、入口 B 看 ws2：A 折叠 ⇒ 只有 ws1 被写，ws2 的 PUT 为 0', async () => {
		const fake = makeFetch({
			data: {
				ws1: { groups: [], folded: [] },
				ws2: { groups: [{ id: 'g2', memberIds: ['B'] }], folded: ['g2'] },
			},
		});
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		/* 两个入口各自订阅自己的键（= 两个 WorkspaceBody 各自的 viewingId）。 */
		store.ensureLoaded('ws1');
		store.ensureLoaded('ws2');
		await tick();
		await tick();
		assert.equal(store.getSnapshot('ws1').loaded, true);
		assert.equal(store.getSnapshot('ws2').loaded, true);

		/* 入口 A 折叠一张卡。 */
		store.setFolded('ws1', 'A', true);
		scheduler.fire();
		await tick();
		await tick();

		const puts = fake.calls.filter((one) => one.method === 'PUT');
		assert.equal(puts.length, 1, '只许有一次写回');
		assert.deepEqual(JSON.parse(puts[0]?.body ?? '{}'), {
			workspace: 'ws1',
			groups: [],
			folded: ['A'],
			expanded: [],
		});
		assert.equal(putsOf(fake.calls, 'ws2').length, 0, 'ws2 的 PUT 必须是 0');

		/* 入口 B 正在看的 ws2：组 / 折叠态一点没动。 */
		assert.deepEqual(store.getSnapshot('ws2').groups, [{ id: 'g2', memberIds: ['B'] }]);
		assert.deepEqual(store.getSnapshot('ws2').folded, ['g2']);
		assert.deepEqual(store.getSnapshot('ws1').folded, ['A']);
	});

	it('入口 B 的 GET 失败 ⇒ 不影响入口 A 的写回；A 的快照不被 B 的失败污染', async () => {
		const fake = makeFetch({
			data: {
				ws1: { groups: [{ id: 'g1', memberIds: ['A'] }], folded: ['g1'] },
				ws2: { groups: [{ id: 'g2', memberIds: ['B'] }], folded: [] },
			},
			failing: ['ws2'],
		});
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		store.ensureLoaded('ws1'); // 入口 A：加载成功
		store.ensureLoaded('ws2'); // 入口 B：GET 失败
		await tick();
		await tick();

		assert.equal(store.getSnapshot('ws1').loaded, true);
		assert.equal(store.getSnapshot('ws2').loaded, false);
		assert.ok((store.getSnapshot('ws2').error ?? '').includes('读取失败'));

		/* B 那边折叠（未加载）⇒ 连防抖都不排，更不会碰 A。 */
		store.setFolded('ws2', 'X', true);
		assert.equal(scheduler.pending(), 0, '未加载的空间不是保存基线');

		/* A 折叠 ⇒ 照常写回，基线是 ws1 的服务端数据。 */
		store.setFolded('ws1', 'B', true);
		assert.equal(scheduler.pending(), 1);
		scheduler.fire();
		await tick();
		await tick();

		assert.equal(putsOf(fake.calls, 'ws1').length, 1);
		assert.deepEqual(JSON.parse(putsOf(fake.calls, 'ws1')[0]?.body ?? '{}'), {
			workspace: 'ws1',
			groups: [{ id: 'g1', memberIds: ['A'] }],
			folded: ['g1', 'B'],
			expanded: [],
		});
		assert.equal(putsOf(fake.calls, 'ws2').length, 0);

		/* A 的快照没有 B 的失败痕迹；B 的快照也没有 A 的折叠。 */
		assert.equal(store.getSnapshot('ws1').error, undefined);
		assert.deepEqual(store.getSnapshot('ws1').folded, ['g1', 'B']);
		assert.deepEqual(store.getSnapshot('ws2').folded, ['X']);
	});

	it('入口 A 切到 ws2 再切回 ws1 ⇒ ws1 的本地状态还在（cache 命中，不重新 GET）', async () => {
		const fake = makeFetch({
			data: {
				ws1: { groups: [], folded: ['A'] },
				ws2: { groups: [], folded: [] },
			},
		});
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		store.ensureLoaded('ws1');
		await tick();
		await tick();

		/* A 在 ws1 里折叠一张卡（还在防抖里，没发出去）。 */
		store.setFolded('ws1', 'B', true);
		assert.equal(scheduler.pending(), 1);

		/* A 切到 ws2：ws1 的挂起保存 **不许**被取消 / 丢掉。 */
		store.ensureLoaded('ws2');
		await tick();
		await tick();
		assert.equal(scheduler.pending(), 1, '切空间不取消 ws1 的挂起保存');
		assert.equal(store.getSnapshot('ws2').loaded, true);

		/* A 再切回 ws1：本地状态还在，且没有再 GET 一次（cache 命中）。 */
		store.ensureLoaded('ws1');
		const back = store.getSnapshot('ws1');
		assert.equal(back.loaded, true);
		assert.deepEqual(back.folded, ['A', 'B'], '切回来本地状态还在');
		assert.equal(getsOf(fake.calls, 'ws1').length, 1, 'ws1 只 GET 过一次');

		/* 挂起的那次保存最终仍然写到 ws1，且是本地整理后的状态。 */
		scheduler.fire();
		await tick();
		await tick();
		assert.deepEqual(JSON.parse(putsOf(fake.calls, 'ws1')[0]?.body ?? '{}'), {
			workspace: 'ws1',
			groups: [],
			folded: ['A', 'B'],
			expanded: [],
		});
		assert.equal(putsOf(fake.calls, 'ws2').length, 0);
	});

	it('一个空间变了 ⇒ 只有它自己的快照换对象（别的键身份不变 ⇒ 别的入口不重渲染）', async () => {
		const fake = makeFetch({ data: { ws1: {}, ws2: {} } });
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		store.ensureLoaded('ws1');
		store.ensureLoaded('ws2');
		await tick();
		await tick();

		const ws2Before = store.getSnapshot('ws2');
		const ws1Before = store.getSnapshot('ws1');
		store.setFolded('ws1', 'A', true);

		assert.notEqual(store.getSnapshot('ws1'), ws1Before, 'ws1 自己的快照换了');
		assert.equal(store.getSnapshot('ws2'), ws2Before, 'ws2 的快照还是同一个对象');
		assert.equal(store.getSnapshot('ws1'), store.getSnapshot('ws1'), '同一空间的快照必须稳定');
	});

	it('空 id（还没有空间）⇒ 不加载、不保存，操作被忽略', async () => {
		const fake = makeFetch();
		const scheduler = makeScheduler();
		const store = createUiStateStore({ fetchImpl: fake.fetchImpl, schedule: scheduler.schedule });

		store.ensureLoaded('');
		store.setFolded('', 'A', true);
		await store.flush();

		assert.equal(fake.calls.length, 0, '没有空间 ⇒ 一个请求都不发');
		assert.equal(scheduler.pending(), 0);
		assert.deepEqual(store.getSnapshot('').folded, [], '没有空间时连本地草稿都不落');
	});
});
