/**
 * 工作空间测试 —— CRUD、归档语义、`ensureAnyWorkspace`。
 *
 * ## 为什么这里没有「存储实现」的测试了
 *
 * 原来本文件还覆盖 `CardStore` 的四个操作 + SQLite 载体。用户 `2026-11-23`
 * 把持久化实现拆到 `@taskboard/io`：
 *
 * > 「1.内存内容同步到磁盘的持久化这一边要做接口。
 * >   然后另一边由 io 包实现接口并用 sqlite 实现。」
 *
 * ⇒ 那些用例跟着实现搬到了 `packages/io/test/sqlite.test.ts`。
 *   本文件只用**内存 store**（`memory-store.ts`）—— 测的是工作空间语义，
 *   不需要真磁盘，也就没有 `mkdtemp` / `rmSync` / 清理失败重试。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTaskboard, type Taskboard } from '../src/index.ts';
import { createMemoryStore } from './memory-store.ts';

describe('工作空间：CRUD 与归档', () => {
	let tb: Taskboard;

	const start = (): Taskboard => {
		const board = createTaskboard({ store: createMemoryStore(), now: () => 1_000 });
		return board;
	};

	it('建空间，id 是 ws1', async () => {
		tb = start();
		try {
			const result = await tb.createWorkspace('一号');
			assert.ok(result.ok, '建空间应成功');
			assert.equal(result.workspace.id, 'ws1');
			assert.equal(result.workspace.displayName, '一号');
			assert.equal(result.workspace.archived, false);
		} finally {
			await tb.close();
		}
	});

	it('重名被拒', async () => {
		tb = start();
		try {
			await tb.createWorkspace('一号');
			const result = await tb.createWorkspace('一号');
			assert.equal(result.ok, false);
		} finally {
			await tb.close();
		}
	});

	it('空名被拒', async () => {
		tb = start();
		try {
			const result = await tb.createWorkspace('   ');
			assert.equal(result.ok, false);
		} finally {
			await tb.close();
		}
	});

	it('名字被清洗（去首尾空白、折叠连续空白）', async () => {
		tb = start();
		try {
			const result = await tb.createWorkspace('  二   号  ');
			assert.ok(result.ok, '清洗后应当非空');
			assert.equal(result.workspace.displayName, '二 号');
		} finally {
			await tb.close();
		}
	});

	it('归档后默认列表不含，includeArchived 含', async () => {
		tb = start();
		try {
			const created = await tb.createWorkspace('一号');
			assert.ok(created.ok);
			await tb.archiveWorkspace('ws1');
			const visible = tb.listWorkspaces();
			assert.equal(
				visible.some((one) => one.id === 'ws1'),
				false,
			);
			const all = tb.listWorkspaces(true);
			assert.equal(
				all.some((one) => one.id === 'ws1'),
				true,
			);
		} finally {
			await tb.close();
		}
	});

	it('归档幂等：再归档 changed=false', async () => {
		tb = start();
		try {
			await tb.createWorkspace('一号');
			await tb.archiveWorkspace('ws1');
			const result = await tb.archiveWorkspace('ws1');
			assert.ok('changed' in result);
			assert.equal(result.changed, false);
		} finally {
			await tb.close();
		}
	});

	it('取消归档后回到列表', async () => {
		tb = start();
		try {
			await tb.createWorkspace('一号');
			await tb.archiveWorkspace('ws1');
			await tb.unarchiveWorkspace('ws1');
			assert.equal(
				tb.listWorkspaces().some((one) => one.id === 'ws1'),
				true,
			);
		} finally {
			await tb.close();
		}
	});

	it('归档的空间照样可读写（归档 ≠ 失活）', async () => {
		tb = start();
		try {
			await tb.createWorkspace('一号');
			await tb.archiveWorkspace('ws1');
			const created = await tb.create({
				workspaceId: 'ws1',
				templateRef: 'nope',
				title: 'x',
				actor: 'user',
			});
			/* 模板不存在会失败，但**不是**因为空间被归档 —— 报的是 TEMPLATE_NOT_FOUND。 */
			assert.equal(created.ok, false);
			assert.equal(created.code, 'TEMPLATE_NOT_FOUND');
		} finally {
			await tb.close();
		}
	});

	it('ensureAnyWorkspace 已有空间时返回第一个', async () => {
		tb = start();
		try {
			await tb.createWorkspace('一号');
			const ws = await tb.ensureAnyWorkspace();
			assert.equal(ws.id, 'ws1');
		} finally {
			await tb.close();
		}
	});
});

describe('ensureAnyWorkspace：空库时建「默认」', () => {
	it('空库建出一个名为「默认」的空间', async () => {
		const tb = createTaskboard({ store: createMemoryStore(), now: () => 1_000 });
		try {
			const ws = await tb.ensureAnyWorkspace();
			assert.equal(ws.displayName, '默认');
			assert.equal(tb.listWorkspaces().length, 1);
		} finally {
			await tb.close();
		}
	});

	it('再调一次不重复建', async () => {
		const tb = createTaskboard({ store: createMemoryStore(), now: () => 1_000 });
		try {
			await tb.ensureAnyWorkspace();
			const before = tb.listWorkspaces().length;
			await tb.ensureAnyWorkspace();
			assert.equal(tb.listWorkspaces().length, before);
		} finally {
			await tb.close();
		}
	});
});
