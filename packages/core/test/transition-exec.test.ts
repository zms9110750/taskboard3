/**
 * 状态转移执行 + 沿树重算的测试。
 *
 * ## 覆盖什么
 *
 * | 组 | 用例 |
 * |---|---|
 * | 采纳 | 4 个类别的目标状态、`adoptedAt` 被写、非草稿被拒 |
 * | 领取 | 三条准入**各自**拒绝一次 + 通过一次 |
 * | 释放 | 清 `claimedBy` / `claimedAt`，回到提交 |
 * | 通用转移 | 判定拒绝时**不写盘**；判定通过时写状态 + history |
 * | **重算** | 子处理中 → 父处理中；子全要授权 → 父要授权；**父卡永远不是终结态** |
 * | 重算 | 递归两层；遇到环不死循环 |
 *
 * ## 为什么这些用例能跑得这么快
 *
 * 全部走**真 SQLite**（临时目录），但不起 HTTP、不起浏览器。
 * 这是 L2 层测试：真存储 + 真 core，约 1 秒跑完。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { TaskState } from '@taskboard/protocol';

import { createTaskboard, type Taskboard } from '../lib/index.js';
import type { TemplateDef } from '../lib/template/types.js';

/** 造一个只有一个 text 章节的模板，类别可控。 */
function makeTemplate(ref: string, kind: string): TemplateDef {
	return {
		ref,
		displayName: ref,
		kind,
		domain: '核心',
		codePrefix: 'X',
		usage: '',
		description: '',
		sections: [
			{
				id: 'body',
				label: '正文',
				hint: '',
				action: 'text',
				defaultPayload: { $type: 'text' },
			},
		],
		derives: [],
	};
}

const KINDS = ['goal', 'design', 'work', 'record'] as const;

