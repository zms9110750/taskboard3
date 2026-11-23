/**
 * UI 状态（组 + 折叠态）：纯函数单测 + 路由单测。
 *
 * ## 为什么路由测试也放这里
 *
 * `http.test.ts` 已经 63KB，且它的 `depsOf` 拖着一整套模板夹具 —— 这里只需要
 * 「路由分派 + 鉴权 + 信封 + kv 往返」，用最小替身更清楚。
 * 两边都测同一个 handler，不重复：那边测业务路由，这边测这条 UI-only 端点。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createTaskboard, type Taskboard } from '@taskboard/core';
import { createSqliteStore } from '@taskboard/io';

import { createHandler, ROUTE_PREFIX, type RouteDeps } from '../src/http.ts';
import type { OutgoingLike, ReadableIncoming } from '../src/types.ts';
import {
	EMPTY_UI_STATE,
	parseFolded,
	parseUiGroups,
	serializeFolded,
	serializeUiGroups,
	uiFoldedKeyOf,
	uiGroupsKeyOf,
	validateUiStateBody,
} from '../src/ui-state.ts';

/* ────────────────────────────── 请求 / 响应替身 ────────────────────────────── */

function makeReq(options: {
	method?: string;
	url?: string;
	body?: unknown;
}): ReadableIncoming {
	const chunks: string[] = options.body === undefined ? [] : [JSON.stringify(options.body)];
	return {
		method: options.method ?? 'GET',
		url: options.url ?? '/',
		headers: { host: '127.0.0.1:3000' },
		async *[Symbol.asyncIterator]() {
			for (const chunk of chunks) yield chunk;
		},
	};
}

interface FakeRes extends OutgoingLike {
	readonly status: () => number;
	readonly body: () => string;
	readonly json: () => unknown;
}

function makeRes(): FakeRes {
	let status = 200;
	let text = '';
	return {
		set statusCode(value: number) {
			status = value;
		},
		get statusCode() {
			return status;
		},
		setHeader() {
			/* 测试不关心 header */
		},
		end(chunk?: string) {
			if (typeof chunk === 'string') text = chunk;
		},
		status: () => status,
		body: () => text,
		/*
		 * 405 是**纯文本**（`sendMethodNotAllowed` 不写信封）⇒ 这里不能无脑 `JSON.parse`。
		 * 解析不了就返回 `undefined`，调用方只看状态码。
		 */
		json: () => {
			try {
				return JSON.parse(text) as unknown;
			} catch {
				return undefined;
			}
		},
	};
}

/* ────────────────────────────── 纯函数 ────────────────────────────── */

describe('UI 状态：kv 键', () => {
	it('按工作空间分（VS 的 .vs 类比：状态属于容器，不属于卡）', () => {
		assert.equal(uiGroupsKeyOf('ws28'), 'ui.groups.ws28');
		assert.equal(uiFoldedKeyOf('ws28'), 'ui.folded.ws28');
		assert.notEqual(uiGroupsKeyOf('ws1'), uiGroupsKeyOf('ws2'));
	});
});

describe('UI 状态：组解析（读路径必须容错）', () => {
	it('坏 JSON ⇒ 空数组，不抛', () => {
		assert.deepEqual(parseUiGroups('{不是数组'), []);
		assert.deepEqual(parseUiGroups(''), []);
		assert.deepEqual(parseUiGroups(undefined), []);
	});

	it('不是数组 ⇒ 空数组', () => {
		assert.deepEqual(parseUiGroups('{"id":"g1"}'), []);
	});

	it('名字为空 / 缺省 ⇒ 键不出现（不是 name: ""）', () => {
		const parsed = parseUiGroups('[{"id":"g1","memberIds":[],"name":""}]');
		assert.equal(parsed.length, 1);
		assert.equal('name' in parsed[0]!, false);
	});

	it('脏条目被跳过，好的留下', () => {
		const parsed = parseUiGroups(
			'[{"id":"g1","memberIds":["A"]},{"nope":1},{"id":"","memberIds":[]},{"id":"g2","memberIds":["B","B",""]}]',
		);
		assert.deepEqual(parsed, [
			{ id: 'g1', memberIds: ['A'] },
			{ id: 'g2', memberIds: ['B'] },
		]);
	});

	it('组 id 重复 ⇒ 先到的赢', () => {
		const parsed = parseUiGroups('[{"id":"g1","memberIds":["A"]},{"id":"g1","memberIds":["B"]}]');
		assert.deepEqual(parsed, [{ id: 'g1', memberIds: ['A'] }]);
	});

	it('一张卡不能进两个组 ⇒ 后出现的成员被剔掉', () => {
		const parsed = parseUiGroups('[{"id":"g1","memberIds":["A","B"]},{"id":"g2","memberIds":["B","C"]}]');
		assert.deepEqual(parsed, [
			{ id: 'g1', memberIds: ['A', 'B'] },
			{ id: 'g2', memberIds: ['C'] },
		]);
	});
});

