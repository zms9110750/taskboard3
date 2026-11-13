/**
 * HTTP 路由测试。
 *
 * ## 为什么不用真 http server
 *
 * `createHandler` 的入参是**窄接口**（`ReadableIncoming` / `OutgoingLike`），
 * 不是 Cordis 的 `Context`。⇒ 造两个假对象即可，无需起 socket、无需真 Cordis。
 *
 * 这测试的是**路由逻辑**：路径分派、方法判断、鉴权、信封形状、错误码。
 * 真实 HTTP 行为（header、body 流、socket）由 DSH 的 webserver 保证，不在本测试范围。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createTaskboard, type Taskboard } from '@taskboard/core';
import { STATUS_GROUP_OF, type TaskState } from '@taskboard/protocol';
import { createSearch } from '@taskboard/core';

import { createHandler, ROUTE_PREFIX, type RouteDeps } from '../src/http.ts';
import type { OutgoingLike, ReadableIncoming } from '../src/types.ts';

/* ────────────────────────────── 测试替身 ────────────────────────────── */

/** 造一个请求（`IncomingMessage` 的最小替身，可异步迭代读 body）。 */
function makeReq(options: {
	method?: string;
	url?: string;
	body?: unknown;
	headers?: Record<string, string>;
}): ReadableIncoming {
	const chunks: string[] = options.body === undefined ? [] : [JSON.stringify(options.body)];
	return {
		method: options.method ?? 'GET',
		url: options.url ?? '/',
		headers: options.headers ?? { host: '127.0.0.1:3000' },
		async *[Symbol.asyncIterator]() {
			for (const chunk of chunks) yield chunk;
		},
	};
}

/** 造一个响应，记录写出去的东西。 */
function makeRes(): OutgoingLike & {
	readonly status: () => number;
	readonly headers: () => Record<string, string>;
	readonly body: () => string;
	readonly json: () => unknown;
} {
	let statusCode = 200;
	const headers: Record<string, string> = {};
	let body = '';
	const res = {
		get statusCode() {
			return statusCode;
		},
		set statusCode(value: number) {
			statusCode = value;
		},
		setHeader(name: string, value: string) {
			headers[name.toLowerCase()] = value;
			return undefined;
		},
		end(value?: string) {
			body = value ?? '';
			return undefined;
		},
		status: () => statusCode,
		headers: () => headers,
		body: () => body,
		/* 非 JSON 响应（405 等）不要炸 —— 返回 `undefined` 让用例自己判状态。 */
		json: () => {
			try {
				return JSON.parse(body) as unknown;
			} catch {
				return undefined;
			}
		},
	};
	return res;
}

/* ────────────────────────────── 夹具 ────────────────────────────── */

let dataDir = '';
let taskboard: Taskboard;

/**
 * core 包内的模板目录。
 *
 * 模板是 `@taskboard/core` 的资产（它 `files` 里带 `templates`），本包不带副本。
 * 这里从 core 的 `package.json` 反推定位置 —— 与 `src/index.ts` 的 `coreTemplateDir()` 同一做法。
 */
const TEMPLATE_DIR = join(dirname(createRequire(import.meta.url).resolve('@taskboard/core/package.json')), 'templates');

before(() => {
	dataDir = mkdtempSync(join(tmpdir(), 'tb3-dsh-'));
});

