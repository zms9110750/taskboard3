/**
 * `api.ts` 的纯逻辑测试 —— 路径拼接、信封解包、请求体形状。
 *
 * ## 为什么这几块最值得测
 *
 * 它们出错的表现是**静默空白**：
 *   · 路径多了/少了前导 `/` ⇒ 请求打到别处 ⇒ 404 或空数据，界面一片空白
 *   · 信封解包漏了 `ok:false` ⇒ 把错误当数据渲染，界面显示一屏 `undefined`
 *   · **请求体字段名/层级不对** ⇒ 服务端读到 `undefined` ⇒ 什么都不改但返回成功
 *
 * 三种都不抛异常，只能靠断言钉住。
 *
 * ⚠ 本测试**不 import React**、不碰 DOM、**不发真请求**
 *   （`createApi()` 可以注入假 `fetch`，只用来看「发出去的 body 长什么样」）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	API_BASE,
	apiError,
	buildPath,
	createApi,
	isFail,
	isOk,
	unwrap,
	type FetchLike,
} from '../src/api.ts';


describe('buildPath —— 相对路径拼接', () => {
	it('基础路径没有前导斜杠', () => {
		assert.equal(API_BASE.startsWith('/'), false, 'API_BASE 不能有前导斜杠，否则子路径挂载时会跳出');
	});

	it('空 path 就是 API 根', () => {
		assert.equal(buildPath(''), API_BASE);
	});

	it('单段 path', () => {
		assert.equal(buildPath('state'), `${API_BASE}/state`);
	});

	it('前导斜杠被吃掉，不产生双斜杠', () => {
		assert.equal(buildPath('/state'), `${API_BASE}/state`);
		assert.equal(buildPath('//state'), `${API_BASE}/state`);
	});

	it('多段 path', () => {
		assert.equal(buildPath('cards/GU01/action'), `${API_BASE}/cards/GU01/action`);
	});

	it('query 单个值', () => {
		assert.equal(buildPath('state', { workspaceId: 'w1' }), `${API_BASE}/state?workspaceId=w1`);
	});

	it('query 数组用重复参数', () => {
		assert.equal(
			buildPath('search', { status: ['a', 'b'] }),
			`${API_BASE}/search?status=a&status=b`,
		);
	});

	it('query 的 undefined 被跳过', () => {
		assert.equal(buildPath('state', { a: undefined, b: '1' }), `${API_BASE}/state?b=1`);
	});

	it('query 的空串被跳过', () => {
		assert.equal(buildPath('state', { a: '', b: '1' }), `${API_BASE}/state?b=1`);
	});

	it('全部跳过后不产生问号', () => {
		assert.equal(buildPath('state', { a: undefined }), `${API_BASE}/state`);
	});

	it('query 值被 URL 编码', () => {
		assert.equal(
			buildPath('state', { workspaceId: 'a b/c' }),
			`${API_BASE}/state?workspaceId=a%20b%2Fc`,
		);
	});

	it('中文空间 id 被编码', () => {
		const path = buildPath('state', { workspaceId: '默认' });
		assert.ok(path.includes('workspaceId=%E9%BB%98%E8%AE%A4'), `实际：${path}`);
	});
});

describe('信封解包', () => {
	it('成功信封取出 data', () => {
		const value = unwrap({ ok: true, data: { cards: [] } });
		assert.deepEqual(value, { cards: [] });
	});

	it('失败信封抛异常，带 code 与 message', () => {
		assert.throws(
			() => unwrap({ ok: false, code: 'CARD_NOT_FOUND', message: '找不到 GU99' }),
			(error: unknown) => {
				assert.ok(error instanceof Error);
				assert.equal((error as { code?: string }).code, 'CARD_NOT_FOUND');
				assert.equal(error.message, '找不到 GU99');
				return true;
			},
		);
	});

	it('失败信封的 issues 被带出', () => {
		const issues = [{ path: '/content', message: '必须是对象' }];
		assert.throws(
			() => unwrap({ ok: false, code: 'CONTENT_INVALID', message: '形状不对', issues }),
			(error: unknown) => {
				assert.deepEqual((error as { issues?: unknown }).issues, issues);
				return true;
			},
		);
	});

	it('isOk / isFail 判定', () => {
		assert.equal(isOk({ ok: true, data: 1 }), true);
		assert.equal(isFail({ ok: true, data: 1 }), false);
		assert.equal(isFail({ ok: false, code: 'X', message: 'y' }), true);
		assert.equal(isOk({ ok: false, code: 'X', message: 'y' }), false);
	});

	it('apiError 造出的异常带 code', () => {
		const error = apiError('NETWORK', '断网了');
		assert.equal(error.code, 'NETWORK');
		assert.equal(error.message, '断网了');
		assert.ok(error instanceof Error);
	});

	it('非 JSON 响应 ⇒ BAD_RESPONSE，不把乱码当数据', async () => {
		const api = createApi(fakeFetch({ ok: true, status: 200, text: '<html>not json</html>' }));
		await assert.rejects(
			() => api.getState(),
			(error: unknown) => {
				assert.equal((error as { code?: string }).code, 'BAD_RESPONSE');
				return true;
			},
		);
	});
});

/* ══════════════════════════════════════════════════════════
   请求体形状 —— 客户端发的 vs 服务端读的
   ══════════════════════════════════════════════════════════ */

