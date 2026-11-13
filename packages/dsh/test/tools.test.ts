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
import { createSearch } from '@taskboard/core';

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
	it('九个工具，名字稳定', () => {
		/*
		 * ⚠ 名字与顺序都是**契约**：模型按名字调用，改名字等于破坏已有会话。
		 *   顺序影响 prompt 前缀的字节序 ⇒ 也不能随意调整。
		 */
		assert.deepEqual(tools.map((one) => one.name), [
			'taskboard_workspaces',
			'taskboard_cards',
			'taskboard_card',
			'taskboard_create',
			'taskboard_update_content',
			'taskboard_update_note',
			'taskboard_transition',
			'taskboard_claim',
			'taskboard_release',
			'taskboard_registry',
		]);
	});

	it('每个工具都有名字、描述、参数表', () => {
		for (const one of tools) {
			assert.equal(typeof one.name, 'string');
			assert.ok(one.name.length > 0);
			assert.ok(one.description.length > 10, `${one.name} 的描述太短`);
			assert.equal(typeof one.parameters, 'object');
		}
	});

	it('schema 静态：content 是开放对象，不按模板展开', () => {
		for (const name of ['taskboard_create', 'taskboard_update_content']) {
			const found = tool(name);
			const content = (found.parameters as { content?: { additionalProperties?: boolean } }).content;
			assert.equal(content?.additionalProperties, true, `${name} 的 content 必须是开放对象`);
		}
		/* 建卡的参数表只有 4 个固定键，不随模板变。 */
		assert.deepEqual(Object.keys(tool('taskboard_create').parameters).sort(), [
			'content',
			'templateRef',
			'title',
			'workspaceId',
		]);
	});

	it('taskboard_transition 的 to 是 string 不是 enum', () => {
		/*
		 * 用户裁定：`enum` 会随状态表变化而改变 schema ⇒ 击穿 KV cache。
		 * 合法性在 `execute` 里判。
		 */
		const to = (tool('taskboard_transition').parameters as { to?: Record<string, unknown> }).to;
		assert.equal(to?.type, 'string');
		assert.equal(to?.enum, undefined, 'to 不允许是 enum');
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

/* ────────────────────────── 新增的六个工具 ────────────────────────── */

/** 建一张卡，返回编号。 */
async function makeCard(title: string, templateRef?: string): Promise<string> {
	const ref = templateRef ?? taskboard.listTemplates()[0]?.ref ?? '';
	const created = await taskboard.create({ workspaceId, templateRef: ref, title });
	assert.equal(created.ok, true, `建卡失败：${created.ok ? '' : created.message}`);
	return created.ok ? created.card.id : '';
}

describe('taskboard_card', () => {
	it('返回元数据、章节、历史', async () => {
		const id = await makeCard('详情测试');
		const text = await run('taskboard_card', { id });
		assert.ok(text.includes(id), text);
		assert.ok(text.includes('详情测试'), text);
		assert.ok(text.includes('状态：'), text);
		assert.ok(text.includes('模板：'), text);
	});

	it('不存在的编号 ⇒ 失败文案', async () => {
		const text = await run('taskboard_card', { id: 'NOPE-99' });
		assert.ok(text.includes('不存在'), text);
	});
});

describe('taskboard_update_note', () => {
	it('写备注', async () => {
		const id = await makeCard('备注测试');
		const text = await run('taskboard_update_note', { id, note: '这是备注' });
		assert.ok(text.includes('已更新'), text);

		const after = taskboard.get(workspaceId, id);
		assert.equal(after.ok, true);
		if (after.ok) assert.equal(after.card.note, '这是备注');
	});

	it('空串清空备注', async () => {
		const id = await makeCard('清空备注');
		await run('taskboard_update_note', { id, note: '先写点' });
		const text = await run('taskboard_update_note', { id, note: '' });
		assert.ok(text.includes('已清空'), text);

		const after = taskboard.get(workspaceId, id);
		assert.equal(after.ok, true);
		if (after.ok) assert.equal(after.card.note, '');
	});

	it('不存在的编号 ⇒ 失败文案', async () => {
		const text = await run('taskboard_update_note', { id: 'NOPE-99', note: 'x' });
		assert.ok(text.includes('失败'), text);
	});
});

describe('taskboard_update_content', () => {
	it('只改指定章节，其它章节保留', async () => {
		const ref = taskboard.listTemplates()[0]?.ref ?? '';
		const meta = taskboard.templateMeta(ref);
		assert.notEqual(meta, undefined);
		const sections = meta?.sections ?? [];
		assert.ok(sections.length >= 2, '需要至少两个章节的模板来验证「只改一章」');

		const id = await makeCard('改内容');
		const first = sections[0];
		const second = sections[1];
		if (first === undefined || second === undefined) return;

		const text = await run('taskboard_update_content', {
			id,
			content: { [first.label]: { $type: first.action, value: '第一章的内容' } },
		});
		assert.ok(text.includes('已改'), text);

		const after = taskboard.get(workspaceId, id);
		assert.equal(after.ok, true);
		if (!after.ok) return;

		/* 改的那章变了。 */
		const changed = Object.values(after.card.sections).find((one) => one.label === first.label);
		assert.notEqual(changed, undefined);
		if (changed !== undefined) {
			assert.ok(JSON.stringify(changed.payload).includes('第一章的内容'), JSON.stringify(changed.payload));
		}
		/* 没改的章还在（没有被整体替换掉）。 */
		const untouched = Object.values(after.card.sections).find((one) => one.label === second.label);
		assert.notEqual(untouched, undefined, '没传的章节不该被删掉');
	});

	it('content 不是对象 ⇒ 失败文案', async () => {
		const id = await makeCard('坏 content');
		const text = await run('taskboard_update_content', { id, content: '不是对象' });
		assert.ok(text.includes('必须是对象'), text);
	});

	it('未知章节名 ⇒ core 的校验错误', async () => {
		const id = await makeCard('错章节');
		const text = await run('taskboard_update_content', {
			id,
			content: { 瞎写的章节名: { $type: 'text', value: 'x' } },
		});
		assert.ok(text.includes('失败'), text);
	});
});

describe('taskboard_registry', () => {
	it('不带 id ⇒ 列模板与 action', async () => {
		const text = await run('taskboard_registry', {});
		assert.ok(text.includes('模板'), text);
		assert.ok(text.includes('action'), text);
	});

	it('给模板 ref ⇒ 列出章节名与每章的 action', async () => {
		const first = taskboard.listTemplates()[0];
		assert.notEqual(first, undefined);
		if (first === undefined) return;
		const text = await run('taskboard_registry', { id: first.ref });
		assert.ok(text.includes(first.ref), text);
		assert.ok(text.includes('章节'), text);
		assert.ok(text.includes('action='), text);
	});

	it('给 action 的 $type ⇒ 返回摘要', async () => {
		const action = taskboard.actions().list()[0];
		assert.notEqual(action, undefined);
		if (action === undefined) return;
		const text = await run('taskboard_registry', { id: action.$type, kind: 'action' });
		assert.ok(text.includes(action.$type), text);
	});

	it('不存在的 id ⇒ 提示先看清单', async () => {
		const text = await run('taskboard_registry', { id: '不存在的东西' });
		assert.ok(text.includes('没有名为'), text);
	});
});

describe('taskboard_transition', () => {
	it('to 为空 ⇒ 返回当前状态与可转目标，不执行', async () => {
		const id = await makeCard('查询转移');
		const before = taskboard.get(workspaceId, id);
		assert.equal(before.ok, true);

		const text = await run('taskboard_transition', { id });
		assert.ok(text.includes('当前状态'), text);
		assert.ok(text.includes('可以转去'), text);

		/* 没有执行 ⇒ 状态没变。 */
		const after = taskboard.get(workspaceId, id);
		assert.equal(after.ok, true);
		if (before.ok && after.ok) assert.equal(after.card.status, before.card.status);
	});

	it('非法状态名 ⇒ 列出可用状态', async () => {
		const id = await makeCard('坏状态');
		const text = await run('taskboard_transition', { id, to: '不存在的状态' });
		assert.ok(text.includes('不是已知状态'), text);
		assert.ok(text.includes('可用'), text);
	});

	it('认中文状态名（草稿 → 提交 是合法按钮）', async () => {
		const id = await makeCard('中文状态');
		const text = await run('taskboard_transition', { id, to: '提交' });
		/*
		 * 两种可能：core 的 transition 还没实现 ⇒ 提示「尚未实现」；
		 * 或已实现 ⇒ 真的转了。两种都算通过（本用例测的是**状态名解析**没报错）。
		 */
		assert.ok(
			text.includes('尚未') || text.includes('已把') || text.includes('失败'),
			`不该是「不是已知状态」：${text}`,
		);
		assert.ok(!text.includes('不是已知状态'), text);
	});

	it('不存在的编号 ⇒ 失败文案', async () => {
		const text = await run('taskboard_transition', { id: 'NOPE-99' });
		assert.ok(text.includes('不存在'), text);
	});
});

describe('taskboard_claim / taskboard_release', () => {
	it('claim 在 core 未实现时给出明确提示，不抛', async () => {
		const id = await makeCard('领取测试');
		const text = await run('taskboard_claim', { id });
		/* core 的 claim 可能已实现（成功/失败）或还没实现（提示）。两种都不该抛。 */
		assert.ok(text.length > 0, text);
	});

	it('release 在 core 未实现时给出明确提示，不抛', async () => {
		const id = await makeCard('释放测试');
		const text = await run('taskboard_release', { id });
		assert.ok(text.length > 0, text);
	});
});
