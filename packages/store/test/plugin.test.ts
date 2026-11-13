/**
 * `@taskboard/store` 的插件测试 —— 不需要真 Cordis。
 *
 * ## 为什么用假 ctx
 *
 * 本插件只调用宿主上下文的两个方法（`provide` / `effect`）。为这两个方法
 * 起一套真 Cordis 只会让测试变慢、并在失败时给出与插件无关的堆栈。
 *
 * ⇒ 用一个**记录调用的假 ctx**，直接断言「提供了什么服务、登记了什么清理」。
 *
 * ## 覆盖哪些事
 *
 * 1. 服务名 `taskboard3Store` 被 provide 了（换实现靠这个名字接上）
 * 2. 提供的 store 真能读写（不是空壳）
 * 3. 按空间隔离
 * 4. kv 读写与删除
 * 5. 卸载时登记了 `close()` 清理
 *
 * ⚠ **不再测试「提供了 search」** —— 搜索已并入 core 并强耦合，
 *   本插件不管搜索了。见 `src/index.ts` 顶部说明。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { apply, STORE_SERVICE } from '../src/index.ts';
import type { ApplyContext } from '../src/index.ts';

import type { Card, CardStore } from '@taskboard/core';

/** 假上下文：记录 provide 与 effect 的调用。 */
function fakeContext(): ApplyContext & {
	provided: Map<string, unknown>;
	cleanups: (() => void)[];
} {
	const provided = new Map<string, unknown>();
	const cleanups: (() => void)[] = [];
	return {
		provided,
		cleanups,
		provide(name: string, api: unknown): void {
			provided.set(name, api);
		},
		effect(effect: () => () => void, _label?: string): void {
			cleanups.push(effect());
		},
	};
}

/** 造一张最小可用的卡。 */
function makeCard(id: string, title: string, status: string): Card {
	return {
		id,
		title,
		status: status as Card['status'],
		template: { ref: 'userNeed', kind: 'goal', domain: '核心' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		history: [],
		deleted: false,
		claimedBy: null,
		claimedAt: null,
		createdAt: 0,
		adoptedAt: null,
	};
}

describe('store 插件', () => {
	let dataDir: string;
	let ctx: ReturnType<typeof fakeContext>;

	before(() => {
		dataDir = mkdtempSync(join(tmpdir(), 'taskboard3-store-'));
		ctx = fakeContext();
		apply(ctx, { dataDir });
	});

	after(() => {
		for (const cleanup of ctx.cleanups) cleanup();
		rmSync(dataDir, { recursive: true, force: true });
	});

	it('provide 了约定好的服务名', () => {
		assert.equal(ctx.provided.has(STORE_SERVICE), true, `缺少 ${STORE_SERVICE}`);
		/* 名字是**对外契约** —— 换实现的人必须提供同名服务。锁住字符串本身。 */
		assert.equal(STORE_SERVICE, 'taskboard3Store');
		/* 只有一个服务 —— 搜索不再是本插件的职责。 */
		assert.equal(ctx.provided.size, 1);
	});

	it('提供的 store 能写、能全量读回', async () => {
		const store = ctx.provided.get(STORE_SERVICE) as CardStore;
		const card = makeCard('GU01', '第一张卡', 'TASK_STATE_SUBMITTED');

		await store.save('ws1', card);
		const all = store.loadAll('ws1');

		assert.equal(all.length, 1);
		assert.equal(all[0]?.id, 'GU01');
		assert.equal(all[0]?.title, '第一张卡');
	});

	it('store 按空间隔离', async () => {
		const store = ctx.provided.get(STORE_SERVICE) as CardStore;
		await store.save('ws2', makeCard('GD01', '另一个空间的卡', 'TASK_STATE_WORKING'));

		assert.equal(store.loadAll('ws1').length, 1);
		assert.equal(store.loadAll('ws2').length, 1);
		assert.equal(store.loadAll('ws3').length, 0);
	});

	it('store 的 kv 读写与删除', async () => {
		const store = ctx.provided.get(STORE_SERVICE) as CardStore;
		assert.equal(store.kvGet('current:abc'), undefined);

		await store.kvSet('current:abc', 'ws1');
		assert.equal(store.kvGet('current:abc'), 'ws1');

		await store.kvSet('current:abc', undefined);
		assert.equal(store.kvGet('current:abc'), undefined);
	});

	it('卸载时登记了 close 清理', () => {
		assert.equal(ctx.cleanups.length, 1, '应当只登记一个 effect');
		const cleanup = ctx.cleanups[0];
		assert.equal(typeof cleanup, 'function');
	});
});
