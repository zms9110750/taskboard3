/**
 * #8 转移状态的测试：采纳 / 领取 / 释放 / 普通转移 + 空目标的条件目标。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TaskState } from '@taskboard/protocol';

import { makeFixture, run, runOk, seedCard, submitCard } from './support/fixtures.ts';

describe('taskboard_transition', () => {
	it('采纳：草稿 → 提交；设计/记录 → 需要授权', async () => {
		const fixture = await makeFixture();
		const work = await seedCard(fixture, 't-work', '工作草稿');
		const adopt = await runOk(fixture, 'taskboard_transition', { id: work, to: 'TASK_STATE_SUBMITTED' });
		assert.ok(adopt.includes('已采纳'), adopt);
		const workAfter = fixture.tb.get(fixture.ws, work);
		if (workAfter.ok) assert.equal(workAfter.card.status, TaskState.SUBMITTED);

		const design = await seedCard(fixture, 't-design', '设计草稿');
		const designText = await runOk(fixture, 'taskboard_transition', { id: design, to: '需要授权' });
		assert.ok(designText.includes('已采纳'), designText);
		const designAfter = fixture.tb.get(fixture.ws, design);
		if (designAfter.ok) assert.equal(designAfter.card.status, TaskState.AUTH_REQUIRED);
	});

	it('领取 / 释放：提交 → 处理中 → 提交；持有者来自 ctx.holder', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '领取测试');
		await submitCard(fixture, id);

		const claimed = await runOk(fixture, 'taskboard_transition', { id, to: 'TASK_STATE_WORKING' });
		assert.ok(claimed.includes('已领取'), claimed);
		assert.ok(claimed.includes('lead'), claimed);
		const working = fixture.tb.get(fixture.ws, id);
		if (working.ok) {
			assert.equal(working.card.status, TaskState.WORKING);
			assert.deepEqual(working.card.holders.map((one) => one.holder), ['lead']);
		}

		const released = await runOk(fixture, 'taskboard_transition', { id, to: '提交' });
		assert.ok(released.includes('已释放'), released);
		const back = fixture.tb.get(fixture.ws, id);
		if (back.ok) {
			assert.equal(back.card.status, TaskState.SUBMITTED);
			assert.deepEqual(back.card.holders, []);
		}
	});

	it('空目标 = 只查：列出可执行目标 + 条件目标（带阻塞卡）', async () => {
		const fixture = await makeFixture();
		const dep = await seedCard(fixture, 't-work', '依赖卡');
		await submitCard(fixture, dep);
		const main = await seedCard(fixture, 't-work', '有依赖的卡', {
			relations: { links: [{ label: 'dependsOn', to: dep }] },
		});
		await submitCard(fixture, main);

		const text = await runOk(fixture, 'taskboard_transition', { id: main });
		assert.ok(text.includes('接下来可转移的目标'), text);
		assert.ok(text.includes('条件目标'), text);
		assert.ok(text.includes('DEPENDENCY_NOT_ENDED'), text);
		assert.ok(text.includes(`阻塞卡：${dep}「依赖卡」`), text);
		assert.ok(text.includes('执行方式'), text);

		/* 查询不写库。 */
		const after = fixture.tb.get(fixture.ws, main);
		if (after.ok) assert.equal(after.card.status, TaskState.SUBMITTED);
	});

	it('只开放给用户的目标 ⇒ 明确拒绝（不写库）', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '终态测试');
		await submitCard(fixture, id);
		const result = await run(fixture, 'taskboard_transition', { id, to: 'TASK_STATE_COMPLETED' });
		assert.equal(result.isError, true);
		assert.ok(result.text.includes('只开放给用户'), result.text);
		const after = fixture.tb.get(fixture.ws, id);
		if (after.ok) assert.equal(after.card.status, TaskState.SUBMITTED);
	});

	it('目标字符串不合法 / 卡不存在 ⇒ 失败（失败路径）', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '坏目标');
		const badTarget = await run(fixture, 'taskboard_transition', { id, to: '瞎写的目标' });
		assert.equal(badTarget.isError, true);
		assert.ok(badTarget.text.includes('不是已知状态'), badTarget.text);
		assert.ok(badTarget.text.includes('TASK_STATE_SUBMITTED'), badTarget.text);

		const missing = await run(fixture, 'taskboard_transition', { id: 'NOPE' });
		assert.equal(missing.isError, true);
	});

	it('同状态 ⇒ 幂等 no-op（不是错误）', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '同状态');
		const result = await run(fixture, 'taskboard_transition', { id, to: 'TASK_STATE_UNSPECIFIED' });
		assert.notEqual(result.isError, true);
		assert.ok(result.text.includes('未执行转移'), result.text);
	});

	it('宿主没给 holder ⇒ 领取明确失败（宿主接线问题）', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '没有身份');
		await submitCard(fixture, id);

		/*
		 * ⚠ `exactOptionalPropertyTypes: true` 下**不能传 `holder: undefined`** ——
		 *   那和「省略 holder」不是同一件事：前者是「显式给了个 undefined 值」。
		 *   这里要测的是「宿主没提供身份」⇒ 必须**省略**这个字段。
		 *   `context()` 默认填 `holder: 'lead'`，所以要显式构造一个不带它的 ctx。
		 */
		const noHolderCtx = { canManageToolPolicies: true } as const;
		const query = await runOk(fixture, 'taskboard_transition', { id }, noHolderCtx);
		assert.ok(query.includes('宿主没有提供'), query);

		const claim = await run(fixture, 'taskboard_transition', { id, to: 'TASK_STATE_WORKING' }, noHolderCtx);
		assert.equal(claim.isError, true);
		assert.ok(claim.text.includes('没有提供当前调用者身份'), claim.text);
	});

	/* ── 第二轮 ④：UI 轴权限拦截 ── */

	it('默认档位 no-claim：采纳/领取被拦，下一步指向让用户开 UI 权限；释放仍允许', async () => {
		const fixture = await makeFixture({ cardLevel: 'no-claim' });
		const draft = await seedCard(fixture, 't-work', '默认档位草稿');

		const adopt = await run(fixture, 'taskboard_transition', { id: draft, to: 'TASK_STATE_SUBMITTED' });
		assert.equal(adopt.isError, true);
		assert.ok(adopt.text.includes('不允许 AI 采纳草稿'), adopt.text);
		assert.ok(adopt.text.includes('允许采纳草稿'), adopt.text);
		assert.ok(adopt.text.includes('如果用户授意'), adopt.text);

		const submitted = await seedCard(fixture, 't-work', '默认档位提交');
		await submitCard(fixture, submitted);
		const claim = await run(fixture, 'taskboard_transition', { id: submitted, to: 'TASK_STATE_WORKING' });
		assert.equal(claim.isError, true);
		assert.ok(claim.text.includes('不允许 AI 领取工作卡'), claim.text);
		assert.ok(claim.text.includes('允许领卡'), claim.text);

		/* 释放永远允许（旧裁定）：直接让 core 把人放上去，再用工具释放。 */
		const working = await seedCard(fixture, 't-work', '默认档位释放');
		await submitCard(fixture, working);
		const claimed = await fixture.tb.claim(fixture.ws, working, 'ai', 'lead');
		assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.message);
		const release = await runOk(fixture, 'taskboard_transition', { id: working, to: '提交' });
		assert.ok(release.includes('已释放'), release);
	});

	it('claim 档：可领取、不可采纳', async () => {
		const fixture = await makeFixture({ cardLevel: 'claim' });
		const submitted = await seedCard(fixture, 't-work', 'claim 档提交');
		await submitCard(fixture, submitted);
		const claim = await runOk(fixture, 'taskboard_transition', { id: submitted, to: 'TASK_STATE_WORKING' });
		assert.ok(claim.includes('已领取'), claim);

		const draft = await seedCard(fixture, 't-work', 'claim 档草稿');
		const adopt = await run(fixture, 'taskboard_transition', { id: draft, to: 'TASK_STATE_SUBMITTED' });
		assert.equal(adopt.isError, true);
		assert.ok(adopt.text.includes('允许采纳草稿'), adopt.text);
	});

	it('查询结果也如实标出 UI 轴拦截（不写库）', async () => {
		const fixture = await makeFixture({ cardLevel: 'no-claim' });
		const draft = await seedCard(fixture, 't-work', '查询拦截');
		const text = await runOk(fixture, 'taskboard_transition', { id: draft });
		assert.ok(text.includes('CARD_ACTION_LEVEL_ADOPT'), text);
		assert.ok(text.includes('现在不可执行的目标'), text);
		const after = fixture.tb.get(fixture.ws, draft);
		if (after.ok) assert.equal(after.card.status, 'TASK_STATE_UNSPECIFIED');
	});
});
