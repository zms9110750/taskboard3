/**
 * 业务行为测试 —— 16 个工具对着**真 core（内存存储）**跑。
 *
 * ## 为什么可以直接测源码
 *
 * `src/` 只 import `@taskboard/core` / `@taskboard/protocol`，不 import 任何
 * 宿主模块 ⇒ 不需要起 DSH / MCP，也不需要假的 `defineTool`：
 * 直接 `createTaskboardTools(taskboard)` + `registry.invoke(...)`。
 *
 * ⚠ 跨包 import 走包名（`@taskboard/core` → `lib/`）是 ESM 的必然
 *   （AGENTS 规则 6 明确接受）：跑本测试前先 `tsc -b packages/tools`
 *   把 protocol / core 构建出来；本包自己的 `lib/` **不需要**。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createTaskboard, type Taskboard } from '@taskboard/core';
import type { TaskboardToolContext, TaskboardToolResult } from '../src/index.ts';
import { createTaskboardToolRegistry, createTaskboardTools } from '../src/index.ts';
import type { TaskboardToolRegistry } from '../src/index.ts';
import { createMemoryStore } from './support/memory-store.ts';

/* ────────────────────────────── 夹具 ────────────────────────────── */

/** 模板是 core 的资产：从它的 package.json 反推目录（不依赖 cwd）。 */
const TEMPLATE_DIR = join(
	createRequire(import.meta.url).resolve('@taskboard/core/package.json'),
	'..',
	'templates',
);

let taskboard: Taskboard;
let registry: TaskboardToolRegistry;
let workspaceId = '';

/** 建一套**全新的**任务板 + 工具集（内存存储，互不影响）。 */
function fresh(): void {
	taskboard = createTaskboard({ store: createMemoryStore() });
	taskboard.templates().loadDirectory(TEMPLATE_DIR);
	registry = createTaskboardToolRegistry(createTaskboardTools(taskboard));
}

beforeEach(async () => {
	fresh();
	const created = await taskboard.createWorkspace('工具测试');
	assert.equal(created.ok, true);
	if (created.ok) workspaceId = created.workspace.id;

	/*
	 * 档位是 core 的持久化状态；内存库每个用例重新造，所以显式复位只是
	 * 让默认值**写在测试里**（默认见 core：no-claim + off）。
	 */
	await taskboard.setCardActionLevel('no-claim');
	await taskboard.setToolGuardLevel('off');
});

afterEach(async () => {
	await taskboard.close();
});

/** 跑一个工具，取回完整结果。 */
async function run(
	name: string,
	args: unknown = {},
	ctx: TaskboardToolContext = {},
): Promise<TaskboardToolResult> {
	return registry.invoke(name, args, ctx);
}

/** 跑一个工具，只取文本。 */
async function text(name: string, args: unknown = {}, ctx: TaskboardToolContext = {}): Promise<string> {
	return (await run(name, args, ctx)).text;
}

/** 建一张**用户**建的卡（直接调 core，默认 actor = user），返回编号。 */
async function makeCard(title: string, templateRef?: string): Promise<string> {
	const ref = templateRef ?? taskboard.listTemplates()[0]?.ref ?? '';
	const created = await taskboard.create({ workspaceId, templateRef: ref, title, actor: 'user' });
	assert.equal(created.ok, true, created.ok ? '' : created.message);
	return created.ok ? created.card.id : '';
}

/** 用 **AI 工具**建卡，返回编号（会让卡进 `updates.ai`）。 */
async function makeCardByAi(title: string): Promise<string> {
	const ref = taskboard.listTemplates()[0]?.ref ?? '';
	const result = await run('taskboard_create', { title, templateRef: ref });
	assert.ok(result.text.includes('已建卡'), result.text);
	const found = taskboard.list(workspaceId).find((one) => one.title === title);
	assert.notEqual(found, undefined, `AI 建卡后找不到「${title}」`);
	return found?.id ?? '';
}

/** 取当前空间的未读集合。 */
async function updates(): Promise<{ readonly ai: readonly string[]; readonly user: readonly string[] }> {
	return taskboard.updates(workspaceId);
}

