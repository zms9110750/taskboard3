/**
 * 完结态的卡 ⇒ **内容不可再改**（用户 `2026-11-23`）。
 *
 * > 「还有一个权限设置。处于完结态的卡，action 内容不可再改变。在 core 里面设置。
 * >   并对 tool 和 dsh 指令这两处调用打错误原因」
 *
 * ## 这条测试钉的是「边界」，不是「行为看着对」
 *
 * | 操作 | 完结态下 | 为什么 |
 * |---|---|---|
 * | `replaceContentAt`（按路径改内容） | **拒**（`CARD_ENDED_IMMUTABLE`） | 这就是「action 内容」 |
 * | `update({ content })` | **拒**（同一码） | 同上，只是整体替换语义 |
 * | `update({ note })` | 放行 | 备注不是 action 内容 |
 * | `update({ title })` | **core 放行** | 标题规则在工具层（只在草稿期可改），不在这条规则里 |
 * | `transition` | 不受影响 | 用户没说冻结状态机；完结态的转移由状态机自己判 |
 *
 * 「完结态」= `status.ts` 的 `ended` 组 = 成功 / 失败 / 取消 / 拒绝
 * （用户 `2026-11-01 06:55`：「"完成"，是一个状态组。包括成功，失败，取消，拒绝。」）
 *
 * ## 为什么拒绝理由必须带 id + 状态
 *
 * 「打错误原因」是为了让调用方能决定下一步。只说「不允许修改」时，
 * AI 只能重试或放弃；带上「哪张卡 / 哪个状态」，它才能判断该换卡还是先转移。
 * ⇒ 下面逐条断言 `message` 里同时含 **卡 id** 和 **状态中文名**。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ErrorCode, TaskState } from '@taskboard/protocol';
import type { Failure } from '@taskboard/protocol';

import { isEndedCard } from '../src/card.ts';
import { makeBoard, makeCard, makeTemplate, textSection } from './support-v2.ts';

/** 一个章节的模板（内容改得动的最小载体）。 */
function templateOf(ref: string): ReturnType<typeof makeTemplate> {
	return makeTemplate({
		ref,
		/* 用内置 kind：`makeTemplate` 默认 kind 为空，建卡会报「类别未注册」。 */
		kind: 'work',
		sections: [textSection('body', '正文')],
	});
}

/** 把卡推进到 `to`，断言成功。 */
async function mustTransition(
	tb: Awaited<ReturnType<typeof makeBoard>>['tb'],
	ws: string,
	cardId: string,
	to: string,
): Promise<void> {
	const moved = await tb.transition(ws, cardId, to as never, 'button');
	if (!moved.ok) throw new Error(`转移失败：${moved.code} ${moved.message}`);
}

