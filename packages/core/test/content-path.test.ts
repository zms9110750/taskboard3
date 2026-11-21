/**
 * 「模板内 JSON」路径替换的测试（tool contract v2）。
 *
 * 两组：
 * 1. **纯函数**：解析 / 替换的边界（转义、数组、父级不存在、不修改入参）；
 * 2. **集成**：`Taskboard.replaceContentAt` 走真 core（校验、未读、历史、落库）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseContentPointer, replaceInContent } from '../src/content-path.ts';
import { TaskState } from '@taskboard/protocol';
import { makeBoard, makeCard, makeTemplate, textSection } from './support-v2.ts';

/* ────────────────────────────── 纯函数 ────────────────────────────── */

describe('parseContentPointer', () => {
	it('空串 = 根；省略开头 `/` 也接受', () => {
		assert.deepEqual(parseContentPointer(''), { ok: true, segments: [] });
		assert.deepEqual(parseContentPointer('/a/b'), { ok: true, segments: ['a', 'b'] });
		assert.deepEqual(parseContentPointer('a/b'), { ok: true, segments: ['a', 'b'] });
	});

	it('标准转义 ~1 = /，~0 = ~', () => {
		assert.deepEqual(parseContentPointer('/a~1b/c~0d'), { ok: true, segments: ['a/b', 'c~d'] });
	});

	it('非法 ~ 转义 ⇒ 失败（不猜）', () => {
		const parsed = parseContentPointer('/a~2');
		assert.equal(parsed.ok, false);
		if (!parsed.ok) assert.ok(parsed.message.includes('~'), parsed.message);
	});
});

describe('replaceInContent', () => {
	const original = {
		body: { $type: 'text', value: '旧' },
		ask: { $type: 'ask', items: [{ options: [] }] },
	};

	it('替换嵌套字段（替换语义）', () => {
		const replaced = replaceInContent(original, ['body', 'value'], '新');
		assert.equal(replaced.ok, true);
		if (!replaced.ok) return;
		assert.equal((replaced.next['body'] as { value?: string }).value, '新');
		assert.equal((replaced.next['ask'] as { $type?: string }).$type, 'ask', '兄弟节点不受影响');
	});

	it('不修改入参（纯函数）', () => {
		const before = JSON.stringify(original);
		replaceInContent(original, ['body', 'value'], '新');
		assert.equal(JSON.stringify(original), before);
	});

	it('最后一段可以新增字段（是否合法交给模板校验）', () => {
		const replaced = replaceInContent({ body: { $type: 'text' } }, ['body', 'placeholder'], '灰字');
		assert.equal(replaced.ok, true);
		if (replaced.ok) assert.equal((replaced.next['body'] as { placeholder?: string }).placeholder, '灰字');
	});

	it('中间路径不存在 ⇒ 报错并列出可用键', () => {
		const replaced = replaceInContent(original, ['nope', 'value'], 'x');
		assert.equal(replaced.ok, false);
		if (!replaced.ok) {
			assert.ok(replaced.message.includes('nope'), replaced.message);
			assert.ok(replaced.message.includes('body'), `应列出可用键：${replaced.message}`);
		}
	});

	it('数组：按下标替换、`-` 追加、越界/非数字报错', () => {
		const content = { ask: { $type: 'ask', items: [{ options: [] }] } };
		const replaced = replaceInContent(content, ['ask', 'items', '0', 'options'], [{ label: 'A' }]);
		assert.equal(replaced.ok, true);
		if (replaced.ok) {
			const item = (replaced.next['ask'] as { items: { options: unknown[] }[] }).items[0];
			assert.deepEqual(item?.options, [{ label: 'A' }]);
		}

		const appended = replaceInContent(content, ['ask', 'items', '-'], { options: [] });
		assert.equal(appended.ok, true);
		if (appended.ok) assert.equal((appended.next['ask'] as { items: unknown[] }).items.length, 2);

		const outOfRange = replaceInContent(content, ['ask', 'items', '5'], {});
		assert.equal(outOfRange.ok, false);

		const notIndex = replaceInContent(content, ['ask', 'items', 'x'], {});
		assert.equal(notIndex.ok, false);
	});

	it('根路径必须是对象（整个内容替换）', () => {
		const ok = replaceInContent(original, [], { body: { $type: 'text', value: 'x' } });
		assert.equal(ok.ok, true);
		const bad = replaceInContent(original, [], ['不是对象']);
		assert.equal(bad.ok, false);
	});
});