/** 落库后的持有者名字列表（`Card.holders` 是 `CardHolder[]`，不是字符串数组）。 */
function holderNames(cardId: string): readonly string[] {
	const found = taskboard.get(workspaceId, cardId);
	assert.equal(found.ok, true);
	return found.ok ? found.card.holders.map((one) => one.holder) : [];
}

/* ────────────────────────────── 空间 ────────────────────────────── */

describe('taskboard_workspaces', () => {
	it('列出空间并带卡数', async () => {
		const output = await text('taskboard_workspaces', {});
		assert.ok(output.includes('工作空间'), output);
		assert.ok(output.includes(workspaceId), output);
	});

	it('空任务板时给出下一步（不报错）', async () => {
		await taskboard.close();
		fresh();
		const result = await run('taskboard_workspaces', {});
		assert.ok(result.text.includes('还没有任何工作空间'), result.text);
		assert.notEqual(result.isError, true, '空任务板不是错误');
	});
});

/* ────────────────────────────── 建卡 ────────────────────────────── */

describe('taskboard_create', () => {
	it('省略 templateRef 时用第一个可用模板', async () => {
		const first = taskboard.listTemplates()[0];
		assert.notEqual(first, undefined);
		const output = await text('taskboard_create', { title: '自动选模板' });
		assert.ok(output.startsWith('已建卡 '), output);
		if (first !== undefined) assert.ok(output.includes(first.ref), output);
	});

	it('指定 templateRef 建卡成功，列出章节', async () => {
		const first = taskboard.listTemplates()[0];
		if (first === undefined) return;
		const output = await text('taskboard_create', { title: '指定模板', templateRef: first.ref });
		assert.ok(output.includes('已建卡'), output);
		assert.ok(output.includes('章节'), output);
	});

	it('未知 templateRef ⇒ 友好错误 + 下一步', async () => {
		const result = await run('taskboard_create', { title: 'x', templateRef: '不存在的模板' });
		assert.ok(result.text.startsWith('建卡失败'), result.text);
		assert.ok(result.text.includes('下一步'), `应带修复指引：${result.text}`);
		assert.equal(result.isError, true, '领域失败必须标 isError（MCP 据此显示错误）');
	});

	it('错章节名 ⇒ 错误里列出可用章节', async () => {
		const first = taskboard.listTemplates()[0];
		if (first === undefined) return;
		const output = await text('taskboard_create', {
			title: 'x',
			templateRef: first.ref,
			content: { 瞎写的章节: { $type: 'text', value: 'y' } },
		});
		assert.ok(output.startsWith('建卡失败'), output);
		assert.ok(output.includes('瞎写的章节') || output.includes('章节'), output);
	});

	it('缺 title ⇒ 报错而不是建成空标题卡', async () => {
		const before = taskboard.list(workspaceId).length;
		const output = await text('taskboard_create', { title: '' });
		assert.ok(output.startsWith('建卡失败'), output);
		assert.equal(taskboard.list(workspaceId).length, before, '不该建出卡');
	});
});

/* ────────────────────────────── 列表 / 搜索 ────────────────────────────── */

describe('taskboard_cards', () => {
	it('不带 status ⇒ 不含草稿', async () => {
		await makeCard('草稿卡');
		const output = await text('taskboard_cards', {});
		assert.ok(!output.includes('草稿卡'), `默认不该列出草稿：${output}`);
	});

	it('status=draft ⇒ 能看到草稿', async () => {
		await makeCard('要看见我');
		const output = await text('taskboard_cards', { status: ['draft'] });
		assert.ok(output.includes('要看见我'), output);
	});

	it('标题筛选命中与不命中', async () => {
		await makeCard('登录页面改版');
		const hit = await text('taskboard_cards', { title: '登录', status: ['draft'] });
		assert.ok(hit.includes('登录页面改版'), hit);
		const miss = await text('taskboard_cards', { title: '不存在的字', status: ['draft'] });
		assert.ok(miss.includes('没有符合条件'), miss);
	});

	it('⚠ userChanged / userUnread 按**作者**区分（不是按读者）', async () => {
		/*
		 * 两个 boolean 的名字最容易搞反：
		 *   userChanged ⇒ updates.user（**用户**改的）
		 *   userUnread  ⇒ updates.ai  （**用户**未读的 = AI 改的）
		 */
		await makeCardByAi('AI 改的卡');
		await makeCard('用户建的卡');

		const byUnread = await text('taskboard_cards', { userUnread: true, status: ['draft'] });
		assert.ok(byUnread.includes('AI 改的卡'), `userUnread 应命中 AI 改的卡：${byUnread}`);
		assert.ok(!byUnread.includes('用户建的卡'), `userUnread 不该命中用户建的卡：${byUnread}`);

		const byChanged = await text('taskboard_cards', { userChanged: true, status: ['draft'] });
		assert.ok(byChanged.includes('用户建的卡'), `userChanged 应命中用户建的卡：${byChanged}`);
		assert.ok(!byChanged.includes('AI 改的卡'), `userChanged 不该命中 AI 改的卡：${byChanged}`);
	});
});