/**
 * 造一个假 `fetch`，返回固定响应并**记下发出去的请求**。
 *
 * @param response 要返回的响应形状
 * @returns `{ fetchImpl, calls }` —— `calls[0].body` 是解析后的请求体
 */
function fakeFetch(response: {
	readonly ok: boolean;
	readonly status: number;
	readonly text: string;
}): FetchLike & { readonly calls: { url: string; method: string; body: unknown }[] } {
	const calls: { url: string; method: string; body: unknown }[] = [];
	const impl = (async (url: string, init?: { readonly method?: string; readonly body?: string }) => {
		calls.push({
			url,
			method: init?.method ?? 'GET',
			body: init?.body === undefined ? undefined : (JSON.parse(init.body) as unknown),
		});
		return { ok: response.ok, status: response.status, text: async () => response.text };
	}) as FetchLike & { readonly calls: typeof calls };
	(impl as { calls: typeof calls }).calls = calls;
	return impl;
}

/** 一个成功的卡响应信封。 */
const CARD_OK = JSON.stringify({
	ok: true,
	data: {
		card: {
			id: 'X1',
			title: '标题',
			status: 'TASK_STATE_UNSPECIFIED',
			template: { ref: 't', kind: 'work', domain: 'core' },
			relations: { parent: null, links: [] },
			sections: {},
			note: '',
			createdAt: 0,
			adoptedAt: null,
			history: [],
			deleted: false,
			holders: [],
			unread: { ai: false, user: false },
		},
	},
});

