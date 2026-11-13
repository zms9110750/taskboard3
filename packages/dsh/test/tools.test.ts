/**
 * AI 工具测试。
 *
 * ## 为什么可以直接测
 *
 * `src/tools.ts` **不 import `@deepseek-ai/dsh-tools`** —— 它只声明 `DefineTool`
 * 窄形状，由调用方注入。⇒ 测试传一个**假的 `defineTool`**：原样保留
 * `name/description/parameters/output`，`execute` 原样返回。
 *
 * 这样测的是**工具自己的逻辑**（参数映射、错误翻译、文案），
 * 而 DSH 的 schema 编译与参数校验不在本测试范围（那是 `dsh-tools` 的契约）。
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

import { createTools, describeFailure, type DefineTool, type ToolLike } from '../src/tools.ts';

/* ────────────────────────────── 夹具 ────────────────────────────── */

/** 假 `defineTool`：只保留字段，`execute` 原样透传。 */
const fakeDefineTool: DefineTool = (options) => ({
	name: options.name,
	description: options.description,
	parameters: options.parameters,
	output: options.output,
	async execute(args: never, exec: never): Promise<unknown> {
		return options.execute(args, exec);
	},
});

const TEMPLATE_DIR = join(dirname(createRequire(import.meta.url).resolve('@taskboard/core/package.json')), 'templates');

let dataDir = '';
let taskboard: Taskboard;
let tools: readonly ToolLike[];

