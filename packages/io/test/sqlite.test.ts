/**
 * `@taskboard/io` 的 SQLite 实现测试。
 *
 * ## 为什么这些用例从 core 搬过来了
 *
 * 原来它们在 `packages/core/test/storage-workspace.test.ts` 的
 * 「`storage/sqlite`：`CardStore` 的操作」那一节 —— 因为实现当时在 core 里。
 *
 * 用户 `2026-11-23`：
 * > 「1.内存内容同步到磁盘的持久化这一边要做接口。
 * >   然后另一边由 io 包实现接口并用 sqlite 实现。」
 *
 * ⇒ 实现搬到本包，**实现自己的测试也跟着搬**。core 那边只留「工作空间语义」
 *   那几节（它们用内存 store 就够，不依赖 SQLite）。
 *
 * ## 这里测的是「实现」，不是「端口」
 *
 * 端口契约由 `core/src/ports.ts` 的注释定义；本文件验证 **SQLite 这个具体实现**
 * 遵守它，并且真的落盘（重开仍在），以及坏数据不炸整个库。
 *
 * ## 每个用例独立目录
 *
 * 以前所有用例共用一个 `dir` / `store`，`ws1` 的数据靠用例注册顺序传递 ——
 * 单跑一个用例、或 node:test 改成并发就会红。现在 `beforeEach` 给每个用例
 * 建独立临时目录，用例之间零依赖。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { Card, CardStore } from '@taskboard/core';

import { createSqliteStore } from '../src/index.ts';

/** 造一张最小可用的卡。 */
function makeCard(id: string): Card {
	return {
		id,
		title: `卡 ${id}`,
		status: 'TASK_STATE_UNSPECIFIED',
		template: { ref: 'demo', kind: 'work', domain: 'core' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		createdAt: 0,
		adoptedAt: null,
		history: [],
		deleted: false,
		holders: [],
		unread: { ai: false, user: false },
	};
}

/** 当前用例的临时目录与 store（`beforeEach` 建立）。 */
let dir: string | undefined;
let store: CardStore | undefined;

/** 取当前用例的目录；判空是给类型检查的，不是业务分支。 */
function testDir(): string {
	assert.ok(dir, 'beforeEach 未建立临时目录');
	return dir;
}

/** 取当前用例的 store；判空同上。 */
function testStore(): CardStore {
	assert.ok(store, 'beforeEach 未建立 store');
	return store;
}

/** 目录里的库文件名 —— 不硬编码 `taskboard3.db`，改名时测试跟着走。 */
function dbFile(): string {
	const found = readdirSync(testDir()).find((name) => name.endsWith('.db'));
	assert.ok(found, `${testDir()} 下没有 .db 文件`);
	return join(testDir(), found);
}

describe('storage/sqlite：CardStore 的读写契约', () => {
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-io-sqlite-'));
		store = createSqliteStore(dir);
	});

	afterEach(async () => {
		/* 用例自己可能已经 close 过（重开 / 幂等用例）；close 幂等，所以这里再关一次。 */
		await store?.close();
		if (dir !== undefined) {
			rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		}
		dir = undefined;
		store = undefined;
	});

	it('save + loadAll 往返一致', async () => {
		await testStore().save('roundtrip', makeCard('A01'));

		const loaded = testStore().loadAll('roundtrip');
		assert.equal(loaded.length, 1);
		const [first] = loaded;
		assert.ok(first, 'loadAll 应返回刚写入的卡');
		assert.equal(first.id, 'A01');
		assert.equal(first.title, '卡 A01');
	});

	it('同一 id 再 save 是覆盖，不是追加', async () => {
		await testStore().save('upsert', makeCard('A01'));
		await testStore().save('upsert', { ...makeCard('A01'), title: '改名了' });

		const loaded = testStore().loadAll('upsert');
		assert.equal(loaded.length, 1, '不应多出一行');
		const [first] = loaded;
		assert.ok(first, 'loadAll 应返回被覆盖的卡');
		assert.equal(first.title, '改名了');
	});

	it('不同空间互不可见', async () => {
		await testStore().save('iso-a', makeCard('B01'));
		await testStore().save('iso-b', makeCard('B02'));

		assert.equal(testStore().loadAll('iso-a').length, 1);
		assert.equal(testStore().loadAll('iso-b').length, 1);
		assert.equal(testStore().loadAll('iso-empty').length, 0);
	});

	it('kvGet / kvSet 往返；undefined 删除键', async () => {
		assert.equal(testStore().kvGet('k'), undefined);
		await testStore().kvSet('k', 'v1');
		assert.equal(testStore().kvGet('k'), 'v1');
		await testStore().kvSet('k', 'v2');
		assert.equal(testStore().kvGet('k'), 'v2');
		await testStore().kvSet('k', undefined);
		assert.equal(testStore().kvGet('k'), undefined);
	});

	it('⭐ 重开同一目录，数据仍在（真持久化 —— SQLite 实现独有的价值）', async () => {
		await testStore().save('reopen', makeCard('R01'));
		await testStore().close();

		const reopened = createSqliteStore(testDir());
		try {
			const loaded = reopened.loadAll('reopen');
			assert.equal(loaded.length, 1);
			const [first] = loaded;
			assert.ok(first, '重开后应读回同一张卡');
			assert.equal(first.id, 'R01');
		} finally {
			await reopened.close();
		}
	});

	it('⭐ 坏数据不炸整个库（跳过该行，其余照读）', async () => {
		/*
		 * 契约（`core/src/ports.ts` 注释）：「数据是用户资产，一张坏卡不该让
		 * 所有人看不到卡」。直接在库文件里写坏行，再 loadAll ——必须返回其余好卡、不抛。
		 *
		 * 两类坏数据都要覆盖：
		 *   · 语法坏 JSON（旧实现只挡这一类）
		 *   · 合法 JSON 但形状坏（null / {} 也会被当成 Card 混进内存）
		 */
		await testStore().save('corrupt', makeCard('C01'));
		await testStore().save('corrupt', makeCard('C02'));
		await testStore().save('corrupt', makeCard('C03'));
		await testStore().close();

		const raw = new DatabaseSync(dbFile());
		try {
			raw.prepare('UPDATE cards SET doc = ? WHERE id = ?').run('{ 这不是 JSON', 'C01');
			raw.prepare('UPDATE cards SET doc = ? WHERE id = ?').run('{"id":"C02"}', 'C02');
		} finally {
			raw.close();
		}

		const third = createSqliteStore(testDir());
		try {
			let loaded: readonly Card[] = [];
			assert.doesNotThrow(() => {
				loaded = third.loadAll('corrupt');
			});
			assert.equal(loaded.length, 1, '两条坏行被跳过，好行照读');
			const [first] = loaded;
			assert.ok(first, '应剩下没被破坏的那张卡');
			assert.equal(first.id, 'C03');
		} finally {
			await third.close();
		}
	});

	it('⭐ 连接启用 WAL，且 schema 版本为 1', () => {
		const raw = new DatabaseSync(dbFile());
		try {
			assert.equal(
				raw.prepare('PRAGMA journal_mode').get()?.journal_mode,
				'wal',
				'WAL 没生效 —— 打开时读回 journal_mode 的断言应当已经拦住这种情况',
			);
			assert.equal(
				raw.prepare('PRAGMA user_version').get()?.user_version,
				1,
				'新库应声明 schema 版本 1（将来迁移阶梯的起点）',
			);
		} finally {
			raw.close();
		}
	});

	it('close 幂等：重复关闭不抛，关闭后操作失败', async () => {
		await testStore().close();
		await assert.doesNotReject(async () => {
			await testStore().close();
		}, '第二次 close 不应抛错（Cordis 拆卸 + 测试清理会各调一次）');
		assert.throws(
			() => testStore().loadAll('closed'),
			/database is not open|statement has been finalized/,
			'关闭后仍能读会掩盖句柄没释放',
		);
	});

	it('⭐ busy_timeout：别的连接持写锁时 save 会等待，而不是立刻失败', async () => {
		const raw = new DatabaseSync(dbFile());
		try {
			raw.exec('BEGIN IMMEDIATE');

			const startedAt = performance.now();
			await assert.rejects(
				async () => {
					await testStore().save('busy', makeCard('B01'));
				},
				/database is locked|SQLITE_BUSY/i,
			);
			const elapsed = performance.now() - startedAt;

			/*
			 * busy_timeout = 5000 ⇒ 失败前应当等满约 5s。
			 * 默认 0 会在几十毫秒内抛错 —— 这个下界就是用来区分两者的。
			 * （本用例耗时约 5.5s，是这条 PRAGMA 唯一可观察的行为。）
			 */
			assert.ok(
				elapsed >= 4000,
				`save 只等了 ${String(Math.round(elapsed))}ms —— busy_timeout 没生效`,
			);
		} finally {
			raw.exec('ROLLBACK');
			raw.close();
		}
	});
});
