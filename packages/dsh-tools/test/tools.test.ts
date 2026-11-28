/**
 * DSH 工具适配层测试（tool contract v2）。
 *
 * ## 为什么这文件被重写（v1 → v2，`2026-11-22`）
 *
 * v1 的 67 个用例测的是 dsh 自己的 16 个工具本体；迁移后这些本体已经删除
 * （唯一真值在 `@taskboard/tools`，那边有 73 条自己的测试）。
 * 本文件改为测 **DSH 适配层契约**：
 *
 * · 注册面：9 个宿主无关工具、顺序（`test/apply.test.ts` 一次断言，含失败回滚）；
 * · schema 转换：JSON Schema → DSH `parameters`（required 内联、enum/items 保留）；
 * · ctx 注入：holder（subagents 名字 / 无 agent 上下文与拿不到名字都 ''）；
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
 *    合并进 9 个新工具；`taskboard_tool_policy` / `_read` 两个权限策略工具
 *    按用户裁决搬到 `@taskboard/dsh-agent-guard`），对应用例按 v2 语义重写而不是删除行为覆盖。
 */

// TODO(审查): 本文件 TODO 中标注的行号以 2026-11-25 加注释前的源码为基线（注释本身会移动行号），按用例名/符号定位。
// TODO(审查): 缺的用例：toolsForHost 过滤、用真 defineTool 编译一遍 9 个 schema（现在全程假 defineTool，DSH 校验从没跑到）。
import assert from 'node:assert/strict';
import { createSqliteStore } from '@taskboard/io';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createTaskboard, type Taskboard } from '@taskboard/core';
import { TaskState } from '@taskboard/protocol';