describe('⭐ patchCard 的请求体是**扁平**的（不包 patch 一层）', () => {
	/**
	 * 这条是**防回退断言** —— 钉住那个真 bug 不再复发。
	 *
	 * 曾经 `body: { workspaceId, patch: input.patch }`，而服务端在顶层读
	 * `title` / `note` / `content` ⇒ 全读到 `undefined` ⇒ 空 patch ⇒
	 * **什么都不改但返回成功**。用户以为改成功了，刷新才发现没改。
	 *
	 * 用户 `2026-11-22`：「用服务端的扁平的」。
	 */
	it('改标题 ⇒ body 是 { workspaceId, title }，没有 patch 键', async () => {
		const fetchImpl = fakeFetch({ ok: true, status: 200, text: CARD_OK });
		const api = createApi(fetchImpl);
		await api.patchCard({ workspaceId: 'W1', cardId: 'X1', title: '新标题' });

		const sent = fetchImpl.calls[0];
		assert.ok(sent !== undefined, '应当发了一次请求');
		assert.equal(sent.method, 'PATCH');
		assert.ok(sent.url.includes('cards/X1'), `路径要带卡编号，实际：${sent.url}`);

		const body = sent.body as Record<string, unknown>;
		assert.deepEqual(body, { workspaceId: 'W1', title: '新标题' });

		/* ⚠ 最关键的一条：**不能**出现 patch 这个键。 */
		assert.equal('patch' in body, false, `body 不能包 patch 一层，实际：${JSON.stringify(body)}`);
	});

	it('只改备注 ⇒ 只发 note，不发 title', async () => {
		const fetchImpl = fakeFetch({ ok: true, status: 200, text: CARD_OK });
		const api = createApi(fetchImpl);
		await api.patchCard({ workspaceId: 'W1', cardId: 'X1', note: '新备注' });

		const body = fetchImpl.calls[0]?.body as Record<string, unknown>;
		assert.deepEqual(body, { workspaceId: 'W1', note: '新备注' });
		assert.equal('title' in body, false, '没传 title 就不要发 —— 服务端会当成「改成空标题」');
	});

	it('只改章节 ⇒ content 在顶层', async () => {
		const fetchImpl = fakeFetch({ ok: true, status: 200, text: CARD_OK });
		const api = createApi(fetchImpl);
		const content = { body: { $type: 'text', value: '新正文' } };
		await api.patchCard({ workspaceId: 'W1', cardId: 'X1', content });

		const body = fetchImpl.calls[0]?.body as Record<string, unknown>;
		assert.deepEqual(body, { workspaceId: 'W1', content });
	});

	it('空备注是合法值（清空备注），不能被当成「没传」丢掉', async () => {
		const fetchImpl = fakeFetch({ ok: true, status: 200, text: CARD_OK });
		const api = createApi(fetchImpl);
		await api.patchCard({ workspaceId: 'W1', cardId: 'X1', note: '' });

		const body = fetchImpl.calls[0]?.body as Record<string, unknown>;
		assert.equal('note' in body, true, '空串是「清空备注」，必须发出去');
		assert.equal(body['note'], '');
	});

	it('卡编号被 URL 编码', async () => {
		const fetchImpl = fakeFetch({ ok: true, status: 200, text: CARD_OK });
		const api = createApi(fetchImpl);
		await api.patchCard({ workspaceId: 'W1', cardId: 'a b/c', title: 'x' });

		assert.ok(fetchImpl.calls[0]?.url.includes('cards/a%20b%2Fc'), `实际：${fetchImpl.calls[0]?.url}`);
	});
});

describe('⭐ 其余请求体与服务端读取的字段名对齐', () => {
	it('createCard ⇒ body 原样（workspaceId / templateRef / title / content 都在顶层）', async () => {
		const fetchImpl = fakeFetch({ ok: true, status: 201, text: CARD_OK.replace('"card"', '"card"') });
		const api = createApi(fetchImpl);
		await api.createCard({ workspaceId: 'W1', templateRef: 't', title: '标题' });

		const body = fetchImpl.calls[0]?.body as Record<string, unknown>;
		assert.deepEqual(body, { workspaceId: 'W1', templateRef: 't', title: '标题' });
	});

	it('createWorkspace ⇒ body 是 { name }', async () => {
		const fetchImpl = fakeFetch({
			ok: true,
			status: 201,
			text: JSON.stringify({ ok: true, data: { workspace: { id: 'w', displayName: '新', archived: false, createdAt: 0 } } }),
		});
		const api = createApi(fetchImpl);
		await api.createWorkspace('新');

		assert.deepEqual(fetchImpl.calls[0]?.body, { name: '新' });
	});

	/**
	 * `act` 和 `patchCard` 是**同一类** bug：
	 * 客户端把东西包了一层，服务端在顶层读。
	 *
	 * 曾经 `body: { workspaceId, action: { kind, to } }`，服务端
	 * `const to = str(body, 'to') ?? ''` ⇒ 空串 ⇒ 400「不是已知状态」
	 * ⇒ **点任何状态按钮都失败**。
	 */
	it('⭐ act ⇒ body 是 { workspaceId, to }，没有 action 键', async () => {
		const fetchImpl = fakeFetch({ ok: true, status: 200, text: CARD_OK });
		const api = createApi(fetchImpl);
		await api.act({ workspaceId: 'W1', cardId: 'X1', to: 'TASK_STATE_COMPLETED' });

		const sent = fetchImpl.calls[0];
		assert.ok(sent !== undefined, '应当发了一次请求');
		assert.equal(sent.method, 'POST');
		assert.ok(sent.url.includes('cards/X1/action'), `路径要带卡编号和 /action，实际：${sent.url}`);

		const body = sent.body as Record<string, unknown>;
		assert.deepEqual(body, { workspaceId: 'W1', to: 'TASK_STATE_COMPLETED' });

		/* ⚠ 防回退：**不能**出现 action 这个键。 */
		assert.equal('action' in body, false, `body 不能包 action 一层，实际：${JSON.stringify(body)}`);
	});

	it('act 的卡编号被 URL 编码', async () => {
		const fetchImpl = fakeFetch({ ok: true, status: 200, text: CARD_OK });
		const api = createApi(fetchImpl);
		await api.act({ workspaceId: 'W1', cardId: 'a b/c', to: 'TASK_STATE_COMPLETED' });

		assert.ok(fetchImpl.calls[0]?.url.includes('cards/a%20b%2Fc/action'), `实际：${fetchImpl.calls[0]?.url}`);
	});
});