describe('完结态：action 内容不可再改', () => {
	it('replaceContentAt 在完结态被拒，理由含卡 id + 状态', async () => {
		const { tb, ws } = await makeBoard([templateOf('imm-1')]);
		const id = await makeCard(tb, ws, 'imm-1', '会被冻结的卡');
		await mustTransition(tb, ws, id, TaskState.SUBMITTED);
		await mustTransition(tb, ws, id, TaskState.COMPLETED);

		const changed = await tb.replaceContentAt(ws, id, '/body/value', '改不动');
		assert.equal(changed.ok, false);
		if (changed.ok) return;
		assert.equal(changed.code, ErrorCode.CARD_ENDED_IMMUTABLE);
		assert.ok(changed.message.includes(id), `理由要带卡 id，实际：${changed.message}`);
		assert.ok(changed.message.includes('成功'), `理由要带状态中文名，实际：${changed.message}`);
	});

	it('update({ content }) 在完结态被拒（同一码）', async () => {
		const { tb, ws } = await makeBoard([templateOf('imm-2')]);
		const id = await makeCard(tb, ws, 'imm-2', '整体替换也不行');
		await mustTransition(tb, ws, id, TaskState.SUBMITTED);
		await mustTransition(tb, ws, id, TaskState.FAILED);

		const changed = await tb.update(ws, id, { content: { body: { $type: 'text', value: '新' } } });
		assert.equal(changed.ok, false);
		if (changed.ok) return;
		assert.equal(changed.code, ErrorCode.CARD_ENDED_IMMUTABLE);
		assert.ok(changed.message.includes(id));
		assert.ok(changed.message.includes('失败'), `理由要带「失败」，实际：${changed.message}`);
	});

	it('四个完结态全部被拒（成功 / 失败 / 取消 / 拒绝）', async () => {
		const { tb, ws } = await makeBoard([templateOf('imm-3')]);
		for (const endedState of [TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELED, TaskState.REJECTED]) {
			const id = await makeCard(tb, ws, 'imm-3', `卡-${endedState}`);
			await mustTransition(tb, ws, id, TaskState.SUBMITTED);
			await mustTransition(tb, ws, id, endedState);

			const changed = await tb.replaceContentAt(ws, id, '/body/value', '不许改');
			assert.equal(changed.ok, false, `${endedState} 应该被拒`);
			if (!changed.ok) assert.equal(changed.code, ErrorCode.CARD_ENDED_IMMUTABLE);
		}
	});

	it('非完结态照常能改（草稿 / 提交 / 处理中）', async () => {
		const { tb, ws } = await makeBoard([templateOf('imm-4')]);

		/* 草稿 */
		const draft = await makeCard(tb, ws, 'imm-4', '草稿卡');
		assert.equal((await tb.replaceContentAt(ws, draft, '/body/value', '草稿可改')).ok, true);

		/* 提交 + 处理中 */
		const active = await makeCard(tb, ws, 'imm-4', '进行中卡');
		await mustTransition(tb, ws, active, TaskState.SUBMITTED);
		assert.equal((await tb.replaceContentAt(ws, active, '/body/value', '提交可改')).ok, true);
		await mustTransition(tb, ws, active, TaskState.WORKING);
		assert.equal((await tb.replaceContentAt(ws, active, '/body/value', '处理中可改')).ok, true);

		/*
		 * 「搁置」两个状态（需要信息 / 需要授权）在这里不测：
		 * 它们由 `ask` 动作进入（AI 向用户提问），不是 `transition` 能到达的
		 * （`/taskboard` 的按钮表里没有「提交 → 需要信息」这条）。
		 * 它们的「非完结」由下面那条 `isEndedCard` 分组一致性测试覆盖。
		 */
	});

	it('备注不受完结态限制（备注不是 action 内容）', async () => {
		const { tb, ws } = await makeBoard([templateOf('imm-5')]);
		const id = await makeCard(tb, ws, 'imm-5', '完结了但备注能改');
		await mustTransition(tb, ws, id, TaskState.SUBMITTED);
		await mustTransition(tb, ws, id, TaskState.COMPLETED);

		const noted = await tb.update(ws, id, { note: '完结之后补一条备注' });
		assert.equal(noted.ok, true, noted.ok ? '' : `${noted.code} ${noted.message}`);
		if (noted.ok) assert.equal(noted.card.note, '完结之后补一条备注');
	});

	it('只改标题不被这条规则拦（标题规则在工具层，不在这里）', async () => {
		const { tb, ws } = await makeBoard([templateOf('imm-6')]);
		const id = await makeCard(tb, ws, 'imm-6', '原标题');
		await mustTransition(tb, ws, id, TaskState.SUBMITTED);
		await mustTransition(tb, ws, id, TaskState.COMPLETED);

		/*
		 * ⚠ 这里断言的是**边界**，不是「应该允许」：
		 *   标题的限制由工具层 `update-note.ts` 实现（「只有草稿期可以改标题」），
		 *   core 的 `update` 不认识那条规则。如果将来要把它移进 core，
		 *   这条测试会红 —— 那正是提醒「别忘了完结态那条」的时机。
		 */
		const renamed = await tb.update(ws, id, { title: '新标题' });
		assert.equal(renamed.ok, true, renamed.ok ? '' : `${renamed.code} ${renamed.message}`);
	});

	it('完结态判定与 protocol 的 ended 组一致', async () => {
		const { tb, ws } = await makeBoard([templateOf('imm-7')]);
		const id = await makeCard(tb, ws, 'imm-7', '判定一致性');
		await mustTransition(tb, ws, id, TaskState.SUBMITTED);
		const before = tb.get(ws, id);
		assert.equal(before.ok, true);
		if (!before.ok) return;
		assert.equal(isEndedCard(before.card), false, '提交态不是完结态');

		await mustTransition(tb, ws, id, TaskState.REJECTED);
		const after = tb.get(ws, id);
		assert.equal(after.ok, true);
		if (!after.ok) return;
		assert.equal(isEndedCard(after.card), true, '拒绝态是完结态');
	});

	it('被拒时卡的内容一个字都没变（不是「先改后拒」）', async () => {
		const { tb, ws } = await makeBoard([templateOf('imm-8')]);
		const id = await makeCard(tb, ws, 'imm-8', '内容不能被悄悄改掉');
		assert.equal((await tb.replaceContentAt(ws, id, '/body/value', '定稿内容')).ok, true);
		await mustTransition(tb, ws, id, TaskState.SUBMITTED);
		await mustTransition(tb, ws, id, TaskState.COMPLETED);

		const rejected = (await tb.replaceContentAt(ws, id, '/body/value', '想偷改')) as Failure;
		assert.equal(rejected.ok, false);

		const read = tb.get(ws, id);
		assert.equal(read.ok, true);
		if (!read.ok) return;
		const body = read.card.sections['body'];
		assert.ok(body !== undefined, '章节还在');
		assert.deepEqual(body.payload, { $type: 'text', value: '定稿内容' }, '内容仍是定稿那一份');
	});
});
