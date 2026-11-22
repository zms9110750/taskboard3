/**
 * DSH 工具适配层测试（tool contract v2）。
 *
 * ## 为什么这文件被重写（v1 → v2，`2026-11-22`）
 *
 * v1 的 67 个用例测的是 dsh 自己的 16 个工具本体；迁移后这些本体已经删除
 * （唯一真值在 `@taskboard/tools`，那边有 73 条自己的测试）。
 * 本文件改为测 **DSH 适配层契约**：
 *
 * · 注册面：10 个 v2 工具、顺序、`hosts` 过滤结果；
 * · schema 转换：JSON Schema → DSH `parameters`（required 内联、enum/items 保留）；
 * · ctx 注入：holder（subagents 名字 / agent UUID 回落）、默认空间、激活空间、
 *   权限开关（toolLevel=manage-edit）；
 * · 每个工具经适配层跑一遍正常路径 + 一条失败路径（确认真能到达 core，
 *   且失败文案按 v2 契约输出）。
 *
 * ## 测试方法没变
 *
 * `src/tools.ts` 只声明 `DefineTool` 窄形状；这里传一个**假 `defineTool`**：
 * 原样保留 name/description/parameters/output，`execute` 原样返回。
 * DSH 真正编译 schema / 每次调用前校验不在本测试范围（那由 DSH 自己保证）。
 *
 * ⚠ 与 v1 oracle 的差异逐条对应见迁移报告；核心是 **v2 删了 6 个工具**
 *   （adopt / claim / release / registry / mark_seen / update_content /
 *    tool_policies / tool_policy_set / tool_policy_members / tool_policy_reset
 *    合并进 10 个新工具），对应用例按 v2 语义重写而不是删除行为覆盖。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createSearch, createTaskboard, type Taskboard } from '@taskboard/core';
import { STATUS_GROUP_OF, TaskState, type TaskState as TaskStateType } from '@taskboard/protocol';

import {
	createTools,
	describeFailure,
	describeUnread,
	type DefineTool,
	type ToolLike,
} from '../src/tools.ts';

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

let taskboard: Taskboard;
let tools: readonly ToolLike[];
let workspaceId = '';

/** 每个用例一个独立数据目录（避免上一个用例的空间/卡漏到下一个）。 */
const createdDirs: string[] = [];