/* ────────────────────────────── actor 标记 ──────────────────────────────
 *
 * 只测「AI 写完 ⇒ 进 updates.ai」不够 —— 如果两边都标成 `'ai'`，这条也会过。
 * 所以要**配对**：进 updates.ai 的同时**不进** updates.user。
 */

describe('actor 标记：AI 工具写 ⇒ updates.ai', () => {
	it('AI 工具建卡 ⇒ 进 updates.ai，不进 updates.user', async () => {
		const id = await makeCardByAi('AI 建的卡');
		const result = await updates();
		assert.ok(result.ai.includes(id), `应进 updates.ai：${JSON.stringify(result)}`);
		assert.ok(!result.user.includes(id), `不该进 updates.user：${JSON.stringify(result)}`);
	});

	it('AI 工具改备注 ⇒ 进 updates.ai', async () => {
		const id = await makeCardByAi('AI 改备注');
		/* 要清 updates.ai，必须由**用户**标记已读。 */
		await taskboard.markSeen(workspaceId, id, 'user');

		const output = await text('taskboard_update_note', { id, note: 'AI 写的备注' });
		assert.ok(output.includes('已更新'), output);

		const after = await updates();
		assert.ok(after.ai.includes(id), `应进 ai：${JSON.stringify(after)}`);
		assert.ok(!after.user.includes(id), `不该进 user：${JSON.stringify(after)}`);
	});

	it('AI 工具改章节内容 ⇒ 进 updates.ai', async () => {
		const ref = taskboard.listTemplates()[0]?.ref ?? '';
		const section = taskboard.templateMeta(ref)?.sections[0];
		assert.notEqual(section, undefined);
		if (section === undefined) return;

		const id = await makeCardByAi('AI 改内容');
		await taskboard.markSeen(workspaceId, id, 'user');

		const output = await text('taskboard_update_content', {
			id,
			content: { [section.label]: { $type: section.action, value: '改过' } },
		});
		assert.ok(output.includes('已改'), output);

		const after = await updates();
		assert.ok(after.ai.includes(id), `应进 ai：${JSON.stringify(after)}`);
		assert.ok(!after.user.includes(id), `不该进 user：${JSON.stringify(after)}`);
	});

	it('taskboard_mark_seen 清的是 updates.user（不是 updates.ai）', async () => {
		/*
		 * ⚠ 最容易搞反的一条：`reader: 'ai'` 清的是 `unread.user`
		 *   （「用户改过、AI 待读」）。
		 */
		const id = await makeCard('用户建的卡');
		const before = await updates();
		assert.ok(before.user.includes(id), `用户建卡后应在 user：${JSON.stringify(before)}`);
		assert.ok(!before.ai.includes(id), `不该在 ai：${JSON.stringify(before)}`);

		const output = await text('taskboard_mark_seen', { id });
		assert.ok(output.includes('已把'), output);

		const after = await updates();
		assert.ok(!after.user.includes(id), `mark_seen 后应移出 user：${JSON.stringify(after)}`);
	});
});

/* ────────────────────────────── 单卡 / 改内容 / 备注 ────────────────────────────── */

