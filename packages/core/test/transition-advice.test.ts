/**
 * `Taskboard.transitionAdvice` 的测试（tool contract v2）。
 *
 * 用户要求：「目标字符串为空时，展示接下来可转移的目标和条件目标。」
 * ⇒ 这里钉住：目标清单、动作类型、AI 能不能做、条件不满足时的具体原因与卡死的卡。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskState } from '@taskboard/protocol';

import { makeBoard, makeCard, makeTemplate } from './support-v2.ts';

const TEMPLATES = [
	makeTemplate({ ref: 't-work', kind: 'work' }),
	makeTemplate({ ref: 't-goal', kind: 'goal' }),
	makeTemplate({ ref: 't-design', kind: 'design' }),
];

/** 把草稿推到「提交」（用户采纳路径 —— 用户点按钮）。 */
async function submit(tb: Awaited<ReturnType<typeof makeBoard>>['tb'], ws: string, id: string): Promise<void> {
	const adopted = await tb.adopt(ws, id, 'user');
	assert.equal(adopted.ok, true, adopted.ok ? '' : adopted.message);
}

describe('transitionAdvice', () => {
	it('草稿卡：采纳目标对 AI 可用（v2 把采纳并进 transition）', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const id = await makeCard(tb, ws, 't-work', '草稿');
		const advice = tb.transitionAdvice(ws, id, 'lead');
		assert.equal('ok' in advice && advice.ok === false, false);

		const targets = 'targets' in advice ? advice.targets : [];
		const adopt = targets.find((one) => one.action === 'adopt');
		assert.notEqual(adopt, undefined, JSON.stringify(targets));
		if (adopt !== undefined) {
			assert.equal(adopt.to, TaskState.SUBMITTED);
			assert.equal(adopt.label, '采纳');
			assert.equal(adopt.aiAllowed, true);
			assert.equal(adopt.available, true);
			assert.deepEqual(adopt.conditions, []);
		}

		/* 终结态目标对 AI 不可用（用户点按钮的那条通路）。 */
		const end = targets.find((one) => one.to === TaskState.CANCELED);
		assert.notEqual(end, undefined);
		if (end !== undefined) {
			assert.equal(end.aiAllowed, false);
			assert.equal(end.available, false);
			assert.equal(end.conditions[0]?.code, 'USER_ONLY');
		}
	});

	it('设计的采纳目标是「需要授权」，且对 AI 可用', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const id = await makeCard(tb, ws, 't-design', '设计草稿');
		const advice = tb.transitionAdvice(ws, id, 'lead');
		const adopt = 'targets' in advice ? advice.targets.find((one) => one.action === 'adopt') : undefined;
		assert.notEqual(adopt, undefined);
		if (adopt !== undefined) {
			assert.equal(adopt.to, TaskState.AUTH_REQUIRED);
			assert.equal(adopt.available, true);
		}
	});

	it('「提交」的工作卡：领取可用；终态目标标成「只有用户」', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const id = await makeCard(tb, ws, 't-work', '提交的工作卡');
		await submit(tb, ws, id);

		const advice = tb.transitionAdvice(ws, id, 'lead');
		const targets = 'targets' in advice ? advice.targets : [];
		const claim = targets.find((one) => one.action === 'claim');
		assert.notEqual(claim, undefined, JSON.stringify(targets));
		if (claim !== undefined) {
			assert.equal(claim.to, TaskState.WORKING);
			assert.equal(claim.available, true, JSON.stringify(claim.conditions));
		}
		for (const to of [TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELED, TaskState.REJECTED]) {
			const ended = targets.find((one) => one.to === to);
			if (ended !== undefined) {
				assert.equal(ended.available, false, `${to} 不该对 AI 可用`);
				assert.equal(ended.aiAllowed, false);
			}
		}
	});

	it('领取的条件：依赖没结束 ⇒ 列出 blockers（具体卡）', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const dep = await makeCard(tb, ws, 't-work', '依赖卡');
		/* 依赖卡推到提交（未结束 —— 终结态只能用户操作，所以它一直未结束）。 */
		await submit(tb, ws, dep);
		/* 关系在创建时写：重建一张带 dependsOn 的卡。 */
		const created = await tb.create({
			workspaceId: ws,
			templateRef: 't-work',
			title: '带依赖',
			actor: 'user',
			relations: { links: [{ label: 'dependsOn', to: dep }] },
		});
		assert.equal(created.ok, true, created.ok ? '' : created.message);
		if (!created.ok) return;
		await submit(tb, ws, created.card.id);

		const advice = tb.transitionAdvice(ws, created.card.id, 'lead');
		const claim = 'targets' in advice ? advice.targets.find((one) => one.action === 'claim') : undefined;
		assert.notEqual(claim, undefined);
		if (claim === undefined) return;
		assert.equal(claim.available, false);

		const condition = claim.conditions[0];
		assert.notEqual(condition, undefined);
		assert.equal(condition?.code, 'DEPENDENCY_NOT_ENDED');
		assert.equal(condition?.retryable, true);
		assert.deepEqual(
			condition?.blockers?.map((one) => one.id),
			[dep],
		);
		assert.equal(condition?.blockers?.[0]?.title, '依赖卡', '要能告诉 AI 是哪张卡');
	});

	it('领取的条件：手上已有处理中工作卡 ⇒ ALREADY_HOLDING_A_CARD', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const first = await makeCard(tb, ws, 't-work', '手上的卡');
		await submit(tb, ws, first);
		const claimed = await tb.claim(ws, first, 'ai', 'lead');
		assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.message);

		const second = await makeCard(tb, ws, 't-work', '想领的卡');
		await submit(tb, ws, second);
		const advice = tb.transitionAdvice(ws, second, 'lead');
		const claim = 'targets' in advice ? advice.targets.find((one) => one.action === 'claim') : undefined;
		assert.notEqual(claim, undefined);
		if (claim !== undefined) {
			assert.equal(claim.available, false);
			assert.equal(claim.conditions[0]?.code, 'ALREADY_HOLDING_A_CARD');
			assert.deepEqual(
				claim.conditions[0]?.blockers?.map((one) => one.id),
				[first],
			);
		}
	});

	it('释放：只有当前持有者可用；别人/没身份分别给原因', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const id = await makeCard(tb, ws, 't-work', '释放测试');
		await submit(tb, ws, id);
		const claimed = await tb.claim(ws, id, 'ai', 'lead');
		assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.message);

		const mine = tb.transitionAdvice(ws, id, 'lead');
		const release = 'targets' in mine ? mine.targets.find((one) => one.action === 'release') : undefined;
		assert.notEqual(release, undefined);
		if (release !== undefined) {
			assert.equal(release.to, TaskState.SUBMITTED);
			assert.equal(release.available, true);
		}

		const other = tb.transitionAdvice(ws, id, 'reviewer');
		const otherRelease = 'targets' in other ? other.targets.find((one) => one.action === 'release') : undefined;
		if (otherRelease !== undefined) {
			assert.equal(otherRelease.available, false);
			assert.equal(otherRelease.conditions[0]?.code, 'NOT_A_HOLDER');
		}

		const anonymous = tb.transitionAdvice(ws, id, '');
		const anonRelease = 'targets' in anonymous ? anonymous.targets.find((one) => one.action === 'release') : undefined;
		if (anonRelease !== undefined) {
			assert.equal(anonRelease.available, false);
			assert.equal(anonRelease.conditions[0]?.code, 'HOLDER_MISSING');
		}
	});

	it('默认档位 no-claim：采纳/领取在查询结果里就标成不可执行（UI 轴）', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES, { cardLevel: 'no-claim' });
		const draft = await makeCard(tb, ws, 't-work', '默认档位草稿');
		const draftAdvice = tb.transitionAdvice(ws, draft, 'lead');
		const adopt = 'targets' in draftAdvice ? draftAdvice.targets.find((one) => one.action === 'adopt') : undefined;
		assert.notEqual(adopt, undefined);
		if (adopt !== undefined) {
			assert.equal(adopt.available, false);
			assert.equal(adopt.conditions[0]?.code, 'CARD_ACTION_LEVEL_ADOPT');
			assert.ok(adopt.conditions[0]?.message.includes('允许采纳草稿'), adopt.conditions[0]?.message);
		}

		const submitted = await makeCard(tb, ws, 't-work', '默认档位提交卡');
		await submit(tb, ws, submitted);
		const submittedAdvice = tb.transitionAdvice(ws, submitted, 'lead');
		const claim =
			'targets' in submittedAdvice ? submittedAdvice.targets.find((one) => one.action === 'claim') : undefined;
		assert.notEqual(claim, undefined);
		if (claim !== undefined) {
			assert.equal(claim.available, false);
			assert.equal(claim.conditions[0]?.code, 'CARD_ACTION_LEVEL_CLAIM');
		}
	});

	it('卡不存在 / 已删除 ⇒ 失败', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const missing = tb.transitionAdvice(ws, 'NOPE', 'lead');
		assert.equal('ok' in missing && missing.ok === false, true);
		if ('ok' in missing && missing.ok === false) assert.equal(missing.code, 'CARD_NOT_FOUND');

		const id = await makeCard(tb, ws, 't-work', '删掉');
		const removed = await tb.remove(ws, id, 'user');
		assert.equal(removed.ok, true);
		const deleted = tb.transitionAdvice(ws, id, 'lead');
		assert.equal('ok' in deleted && deleted.ok === false, true);
	});
});
