/**
 * 三 scope 工具权限的测试（tool contract v2）。
 *
 * 用户要求：
 * > 设置未领取卡 / 领取了工作卡 / 一个指定工作模板，允许的工具调用。
 * > 允许的工具数组（和原有取并集）、移除的工具数组（和原有取交集）。
 *
 * 钉住：并集/交集运算、BASE 硬底线、三 scope 落点、旧 kv 兼容。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BASE_TOOLS } from '../src/index.ts';
import { createTaskboard } from '../src/index.ts';
import { createMemoryStore } from './memory-store.ts';
import { makeTemplate } from './support-v2.ts';

const TEMPLATES = [makeTemplate({ ref: 't-work', kind: 'work' })];

/** 建一个内存任务板（可预置 kv）。 */
function board(kv?: Record<string, string>): ReturnType<typeof createTaskboard> {
	const store = createMemoryStore();
	if (kv !== undefined) {
		for (const [key, value] of Object.entries(kv)) {
			void store.kvSet(key, value);
		}
	}
	const tb = createTaskboard({ store });
	for (const template of TEMPLATES) tb.templates().register(template);
	return tb;
}

describe('setToolPolicyScope', () => {
	it('未领取档：allow 与原有取并集', async () => {
		const tb = board();
		const first = await tb.setToolPolicyScope({ tier: 'unclaimed', allow: ['bash'] });
		assert.equal(first.ok, true);
		const second = await tb.setToolPolicyScope({ tier: 'unclaimed', allow: ['bash', 'read_file'] });
		assert.equal(second.ok, true);
		if (!second.ok) return;
		assert.deepEqual([...tb.getToolPolicies().unclaimed], ['bash', 'read_file']);
		assert.deepEqual(second.change.added, ['read_file'], '并集：已有的不重复加');
	});

	it('remove 与原有取交集：只移除已存在的；不存在的记 ignored（幂等）', async () => {
		const tb = board();
		await tb.setToolPolicyScope({ tier: 'unclaimed', allow: ['bash', 'read_file'] });
		const result = await tb.setToolPolicyScope({
			tier: 'unclaimed',
			remove: ['bash', '从来没配过'],
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual([...tb.getToolPolicies().unclaimed], ['read_file']);
		assert.deepEqual(result.change.removed, ['bash']);
		assert.deepEqual(result.change.ignoredRemovals, ['从来没配过']);
	});

	it('同时 allow + remove 同一个名字 ⇒ remove 优先', async () => {
		const tb = board();
		const result = await tb.setToolPolicyScope({ tier: 'unclaimed', allow: ['bash'], remove: ['bash'] });
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual([...tb.getToolPolicies().unclaimed], []);
		assert.deepEqual(result.change.added, ['bash']);
		assert.deepEqual(result.change.removed, ['bash']);
	});

	it('BASE 硬底线：allow 里的 BASE 名字记 alreadyBase，remove 里的被保护', async () => {
		const tb = board();
		const baseTool = BASE_TOOLS[0];
		assert.notEqual(baseTool, undefined);
		if (baseTool === undefined) return;

		const result = await tb.setToolPolicyScope({
			tier: 'unclaimed',
			allow: [baseTool, 'bash'],
			remove: [baseTool],
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual(result.change.alreadyBase, [baseTool]);
		assert.deepEqual(result.change.protectedRemovals, [baseTool]);
		assert.deepEqual([...tb.getToolPolicies().unclaimed], ['bash'], 'BASE 不进增量、也移不掉');
	});

	it('领取档写进 common；模板档写进 templates[ref] 并校验模板存在', async () => {
		const tb = board();
		const claimed = await tb.setToolPolicyScope({ tier: 'claimed', allow: ['write'] });
		assert.equal(claimed.ok, true);
		if (claimed.ok) assert.equal(claimed.change.scope, 'claimed');
		assert.deepEqual([...tb.getToolPolicies().common], ['write']);

		const template = await tb.setToolPolicyScope({ templateRef: 't-work', allow: ['bash'] });
		assert.equal(template.ok, true);
		if (template.ok) assert.equal(template.change.templateRef, 't-work');
		assert.deepEqual([...tb.getToolPolicies().templates['t-work'] ?? []], ['bash']);

		const missing = await tb.setToolPolicyScope({ templateRef: '不存在', allow: ['bash'] });
		assert.equal(missing.ok, false);
		if (!missing.ok) assert.equal(missing.code, 'TEMPLATE_NOT_FOUND');
	});

	it('tier 与 templateRef 必须二选一；tier 枚举校验', async () => {
		const tb = board();
		const both = await tb.setToolPolicyScope({ tier: 'claimed', templateRef: 't-work', allow: [] });
		assert.equal(both.ok, false);
		const neither = await tb.setToolPolicyScope({ allow: [] });
		assert.equal(neither.ok, false);
		const bad = await tb.setToolPolicyScope({ tier: 'nope' as 'claimed', allow: [] });
		assert.equal(bad.ok, false);
	});

	it('旧 kv（没有 unclaimed 字段）⇒ 读成空增量，不炸', async () => {
		const tb = board({
			'toolPolicy:v2': JSON.stringify({ common: ['bash'], groups: {}, groupMembers: {}, templates: {} }),
		});
		assert.deepEqual([...tb.getToolPolicies().unclaimed], []);
		assert.deepEqual([...tb.getToolPolicies().common], ['bash']);
	});

	it('未领取档真的影响判定：manage 档下没有卡也能调；生效集含它', async () => {
		const tb = board();
		await tb.setToolGuardLevel('manage');
		assert.equal(
			tb.judgeToolCall({ toolName: 'bash', heldCards: [] }).ok,
			false,
			'没配之前 bash 不该放行',
		);
		await tb.setToolPolicyScope({ tier: 'unclaimed', allow: ['bash'] });
		assert.equal(tb.judgeToolCall({ toolName: 'bash', heldCards: [] }).ok, true);
		assert.ok(tb.effectiveToolsOf('t-work').includes('bash'));
	});

	it('未领取档只加不减 BASE：生效集永远包含 BASE', async () => {
		const tb = board();
		await tb.setToolPolicyScope({ tier: 'unclaimed', remove: [...BASE_TOOLS] });
		const effective = tb.effectiveToolsOf('t-work');
		for (const base of BASE_TOOLS) assert.ok(effective.includes(base), `${base} 不该被移除`);
	});
});
