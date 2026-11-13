/**
 * 斜杠命令测试。
 *
 * 命令只读 core、拼文字 ⇒ 直接用一个记录注册项的假 registry 测。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createTaskboard, type Taskboard } from '@taskboard/core';
import { STATUS_GROUP_OF, type TaskState } from '@taskboard/protocol';
import { createSearch } from '@taskboard/core';

import { registerCommands, type CommandRegistryLike } from '../src/commands.ts';

/* ────────────────────────────── 夹具 ────────────────────────────── */

const TEMPLATE_DIR = join(dirname(createRequire(import.meta.url).resolve('@taskboard/core/package.json')), 'templates');

let dataDir = '';
let taskboard: Taskboard;
let current = '';

interface Registered {
	readonly name: string;
	readonly description: string;
	handler(invocation: unknown): unknown;
}

/** 假 registry：把注册项收进数组。 */
function makeRegistry(): { registry: CommandRegistryLike; registered: Registered[] } {
	const registered: Registered[] = [];
	return {
		registered,
		registry: {
			register(command) {
				registered.push(command as Registered);
				return () => undefined;
			},
		},
	};
}

before(() => {
	dataDir = mkdtempSync(join(tmpdir(), 'tb3-cmd-'));
});

after(async () => {
	await closeTaskboard();
	for (let i = 0; i < 10; i += 1) {
		try {
			rmSync(dataDir, { recursive: true, force: true });
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
});

async function closeTaskboard(): Promise<void> {
	if (taskboard === undefined) return;
	const closing = taskboard;
	taskboard = undefined as unknown as Taskboard;
	await closing.close();
}

beforeEach(async () => {
	await closeTaskboard();
	taskboard = createTaskboard({
		dataDir,
		search: createSearch({ groupOf: (s) => STATUS_GROUP_OF[s as TaskState] }),
	});
	taskboard.templates().loadDirectory(TEMPLATE_DIR);
	current = '';
});

/** 注册命令并取 `/taskboard`。 */
function setup(): Registered {
	const { registry, registered } = makeRegistry();
	registerCommands(registry, { taskboard, defaultWorkspaceId: async () => current });
	const found = registered.find((one) => one.name === 'taskboard');
	assert.notEqual(found, undefined);
	return found as Registered;
}

/* ────────────────────────────── 用例 ────────────────────────────── */

describe('/taskboard', () => {
	it('注册了 name 与 description', () => {
		const command = setup();
		assert.equal(command.name, 'taskboard');
		assert.ok(command.description.length > 0);
	});

	it('没有任何空间时给出提示', async () => {
		const result = (await setup().handler({})) as { kind: string; text: string };
		assert.equal(result.kind, 'success');
		assert.ok(result.text.includes('还没有任何工作空间'), result.text);
	});

	it('列出全部空间，并标出当前空间', async () => {
		const a = await taskboard.createWorkspace('空间甲');
		const b = await taskboard.createWorkspace('空间乙');
		assert.equal(a.ok && b.ok, true);
		if (!a.ok || !b.ok) return;
		current = a.workspace.id;

		const result = (await setup().handler({})) as { kind: string; text: string };
		assert.ok(result.text.includes(a.workspace.id), result.text);
		assert.ok(result.text.includes(b.workspace.id), result.text);
		/* 当前空间那一行带 ★。 */
		const starLine = result.text.split('\n').find((line) => line.includes(a.workspace.id));
		assert.ok(starLine?.includes('★'), `当前空间应标 ★：${starLine}`);
	});

	it('按状态统计当前空间的卡', async () => {
		const created = await taskboard.createWorkspace('统计');
		assert.equal(created.ok, true);
		if (!created.ok) return;
		current = created.workspace.id;

		const template = taskboard.listTemplates()[0];
		if (template === undefined) return;
		await taskboard.create({ workspaceId: current, templateRef: template.ref, title: '一' });
		await taskboard.create({ workspaceId: current, templateRef: template.ref, title: '二' });

		const result = (await setup().handler({})) as { kind: string; text: string };
		assert.ok(result.text.includes('共 2 张卡'), result.text);
		/* 两张都是草稿 ⇒ 应出现「未指定: 2」。 */
		assert.ok(result.text.includes('未指定: 2'), result.text);
	});

	it('默认空间解析抛错时命令不崩', async () => {
		const { registry, registered } = makeRegistry();
		registerCommands(registry, {
			taskboard,
			defaultWorkspaceId: async () => {
				throw new Error('boom');
			},
		});
		const created = await taskboard.createWorkspace('有空间');
		assert.equal(created.ok, true);

		const command = registered[0] as Registered;
		const result = (await command.handler({})) as { kind: string; text: string };
		assert.equal(result.kind, 'success');
		assert.ok(result.text.includes('未确定'), result.text);
	});
});

/* ────────────────────────── /task-card 与 /task-create ────────────────────────── */

/** 注册全部命令，按名字取。 */
function setupAll(): Map<string, Registered> {
	const { registry, registered } = makeRegistry();
	registerCommands(registry, { taskboard, defaultWorkspaceId: async () => current });
	return new Map(registered.map((one) => [one.name, one]));
}

/** 造一张卡，返回编号。 */
async function makeCard(title: string): Promise<string> {
	const ref = taskboard.listTemplates()[0]?.ref ?? '';
	const created = await taskboard.create({ workspaceId: current, templateRef: ref, title });
	assert.equal(created.ok, true);
	return created.ok ? created.card.id : '';
}

describe('/task-card', () => {
	it('注册了三个命令', async () => {
		const created = await taskboard.createWorkspace('命令空间');
		assert.equal(created.ok, true);
		if (created.ok) current = created.workspace.id;
		const all = setupAll();
		assert.deepEqual([...all.keys()].sort(), ['task-card', 'task-create', 'taskboard']);
	});

	it('给编号 ⇒ 返回卡的元数据', async () => {
		const created = await taskboard.createWorkspace('看卡');
		assert.equal(created.ok, true);
		if (!created.ok) return;
		current = created.workspace.id;
		const id = await makeCard('要被看到的卡');

		const command = setupAll().get('task-card') as Registered;
		const result = (await command.handler({ rawInput: id })) as { kind: string; text: string };
		assert.equal(result.kind, 'success');
		assert.ok(result.text.includes(id), result.text);
		assert.ok(result.text.includes('要被看到的卡'), result.text);
	});

	it('不给编号 ⇒ 用法提示', async () => {
		const command = setupAll().get('task-card') as Registered;
		const result = (await command.handler({ rawInput: '' })) as { kind: string; text: string };
		assert.equal(result.kind, 'error');
		assert.ok(result.text.includes('用法'), result.text);
	});

	it('不存在的编号 ⇒ error', async () => {
		const created = await taskboard.createWorkspace('找不到');
		assert.equal(created.ok, true);
		if (!created.ok) return;
		current = created.workspace.id;
		const command = setupAll().get('task-card') as Registered;
		const result = (await command.handler({ rawInput: 'NOPE-99' })) as { kind: string; text: string };
		assert.equal(result.kind, 'error');
	});
});

describe('/task-create', () => {
	it('建出草稿卡', async () => {
		const created = await taskboard.createWorkspace('建卡命令');
		assert.equal(created.ok, true);
		if (!created.ok) return;
		current = created.workspace.id;

		const command = setupAll().get('task-create') as Registered;
		const result = (await command.handler({ rawInput: '命令建的卡' })) as { kind: string; text: string };
		assert.equal(result.kind, 'success', result.text);
		assert.ok(result.text.includes('命令建的卡'), result.text);

		const titles = taskboard.list(current).map((one) => one.title);
		assert.ok(titles.includes('命令建的卡'), titles.join(','));
	});

	it('不给标题 ⇒ 用法提示', async () => {
		const command = setupAll().get('task-create') as Registered;
		const result = (await command.handler({ rawInput: '   ' })) as { kind: string; text: string };
		assert.equal(result.kind, 'error');
		assert.ok(result.text.includes('用法'), result.text);
	});
});