after(async () => {
	await closeTaskboard();
	/* Windows 上 SQLite 句柄释放有延迟 ⇒ 重试几次再失败。 */
	for (let i = 0; i < 10; i += 1) {
		try {
			rmSync(dataDir, { recursive: true, force: true });
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
});

/** 关掉当前实例（幂等）。 */
async function closeTaskboard(): Promise<void> {
	if (taskboard === undefined) return;
	const closing = taskboard;
	taskboard = undefined as unknown as Taskboard;
	await closing.close();
}

beforeEach(async () => {
	/* 每个用例一个全新实例（内存里；dataDir 共用，用例间用不同空间隔离）。 */
	await closeTaskboard();
	taskboard = createTaskboard({
		dataDir,
		search: createSearch({ groupOf: (s) => STATUS_GROUP_OF[s as TaskState] }),
	});
	/* 模板必须加载，否则 `listTemplates()` 为空 —— 建卡路径全部无从测起。 */
	taskboard.templates().loadDirectory(TEMPLATE_DIR);
});

/** 造一份路由依赖；默认放行鉴权。 */
function depsOf(overrides: Partial<RouteDeps> = {}): RouteDeps {
	return {
		taskboard,
		connection: { requestRejection: () => undefined },
		defaultWorkspaceId: async () => {
			const list = taskboard.listWorkspaces(false);
			return list[0]?.id ?? 'ws-missing';
		},
		...overrides,
	};
}

/** 跑一次请求。 */
async function call(
	deps: RouteDeps,
	options: { method?: string; url: string; body?: unknown },
): Promise<{ status: number; headers: Record<string, string>; raw: string; json: unknown }> {
	const res = makeRes();
	await createHandler(deps)(makeReq(options), res);
	return { status: res.status(), headers: res.headers(), raw: res.body(), json: res.json() };
}

/* ────────────────────────────── 用例 ────────────────────────────── */

describe('鉴权', () => {
	it('拒绝时返回 401，且不处理路径', async () => {
		const deps = depsOf({ connection: { requestRejection: () => 401 } });
		const out = await call(deps, { url: `${ROUTE_PREFIX}/api/state` });
		assert.equal(out.status, 401);
		const payload = out.json as { ok: boolean; message: string };
		assert.equal(payload.ok, false);
		assert.ok(payload.message.includes('未认证'), payload.message);
	});

	it('403 时返回不可信', async () => {
		const deps = depsOf({ connection: { requestRejection: () => 403 } });
		const out = await call(deps, { url: `${ROUTE_PREFIX}/api/state` });
		assert.equal(out.status, 403);
		const payload = out.json as { ok: boolean; message: string };
		assert.equal(payload.ok, false);
		assert.ok(payload.message.includes('不可信'), payload.message);
	});

	it('鉴权在路径判断之前 —— 未知路径也先答 401', async () => {
		const deps = depsOf({ connection: { requestRejection: () => 401 } });
		const out = await call(deps, { url: `${ROUTE_PREFIX}/api/does-not-exist` });
		assert.equal(out.status, 401);
	});
});

describe('GET /api/state', () => {
	it('返回空间列表、卡、模板清单', async () => {
		const created = await taskboard.createWorkspace('状态测试');
		assert.equal(created.ok, true);
		if (!created.ok) return;

		const deps = depsOf({ defaultWorkspaceId: async () => created.workspace.id });
		const out = await call(deps, { url: `${ROUTE_PREFIX}/api/state` });

		assert.equal(out.status, 200);
		const payload = out.json as {
			ok: boolean;
			data: { workspaceId: string; workspaces: unknown[]; cards: unknown[]; templates: unknown[] };
		};
		assert.equal(payload.ok, true);
		assert.equal(payload.data.workspaceId, created.workspace.id);
		assert.ok(Array.isArray(payload.data.workspaces));
		assert.ok(Array.isArray(payload.data.cards));
		assert.ok(Array.isArray(payload.data.templates));
	});

	it('?workspace= 覆盖默认空间', async () => {
		const a = await taskboard.createWorkspace('A');
		const b = await taskboard.createWorkspace('B');
		assert.equal(a.ok && b.ok, true);
		if (!a.ok || !b.ok) return;

		const deps = depsOf({ defaultWorkspaceId: async () => a.workspace.id });
		const out = await call(deps, { url: `${ROUTE_PREFIX}/api/state?workspace=${b.workspace.id}` });
		const payload = out.json as { data: { workspaceId: string } };
		assert.equal(payload.data.workspaceId, b.workspace.id);
	});

	it('方法不对 ⇒ 405', async () => {
		const out = await call(depsOf(), { method: 'POST', url: `${ROUTE_PREFIX}/api/state` });
		assert.equal(out.status, 405);
		assert.equal(out.headers.allow, 'GET');
	});});

describe('POST /api/workspaces', () => {
	it('建空间成功 ⇒ 201', async () => {
		const out = await call(depsOf(), {
			method: 'POST',
			url: `${ROUTE_PREFIX}/api/workspaces`,
			body: { name: '新空间' },
		});
		assert.equal(out.status, 201);
		const payload = out.json as { ok: boolean; data: { workspace: { id: string; displayName: string } } };
		assert.equal(payload.ok, true);
		assert.equal(payload.data.workspace.displayName, '新空间');
	});

	it('空名字 ⇒ 400 + Failure 信封', async () => {
		const out = await call(depsOf(), {
			method: 'POST',
			url: `${ROUTE_PREFIX}/api/workspaces`,
			body: { name: '   ' },
		});
		assert.equal(out.status, 400);
		const payload = out.json as { ok: boolean; code: string; message: string };
		assert.equal(payload.ok, false);
		assert.equal(typeof payload.code, 'string');
		assert.equal(typeof payload.message, 'string');
	});
});

describe('POST /api/cards', () => {
	it('建卡成功 ⇒ 201，返回卡', async () => {
		const created = await taskboard.createWorkspace('建卡测试');
		assert.equal(created.ok, true);
		if (!created.ok) return;

		const templates = taskboard.listTemplates();
		const template = templates[0];
		assert.notEqual(template, undefined);
		if (template === undefined) return;

		const deps = depsOf({ defaultWorkspaceId: async () => created.workspace.id });
		const out = await call(deps, {
			method: 'POST',
			url: `${ROUTE_PREFIX}/api/cards`,
			body: { templateRef: template.ref, title: '第一张卡' },
		});

		assert.equal(out.status, 201, `建卡应成功；实际 ${out.raw}`);
		const payload = out.json as { ok: boolean; data: { card: { id: string; title: string } } };
		assert.equal(payload.ok, true);
		assert.equal(payload.data.card.title, '第一张卡');
		assert.notEqual(payload.data.card.id, '');
	});

	it('未知 templateRef ⇒ 4xx + Failure', async () => {
		const created = await taskboard.createWorkspace('坏模板');
		assert.equal(created.ok, true);
		if (!created.ok) return;

		const deps = depsOf({ defaultWorkspaceId: async () => created.workspace.id });
		const out = await call(deps, {
			method: 'POST',
			url: `${ROUTE_PREFIX}/api/cards`,
			body: { templateRef: '不存在的模板', title: 'x' },
		});

		assert.ok(out.status >= 400 && out.status < 500, `应是 4xx；实际 ${out.status} ${out.raw}`);
		const payload = out.json as { ok: boolean; code: string };
		assert.equal(payload.ok, false);
	});

	it('缺 title ⇒ 4xx + FIELD_REQUIRED', async () => {
		const created = await taskboard.createWorkspace('缺标题');
		assert.equal(created.ok, true);
		if (!created.ok) return;
		const template = taskboard.listTemplates()[0];
		if (template === undefined) return;

		const deps = depsOf({ defaultWorkspaceId: async () => created.workspace.id });
		const out = await call(deps, {
			method: 'POST',
			url: `${ROUTE_PREFIX}/api/cards`,
			body: { templateRef: template.ref },
		});

		assert.ok(out.status >= 400 && out.status < 500);
		const payload = out.json as { ok: boolean; code: string };
		assert.equal(payload.ok, false);
		assert.equal(payload.code, 'FIELD_REQUIRED');
	});

	it('body 不是 JSON ⇒ 400', async () => {
		const deps = depsOf();
		const res = makeRes();
		const badReq: ReadableIncoming = {
			method: 'POST',
			url: `${ROUTE_PREFIX}/api/cards`,
			headers: { host: '127.0.0.1:3000' },
			async *[Symbol.asyncIterator]() {
				yield '{ 不是 json';
			},
		};
		await createHandler(deps)(badReq, res);
		assert.equal(res.status(), 400);
		const payload = res.json() as { ok: boolean };
		assert.equal(payload.ok, false);
	});
});

describe('GET /api/search', () => {
	it('按 status 筛选；不带 status 时不含草稿', async () => {
		const created = await taskboard.createWorkspace('搜索测试');
		assert.equal(created.ok, true);
		if (!created.ok) return;
		const wsId = created.workspace.id;
		const template = taskboard.listTemplates()[0];
		if (template === undefined) return;

		const card = await taskboard.create({ workspaceId: wsId, templateRef: template.ref, title: '唯一一张' });
		assert.equal(card.ok, true);

		const deps = depsOf({ defaultWorkspaceId: async () => wsId });

		/* 不带 status ⇒ 草稿被排除 ⇒ 空。 */
		const withoutStatus = await call(deps, { url: `${ROUTE_PREFIX}/api/search?workspace=${wsId}` });
		const withoutPayload = withoutStatus.json as { data: { cards: unknown[] } };
		assert.equal(withoutPayload.data.cards.length, 0, '不带 status 时草稿应被排除');

		/* 带 draft ⇒ 能看到。 */
		const withDraft = await call(deps, { url: `${ROUTE_PREFIX}/api/search?workspace=${wsId}&status=draft` });
		const withPayload = withDraft.json as { data: { cards: { title: string }[] } };
		assert.equal(withPayload.data.cards.length, 1);
		assert.equal(withPayload.data.cards[0]?.title, '唯一一张');
	});
});

describe('GET /api/templates', () => {
	it('列表 + 单个模板', async () => {
		const list = taskboard.listTemplates();
		const first = list[0];
		assert.notEqual(first, undefined);
		if (first === undefined) return;

		const all = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/templates` });
		assert.equal(all.status, 200);

		const one = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/templates?ref=${first.ref}` });
		assert.equal(one.status, 200);
		const payload = one.json as { data: { template: { ref: string } } };
		assert.equal(payload.data.template.ref, first.ref);

		const missing = await call(depsOf(), { url: `${ROUTE_PREFIX}/api/templates?ref=nope` });
		assert.equal(missing.status, 404);
	});
});