describe('taskboard_card', () => {
	it('返回元数据、章节、历史', async () => {
		const id = await makeCard('详情测试');
		const output = await text('taskboard_card', { id });
		assert.ok(output.includes(id), output);
		assert.ok(output.includes('详情测试'), output);
		assert.ok(output.includes('状态：'), output);
		assert.ok(output.includes('模板：'), output);
	});

	it('不存在的编号 ⇒ 失败文案', async () => {
		const output = await text('taskboard_card', { id: 'NOPE-99' });
		assert.ok(output.includes('不存在'), output);
	});
});

describe('taskboard_update_note', () => {
	it('写备注 / 空串清空', async () => {
		const id = await makeCard('备注测试');
		await text('taskboard_update_note', { id, note: '这是备注' });
		const afterWrite = taskboard.get(workspaceId, id);
		assert.equal(afterWrite.ok, true);
		if (afterWrite.ok) assert.equal(afterWrite.card.note, '这是备注');

		const output = await text('taskboard_update_note', { id, note: '' });
		assert.ok(output.includes('已清空'), output);
		const afterClear = taskboard.get(workspaceId, id);
		if (afterClear.ok) assert.equal(afterClear.card.note, '');
	});

	it('不存在的编号 ⇒ 失败文案', async () => {
		const result = await run('taskboard_update_note', { id: 'NOPE-99', note: 'x' });
		assert.ok(result.text.includes('失败'), result.text);
		assert.equal(result.isError, true);
	});
});

describe('taskboard_update_content', () => {
	it('只改指定章节，其它章节保留（core.update 是整体替换，工具负责合并）', async () => {
		const ref = taskboard.listTemplates()[0]?.ref ?? '';
		const sections = taskboard.templateMeta(ref)?.sections ?? [];
		assert.ok(sections.length >= 2, '需要至少两个章节的模板来验证「只改一章」');

		const id = await makeCard('改内容');
		const first = sections[0];
		const second = sections[1];
		if (first === undefined || second === undefined) return;

		const output = await text('taskboard_update_content', {
			id,
			content: { [first.label]: { $type: first.action, value: '第一章的内容' } },
		});
		assert.ok(output.includes('已改'), output);

		const after = taskboard.get(workspaceId, id);
		assert.equal(after.ok, true);
		if (!after.ok) return;

		const changed = Object.values(after.card.sections).find((one) => one.label === first.label);
		assert.notEqual(changed, undefined);
		if (changed !== undefined) {
			assert.ok(JSON.stringify(changed.payload).includes('第一章的内容'), JSON.stringify(changed.payload));
		}
		const untouched = Object.values(after.card.sections).find((one) => one.label === second.label);
		assert.notEqual(untouched, undefined, '没传的章节不该被删掉');
	});

	it('content 不是对象 ⇒ 失败文案', async () => {
		const id = await makeCard('坏 content');
		const result = await run('taskboard_update_content', { id, content: '不是对象' });
		assert.ok(result.text.includes('必须是对象'), result.text);
		assert.equal(result.isError, true);
	});

	it('未知章节名 ⇒ core 的校验错误', async () => {
		const id = await makeCard('错章节');
		const output = await text('taskboard_update_content', {
			id,
			content: { 瞎写的章节名: { $type: 'text', value: 'x' } },
		});
		assert.ok(output.includes('失败'), output);
	});
});

/* ────────────────────────────── 注册表工具 ────────────────────────────── */

describe('taskboard_registry', () => {
	it('不带 id ⇒ 列模板与 action', async () => {
		const output = await text('taskboard_registry', {});
		assert.ok(output.includes('模板'), output);
		assert.ok(output.includes('action'), output);
	});

	it('给模板 ref ⇒ 列出章节名与每章的 action', async () => {
		const first = taskboard.listTemplates()[0];
		if (first === undefined) return;
		const output = await text('taskboard_registry', { id: first.ref });
		assert.ok(output.includes(first.ref), output);
		assert.ok(output.includes('章节'), output);
		assert.ok(output.includes('action='), output);
	});

	it('给 action 的 $type ⇒ 返回摘要', async () => {
		const action = taskboard.actions().list()[0];
		if (action === undefined) return;
		const output = await text('taskboard_registry', { id: action.$type, kind: 'action' });
		assert.ok(output.includes(action.$type), output);
	});

	it('不存在的 id ⇒ 提示先看清单', async () => {
		const output = await text('taskboard_registry', { id: '不存在的东西' });
		assert.ok(output.includes('没有名为'), output);
	});
});