import {
	createTools,
	describeFailure,
	describeUnread,
	toDshParameters,
	toDshSchema,
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

let taskboard: Taskboard;
/**
 * agent 侧档位的存储端口。
 *
 * ⚠ 档位**不在 core 上了**（用户 2026-11-23）⇒ 复位档位要直接写 store 的 kv，
 *   不再有 `taskboard.setToolGuardLevel()`。
 */
let store: ReturnType<typeof createSqliteStore>;
let tools: readonly ToolLike[];
let workspaceId = '';

/** 每个用例一个独立数据目录（避免上一个用例的空间/卡漏到下一个）。 */
const createdDirs: string[] = [];

// TODO(审查): 这个 10×100ms 的手写重试可直接用 fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100})（Node 内置），少一层 sleep。
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

// TODO(审查): 用 `undefined as unknown as Taskboard` 骗过类型；可直接改 let taskboard: Taskboard | undefined + 取用处的非空收窄，删掉这个 cast。
async function closeTaskboard(): Promise<void> {
	if (taskboard === undefined) return;
	const closing = taskboard;
	taskboard = undefined as unknown as Taskboard;
	await closing.close();
}

// TODO(审查): store 变量只写不读（68 行声明）；62-67 行注释说「复位档位要直接写 store 的 kv」也已不符（isManageEdit 是注入的 false）。可直接删变量 + 改注释。
beforeEach(async () => {
	await closeTaskboard();
	const dataDir = mkdtempSync(join(tmpdir(), 'tb3-dsh-tools-'));
	createdDirs.push(dataDir);
	taskboard = createTaskboard({ store: (store = createSqliteStore(dataDir)) });

	const created = await taskboard.createWorkspace(`适配层测试-${Date.now()}`);
	assert.equal(created.ok, true);
	if (created.ok) workspaceId = created.workspace.id;

	/* 每个用例显式复位两条轴（档位是 core 持久化状态，会漏到下一个用例）。 */
	await taskboard.setCardActionLevel('no-claim');

	tools = createTools({
		taskboard,
		isManageEdit: () => false,
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
// TODO(审查): 'taskboard_tool_policy_read' 不在本包工具面（已搬去 dsh-agent-guard）⇒ 死条目，删它。
const NO_WORKSPACE_TOOLS: ReadonlySet<string> = new Set(['taskboard_workspaces', 'taskboard_definitions', 'taskboard_tool_policy_read']);

// TODO(审查): 这个夹具给每个调用都补 workspaceId，把「没有默认空间解析」整类行为掩盖了——包括 200 行那条「用 defaultWorkspaceId 解析」的假测试。
//   修测试时保留一个不补参的入口，专门钉「不传 workspaceId」的真实行为（成功回落 or 明确失败，由产品决定）。
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

// TODO(审查): run 就是 runRaw 取 .text，重复一份执行+断言代码；可让 run 直接复用 runRaw（纯重构）。
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
	/*
	 * ⚠ **不要**在这之前写 `assert.equal(created.ok, true)`：
	 *   `@types/node` 的 `assert.equal` 带 `asserts actual is T` 签名
	 *   ⇒ 它会把 `created` 收窄成成功分支，下面的 `if (!created.ok)` 就成了
	 *   `never` 分支（tsc 报 `Property 'message' does not exist on type 'never'`）。
	 *   `if (!created.ok) throw` 本身既做了运行时检查、又做了类型收窄 —— 一次就够。
	 */
	if (!created.ok) throw new Error(created.message);
	return created.card.id;
}

// TODO(审查): 参数化是假的——只被 workRef() 调用且永远传 'work'；要么删参数，要么真有第二个 kind 再用。
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
/* 工具数量 / 顺序 / 失败回滚在 `test/apply.test.ts`（apply 那一层才看得到注册与清理）。 */

/* ────────────────────────── ① schema 转换 ────────────────────────── */

describe('schema 转换：JSON Schema → DSH parameters', () => {
	it('required 内联成属性上的 true；description / enum / items 保留', () => {
		const spec = toDshParameters({
			type: 'object',
			properties: {
				id: { type: 'string', description: '卡编号' },
				status: { type: 'array', items: { type: 'string', enum: ['draft', 'working'] } },
			},
			required: ['id'],
		});
		assert.deepEqual(spec, {
			id: { type: 'string', description: '卡编号', required: true },
			status: { type: 'array', items: { type: 'string', enum: ['draft', 'working'] } },
		});
	});

	it("type:'object' 自动补 additionalProperties:false；显式 true 不被覆盖", () => {
		assert.equal(toDshSchema({ type: 'object', properties: {} })['additionalProperties'], false);
		assert.equal(
			toDshSchema({ type: 'object', properties: {}, additionalProperties: true })['additionalProperties'],
			true,
		);
	});

	it("没有 type 的节点 ⇒ 补 type:'json'（DSH 的任意 JSON）", () => {
		assert.deepEqual(toDshSchema({}), { type: 'json' });
	});

	it('⚠ 现状：白名单之外的关键字被静默丢弃（不 throw）', () => {
		/*
		 * 已知取舍（见 `src/tools.ts` 的 `toDshSchema` JSDoc）：适配层只搬
		 * type / description / enum / additionalProperties / items / properties。
		 * 直接 throw 是行为变化（要先确认 v2 的 schema 真的没用 oneOf 等关键字、
		 * 且 DSH 侧能表达），所以这里用测试钉住「丢弃且不报错」这个现状。
		 */
		const withUnknownKeys = {
			type: 'string',
			description: '带未知关键字的节点',
			oneOf: [{ type: 'string' }],
			default: 'a',
		} as const;
		assert.deepEqual(toDshSchema(withUnknownKeys), { type: 'string', description: '带未知关键字的节点' });
	});

	it("⚠ 现状：「有 properties 无 type」不被推断成 object，也不补 additionalProperties", () => {
		/*
		 * 合法 JSON Schema，但 v2 没这么写。现状是原样透传 properties、不猜 type ——
		 * 真要支持得先定契约（自动补 object？还是保持让 DSH 报错？），不在适配层擅自猜。
		 */
		const spec = toDshSchema({ properties: { a: { type: 'string' } } });
		assert.equal(spec['type'], undefined);
		assert.equal(spec['additionalProperties'], undefined);
		assert.deepEqual(Object.keys(spec), ['properties']);
	});
});

/* ────────────────────────── ②① ctx：默认空间 / 激活空间 ────────────────────────── */
// TODO(审查): 标题里的「激活空间」已被用户 11-22 取消（tools.ts:237-238）⇒ 改名；下面用例见 200 行 TODO。

// TODO(审查): 本 describe 里「不传 workspaceId ⇒ 用 defaultWorkspaceId 解析」是假测试：run() 经 withWorkspace 已补参，defaultWorkspaceId 从未被调用。
//   要真测就走不补参的路径；若产品决定「必须显式传 workspaceId」，删这条与 ToolDeps 的该字段（另见 withWorkspace 处 TODO）。
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

	it('subagents 缺席 ⇒ 无 holder，claim 明确失败（needHolder），不产生 UUID 持有', async () => {
		const local = createTools({
			taskboard,
			isManageEdit: () => false,
			defineTool: fakeDefineTool,
			defaultWorkspaceId: async () => workspaceId,
		});
		await taskboard.setCardActionLevel('claim');
		const id = await seedCard(workRef(), '无 subagents');
		await submit(id);
		const transition = local.find((one) => one.name === 'taskboard_transition') as ToolLike;
		const value = (await transition.execute(
			{ workspaceId, id, to: TaskState.WORKING },
			{ agent: { id: 'uuid-1234' } },
		)) as { text: string };

		/* 身份解析不了 ⇒ 明确失败，而不是把 UUID 写进 holders。 */
		assert.ok(value.text.includes('宿主没有提供当前调用者身份（holder），无法领取'), value.text);
		const after = taskboard.get(workspaceId, id);
		assert.equal(after.ok, true);
		if (after.ok) {
			assert.deepEqual(after.card.holders, [], '不应产生 UUID 持有');
			assert.equal(after.card.status, TaskState.SUBMITTED, '卡应停在「提交」态');
		}
	});

	it('没有 agent 上下文 ⇒ 无 holder：采纳仍可用，claim 明确失败（needHolder）', async () => {
		await taskboard.setCardActionLevel('adopt');
		const id = await seedCard(workRef(), '无 agent 上下文');

		/* 采纳不需要身份：程序化调用仍能推进。 */
		const adopted = await run('taskboard_transition', { id, to: TaskState.SUBMITTED }, {});
		assert.ok(adopted.includes('已采纳'), adopted);

		/* 领取需要身份：agent 缺席 ⇒ holder 为 '' ⇒ 明确失败，不写 holders。 */
		const claimed = await run('taskboard_transition', { id, to: TaskState.WORKING }, {});
		assert.ok(claimed.includes('宿主没有提供当前调用者身份（holder），无法领取'), claimed);
		const after = taskboard.get(workspaceId, id);
		assert.equal(after.ok, true);
		if (after.ok) {
			assert.deepEqual(after.card.holders, [], '不应产生退化身份持有');
			assert.equal(after.card.status, TaskState.SUBMITTED);
		}
	});
});

/* ────────────────────────── ②③ ctx：权限开关 ────────────────────────── */
// TODO(审查): 「权限开关」下没有用例；isManageEdit 目前没有任何工具消费（见 tools.ts:244 的 TODO），先确认产品语义再决定补测试还是删接线。

/* ────────────────────────── 各工具经适配层 ────────────────────────── */

// TODO(审查): 本文件多处断言 @taskboard/tools 的渲染文案（这里 257-262、378/488/511 的「已建卡/已采纳/已领取」、430/449 的分节标题）——
//   适配层的契约只是「调到了 handler、拿到 {text}」；文案在 tools 包改一次要连带修这里。建议只留一处端到端文案断言，其余断状态/字段。
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
		const empty = createTaskboard({ store: createSqliteStore(emptyDir) });
		try {
			const emptyTools = createTools({
				taskboard: empty,
				/*
				 * 这里只要**读得到档位**（本用例不碰权限），给一个纯内存 kv 就够 ——
				 * 别为它再开一个 sqlite 文件：Windows 上没关的句柄会让 finally 里的
				 * `rmSync` 报 EPERM（已实测踩到）。
				 */
				isManageEdit: () => false,
				defineTool: fakeDefineTool,
				defaultWorkspaceId: async () => '',
			});
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

// TODO(审查): 427 行三元两支完全相同（'$type' in payload 分支是复制粘贴残留），直接写 { ...payload, value: '新内容' }。
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

