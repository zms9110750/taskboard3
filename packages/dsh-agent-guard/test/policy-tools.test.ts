/**
 * 两个「权限策略」工具的测试 —— **从 `@taskboard/tools` 搬过来重建**。
 *
 * ## 为什么这个文件在这里（用户 `2026-11-23`）
 *
 * > 「这个tool，不在core里提供。完全由dsh桥接包提供。并且这个ui也完全由dsh ui提供。
 * >   mcp不提供这个tool和ui。」
 *
 * 两个工具的定义从 `@taskboard/tools` 搬到 `@taskboard/dsh-agent-guard`，
 * 它们的测试也跟着搬。**不是「只断言注册了名字」** —— 每条都真跑 `execute()`
 * 并检查三档 scope 的并集 / 交集结果。
 *
 * ## 覆盖的七件事
 *
 * 1. 两个工具确实建出来（名字与顺序）
 * 2. `off` 档 ⇒ 写工具拒绝（「权限开关未启用」），读工具仍可用
 * 3. `manage-edit` 档 ⇒ 写工具可执行，且读工具能读回
 * 4. `unclaimed` 档：`allow` 并集（BASE 之外追加）
 * 5. `claimed` 档：`allow` 并集
 * 6. `template` 档：以模板为键的并集
 * 7. `remove` 交集：只减 extras，**BASE 工具不可移除**
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, before, after } from 'node:test';

import { BASE_TOOLS, createTaskboard, type Taskboard } from '@taskboard/core';
import { createSqliteStore } from '@taskboard/io';

import { createAgentGuardTools } from '../src/tools.ts';
import { writeToolGuardLevel, type ToolGuardKv } from '../src/tool-guard.ts';

/** 内存 kv（三档位的存储端口）。 */
function memoryKv(): ToolGuardKv {
	const map = new Map<string, string>();
	return {
		kvGet: (key: string) => map.get(key),
		kvSet: async (key: string, value: string | undefined) => {
			if (value === undefined) map.delete(key);
			else map.set(key, value);
		},
	};
}

/** 捕获 `defineTool` 的产物，好直接调 `execute`。 */
interface CallableTool {
	readonly name: string;
	execute(args: unknown, exec: unknown): Promise<{ text: string }>;
}

function toolsOf(taskboard: Taskboard, kv: ToolGuardKv): readonly CallableTool[] {
	const built: CallableTool[] = [];
	const defineTool = (options: {
		readonly name: string;
		execute(args: never, exec: never): Promise<unknown>;
	}) => {
		const tool: CallableTool = {
			name: options.name,
			execute: async (args: unknown, exec: unknown) => (await options.execute(args as never, exec as never)) as { text: string },
		};
		built.push(tool);
		return tool;
	};
	/* `defineTool` 的形状由 `adaptDefinitions` 收窄，这里只造它真正用到的字段。 */
	createAgentGuardTools({ taskboard, kv, defineTool: defineTool as never });
	return built;
}