describe('UI 状态：折叠态解析', () => {
	it('坏数据 / 非数组 ⇒ 空数组', () => {
		assert.deepEqual(parseFolded('oops'), []);
		assert.deepEqual(parseFolded('{"a":1}'), []);
		assert.deepEqual(parseFolded(undefined), []);
	});

	it('去重、剔空', () => {
		assert.deepEqual(parseFolded('["g1","g1","","card:1"]'), ['g1', 'card:1']);
	});
});

describe('UI 状态：序列化', () => {
	it('省略 name 时序列化里没有 name 键', () => {
		assert.equal(serializeUiGroups([{ id: 'g1', memberIds: ['A'] }]), '[{"id":"g1","memberIds":["A"]}]');
	});

	it('有 name 时原样带出', () => {
		assert.equal(
			serializeUiGroups([{ id: 'g1', name: '根卡', memberIds: ['A'] }]),
			'[{"id":"g1","name":"根卡","memberIds":["A"]}]',
		);
	});

	it('序列化 → 解析 往返一致', () => {
		const groups = [
			{ id: 'g1', memberIds: ['A', 'B'] },
			{ id: 'g2', name: '第二组', memberIds: ['C'] },
		];
		assert.deepEqual(parseUiGroups(serializeUiGroups(groups)), groups);
		const folded = ['g1', 'card:9'];
		assert.deepEqual(parseFolded(serializeFolded(folded)), folded);
	});
});

describe('UI 状态：PUT body 校验', () => {
	it('workspace 缺失 ⇒ 拒绝', () => {
		const checked = validateUiStateBody({ groups: [], folded: [] });
		assert.equal(checked.ok, false);
		if (checked.ok) return;
		assert.equal(checked.path, '/workspace');
	});

	it('groups 不是数组 ⇒ 拒绝', () => {
		const checked = validateUiStateBody({ workspace: 'ws1', groups: {}, folded: [] });
		assert.equal(checked.ok, false);
		if (checked.ok) return;
		assert.equal(checked.path, '/groups');
	});

	it('组形状不对 ⇒ 指到具体下标', () => {
		const checked = validateUiStateBody({
			workspace: 'ws1',
			groups: [{ id: 'g1', memberIds: [] }, { id: 'g2' }],
			folded: [],
		});
		assert.equal(checked.ok, false);
		if (checked.ok) return;
		assert.equal(checked.path, '/groups/1');
	});

	it('同一张卡进两个组 ⇒ 拒绝', () => {
		const checked = validateUiStateBody({
			workspace: 'ws1',
			groups: [
				{ id: 'g1', memberIds: ['A'] },
				{ id: 'g2', memberIds: ['A'] },
			],
			folded: [],
		});
		assert.equal(checked.ok, false);
		if (checked.ok) return;
		assert.ok(checked.message.includes('最多属于一个组'), checked.message);
	});

	it('合法 body ⇒ 原样（折叠态去重）', () => {
		const checked = validateUiStateBody({
			workspace: '  ws1  ',
			groups: [{ id: 'g1', memberIds: ['A'] }],
			folded: ['g1', 'g1', 'card:1'],
		});
		assert.equal(checked.ok, true);
		if (!checked.ok) return;
		assert.equal(checked.value.workspace, 'ws1');
		assert.deepEqual(checked.value.folded, ['g1', 'card:1']);
		assert.deepEqual(checked.value.groups, [{ id: 'g1', memberIds: ['A'] }]);
	});
});

/* ────────────────────────────── 路由 ────────────────────────────── */

