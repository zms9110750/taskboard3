/**
 * `GET / PUT /api/tool-graph`（issue #66）：路由 + 校验 + 读写回环。
 *
 * ## 为什么要单独一个文件
 *
 * 与 `tool-policy-route.test.ts` 同一理由：这里只需要「路由分派 + 鉴权 +
 * 信封 + core 真值」，用最小替身（真 handler + 真 SQLite）最清楚。
 *
 * ## 重点断言
 *
 * 1. `PUT` 成功 ⇒ **落库后的图**回给客户端，`GET` 能原样读回（刷新还在）
 * 2. 成环 ⇒ **400 + 环路径**，而且**不落库**（GET 还是上一份合法图）
 * 3. 坏数据（非法 JSON）⇒ GET 空图 + 不覆盖；第一次 PUT 前先备份
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

/* ────────────────────────────── 请求 / 响应替身 ────────────────────────────── */

function makeReq(options: { method?: string; url: string; body?: unknown }): ReadableIncoming {
	const chunks: string[] = options.body === undefined ? [] : [JSON.stringify(options.body)];
	return {
		method: options.method ?? 'GET',
		url: options.url,
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
		json: () => {
			try {
				return JSON.parse(text) as unknown;
			} catch {
				return undefined;
			}
		},
	};
}

/** 图文档（响应 `data` / 请求 body）。 */
interface GraphPayload {
	readonly groups: readonly { readonly name: string; readonly column: number }[];
	readonly edges: readonly { readonly from: string; readonly to: string }[];
}

/** 统一信封（成功看 `data`，失败看 `code` + `detail`）。 */
interface Envelope {
	readonly ok?: boolean;
	readonly data?: GraphPayload;
	readonly code?: string;
	readonly detail?: { readonly code?: string; readonly cycle?: readonly string[] };
}

/* ────────────────────────────── 主用例 ────────────────────────────── */

describe('GET / PUT /api/tool-graph（真 handler + 真 SQLite）', () => {
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
		return { status: out.status(), json: out.json() as Envelope, body: out.body() };
	};

	/** issue #66 的例子：编码工具 含 写操作，编码工具 含 tool:write。 */
	const DOC: GraphPayload = {
		groups: [
			{ name: '编码工具', column: 0 },
			{ name: '写操作', column: 1 },
		],
		edges: [
			{ from: 'group:编码工具', to: 'group:写操作' },
			{ from: 'group:编码工具', to: 'tool:write' },
		],
	};

	const url = `${ROUTE_PREFIX}/api/tool-graph`;

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-tool-graph-'));
		store = createSqliteStore(dir);
		taskboard = createTaskboard({ store });
		await taskboard.createWorkspace('组图测试');
	});

	after(async () => {
		/* ⚠ 先关 sqlite 再删目录，否则 Windows 上 EPERM（踩过）。 */
		await taskboard.close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	});

	it('GET：没有图 ⇒ 200 + 空图（不是错误）', async () => {
		const out = await call(depsOf(), { url });
		assert.equal(out.status, 200);
		assert.equal(out.json.ok, true);
		assert.deepEqual(out.json.data, { groups: [], edges: [] });
	});

	it('PUT 合法图 ⇒ 200 + 落库后的图；GET 能读回', async () => {
		const put = await call(depsOf(), { method: 'PUT', url, body: DOC });
		assert.equal(put.status, 200);
		assert.equal(put.json.ok, true);
		assert.deepEqual(put.json.data, DOC);

		const get = await call(depsOf(), { url });
		assert.equal(get.status, 200);
		assert.deepEqual(get.json.data, DOC, '刷新后改动还在');
	});

	it('PUT 成环 ⇒ 400 + 环路径，且**不落库**', async () => {
		const cyclic: GraphPayload = {
			groups: [
				{ name: '编码工具', column: 0 },
				{ name: '写操作', column: 1 },
				{ name: '文件类', column: 2 },
			],
			edges: [
				{ from: 'group:编码工具', to: 'group:写操作' },
				{ from: 'group:写操作', to: 'group:文件类' },
				{ from: 'group:文件类', to: 'group:编码工具' },
			],
		};
		const out = await call(depsOf(), { method: 'PUT', url, body: cyclic });
		assert.equal(out.status, 400);
		assert.equal(out.json.ok, false);
		assert.equal(out.json.code, 'FIELD_REQUIRED', '信封仍是 protocol 的 Failure');
		assert.equal(out.json.detail?.code, 'CYCLE', '图的判定码在 detail 里');
		assert.deepEqual(out.json.detail?.cycle, [
			'group:文件类',
			'group:编码工具',
			'group:写操作',
			'group:文件类',
		]);

		const get = await call(depsOf(), { url });
		assert.deepEqual(get.json.data, DOC, '被拒的图绝不能覆盖已落库的图');
	});

	it('PUT 非组出边 ⇒ 400 + NOT_GROUP', async () => {
		const out = await call(depsOf(), {
			method: 'PUT',
			url,
			body: { groups: [{ name: 'A', column: 0 }], edges: [{ from: 'tool:write', to: 'group:A' }] },
		});
		assert.equal(out.status, 400);
		assert.equal(out.json.detail?.code, 'NOT_GROUP');
	});

	it('PUT 坏形状（groups 不是数组）⇒ 400 + BAD_SHAPE', async () => {
		const out = await call(depsOf(), {
			method: 'PUT',
			url,
			body: { groups: {}, edges: [] },
		});
		assert.equal(out.status, 400);
		assert.equal(out.json.detail?.code, 'BAD_SHAPE');
	});

	it('PUT 空 body ⇒ 400（不是静默清空）', async () => {
		const out = await call(depsOf(), { method: 'PUT', url });
		assert.equal(out.status, 400);
		assert.equal(out.json.detail?.code, 'BAD_SHAPE');
		const get = await call(depsOf(), { url });
		assert.deepEqual(get.json.data, DOC, '空 body 不能把已落库的图清掉');
	});

	it('其它方法 ⇒ 405（写走 PUT）', async () => {
		const out = await call(depsOf(), { method: 'POST', url });
		assert.equal(out.status, 405);
	});

	it('鉴权失败 ⇒ 401（复用统一的 requestRejection）', async () => {
		const out = await call(depsOf({ connection: { requestRejection: () => 401 } }), { url });
		assert.equal(out.status, 401);
	});
});