/* ══════════════════════════════════════════════════════════
   归档空间 —— 请求形状（用注入的假 fetch，不发真请求）
   ══════════════════════════════════════════════════════════ */

describe('archiveWorkspace / unarchiveWorkspace —— 请求形状', () => {
	/**
	 * 造一个假 fetch，记录每次请求，回一个成功信封。
	 *
	 * @param data 信封里的 data
	 * @returns `{ fetch, calls }`
	 */
	function fakeFetch(data: unknown): {
		readonly calls: { readonly url: string; readonly method: string | undefined; readonly body: string | undefined }[];
		readonly fetch: (
			url: string,
			init?: { readonly method?: string; readonly body?: string },
		) => Promise<{ readonly ok: boolean; readonly status: number; readonly text: () => Promise<string> }>;
	} {
		const calls: { url: string; method: string | undefined; body: string | undefined }[] = [];
		return {
			calls,
			fetch: async (url, init) => {
				calls.push({ url, method: init?.method, body: init?.body });
				return {
					ok: true,
					status: 200,
					text: async () => JSON.stringify({ ok: true, data }),
				};
			},
		};
	}

	it('archiveWorkspace ⇒ POST workspaces/<id>/archive，不带 body', async () => {
		const envelope = { changed: true, workspace: { id: 'W1', displayName: '核心', archived: true } };
		const { fetch, calls } = fakeFetch(envelope);
		const api = createApi(fetch);

		const result = await api.archiveWorkspace('W1');
		assert.deepEqual(result, envelope);

		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.method, 'POST');
		assert.equal(calls[0]?.url, `${API_BASE}/workspaces/W1/archive`);
		/* 归档不需要 body —— id 在路径里，多余 body 只会让路由困惑。 */
		assert.equal(calls[0]?.body, undefined);
	});

	it('unarchiveWorkspace ⇒ POST workspaces/<id>/unarchive', async () => {
		const { fetch, calls } = fakeFetch({ changed: true, workspace: undefined });
		const api = createApi(fetch);

		await api.unarchiveWorkspace('W1');
		assert.equal(calls[0]?.url, `${API_BASE}/workspaces/W1/unarchive`);
		assert.equal(calls[0]?.method, 'POST');
	});

	it('⚠ 空间 id 里有特殊字符 ⇒ 被 URL 编码（不能直接拼进路径）', async () => {
		const { fetch, calls } = fakeFetch({ changed: false, workspace: undefined });
		const api = createApi(fetch);

		await api.archiveWorkspace('空间/带斜杠');
		assert.equal(calls[0]?.url, `${API_BASE}/workspaces/${encodeURIComponent('空间/带斜杠')}/archive`);
	});

	it('changed: false 原样透出（幂等不是错误）', async () => {
		const { fetch } = fakeFetch({ changed: false, workspace: undefined });
		const api = createApi(fetch);

		const result = await api.archiveWorkspace('W1');
		assert.equal(result.changed, false);
	});

	it('失败信封 ⇒ 抛异常，带 code', async () => {
		const api = createApi(async () => ({
			ok: false,
			status: 404,
			text: async () => JSON.stringify({ ok: false, code: 'WORKSPACE_NOT_FOUND', message: '空间不存在' }),
		}));

		await assert.rejects(
			() => api.archiveWorkspace('NOPE'),
			(error: unknown) => {
				assert.equal((error as { code?: string }).code, 'WORKSPACE_NOT_FOUND');
				return true;
			},
		);
	});
});
