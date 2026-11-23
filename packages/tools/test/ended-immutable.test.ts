/**
 * 完结态的卡 ⇒ 内容不可再改，**且 AI 工具要把原因说清楚**（用户 `2026-11-23`）。
 *
 * > 「还有一个权限设置。处于完结态的卡，action 内容不可再改变。在 core 里面设置。
 * >   并对 tool 和 dsh 指令这两处调用打错误原因」
 *
 * ## 这条测试钉的是「模型看到的文字」，不是「core 返回了失败」
 *
 * core 层的拒绝已由 `packages/core/test/ended-immutable.test.ts` 钉住。
 * 这里钉的是**工具契约**：失败结果里必须让模型能读出
 *
 *   · 发生了什么（哪张卡、什么状态）
 *   · 原因码（机器可读，宿主日志能查）
 *   · 下一步（换一张卡还是先转移 —— 只说「不允许」模型会反复重试）
 *
 * ⇒ 逐条断言 `text` 里含 **卡 id**、**状态中文名**、**原因码**、**下一步**。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskState } from '@taskboard/protocol';

import { makeFixture, run, seedCard, submitCard } from './support/fixtures.ts';

/** 把一张卡推到完结态（提交 → 成功）。 */
async function toEnded(fixture: Awaited<ReturnType<typeof makeFixture>>, id: string): Promise<void> {
	await submitCard(fixture, id);
	const moved = await fixture.tb.transition(fixture.ws, id, TaskState.COMPLETED, 'button');
	if (!moved.ok) throw new Error(`推到完结态失败：${moved.code} ${moved.message}`);
}

describe('完结态：工具侧必须给错误原因', () => {
	it('taskboard_update 被拒时，文字里有卡 id / 状态 / 原因码 / 下一步', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '完结之后不许改', {
			content: { body: { $type: 'text', value: '定稿正文' } },
		});
		await toEnded(fixture, id);

		const result = await run(fixture, 'taskboard_update', { id, path: '/body/value', value: '偷改' });

		assert.equal(result.isError, true, '必须是失败结果（isError: true）');
		assert.ok(result.text.includes(id), `理由要带卡 id\n${result.text}`);
		assert.ok(result.text.includes('成功'), `理由要带状态中文名\n${result.text}`);
		assert.ok(result.text.includes('CARD_ENDED_IMMUTABLE'), `原因码要出现\n${result.text}`);
		assert.ok(result.text.includes('下一步：'), `必须有下一步\n${result.text}`);
	});

	it('被拒后内容没变（工具层没有「先写后拒」）', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '内容不能被悄悄改', {
			content: { body: { $type: 'text', value: '定稿正文' } },
		});
		await toEnded(fixture, id);

		await run(fixture, 'taskboard_update', { id, path: '/body/value', value: '偷改' });

		const read = fixture.tb.get(fixture.ws, id);
		assert.equal(read.ok, true);
		if (!read.ok) return;
		assert.deepEqual(read.card.sections['body']?.payload, { $type: 'text', value: '定稿正文' });
	});

	it('任务板自带的「失败态」卡同样被拒（不是只拦成功）', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '失败也是完结');
		await submitCard(fixture, id);
		const moved = await fixture.tb.transition(fixture.ws, id, TaskState.FAILED, 'button');
		assert.equal(moved.ok, true, moved.ok ? '' : moved.message);

		const result = await run(fixture, 'taskboard_update', { id, path: '/body/value', value: 'x' });
		assert.equal(result.isError, true);
		assert.ok(result.text.includes('失败'), result.text);
	});

	it('非完结态照常能用 taskboard_update', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '还能改的卡', {
			content: { body: { $type: 'text', value: '旧' } },
		});

		const result = await run(fixture, 'taskboard_update', { id, path: '/body/value', value: '新' });
		assert.equal(result.isError, undefined, `不该失败\n${result.text}`);
	});

	it('完结态下 taskboard_update_note 改备注仍然可以（备注不是 action 内容）', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '完结了但能写备注');
		await toEnded(fixture, id);

		const result = await run(fixture, 'taskboard_update_note', { id, note: '完结后补一条备注' });
		assert.equal(result.isError, undefined, `备注不该被拦\n${result.text}`);
	});
});
