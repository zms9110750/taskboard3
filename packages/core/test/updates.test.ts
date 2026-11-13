/**
 * 更新计数测试。
 *
 * ## 最重要的一条
 *
 * 「看过之后 AI 又改 ⇒ **重新算未读**」。这条验证的是
 * 「已读游标存的是最新事件的 at，不是 `Date.now()`」——
 * 存 `now` 的话，打开卡这个动作会把之后到达的新事件也标记成已读。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { TaskState } from '@taskboard/protocol';

import { createTaskboard, type Taskboard } from '../lib/index.js';
import type { TemplateDef } from '../lib/template/types.js';

function makeTemplate(ref: string, kind: string): TemplateDef {
	return {
		ref,
		displayName: ref,
		kind,
		domain: '核心',
		codePrefix: 'U',
		usage: '',
		description: '',
		sections: [
			{ id: 'body', label: '正文', hint: '', action: 'text', defaultPayload: { $type: 'text' } },
		],
		derives: [],
	};
}

describe('更新计数', () => {
	let dir: string;
	let tb: Taskboard;
	let ws: string;
	let clock = 1_000;

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-updates-'));
		tb = createTaskboard({
			dataDir: dir,
			now: () => {
				clock += 100;
				return clock;
			},
		});
		tb.templates().register(makeTemplate('t-work', 'work'));
		tb.templates().register(makeTemplate('t-goal', 'goal'));
		const created = await tb.createWorkspace('更新');
		assert.ok(created.ok);
		ws = created.workspace.id;
	});

	after(async () => {
		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	/** 建一张卡（默认 user 建）。 */
	async function makeCard(title = '卡'): Promise<string> {
		const result = await tb.create({ workspaceId: ws, templateRef: 't-work', title, actor: 'user' });
		assert.ok(result.ok, JSON.stringify(result));
		return result.card.id;
	}

	it('刚建完：user 改过（AI 未读）⇒ updates.user 含它，updates.ai 不含', async () => {
		const id = await makeCard('新建');
		const result = await tb.updates(ws);
		assert.ok(result.user.includes(id), '建卡是 user 改的 ⇒ AI 未读');
		assert.equal(result.ai.includes(id), false, 'AI 还没改过');
	});

	it('AI 改一次 ⇒ updates.ai 含它', async () => {
		const id = await makeCard('等AI改');
		await tb.update(ws, id, { note: 'AI 改的' }, 'ai');

		const result = await tb.updates(ws);
		assert.ok(result.ai.includes(id), 'AI 改过、用户未读');
	});

	it('markSeen(user) 后 ⇒ updates.ai 不含它', async () => {
		const id = await makeCard('已读');
		await tb.update(ws, id, { note: 'AI 改的' }, 'ai');

		const before = await tb.updates(ws);
		assert.ok(before.ai.includes(id));

		const seen = await tb.markSeen(ws, id, 'user');
		assert.ok(seen.ok, JSON.stringify(seen));

		const afterOne = await tb.updates(ws);
		assert.equal(afterOne.ai.includes(id), false, '用户看过之后不再算未读');
	});

	it('★ 看过之后 AI 又改 ⇒ 重新算未读', async () => {
		const id = await makeCard('再改');
		await tb.update(ws, id, { note: '第一次' }, 'ai');
		await tb.markSeen(ws, id, 'user');

		const cleared = await tb.updates(ws);
		assert.equal(cleared.ai.includes(id), false, '先确认已清');

		/* AI 再改一次 —— 时钟前进，事件 at 更大。 */
		await tb.update(ws, id, { note: '第二次' }, 'ai');

		const again = await tb.updates(ws);
		assert.ok(again.ai.includes(id), '看过之后又改 ⇒ 仍算未读（这是最关键的一条）');
	});

	it('用户改一次 ⇒ updates.user 含它；AI markSeen 后消失', async () => {
		const id = await makeCard('用户改');
		/* 先让 AI 把游标推到当前，排除建卡那条的影响。 */
		await tb.markSeen(ws, id, 'ai');

		const cleared = await tb.updates(ws);
		assert.equal(cleared.user.includes(id), false, '先确认已清');

		await tb.update(ws, id, { note: '用户改的' }, 'user');
		const afterUser = await tb.updates(ws);
		assert.ok(afterUser.user.includes(id), '用户改过、AI 未读');

		await tb.markSeen(ws, id, 'ai');
		const afterAiSeen = await tb.updates(ws);
		assert.equal(afterAiSeen.user.includes(id), false, 'AI 看过之后不再算未读');
	});

	it('markSeen 返回 seenUpTo = 卡历史条数（不是时间戳、不是 now）', async () => {
		const id = await makeCard('时间');
		const got = await tb.get(ws, id);
		assert.ok(got.ok);

		const expected = got.card.history.length;

		const seen = await tb.markSeen(ws, id, 'user');
		assert.ok(seen.ok);
		assert.equal(seen.seenUpTo, expected, '写的是历史条数');
		assert.equal(typeof seen.seenUpTo, 'number');
	});

	it('★ 同一毫秒内：标记已读之后再改，仍然算未读', async () => {
		/*
		 * 这是**真 bug 的回归测试**。
		 *
		 * 旧实现用时间戳做游标：`markSeen` 写 `latestEventAt`，
		 * 判未读用 `lastChangeAt > cursor`。同一毫秒内
		 * 「标记已读」与「又一次改动」时间相等 ⇒ `1000 > 1000` 为 false
		 * ⇒ 那次改动**永久不可见**（表现为 flake：撞毫秒才失败）。
		 *
		 * 现在游标是历史下标，同毫秒完全不影响。
		 *
		 * ⚠ 这个用例里 `now` 恒返回同一个值 —— 每一毫秒都是"同一毫秒"。
		 */
		const fixedDir = mkdtempSync(join(tmpdir(), 'tb3-samems-'));
		const fixed = createTaskboard({ dataDir: fixedDir, now: () => 1_000 });
		fixed.templates().register(makeTemplate('t-work', 'work'));

		const createdWs = await fixed.createWorkspace('同毫秒');
		assert.ok(createdWs.ok);
		const wsId = createdWs.workspace.id;

		const created = await fixed.create({
			workspaceId: wsId,
			templateRef: 't-work',
			title: '同毫秒',
			actor: 'user',
		});
		assert.ok(created.ok);
		const cardId = created.card.id;

		/* ① 用户看过（此时没有任何 AI 改动）。 */
		const seen = await fixed.markSeen(wsId, cardId, 'user');
		assert.ok(seen.ok);

		const before = await fixed.updates(wsId);
		assert.equal(before.ai.includes(cardId), false, '还没 AI 改过');

		/* ② AI 在这一"毫秒"改一次 —— 所有时间戳都等于 1000。 */
		const updated = await fixed.update(wsId, cardId, { note: '同一毫秒改的' }, 'ai');
		assert.ok(updated.ok);

		/* ③ 必须仍然算未读 —— 旧实现这里会 false。 */
		const after = await fixed.updates(wsId);
		assert.ok(
			after.ai.includes(cardId),
			'同一毫秒内标记已读之后再改，仍然算未读（这是修掉的真 bug）',
		);

		await fixed.close();
		rmSync(fixedDir, { recursive: true, force: true });
	});

	it('★ 同一毫秒内连续多次改动，下标仍然严格递增', async () => {
		const fixedDir = mkdtempSync(join(tmpdir(), 'tb3-samems2-'));
		const fixed = createTaskboard({ dataDir: fixedDir, now: () => 2_000 });
		fixed.templates().register(makeTemplate('t-work', 'work'));
		const createdWs = await fixed.createWorkspace('同毫秒2');
		assert.ok(createdWs.ok);
		const wsId = createdWs.workspace.id;

		const created = await fixed.create({
			workspaceId: wsId,
			templateRef: 't-work',
			title: '多次',
			actor: 'user',
		});
		assert.ok(created.ok);
		const cardId = created.card.id;

		/* 用户看过 → AI 改 3 次（全部同一毫秒）→ 每次都应算未读。 */
		await fixed.markSeen(wsId, cardId, 'user');

		for (let i = 0; i < 3; i += 1) {
			await fixed.update(wsId, cardId, { note: `第 ${i} 次` }, 'ai');
			const now = await fixed.updates(wsId);
			assert.ok(now.ai.includes(cardId), `第 ${i} 次改动后仍算未读`);
			await fixed.markSeen(wsId, cardId, 'user');
			const cleared = await fixed.updates(wsId);
			assert.equal(cleared.ai.includes(cardId), false, `第 ${i} 次看过后已清`);
		}

		await fixed.close();
		rmSync(fixedDir, { recursive: true, force: true });
	});

	it('markSeen：卡不存在 ⇒ Failure', async () => {
		const result = await tb.markSeen(ws, 'NOPE99', 'user');
		assert.equal('ok' in result, true);
		assert.equal((result as { ok: boolean }).ok, false);
		assert.equal((result as { code?: string }).code, 'CARD_NOT_FOUND');
	});

	it('AI 建卡 ⇒ updates.user 不含它（是 AI 改的，用户未读反过来）', async () => {
		const result = await tb.create({
			workspaceId: ws,
			templateRef: 't-work',
			title: 'AI 建的',
			actor: 'ai',
		});
		assert.ok(result.ok);
		const id = result.card.id;

		const updates = await tb.updates(ws);
		assert.ok(updates.ai.includes(id), 'AI 建的 ⇒ 用户未读');
		assert.equal(updates.user.includes(id), false, '不是用户改的');
	});

	it('沿树重算不算「改过」（recompute 不进更新计数）', async () => {
		/* 父 goal + 子 work；子卡 claim 会把父卡重算成「处理中」。 */
		const parent = await tb.create({
			workspaceId: ws,
			templateRef: 't-goal',
			title: '父',
			actor: 'user',
		});
		assert.ok(parent.ok);
		await tb.adopt(ws, parent.card.id, 'user');

		const child = await tb.create({
			workspaceId: ws,
			templateRef: 't-work',
			title: '子',
			relations: { parent: parent.card.id },
			actor: 'user',
		});
		assert.ok(child.ok);
		await tb.adopt(ws, child.card.id, 'user');

		/* 清掉父卡的未读（无论是谁改的）。 */
		await tb.markSeen(ws, parent.card.id, 'user');
		await tb.markSeen(ws, parent.card.id, 'ai');

		/* claim 子卡 ⇒ 父卡被 recompute 到「处理中」。 */
		const claimed = await tb.claim(ws, child.card.id, 'user', 'loop-recompute');
		assert.ok(claimed.ok, JSON.stringify(claimed));
		assert.equal(claimed.recomputed.length > 0, true, '应当发生了重算');

		const updates = await tb.updates(ws);
		assert.equal(
			updates.ai.includes(parent.card.id),
			false,
			'重算不是内容变更 ⇒ 不该让父卡变成「AI 改过未读」',
		);
	});

	it('search 的 updatedBy 条件走 updates()', async () => {
		const id = await makeCard('搜未读');
		/* ⚠ 搜索默认**不列草稿**（用户 2026-11-08 规则 1）⇒ 先采纳，否则筛不到。 */
		await tb.adopt(ws, id, 'user');
		await tb.update(ws, id, { note: 'AI 改的' }, 'ai');

		const matched = tb.search(ws, { updatedBy: ['ai'] });
		assert.ok(matched.some((one) => one.id === id), 'updatedBy:[ai] 应当筛出 AI 改过未读的卡');

		await tb.markSeen(ws, id, 'user');
		const afterSeen = tb.search(ws, { updatedBy: ['ai'] });
		assert.equal(afterSeen.some((one) => one.id === id), false, '看过之后不该再出现');
	});

	it('search 的 updatedBy 与其它条件同时生效（AND）', async () => {
		const id = await makeCard('搜AND');
		await tb.adopt(ws, id, 'user');
		await tb.update(ws, id, { note: 'AI 改的' }, 'ai');

		/* 标题对得上 ⇒ 命中 */
		assert.ok(tb.search(ws, { title: '搜AND', updatedBy: ['ai'] }).some((one) => one.id === id));
		/* 标题对不上 ⇒ 不命中（数组间 AND） */
		assert.equal(
			tb.search(ws, { title: '完全不存在的标题', updatedBy: ['ai'] }).some((one) => one.id === id),
			false,
		);
	});
});
