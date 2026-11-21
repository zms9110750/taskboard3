/**
 * 写工具的测试：#5 建卡 / #6 更新卡 / #7 更新备注。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeFixture, parseJson, run, runOk, seedCard, submitCard } from './support/fixtures.ts';

/* ────────────────────────────── #5 建卡 ────────────────────────────── */

describe('taskboard_create', () => {
	it('正常建卡：返回下一步 + 分类描述；关系数组写入卡里', async () => {
		const fixture = await makeFixture();
		const dep = await seedCard(fixture, 't-work', '依赖卡');
		await submitCard(fixture, dep);

		const text = await runOk(fixture, 'taskboard_create', {
			title: '新卡',
			templateRef: 't-work',
			content: { body: { $type: 'text', value: '正文' } },
			relations: [{ type: 'dependsOn', to: dep }],
		});
		assert.ok(text.includes('已建卡'), text);
		assert.ok(text.includes('下一步：写完后开校验卡'), text, '用户裁决 #11：返回模板描述里的下一步');
		assert.ok(text.includes('分类（工作）'), text, '并返回分类描述');
		assert.ok(text.includes(`dependsOn → ${dep}`), text);

		const cards = fixture.tb.list(fixture.ws);
		const made = cards.find((one) => one.title === '新卡');
		assert.notEqual(made, undefined);
		assert.equal(made?.relations.links[0]?.to, dep);
	});

	it('parent 关系写成派生父卡', async () => {
		const fixture = await makeFixture();
		const parent = await seedCard(fixture, 't-goal', '父卡');
		await submitCard(fixture, parent);
		await runOk(fixture, 'taskboard_create', {
			title: '子卡',
			templateRef: 't-work',
			relations: [{ type: 'parent', to: parent }],
		});
		const made = fixture.tb.list(fixture.ws).find((one) => one.title === '子卡');
		assert.equal(made?.relations.parent, parent);
	});

	it('不给模板 ⇒ 提示先看定义并列出可用模板（失败路径）', async () => {
		const fixture = await makeFixture();
		const result = await run(fixture, 'taskboard_create', { title: '没模板' });
		assert.equal(result.isError, true);
		assert.ok(result.text.includes('taskboard_definitions'), result.text);
		assert.ok(result.text.includes('t-work'), result.text);
	});

	it('模板不存在 ⇒ 提示先看定义（失败路径）', async () => {
		const fixture = await makeFixture();
		const result = await run(fixture, 'taskboard_create', { title: 'x', templateRef: '不存在' });
		assert.equal(result.isError, true);
		assert.ok(result.text.includes('不存在'), result.text);
		assert.ok(result.text.includes('taskboard_definitions'), result.text);
	});

	it('空模板：必须补 kind/domain；补上后建卡成功（编号按分类字母）', async () => {
		const fixture = await makeFixture();
		const missing = await run(fixture, 'taskboard_create', { title: '空模板卡', templateRef: 'blank' });
		assert.equal(missing.isError, true);
		assert.ok(missing.text.includes('kind'), missing.text);

		const text = await runOk(fixture, 'taskboard_create', {
			title: '空模板卡',
			templateRef: 'blank',
			kind: 'goal',
			domain: '核心',
		});
		assert.ok(text.includes('已建卡'), text);
		const made = fixture.tb.list(fixture.ws).find((one) => one.title === '空模板卡');
		assert.match(made?.id ?? '', /^GB\d+$/u);
	});

	it('content 形状不对 ⇒ 失败且**不部分成功**（卡没建）', async () => {
		const fixture = await makeFixture();
		const before = fixture.tb.list(fixture.ws).length;
		const result = await run(fixture, 'taskboard_create', {
			title: '坏内容',
			templateRef: 't-work',
			content: { body: { $type: '不存在的 action', x: 1 } },
		});
		assert.equal(result.isError, true);
		assert.ok(result.text.includes('原因码：CONTENT_INVALID'), result.text);
		assert.equal(fixture.tb.list(fixture.ws).length, before, '建卡失败不得留下半张卡');
	});

	it('关系目标不合法 ⇒ 失败且卡没建（原子性）', async () => {
		const fixture = await makeFixture();
		const before = fixture.tb.list(fixture.ws).length;
		const result = await run(fixture, 'taskboard_create', {
			title: '坏关系',
			templateRef: 't-work',
			relations: [{ type: 'dependsOn', to: 'NOPE' }],
		});
		assert.equal(result.isError, true);
		assert.ok(result.text.includes('RELATION_TARGET_INVALID'), result.text);
		assert.equal(fixture.tb.list(fixture.ws).length, before);
	});

	it('关系数组形状不合法（缺 to / 未知 type）⇒ 明确失败', async () => {
		const fixture = await makeFixture();
		const noTo = await run(fixture, 'taskboard_create', {
			title: 'x',
			templateRef: 't-work',
			relations: [{ type: 'dependsOn' }],
		});
		assert.equal(noTo.isError, true);
		assert.ok(noTo.text.includes('to'), noTo.text);

		const badType = await run(fixture, 'taskboard_create', {
			title: 'x',
			templateRef: 't-work',
			relations: [{ type: '不认识', to: 'W1' }],
		});
		assert.equal(badType.isError, true);
		assert.ok(badType.text.includes('dependsOn'), badType.text);
	});
});

