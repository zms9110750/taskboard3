/**
 * 更新计数的测试 —— 未读是**卡上的字段**（`Card.unread`）。
 *
 * ## 与旧版测试的区别
 *
 * 旧版测的是「游标比较」（时间戳 → 历史下标）。现在没有游标了：
 * 未读由 `withHistory` 在每次追加事件时**增量维护**。
 *
 * ⇒ 关键测试变成**不变量**：`card.unread` 必须等于「按 history 重算」的期望值。
 *   那是防漂移的唯一守卫（bool 是缓存，绕开 `withHistory` 就会漂）。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { TaskState } from '@taskboard/protocol';

import { createTaskboard, type Taskboard } from '../lib/index.js';
import { createBus, type TaskboardMessage } from '../lib/bus.js';
import type { Card } from '../lib/card.js';
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

/**
 * 按 history **独立重算**未读期望值 —— 这是不变量测试的参照实现。
 *
 * ⚠ 刻意不复用 `unreadAfter`：如果复用，实现错了参照也跟着错，测试就没意义了。
 *   这里从头写一遍规则（`recompute` 不算改过；ai 置 ai、user 置 user）。
 */
function expectedUnread(card: Card): { ai: boolean; user: boolean } {
	let ai = false;
	let user = false;
	for (const entry of card.history) {
		if (entry.action === 'recompute') continue;
		if (entry.actor === 'ai') ai = true;
		if (entry.actor === 'user') user = true;
	}
	return { ai, user };
}

describe('未读字段：基本语义', () => {
	let dir: string;
	let tb: Taskboard;
	let wsId: string;
	/** 时钟递进，但不重要了 —— 未读不再依赖时间。 */
	let clock = 1_000;

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-unread-'));
		tb = createTaskboard({
			dataDir: dir,
			now: () => {
				clock += 100;
				return clock;
			},
		});
		tb.templates().register(makeTemplate('t-work', 'work'));
		tb.templates().register(makeTemplate('t-goal', 'goal'));
		const created = await tb.createWorkspace('未读');
		assert.ok(created.ok);
		wsId = created.workspace.id;
	});

	after(async () => {
		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	const wsOf = (): string => wsId;

	async function makeCard(actor: 'user' | 'ai' = 'user'): Promise<string> {
		const result = await tb.create({
			workspaceId: wsOf(),
			templateRef: 't-work',
			title: `卡-${Math.random().toString(36).slice(2, 7)}`,
			actor,
		});
		assert.ok(result.ok, JSON.stringify(result));
		return result.card.id;
	}

	it('user 建卡 ⇒ unread.user = true（AI 未读）', async () => {
		const id = await makeCard('user');
		const got = await tb.get(wsOf(), id);
		assert.ok(got.ok);
		assert.equal(got.card.unread.user, true, '用户改过 ⇒ AI 未读');
		assert.equal(got.card.unread.ai, false, 'AI 还没改过');
	});

	it('AI 建卡 ⇒ unread.ai = true（用户未读）', async () => {
		const id = await makeCard('ai');
		const got = await tb.get(wsOf(), id);
		assert.ok(got.ok);
		assert.equal(got.card.unread.ai, true, 'AI 改过 ⇒ 用户未读');
		assert.equal(got.card.unread.user, false);
	});

	it('AI 改一次 ⇒ unread.ai = true；updates.ai 含它', async () => {
		const id = await makeCard('user');
		await tb.update(wsOf(), id, { note: 'AI 改的' }, 'ai');

		const got = await tb.get(wsOf(), id);
		assert.ok(got.ok);
		assert.equal(got.card.unread.ai, true);

		const result = await tb.updates(wsOf());
		assert.ok(result.ai.includes(id));
	});

	it('markSeen(user) 只清 unread.ai，不动 unread.user', async () => {
		const id = await makeCard('user'); /* unread = { ai: false, user: true } */
		await tb.update(wsOf(), id, { note: 'AI 改的' }, 'ai'); /* unread = { ai: true, user: true } */

		const seen = await tb.markSeen(wsOf(), id, 'user');
		assert.ok(seen.ok, JSON.stringify(seen));
		assert.equal(seen.unread.ai, false, '用户读掉了「AI 改过」');
		assert.equal(seen.unread.user, true, '「用户改过、AI 未读」不该被用户自己清掉');
	});

	it('markSeen 落库（重新读卡仍是清的）', async () => {
		const id = await makeCard('user');
		await tb.update(wsOf(), id, { note: 'AI 改的' }, 'ai');
		await tb.markSeen(wsOf(), id, 'user');

		const got = await tb.get(wsOf(), id);
		assert.ok(got.ok);
		assert.equal(got.card.unread.ai, false, '必须持久化，不能只是内存里清');
	});

	it('markSeen 卡不存在 ⇒ CARD_NOT_FOUND', async () => {
		const result = await tb.markSeen(wsOf(), 'NOPE99', 'user');
		assert.equal((result as { ok: boolean }).ok, false);
		assert.equal((result as { code?: string }).code, 'CARD_NOT_FOUND');
	});

	it('markSeen 无变化时不落库（changed = false 路径）', async () => {
		const id = await makeCard('user');
		/* 只有 user 改过 ⇒ unread.ai 是 false；再 markSeen(user) 没有任何变化。 */
		const before = await tb.get(wsOf(), id);
		assert.ok(before.ok);
		assert.equal(before.card.unread.ai, false);

		const seen = await tb.markSeen(wsOf(), id, 'user');
		assert.ok(seen.ok);

		const after1 = await tb.get(wsOf(), id);
		assert.ok(after1.ok);
		/* history 不该多出任何一条（markSeen 不清历史，也不写历史）。 */
		assert.equal(after1.card.history.length, before.card.history.length, 'markSeen 不写 history');
	});

	it('markSeen 不清 history（历史是审计记录）', async () => {
		const id = await makeCard('user');
		await tb.update(wsOf(), id, { note: 'AI 改的' }, 'ai');
		const before = await tb.get(wsOf(), id);
		assert.ok(before.ok);
		await tb.markSeen(wsOf(), id, 'user');
		const after1 = await tb.get(wsOf(), id);
		assert.ok(after1.ok);
		assert.equal(after1.card.history.length, before.card.history.length);
	});
});