/* ────────────────────────────── 状态转移 ────────────────────────────── */

describe('taskboard_transition', () => {
	it('to 为空 ⇒ 返回当前状态与可转目标，不执行', async () => {
		const id = await makeCard('查询转移');
		const before = taskboard.get(workspaceId, id);
		assert.equal(before.ok, true);

		const output = await text('taskboard_transition', { id });
		assert.ok(output.includes('当前状态'), output);
		assert.ok(output.includes('可以转去'), output);

		const after = taskboard.get(workspaceId, id);
		if (before.ok && after.ok) assert.equal(after.card.status, before.card.status);
	});

	it('非法状态名 ⇒ 列出可用状态', async () => {
		const id = await makeCard('坏状态');
		const result = await run('taskboard_transition', { id, to: '不存在的状态' });
		assert.ok(result.text.includes('不是已知状态'), result.text);
		assert.ok(result.text.includes('可用'), result.text);
		assert.equal(result.isError, true);
	});

	it('认中文状态名（草稿 →「提交」是采纳目标 ⇒ 指路 taskboard_adopt）', async () => {
		const template = taskboard.listTemplates().find((one) => one.kind === 'goal' || one.kind === 'work');
		assert.notEqual(template, undefined);
		if (template === undefined) return;
		const created = await taskboard.create({ workspaceId, templateRef: template.ref, title: '中文状态' });
		assert.equal(created.ok, true);
		if (!created.ok) return;

		const output = await text('taskboard_transition', { id: created.card.id, to: '提交' });
		assert.ok(!output.includes('不是已知状态'), `中文名应能认：${output}`);
		assert.ok(output.includes('taskboard_adopt'), `采纳不该由 transition 执行：${output}`);
	});

	it('⚠ 采纳不让路给普通转移：不改状态、不写 adoptedAt', async () => {
		const template = taskboard.listTemplates().find((one) => one.kind === 'work');
		assert.notEqual(template, undefined);
		if (template === undefined) return;
		const created = await taskboard.create({ workspaceId, templateRef: template.ref, title: '工作草稿' });
		assert.equal(created.ok, true);
		if (!created.ok) return;

		const result = await run('taskboard_transition', { id: created.card.id, to: 'TASK_STATE_SUBMITTED' });
		assert.ok(result.text.includes('采纳'), result.text);
		assert.ok(result.text.includes('taskboard_adopt'), `应指路独立工具：${result.text}`);

		const after = taskboard.get(workspaceId, created.card.id);
		if (after.ok) {
			assert.equal(after.card.status, 'TASK_STATE_UNSPECIFIED', '不能静默按普通转移处理');
			assert.equal(after.card.adoptedAt, null);
		}
	});

	it('不存在的编号 ⇒ 失败文案', async () => {
		const output = await text('taskboard_transition', { id: 'NOPE-99' });
		assert.ok(output.includes('不存在'), output);
	});
});

/* ────────────────────────────── 采纳 ────────────────────────────── */

