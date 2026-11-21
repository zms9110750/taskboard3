/**
 * 读工具的测试：#1 空间 / #2 列卡 / #3 查看卡 / 原始卡 / #4 定义。
 *
 * 每个工具至少一条正常路径 + 一条失败路径（硬性要求）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTaskboard } from '@taskboard/core';

import { createTaskboardToolRegistry } from '../src/registry.ts';
import { createTaskboardTools } from '../src/tools.ts';
import { createMemoryStore } from './support/memory-store.ts';
import { run, runOk, seedCard, makeFixture, parseJson } from './support/fixtures.ts';

/* ────────────────────────────── #1 空间 ────────────────────────────── */

describe('taskboard_workspaces', () => {
	it('列出空间、卡数（不再有激活空间 —— 用户 2026-11-22 取消）', async () => {
		const fixture = await makeFixture();
		await seedCard(fixture, 't-work', '一张卡');
		const text = await runOk(fixture, 'taskboard_workspaces', {});
		assert.ok(text.includes('工作空间（1 个）'), text);
		assert.ok(text.includes(fixture.ws), text);
		assert.ok(text.includes('1 张卡'), text);
		assert.ok(!text.includes('当前激活空间'), text);
	});

	it('空间必须显式给（激活空间设定已取消）', async () => {
		const fixture = await makeFixture();
		const result = await fixture.registry.invoke('taskboard_cards', {}, { holder: 'lead' });
		assert.equal(result.isError, true);
		assert.ok(result.text.includes('激活空间'), result.text);
		assert.ok(result.text.includes('taskboard_workspaces'), result.text);
	});

	it('includeArchived 控制归档空间是否出现', async () => {
		const fixture = await makeFixture();
		const archived = await fixture.tb.archiveWorkspace(fixture.ws);
		assert.equal(archived.ok, true);
		const hidden = await runOk(fixture, 'taskboard_workspaces', {});
		assert.ok(!hidden.includes('测试空间'), `归档空间不该出现在列表里：\n${hidden}`);
		const shown = await runOk(fixture, 'taskboard_workspaces', { includeArchived: true });
		assert.ok(shown.includes(fixture.ws), shown);
		assert.ok(shown.includes('已归档'), shown);
	});

	it('空任务板 ⇒ 明说没有空间（不是错误）', async () => {
		const tb = createTaskboard({ store: createMemoryStore() });
		const registry = createTaskboardToolRegistry(createTaskboardTools(tb), { host: 'dsh' });
		const result = await registry.invoke('taskboard_workspaces', {});
		assert.ok(result.text.includes('没有任何工作空间'), result.text);
		assert.notEqual(result.isError, true);
	});
});

/* ────────────────────────────── #2 列卡 ────────────────────────────── */

