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

/** 统一信封：成功看 `data`，失败看 `code`。 */
interface ToolPolicyEnvelope {
	readonly ok?: boolean;
	readonly code?: string;
	readonly data?: ToolPolicyPayload;
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

	const call = async (deps: RouteDeps, options: { method?: string; url: string; body?: unknown }) => {
		const handler = createHandler(deps);
		const out = makeRes();
		await handler(makeReq(options), out);
		return { status: out.status(), json: out.json() as ToolPolicyEnvelope, body: out.body() };
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

	it('POST ⇒ 405（写入走 PUT，issue #66）', async () => {
		const out = await call(depsOf(), { method: 'POST', url: `${ROUTE_PREFIX}/api/tool-policy` });
		assert.equal(out.status, 405);
	});

	it('鉴权失败 ⇒ 401（复用统一的 requestRejection）', async () => {
		const out = await call(depsOf({ connection: { requestRejection: () => 401 } }), {
			url: `${ROUTE_PREFIX}/api/tool-policy`,
		});
		assert.equal(out.status, 401);
	});

	/* ── 写入（issue #66） ── */

	const POLICY_URL = `${ROUTE_PREFIX}/api/tool-policy`;

	it('PUT { tier: unclaimed, allow } ⇒ 200 + 更新后的视图；GET 能读回', async () => {
		const put = await call(depsOf(), {
			method: 'PUT',
			url: POLICY_URL,
			body: { tier: 'unclaimed', allow: ['web_search'] },
		});
		assert.equal(put.status, 200);
		assert.equal(put.json.ok, true);
		assert.ok(put.json.data?.unclaimed.includes('web_search'), '回声里就有刚写的档');

		const get = await call(depsOf(), { url: POLICY_URL });
		assert.ok(get.json.data?.unclaimed.includes('web_search'), '已落库，GET 能读回');
	});

	it('PUT { templateRef, allow / remove } ⇒ 改的是独立档（与 AI 工具同一个 core 方法）', async () => {
		const ref = taskboard.listTemplates()[0]?.ref;
		assert.ok(ref !== undefined);

		const added = await call(depsOf(), {
			method: 'PUT',
			url: POLICY_URL,
			body: { templateRef: ref, allow: ['edit'] },
		});
		assert.equal(added.status, 200);
		let own = added.json.data?.templates.find((one) => one.templateRef === ref);
		assert.ok(own?.tools.includes('edit'));

		const removed = await call(depsOf(), {
			method: 'PUT',
			url: POLICY_URL,
			body: { templateRef: ref, remove: ['edit'] },
		});
		assert.equal(removed.status, 200);
		own = removed.json.data?.templates.find((one) => one.templateRef === ref);
		assert.equal(own?.tools.includes('edit'), false, 'remove 生效');
	});

	it('PUT 二选一（tier + templateRef）⇒ 400（判定在 core）', async () => {
		const ref = taskboard.listTemplates()[0]?.ref;
		assert.ok(ref !== undefined);
		const out = await call(depsOf(), {
			method: 'PUT',
			url: POLICY_URL,
			body: { tier: 'claimed', templateRef: ref, allow: [] },
		});
		assert.equal(out.status, 400);
		assert.equal(out.json.ok, false);
	});

	it('PUT 模板不存在 ⇒ 404', async () => {
		const out = await call(depsOf(), {
			method: 'PUT',
			url: POLICY_URL,
			body: { templateRef: '不存在的模板', allow: ['x'] },
		});
		assert.equal(out.status, 404);
		assert.equal(out.json.code, 'TEMPLATE_NOT_FOUND');
	});

	it('PUT allow 不是数组 ⇒ 400（不静默当没给）', async () => {
		const out = await call(depsOf(), {
			method: 'PUT',
			url: POLICY_URL,
			body: { tier: 'unclaimed', allow: 'bash' },
		});
		assert.equal(out.status, 400);
		assert.equal(out.json.code, 'FIELD_REQUIRED');
	});
});