after(async () => {
	await closeTaskboard();
	for (const dir of createdDirs) {
		for (let i = 0; i < 10; i += 1) {
			try {
				rmSync(dir, { recursive: true, force: true });
				break;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
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
	const dataDir = mkdtempSync(join(tmpdir(), 'tb3-dsh-tools-'));
	createdDirs.push(dataDir);
	taskboard = createTaskboard({
		dataDir,
		search: createSearch({ groupOf: (state) => STATUS_GROUP_OF[state as TaskStateType] }),
	});
	taskboard.templates().loadDirectory(TEMPLATE_DIR);

	const created = await taskboard.createWorkspace(`适配层测试-${Date.now()}`);
	assert.equal(created.ok, true);
	if (created.ok) workspaceId = created.workspace.id;

	/* 每个用例显式复位两条轴（档位是 core 持久化状态，会漏到下一个用例）。 */
	await taskboard.setCardActionLevel('no-claim');
	await taskboard.setToolGuardLevel('off');

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

/** 不需要 workspaceId 的工具。 */
const NO_WORKSPACE_TOOLS: ReadonlySet<string> = new Set(['taskboard_workspaces', 'taskboard_definitions', 'taskboard_tool_policy_read']);

/**
 * 给参数补 workspaceId（用户 2026-11-22 取消了「激活空间」）。
 *
 * @param name 工具名
 * @param args 原始参数
 */
function withWorkspace(name: string, args: unknown): unknown {
	if (NO_WORKSPACE_TOOLS.has(name)) return args;
	if (typeof args !== 'object' || args === null) return { workspaceId };
	if ('workspaceId' in args) return args;
	return { workspaceId, ...(args as Record<string, unknown>) };
}

/** 跑一个工具，取回文本。 */
async function run(name: string, args: unknown, exec: unknown = { agent: { id: 'agent-uuid' } }): Promise<string> {
	const value = (await tool(name).execute(withWorkspace(name, args), exec)) as { text: string };
	return value.text;
}

/** 跑一个工具，取回完整结果对象（测 output 形状用）。 */
async function runRaw(name: string, args: unknown, exec: unknown = { agent: { id: 'agent-uuid' } }): Promise<{ text: string }> {
	return (await tool(name).execute(withWorkspace(name, args), exec)) as { text: string };
}

/** 建一张卡（走 core，不经过工具，用来布置状态）。 */
async function seedCard(templateRef: string, title: string, options: { readonly actor?: 'ai' | 'user' } = {}): Promise<string> {
	const created = await taskboard.create({
		workspaceId,
		templateRef,
		title,
		actor: options.actor ?? 'ai',
	});
	assert.equal(created.ok, true);
	if (!created.ok) throw new Error(created.message);
	return created.card.id;
}

/** 取某类别的第一个模板 ref（内置模板的 ref 是文件名，如 writeCode）。 */
function templateRefOfKind(kind: string): string {
	const found = taskboard.listTemplates().find((one) => one.kind === kind);
	assert.notEqual(found, undefined, '缺类别的模板：' + kind);
	return (found as { readonly ref: string }).ref;
}

/** work 类别模板 ref（大多数流程用例用它）。 */
function workRef(): string {
	return templateRefOfKind('work');
}
/** 用 core 把草稿推到「提交」（用户采纳）。 */
async function submit(cardId: string): Promise<void> {
	const adopted = await taskboard.adopt(workspaceId, cardId, 'user');
	assert.equal(adopted.ok, true);
}

/* ────────────────────────────── 注册面 ────────────────────────────── */

describe('工具注册面（适配层 = 薄）', () => {
	it('暴露 v2 的 11 个工具，名字与顺序稳定', () => {
		assert.deepEqual(
			tools.map((one) => one.name),
			[
				'taskboard_workspaces',
				'taskboard_cards',
				'taskboard_card',
				'taskboard_raw_card',
				'taskboard_definitions',
				'taskboard_create',
				'taskboard_update',
				'taskboard_update_note',
				'taskboard_transition',
				'taskboard_tool_policy',
				'taskboard_tool_policy_read',
			],
		);
	});

	it('v1 的 16 个旧工具名一个都不再注册', () => {
		const names = new Set(tools.map((one) => one.name));
		for (const old of [
			'taskboard_update_content',
			'taskboard_adopt',
			'taskboard_claim',
			'taskboard_release',
			'taskboard_registry',
			'taskboard_mark_seen',
			'taskboard_tool_policies',
			'taskboard_tool_policy_set',
			'taskboard_tool_policy_members',
			'taskboard_tool_policy_reset',
		]) {
			assert.equal(names.has(old), false, `旧工具「${old}」不该再注册`);
		}
	});

	it('「仅 DSH」的 #9 在列表里（MCP 侧过滤不在本适配层）', () => {
		assert.equal(tool('taskboard_tool_policy') !== undefined, true);
	});

	it('每个工具都有名字、描述、参数表、output', () => {
		for (const one of tools) {
			assert.ok(one.name.startsWith('taskboard_'), one.name);
			assert.ok(one.description.length > 20, `${one.name} 描述太短`);
			assert.equal(typeof one.parameters, 'object', one.name);
			assert.equal(typeof one.output, 'object', one.name);
			assert.equal(typeof one.output.render, 'function', one.name);
			assert.deepEqual(one.output.schema, {
				type: 'object',
				additionalProperties: false,
				properties: { text: { type: 'string', description: '给模型看的文字结果。', required: true } },
			});
			assert.deepEqual(one.output.render({}, { text: 'hi' }), [{ type: 'text', text: 'hi' }]);
		}
	});

	it('schema 静态：两次建工具参数表逐字节相同（prompt 前缀契约）', () => {
		const again = createTools({
			taskboard,
			defineTool: fakeDefineTool,
			defaultWorkspaceId: async () => workspaceId,
			subagents: stubSubagents('测试agent'),
		});
		assert.equal(
			JSON.stringify(tools.map((one) => one.parameters)),
			JSON.stringify(again.map((one) => one.parameters)),
		);
	});
});

/* ────────────────────────── ① schema 转换 ────────────────────────── */

describe('schema 转换（JSON Schema → DSH parameters）', () => {
	it('required 数组变成属性上的 required: true，且只标必填项', () => {
		const create = tool('taskboard_create').parameters as Record<string, Record<string, unknown>>;
		assert.equal(create['title']?.['required'], true);
		assert.equal(create['templateRef']?.['required'], undefined, 'schema 里 templateRef 可选（handler 里才强制）');
		assert.equal(create['workspaceId']?.['required'], undefined);
		assert.equal(create['content']?.['required'], undefined);
	});

	it('enum 保留（定义类型 / 关系类型 / 权限档位）', () => {
		const definitions = tool('taskboard_definitions').parameters as Record<string, Record<string, unknown>>;
		assert.deepEqual(definitions['type']?.['enum'], ['domain', 'state', 'template', 'kind']);

		const create = tool('taskboard_create').parameters as Record<string, Record<string, unknown>>;
		const relations = create['relations'] as Record<string, unknown>;
		const items = relations['items'] as Record<string, unknown>;
		const itemProperties = items['properties'] as Record<string, Record<string, unknown>>;
		assert.deepEqual(itemProperties['type']?.['enum'], [
			'parent',
			'dependsOn',
			'supersedes',
			'constrains',
			'related',
			'references',
		]);

		const policy = tool('taskboard_tool_policy').parameters as Record<string, Record<string, unknown>>;
		assert.deepEqual(policy['tier']?.['enum'], ['unclaimed', 'claimed']);
	});

	it('开放对象与「任意 JSON」不被锁死（content additionalProperties / update value 无 type）', () => {
		const create = tool('taskboard_create').parameters as Record<string, Record<string, unknown>>;
		assert.equal(create['content']?.['additionalProperties'], true);
		assert.equal(create['content']?.['type'], 'object');

		const update = tool('taskboard_update').parameters as Record<string, Record<string, unknown>>;
		/*
		 * ⚠ v2 的 value 是裸 `{}`（任意 JSON），但 **DSH 必须显式 `type: 'json'`** ——
		 *   它自己的专用类型，等价于「任意 JSON」。不写会报
		 *   `parameters.value.type must be string/number/.../json, or use oneOf`。
		 *   ⇒ 适配层把它翻成 `json`，语义不变（仍然什么都能塞）。
		 */
		assert.equal(update['value']?.['type'], 'json', 'v2 的裸 {} 翻成 DSH 的 json 类型（仍任意 JSON）');
		assert.equal(update['path']?.['required'], true);
	});

	it('taskboard_transition 的 to 是 string 不是 enum（状态表扩了不能击穿 prompt 缓存）', () => {
		const transition = tool('taskboard_transition').parameters as Record<string, Record<string, unknown>>;
		assert.equal(transition['to']?.['type'], 'string');
		assert.equal(transition['to']?.['enum'], undefined);
	});

	it('数组参数保留 items；嵌套对象保留 properties/required', () => {
		const policy = tool('taskboard_tool_policy').parameters as Record<string, Record<string, unknown>>;
		assert.equal((policy['allow'] as Record<string, unknown>)['type'], 'array');
		assert.equal(((policy['allow'] as Record<string, unknown>)['items'] as Record<string, unknown>)['type'], 'string');
	});
});

/* ────────────────────────── ②① ctx：默认空间 / 激活空间 ────────────────────────── */

describe('ctx：默认空间与激活空间', () => {
	it('不传 workspaceId ⇒ 用 defaultWorkspaceId 解析（与 v1 入口策略一致）', async () => {
		const text = await run('taskboard_cards', { status: ['draft'] });
		assert.ok(text.includes('（0 张）'), text);
	});

	it('显式 workspaceId 优先于默认空间', async () => {
		const other = await taskboard.createWorkspace('另一个空间');
		assert.equal(other.ok, true);
		if (!other.ok) return;
		const text = await run('taskboard_cards', { workspaceId: other.workspace.id, status: ['draft'] });
		assert.ok(text.includes('（0 张）'), text);
	});

});

/* ────────────────────────── ②② ctx：holder ────────────────────────── */

describe('ctx：holder（领取/释放的持有者）', () => {
	it('claim 用 subagents 给的名字当 holder', async () => {
		await taskboard.setCardActionLevel('claim');
		const id = await seedCard(workRef(), '领卡用例');
		await submit(id);
		await run('taskboard_transition', { id, to: TaskState.WORKING });
		const after = taskboard.get(workspaceId, id);
		assert.equal(after.ok, true);
		if (after.ok) assert.deepEqual(after.card.holders.map((one) => one.holder), ['测试agent']);
	});

	it('subagents 缺席 ⇒ holder 回落 agent.id（功能照样可用）', async () => {
		const local = createTools({
			taskboard,
			defineTool: fakeDefineTool,
			defaultWorkspaceId: async () => workspaceId,
		});
		await taskboard.setCardActionLevel('claim');
		const id = await seedCard(workRef(), 'UUID 持有');
		await submit(id);
		const transition = local.find((one) => one.name === 'taskboard_transition') as ToolLike;
		await transition.execute({ workspaceId, id, to: TaskState.WORKING }, { agent: { id: 'uuid-1234' } });
		const after = taskboard.get(workspaceId, id);
		if (after.ok) assert.deepEqual(after.card.holders.map((one) => one.holder), ['uuid-1234']);
	});

	it('没有 agent 上下文 ⇒ holder=unknown（不编名字，claim 仍能工作）', async () => {
		await taskboard.setCardActionLevel('adopt');
		const id = await seedCard(workRef(), '无 agent 上下文');
		const text = await run('taskboard_transition', { id, to: TaskState.SUBMITTED }, {});
		assert.ok(text.includes('已采纳'), text);
	});
});

/* ────────────────────────── ②③ ctx：权限开关 ────────────────────────── */

describe('ctx：权限开关（#9 的门槛 = 宿主轴 manage-edit）', () => {
	it('off 档 ⇒ #9 拒绝执行（agent 侧权限开关未启用）', async () => {
		const text = await run('taskboard_tool_policy', { tier: 'unclaimed', allow: ['bash'] });
		assert.ok(text.includes('权限开关未启用'), text);
		assert.ok(text.includes('失败'), text);
	});

	it('manage-edit 档 ⇒ #9 可执行，且能读到写入结果', async () => {
		await taskboard.setToolGuardLevel('manage-edit');
		const text = await run('taskboard_tool_policy', { tier: 'unclaimed', allow: ['bash'] });
		assert.ok(text.includes('已更新'), text);
		assert.ok(text.includes('bash'), text);
		assert.deepEqual([...taskboard.getToolPolicies().unclaimed], ['bash']);
	});
});

/* ────────────────────────── 各工具经适配层 ────────────────────────── */

describe('taskboard_workspaces', () => {
	it('列出空间并带卡数', async () => {
		await seedCard(workRef(), '一张卡');
		const text = await run('taskboard_workspaces', {});
		assert.ok(text.includes('工作空间（1 个）'), text);
		assert.ok(text.includes(workspaceId), text);
		assert.ok(text.includes('1 张卡'), text);
	});

	it('空任务板（无空间）时给出下一步，不是崩溃', async () => {
		const emptyDir = mkdtempSync(join(tmpdir(), 'tb3-dsh-empty-'));
		const empty = createTaskboard({ dataDir: emptyDir });
		try {
			const emptyTools = createTools({ taskboard: empty, defineTool: fakeDefineTool, defaultWorkspaceId: async () => '' });
			const workspaces = emptyTools.find((one) => one.name === 'taskboard_workspaces') as ToolLike;
			const value = (await workspaces.execute({}, {})) as { text: string };
			assert.ok(value.text.includes('没有任何工作空间'), value.text);
		} finally {
			await empty.close();
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});
});

describe('taskboard_cards', () => {
	it('不带 status ⇒ 不含草稿', async () => {
		await seedCard(workRef(), '草稿不该出现');
		const text = await run('taskboard_cards', {});
		assert.ok(!text.includes('草稿不该出现'), text);
	});

	it('status=draft ⇒ 能看到草稿', async () => {
		await seedCard(workRef(), '可见草稿');
		const text = await run('taskboard_cards', { status: ['draft'] });
		assert.ok(text.includes('可见草稿'), text);
	});

	it('标题筛选命中与不命中', async () => {
		await seedCard(workRef(), '登录页面改版');
		await seedCard(workRef(), '无关任务');
		const hit = await run('taskboard_cards', { title: '登录', status: ['draft'] });
		assert.ok(hit.includes('登录页面改版'), hit);
		assert.ok(!hit.includes('无关任务'), hit);
	});

	it('非法状态筛选值 ⇒ 失败文案列出可用值', async () => {
		const text = await run('taskboard_cards', { status: ['不存在的状态'] });
		assert.ok(text.includes('失败'), text);
		assert.ok(text.includes('原因码'), text);
	});
});

describe('taskboard_card', () => {
	it('返回元数据、章节、历史；查看即 AI 已读', async () => {
		const id = await seedCard(workRef(), '详情卡', { actor: 'user' });
		const text = await run('taskboard_card', { id });
		assert.ok(text.includes(id), text);
		assert.ok(text.includes('详情卡'), text);
		assert.ok(text.includes('状态：'), text);
		assert.ok(text.includes('已标记 AI 已读'), text);
		const after = taskboard.get(workspaceId, id);
		if (after.ok) assert.equal(after.card.unread.user, false);
	});

	it('不存在的编号 ⇒ 失败文案', async () => {
		const text = await run('taskboard_card', { id: 'NOPE' });
		assert.ok(text.includes('失败'), text);
		assert.ok(text.includes('CARD_NOT_FOUND'), text);
	});
});

describe('taskboard_raw_card', () => {
	it('返回纯 JSON：sectionKey → payload', async () => {
		const id = await seedCard(workRef(), '原始 JSON');
		const value = (await tool('taskboard_raw_card').execute({ workspaceId, id }, { agent: { id: 'x' } })) as { text: string };
		const json = JSON.parse(value.text) as Record<string, unknown>;
		assert.equal(typeof json, 'object');
		assert.ok(Object.keys(json).length > 0);
	});

	it('不存在 ⇒ 失败文案', async () => {
		const text = await run('taskboard_raw_card', { id: 'NOPE' });
		assert.ok(text.includes('CARD_NOT_FOUND'), text);
	});
});

describe('taskboard_definitions', () => {
	it('不传 name ⇒ 列出 4 类定义', async () => {
		const text = await run('taskboard_definitions', {});
		assert.ok(text.includes('领域（'), text);
		assert.ok(text.includes('状态（'), text);
		assert.ok(text.includes('模板（'), text);
		assert.ok(text.includes('分类（'), text);
	});

	it('给模板 ref ⇒ 列出章节与 action', async () => {
		const ref = taskboard.listTemplates()[0]?.ref ?? '';
		const text = await run('taskboard_definitions', { name: ref, type: 'template' });
		assert.ok(text.includes('章节'), text);
		assert.ok(text.includes('action='), text);
	});

	it('不存在的名字 ⇒ 失败并提示先列清单', async () => {
		const text = await run('taskboard_definitions', { name: '不存在的定义' });
		assert.ok(text.includes('失败'), text);
		assert.ok(text.includes('不传 name') || text.includes('列'), text);
	});
});

describe('taskboard_create', () => {
	it('建卡成功（title + templateRef），actor 标记为 ai', async () => {
		const ref = taskboard.listTemplates()[0]?.ref ?? '';
		const text = await run('taskboard_create', { title: '适配层建的卡', templateRef: ref });
		assert.ok(text.includes('已建卡'), text);
		const made = taskboard.list(workspaceId).find((one) => one.title === '适配层建的卡');
		assert.notEqual(made, undefined);
		const updates = await taskboard.updates(workspaceId);
		assert.ok(updates.ai.includes(made?.id ?? ''), 'AI 工具建卡应进 updates.ai');
	});

	it('未知 templateRef ⇒ 失败并指路 taskboard_definitions', async () => {
		const text = await run('taskboard_create', { title: '坏模板', templateRef: '不存在' });
		assert.ok(text.includes('失败'), text);
		assert.ok(text.includes('taskboard_definitions'), text);
	});

	it('缺 title ⇒ 失败而不是建成空标题卡', async () => {
		const before = taskboard.list(workspaceId).length;
		const ref = taskboard.listTemplates()[0]?.ref ?? '';
		const text = await run('taskboard_create', { templateRef: ref });
		assert.ok(text.includes('失败') || text.includes('title'), text);
		assert.equal(taskboard.list(workspaceId).length, before);
	});

	it('章节完整 + 额外的非章节 key ⇒ 草稿 + 警告（isError 不透传）', async () => {
		/* 选一个只有一个章节的模板（listTemplates 不含 sections ⇒ 从 registry 取展开视图）。 */
		const summary = taskboard.listTemplates().find((one) => {
			const meta = taskboard.templates().get(one.ref);
			return meta !== undefined && meta.sections.length === 1;
		});
		assert.notEqual(summary, undefined, '应当存在单章节模板');
		const ref = summary?.ref ?? '';
		const section = taskboard.templates().get(ref)?.sections[0];
		const content: Record<string, unknown> = {
			[section?.label ?? '']: { $type: 'text', value: 'x' },
			额外的章节: { $type: 'text' },
		};
		const text = await run('taskboard_create', { title: '带额外章节', templateRef: ref, content });
		assert.ok(text.includes('已建卡'), text);
		assert.ok(text.includes('⚠ 警告'), text);
	});
});

describe('taskboard_update', () => {
	it('按 JSON 路径替换；返回 JSON + 当前状态与下一步', async () => {
		const id = await seedCard(workRef(), '更新卡');
		const raw = JSON.parse(
			((await tool('taskboard_raw_card').execute({ workspaceId, id }, { agent: { id: 'x' } })) as { text: string }).text,
		) as Record<string, unknown>;
		const sectionKey = Object.keys(raw)[0] ?? 'body';
		const payload = (raw[sectionKey] ?? {}) as Record<string, unknown>;
		const value = '$type' in payload ? { ...payload, value: '新内容' } : { ...payload, value: '新内容' };

		const text = await run('taskboard_update', { id, path: `/${sectionKey}`, value });
		assert.ok(text.includes('—— 当前状态与接下来可以做什么 ——'), text);
		const jsonText = text.slice(0, text.indexOf('\n\n—— 当前状态'));
		const updated = JSON.parse(jsonText) as Record<string, unknown>;
		assert.deepEqual(updated[sectionKey], value);
	});

	it('未知路径 ⇒ 失败并指路 taskboard_raw_card', async () => {
		const id = await seedCard(workRef(), '坏路径');
		const text = await run('taskboard_update', { id, path: '/nope/x', value: 1 });
		assert.ok(text.includes('失败'), text);
		assert.ok(text.includes('taskboard_raw_card'), text);
	});
});

describe('taskboard_update_note', () => {
	it('写备注；返回状态与下一步', async () => {
		const id = await seedCard(workRef(), '备注卡');
		const text = await run('taskboard_update_note', { id, note: '适配层备注' });
		assert.ok(text.includes('已更新'), text);
		assert.ok(text.includes('—— 当前状态与接下来可以做什么 ——'), text);
		const after = taskboard.get(workspaceId, id);
		if (after.ok) assert.equal(after.card.note, '适配层备注');
	});

	it('草稿期可改标题；非草稿拒绝（v2 新规则）', async () => {
		const draft = await seedCard(workRef(), '旧标题');
		const ok = await run('taskboard_update_note', { id: draft, title: '新标题' });
		assert.ok(ok.includes('已把标题'), ok);
		const after = taskboard.get(workspaceId, draft);
		if (after.ok) assert.equal(after.card.title, '新标题');

		const submitted = await seedCard(workRef(), '已提交卡');
		await submit(submitted);
		const rejected = await run('taskboard_update_note', { id: submitted, title: '想改' });
		assert.ok(rejected.includes('只有草稿期可以改标题'), rejected);
	});

	it('两个参数都不给 ⇒ 失败', async () => {
		const id = await seedCard(workRef(), '参数测试');
		const text = await run('taskboard_update_note', { id });
		assert.ok(text.includes('至少给 title 或 note'), text);
	});
});

describe('taskboard_transition', () => {
	it('to 为空 ⇒ 返回当前状态与可转目标，不执行', async () => {
		const id = await seedCard(workRef(), '查询目标');
		const text = await run('taskboard_transition', { id });
		assert.ok(text.includes('当前状态'), text);
		assert.ok(text.includes('接下来可转移的目标'), text);
		const after = taskboard.get(workspaceId, id);
		if (after.ok) assert.equal(after.card.status, TaskState.UNSPECIFIED);
	});

	it('采纳（cardLevel=adopt）⇒ 写 adoptedAt + history 的 adopt(actor=ai)', async () => {
		await taskboard.setCardActionLevel('adopt');
		const id = await seedCard(workRef(), '采纳卡');
		const text = await run('taskboard_transition', { id, to: TaskState.SUBMITTED });
		assert.ok(text.includes('已采纳'), text);
		const after = taskboard.get(workspaceId, id);
		if (after.ok) {
			assert.equal(after.card.status, TaskState.SUBMITTED);
			assert.notEqual(after.card.adoptedAt, null);
			assert.equal(after.card.history.some((entry) => entry.action === 'adopt' && entry.actor === 'ai'), true);
		}
	});

	it('cardLevel=no-claim ⇒ 采纳被拦，下一步指路让用户在 UI 开权限', async () => {
		const id = await seedCard(workRef(), '默认档位草稿');
		const text = await run('taskboard_transition', { id, to: TaskState.SUBMITTED });
		assert.ok(text.includes('不允许 AI 采纳草稿'), text);
		assert.ok(text.includes('允许采纳草稿'), text);
		const after = taskboard.get(workspaceId, id);
		if (after.ok) assert.equal(after.card.status, TaskState.UNSPECIFIED);
	});

	it('claim / release 经适配层用 ctx holder 工作', async () => {
		await taskboard.setCardActionLevel('adopt');
		const id = await seedCard(workRef(), '领取释放');
		await submit(id);
		const claimed = await run('taskboard_transition', { id, to: TaskState.WORKING });
		assert.ok(claimed.includes('已领取'), claimed);
		const released = await run('taskboard_transition', { id, to: TaskState.SUBMITTED });
		assert.ok(released.includes('已释放'), released);
	});

	it('非法状态名 ⇒ 失败并列出可用状态', async () => {
		const id = await seedCard(workRef(), '非法目标');
		const text = await run('taskboard_transition', { id, to: '瞎写' });
		assert.ok(text.includes('不是已知状态'), text);
		assert.ok(text.includes('TASK_STATE_SUBMITTED'), text);
	});

	it('不存在的编号 ⇒ 失败文案', async () => {
		const text = await run('taskboard_transition', { id: 'NOPE' });
		assert.ok(text.includes('CARD_NOT_FOUND'), text);
	});
});

describe('taskboard_tool_policy', () => {
	it('tier 与 templateRef 二选一；两个都给 ⇒ 失败', async () => {
		await taskboard.setToolGuardLevel('manage-edit');
		const text = await run('taskboard_tool_policy', { tier: 'claimed', templateRef: 'x', allow: [] });
		assert.ok(text.includes('二选一'), text);
	});

	it('未知模板 ⇒ 失败', async () => {
		await taskboard.setToolGuardLevel('manage-edit');
		const text = await run('taskboard_tool_policy', { templateRef: '不存在的模板', allow: ['bash'] });
		assert.ok(text.includes('失败'), text);
	});
});

/* ────────────────────────── 输出 / 兼容导出 ────────────────────────── */

describe('输出形状与公开面兼容', () => {
	it('成功结果是 { text }，不带 isError（DSH output schema 只允许 text）', async () => {
		const value = await runRaw('taskboard_cards', {});
		assert.deepEqual(Object.keys(value), ['text']);
		assert.equal((value as { isError?: unknown }).isError, undefined);
	});

	it('describeUnread 四条措辞（公开 API 兼容）', () => {
		assert.equal(describeUnread({ ai: false, user: false }), '双方都已读');
		assert.equal(describeUnread({ ai: false, user: true }), '用户改过，AI 待读');
		assert.equal(describeUnread({ ai: true, user: false }), 'AI 改过，用户待读');
		assert.equal(describeUnread({ ai: true, user: true }), '双方都有未读');
	});

	it('describeFailure 兼容导出仍可用（新代码不再用它）', () => {
		const text = describeFailure({
			ok: false,
			code: 'CARD_NOT_FOUND',
			message: '找不到',
			issues: [{ path: '/id', message: '不存在' }],
		});
		assert.ok(text.includes('找不到'), text);
		assert.ok(text.includes('下一步：'), text);
		assert.ok(text.includes('/id：不存在'), text);
	});
});

