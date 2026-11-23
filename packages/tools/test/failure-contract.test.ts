/**
 * 失败契约的测试（用户：「失败的部分让他自己发挥，我要检查」）。
 *
 * 钉住四件事：
 * 1. 失败文本有固定结构：失败 / 原因码 / 能否重试 / 下一步；
 * 2. 失败结果 `isError: true`；成功结果不带 `isError`；
 * 3. 参数错误可重试；装配/权限错误不可重试；
 * 4. 写操作没有部分成功。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeFixture, run, runOk, seedCard, context } from './support/fixtures.ts';

describe('失败契约', () => {
	it('失败文本结构完整（原因码 / 能否重试 / 下一步）', async () => {
		const fixture = await makeFixture();
		const result = await run(fixture, 'taskboard_card', { id: 'NOPE' });
		assert.equal(result.isError, true);
		for (const marker of ['失败：', '原因码：CARD_NOT_FOUND', '能否重试：', '下一步：']) {
			assert.ok(result.text.includes(marker), `缺「${marker}」：\n${result.text}`);
		}
		assert.ok(result.text.includes('修正参数后可重试'), result.text);
	});

	it('参数错误可重试（「宿主能力缺失不可重试」那条随两个权限工具搬到 dsh-agent-guard）', async () => {
		const fixture = await makeFixture();
		const param = await run(fixture, 'taskboard_card', {});
		assert.ok(param.text.includes('修正参数后可重试'), param.text);
	});

	it('字段级问题逐条列出（core 的 Failure.issues 被翻译）', async () => {
		const fixture = await makeFixture();
		const result = await run(fixture, 'taskboard_create', {
			title: '字段问题',
			templateRef: 't-work',
			content: { 瞎写的章节: { $type: 'text' } },
		});
		assert.equal(result.isError, true);
		assert.ok(result.text.includes('具体问题：'), result.text);
		assert.ok(result.text.includes('瞎写的章节'), result.text);
	});

	it('成功结果不带 isError（与失败可区分）', async () => {
		const fixture = await makeFixture();
		await seedCard(fixture, 't-work', '成功');
		const text = await runOk(fixture, 'taskboard_cards', {});
		assert.equal(typeof text, 'string');
		const result = await run(fixture, 'taskboard_cards', {});
		assert.equal(result.isError, undefined);
	});

	it('建卡是原子的：内容校验失败时关系/卡都不会留下', async () => {
		const fixture = await makeFixture();
		const before = fixture.tb.list(fixture.ws).length;
		const result = await run(fixture, 'taskboard_create', {
			title: '原子性',
			templateRef: 't-work',
			content: { body: { $type: 'text', value: 'ok' }, ask: { $type: 'ask', items: [] } },
		});
		assert.equal(result.isError, true);
		assert.equal(fixture.tb.list(fixture.ws).length, before);
	});

	it('失败文案会给出可行动下一步（不同错误码不同指引）', async () => {
		const fixture = await makeFixture();
		const notFound = await run(fixture, 'taskboard_create', { title: 'x', templateRef: '不存在' });
		assert.ok(notFound.text.includes('taskboard_definitions'), notFound.text);

		const badRelation = await run(fixture, 'taskboard_create', {
			title: 'x',
			templateRef: 't-work',
			relations: [{ type: 'dependsOn', to: 'NOPE' }],
		});
		assert.ok(badRelation.text.includes('taskboard_cards'), badRelation.text);
	});
});