describe('PATCH /api/cards/:id', () => {
	it('改标题成功', async () => {
		const created = await taskboard.createWorkspace('改卡');
		assert.equal(created.ok, true);
		if (!created.ok) return;
		const wsId = created.workspace.id;
		const template = taskboard.listTemplates()[0];
		if (template === undefined) return;
		const made = await taskboard.create({ workspaceId: wsId, templateRef: template.ref, title: '旧标题' });
		assert.equal(made.ok, true);
		if (!made.ok) return;

		const deps = depsOf({ defaultWorkspaceId: async () => wsId });
		const out = await call(deps, {
			method: 'PATCH',
			url: `${ROUTE_PREFIX}/api/cards/${made.card.id}`,
			body: { title: '新标题' },
		});
		assert.equal(out.status, 200, out.raw);
		const payload = out.json as { data: { card: { title: string } } };
		assert.equal(payload.data.card.title, '新标题');
	});

	it('不存在的卡 ⇒ 404', async () => {
		const created = await taskboard.createWorkspace('无卡');
		assert.equal(created.ok, true);
		if (!created.ok) return;
		const deps = depsOf({ defaultWorkspaceId: async () => created.workspace.id });
		const out = await call(deps, {
			method: 'PATCH',
			url: `${ROUTE_PREFIX}/api/cards/NOPE-99`,
			body: { title: 'x' },
		});
		assert.equal(out.status, 404);
	});
});

