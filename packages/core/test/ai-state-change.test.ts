/**
 * 「角色为 ai 的改卡状态操作」总闸的测试。
 *
 * 用户 `2026-11-23`：
 * > 「core提供的后端里面有一个开关设置和权限。用指令和UI可以改这个开关。
 * >   然后会限制改卡状态的角色为ai的部分的操作。
 * >   然后在ai tool侧要返回对应的错误和提示。」
 * > 「改卡状态的角色，还有一个系统。目标这一类自动算出来的，改卡角色都是系统。」
 *
 * ## 这个开关拦的是**角色**，不是能力
 *
 * 关掉之后：
 * - `actor` / `trigger` 是 `ai` 的改卡状态操作 ⇒ 拒（`AI_STATE_CHANGE_DISABLED`）
 * - `user` 点按钮 ⇒ 照常
 * - `system` 自动重算 ⇒ 照常（它不是 AI 干的）
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ErrorCode, TaskState, isFailure, labelOf } from '@taskboard/protocol';
import type { Card, Taskboard } from '../src/index.ts';

import { makeBoard, makeCard, makeTemplate } from './support-v2.ts';

const TEMPLATES = [
	makeTemplate({ ref: 't-work', kind: 'work' }),
	makeTemplate({ ref: 't-goal', kind: 'goal' }),
	makeTemplate({ ref: 't-design', kind: 'design' }),
];

/** 把草稿推到「提交」（人点按钮 ⇒ `adopt(..., 'user')`）。 */
async function submit(tb: Taskboard, ws: string, id: string): Promise<void> {
	const adopted = await tb.adopt(ws, id, 'user');
	assert.equal(adopted.ok, true, adopted.ok ? '' : adopted.message);
}

/** 一条 history 里最后一个事件的作者。 */
function lastActor(card: Card): string {
	const history = card.history;
	assert.ok(history.length > 0, '卡片应当有 history');
	const last = history.at(-1);
	assert.ok(last !== undefined);
	return last.actor;
}