describe('两个权限策略工具（已搬进 dsh-agent-guard）', () => {
	let dir = '';
	let taskboard: Taskboard;
	let kv: ToolGuardKv;
	let workspaceId = '';

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-agent-guard-'));
		taskboard = createTaskboard({ store: createSqliteStore(dir) });
		kv = memoryKv();
		const created = await taskboard.createWorkspace('策略工具测试');
		assert.equal(created.ok, true);
		if (created.ok) workspaceId = created.workspace.id;
		await taskboard.setCardActionLevel('no-claim');
		await writeToolGuardLevel(kv, 'off');
		void workspaceId;
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('① 建出两个工具，名字与顺序稳定', () => {
		const tools = toolsOf(taskboard, kv);
		assert.deepEqual(
			tools.map((one) => one.name),
			['taskboard_tool_policy', 'taskboard_tool_policy_read'],
		);
	});

	it('② off 档 ⇒ 写工具拒绝（agent 侧权限开关未启用）；读工具仍可用', async () => {
		await writeToolGuardLevel(kv, 'off');
		const [write, read] = toolsOf(taskboard, kv);
		assert.ok(write !== undefined);
		assert.ok(read !== undefined);
		const refused = await write.execute({ tier: 'unclaimed', allow: ['bash'] }, {});
		assert.ok(refused.text.includes('权限开关未启用'), refused.text);
		assert.ok(refused.text.includes('失败'), refused.text);

		/* 读工具无门槛：off 档也读得到（此时 BASE 之外是空的）。 */
		const readBack = await read.execute({ tier: 'unclaimed' }, {});
		assert.ok(readBack.text.includes('unclaimed') || readBack.text.includes('未领取'), readBack.text);
	});

	it('③ manage-edit 档 ⇒ 写工具可执行，读工具读回写入结果', async () => {
		await writeToolGuardLevel(kv, 'manage-edit');
		const [write, read] = toolsOf(taskboard, kv);
		assert.ok(write !== undefined);
		assert.ok(read !== undefined);
		const wrote = await write.execute({ tier: 'unclaimed', allow: ['bash'] }, {});
		assert.ok(wrote.text.includes('已更新'), wrote.text);
		assert.ok(wrote.text.includes('bash'), wrote.text);

		const readBack = await read.execute({ tier: 'unclaimed' }, {});
		assert.ok(readBack.text.includes('bash'), readBack.text);
	});

	it('④ unclaimed：allow 是**并集**（BASE 之外追加，不是替换）', async () => {
		await writeToolGuardLevel(kv, 'manage-edit');
		const [write] = toolsOf(taskboard, kv);
		assert.ok(write !== undefined);
		await write.execute({ tier: 'unclaimed', allow: ['bash'] }, {});

		const extras = taskboard.getToolPolicies().unclaimed;
		assert.ok(extras.includes('bash'), 'bash 应进 extras');
		for (const base of BASE_TOOLS) {
			assert.equal(extras.includes(base), false, `BASE 工具「${base}」不该被写进 extras`);
		}
	});

	it('⑤ claimed：allow 独立成档，不串到 unclaimed', async () => {
		await writeToolGuardLevel(kv, 'manage-edit');
		const [write] = toolsOf(taskboard, kv);
		assert.ok(write !== undefined);
		await write.execute({ tier: 'claimed', allow: ['pwsh'] }, {});

		const policies = taskboard.getToolPolicies();
		assert.ok(policies.common.includes('pwsh'), 'pwsh 应在 claimed（common）档');
		assert.equal(policies.unclaimed.includes('pwsh'), false, 'claimed 的写入不该串到 unclaimed');
	});

	it('⑥ template：以模板为键，与两档互不干扰', async () => {
		await writeToolGuardLevel(kv, 'manage-edit');
		const templates = taskboard.listTemplates();
		assert.ok(templates.length > 0, '需要至少一个内置模板');
		const templateRef = templates[0]?.ref ?? '';
		assert.notEqual(templateRef, '');

		const [write] = toolsOf(taskboard, kv);
		assert.ok(write !== undefined);
		const wrote = await write.execute({ templateRef, allow: ['web_fetch'] }, {});
		assert.ok(wrote.text.includes('已更新'), wrote.text);

		const policies = taskboard.getToolPolicies();
		const delta = policies.templates[templateRef];
		assert.notEqual(delta, undefined, '模板档应有增量集合');
		assert.ok(delta?.includes('web_fetch') === true, 'web_fetch 应进该模板');
		assert.equal(policies.unclaimed.includes('web_fetch'), false, '模板档不该串到 unclaimed');
	});

	it('⑦ remove 是**交集**：只减 extras，BASE 工具移除不掉', async () => {
		await writeToolGuardLevel(kv, 'manage-edit');
		const [write] = toolsOf(taskboard, kv);
		assert.ok(write !== undefined);

		/* 先加一个 extras，再移除它 ⇒ 真的没了。 */
		await write.execute({ tier: 'unclaimed', allow: ['bash'] }, {});
		await write.execute({ tier: 'unclaimed', remove: ['bash'] }, {});
		assert.equal(taskboard.getToolPolicies().unclaimed.includes('bash'), false, 'extras 应被移除');

		/* 试图移除 BASE 工具 ⇒ 交集后不该出现（BASE 恒定在生效集合里）。 */
		const base = BASE_TOOLS[0];
		assert.notEqual(base, undefined);
		await write.execute({ tier: 'unclaimed', remove: [base] }, {});
		const effective = taskboard.effectiveToolsOf('unclaimed');
		assert.ok(effective.includes(base as string), `BASE 工具「${base}」不该被 remove 掉`);
	});
});
