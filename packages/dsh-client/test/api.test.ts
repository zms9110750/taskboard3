/**
 * `api.ts` 的纯逻辑测试 —— 路径拼接与信封解包。
 *
 * ## 为什么这两块最值得测
 *
 * 它们出错的表现是**静默空白**：
 *   · 路径多了/少了前导 `/` ⇒ 请求打到别处 ⇒ 404 或空数据，界面一片空白
 *   · 信封解包漏了 `ok:false` ⇒ 把错误当数据渲染，界面显示一屏 `undefined`
 *
 * 两种都不会抛异常，只能靠断言钉住。
 *
 * ⚠ 本测试**不 import React**、不碰 DOM、不发请求 —— 纯函数。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { API_BASE, apiError, buildPath, createApi, isFail, isOk, unwrap } from '../src/api.ts';

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