describe('POST /api/cards/:id/action', () => {
	it('非法状态名 ⇒ 400', async () => {
		const created = await taskboard.createWorkspace('动作');
		assert.equal(created.ok, true);
		if (!created.ok) return;
		const deps = depsOf({ defaultWorkspaceId: async () => created.workspace.id });
		const out = await call(deps, {
			method: 'POST',
			url: `${ROUTE_PREFIX}/api/cards/ANY/action`,
			body: { to: 'TASK_STATE_NOPE' },
		});
		assert.equal(out.status, 400);
	});

	it('未装配写入口时，合法转移答 501（不是静默成功）', async () => {
		const created = await taskboard.createWorkspace('动作2');
		assert.equal(created.ok, true);
		if (!created.ok) return;
		const wsId = created.workspace.id;
		const template = taskboard.listTemplates()[0];
		if (template === undefined) return;
		const made = await taskboard.create({ workspaceId: wsId, templateRef: template.ref, title: '待采纳' });
		assert.equal(made.ok, true);
		if (!made.ok) return;

		const deps = depsOf({ defaultWorkspaceId: async () => wsId });
		const out = await call(deps, {
			method: 'POST',
			url: `${ROUTE_PREFIX}/api/cards/${made.card.id}/action`,
			body: { to: 'TASK_STATE_SUBMITTED' },
		});
		/* 草稿 → 提交是 goal / work 的「采纳」按钮，合法。 */
		assert.equal(out.status, 501, out.raw);
		const payload = out.json as { code: string };
		assert.equal(payload.code, 'PORT_UNAVAILABLE');
	});

	it('按钮表里没有的转移 ⇒ 409 + TRANSITION_REJECTED', async () => {
		const created = await taskboard.createWorkspace('动作3');
		assert.equal(created.ok, true);
		if (!created.ok) return;
		const wsId = created.workspace.id;
		const template = taskboard.listTemplates()[0];
		if (template === undefined) return;
		const made = await taskboard.create({ workspaceId: wsId, templateRef: template.ref, title: '草稿' });
		assert.equal(made.ok, true);
		if (!made.ok) return;

		const deps = depsOf({ defaultWorkspaceId: async () => wsId });
		/* 草稿 → 成功：没有任何类别有这条按钮。 */
		const out = await call(deps, {
			method: 'POST',
			url: `${ROUTE_PREFIX}/api/cards/${made.card.id}/action`,
			body: { to: 'TASK_STATE_COMPLETED' },
		});
		assert.equal(out.status, 409, out.raw);
		const payload = out.json as { code: string };
		assert.equal(payload.code, 'TRANSITION_REJECTED');
	});
});

describe('路径与异常', () => {
	it('不认识的前缀 ⇒ 404', async () => {
		const out = await call(depsOf(), { url: '/taskboard3/other' });
		assert.equal(out.status, 404);
	});

	it('handler 内部抛错 ⇒ 500，不冒泡', async () => {
		const broken = {
			...depsOf(),
			taskboard: {
				...taskboard,
				listWorkspaces: () => {
					throw new Error('boom');
				},
			} as unknown as Taskboard,
		};
		const out = await call(broken, { url: `${ROUTE_PREFIX}/api/state` });
		assert.equal(out.status, 500);
		const payload = out.json as { ok: boolean; code: string };
		assert.equal(payload.ok, false);
		assert.equal(payload.code, 'INTERNAL_ERROR');
	});
});
