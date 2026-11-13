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
import { createSearch } from '@taskboard/search';

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