describe('taskboard_cards', () => {
	it('默认不含草稿；状态写草稿才包含', async () => {
		const fixture = await makeFixture();
		const draft = await seedCard(fixture, 't-work', '草稿卡');
		const text = await runOk(fixture, 'taskboard_cards', {});
		assert.ok(!text.includes('草稿卡'), text);
		const withDraft = await runOk(fixture, 'taskboard_cards', { status: ['draft'] });
		assert.ok(withDraft.includes('草稿卡'), withDraft);
		const withDraftChinese = await runOk(fixture, 'taskboard_cards', { status: ['未指定'] });
		assert.ok(withDraftChinese.includes('草稿卡'), withDraftChinese);
		assert.ok(draft.length > 0);
	});

	it('标题模糊搜索', async () => {
		const fixture = await makeFixture();
		await seedCard(fixture, 't-work', '登录页面改版');
		await seedCard(fixture, 't-work', '别的任务');
		const hit = await runOk(fixture, 'taskboard_cards', { title: '登录', status: ['draft'] });
		assert.ok(hit.includes('登录页面改版'), hit);
		assert.ok(!hit.includes('别的任务'), hit);
	});

	it('未读两个 bool：用户没看 / AI 没看（两个同时给 = AND）', async () => {
		const fixture = await makeFixture();
		/* AI 建卡 ⇒ unread.ai（用户没看）；用户建卡 ⇒ unread.user（AI 没看）。 */
		const aiCard = await seedCard(fixture, 't-work', 'AI 改的卡', { actor: 'ai' });
		const userCard = await seedCard(fixture, 't-work', '用户改的卡');

		const userUnread = await runOk(fixture, 'taskboard_cards', { userUnread: true, status: ['draft'] });
		assert.ok(userUnread.includes('AI 改的卡'), userUnread);
		assert.ok(!userUnread.includes('用户改的卡'), userUnread);

		const aiUnread = await runOk(fixture, 'taskboard_cards', { aiUnread: true, status: ['draft'] });
		assert.ok(aiUnread.includes('用户改的卡'), aiUnread);
		assert.ok(!aiUnread.includes('AI 改的卡'), aiUnread);

		const both = await runOk(fixture, 'taskboard_cards', { userUnread: true, aiUnread: true, status: ['draft'] });
		assert.ok(!both.includes('AI 改的卡') && !both.includes('用户改的卡'), `AND 语义下没有卡该命中：${both}`);
		assert.ok(both.includes('没有符合条件的卡'), both);
		assert.ok(aiCard.length > 0 && userCard.length > 0);
	});

	it('分页：每页 20，page 越界报错并给范围', async () => {
		const fixture = await makeFixture();
		for (let i = 1; i <= 21; i += 1) {
			await seedCard(fixture, 't-work', `卡${i}`, { actor: 'user' });
		}
		const page1 = await runOk(fixture, 'taskboard_cards', { page: 1, status: ['draft'] });
		assert.ok(page1.includes('共 21 张卡'), page1);
		assert.ok(page1.includes('第 1/2 页'), page1);
		assert.ok(page1.includes('page=2'), page1);

		const page2 = await runOk(fixture, 'taskboard_cards', { page: 2, status: ['draft'] });
		assert.ok(page2.includes('第 2/2 页'), page2);
		assert.ok(page2.includes('1 张卡') || page2.includes('已经是最后一页'), page2);

		const tooFar = await run(fixture, 'taskboard_cards', { page: 3, status: ['draft'] });
		assert.equal(tooFar.isError, true);
		assert.ok(tooFar.text.includes('超出范围'), tooFar.text);
		assert.ok(tooFar.text.includes('page 1~2'), tooFar.text);
	});

	it('非法状态筛选值 ⇒ 列出可用值（失败路径）', async () => {
		const fixture = await makeFixture();
		const result = await run(fixture, 'taskboard_cards', { status: ['不存在的状态'] });
		assert.equal(result.isError, true);
		assert.ok(result.text.includes('不认识'), result.text);
		assert.ok(result.text.includes('TASK_STATE_SUBMITTED'), result.text);
	});

	it('列出空间、卡数（不再有激活空间 —— 用户 2026-11-22 取消）', async () => {
		const fixture = await makeFixture();
		await seedCard(fixture, 't-work', '一张卡');
		const text = await runOk(fixture, 'taskboard_workspaces', {});
		assert.ok(text.includes('工作空间（1 个）'), text);
		assert.ok(text.includes(fixture.ws), text);
		assert.ok(text.includes('1 张卡'), text);
		assert.ok(!text.includes('当前激活空间'), text);
	});

	it('空间必须显式给（激活空间设定已取消）', async () => {
		const fixture = await makeFixture();
		const result = await fixture.registry.invoke('taskboard_cards', {}, { holder: 'lead' });
		assert.equal(result.isError, true);
		assert.ok(result.text.includes('激活空间'), result.text);
		assert.ok(result.text.includes('taskboard_workspaces'), result.text);
	});
});


/* ────────────────────────────── #3 查看卡 ────────────────────────────── */

describe('taskboard_card', () => {
	it('返回状态/关系/备注/action 视图；查看即 AI 已读', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '详情卡', {
			content: {
				body: { $type: 'text', value: '正文内容' },
				ask: {
					$type: 'ask',
					items: [{ question: '选哪个', options: [{ label: 'A' }, { label: 'B' }], picked: ['A'] }],
				},
			},
		});
		await fixture.tb.update(fixture.ws, id, { note: '这是备注' }, 'user');

		const text = await runOk(fixture, 'taskboard_card', { id });
		assert.ok(text.includes('正文内容'), text);
		assert.ok(text.includes('选哪个'), text);
		assert.ok(text.includes('[x] A'), text);
		assert.ok(text.includes('这是备注'), text);
		assert.ok(text.includes('状态：未指定（TASK_STATE_UNSPECIFIED）'), text);
		assert.ok(text.includes('action=text'), text);
		assert.ok(text.includes('已标记 AI 已读'), text);

		/* 用户改过的卡 ⇒ unread.user=true（AI 未读）；查看后应清掉。 */
		const after = fixture.tb.get(fixture.ws, id);
		assert.equal(after.ok, true);
		if (after.ok) assert.equal(after.card.unread.user, false);
	});

	it('编号强制看：草稿和墓碑都能按 id 看到', async () => {
		const fixture = await makeFixture();
		const draft = await seedCard(fixture, 't-work', '草稿也能看');
		assert.ok((await runOk(fixture, 'taskboard_card', { id: draft })).includes('草稿也能看'));

		const removed = await fixture.tb.remove(fixture.ws, draft, 'user');
		assert.equal(removed.ok, true);
		const tombstone = await runOk(fixture, 'taskboard_card', { id: draft });
		assert.ok(tombstone.includes('墓碑'), tombstone);
	});

	it('不给编号 / 编号不存在 ⇒ 失败（失败路径）', async () => {
		const fixture = await makeFixture();
		const noId = await run(fixture, 'taskboard_card', {});
		assert.equal(noId.isError, true);
		assert.ok(noId.text.includes('必须给卡编号'), noId.text);

		const missing = await run(fixture, 'taskboard_card', { id: 'NOPE' });
		assert.equal(missing.isError, true);
		assert.ok(missing.text.includes('不存在'), missing.text);
	});
});

