/**
 * core 的验收测试 —— 「注册模板 → 建卡校验 → 注销模板 → 再建卡报错」。
 *
 * 覆盖的是**用户裁定的核心路径**：
 *
 *   · 校验在 core（UI 与 AI 走同一入口）；
 *   · 模板注册/注销要**通知**，缓存随之重建；
 *   · 未知章节名必须被拦住（不是"自由 object + 靠描述约束"）。
 */

import assert from 'node:assert/strict';
import { createMemoryStore } from './memory-store.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { z } from 'zod';

import { createTaskboard, type Taskboard } from '../src/index.ts';
import type { TemplateDef } from '../src/template/types.ts';

/** 一个最小的测试模板：一个 text 章节 + 一个 markdown 章节。 */
function makeTemplate(ref = 'demo'): TemplateDef {
	return {
		ref,
		displayName: '演示',
		kind: 'work',
		domain: '核心',
		codePrefix: 'D',
		usage: '用于测试。',
		description: '测试模板。',
		sections: [
			{
				id: 'what',
				label: '要做什么',
				hint: '写清楚。',
				action: 'text',
				defaultPayload: { $type: 'text', placeholder: '写下来' },
			},
			{
				id: 'how',
				label: '怎么做',
				hint: '写方案。',
				action: 'markdown',
				defaultPayload: { $type: 'markdown' },
			},
		],
		derives: [],
	};
}

describe('core：模板注册 / 校验 / 注销', () => {
	let dir: string;
	let tb: Taskboard;
	let wsId: string;
	let dispose: (() => void) | undefined;

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-core-test-'));
		tb = createTaskboard({ store: createMemoryStore(), now: () => 1_000, builtinTemplates: false });
		const created = await tb.createWorkspace('测试');
		assert.ok('workspace' in created, '建空间应当成功');
		wsId = created.workspace.id;
		dispose = tb.templates().register(makeTemplate());
	});

	after(async () => {
		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('模板已注册，能列出', () => {
		const refs = tb.listTemplates().map((one) => one.ref);
		assert.deepEqual(refs, ['demo']);
	});

	it('建卡：合法 content 成功，编号按 类别字母 + codePrefix 发号', async () => {
		const result = await tb.create({
			workspaceId: wsId,
			templateRef: 'demo',
			title: '第一张',
			content: {
				要做什么: { $type: 'text', value: '做点事' },
				怎么做: { $type: 'markdown', value: '# 方案' },
			},
			actor: 'user',
		});
		assert.ok(result.ok, `建卡应当成功，实际：${JSON.stringify(result)}`);
		assert.equal(result.card.id, 'WD01', 'work 的字母 W + codePrefix D + 01');
		assert.equal(result.card.status, 'TASK_STATE_UNSPECIFIED', '初始一律草稿');
		assert.equal(result.card.sections['what']?.label, '要做什么', '存的是 label 副本');
	});

	it('建卡：未知章节名被拦住，且错误消息给出可用章节', async () => {
		const result = await tb.create({
			workspaceId: wsId,
			templateRef: 'demo',
			title: '第二张',
			content: { 不存在的章节: { $type: 'text', value: 'x' } },
			actor: 'user',
		});
		assert.equal(result.ok, false, '未知章节名必须被拒');
		assert.equal(result.code, 'CONTENT_INVALID');
		assert.ok(result.message.includes('可用的章节'), '错误消息必须给出可用章节');
		assert.ok(result.message.includes('要做什么'), '错误消息必须列出 label');
	});

	it('建卡：payload 形状不对被拦住', async () => {
		const result = await tb.create({
			workspaceId: wsId,
			templateRef: 'demo',
			title: '第三张',
			content: { 要做什么: { $type: 'text', value: 123 } },
			actor: 'user',
		});
		assert.equal(result.ok, false);
		assert.equal(result.code, 'CONTENT_INVALID');
	});

	it('建卡：省略 content 时用模板默认值', async () => {
		const result = await tb.create({
			workspaceId: wsId,
			templateRef: 'demo',
			title: '第四张',
			actor: 'user',
		});
		assert.ok(result.ok);
		assert.equal(result.card.sections['what']?.payload !== undefined, true, '默认值应被填入');
	});

	it('注销模板后：再建卡报 TEMPLATE_NOT_FOUND', async () => {
		dispose?.();
		dispose = undefined;

		const listed = tb.listTemplates();
		assert.deepEqual(listed, [], '注销后清单应为空');

		const result = await tb.create({
			workspaceId: wsId,
			templateRef: 'demo',
			title: '第五张',
			actor: 'user',
		});
		assert.equal(result.ok, false);
		assert.equal(result.code, 'TEMPLATE_NOT_FOUND');
	});

	it('重新注册同一模板后又能建卡（注销/注册是对称的）', async () => {
		dispose = tb.templates().register(makeTemplate());

		const result = await tb.create({
			workspaceId: wsId,
			templateRef: 'demo',
			title: '第六张',
			content: { 要做什么: { $type: 'text', value: '再来一次' } },
			actor: 'user',
		});
		assert.ok(result.ok);
	});

	it('注销函数幂等：连调两次不抛', () => {
		const off = tb.templates().register(makeTemplate('temp'));
		assert.doesNotThrow(() => {
			off();
			off();
		});
	});

	it('action 注销后，引用它的模板校验报 ACTION_NOT_FOUND', async () => {
		/* 注册一个自定义 action，再注册引用它的模板，然后注销 action。 */
		const offAction = tb.actions().register({
			$type: 'custom',
			summary: '自定义',
			payloadSchema: z.strictObject({ $type: z.literal('custom') }),
			defaultPayload: { $type: 'custom' },
		});
		const offTemplate = tb.templates().register({
			...makeTemplate('usesCustom'),
			sections: [
				{ id: 'x', label: '自定义章', hint: '', action: 'custom', defaultPayload: { $type: 'custom' } },
			],
		});

		/* 先确认能建卡。 */
		const okResult = await tb.create({
			workspaceId: wsId,
			templateRef: 'usesCustom',
			title: '自定义',
			content: { 自定义章: { $type: 'custom' } },
			actor: 'user',
		});
		assert.ok(okResult.ok, '注册齐了应当能建卡');

		offAction();

		const badResult = await tb.create({
			workspaceId: wsId,
			templateRef: 'usesCustom',
			title: '自定义2',
			content: { 自定义章: { $type: 'custom' } },
			actor: 'user',
		});
		assert.equal(badResult.ok, false);
		assert.equal(badResult.code, 'ACTION_NOT_FOUND');

		offTemplate();
	});
});


