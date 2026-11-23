/**
 * `GET /api/tool-policy`（模板授权页的数据源）：路由 + 形状 + 真值核对。
 *
 * ## 为什么单独一个文件
 *
 * `http.test.ts` 已经很大；这里只需要「路由分派 + 鉴权 + 信封 + core 真值对照」，
 * 用最小替身更清楚（和 `ui-state.test.ts` 同一个理由）。
 *
 * ## 重点断言
 *
 * `effective` **必须等于 core 的 `effectiveToolsOf()`** —— 页面显示的就是它，
 * 如果这里被谁在 dsh 层重算（第二份真值），这条会红。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { BASE_TOOLS, createTaskboard, effectiveToolsOf, type Taskboard } from '@taskboard/core';
import { createSqliteStore } from '@taskboard/io';

import { createHandler, ROUTE_PREFIX, type RouteDeps } from '../src/http.ts';
import type { OutgoingLike, ReadableIncoming } from '../src/types.ts';

function makeReq(options: { method?: string; url: string }): ReadableIncoming {
	return {
		method: options.method ?? 'GET',
		url: options.url,
		headers: { host: '127.0.0.1:3000' },
		async *[Symbol.asyncIterator]() {
			/* GET 无 body */
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

/** 响应 data 的类型（测试里窄化用）。 */
interface ToolPolicyPayload {
	readonly baseTools: readonly string[];
	readonly unclaimed: readonly string[];
	readonly common: readonly string[];
	readonly groups: readonly { readonly name: string; readonly tools: readonly string[] }[];
	readonly groupMembers: readonly { readonly group: string; readonly templates: readonly string[] }[];
	readonly templates: readonly { readonly templateRef: string; readonly tools: readonly string[] }[];
	readonly effective: readonly { readonly templateRef: string; readonly tools: readonly string[] }[];
}

describe('GET /api/tool-policy（真 handler + 真 SQLite）', () => {
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

	const call = async (deps: RouteDeps, options: { method?: string; url: string }) => {
		const handler = createHandler(deps);
		const out = makeRes();
		await handler(makeReq(options), out);
		return { status: out.status(), json: out.json() as { ok?: boolean; data?: ToolPolicyPayload }, body: out.body() };
	};

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-tool-policy-'));
		store = createSqliteStore(dir);
		taskboard = createTaskboard({ store });
		await taskboard.createWorkspace('模板授权测试');
	});

	after(async () => {
		/* ⚠ 先关 sqlite 再删目录，否则 Windows 上 EPERM（踩过）。 */
		await taskboard.close();
		rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	});

	it('返回 200 + 标准信封', async () => {
		const out = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/tool-policy` });
		assert.equal(out.status, 200);
		assert.equal(out.json.ok, true);
		assert.ok(out.json.data !== undefined);
	});

	it('baseTools 就是 core 的 BASE_TOOLS（不硬编码第二份）', async () => {
		const out = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/tool-policy` });
		assert.deepEqual(out.json.data?.baseTools, [...BASE_TOOLS]);
	});

	it('effective 由 core 算：逐模板与 effectiveToolsOf() 完全一致', async () => {
		/* 先配一点策略，保证 effective 不是「只有 BASE」这种退化结果。 */
		await taskboard.setCommonPolicy(['bash', 'read']);
		const ref = taskboard.listTemplates()[0]?.ref;
		assert.ok(ref !== undefined);
		await taskboard.setToolPolicyScope({ templateRef: ref, allow: ['write'] });

		const out = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/tool-policy` });
		const data = out.json.data;
		assert.ok(data !== undefined);
		const templates = taskboard.listTemplates();
		assert.equal(data.effective.length, templates.length);
		for (const template of templates) {
			/* 显式标注：不标注时 TS7022（`find` 的泛型解析回指自己）。 */
			const fromHttp: { readonly templateRef: string; readonly tools: readonly string[] } | undefined =
				data.effective.find((one) => one.templateRef === template.ref);
			assert.ok(fromHttp !== undefined, `缺模板 ${template.ref}`);
			assert.deepEqual(fromHttp.tools, [...effectiveToolsOf(taskboard.getToolPolicies(), template.ref)]);
		}
	});

	it('各档增量也如实返回（common / 独立档都能看到自己刚写的东西）', async () => {
		const out = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/tool-policy` });
		const data = out.json.data;
		assert.ok(data !== undefined);
		assert.deepEqual(data.common, ['bash', 'read']);
		const ref = taskboard.listTemplates()[0]?.ref;
		assert.ok(ref !== undefined);
		const own = data.templates.find((one) => one.templateRef === ref);
		assert.deepEqual(own?.tools, ['write']);
	});

	it('组档 + 组成员都返回（形状是数组，不是 map）', async () => {
		const ref = taskboard.listTemplates()[0]?.ref;
		assert.ok(ref !== undefined);
		await taskboard.setGroupPolicy('代码类', ['edit']);
		await taskboard.setGroupMembers('代码类', [ref]);

		const out = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/tool-policy` });
		const data = out.json.data;
		assert.ok(data !== undefined);
		assert.deepEqual(data.groups, [{ name: '代码类', tools: ['edit'] }]);
		assert.deepEqual(data.groupMembers, [{ group: '代码类', templates: [ref] }]);
		/* 组成员命中的模板，effective 里必须真的有 edit */
		const effective = data.effective.find((one) => one.templateRef === ref);
		assert.equal(effective?.tools.includes('edit'), true);
	});

	it('POST ⇒ 405（本轮只读）', async () => {
		const out = await call(depsOf(), { method: 'POST', url: `${ROUTE_PREFIX}/api/tool-policy` });
		assert.equal(out.status, 405);
	});

	it('鉴权失败 ⇒ 401（复用统一的 requestRejection）', async () => {
		const out = await call(depsOf({ connection: { requestRejection: () => 401 } }), {
			url: `${ROUTE_PREFIX}/api/tool-policy`,
		});
		assert.equal(out.status, 401);
	});
});