describe('未读字段：recompute 不算改过', () => {
	it('沿树重算不置 unread（父卡保持未读状态不变）', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-unread-rc-'));
		let clock = 1_000;
		const tb = createTaskboard({
			dataDir: dir,
			now: () => {
				clock += 10;
				return clock;
			},
		});
		tb.templates().register(makeTemplate('t-goal', 'goal'));
		tb.templates().register(makeTemplate('t-work', 'work'));
		const ws = (await tb.createWorkspace('重算未读')).workspace.id;

		const parent = await tb.create({ workspaceId: ws, templateRef: 't-goal', title: '父', actor: 'user' });
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

		/* 清掉父卡的两个未读。 */
		await tb.markSeen(ws, parent.card.id, 'user');
		await tb.markSeen(ws, parent.card.id, 'ai');
		const cleared = await tb.get(ws, parent.card.id);
		assert.ok(cleared.ok);
		assert.deepEqual(cleared.card.unread, { ai: false, user: false });

		/* claim 子卡 ⇒ 父卡被 recompute 到「处理中」。 */
		const claimed = await tb.claim(ws, child.card.id, 'user', 'loop-rc');
		assert.ok(claimed.ok, JSON.stringify(claimed));
		assert.equal(claimed.recomputed.length > 0, true, '应当发生了重算');

		const parentNow = await tb.get(ws, parent.card.id);
		assert.ok(parentNow.ok);
		assert.equal(parentNow.card.unread.ai, false, 'recompute 不是「AI 改过」');
		assert.equal(
			parentNow.card.unread.user,
			false,
			'claim 是用户发起的，但重算本身不置未读 —— 父卡不该因此变成「用户改过未读」',
		);

		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe('★ 不变量：unread 必须等于「按 history 重算」', () => {
	/*
	 * 这是**防漂移的唯一守卫**。
	 *
	 * `unread` 是增量维护的缓存 —— 任何绕过 `withHistory` 直接改 `history` 的路径
	 * 都会让它漂，而漂了不会报错，只表现为「角标偶尔不对」。
	 */
	it('跑一串操作后，每张卡的 unread 都与重算一致', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-unread-inv-'));
		let clock = 1_000;
		const tb = createTaskboard({
			dataDir: dir,
			now: () => {
				clock += 10;
				return clock;
			},
		});
		tb.templates().register(makeTemplate('t-goal', 'goal'));
		tb.templates().register(makeTemplate('t-work', 'work'));
		const ws = (await tb.createWorkspace('不变量')).workspace.id;

		/* 制造各种事件：user 建 / ai 建 / adopt / claim / release / update(ai) / update(user) / 重算 */
		const a = await tb.create({ workspaceId: ws, templateRef: 't-goal', title: 'A', actor: 'user' });
		assert.ok(a.ok);
		/* ⚠ 父卡必须先采纳：草稿不能被指（`checkRelations` 的既定规则）。 */
		await tb.adopt(ws, a.card.id, 'user');

		const b = await tb.create({ workspaceId: ws, templateRef: 't-work', title: 'B', actor: 'ai' });
		assert.ok(b.ok);
		const c = await tb.create({
			workspaceId: ws,
			templateRef: 't-work',
			title: 'C',
			relations: { parent: a.card.id },
			actor: 'user',
		});
		assert.ok(c.ok, JSON.stringify(c));

		await tb.adopt(ws, c.card.id, 'ai');
		await tb.update(ws, b.card.id, { note: 'ai 写的' }, 'ai');
		await tb.update(ws, c.card.id, { note: 'user 写的' }, 'user');
		await tb.markSeen(ws, a.card.id, 'user');
		await tb.markSeen(ws, b.card.id, 'ai');
		await tb.claim(ws, c.card.id, 'user', 'loop-inv');

		/* 逐卡比对。 */
		const cards = tb.list(ws);
		assert.ok(cards.length >= 3);
		for (const card of cards) {
			const expected = expectedUnread(card);
			assert.deepEqual(
				card.unread,
				expected,
				`卡「${card.id}」的 unread 漂了：实际 ${JSON.stringify(card.unread)}，` +
					`按 history 重算应为 ${JSON.stringify(expected)}。` +
					`history=${JSON.stringify(card.history.map((h) => ({ a: h.action, who: h.actor })))}`,
			);
		}

		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe('同一毫秒（回归保护）', () => {
	/*
	 * ⚠ 这条是 `task-20` 修掉的那个真 bug 的回归测试。
	 *
	 * 旧实现用时间戳游标：同一毫秒内「标记已读」与「又一次改动」时间相等
	 * ⇒ `1000 > 1000` 为 false ⇒ 那次改动永久不可见（表现为 flake）。
	 *
	 * 现在未读是 bool，**天然不依赖时间** ⇒ 同毫秒不会出错。
	 * 保留这条是为了：如果有人把 bool 改回时间戳/下标派生，它会立刻红。
	 */
	it('同一毫秒内：标记已读之后再改，仍然算未读', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-samems-'));
		const fixed = createTaskboard({ dataDir: dir, now: () => 1_000 });
		fixed.templates().register(makeTemplate('t-work', 'work'));

		const createdWs = await fixed.createWorkspace('同毫秒');
		assert.ok(createdWs.ok);
		const ws = createdWs.workspace.id;

		const created = await fixed.create({
			workspaceId: ws,
			templateRef: 't-work',
			title: '同毫秒',
			actor: 'user',
		});
		assert.ok(created.ok);
		const id = created.card.id;

		/* ① 用户看过。 */
		const seen = await fixed.markSeen(ws, id, 'user');
		assert.ok(seen.ok);

		const before = await fixed.updates(ws);
		assert.equal(before.ai.includes(id), false, '还没 AI 改过');

		/* ② AI 在这一"毫秒"改一次 —— 所有时间戳都等于 1000。 */
		const updated = await fixed.update(ws, id, { note: '同一毫秒改的' }, 'ai');
		assert.ok(updated.ok);

		/* ③ 必须仍然算未读。 */
		const after = await fixed.updates(ws);
		assert.ok(after.ai.includes(id), '同一毫秒内标记已读之后再改，仍然算未读');

		await fixed.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('同一毫秒内连续多次改动，每次都正确置未读', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-samems2-'));
		const fixed = createTaskboard({ dataDir: dir, now: () => 2_000 });
		fixed.templates().register(makeTemplate('t-work', 'work'));
		const createdWs = await fixed.createWorkspace('同毫秒2');
		assert.ok(createdWs.ok);
		const ws = createdWs.workspace.id;

		const created = await fixed.create({
			workspaceId: ws,
			templateRef: 't-work',
			title: '多次',
			actor: 'user',
		});
		assert.ok(created.ok);
		const id = created.card.id;

		await fixed.markSeen(ws, id, 'user');

		for (let i = 0; i < 3; i += 1) {
			await fixed.update(ws, id, { note: `第 ${i} 次` }, 'ai');
			const now = await fixed.updates(ws);
			assert.ok(now.ai.includes(id), `第 ${i} 次改动后仍算未读`);
			await fixed.markSeen(ws, id, 'user');
			const cleared = await fixed.updates(ws);
			assert.equal(cleared.ai.includes(id), false, `第 ${i} 次看过后已清`);
		}

		await fixed.close();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe('search 的 updatedBy 走 Card.unread', () => {
	it('updatedBy:[ai] 筛出 AI 改过未读的卡；markSeen 后消失', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-upd-search-'));
		const tb = createTaskboard({ dataDir: dir, now: () => 3_000 });
		tb.templates().register(makeTemplate('t-work', 'work'));
		const ws = (await tb.createWorkspace('搜未读')).workspace.id;

		const created = await tb.create({ workspaceId: ws, templateRef: 't-work', title: '搜未读' });
		assert.ok(created.ok);
		const id = created.card.id;
		await tb.adopt(ws, id, 'user');
		await tb.update(ws, id, { note: 'AI 改的' }, 'ai');

		const matched = tb.search(ws, { updatedBy: ['ai'] });
		assert.ok(matched.some((one) => one.id === id), 'updatedBy:[ai] 应当筛出它');

		await tb.markSeen(ws, id, 'user');
		const after = tb.search(ws, { updatedBy: ['ai'] });
		assert.equal(after.some((one) => one.id === id), false, '看过之后不该再出现');

		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('updatedBy 与其它条件 AND', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-upd-search2-'));
		const tb = createTaskboard({ dataDir: dir, now: () => 4_000 });
		tb.templates().register(makeTemplate('t-work', 'work'));
		const ws = (await tb.createWorkspace('搜AND')).workspace.id;

		const created = await tb.create({ workspaceId: ws, templateRef: 't-work', title: '搜AND' });
		assert.ok(created.ok);
		const id = created.card.id;
		await tb.adopt(ws, id, 'user');
		await tb.update(ws, id, { note: 'AI 改的' }, 'ai');

		assert.ok(tb.search(ws, { title: '搜AND', updatedBy: ['ai'] }).some((one) => one.id === id));
		assert.equal(
			tb.search(ws, { title: '完全不存在的标题', updatedBy: ['ai'] }).some((one) => one.id === id),
			false,
		);

		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe('markSeen 触发 bus 广播', () => {
	it('清掉标记时 emit（另一个窗格要更新角标）', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-unread-bus-'));
		const bus = createBus();
		const tb = createTaskboard({ dataDir: dir, now: () => 5_000, bus });
		tb.templates().register(makeTemplate('t-work', 'work'));
		const ws = (await tb.createWorkspace('广播')).workspace.id;

		const created = await tb.create({ workspaceId: ws, templateRef: 't-work', title: '广播' });
		assert.ok(created.ok);
		const id = created.card.id;
		await tb.update(ws, id, { note: 'AI 改的' }, 'ai');

		const messages: TaskboardMessage[] = [];
		const off = bus.on((m) => messages.push(m));

		const seen = await tb.markSeen(ws, id, 'user');
		off();

		assert.ok(seen.ok);
		assert.equal(messages.length, 1, 'markSeen 有变化 ⇒ 走 persist ⇒ 广播一条');
		assert.equal(messages[0]?.type, 'card:written');
		assert.equal(messages[0]?.cards[0]?.id, id);
		assert.equal(messages[0]?.cards[0]?.unread.ai, false, '消息里的卡是清完之后的');

		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('没有变化时不广播（重复标记已读不该产生事件）', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-unread-bus2-'));
		const bus = createBus();
		const tb = createTaskboard({ dataDir: dir, now: () => 6_000, bus });
		tb.templates().register(makeTemplate('t-work', 'work'));
		const ws = (await tb.createWorkspace('广播2')).workspace.id;

		const created = await tb.create({ workspaceId: ws, templateRef: 't-work', title: '广播2' });
		assert.ok(created.ok);
		const id = created.card.id;
		/* 只有 user 改过 ⇒ unread.ai 已经是 false。 */
		await tb.markSeen(ws, id, 'user');

		const messages: TaskboardMessage[] = [];
		const off = bus.on((m) => messages.push(m));
		await tb.markSeen(ws, id, 'user');
		off();

		assert.equal(messages.length, 0, '无变化 ⇒ 不广播');

		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});
});