describe('GET / PUT /api/ui-state（真 handler + 真 SQLite kv）', () => {
	let dir = '';
	let store: ReturnType<typeof createSqliteStore>;
	let taskboard: Taskboard;

	const depsOf = (overrides: Partial<RouteDeps> = {}): RouteDeps => ({
		taskboard,
		kv: store,
		connection: { requestRejection: () => undefined },
		defaultWorkspaceId: () => Promise.resolve('ws-default'),
		...overrides,
	});

	const call = async (deps: RouteDeps, options: { method?: string; url: string; body?: unknown }) => {
		const handler = createHandler(deps);
		const out = makeRes();
		await handler(makeReq(options), out);
		return { status: out.status(), json: out.json() as Record<string, unknown>, body: out.body() };
	};

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-ui-state-'));
		store = createSqliteStore(dir);
		taskboard = createTaskboard({ store });
		await taskboard.createWorkspace('UI 状态测试');
	});

	after(async () => {
		/* ⚠ 先关 sqlite 再删目录，否则 Windows 上 EPERM（踩过）。 */
		await taskboard.close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	});

	it('没写过的空间 ⇒ 空结构（不是 null）', async () => {
		const out = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/ui-state?workspace=ws-empty` });
		assert.equal(out.status, 200);
		const data = (out.json as { data: unknown }).data;
		assert.deepEqual(data, EMPTY_UI_STATE);
	});

	it('PUT 后 GET 拿回同一份（name 缺省不被塞成空串）', async () => {
		const put = await call(depsOf(), {
			method: 'PUT',
			url: `${ROUTE_PREFIX}/api/ui-state`,
			body: { workspace: 'ws28', groups: [{ id: 'g1', memberIds: ['GE01', 'GE02'] }], folded: ['g1'] },
		});
		assert.equal(put.status, 200);

		const get = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/ui-state?workspace=ws28` });
		assert.equal(get.status, 200);
		assert.deepEqual((get.json as { data: unknown }).data, {
			groups: [{ id: 'g1', memberIds: ['GE01', 'GE02'] }],
			folded: ['g1'],
			expanded: [],
		});
	});

	it('写进 kv 的键名就是 ui.groups.<ws> / ui.folded.<ws>', () => {
		assert.equal(store.kvGet('ui.groups.ws28'), '[{"id":"g1","memberIds":["GE01","GE02"]}]');
		assert.equal(store.kvGet('ui.folded.ws28'), '["g1"]');
	});

	it('按空间隔离：另一个空间读不到 ws28 的组', async () => {
		const out = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/ui-state?workspace=ws-other` });
		assert.deepEqual((out.json as { data: unknown }).data, EMPTY_UI_STATE);
	});

	it('kv 里是坏 JSON ⇒ 返回空结构，不 500', async () => {
		await store.kvSet('ui.groups.ws-broken', '{坏');
		await store.kvSet('ui.folded.ws-broken', '也不是数组');
		const out = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/ui-state?workspace=ws-broken` });
		assert.equal(out.status, 200);
		assert.deepEqual((out.json as { data: unknown }).data, EMPTY_UI_STATE);
	});

	it('不合法 body ⇒ 400 + 具体 path', async () => {
		const out = await call(depsOf(), {
			method: 'PUT',
			url: `${ROUTE_PREFIX}/api/ui-state`,
			body: { workspace: '', groups: [], folded: [] },
		});
		assert.equal(out.status, 400);
		const payload = out.json as { ok: boolean; code: string; issues?: { path: string }[] };
		assert.equal(payload.ok, false);
		assert.equal(payload.code, 'FIELD_REQUIRED');
		assert.equal(payload.issues?.[0]?.path, '/workspace');
	});

	it('方法不对 ⇒ 405', async () => {
		const out = await call(depsOf(), { method: 'DELETE', url: `${ROUTE_PREFIX}/api/ui-state` });
		assert.equal(out.status, 405);
	});

	it('鉴权先于一切：401 时连 kv 都不读', async () => {
		const out = await call(depsOf({ connection: { requestRejection: () => 401 } }), {
			url: `${ROUTE_PREFIX}/api/ui-state?workspace=ws28`,
		});
		assert.equal(out.status, 401);
	});

	it('不带 workspace 参数 ⇒ 用入口默认空间（与 /api/state 同一策略）', async () => {
		await call(depsOf(), {
			method: 'PUT',
			url: `${ROUTE_PREFIX}/api/ui-state`,
			body: { workspace: 'ws-default', groups: [], folded: ['card:7'] },
		});
		const out = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/ui-state` });
		assert.deepEqual((out.json as { data: unknown }).data, { groups: [], folded: ['card:7'], expanded: [] });
	});
});
