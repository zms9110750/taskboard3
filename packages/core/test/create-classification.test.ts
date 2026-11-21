/**
 * 建卡「分类 / 领域」覆盖的测试（tool contract v2 的「空模板」）。
 *
 * 用户要求：
 * > 选择领域和目的（这个可空，通常不要。但是在使用空模板时，这两个必要）。
 *
 * 「空模板」= loader 允许的 `kind: ''` / `domain: ''`。内置 YAML 都声明了，
 * 所以这里用程序注册造出来。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTaskboard } from '../src/index.ts';
import { createMemoryStore } from './memory-store.ts';
import { makeTemplate } from './support-v2.ts';

/** 建一个只注册了「空模板」的任务板。 */
function board(): ReturnType<typeof createTaskboard> {
	const tb = createTaskboard({ store: createMemoryStore() });
	tb.templates().register(makeTemplate({ ref: 'blank', kind: '', domain: '', codePrefix: 'B' }));
	tb.templates().register(makeTemplate({ ref: 'normal', kind: 'work', domain: '核心', codePrefix: 'X' }));
	return tb;
}

describe('建卡的分类 / 领域覆盖', () => {
	it('空模板 + 给了 kind/domain ⇒ 建卡成功，卡上是入参快照', async () => {
		const tb = board();
		const ws = await tb.ensureAnyWorkspace();
		const created = await tb.create({
			workspaceId: ws.id,
			templateRef: 'blank',
			title: '空模板卡',
			kind: 'goal',
			domain: '代码',
			actor: 'ai',
		});
		assert.equal(created.ok, true, created.ok ? '' : created.message);
		if (!created.ok) return;
		assert.equal(created.card.template.kind, 'goal');
		assert.equal(created.card.template.domain, '代码');
		assert.match(created.card.id, /^GB\d+$/u, `编号应按分类字母 G + codePrefix B 发：${created.card.id}`);
	});

	it('空模板缺 kind / domain ⇒ 拒绝，并指出缺哪个', async () => {
		const tb = board();
		const ws = await tb.ensureAnyWorkspace();
		const noKind = await tb.create({ workspaceId: ws.id, templateRef: 'blank', title: 'x', domain: '核心' });
		assert.equal(noKind.ok, false);
		if (!noKind.ok) {
			assert.equal(noKind.code, 'FIELD_REQUIRED');
			assert.ok(noKind.issues?.some((one) => one.path === '/kind'), JSON.stringify(noKind.issues));
		}
		const noDomain = await tb.create({ workspaceId: ws.id, templateRef: 'blank', title: 'x', kind: 'goal' });
		assert.equal(noDomain.ok, false);
		if (!noDomain.ok) assert.ok(noDomain.issues?.some((one) => one.path === '/domain'));
	});

	it('模板已声明分类/领域：入参一致可通过，不一致拒绝（不静默覆盖）', async () => {
		const tb = board();
		const ws = await tb.ensureAnyWorkspace();

		const same = await tb.create({
			workspaceId: ws.id,
			templateRef: 'normal',
			title: '一致',
			kind: 'work',
			domain: '核心',
		});
		assert.equal(same.ok, true, same.ok ? '' : same.message);

		const differentKind = await tb.create({
			workspaceId: ws.id,
			templateRef: 'normal',
			title: '不一致',
			kind: 'goal',
		});
		assert.equal(differentKind.ok, false);

		const differentDomain = await tb.create({
			workspaceId: ws.id,
			templateRef: 'normal',
			title: '不一致',
			domain: '代码',
		});
		assert.equal(differentDomain.ok, false);
	});

	it('空模板 + kind 未注册 ⇒ 发号失败，提示先看定义', async () => {
		const tb = board();
		const ws = await tb.ensureAnyWorkspace();
		const created = await tb.create({
			workspaceId: ws.id,
			templateRef: 'blank',
			title: '坏分类',
			kind: '不存在的分类',
			domain: '核心',
		});
		assert.equal(created.ok, false);
		if (!created.ok) assert.ok(created.message.includes('taskboard_definitions'), created.message);
	});
});
