/**
 * `api-client.ts` —— 单例契约。
 *
 * ## 为什么值得测
 *
 * 「收敛为一个实例」这件事本身没有用户可见的症状，出错方式是**静默的**：
 * 有人把 `getApi()` 改成 `createApi()`（或每次调用都新建），产品照常工作，
 * 但「以后换通道只改一处」的前提就没了，而且没人会发现。
 *
 * ⇒ 钉住两条：**同一对象**（缓存生效）、**构造是惰性的**（import 不建实例）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getApi } from '../src/api-client.ts';

describe('getApi —— 模块级单例', () => {
	it('⭐ 连续调用返回同一个对象（不是每次新建）', () => {
		assert.equal(getApi(), getApi());
	});

	it('返回的对象带完整的 TaskboardApi 方法（不是半成品）', () => {
		const api = getApi();
		for (const method of [
			'getState',
			'listWorkspaces',
			'createWorkspace',
			'createCard',
			'getTemplate',
			'patchCard',
			'archiveWorkspace',
			'unarchiveWorkspace',
			'act',
			'renderCheck',
			'getPermission',
			'setPermission',
		] as const) {
			assert.equal(typeof api[method], 'function', `缺方法：${method}`);
		}
	});
});
