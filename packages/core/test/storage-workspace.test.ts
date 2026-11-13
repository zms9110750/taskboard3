/**
 * 存储与工作空间测试。
 *
 * 覆盖 `CardStore` 的四个操作、SQLite 载体、工作空间 CRUD 与归档语义。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createSqliteStore } from '../lib/storage/sqlite.js';
import { createTaskboard, type Taskboard } from '../lib/index.js';
import type { CardStore } from '../lib/ports.js';
import type { Card } from '../lib/card.js';

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
	};
}

describe('storage/sqlite：CardStore 的四个操作', () => {
	let dir: string;
	let store: CardStore;

	before(() => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-store-test-'));
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

	it('重开同一目录，数据仍在（持久化）', async () => {
		const reopened = createSqliteStore(dir);
		assert.equal(reopened.loadAll('ws1').length, 1);
		assert.equal(reopened.loadAll('ws1')[0]?.title, '改名了');
		await reopened.close();
	});
});

describe('工作空间：CRUD 与归档', () => {
	let dir: string;
	let tb: Taskboard;

	before(() => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-ws-test-'));
		tb = createTaskboard({ dataDir: dir, now: () => 1_000 });
	});

	after(async () => {
		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('建空间，id 是 ws1', async () => {
		const result = await tb.createWorkspace('一号');
		assert.ok(result.ok, '建空间应成功');
		assert.equal(result.workspace.id, 'ws1');
		assert.equal(result.workspace.displayName, '一号');
		assert.equal(result.workspace.archived, false);
	});

	it('重名被拒', async () => {
		const result = await tb.createWorkspace('一号');
		assert.equal(result.ok, false);
	});

	it('空名被拒', async () => {
		const result = await tb.createWorkspace('   ');
		assert.equal(result.ok, false);
	});

	it('名字被清洗（去首尾空白、折叠连续空白）', async () => {
		const result = await tb.createWorkspace('  二   号  ');
		assert.ok(result.ok, '清洗后应当非空');
		assert.equal(result.workspace.displayName, '二 号');
	});

	it('归档后默认列表不含，includeArchived 含', async () => {
		await tb.archiveWorkspace('ws1');
		const visible = tb.listWorkspaces();
		assert.equal(visible.some((one) => one.id === 'ws1'), false);
		const all = tb.listWorkspaces(true);
		assert.equal(all.some((one) => one.id === 'ws1'), true);
	});

	it('归档幂等：再归档 changed=false', async () => {
		const result = await tb.archiveWorkspace('ws1');
		assert.ok('changed' in result);
		assert.equal(result.changed, false);
	});

	it('取消归档后回到列表', async () => {
		await tb.unarchiveWorkspace('ws1');
		assert.equal(tb.listWorkspaces().some((one) => one.id === 'ws1'), true);
	});

	it('归档的空间照样可读写（归档 ≠ 失活）', async () => {
		await tb.archiveWorkspace('ws1');
		const created = await tb.create({ workspaceId: 'ws1', templateRef: 'nope', title: 'x' });
		/* 模板不存在会失败，但**不是**因为空间被归档 —— 报的是 TEMPLATE_NOT_FOUND。 */
		assert.equal(created.ok, false);
		assert.equal(created.code, 'TEMPLATE_NOT_FOUND');
	});

	it('ensureAnyWorkspace 已有空间时返回第一个', async () => {
		const ws = await tb.ensureAnyWorkspace();
		assert.equal(ws.id, 'ws1');
	});
});

describe('ensureAnyWorkspace：空库时建「默认」', () => {
	let dir: string;
	let tb: Taskboard;

	before(() => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-empty-test-'));
		tb = createTaskboard({ dataDir: dir, now: () => 1_000 });
	});

	after(async () => {
		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('空库建出一个名为「默认」的空间', async () => {
		const ws = await tb.ensureAnyWorkspace();
		assert.equal(ws.displayName, '默认');
		assert.equal(tb.listWorkspaces().length, 1);
	});

	it('再调一次不重复建', async () => {
		const before = tb.listWorkspaces().length;
		await tb.ensureAnyWorkspace();
		assert.equal(tb.listWorkspaces().length, before);
	});
});