/* ────────────────────────────── 坏数据（端到端） ────────────────────────────── */

describe('kv 里的坏图（真 SQLite）', () => {
	it('非法 JSON ⇒ GET 空图、不覆盖；第一次 PUT 前先备份', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-tool-graph-bad-'));
		const store = createSqliteStore(dir);
		let taskboard: Taskboard | undefined;
		try {
			const badRaw = '{ 这不是 JSON';
			await store.kvSet('toolGraph:v1', badRaw);
			taskboard = createTaskboard({ store, now: () => 424242 });

			const deps: RouteDeps = {
				taskboard,
				kv: store,
				connection: { requestRejection: () => undefined },
				defaultWorkspaceId: () => Promise.resolve('ws-default'),
			};
			const handler = createHandler(deps);
			const call = async (options: { method?: string; url: string; body?: unknown }) => {
				const out = makeRes();
				await handler(makeReq(options), out);
				return { status: out.status(), json: out.json() as Envelope };
			};

			const empty = await call({ url: `${ROUTE_PREFIX}/api/tool-graph` });
			assert.equal(empty.status, 200, '坏数据不许变成 500');
			assert.deepEqual(empty.json.data, { groups: [], edges: [] });
			assert.equal(store.kvGet('toolGraph:v1'), badRaw, '启动时只读不写 ⇒ 坏数据还在');

			const put = await call({
				method: 'PUT',
				url: `${ROUTE_PREFIX}/api/tool-graph`,
				body: { groups: [{ name: 'A', column: 0 }], edges: [] },
			});
			assert.equal(put.status, 200);

			assert.equal(store.kvGet('toolGraph:corrupt:424242'), badRaw, '覆盖前已备份原值');
			assert.deepEqual(JSON.parse(store.kvGet('toolGraph:v1') ?? 'null'), {
				groups: [{ name: 'A', column: 0 }],
				edges: [],
			});
		} finally {
			await taskboard?.close();
			rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		}
	});
});
