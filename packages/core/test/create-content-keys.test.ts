/**
 * 建卡 content 与章节关系的三条规则（第二轮 ⑤）。
 *
 * 用户原话：
 * > 创建卡添加约束。可以缺少部分。但是如果缺少部分章节同时有非章节的 key，
 * > 拦截这次提交，报错。如果是有完整的章节，然后有额外的章节。提交为草稿然后进行警告。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskState } from '@taskboard/protocol';

import { makeBoard, makeTemplate, textSection } from './support-v2.ts';

const TEMPLATES = [
	makeTemplate({
		ref: 't-two',
		kind: 'work',
		sections: [textSection('body', '正文'), textSection('note2', '说明')],
	}),
];

describe('建卡 content 的三条规则', () => {
	it('① 部分缺失、无未知 key ⇒ 允许（缺失章节用模板默认值）', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const created = await tb.create({
			workspaceId: ws,
			templateRef: 't-two',
			title: '缺一章',
			content: { body: { $type: 'text', value: '只给正文' } },
		});
		assert.equal(created.ok, true, created.ok ? '' : created.message);
		if (!created.ok) return;
		assert.equal(created.warnings, undefined, '正常缺失没有警告');
		assert.equal(created.card.sections['note2']?.label, '说明', '缺失章节补了默认值');
		assert.equal(created.card.status, TaskState.UNSPECIFIED);
	});

	it('② 部分缺失 + 非章节 key ⇒ 拦截，两种问题一次报全', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const before = tb.list(ws).length;
		const created = await tb.create({
			workspaceId: ws,
			templateRef: 't-two',
			title: '缺一章还多一个 key',
			content: { body: { $type: 'text' }, 额外的东西: { $type: 'text' } },
		});
		assert.equal(created.ok, false);
		if (created.ok) return;
		assert.equal(created.code, 'CONTENT_INVALID');
		assert.ok(created.message.includes('说明'), `应报缺失章节：${created.message}`);
		assert.ok(created.message.includes('额外的东西'), `应报非章节 key：${created.message}`);
		const paths = created.issues?.map((one) => one.path) ?? [];
		assert.ok(paths.some((one) => one.includes('说明')), JSON.stringify(paths));
		assert.ok(paths.some((one) => one.includes('额外的东西')), JSON.stringify(paths));
		assert.equal(tb.list(ws).length, before, '拦截时不得建卡');
	});

	it('③ 章节完整 + 额外 key ⇒ 建卡成功（草稿）+ warning；额外 key 不存进卡', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const created = await tb.create({
			workspaceId: ws,
			templateRef: 't-two',
			title: '章节齐全但多 key',
			content: {
				body: { $type: 'text', value: '正文' },
				note2: { $type: 'text', value: '说明' },
				额外的章节: { $type: 'text', value: '会被忽略' },
			},
		});
		assert.equal(created.ok, true, created.ok ? '' : created.message);
		if (!created.ok) return;
		assert.equal(created.card.status, TaskState.UNSPECIFIED, '建出来是草稿');
		assert.equal(created.warnings?.length, 1);
		assert.ok(created.warnings?.[0]?.includes('额外的章节'), JSON.stringify(created.warnings));
		assert.deepEqual(Object.keys(created.card.sections).sort(), ['body', 'note2'], '额外 key 不存进卡');
	});
});

/* ══════════════════════════════════════════════════════════
   空模板：章节完全自定义（用户 2026-11-22）
   ══════════════════════════════════════════════════════════ */

describe('空模板建卡（章节完全自定义）', () => {
	it('任意 key 都合法，原样存成章节（label = key）', async () => {
		const { tb, ws } = await makeBoard([
			makeTemplate({ ref: 't-empty', kind: 'work', domain: 'core', sections: [] }),
		]);
		const created = await tb.create({
			workspaceId: ws,
			templateRef: 't-empty',
			title: '自定义章节',
			content: {
				随便写: { $type: 'text', value: '内容 A' },
				'another key': { $type: 'markdown', value: '# 标题' },
				数字也可以: { $type: 'ask', items: [] },
			},
		});
		assert.equal(created.ok, true, created.ok ? '' : created.message);
		if (!created.ok) return;
		assert.deepEqual(Object.keys(created.card.sections).sort(), ['another key', '随便写', '数字也可以'].sort());
		assert.equal(created.card.sections['随便写']?.label, '随便写', 'label 就是 key');
		assert.deepEqual(created.card.sections['another key']?.payload, { $type: 'markdown', value: '# 标题' });
		assert.equal(created.warnings, undefined, '空模板不该有「未知 key」警告');
	});

	it('不传 content ⇒ 空章节（合法）', async () => {
		const { tb, ws } = await makeBoard([
			makeTemplate({ ref: 't-empty2', kind: 'work', domain: 'core', sections: [] }),
		]);
		const created = await tb.create({ workspaceId: ws, templateRef: 't-empty2', title: '空内容' });
		assert.equal(created.ok, true, created.ok ? '' : created.message);
		if (!created.ok) return;
		assert.deepEqual(created.card.sections, {});
	});
});