describe('总闸：角色为 ai 的改卡状态操作', () => {
	it('默认是**允许**（装上插件不该让 AI 一张卡都推不动）', async () => {
		const { tb } = await makeBoard(TEMPLATES);
		try {
			assert.equal(tb.getAiStateChangeAllowed(), true);
		} finally {
			await tb.close();
		}
	});

	it('关掉之后：AI 领取被拒，reason 带卡 id + 状态', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		try {
			const id = await makeCard(tb, ws, 't-work', '待领取');
			await submit(tb, ws, id);

			await tb.setAiStateChangeAllowed(false);

			const blocked = await tb.claim(ws, id, 'ai', 'loop-1');
			assert.equal(blocked.ok, false);
			if (!isFailure(blocked)) return;
			assert.equal(blocked.code, ErrorCode.AI_STATE_CHANGE_DISABLED);
			assert.equal(blocked.message.includes(id), true, '要能告诉 AI 是哪张卡');
			assert.equal(blocked.message.includes(labelOf(TaskState.SUBMITTED)), true, '要带当前状态的人话名');
			assert.deepEqual(blocked.detail, {
				cardId: id,
				status: TaskState.SUBMITTED,
				actor: 'ai',
				action: '领取',
				switch: 'aiStateChange',
			});
		} finally {
			await tb.close();
		}
	});

	it('关掉之后：AI 采纳被拒；**人点按钮照常**', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		try {
			const id = await makeCard(tb, ws, 't-work', '草稿');

			await tb.setAiStateChangeAllowed(false);

			const blocked = await tb.adopt(ws, id, 'ai');
			assert.equal(blocked.ok, false);
			if (isFailure(blocked)) assert.equal(blocked.code, ErrorCode.AI_STATE_CHANGE_DISABLED);

			/* 人点按钮不受影响 —— 这是「限制角色为 ai 的那部分」的本意。 */
			const byUser = await tb.adopt(ws, id, 'user');
			assert.equal(byUser.ok, true, byUser.ok ? '' : byUser.message);
			/* work 类的采纳目标是「提交」（goal 类才是「需要授权」）。 */
			if (byUser.ok) assert.equal(byUser.card.status, TaskState.SUBMITTED);
		} finally {
			await tb.close();
		}
	});

	it('关掉之后：AI 释放被拒；`user` 释放照常', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		try {
			const id = await makeCard(tb, ws, 't-work', '要释放的卡');
			await submit(tb, ws, id);

			const claimed = await tb.claim(ws, id, 'user', 'loop-r');
			assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.message);

			await tb.setAiStateChangeAllowed(false);

			const blocked = await tb.release(ws, id, 'ai', 'loop-r');
			assert.equal(blocked.ok, false);
			if (isFailure(blocked)) assert.equal(blocked.code, ErrorCode.AI_STATE_CHANGE_DISABLED);

			const byUser = await tb.release(ws, id, 'user', 'loop-r');
			assert.equal(byUser.ok, true, byUser.ok ? '' : byUser.message);
		} finally {
			await tb.close();
		}
	});

	it('关掉之后：`transition(trigger=ai)` 被拒；`trigger=button` 照常', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		try {
			const id = await makeCard(tb, ws, 't-work', '要推的卡');
			await submit(tb, ws, id);
			const claimed = await tb.claim(ws, id, 'user', 'loop-t');
			assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.message);

			await tb.setAiStateChangeAllowed(false);

			const blocked = await tb.transition(ws, id, TaskState.COMPLETED, 'ai');
			assert.equal(blocked.ok, false);
			if (isFailure(blocked)) {
				assert.equal(blocked.code, ErrorCode.AI_STATE_CHANGE_DISABLED);
				assert.equal(blocked.detail !== undefined, true);
			}

			/* 人点按钮：关掉总闸后仍然能进终结态（那条规则由状态机管，不由总闸管）。 */
			const byButton = await tb.transition(ws, id, TaskState.COMPLETED, 'button');
			assert.equal(byButton.ok, true, byButton.ok ? '' : byButton.message);
		} finally {
			await tb.close();
		}
	});

	it('★ 自动重算（`system`）不受总闸影响，且 history 作者是 `system`', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		try {
			/* goal 父卡 + 一张 work 子卡，都采纳到「需要授权」。 */
			const parentResult = await tb.create({ workspaceId: ws, templateRef: 't-goal', title: '父目标', actor: 'user' });
			assert.equal(parentResult.ok, true, parentResult.ok ? '' : parentResult.message);
			if (!parentResult.ok) return;
			const parent = parentResult.card.id;
			await submit(tb, ws, parent);

			const childResult = await tb.create({
				workspaceId: ws,
				templateRef: 't-work',
				title: '子任务',
				relations: { parent },
				actor: 'user',
			});
			assert.equal(childResult.ok, true, childResult.ok ? '' : childResult.message);
			if (!childResult.ok) return;
			const child = childResult.card.id;
			await submit(tb, ws, child);

			await tb.setAiStateChangeAllowed(false);

			/*
			 * 人领取子卡 ⇒ 子卡进「处理中」⇒ 父卡沿 parent 链自动重算。
			 * 重算的作者是 `system`，**不该被总闸拦住**（总闸只拦角色 ai）。
			 */
			const claimed = await tb.claim(ws, child, 'user', 'loop-sys');
			assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.message);

			const parentAfter = claimed.recomputed.find((one) => one.id === parent);
			assert.notEqual(parentAfter, undefined, '父卡应当被重算');
			if (parentAfter === undefined) return;
			assert.equal(parentAfter.status, TaskState.WORKING);

			/* ★ 用户 2026-11-23：「改卡角色都是系统」 */
			assert.equal(lastActor(parentAfter), 'system', '自动重算的作者必须是 system，不是 ai');
		} finally {
			await tb.close();
		}
	});

	it('开关落 kv：换一个新实例仍读得到（不是内存态）', async () => {
		const { createTaskboard } = await import('../src/index.ts');
		const { createMemoryStore } = await import('./memory-store.ts');

		const store = createMemoryStore();
		const first = createTaskboard({ store });
		try {
			for (const template of TEMPLATES) first.templates().register(template);
			await first.setAiStateChangeAllowed(false);
		} finally {
			await first.close();
		}

		/* ⚠ 内存 store 的 `close()` 不清数据（见 memory-store.ts 文件头），
		 *   所以「关掉再开」等价于「进程重启后从磁盘读」。 */
		const second = createTaskboard({ store });
		try {
			assert.equal(second.getAiStateChangeAllowed(), false, '应当从 kv 读回 false');
			await second.setAiStateChangeAllowed(true);
			assert.equal(second.getAiStateChangeAllowed(), true);
		} finally {
			await second.close();
		}
	});

	it('打开之后：AI 领取恢复', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		try {
			const id = await makeCard(tb, ws, 't-work', '恢复领取');
			await submit(tb, ws, id);

			await tb.setAiStateChangeAllowed(false);
			assert.equal((await tb.claim(ws, id, 'ai', 'loop-on')).ok, false);

			await tb.setAiStateChangeAllowed(true);
			const ok = await tb.claim(ws, id, 'ai', 'loop-on');
			assert.equal(ok.ok, true, ok.ok ? '' : ok.message);
		} finally {
			await tb.close();
		}
	});
});
