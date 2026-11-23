/**
 * #9 工具权限的测试（仅 DSH + agent 侧开关）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTaskboardToolRegistry } from '../src/index.ts';
import { context, makeFixture, run, runOk } from './support/fixtures.ts';

describe('taskboard_tool_policy', () => {
	it('仅 DSH：MCP 注册表里没有这个工具', async () => {
		const fixture = await makeFixture();
		const mcp = createTaskboardToolRegistry(fixture.tools, { host: 'mcp' });
		assert.equal(mcp.has('taskboard_tool_policy'), false);
		assert.deepEqual(
			fixture.tools.find((one) => one.name === 'taskboard_tool_policy')?.hosts,
			['dsh'],
		);
	});

	it('agent 侧开关未启用 ⇒ 拒绝（门槛）', async () => {
		const fixture = await makeFixture();
		const result = await run(
			fixture,
			'taskboard_tool_policy',
			{ tier: 'unclaimed', allow: ['bash'] },
			context(fixture, { canManageToolPolicies: false }),
		);
		assert.equal(result.isError, true);
		assert.ok(result.text.includes('权限开关未启用'), result.text);

		/* 被拒绝时不得落库。 */
		assert.deepEqual([...fixture.tb.getToolPolicies().unclaimed], []);
	});

	it('未领取档：allow 并集、remove 交集（幂等）', async () => {
		const fixture = await makeFixture();
		const added = await runOk(fixture, 'taskboard_tool_policy', {
			tier: 'unclaimed',
			allow: ['bash', 'read_file'],
		});
		assert.ok(added.includes('未领取卡'), added);
		assert.ok(added.includes('bash、read_file'), added);
		assert.deepEqual([...fixture.tb.getToolPolicies().unclaimed], ['bash', 'read_file']);

		const removed = await runOk(fixture, 'taskboard_tool_policy', {
			tier: 'unclaimed',
			remove: ['bash', '从没配过'],
		});
		assert.ok(removed.includes('本次移除：bash'), removed);
		assert.ok(removed.includes('忽略'), removed);
		assert.deepEqual([...fixture.tb.getToolPolicies().unclaimed], ['read_file']);
	});

	it('领取档 / 指定工作模板档', async () => {
		const fixture = await makeFixture();
		const claimed = await runOk(fixture, 'taskboard_tool_policy', {
			tier: 'claimed',
			allow: ['write'],
		});
		assert.ok(claimed.includes('领取了工作卡'), claimed);
		assert.deepEqual([...fixture.tb.getToolPolicies().common], ['write']);

		const template = await runOk(fixture, 'taskboard_tool_policy', {
			templateRef: 't-work',
			allow: ['bash'],
		});
		assert.ok(template.includes('模板「t-work」'), template);
		assert.deepEqual([...fixture.tb.getToolPolicies().templates['t-work'] ?? []], ['bash']);
	});

	it('tier / templateRef 必须二选一；未知模板 ⇒ 失败（失败路径）', async () => {
		const fixture = await makeFixture();
		const both = await run(fixture, 'taskboard_tool_policy', {
			tier: 'claimed',
			templateRef: 't-work',
			allow: [],
		});
		assert.equal(both.isError, true);
		assert.ok(both.text.includes('二选一'), both.text);

		const neither = await run(fixture, 'taskboard_tool_policy', { allow: ['bash'] });
		assert.equal(neither.isError, true);

		const badTier = await run(fixture, 'taskboard_tool_policy', { tier: 'nope', allow: [] });
		assert.equal(badTier.isError, true);

		const missingTemplate = await run(fixture, 'taskboard_tool_policy', {
			templateRef: '不存在',
			allow: ['bash'],
		});
		assert.equal(missingTemplate.isError, true);
		assert.ok(missingTemplate.text.includes('不存在'), missingTemplate.text);
	});

	it('BASE 是硬底线：请求移除基础工具 ⇒ 明确告知受保护', async () => {
		const fixture = await makeFixture();
		const text = await runOk(fixture, 'taskboard_tool_policy', {
			tier: 'unclaimed',
			remove: ['taskboard_transition'],
		});
		assert.ok(text.includes('受保护未移除'), text);
		assert.ok(text.includes('taskboard_transition'), text);
		/* 生效集里基础工具仍然在。 */
		assert.ok(fixture.tb.effectiveToolsOf('t-work').includes('taskboard_transition'));
	});

	it('未领取档写进去之后，生效集包含它', async () => {
		/*
		 * ⚠ 原来这里还断言了两条 `judgeToolCall` —— 「manage 档下没卡时 bash 拒 /
		 *   配了 unclaimed 之后放行」。
		 *
		 *   那两条测的是 **agent 侧档位 + 判定**，`2026-11-23` 已随实现搬进
		 *   `@taskboard/dsh-tools`（用户：「core 完全不知道也不干涉 agent 的那一侧的
		 *   注入权限」）。本包是**宿主无关层（MCP 共用）**，不能 import dsh-tools
		 *   （依赖方向 `dsh-tools → tools`）⇒ 那两条**搬到了**
		 *   `packages/dsh-tools/test/tool-guard.test.ts` 的「三 scope 策略参与判定」段。
		 *
		 *   本文件只保留本层能测的：工具真的把增量写进了策略、生效集真的含它。
		 */
		const fixture = await makeFixture();
		await runOk(fixture, 'taskboard_tool_policy', { tier: 'unclaimed', allow: ['bash'] });
		assert.deepEqual([...fixture.tb.getToolPolicies().unclaimed], ['bash']);
		assert.ok(fixture.tb.effectiveToolsOf('t-work').includes('bash'));
	});
});