describe('taskboard_adopt', () => {
	/** 建一张指定类别的草稿卡，返回编号。 */
	async function draftOf(kind: 'work' | 'goal' | 'design' | 'record', title: string): Promise<string> {
		const template = taskboard.listTemplates().find((one) => one.kind === kind);
		assert.notEqual(template, undefined, `应当存在 ${kind} 类别的模板`);
		if (template === undefined) return '';
		const created = await taskboard.create({ workspaceId, templateRef: template.ref, title, actor: 'user' });
		assert.equal(created.ok, true, created.ok ? '' : created.message);
		return created.ok ? created.card.id : '';
	}

	it('cardLevel=adopt ⇒ 能采纳；写 adoptedAt + history 的 adopt(actor=ai)', async () => {
		const id = await draftOf('work', '工作草稿');
		if (id === '') return;
		await taskboard.setCardActionLevel('adopt');

		const output = await text('taskboard_adopt', { id });
		assert.ok(output.includes('已把') && output.includes('采纳'), output);

		const after = taskboard.get(workspaceId, id);
		assert.equal(after.ok, true);
		if (!after.ok) return;
		assert.equal(after.card.status, 'TASK_STATE_SUBMITTED', 'work 的采纳目标 ⇒ 提交');
		assert.notEqual(after.card.adoptedAt, null, '采纳必须写 adoptedAt（search 的排序键）');
		const adoptEntry = after.card.history.find((one) => one.action === 'adopt');
		assert.notEqual(adoptEntry, undefined, 'history 里应有 adopt 事件');
		assert.equal(adoptEntry?.at, after.card.adoptedAt, 'adoptedAt 与 history 的 adopt 同一时刻');
		assert.equal(adoptEntry?.actor, 'ai', 'AI 工具的采纳 ⇒ actor 是 ai');
	});

	it('design 的采纳目标是「需要授权」（不是提交）', async () => {
		const id = await draftOf('design', '设计草稿');
		if (id === '') return;
		await taskboard.setCardActionLevel('adopt');
		await text('taskboard_adopt', { id });

		const after = taskboard.get(workspaceId, id);
		if (after.ok) assert.equal(after.card.status, 'TASK_STATE_AUTH_REQUIRED');
	});

	it('⚠ cardLevel=claim ⇒ 拒绝并指路「允许采纳草稿」，状态不变', async () => {
		const id = await draftOf('work', '不许采纳');
		if (id === '') return;
		await taskboard.setCardActionLevel('claim');

		const result = await run('taskboard_adopt', { id });
		assert.ok(result.text.includes('失败'), result.text);
		assert.ok(result.text.includes('允许采纳草稿'), `应说清是档位问题：${result.text}`);
		assert.equal(result.isError, true);

		const after = taskboard.get(workspaceId, id);
		if (after.ok) {
			assert.equal(after.card.status, 'TASK_STATE_UNSPECIFIED', '被拒就不该改状态');
			assert.equal(after.card.adoptedAt, null);
		}
	});

	it('非草稿 ⇒ 明确说「只有草稿能采纳」', async () => {
		const id = await draftOf('work', '已经提交了');
		if (id === '') return;
		const moved = await taskboard.transition(workspaceId, id, 'TASK_STATE_SUBMITTED', 'button');
		assert.equal(moved.ok, true, moved.ok ? '' : moved.message);
		await taskboard.setCardActionLevel('adopt');

		const output = await text('taskboard_adopt', { id });
		assert.ok(output.includes('只有草稿'), output);
	});

	it('不存在的编号 ⇒ 失败文案', async () => {
		await taskboard.setCardActionLevel('adopt');
		const output = await text('taskboard_adopt', { id: 'NOPE-99' });
		assert.ok(output.includes('不存在'), output);
	});
});

/* ────────────────────────────── 领取 / 释放 ────────────────────────────── */