/* ────────────────────────────── 集成 ────────────────────────────── */

describe('Taskboard.replaceContentAt', () => {
	async function board(): Promise<{ tb: Awaited<ReturnType<typeof makeBoard>>['tb']; ws: string }> {
		const made = await makeBoard([
			makeTemplate({
				ref: 't-work',
				kind: 'work',
				sections: [textSection('body', '正文'), textSection('note2', '说明')],
			}),
		]);
		return made;
	}

	it('按 sectionId 替换嵌套字段；actor=ai ⇒ 进 AI 未读 + 写 history', async () => {
		const { tb, ws } = await board();
		const id = await makeCard(tb, ws, 't-work', '改内容');

		const result = await tb.replaceContentAt(ws, id, '/body/value', '新正文', 'ai');
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal((result.content['body'] as { value?: string }).value, '新正文');
		assert.equal(result.card.unread.ai, true, 'AI 改过 ⇒ 用户未读');
		assert.equal(result.card.history.at(-1)?.action, 'update');

		const after = tb.get(ws, id);
		assert.equal(after.ok, true);
		if (after.ok) assert.equal((after.card.sections['body']?.payload as { value?: string }).value, '新正文');
	});

	it('首段用章节 label 也能定位（模型看到的是 label）', async () => {
		const { tb, ws } = await board();
		const id = await makeCard(tb, ws, 't-work', 'label 路径');
		const result = await tb.replaceContentAt(ws, id, '/正文/value', '用 label', 'ai');
		assert.equal(result.ok, true);
		if (result.ok) assert.equal((result.content['body'] as { value?: string }).value, '用 label');
	});

	it('根路径 = 整体替换（省略的章节回落模板默认值）', async () => {
		const { tb, ws } = await board();
		const id = await makeCard(tb, ws, 't-work', '整体替换');
		const replaced = await tb.replaceContentAt(
			ws,
			id,
			'',
			{ body: { $type: 'text', value: '整份' } },
			'ai',
		);
		assert.equal(replaced.ok, true);
		if (!replaced.ok) return;
		assert.equal((replaced.content['body'] as { value?: string }).value, '整份');
		assert.ok(replaced.content['note2'] !== undefined, '省略的章节由模板默认值补上');
	});

	it('替换结果过不了模板校验 ⇒ 失败且卡不变', async () => {
		const { tb, ws } = await board();
		const id = await makeCard(tb, ws, 't-work', '坏替换');
		const before = tb.get(ws, id);
		const result = await tb.replaceContentAt(ws, id, '/body', { $type: '不存在的 action' }, 'ai');
		assert.equal(result.ok, false);
		const after = tb.get(ws, id);
		if (before.ok && after.ok) assert.deepEqual(after.card, before.card, '校验失败不得落库');
	});

	it('路径错误 / 卡不存在 / 已删除 ⇒ 明确失败', async () => {
		const { tb, ws } = await board();
		const id = await makeCard(tb, ws, 't-work', '错误路径');

		const badPointer = await tb.replaceContentAt(ws, id, '/a~2', {}, 'ai');
		assert.equal(badPointer.ok, false);

		const missing = await tb.replaceContentAt(ws, id, '/nope/x', {}, 'ai');
		assert.equal(missing.ok, false);

		const notFound = await tb.replaceContentAt(ws, 'NOPE', '', {}, 'ai');
		assert.equal(notFound.ok, false);
		if (!notFound.ok) assert.equal(notFound.code, 'CARD_NOT_FOUND');

		const removed = await tb.remove(ws, id, 'user');
		assert.equal(removed.ok, true);
		const deleted = await tb.replaceContentAt(ws, id, '/body/value', 'x', 'ai');
		assert.equal(deleted.ok, false);
	});

	it('草稿可以改；状态/持有者/历史不在内容 JSON 里，路径碰不到它们', async () => {
		const { tb, ws } = await board();
		const id = await makeCard(tb, ws, 't-work', '草稿改内容');
		const drafted = tb.get(ws, id);
		assert.equal(drafted.ok, true);
		if (!drafted.ok) return;
		assert.equal(drafted.card.status, TaskState.UNSPECIFIED);

		const replaced = await tb.replaceContentAt(ws, id, '/body/value', '草稿正文', 'ai');
		assert.equal(replaced.ok, true);
		if (!replaced.ok) return;
		assert.equal(replaced.card.status, TaskState.UNSPECIFIED, '路径替换不改状态');
		assert.equal(replaced.card.deleted, false);
	});
});
