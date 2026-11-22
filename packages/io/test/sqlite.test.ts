/**
 * `@taskboard/io` 的 SQLite 实现测试。
 *
 * ## 为什么这些用例从 core 搬过来了
 *
 * 原来它们在 `packages/core/test/storage-workspace.test.ts` 的
 * 「`storage/sqlite`：`CardStore` 的四个操作」那一节 —— 因为实现当时在 core 里。
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
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';

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

describe('storage/sqlite：CardStore 的四个操作', () => {
	let dir: string;
	let store: CardStore;

	before(() => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-io-test-'));
		store = createSqliteStore(dir);
	});

	after(async () => {
		await store.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('save + loadAll 往返一致', async () => {
		await store.save('ws1', makeCard('A01'));
		const loaded = store.loadAll('ws1');
		assert.equal(loaded.length, 1);
		assert.equal(loaded[0]?.id, 'A01');
		assert.equal(loaded[0]?.title, '卡 A01');
	});

	it('同一 id 再 save 是覆盖，不是追加', async () => {
		await store.save('ws1', { ...makeCard('A01'), title: '改名了' });
		const loaded = store.loadAll('ws1');
		assert.equal(loaded.length, 1, '不应多出一行');
		assert.equal(loaded[0]?.title, '改名了');
	});

	it('不同空间互不可见', async () => {
		await store.save('ws2', makeCard('B01'));
		assert.equal(store.loadAll('ws1').length, 1);
		assert.equal(store.loadAll('ws2').length, 1);
		assert.equal(store.loadAll('ws3').length, 0);
	});

	it('kvGet / kvSet 往返；undefined 删除键', async () => {
		assert.equal(store.kvGet('k'), undefined);
		await store.kvSet('k', 'v1');
		assert.equal(store.kvGet('k'), 'v1');
		await store.kvSet('k', 'v2');
		assert.equal(store.kvGet('k'), 'v2');
		await store.kvSet('k', undefined);
		assert.equal(store.kvGet('k'), undefined);
	});

	it('⭐ 重开同一目录，数据仍在（真持久化 —— SQLite 实现独有的价值）', async () => {
		const reopened = createSqliteStore(dir);
		assert.equal(reopened.loadAll('ws1').length, 1);
		assert.equal(reopened.loadAll('ws1')[0]?.title, '改名了');
		await reopened.close();
	});

	it('⭐ 坏数据不炸整个库（跳过该行，其余照读）', async () => {
		/*
		 * 契约（`core/src/ports.ts` 注释）：「数据是用户资产，一张坏卡不该让
		 * 所有人看不到卡」。直接在库文件里写一行坏 JSON，再 loadAll ——
		 * 必须返回其余好卡、不抛。
		 */
		const scratch = createSqliteStore(dir);
		await scratch.save('ws9', makeCard('C01'));
		await scratch.save('ws9', makeCard('C02'));
		await scratch.close();

		/* 手工破坏 C01 的 doc。 */
		const raw = new DatabaseSync(join(dir, 'taskboard3.db'));
		raw.prepare('UPDATE cards SET doc = ? WHERE id = ?').run('{ 这不是 JSON', 'C01');
		raw.close();

		const third = createSqliteStore(dir);
		try {
			let loaded: readonly Card[] = [];
			assert.doesNotThrow(() => {
				loaded = third.loadAll('ws9');
			});
			assert.equal(loaded.length, 1, '坏行被跳过，好行照读');
			assert.equal(loaded[0]?.id, 'C02');
		} finally {
			await third.close();
		}
	});
});