describe('taskboard_claim / taskboard_release', () => {
	/** 造一张能领的工作卡（提交态）：先建草稿再走按钮路径到提交。 */
	async function claimableCard(title: string): Promise<string> {
		const template = taskboard.listTemplates().find((one) => one.kind === 'work');
		assert.notEqual(template, undefined, '应当存在 work 类别的模板');
		const ref = template?.ref ?? '';
		const created = await taskboard.create({ workspaceId, templateRef: ref, title });
		assert.equal(created.ok, true);
		if (!created.ok) return '';
		const adopted = await taskboard.transition(workspaceId, created.card.id, 'TASK_STATE_SUBMITTED', 'button');
		assert.equal(adopted.ok, true, adopted.ok ? '' : adopted.message);
		return created.card.id;
	}

	it('claim 用 ctx.holder 当持有者（宿主算好名字再传）', async () => {
		const id = await claimableCard('领取测试');
		if (id === '') return;

		const output = await text('taskboard_claim', { id }, { holder: '测试agent' });
		assert.ok(output.includes('已领取'), output);
		assert.ok(output.includes('测试agent'), `holder 应是上下文给的名字：${output}`);
		assert.deepEqual(holderNames(id), ['测试agent']);

		const after = taskboard.get(workspaceId, id);
		if (after.ok) assert.equal(after.card.status, 'TASK_STATE_WORKING');
	});

	it('claim 时 ctx 省略 holder ⇒ 回落 unknown（功能照样可用）', async () => {
		const id = await claimableCard('领取回落');
		if (id === '') return;

		const output = await text('taskboard_claim', { id });
		assert.ok(output.includes('已领取'), output);
		assert.deepEqual(holderNames(id), ['unknown']);
	});

	it('claim 草稿卡 ⇒ 失败文案（草稿不能领）', async () => {
		const ref = taskboard.listTemplates().find((one) => one.kind === 'work')?.ref ?? '';
		const created = await taskboard.create({ workspaceId, templateRef: ref, title: '还是草稿' });
		assert.equal(created.ok, true);
		if (!created.ok) return;

		const result = await run('taskboard_claim', { id: created.card.id }, { holder: 'lead' });
		assert.ok(result.text.includes('失败'), result.text);
		assert.equal(result.isError, true);
	});

	it('claim 非工作类别的卡 ⇒ 失败文案（目标 / 设计 / 记录不可领）', async () => {
		const template = taskboard.listTemplates().find((one) => one.kind === 'goal');
		assert.notEqual(template, undefined);
		if (template === undefined) return;

		const created = await taskboard.create({ workspaceId, templateRef: template.ref, title: '目标卡' });
		assert.equal(created.ok, true);
		if (!created.ok) return;
		await taskboard.transition(workspaceId, created.card.id, 'TASK_STATE_SUBMITTED', 'button');

		const result = await run('taskboard_claim', { id: created.card.id }, { holder: 'lead' });
		assert.ok(result.text.includes('失败'), result.text);
	});

	it('release 释放自己 ⇒ 回到提交', async () => {
		const id = await claimableCard('释放测试');
		if (id === '') return;
		await text('taskboard_claim', { id }, { holder: 'lead' });

		const output = await text('taskboard_release', { id }, { holder: 'lead' });
		assert.ok(output.includes('已释放'), output);

		assert.deepEqual(holderNames(id), []);
		const after = taskboard.get(workspaceId, id);
		if (after.ok) assert.equal(after.card.status, 'TASK_STATE_SUBMITTED');
	});

	it('release 自己不在持有者里 ⇒ 失败文案（列出当前持有者）', async () => {
		const id = await claimableCard('别人持有');
		if (id === '') return;
		await text('taskboard_claim', { id }, { holder: 'uuid-owner' });
		assert.deepEqual(holderNames(id), ['uuid-owner']);

		const result = await run('taskboard_release', { id }, { holder: 'uuid-stranger' });
		assert.ok(result.text.includes('失败'), result.text);
		assert.ok(result.text.includes('uuid-owner'), `失败文案要列出真正的持有者：${result.text}`);
	});
});

/* ────────────────────────────── 四档权限工具 ────────────────────────────── */