/* ────────────────────────────── 原始卡 ────────────────────────────── */

describe('taskboard_raw_card', () => {
	it('返回纯 JSON：sectionKey → action payload', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '原始 JSON', {
			content: { body: { $type: 'text', value: '原始正文' } },
		});
		const text = await runOk(fixture, 'taskboard_raw_card', { id });
		const json = parseJson(text);
		assert.deepEqual(Object.keys(json).sort(), ['ask', 'body']);
		assert.equal((json['body'] as { value?: string }).value, '原始正文');
	});

	it('编号不存在 ⇒ 失败', async () => {
		const fixture = await makeFixture();
		const result = await run(fixture, 'taskboard_raw_card', { id: 'NOPE' });
		assert.equal(result.isError, true);
		assert.ok(result.text.includes('不存在'), result.text);
	});
});

/* ────────────────────────────── #4 定义 ────────────────────────────── */

describe('taskboard_definitions', () => {
	it('不传 name = 列出全部 4 类；给 type = 只列该类', async () => {
		const fixture = await makeFixture();
		const all = await runOk(fixture, 'taskboard_definitions', {});
		assert.ok(all.includes('领域（'), all);
		assert.ok(all.includes('状态（9 个）'), all);
		assert.ok(all.includes('模板（'), all);
		assert.ok(all.includes('分类（4 个）'), all);

		const states = await runOk(fixture, 'taskboard_definitions', { type: 'state' });
		assert.ok(states.includes('TASK_STATE_UNSPECIFIED'), states);
		assert.ok(!states.includes('模板（'), states);

		const templates = await runOk(fixture, 'taskboard_definitions', { type: 'template' });
		assert.ok(templates.includes('t-work'), templates);
		assert.ok(!templates.includes('状态（'), templates);
	});

	it('按名字查详情：模板详情含章节 key / action / 默认 payload', async () => {
		const fixture = await makeFixture();
		const text = await runOk(fixture, 'taskboard_definitions', { name: 't-work' });
		assert.ok(text.includes('工作模板'), text);
		assert.ok(text.includes('「正文」（body）→ action=text'), text);
		assert.ok(text.includes('默认 payload'), text);
		assert.ok(text.includes('写完后开校验卡'), text, '应包含模板的「下一步」描述');
	});

	it('状态/分类/领域也能按 id 或中文名查', async () => {
		const fixture = await makeFixture();
		assert.ok((await runOk(fixture, 'taskboard_definitions', { name: 'TASK_STATE_SUBMITTED' })).includes('提交'));
		assert.ok((await runOk(fixture, 'taskboard_definitions', { name: '工作' })).includes('（work）'));
		assert.ok((await runOk(fixture, 'taskboard_definitions', { name: '核心' })).includes('（core）'));
	});

	it('重名时要求 type；未知名字 / 非法 type ⇒ 失败（失败路径）', async () => {
		/* 注册一个「显示名和某个状态中文名重名」的分类，制造重名。 */
		const fixture = await makeFixture();
		void fixture.tb.kinds().register({
			id: 'submitted-kind',
			displayName: '提交',
			letter: 'S',
			description: '和「提交」状态重名',
			reopenable: false,
			needsClaim: false,
		});
		const ambiguous = await run(fixture, 'taskboard_definitions', { name: '提交' });
		assert.equal(ambiguous.isError, true);
		assert.ok(ambiguous.text.includes('都有定义'), ambiguous.text);
		assert.ok(ambiguous.text.includes('状态：TASK_STATE_SUBMITTED'), ambiguous.text);

		const typed = await runOk(fixture, 'taskboard_definitions', { name: '提交', type: 'kind' });
		assert.ok(typed.includes('submitted-kind'), typed);

		const unknown = await run(fixture, 'taskboard_definitions', { name: '不存在的定义' });
		assert.equal(unknown.isError, true);
		assert.ok(unknown.text.includes('没有名为'), unknown.text);

		const badType = await run(fixture, 'taskboard_definitions', { type: 'nope' });
		assert.equal(badType.isError, true);
		assert.ok(badType.text.includes('不认识'), badType.text);
	});
});