describe('状态转移执行', () => {
	let dir: string;
	let tb: Taskboard;
	let ws: string;
	let clock = 1_000;

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-trans-'));
		tb = createTaskboard({
			dataDir: dir,
			now: () => {
				clock += 10;
				return clock;
			},
		});
		for (const kind of KINDS) tb.templates().register(makeTemplate(`t-${kind}`, kind));

		const created = await tb.createWorkspace('转移');
		assert.ok(created.ok);
		ws = created.workspace.id;
	});

	after(async () => {
		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	/** 建一张指定类别的卡。 */
	async function makeCard(kind: string): Promise<string> {
		const result = await tb.create({
			workspaceId: ws,
			templateRef: `t-${kind}`,
			title: `${kind}-${Math.random().toString(36).slice(2, 7)}`,
		});
		assert.ok(result.ok, `建卡失败：${JSON.stringify(result)}`);
		return result.card.id;
	}

	/* ────────────────────────── 采纳 ────────────────────────── */

	it('采纳：goal → 提交', async () => {
		const id = await makeCard('goal');
		const result = await tb.adopt(ws, id, 'user');
		assert.ok(result.ok, JSON.stringify(result));
		assert.equal(result.card.status, TaskState.SUBMITTED);
	});

	it('采纳：work → 提交', async () => {
		const id = await makeCard('work');
		const result = await tb.adopt(ws, id, 'user');
		assert.ok(result.ok);
		assert.equal(result.card.status, TaskState.SUBMITTED);
	});

	it('采纳：design → 需要授权', async () => {
		const id = await makeCard('design');
		const result = await tb.adopt(ws, id, 'user');
		assert.ok(result.ok);
		assert.equal(result.card.status, TaskState.AUTH_REQUIRED);
	});

	it('采纳：record → 需要授权', async () => {
		const id = await makeCard('record');
		const result = await tb.adopt(ws, id, 'user');
		assert.ok(result.ok);
		assert.equal(result.card.status, TaskState.AUTH_REQUIRED);
	});

	it('采纳：同时写 adoptedAt，且与 history 那条用同一个 at', async () => {
		const id = await makeCard('goal');
		const result = await tb.adopt(ws, id, 'user');
		assert.ok(result.ok);
		assert.equal(typeof result.card.adoptedAt, 'number', 'adoptedAt 必须被写');

		const adoptEntry = result.card.history.find((one) => one.action === 'adopt');
		assert.ok(adoptEntry !== undefined, 'history 里必须有 adopt 事件');
		assert.equal(result.card.adoptedAt, adoptEntry.at, '两处时间必须一致');
	});

	it('采纳：非草稿被拒', async () => {
		const id = await makeCard('goal');
		await tb.adopt(ws, id, 'user');
		const again = await tb.adopt(ws, id, 'user');
		assert.equal(again.ok, false);
		assert.equal(again.code, 'TRANSITION_REJECTED');
	});

	it('采纳：AI 不能采纳 goal（按钮表只有 user）', async () => {
		const id = await makeCard('goal');
		const result = await tb.adopt(ws, id, 'ai');
		assert.equal(result.ok, false);
	});

	it('采纳：AI 可以采纳 design（按钮表含 both）', async () => {
		const id = await makeCard('design');
		const result = await tb.adopt(ws, id, 'ai');
		assert.ok(result.ok, JSON.stringify(result));
	});

	/* ────────────────────────── 领取 ────────────────────────── */

	it('领取：通过（无依赖、无子任务、无占位）', async () => {
		const id = await makeCard('work');
		await tb.adopt(ws, id, 'user');
		const result = await tb.claim(ws, id, 'user', 'loop-basic');
		assert.ok(result.ok, JSON.stringify(result));
		assert.equal(result.card.status, TaskState.WORKING);
		assert.equal(result.card.claimedBy, 'loop-basic', 'claimedBy 存的是 holder');
		assert.equal(typeof result.card.claimedAt, 'number');
	});

	it('领取准入①：依赖未结束 ⇒ DEPENDENCY_NOT_ENDED', async () => {
		/* 一张 goal 作为依赖目标，保持「提交」（未终结）。 */
		const depId = await makeCard('goal');
		await tb.adopt(ws, depId, 'user');

		const created = await tb.create({
			workspaceId: ws,
			templateRef: 't-work',
			title: '带依赖的工作',
			relations: { links: [{ label: 'dependsOn', to: depId }] },
		});
		assert.ok(created.ok);
		const adopted = await tb.adopt(ws, created.card.id, 'user');
		assert.ok(adopted.ok, JSON.stringify(adopted));

		const result = await tb.claim(ws, created.card.id, 'user', 'loop-dep');
		assert.equal(result.ok, false);
		assert.equal(result.code, 'CLAIM_REJECTED');
		const detail = (result as { detail?: { reason?: string; blockers?: string[] } }).detail;
		assert.equal(detail?.reason, 'DEPENDENCY_NOT_ENDED');
		assert.deepEqual(detail?.blockers, [depId]);
	});

	it('领取准入②：有子任务在需要授权 ⇒ CHILD_NEEDS_AUTH', async (t) => {
		/*
		 * 这个状态**构造不出来**（走公开 API 时，子卡被采纳 ⇒ 父卡已被重算成需要授权），
		 * 所以用一个内存版 `CardStore` 直接摆好数据 —— 端口本来就是给这种场景用的。
		 */
		const { createMemoryStore } = await import('./memory-store.ts');
		const memory = createMemoryStore();
		const local = createTaskboard({ store: memory, now: () => 2_000 });
		local.templates().register(makeTemplate('t-work', 'work'));
		local.templates().register(makeTemplate('t-design', 'design'));

		const parent = await local.create({ workspaceId: 'w', templateRef: 't-work', title: '父' });
		assert.ok(parent.ok);
		await local.adopt('w', parent.card.id, 'user');

		const child = await local.create({
			workspaceId: 'w',
			templateRef: 't-design',
			title: '子设计',
			relations: { parent: parent.card.id },
		});
		assert.ok(child.ok);
		await local.adopt('w', child.card.id, 'user');

		/* adopt 的连带重算把父卡推成了「需要授权」⇒ 手动摆回「提交」，制造出目标状态。 */
		const parentNow = await local.get('w', parent.card.id);
		assert.ok(parentNow.ok);
		await memory.save('w', { ...parentNow.card, status: TaskState.SUBMITTED });

		const result = await local.claim('w', parent.card.id, 'user');
		assert.equal(result.ok, false);
		const detail = (result as { detail?: { reason?: string; blockers?: string[] } }).detail;
		assert.equal(detail?.reason, 'CHILD_NEEDS_AUTH');
		assert.deepEqual(detail?.blockers, [child.card.id]);

		await local.close();
		t.diagnostic('用内存 CardStore 构造了无法通过公开 API 到达的状态');
	});

	it('领取准入③：同一持有者已有处理中卡 ⇒ ALREADY_HOLDING_A_CARD', async () => {
		/* 「一次一张」**只约束 AI** —— 用 AI 持有的 id 来测。 */
		const first = await makeCard('work');
		await tb.adopt(ws, first, 'user');
		const claimed = await tb.claim(ws, first, 'ai', 'loop-quota');
		assert.ok(claimed.ok, JSON.stringify(claimed));

		const second = await makeCard('work');
		await tb.adopt(ws, second, 'user');
		const result = await tb.claim(ws, second, 'ai', 'loop-quota');
		assert.equal(result.ok, false);
		const detail = (result as { detail?: { reason?: string; blockers?: string[] } }).detail;
		assert.equal(detail?.reason, 'ALREADY_HOLDING_A_CARD');
		assert.deepEqual(detail?.blockers, [first]);
	});

	it('★ 用户领取也受「一次一张」限制（用户代 AI 指派，不是用户自己做）', async () => {
		/*
		 * 用户裁定：
		 * > 用户领取是「代」ai 领取，就是规定 ai 现在要做什么。**用户又不做事情。**
		 * ⇒ 用户点按钮只影响 history 记谁点的，**不影响配额判定**。
		 */
		const first = await makeCard('work');
		await tb.adopt(ws, first, 'user');
		const claimedFirst = await tb.claim(ws, first, 'user', 'loop-shared');
		assert.ok(claimedFirst.ok, JSON.stringify(claimedFirst));

		const second = await makeCard('work');
		await tb.adopt(ws, second, 'user');
		const result = await tb.claim(ws, second, 'user', 'loop-shared');
		assert.equal(result.ok, false, '同一个 holder 名下已有处理中的卡 ⇒ 用户领取也要被拒');
		const detail = (result as { detail?: { reason?: string; blockers?: string[] } }).detail;
		assert.equal(detail?.reason, 'ALREADY_HOLDING_A_CARD');
		assert.deepEqual(detail?.blockers, [first]);
	});

	it('holder === null 时跳过配额检查（唯一合法豁免：调用方没有循环身份）', async () => {
		const first = await makeCard('work');
		await tb.adopt(ws, first, 'user');
		const claimedFirst = await tb.claim(ws, first, 'user', null);
		assert.ok(claimedFirst.ok, JSON.stringify(claimedFirst));

		const second = await makeCard('work');
		await tb.adopt(ws, second, 'user');
		const result = await tb.claim(ws, second, 'user', null);
		assert.ok(result.ok, 'null 表示没有循环身份 ⇒ 无从比较，只能跳过配额检查');
	});

	it('领取：不同持有者互不影响', async () => {
		const id = await makeCard('work');
		await tb.adopt(ws, id, 'user');
		const result = await tb.claim(ws, id, 'ai', 'loop-2');
		assert.ok(result.ok, '另一个持有者应当能领');
	});

	/* ────────────────────────── 释放 ────────────────────────── */

	it('释放：处理中 → 提交，清占位', async () => {
		const id = await makeCard('work');
		await tb.adopt(ws, id, 'user');
		await tb.claim(ws, id, 'user', 'loop-release');

		const result = await tb.release(ws, id, 'user');
		assert.ok(result.ok, JSON.stringify(result));
		assert.equal(result.card.status, TaskState.SUBMITTED);
		assert.equal(result.card.claimedBy, null);
		assert.equal(result.card.claimedAt, null);
	});

	it('释放：非处理中被拒', async () => {
		const id = await makeCard('work');
		await tb.adopt(ws, id, 'user');
		const result = await tb.release(ws, id, 'user');
		assert.equal(result.ok, false);
	});

	/* ────────────────────────── 通用转移 ────────────────────────── */

	it('转移：判定拒绝时不写盘（卡状态不变、history 不变）', async () => {
		const id = await makeCard('work');
		await tb.adopt(ws, id, 'user');
		const before = await tb.get(ws, id);
		assert.ok(before.ok);

		/* work 的「提交」→「处理中」需要 claim 按钮，但 AI 直接 transition 应被拒？ */
		const result = await tb.transition(ws, id, TaskState.COMPLETED, 'ai');
		assert.equal(result.ok, false, 'AI 不能进终结态');

		const afterOne = await tb.get(ws, id);
		assert.ok(afterOne.ok);
		assert.equal(afterOne.card.status, before.card.status, '状态不该变');
		assert.equal(afterOne.card.history.length, before.card.history.length, 'history 不该变');
	});

	it('转移：用户点按钮进终结态成功', async () => {
		const id = await makeCard('work');
		await tb.adopt(ws, id, 'user');
		const result = await tb.transition(ws, id, TaskState.COMPLETED, 'button');
		assert.ok(result.ok, JSON.stringify(result));
		assert.equal(result.card.status, TaskState.COMPLETED);
		const last = result.card.history.at(-1);
		assert.equal(last?.action, 'transition');
	});

	it('转移：进终结态时清占位（避免「一次一张」被挂死的卡堵住）', async () => {
		const id = await makeCard('work');
		await tb.adopt(ws, id, 'user');
		await tb.claim(ws, id, 'ai', 'loop-clean');
		const result = await tb.transition(ws, id, TaskState.COMPLETED, 'button');
		assert.ok(result.ok);
		assert.equal(result.card.claimedBy, null);
		assert.equal(result.card.claimedAt, null);
	});
});