describe('四档权限工具', () => {
	function policies(): ReturnType<Taskboard['getToolPolicies']> {
		return taskboard.getToolPolicies();
	}

	it('读工具打印四档，且明确标「BASE 改不了」', async () => {
		await text('taskboard_tool_policy_set', { granularity: 'common', delta: ['bash'] });
		const output = await text('taskboard_tool_policies', {});

		assert.ok(output.includes('BASE'), output);
		assert.ok(output.includes('改不了') || output.includes('不要试图'), `要告诉 AI BASE 不可改：${output}`);
		assert.ok(output.includes('通用档'), output);
		assert.ok(output.includes('组'), output);
		assert.ok(output.includes('独立档'), output);
		assert.ok(output.includes('bash'), output);
	});

	it('granularity=common / group / template ⇒ 分别写对应档', async () => {
		await text('taskboard_tool_policy_set', { granularity: 'common', delta: ['bash', 'write'] });
		assert.deepEqual([...policies().common].sort(), ['bash', 'write']);

		await text('taskboard_tool_policy_set', { granularity: 'group', name: '代码类', delta: ['bash'] });
		assert.deepEqual([...(policies().groups['代码类'] ?? [])], ['bash']);

		const template = taskboard.listTemplates()[0];
		if (template === undefined) return;
		await text('taskboard_tool_policy_set', {
			granularity: 'template',
			name: template.ref,
			delta: ['read_file'],
		});
		assert.deepEqual([...(policies().templates[template.ref] ?? [])], ['read_file']);
	});

	it('granularity 非法 ⇒ 明确报错，不静默成功', async () => {
		await text('taskboard_tool_policy_reset', { granularity: 'common' });
		const before = [...policies().common];

		const result = await run('taskboard_tool_policy_set', { granularity: 'nope', delta: ['bash'] });
		assert.ok(result.text.includes('必须是'), result.text);
		assert.equal(result.isError, true);
		assert.deepEqual([...policies().common], before, '非法粒度不该写任何档');
	});

	it('group / template 缺 name ⇒ 报错', async () => {
		const group = await run('taskboard_tool_policy_set', { granularity: 'group', delta: ['bash'] });
		assert.ok(group.text.includes('必须给 name'), group.text);
		const template = await run('taskboard_tool_policy_set', { granularity: 'template', delta: ['bash'] });
		assert.ok(template.text.includes('必须给 name'), template.text);
	});

	it('未知模板的独立档 ⇒ core 拒绝（TEMPLATE_NOT_FOUND）', async () => {
		const output = await text('taskboard_tool_policy_set', {
			granularity: 'template',
			name: '不存在的模板',
			delta: ['bash'],
		});
		assert.ok(output.includes('失败'), output);
		assert.equal(policies().templates['不存在的模板'], undefined, '不该写进库');
	});

	it('taskboard_tool_policy_members ⇒ 设组成员', async () => {
		const output = await text('taskboard_tool_policy_members', {
			groupName: '代码类',
			templates: ['writeCode', 'writeTests'],
		});
		assert.ok(output.includes('代码类'), output);
		assert.deepEqual([...(policies().groupMembers['代码类'] ?? [])], ['writeCode', 'writeTests']);
	});

	it('组只设策略不设成员 ⇒ 谁都不命中（合法状态）', async () => {
		await text('taskboard_tool_policy_set', { granularity: 'group', name: '空组', delta: ['bash'] });
		assert.deepEqual([...(policies().groupMembers['空组'] ?? [])], []);
	});

	it('reset common / group / template 各自的语义', async () => {
		/* common ⇒ 清空。 */
		await text('taskboard_tool_policy_set', { granularity: 'common', delta: ['bash'] });
		const common = await text('taskboard_tool_policy_reset', { granularity: 'common' });
		assert.ok(common.includes('已清空'), common);
		assert.deepEqual([...policies().common], []);

		/* group ⇒ 整组删除（成员 + 增量）。 */
		await text('taskboard_tool_policy_set', { granularity: 'group', name: '要删的组', delta: ['bash'] });
		await text('taskboard_tool_policy_members', { groupName: '要删的组', templates: ['writeCode'] });
		const group = await text('taskboard_tool_policy_reset', { granularity: 'group', name: '要删的组' });
		assert.ok(group.includes('已删除'), group);
		assert.equal(policies().groups['要删的组'], undefined);
		assert.equal(policies().groupMembers['要删的组'], undefined);

		/* template ⇒ 只清那个模板的独立档（core 的语义是设成空增量）。 */
		const template = taskboard.listTemplates()[0];
		if (template === undefined) return;
		await text('taskboard_tool_policy_set', {
			granularity: 'template',
			name: template.ref,
			delta: ['bash'],
		});
		const one = await text('taskboard_tool_policy_reset', { granularity: 'template', name: template.ref });
		assert.ok(one.includes('已清空'), one);
		assert.deepEqual([...(policies().templates[template.ref] ?? [])], []);
	});

	it('reset 幂等：删不存在的组不算错', async () => {
		const output = await text('taskboard_tool_policy_reset', { granularity: 'group', name: '从来没建过' });
		assert.ok(output.includes('已删除'), output);
	});
});