/* ────────────────────────────── #6 更新卡 ────────────────────────────── */

describe('taskboard_update', () => {
	it('成功返回合并后的完整 JSON（用户裁决 #12）', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '更新卡', {
			content: { body: { $type: 'text', value: '旧正文' } },
		});

		const text = await runOk(fixture, 'taskboard_update', { id, path: '/body/value', value: '新正文' });
		const json = parseJson(text);
		assert.equal((json['body'] as { value?: string }).value, '新正文');
		assert.notEqual(json['ask'], undefined, '未触碰的章节应保留（合并后的完整 JSON）');
	});

	it('首段可以用章节 label；数组 `-` 可以追加', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', 'label 路径');
		await runOk(fixture, 'taskboard_update', { id, path: '/正文/value', value: 'label 写的' });

		const appended = await runOk(fixture, 'taskboard_update', {
			id,
			path: '/ask/items/-',
			value: { question: '第二个问题', options: [] },
		});
		const json = parseJson(appended);
		const ask = json['ask'] as { items: unknown[] };
		assert.equal(ask.items.length, 2);
	});

	it('根路径 = 替换整个内容对象', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '整体替换');
		const text = await runOk(fixture, 'taskboard_update', {
			id,
			path: '',
			value: { body: { $type: 'text', value: '整份' } },
		});
		const json = parseJson(text);
		assert.equal((json['body'] as { value?: string }).value, '整份');
	});

	it('路径中间不存在 / 语法错 / 卡不存在 ⇒ 失败（失败路径）', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '错误路径');

		const missing = await run(fixture, 'taskboard_update', { id, path: '/nope/x', value: 1 });
		assert.equal(missing.isError, true);
		assert.ok(missing.text.includes('不存在'), missing.text);
		assert.ok(missing.text.includes('taskboard_raw_card'), missing.text);

		const badPointer = await run(fixture, 'taskboard_update', { id, path: '/a~2', value: 1 });
		assert.equal(badPointer.isError, true);

		const noValue = await run(fixture, 'taskboard_update', { id, path: '/body/value' });
		assert.equal(noValue.isError, true);
		assert.ok(noValue.text.includes('value'), noValue.text);

		const missingCard = await run(fixture, 'taskboard_update', { id: 'NOPE', path: '/body', value: {} });
		assert.equal(missingCard.isError, true);
	});

	it('替换结果过不了模板校验 ⇒ 失败且卡内容不变（原子性）', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '坏替换', {
			content: { body: { $type: 'text', value: '原值' } },
		});
		const before = fixture.tb.get(fixture.ws, id);
		const result = await run(fixture, 'taskboard_update', { id, path: '/body', value: { $type: '坏' } });
		assert.equal(result.isError, true);
		const after = fixture.tb.get(fixture.ws, id);
		if (before.ok && after.ok) assert.deepEqual(after.card.sections, before.card.sections);
	});
});

/* ────────────────────────────── #7 更新备注 ────────────────────────────── */

describe('taskboard_update_note', () => {
	it('写备注 / 空串清空', async () => {
		const fixture = await makeFixture();
		const id = await seedCard(fixture, 't-work', '备注卡');
		const written = await runOk(fixture, 'taskboard_update_note', { id, note: '这是备注' });
		assert.ok(written.includes('已更新'), written);
		const afterWrite = fixture.tb.get(fixture.ws, id);
		if (afterWrite.ok) assert.equal(afterWrite.card.note, '这是备注');

		const cleared = await runOk(fixture, 'taskboard_update_note', { id, note: '' });
		assert.ok(cleared.includes('已清空'), cleared);
		const afterClear = fixture.tb.get(fixture.ws, id);
		if (afterClear.ok) assert.equal(afterClear.card.note, '');
	});

	it('卡不存在 / 缺 note ⇒ 失败（失败路径）', async () => {
		const fixture = await makeFixture();
		const missingCard = await run(fixture, 'taskboard_update_note', { id: 'NOPE', note: 'x' });
		assert.equal(missingCard.isError, true);

		const noNote = await run(fixture, 'taskboard_update_note', { id: 'W1' });
		assert.equal(noNote.isError, true);
		assert.ok(noNote.text.includes('note'), noNote.text);
	});
});