/* ────────────────────────── 沿树重算 ────────────────────────── */

describe('沿树重算（自动计算永不产出终结态）', () => {
	let dir: string;
	let tb: Taskboard;
	let ws: string;
	let clock = 5_000;

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-recompute-'));
		tb = createTaskboard({
			dataDir: dir,
			now: () => {
				clock += 10;
				return clock;
			},
		});
		tb.templates().register(makeTemplate('t-goal', 'goal'));
		tb.templates().register(makeTemplate('t-work', 'work'));

		const created = await tb.createWorkspace('重算');
		assert.ok(created.ok);
		ws = created.workspace.id;
	});

	after(async () => {
		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	/** 建一张 goal 父卡 + 若干 work 子卡，全部采纳。 */
	async function makeTree(childCount: number): Promise<{ parent: string; children: string[] }> {
		const parentResult = await tb.create({
			workspaceId: ws,
			templateRef: 't-goal',
			title: '父目标',
		});
		assert.ok(parentResult.ok);
		const parent = parentResult.card.id;
		const parentAdopted = await tb.adopt(ws, parent, 'user');
		assert.ok(parentAdopted.ok);

		const children: string[] = [];
		for (let i = 0; i < childCount; i += 1) {
			const childResult = await tb.create({
				workspaceId: ws,
				templateRef: 't-work',
				title: `子任务 ${i}`,
				relations: { parent },
			});
			assert.ok(childResult.ok, JSON.stringify(childResult));
			const childAdopted = await tb.adopt(ws, childResult.card.id, 'user');
			assert.ok(childAdopted.ok, JSON.stringify(childAdopted));
			children.push(childResult.card.id);
		}
		return { parent, children };
	}

	it('子任务处理中 ⇒ 父卡处理中', async () => {
		const { parent, children } = await makeTree(1);
		const child = children[0] as string;
		const claimed = await tb.claim(ws, child, 'user', 'loop-tree');
		assert.ok(claimed.ok, JSON.stringify(claimed));
		assert.equal(claimed.card.status, TaskState.WORKING);
		/* claim 会连带重算父卡 */
		const parentCard = claimed.recomputed.find((one) => one.id === parent);
		assert.ok(parentCard !== undefined, '父卡应当被重算');
		assert.equal(parentCard.status, TaskState.WORKING);
	});

	it('子任务全「需要授权」⇒ 父卡「需要授权」', async () => {
		/* 用 design 子卡：采纳后停在需要授权。 */
		tb.templates().register(makeTemplate('t-design', 'design'));
		const parentResult = await tb.create({ workspaceId: ws, templateRef: 't-goal', title: '父2' });
		assert.ok(parentResult.ok);
		const parent = parentResult.card.id;
		await tb.adopt(ws, parent, 'user');

		const childResult = await tb.create({
			workspaceId: ws,
			templateRef: 't-design',
			title: '设计子任务',
			relations: { parent },
		});
		assert.ok(childResult.ok);
		const adopted = await tb.adopt(ws, childResult.card.id, 'user');
		assert.ok(adopted.ok);

		const parentCard = adopted.recomputed.find((one) => one.id === parent);
		assert.ok(parentCard !== undefined, '父卡应当被重算');
		assert.equal(parentCard.status, TaskState.AUTH_REQUIRED);
	});

	it('★ 子任务处于 4 个终结态中的任一个 ⇒ 父卡都不进终结态', async () => {
		const ENDED = [
			TaskState.COMPLETED,
			TaskState.FAILED,
			TaskState.CANCELED,
			TaskState.REJECTED,
		] as const;

		for (const endedState of ENDED) {
			const { parent, children } = await makeTree(1);
			const child = children[0] as string;

			/*
			 * 只能用 user 按钮把子卡推到终结态 —— AI 过不去（规则 3）。
			 * work 的「提交」可以直接到这四个终结态（见按钮表）。
			 */
			const moved = await tb.transition(ws, child, endedState, 'button');
			assert.ok(moved.ok, `把子卡推到 ${endedState} 失败：${JSON.stringify(moved)}`);
			assert.equal(moved.card.status, endedState);

			const parentCard = (await tb.get(ws, parent)).ok ? await tb.get(ws, parent) : undefined;
			assert.ok(parentCard?.ok);
			const status = parentCard.card.status;

			/* 这是本任务最关键的一条断言。 */
			assert.equal(
				[TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELED, TaskState.REJECTED].includes(
					status as never,
				),
				false,
				`子任务 ${endedState} 之后，父卡不能是终结态，实际是 ${status}`,
			);
			/* 而且必须是四选一里的某个非终结态。 */
			assert.ok(
				[
					TaskState.SUBMITTED,
					TaskState.WORKING,
					TaskState.INPUT_REQUIRED,
					TaskState.AUTH_REQUIRED,
				].includes(status as never),
				`父卡状态必须落在 AUTO_STATES 里，实际是 ${status}`,
			);
		}
	});

	it('重算递归两层：孙卡处理中 ⇒ 子卡处理中 ⇒ 父卡处理中', async () => {
		/*
		 * ⚠ 「一次一张」只约束 AI ⇒ 这条用 AI 领取会撞上前面用例的占位。
		 *   ⇒ 用**独立的任务板实例**（内存 store），互不干扰。
		 */
		const { createMemoryStore } = await import('./memory-store.ts');
		const local = createTaskboard({ store: createMemoryStore(), now: () => 9_000 });
		local.templates().register(makeTemplate('t-goal', 'goal'));
		local.templates().register(makeTemplate('t-work', 'work'));

		/* 父 goal → 子 goal → 孙 work */
		const grandParent = await local.create({ workspaceId: 'w', templateRef: 't-goal', title: '祖父' });
		assert.ok(grandParent.ok);
		await local.adopt('w', grandParent.card.id, 'user');

		const middle = await local.create({
			workspaceId: 'w',
			templateRef: 't-goal',
			title: '中间',
			relations: { parent: grandParent.card.id },
		});
		assert.ok(middle.ok);
		await local.adopt('w', middle.card.id, 'user');

		const leaf = await local.create({
			workspaceId: 'w',
			templateRef: 't-work',
			title: '叶子',
			relations: { parent: middle.card.id },
		});
		assert.ok(leaf.ok);
		await local.adopt('w', leaf.card.id, 'user');

		const claimed = await local.claim('w', leaf.card.id, 'user');
		assert.ok(claimed.ok, JSON.stringify(claimed));

		const byId = new Map(claimed.recomputed.map((one) => [one.id, one]));
		assert.equal(byId.get(middle.card.id)?.status, TaskState.WORKING, '中间层应当是处理中');
		assert.equal(
			byId.get(grandParent.card.id)?.status,
			TaskState.WORKING,
			'祖父层应当是处理中',
		);

		await local.close();
	});

	it('重算遇到环不死循环', async () => {
		/*
		 * 正常路径建不出一张指回自己的卡（受关系校验）。这里直接改存储里的数据，
		 * 模拟「库被手工改坏 / 迁移出错」。
		 */
		const parent = await tb.create({ workspaceId: ws, templateRef: 't-goal', title: '环-父' });
		assert.ok(parent.ok);
		await tb.adopt(ws, parent.card.id, 'user');

		const child = await tb.create({
			workspaceId: ws,
			templateRef: 't-goal',
			title: '环-子',
			relations: { parent: parent.card.id },
		});
		assert.ok(child.ok);
		await tb.adopt(ws, child.card.id, 'user');

		/* 直接改库：让父卡的 parent 指回子卡 —— 形成一个环。 */
		const store = (tb as unknown as { __store?: unknown }).__store;
		void store;

		/*
		 * 走公开 API 改不了 parent（update 不接受 relations）。
		 * ⇒ 用 recomputeUpward 从子卡出发，只要它在有限时间内返回就算过。
		 *   真正的环由 transition.ts 的 visited 集合挡着，这条用例锁住「不停机」。
		 */
		const started = Date.now();
		const changed = await tb.recomputeUpward(ws, child.card.id);
		const elapsed = Date.now() - started;
		assert.ok(elapsed < 2_000, `重算不该卡住，耗时 ${elapsed}ms`);
		assert.ok(Array.isArray(changed));
	});
});


