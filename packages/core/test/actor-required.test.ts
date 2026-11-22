/**
 * `CreateInput.actor` 必填 —— 用户 `2026-11-22` 的裁决。
 *
 * ## 用户原话
 *
 * > 「actor 参数需要是必填的。以让 ui 处和 tool 处明确的要填入这两个参数。
 * >   实际上用户操作和 ai 操作都不会碰这两个参数。但**桥接操作者到 core 的
 * >   tool 和 ui 函数，他们要负责填写这个参数。而且必须明确填写**。」
 *
 * ## 为什么这个字段重要到要单独一个测试文件
 *
 * `actor` 决定**未读标记的方向**（`core/src/card.ts` 的 `unreadAfter`）：
 *
 * | actor | 结果 |
 * |---|---|
 * | `'ai'` | `unread.ai = true`（AI 改过 ⇒ 用户未读）|
 * | `'user'` | `unread.user = true`（用户改过 ⇒ AI 未读）|
 *
 * 填错方向就反了，而且原来的 `input.actor ?? 'user'` 兜底让「忘了传」
 * **零报错**地变成「用户建的卡」⇒ AI 建卡被记成用户建卡，未读方向全反。
 *
 * ⇒ 必填（类型层）+ 透传（运行时不改值）+ 这条测试（钉住 history 里记的是什么）。
 *
 * ## 为什么不在这个文件里测「不传 actor 编译失败」
 *
 * 那件事**已经由 `tsc` 保证**了 —— `actor` 没有 `?` 也没有默认值，
 * 漏传就是 `TS2345`。运行时测试没法「证明编译会失败」，
 * 写一个假装在测的测试只会骗人。所以这里只测**运行时行为**。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { makeBoard, makeTemplate, textSection } from './support-v2.ts';

/** 一个只有 text 章节的模板。 */
const TEMPLATES = [makeTemplate({ ref: 't-a', kind: 'work', sections: [textSection()] })];

describe('CreateInput.actor —— 必填 + 原样记进 history', () => {
	it('actor: user ⇒ history[0].actor === "user"', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const created = await tb.create({
			workspaceId: ws,
			templateRef: 't-a',
			title: '人建的',
			actor: 'user',
		});
		assert.equal(created.ok, true, created.ok ? '' : created.message);
		if (!created.ok) return;

		const entry = created.card.history[0];
		assert.ok(entry !== undefined, '建卡必须留一条 history');
		assert.equal(entry.action, 'create');
		assert.equal(entry.actor, 'user', 'history 里记的必须是入参，不是默认值');
	});

	it('actor: ai ⇒ history[0].actor === "ai"（不被改成 user）', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const created = await tb.create({
			workspaceId: ws,
			templateRef: 't-a',
			title: 'AI 建的',
			actor: 'ai',
		});
		assert.equal(created.ok, true, created.ok ? '' : created.message);
		if (!created.ok) return;

		const entry = created.card.history[0];
		assert.ok(entry !== undefined);
		/*
		 * ⚠ 这条是核心：以前 `input.actor ?? 'user'` 的兜底会让传了 'ai' 也记成 'user'？不会 ——
		 *   兜底只在 undefined 时生效。但**去掉兜底之后**，这条断言确保透传没走样。
		 */
		assert.equal(entry.actor, 'ai');
	});

	it('actor 决定未读方向：user 建 ⇒ unread.user；ai 建 ⇒ unread.ai', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);

		const byUser = await tb.create({
			workspaceId: ws,
			templateRef: 't-a',
			title: '人建',
			actor: 'user',
		});
		assert.equal(byUser.ok, true);
		if (!byUser.ok) return;
		assert.equal(byUser.card.unread.user, true, '用户改过 ⇒ AI 未读');
		assert.equal(byUser.card.unread.ai, false);

		const byAi = await tb.create({
			workspaceId: ws,
			templateRef: 't-a',
			title: 'AI 建',
			actor: 'ai',
		});
		assert.equal(byAi.ok, true);
		if (!byAi.ok) return;
		assert.equal(byAi.card.unread.ai, true, 'AI 改过 ⇒ 用户未读');
		assert.equal(byAi.card.unread.user, false);
	});

	it('持久化后重新读出来，history 里的 actor 还在（不是只在返回值里）', async () => {
		const { tb, ws } = await makeBoard(TEMPLATES);
		const created = await tb.create({
			workspaceId: ws,
			templateRef: 't-a',
			title: '重新读',
			actor: 'ai',
		});
		assert.equal(created.ok, true);
		if (!created.ok) return;

		const got = await tb.get(ws, created.card.id);
		assert.equal(got.ok, true);
		if (!got.ok) return;
		assert.equal(got.card.history[0]?.actor, 'ai', '落盘再读回来，actor 不能丢');
	});
});
