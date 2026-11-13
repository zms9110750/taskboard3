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
		subagents: stubSubagents('测试agent'),
	});
});

/** 假的 `ctx.subagents`：把 agent 映射成固定名字。 */
function stubSubagents(self: string): unknown {
	return { namesOf: () => ({ self }) };
}

/** 按名字取工具。 */
function tool(name: string): ToolLike {
	const found = tools.find((one) => one.name === name);
	assert.notEqual(found, undefined, `缺工具 ${name}`);
	return found as ToolLike;
}

/** 跑一个工具，取回文本。 */
async function run(name: string, args: unknown, exec: unknown = {}): Promise<string> {
	const value = (await tool(name).execute(args, exec)) as { text: string };
	return value.text;
}

/* ────────────────────────────── 用例 ────────────────────────────── */

describe('工具注册面', () => {
	it('十几个工具，名字与顺序稳定', () => {
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
			'taskboard_mark_seen',
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

/* ────────────────────────── actor 标记（配对断言） ──────────────────────────
 *
 * ## 为什么需要「配对」断言
 *
 * 只测「AI 写完 ⇒ 进 updates.ai」不够 —— 如果两边都把 actor 标成 `'ai'`，
 * 这条也会过。反过来只测 HTTP 侧同理。
 *
 * ⇒ 两条合起来才有判别力：
 *   AI 工具写完  ⇒ 进 `updates.ai`、**不进** `updates.user`
 *   HTTP 写完    ⇒ 进 `updates.user`、**不进** `updates.ai`
 *
 * 如果哪天有人把某一侧的 actor 标错（或忘了标，默认成 `'user'`），
 * 其中一条必然失败。
 */

describe('actor 标记：AI 工具写 ⇒ updates.ai', () => {
	/** 取当前空间的 updates。 */
	async function updates(): Promise<{ ai: readonly string[]; user: readonly string[] }> {
		return taskboard.updates(workspaceId);
	}

	it('AI 工具建卡 ⇒ 进 updates.ai，不进 updates.user', async () => {
		const id = await makeCardByAi('AI 建的卡');
		assert.notEqual(id, '');

		const result = await updates();
		assert.ok(result.ai.includes(id), `应进 updates.ai：${JSON.stringify(result)}`);
		assert.ok(!result.user.includes(id), `不该进 updates.user：${JSON.stringify(result)}`);
	});

	it('AI 工具改备注 ⇒ 进 updates.ai，不进 updates.user', async () => {
		const id = await makeCardByAi('AI 改备注');
		/*
		 * ⚠ 要清 `updates.ai`，必须由**用户**标记已读（`markSeen(..., 'user')`）——
		 *   因为 `updates.ai` 比的是「用户的游标」。
		 *   测试里直接调 core 模拟「用户打开过这张卡」。
		 */
		await taskboard.markSeen(workspaceId, id, 'user');

		const before = await updates();
		assert.ok(!before.ai.includes(id), `用户已读之后不该还在 ai：${JSON.stringify(before)}`);

		const text = await run('taskboard_update_note', { id, note: 'AI 写的备注' });
		assert.ok(text.includes('已更新'), text);

		const after = await updates();
		assert.ok(after.ai.includes(id), `改备注后应重新进 ai：${JSON.stringify(after)}`);
		assert.ok(!after.user.includes(id), `不该进 user：${JSON.stringify(after)}`);
	});

	it('AI 工具改章节内容 ⇒ 进 updates.ai', async () => {
		const ref = taskboard.listTemplates()[0]?.ref ?? '';
		const meta = taskboard.templateMeta(ref);
		const section = meta?.sections[0];
		assert.notEqual(section, undefined);
		if (section === undefined) return;

		const id = await makeCardByAi('AI 改内容');
		await taskboard.markSeen(workspaceId, id, 'user');

		const text = await run('taskboard_update_content', {
			id,
			content: { [section.label]: { $type: section.action, value: '改过' } },
		});
		assert.ok(text.includes('已改'), text);

		const after = await updates();
		assert.ok(after.ai.includes(id), `应进 ai：${JSON.stringify(after)}`);
		assert.ok(!after.user.includes(id), `不该进 user：${JSON.stringify(after)}`);
	});

	it('taskboard_mark_seen 清的是 updates.user（不是 updates.ai）', async () => {
		/*
		 * ⚠ **这是最容易搞反的一条。**
		 *
		 * `markSeen(cardId, reader)` 写的是**那个读者**的游标：
		 *   · `updates.ai`   比的是「用户的游标」⇒ 要用户标已读才清
		 *   · `updates.user` 比的是「AI 的游标」  ⇒ 要 AI 标已读才清
		 *
		 * 所以 `taskboard_mark_seen`（reader 固定 `'ai'`）清的是 **`updates.user`**。
		 */
		/* 用户建的卡 ⇒ 进 updates.user（用户改过、AI 未读）。 */
		const id = await makeCard('用户建的卡');
		const before = await updates();
		assert.ok(before.user.includes(id), `用户建卡后应在 user：${JSON.stringify(before)}`);
		assert.ok(!before.ai.includes(id), `不该在 ai：${JSON.stringify(before)}`);

		const text = await run('taskboard_mark_seen', { id });
		assert.ok(text.includes('已把'), text);

		const after = await updates();
		assert.ok(!after.user.includes(id), `mark_seen 后应移出 user：${JSON.stringify(after)}`);
	});

	it('userChanged / userUnread 筛选按作者区分（不是按读者）', async () => {
		/*
		 * 这条直接钉住那两个容易搞反的参数名：
		 *   userChanged ⇒ updates.user（**用户**改的）
		 *   userUnread  ⇒ updates.ai  （**用户**未读的 = AI 改的）
		 */
		const id = await makeCardByAi('AI 改的卡');
		const userCard = await makeCard('用户建的卡');

		/* AI 改的卡应在 updates.ai。 */
		const result = await updates();
		assert.ok(result.ai.includes(id), `AI 改的卡应在 ai：${JSON.stringify(result)}`);
		assert.ok(result.user.includes(userCard), `用户建的卡应在 user：${JSON.stringify(result)}`);

		/* userUnread ⇒ updates.ai ⇒ 命中 AI 改的卡。 */
		const byUnread = await run('taskboard_cards', { userUnread: true, status: ['draft'] });
		assert.ok(byUnread.includes('AI 改的卡'), `userUnread 应命中 AI 改的卡：${byUnread}`);
		assert.ok(!byUnread.includes('用户建的卡'), `userUnread 不该命中用户建的卡：${byUnread}`);

		/* userChanged ⇒ updates.user ⇒ 命中用户建的卡。 */
		const byChanged = await run('taskboard_cards', { userChanged: true, status: ['draft'] });
		assert.ok(byChanged.includes('用户建的卡'), `userChanged 应命中用户建的卡：${byChanged}`);
		assert.ok(!byChanged.includes('AI 改的卡'), `userChanged 不该命中 AI 改的卡：${byChanged}`);
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

/**
 * 建一张卡，返回编号。
 *
 * ⚠ **这个辅助函数模拟「用户建卡」**（直接调 core、不传 actor ⇒ 默认 `'user'`）。
 *   它**不会**让卡进 `updates.ai` —— 要测 AI 路径就用 `run('taskboard_create', ...)`。
 */
async function makeCard(title: string, templateRef?: string): Promise<string> {
	const ref = templateRef ?? taskboard.listTemplates()[0]?.ref ?? '';
	const created = await taskboard.create({ workspaceId, templateRef: ref, title, actor: 'user' });
	assert.equal(created.ok, true, `建卡失败：${created.ok ? '' : created.message}`);
	return created.ok ? created.card.id : '';
}

/** 用 **AI 工具**建一张卡，返回编号（会让卡进 `updates.ai`）。 */
async function makeCardByAi(title: string): Promise<string> {
	const ref = taskboard.listTemplates()[0]?.ref ?? '';
	const text = await run('taskboard_create', { title, templateRef: ref });
	assert.ok(text.includes('已建卡'), text);
	const found = taskboard.list(workspaceId).find((one) => one.title === title);
	assert.notEqual(found, undefined, `AI 建卡后找不到「${title}」`);
	return found?.id ?? '';
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
	/**
	 * 造一张能领的工作卡（提交态）：先建草稿再采纳。
	 *
	 * ⚠ 必须用 `work` 类别的模板 —— 领取只对工作卡开放（目标 / 设计 / 记录不需要执行权限）。
	 */
	async function claimableCard(title: string): Promise<string> {
		const template = taskboard.listTemplates().find((one) => one.kind === 'work');
		assert.notEqual(template, undefined, '应当存在 work 类别的模板');
		const ref = template?.ref ?? '';
		const created = await taskboard.create({ workspaceId, templateRef: ref, title });
		assert.equal(created.ok, true);
		if (!created.ok) return '';
		const cardId = created.card.id;
		/* 草稿 → 提交（work 的「采纳」）。 */
		const adopted = await taskboard.transition(workspaceId, cardId, 'TASK_STATE_SUBMITTED', 'button');
		assert.equal(adopted.ok, true, adopted.ok ? '' : adopted.message);
		return cardId;
	}

	/** 落库后的持有者名字列表（`Card.holders` 是 `CardHolder[]`，不是字符串数组）。 */
	function holderNames(cardId: string): readonly string[] {
		const found = taskboard.get(workspaceId, cardId);
		assert.equal(found.ok, true);
		return found.ok ? found.card.holders.map((one) => one.holder) : [];
	}

	it('claim 用 subagents 给的名字当 holder', async () => {
		const id = await claimableCard('领取测试');
		if (id === '') return;

		/* 工具里的 holder 来自 stubSubagents('测试agent')。 */
		const text = await run('taskboard_claim', { id }, { agent: { id: 'uuid-claim' } });
		assert.ok(text.includes('已领取'), text);
		assert.ok(text.includes('测试agent'), `holder 应是 agent 名字：${text}`);

		/* 落库的持有者是那个名字，不是 UUID。 */
		assert.deepEqual(holderNames(id), ['测试agent']);

		const after = taskboard.get(workspaceId, id);
		assert.equal(after.ok, true);
		if (after.ok) assert.equal(after.card.status, 'TASK_STATE_WORKING');
	});

	it('claim 时 subagents 缺席 ⇒ holder 回落 agent.id（功能照样可用）', async () => {
		/* 换一个没有 subagents 的工具集。 */
		const withoutSubagents = createTools({
			taskboard,
			defineTool: fakeDefineTool,
			defaultWorkspaceId: async () => workspaceId,
		});
		const id = await claimableCard('领取回落');
		if (id === '') return;

		const claimTool = withoutSubagents.find((one) => one.name === 'taskboard_claim');
		assert.notEqual(claimTool, undefined);
		const value = (await claimTool?.execute({ id }, { agent: { id: 'uuid-fallback' } })) as { text: string };
		assert.ok(value.text.includes('已领取'), value.text);
		assert.deepEqual(holderNames(id), ['uuid-fallback']);
	});

	it('claim 草稿卡 ⇒ 失败文案（草稿不能领）', async () => {
		const ref = taskboard.listTemplates().find((one) => one.kind === 'work')?.ref ?? '';
		const created = await taskboard.create({ workspaceId, templateRef: ref, title: '还是草稿' });
		assert.equal(created.ok, true);
		if (!created.ok) return;

		const text = await run('taskboard_claim', { id: created.card.id }, { agent: { id: 'uuid-y' } });
		assert.ok(text.includes('失败'), text);
	});

	it('claim 非工作类别的卡 ⇒ 失败文案（目标 / 设计 / 记录不可领）', async () => {
		const template = taskboard.listTemplates().find((one) => one.kind === 'goal');
		assert.notEqual(template, undefined);
		if (template === undefined) return;

		const created = await taskboard.create({ workspaceId, templateRef: template.ref, title: '目标卡' });
		assert.equal(created.ok, true);
		if (!created.ok) return;
		await taskboard.transition(workspaceId, created.card.id, 'TASK_STATE_SUBMITTED', 'button');

		const text = await run('taskboard_claim', { id: created.card.id }, { agent: { id: 'uuid-goal' } });
		assert.ok(text.includes('失败'), text);
	});

	it('release 释放自己 ⇒ 回到提交', async () => {
		const id = await claimableCard('释放测试');
		if (id === '') return;
		const claimed = await run('taskboard_claim', { id }, { agent: { id: 'uuid-z' } });
		assert.ok(claimed.includes('已领取'), claimed);

		const text = await run('taskboard_release', { id }, { agent: { id: 'uuid-z' } });
		assert.ok(text.includes('已释放'), text);

		assert.deepEqual(holderNames(id), []);
		const after = taskboard.get(workspaceId, id);
		assert.equal(after.ok, true);
		if (after.ok) assert.equal(after.card.status, 'TASK_STATE_SUBMITTED');
	});

	it('release 自己不在持有者里 ⇒ 失败文案（列出当前持有者）', async () => {
		/*
		 * ⚠ 要让两个不同的 holder，必须用**没有 subagents** 的工具集 ——
		 *   有 stub 时两个调用的 holder 都是 `'测试agent'`，那样 release 会成功。
		 */
		const byId = createTools({
			taskboard,
			defineTool: fakeDefineTool,
			defaultWorkspaceId: async () => workspaceId,
		});
		const claimTool = byId.find((one) => one.name === 'taskboard_claim');
		const releaseTool = byId.find((one) => one.name === 'taskboard_release');
		assert.notEqual(claimTool, undefined);
		assert.notEqual(releaseTool, undefined);
		if (claimTool === undefined || releaseTool === undefined) return;

		const id = await claimableCard('别人持有');
		if (id === '') return;

		const claimed = (await claimTool.execute({ id }, { agent: { id: 'uuid-owner' } })) as { text: string };
		assert.ok(claimed.text.includes('已领取'), claimed.text);
		assert.deepEqual(holderNames(id), ['uuid-owner']);

		/* 换一个 holder 释放 —— 它不在列表里。 */
		const released = (await releaseTool.execute({ id }, { agent: { id: 'uuid-stranger' } })) as { text: string };
		assert.ok(released.text.includes('失败'), released.text);
		/* 失败文案要列出真正的持有者，否则用户不知道该找谁。 */
		assert.ok(released.text.includes('uuid-owner'), released.text);
	});
});