before(() => {
	dataDir = mkdtempSync(join(tmpdir(), 'tb3-tools-'));
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

/** 当前用例的工作空间 id。 */
let workspaceId = '';

beforeEach(async () => {
	await closeTaskboard();
	taskboard = createTaskboard({
		dataDir,
		search: createSearch({ groupOf: (s) => STATUS_GROUP_OF[s as TaskState] }),
	});
	taskboard.templates().loadDirectory(TEMPLATE_DIR);

	const created = await taskboard.createWorkspace(`工具测试-${Date.now()}`);
	assert.equal(created.ok, true);
	if (created.ok) workspaceId = created.workspace.id;

	tools = createTools({
		taskboard,
		defineTool: fakeDefineTool,
		defaultWorkspaceId: async () => workspaceId,
	});
});

/** 按名字取工具。 */
function tool(name: string): ToolLike {
	const found = tools.find((one) => one.name === name);
	assert.notEqual(found, undefined, `缺工具 ${name}`);
	return found as ToolLike;
}

/** 跑一个工具，取回文本。 */
async function run(name: string, args: unknown): Promise<string> {
	const value = (await tool(name).execute(fakeDefineTool === undefined ? args : args, {})) as { text: string };
	return value.text;
}

/* ────────────────────────────── 用例 ────────────────────────────── */

describe('工具注册面', () => {
	it('三个工具，名字稳定', () => {
		assert.deepEqual(
			tools.map((one) => one.name),
			['taskboard_workspaces', 'taskboard_cards', 'taskboard_create'],
		);
	});

	it('schema 静态：参数表不含按模板/空间生成的动态字段', () => {
		/* `content` 必须是开放对象 —— 一旦按模板展开，就会击穿 KV cache。 */
		const create = tool('taskboard_create');
		const content = (create.parameters as { content?: { additionalProperties?: boolean } }).content;
		assert.equal(content?.additionalProperties, true, 'content 必须是开放对象');
		/* 生成的 properties 里只有 4 个固定键，不随模板变。 */
		assert.deepEqual(Object.keys(create.parameters).sort(), ['content', 'templateRef', 'title', 'workspaceId']);
	});

	it('每个工具都有 output schema 与 render', () => {
		for (const one of tools) {
			assert.equal(typeof one.output.schema, 'object');
			const rendered = one.output.render({}, { text: 'x' });
			assert.deepEqual(rendered, [{ type: 'text', text: 'x' }]);
		}
	});
});

describe('taskboard_workspaces', () => {
	it('列出空间并带卡数', async () => {
		const text = await run('taskboard_workspaces', {});
		assert.ok(text.includes('工作空间'), text);
		assert.ok(text.includes(workspaceId), text);
	});

	it('空任务板时给出下一步', async () => {
		await closeTaskboard();
		taskboard = createTaskboard({
			dataDir: mkdtempSync(join(tmpdir(), 'tb3-empty-')),
			search: createSearch({ groupOf: (s) => STATUS_GROUP_OF[s as TaskState] }),
		});
		tools = createTools({
			taskboard,
			defineTool: fakeDefineTool,
			defaultWorkspaceId: async () => '',
		});
		const text = await run('taskboard_workspaces', {});
		assert.ok(text.includes('还没有任何工作空间'), text);
	});
});

describe('taskboard_create', () => {
	it('省略 templateRef 时用第一个可用模板', async () => {
		const first = taskboard.listTemplates()[0];
		assert.notEqual(first, undefined);
		const text = await run('taskboard_create', { title: '自动选模板' });
		assert.ok(text.startsWith('已建卡 '), text);
		if (first !== undefined) assert.ok(text.includes(first.ref), text);
	});

	it('指定 templateRef 建卡成功，列出章节', async () => {
		const first = taskboard.listTemplates()[0];
		if (first === undefined) return;
		const text = await run('taskboard_create', { title: '指定模板', templateRef: first.ref });
		assert.ok(text.includes('已建卡'), text);
		assert.ok(text.includes('章节'), text);
	});

	it('未知 templateRef ⇒ 友好错误 + 下一步', async () => {
		const text = await run('taskboard_create', { title: 'x', templateRef: '不存在的模板' });
		assert.ok(text.startsWith('建卡失败'), text);
		assert.ok(text.includes('下一步'), `应带修复指引：${text}`);
	});

	it('错章节名 ⇒ 错误里列出可用章节', async () => {
		const first = taskboard.listTemplates()[0];
		if (first === undefined) return;
		const text = await run('taskboard_create', {
			title: 'x',
			templateRef: first.ref,
			content: { 瞎写的章节: { $type: 'text', value: 'y' } },
		});
		assert.ok(text.startsWith('建卡失败'), text);
		/* core 的 CONTENT_INVALID 会列出可用章节名。 */
		assert.ok(text.includes('瞎写的章节') || text.includes('章节'), text);
	});

	it('缺 title ⇒ 报错而不是建成空标题卡', async () => {
		const before = taskboard.list(workspaceId).length;
		const text = await run('taskboard_create', { title: '' });
		assert.ok(text.startsWith('建卡失败'), text);
		assert.equal(taskboard.list(workspaceId).length, before, '不该建出卡');
	});
});

describe('taskboard_cards', () => {
	it('不带 status ⇒ 不含草稿', async () => {
		const first = taskboard.listTemplates()[0];
		if (first === undefined) return;
		const made = await taskboard.create({ workspaceId, templateRef: first.ref, title: '草稿卡' });
		assert.equal(made.ok, true);

		const text = await run('taskboard_cards', {});
		assert.ok(!text.includes('草稿卡'), `默认不该列出草稿：${text}`);
	});

	it('status=draft ⇒ 能看到草稿', async () => {
		const first = taskboard.listTemplates()[0];
		if (first === undefined) return;
		const made = await taskboard.create({ workspaceId, templateRef: first.ref, title: '要看见我' });
		assert.equal(made.ok, true);

		const text = await run('taskboard_cards', { status: ['draft'] });
		assert.ok(text.includes('要看见我'), text);
	});

	it('标题筛选命中与不命中', async () => {
		const first = taskboard.listTemplates()[0];
		if (first === undefined) return;
		await taskboard.create({ workspaceId, templateRef: first.ref, title: '登录页面改版' });

		const hit = await run('taskboard_cards', { title: '登录', status: ['draft'] });
		assert.ok(hit.includes('登录页面改版'), hit);

		const miss = await run('taskboard_cards', { title: '不存在的字', status: ['draft'] });
		assert.ok(miss.includes('没有符合条件'), miss);
	});
});

describe('describeFailure', () => {
	it('带 issues 时逐条列出', () => {
		const text = describeFailure({
			ok: false,
			code: 'CONTENT_INVALID',
			message: '充数不对',
			issues: [
				{ path: '/content/要查什么', message: '必填' },
				{ path: '', message: '整体不对' },
			],
		});
		assert.ok(text.includes('充数不对'), text);
		assert.ok(text.includes('下一步'), text);
		assert.ok(text.includes('/content/要查什么：必填'), text);
		assert.ok(text.includes('(整体)：整体不对'), text);
	});

	it('无 issues 时不出现「具体问题」段', () => {
		const text = describeFailure({ ok: false, code: 'CARD_NOT_FOUND', message: '找不到' });
		assert.ok(!text.includes('具体问题'), text);
	});
});
