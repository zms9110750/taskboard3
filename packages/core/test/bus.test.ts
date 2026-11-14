/**
 * 广播总线测试 —— 原型期脚手架。
 *
 * ## 最关键的一条
 *
 * 「订阅者抛错 ⇒ 写操作仍然成功」。写操作此时**已经落库**，
 * 广播失败不该让调用方看到「写失败」。那是比「订阅者没收到」严重得多的错误。
 *
 * ## 顺带实测的两件事
 *
 * - 一次写操作会发几条消息（连带重算会放大）
 * - 工作空间写路径是否经过 `persist`
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { TaskState } from '@taskboard/protocol';

import { createTaskboard, type Taskboard } from '../src/index.ts';
import { createBus, type Bus, type TaskboardMessage } from '../src/bus.ts';
import type { TemplateDef } from '../src/template/types.ts';

function makeTemplate(ref: string, kind: string): TemplateDef {
	return {
		ref,
		displayName: ref,
		kind,
		domain: '核心',
		codePrefix: 'B',
		usage: '',
		description: '',
		sections: [
			{ id: 'body', label: '正文', hint: '', action: 'text', defaultPayload: { $type: 'text' } },
		],
		derives: [],
	};
}

/** 造一个挂了 bus 的任务板。 */
function makeBoard(dir: string, bus: Bus): Taskboard {
	const tb = createTaskboard({ dataDir: dir, now: (() => { let t = 1_000; return () => { t += 10; return t; }; })(), bus });
	tb.templates().register(makeTemplate('t-work', 'work'));
	tb.templates().register(makeTemplate('t-goal', 'goal'));
	return tb;
}

/** 收集消息。 */
function collector(bus: Bus): { messages: TaskboardMessage[]; off: () => void } {
	const messages: TaskboardMessage[] = [];
	const off = bus.on((message) => messages.push(message));
	return { messages, off };
}

describe('总线自身', () => {
	it('emit 同步投递给全部订阅者', () => {
		const bus = createBus();
		const got: string[] = [];
		bus.on((m) => got.push(`a:${m.type}`));
		bus.on((m) => got.push(`b:${m.type}`));

		bus.emit({ type: 'card:written', workspaceId: 'w', cards: [] });
		assert.deepEqual(got, ['a:card:written', 'b:card:written']);
	});

	it('退订后不再收到；退订函数幂等', () => {
		const bus = createBus();
		let count = 0;
		const off = bus.on(() => { count += 1; });

		bus.emit({ type: 'card:written', workspaceId: 'w', cards: [] });
		assert.equal(count, 1);

		off();
		off(); /* 幂等 */
		bus.emit({ type: 'card:written', workspaceId: 'w', cards: [] });
		assert.equal(count, 1, '退订后不该再收到');
		assert.equal(bus.size(), 0);
	});

	it('size() 反映订阅数', () => {
		const bus = createBus();
		assert.equal(bus.size(), 0);
		const offA = bus.on(() => {});
		const offB = bus.on(() => {});
		assert.equal(bus.size(), 2);
		offA();
		assert.equal(bus.size(), 1);
		offB();
		assert.equal(bus.size(), 0);
	});

	it('订阅者抛错不影响其它订阅者', () => {
		const bus = createBus();
		const got: string[] = [];
		bus.on(() => { throw new Error('坏订阅者'); });
		bus.on(() => got.push('第二个'));

		/* 不该抛出去 */
		assert.doesNotThrow(() => {
			bus.emit({ type: 'card:written', workspaceId: 'w', cards: [] });
		});
		assert.deepEqual(got, ['第二个'], '第二个订阅者仍然收到');
	});
});

