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
 * 5. 卸载清理真的关掉了库（不是只登记了一个函数）
 * 6. dataDir 缺失 / 空串会在激活时抛错，而不是穿透到 io 深处才炸
 *
 * ⚠ **不再测试「提供了 search」** —— 搜索已并入 core 并强耦合，
 *   本插件不管搜索了。见 `src/index.ts` 顶部说明。
 *
 * ## 每个用例独立目录
 *
 * 以前所有用例共用一个 `dataDir` / `ctx`，`ws1` 的数据靠用例注册顺序传递。
 * 现在 `beforeEach` 给每个用例建独立临时目录，用例之间零依赖。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { Card, CardStore } from '@taskboard/core';

import { apply, STORE_SERVICE } from '../src/index.ts';
import type { ApplyContext, Config } from '../src/index.ts';

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
		provide<T>(name: string, api: T): void {
			provided.set(name, api);
		},
		effect(effect: () => (() => void) | void, _label?: string): void {
			const cleanup = effect();
			if (typeof cleanup === 'function') cleanups.push(cleanup);
		},
	};
}

/** 造一张最小可用的卡。 */
function makeCard(id: string, title: string, status: Card['status']): Card {
	return {
		id,
		title,
		status,
		template: { ref: 'userNeed', kind: 'goal', domain: '核心' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		history: [],
		deleted: false,
		/*
		 * ⚠ `claimedBy` / `claimedAt` 是**旧版的字段**（一卡一人持有），
		 *   已被 `holders: CardHolder[]` 取代 —— 用户 2026-11-13：
		 *   「现在不限制一个卡只能被一个拿」。夹具还在用旧字段，tsc 报 TS2353。
		 */
		holders: [],
		createdAt: 0,
		adoptedAt: null,
		/* 卡上的未读字段（`CardUnread`）。 */
		unread: { ai: false, user: false },
	};
}

/** 从假 ctx 取 store —— `provided` 的值是 `unknown`，测试知道它应是 CardStore。 */
function storeOf(context: ReturnType<typeof fakeContext>): CardStore {
	const store = context.provided.get(STORE_SERVICE);
	assert.ok(isCardStore(store), `没有 provide 一个 CardStore 形状的 ${STORE_SERVICE}`);
	return store;
}

/** 最小形状检查：五个方法都是函数。 */
function isCardStore(value: unknown): value is CardStore {
	if (typeof value !== 'object' || value === null) return false;
	const methods = ['loadAll', 'save', 'kvGet', 'kvSet', 'close'] as const;
	return methods.every((name) => typeof (value as Record<string, unknown>)[name] === 'function');
}

/** 当前用例的数据目录与假 ctx（`beforeEach` 建立）。 */
let dataDir: string | undefined;
let ctx: ReturnType<typeof fakeContext> | undefined;

/** beforeEach 一定建好了；判空是给类型检查的。 */
function testCtx(): ReturnType<typeof fakeContext> {
	assert.ok(ctx, 'beforeEach 未建立假 ctx');
	return ctx;
}

/** 取当前用例的数据目录；判空同上。 */
function testDataDir(): string {
	assert.ok(dataDir, 'beforeEach 未建立数据目录');
	return dataDir;
}

describe('store 插件', () => {
	beforeEach(() => {
		dataDir = mkdtempSync(join(tmpdir(), 'tb3-store-plugin-'));
		ctx = fakeContext();
		apply(testCtx(), { dataDir });
	});

	afterEach(() => {
		/* 用例可能已经手动跑过 cleanup（关闭幂等，再跑一次不会抛）。 */
		if (ctx !== undefined) {
			for (const cleanup of ctx.cleanups) cleanup();
		}
		if (dataDir !== undefined) {
			rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		}
		ctx = undefined;
		dataDir = undefined;
	});

	it('provide 了约定好的服务名', () => {
		const context = testCtx();
		assert.equal(context.provided.has(STORE_SERVICE), true, `缺少 ${STORE_SERVICE}`);
		/* 名字是**对外契约** —— 换实现的人必须提供同名服务。锁住字符串本身。 */
		assert.equal(STORE_SERVICE, 'taskboard3Store');
		/* 只有一个服务 —— 搜索不再是本插件的职责。 */
		assert.equal(context.provided.size, 1);
	});

	it('提供的 store 能写、能全量读回', async () => {
		const store = storeOf(testCtx());
		await store.save('write-read', makeCard('GU01', '第一张卡', 'TASK_STATE_SUBMITTED'));

		const all = store.loadAll('write-read');
		assert.equal(all.length, 1);
		const [first] = all;
		assert.ok(first, 'loadAll 应返回刚写入的卡');
		assert.equal(first.id, 'GU01');
		assert.equal(first.title, '第一张卡');
	});

	it('store 按空间隔离', async () => {
		const store = storeOf(testCtx());
		await store.save('iso-a', makeCard('GD01', 'A 空间的卡', 'TASK_STATE_WORKING'));
		await store.save('iso-b', makeCard('GD02', 'B 空间的卡', 'TASK_STATE_WORKING'));

		assert.equal(store.loadAll('iso-a').length, 1);
		assert.equal(store.loadAll('iso-b').length, 1);
		assert.equal(store.loadAll('iso-empty').length, 0);
	});

	it('store 的 kv 读写与删除', async () => {
		const store = storeOf(testCtx());
		assert.equal(store.kvGet('current:abc'), undefined);

		await store.kvSet('current:abc', 'ws1');
		assert.equal(store.kvGet('current:abc'), 'ws1');

		await store.kvSet('current:abc', undefined);
		assert.equal(store.kvGet('current:abc'), undefined);
	});

	it('卸载清理真的关掉了库（不只是登记了一个函数）', () => {
		const context = testCtx();
		const store = storeOf(context);
		assert.equal(context.cleanups.length, 1, '应当只登记一个 effect');

		const [cleanup] = context.cleanups;
		assert.ok(cleanup, '没有登记清理函数');
		cleanup();

		/* 关掉之后再操作必须失败 —— 只断言 `typeof cleanup === 'function'` 证明不了关库。 */
		assert.throws(
			() => store.loadAll('after-close'),
			/database is not open|statement has been finalized/,
		);

		/*
		 * 关闭是同步完成的（`db.close()` 没有 await），所以库文件应当能立刻删掉。
		 * 这里故意不加 maxRetries：它钉的正是 Windows 上「close 还没跑完就去删」的 EBUSY 窗口。
		 */
		const closedDir = testDataDir();
		assert.doesNotThrow(
			() => rmSync(closedDir, { recursive: true, force: true }),
			'关闭后库文件应能立刻删除（Windows EBUSY 窗口）',
		);
	});

	it('dataDir 缺失 / 空串在激活时就抛 TypeError', () => {
		const fresh = fakeContext();
		/* 模拟 patch 里漏写 dataDir（类型上不允许，运行时会发生）。 */
		const missingDataDir = {} as unknown as Config;
		assert.throws(
			() => apply(fresh, missingDataDir),
			/dataDir 必须是非空字符串路径/,
			'缺失 dataDir 应在 apply 第一行报错',
		);
		assert.throws(
			() => apply(fresh, { dataDir: '   ' }),
			/dataDir 必须是非空字符串路径/,
			'空串 dataDir 应在 apply 第一行报错',
		);
	});
});
