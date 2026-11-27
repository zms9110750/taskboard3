/**
 * card 轴 store（`pure/card-permission-state.ts`）的行为测试。
 *
 * 语义逐条对应拆分前的实现（当时在 permission-box-state 里，没有独立测试文件）：
 * 四个「不发」、乐观更新 + 失败回滚、ensure 幂等 + 在飞闸、api 未接上不进 load-error。
 *
 * 跑法：`node --test`（import 源码 `.ts`，AGENTS 规则 6）。
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import type { TaskboardApi } from '../src/api.ts';
import {
	attachCardPermissionApi,
	cardPermissionStore,
	ensureCardPermissionLoaded,
	refreshCardPermission,
	resetCardPermissionForTest,
	selectCardPermissionLevel,
} from '../src/pure/card-permission-state.ts';

/** 两轴快照里 card 轴相关的部分（其余字段本 store 不读）。 */
const DATA = {
	cardActionLevel: 'no-claim',
	toolGuardLevel: 'off',
	cardActionOptions: [
		{ value: 'no-claim', label: '不允许领卡', description: '' },
		{ value: 'claim', label: '允许领卡', description: '' },
		{ value: 'adopt', label: '允许采纳草稿', description: '' },
	],
	toolGuardOptions: [],
} as const;

/** 造一个假 API：get/set 可注入行为。 */
function fakeApi(overrides?: {
	get?: () => Promise<unknown>;
	set?: (input: { cardActionLevel?: string; toolGuardLevel?: string }) => Promise<unknown>;
}): TaskboardApi {
	return {
		getPermission: overrides?.get ?? (() => Promise.resolve(structuredClone(DATA))),
		setPermission:
			overrides?.set ??
			((input) => Promise.resolve({ cardActionLevel: input.cardActionLevel ?? 'no-claim', toolGuardLevel: 'off' })),
	} as unknown as TaskboardApi;
}

beforeEach(() => {
	resetCardPermissionForTest();
});

void test('ensure：拉一次就 ready，重复调不再发请求', async () => {
	let calls = 0;
	attachCardPermissionApi(fakeApi({ get: () => { calls++; return Promise.resolve(structuredClone(DATA)); } }));
	assert.equal(cardPermissionStore().phase, 'loading');
	await ensureCardPermissionLoaded();
	assert.equal(calls, 1);
	const first = cardPermissionStore();
	assert.equal(first.phase, 'ready');
	/* 幂等：再调不发请求。 */
	await ensureCardPermissionLoaded();
	assert.equal(calls, 1);
});

void test('api 未接上：ensure 什么都不做，不进 load-error', async () => {
	await ensureCardPermissionLoaded();
	assert.equal(cardPermissionStore().phase, 'loading');
});

void test('GET 失败 ⇒ load-error；refresh 可重试', async () => {
	let fail = true;
	attachCardPermissionApi(
		fakeApi({ get: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve(structuredClone(DATA))) }),
	);
	await refreshCardPermission();
	assert.equal(cardPermissionStore().phase, 'load-error');
	fail = false;
	await refreshCardPermission();
	assert.equal(cardPermissionStore().phase, 'ready');
});

void test('点当前档不发请求；点选项外的值不发', async () => {
	attachCardPermissionApi(fakeApi());
	await ensureCardPermissionLoaded();
	/* 同值不发。 */
	await selectCardPermissionLevel('no-claim');
	/* 选项表里没有这个值不发。 */
	await selectCardPermissionLevel('nonsense');
	const state = cardPermissionStore();
	assert.ok(state.phase === 'ready');
	assert.equal(state.level, 'no-claim');
	assert.equal(state.pending, null);
});

void test('点新档：乐观选中 + POST 只带 cardActionLevel + 成功回声覆盖', async () => {
	let seen: { cardActionLevel?: string; toolGuardLevel?: string } | undefined;
	attachCardPermissionApi(
		fakeApi({
			set: (input) => {
				seen = input;
				return Promise.resolve({ cardActionLevel: 'claim', toolGuardLevel: 'off' });
			},
		}),
	);
	await ensureCardPermissionLoaded();
	const saving = selectCardPermissionLevel('claim');
	/* 乐观：POST 未返回前选中态已是新值，pending 在飞。 */
	let mid = cardPermissionStore();
	assert.ok(mid.phase === 'ready');
	assert.equal(mid.level, 'claim');
	assert.equal(mid.pending?.value, 'claim');
	await saving;
	assert.deepEqual(seen, { cardActionLevel: 'claim' });
	const done = cardPermissionStore();
	assert.ok(done.phase === 'ready');
	assert.equal(done.level, 'claim');
	assert.equal(done.pending, null);
});

void test('保存失败：回滚到点之前的档位', async () => {
	attachCardPermissionApi(
		fakeApi({ set: () => Promise.reject(new Error('网络炸了')) }),
	);
	await ensureCardPermissionLoaded();
	await selectCardPermissionLevel('claim');
	const state = cardPermissionStore();
	assert.ok(state.phase === 'ready');
	assert.equal(state.level, 'no-claim');
	assert.equal(state.pending, null);
	assert.ok(state.saveError?.message.includes('已回滚到'));
});