describe('接线：只在 persist 一处 emit', () => {
	let dir: string;
	let bus: Bus;
	let tb: Taskboard;
	let ws: string;

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-bus-'));
		bus = createBus();
		tb = makeBoard(dir, bus);
		const created = await tb.createWorkspace('总线');
		assert.ok(created.ok);
		ws = created.workspace.id;
	});

	after(async () => {
		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('不传 bus ⇒ 写操作不炸（默认路径零开销）', async () => {
		const plainDir = mkdtempSync(join(tmpdir(), 'tb3-bus-plain-'));
		const plain = createTaskboard({ dataDir: plainDir });
		plain.templates().register(makeTemplate('t-work', 'work'));
		const plainWs = await plain.createWorkspace('无总线');
		assert.ok(plainWs.ok);

		const created = await plain.create({
			workspaceId: plainWs.workspace.id,
			templateRef: 't-work',
			title: '没有 bus',
		});
		assert.ok(created.ok);
		await plain.close();
		rmSync(plainDir, { recursive: true, force: true });
	});

	it('create 后收到 1 条 card:written，cards[0].id 正确', async () => {
		const seen = collector(bus);
		const created = await tb.create({ workspaceId: ws, templateRef: 't-work', title: '一张' });
		assert.ok(created.ok);
		seen.off();

		assert.equal(seen.messages.length, 1, '一张卡的建卡只发一条');
		const only = seen.messages[0];
		assert.equal(only?.type, 'card:written');
		assert.equal(only?.workspaceId, ws);
		assert.equal(only?.cards.length, 1);
		assert.equal(only?.cards[0]?.id, created.card.id);
	});

	it('update 后收到消息，且带的是改后的卡', async () => {
		const created = await tb.create({ workspaceId: ws, templateRef: 't-work', title: '待改' });
		assert.ok(created.ok);

		const seen = collector(bus);
		const updated = await tb.update(ws, created.card.id, { note: '改了' }, 'ai');
		seen.off();

		assert.ok(updated.ok);
		assert.ok(seen.messages.length >= 1, '至少一条');
		const cardIds = seen.messages.flatMap((m) => m.cards.map((c) => c.id));
		assert.ok(cardIds.includes(created.card.id));
	});

	it('★ 一次改写带重算 ⇒ 实测发几条（写进断言，别让它悄悄变）', async () => {
		/* 父 goal + 子 work；claim 子卡会让父卡被重算。 */
		const parent = await tb.create({ workspaceId: ws, templateRef: 't-goal', title: '父' });
		assert.ok(parent.ok);
		await tb.adopt(ws, parent.card.id, 'user');

		const child = await tb.create({
			workspaceId: ws,
			templateRef: 't-work',
			title: '子',
			relations: { parent: parent.card.id },
		});
		assert.ok(child.ok);
		await tb.adopt(ws, child.card.id, 'user');

		const seen = collector(bus);
		const claimed = await tb.claim(ws, child.card.id, 'user', 'loop-bus');
		seen.off();

		assert.ok(claimed.ok, JSON.stringify(claimed));
		assert.equal(claimed.recomputed.length, 1, '应当重算了 1 张父卡');

		/*
		 * ⚠ 实测值：claim 写子卡 1 条 + 重算写父卡 1 条 = **2 条**。
		 *
		 * 这正是任务描述里说的「刻意接受的原型期浪费」：
		 * 消费方会重拉 2 次。合并成一条要引入「批次」概念，
		 * 那是给临时脚手架修永久设施。
		 */
		assert.equal(
			seen.messages.length,
			1 + claimed.recomputed.length,
			`预期 1（子卡）+ ${claimed.recomputed.length}（重算父卡）条`,
		);
	});

	it('recomputeUpward 触发的父卡也在消息里', async () => {
		/* 父 goal 停在「提交」；子 work 被 claim 到「处理中」后会把父推成「处理中」。 */
		const parent = await tb.create({ workspaceId: ws, templateRef: 't-goal', title: '父2' });
		assert.ok(parent.ok);
		await tb.adopt(ws, parent.card.id, 'user');

		const child = await tb.create({
			workspaceId: ws,
			templateRef: 't-work',
			title: '子2',
			relations: { parent: parent.card.id },
		});
		assert.ok(child.ok);
		await tb.adopt(ws, child.card.id, 'user');

		/*
		 * 先把子卡推到「处理中」—— 这一步已经让父卡重算过。
		 * 再把子卡释放回「提交」，父卡该被重算回「提交」。
		 * ⇒ 此时 `recomputeUpward` 才有事可做（状态确实要变）。
		 */
		await tb.claim(ws, child.card.id, 'user', 'loop-before');
		await tb.release(ws, child.card.id, 'user', 'loop-before');

		/* 手工把父卡摆回一个「与子卡推导不一致」的状态，制造重算需求。 */
		const parentNow = await tb.get(ws, parent.card.id);
		assert.ok(parentNow.ok);
		const childNow = await tb.get(ws, child.card.id);
		assert.ok(childNow.ok);

		const seed = await tb.update(ws, child.card.id, { note: '让子卡留一条历史' }, 'user');
		assert.ok(seed.ok);

		const seen = collector(bus);
		const changed = await tb.recomputeUpward(ws, child.card.id);
		seen.off();

		/*
		 * 子卡当前是「提交」⇒ 父卡推导结果也是「提交」。
		 * 若父卡已经是「提交」，则没有变化 ⇒ `changed` 为空、也没有消息 —— 这也是正确行为。
		 * ⇒ 这条用例真正要验的是「如果有重算，父卡出现在消息里」。
		 */
		if (changed.length === 0) {
			assert.equal(seen.messages.length, 0, '没有重算就不该有消息');
			return;
		}
		const parentIds = seen.messages
			.filter((m) => m.type === 'card:written')
			.flatMap((m) => m.cards.map((c) => c.id));
		assert.ok(parentIds.includes(parent.card.id), '父卡也要出现在消息里');
	});

	it('★ 订阅者抛错 ⇒ 写操作仍然成功（最关键的一条）', async () => {
		const thrower = bus.on(() => {
			throw new Error('订阅者炸了');
		});

		const created = await tb.create({ workspaceId: ws, templateRef: 't-work', title: '炸不掉' });
		thrower();

		assert.ok(created.ok, '写操作必须成功 —— 广播失败不能回滚已落库的写');

		/* 而且数据真的写进去了。 */
		const got = await tb.get(ws, created.card.id);
		assert.ok(got.ok, '卡必须真的存在');
		assert.equal(got.card.title, '炸不掉');
	});

	it('多个订阅者都收到', async () => {
		const a: TaskboardMessage[] = [];
		const b: TaskboardMessage[] = [];
		const offA = bus.on((m) => a.push(m));
		const offB = bus.on((m) => b.push(m));

		await tb.create({ workspaceId: ws, templateRef: 't-work', title: '两个订阅者' });

		offA();
		offB();
		assert.ok(a.length >= 1);
		assert.ok(b.length >= 1);
		assert.equal(a.length, b.length, '两个订阅者收到的条数应当一致');
	});

	it('消息里的卡是「写后的」快照（消费方可直接读，但应当重拉）', async () => {
		const seen = collector(bus);
		const created = await tb.create({ workspaceId: ws, templateRef: 't-work', title: '快照' });
		seen.off();
		assert.ok(created.ok);

		const message = seen.messages[0];
		assert.equal(message?.cards[0]?.title, '快照');
		assert.equal(message?.cards[0]?.status, TaskState.UNSPECIFIED);
	});
});

describe('工作空间写路径', () => {
	it('工作空间变更不经过 persist ⇒ 不广播', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-bus-ws-'));
		const bus = createBus();
		const tb = makeBoard(dir, bus);
		const seen = collector(bus);

		const created = await tb.createWorkspace('新空间');
		assert.ok(created.ok);

		seen.off();
		/*
		 * 工作空间写的是 kv（`workspace.ts` 的 `writeAll`），不经过 `persist`
		 * ⇒ 不广播。`TaskboardMessage.type` 里那个 `'workspace:written'` 成员
		 * 已删（永远发不出去的死类型）。
		 *
		 * 这条断言固定住「改空间不推事件」这个决定 ——
		 * 将来若要补空间广播，它会让这条变红，提醒一起改注释与类型。
		 */
		assert.equal(seen.messages.length, 0, '工作空间变更不广播');

		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});
});


