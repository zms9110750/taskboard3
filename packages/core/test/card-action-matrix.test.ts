/**
 * UI 轴（`cardActionLevel`）的**判定矩阵** + AI 采纳草稿的域规则 —— core 自己的行为。
 *
 * ## 这个文件为什么在 core
 *
 * agent 侧的工具调用管控（`ToolGuardLevel` / `judgeToolCall` 第二段）已经搬到
 * `@taskboard/dsh-tools`，**但领卡 / 采纳 / 放手这三件事的语义是 core 的**：
 *
 * ```
 * | 动作      | no-claim | claim | adopt |
 * |-----------|----------|-------|-------|
 * | release   | ✅       | ✅    | ✅    |   ← 放手永远允许，否则 AI 被卡锁死
 * | claim     | ❌       | ✅    | ✅    |
 * | adopt     | ❌       | ❌    | ✅    |
 * ```
 *
 * 搬家前这些断言写在 `core/test/permission.test.ts`（两轴混测），整文件被挪到
 * `dsh-tools/` 后 core 侧就没人管了 ⇒ 这里把 **A 类（只看 UI 轴）** 的部分搬回来。
 *
 * ## 与 `dsh-tools/test/permission-judgement.test.ts` 的分工
 *
 * | 在哪 | 测什么 |
 * |---|---|
 * | **本文件（core）** | 判定表本身：三档 × 三动作，逐格 + 拒绝理由文案 + `allowAiAdopt` 域规则 |
 * | `dsh-tools` | `judgeToolCall` 的第一段是否**委托同一套规则**（一致性对照），以及第二段（toolLevel） |
 *
 * ⚠ 两边都测同一张表看着重复，但测的是**不同层**：
 *   core 这张表是语义真值；dsh-tools 那条是对照，防止搬家时把第一段重写歪。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createTaskboard } from '../src/index.ts';
import type { CardActionLevel, Taskboard } from '../src/index.ts';
import { createMemoryStore } from './memory-store.ts';

const ALL_CARD_LEVELS: readonly CardActionLevel[] = ['no-claim', 'claim', 'adopt'];

/** 造一份模板定义（不加 `TemplateDef` 标注，见 dsh-tools 同名注释）。 */
function makeTemplate(ref: string, kind: string) {
	return {
		ref,
		displayName: ref,
		kind,
		domain: '核心',
		codePrefix: 'P',
		usage: '',
		description: '',
		sections: [
			{ id: 'body', label: '正文', hint: '', action: 'text', defaultPayload: { $type: 'text' } },
		],
		derives: [],
	};
}

/* ────────────────────────── release / claim / adopt ────────────────────────── */

describe('release：三档 cardLevel 全部放行', () => {
	it('★ 放手永远允许（否则 AI 可能被一张卡锁死）', async () => {
		for (const cardLevel of ALL_CARD_LEVELS) {
			const tb = createTaskboard({ store: createMemoryStore(), builtinTemplates: false });
			await tb.setCardActionLevel(cardLevel);
			assert.equal(
				tb.judgeCardAction('release').ok,
				true,
				`${cardLevel} 下 release 必须放行 —— 否则 AI 可能被卡锁死`,
			);
		}
	});
});

describe('claim：no-claim 拒，其余两档放行', () => {
	it('★ no-claim ⇒ 拒，理由点名「领取」且要求 claim 档', async () => {
		const tb = createTaskboard({ store: createMemoryStore(), builtinTemplates: false });
		await tb.setCardActionLevel('no-claim');
		const verdict = tb.judgeCardAction('claim');
		assert.equal(verdict.ok, false);
		if (!verdict.ok) {
			assert.equal(verdict.reason, 'CARD_ACTION_LEVEL');
			assert.equal(verdict.requiredLevel, 'claim');
			assert.equal(verdict.current, 'no-claim');
			assert.ok(verdict.message.includes('领取'), verdict.message);
		}
	});

	it('★ claim / adopt ⇒ 放行', async () => {
		for (const cardLevel of ['claim', 'adopt'] as const) {
			const tb = createTaskboard({ store: createMemoryStore(), builtinTemplates: false });
			await tb.setCardActionLevel(cardLevel);
			assert.equal(tb.judgeCardAction('claim').ok, true, `${cardLevel} 下 claim 应放行`);
		}
	});
});

describe('adopt：只有 adopt 档放行', () => {
	it('★ no-claim / claim ⇒ 拒，理由点名「采纳草稿」且要求 adopt 档', async () => {
		for (const cardLevel of ['no-claim', 'claim'] as const) {
			const tb = createTaskboard({ store: createMemoryStore(), builtinTemplates: false });
			await tb.setCardActionLevel(cardLevel);
			const verdict = tb.judgeCardAction('adopt');
			assert.equal(verdict.ok, false, `${cardLevel} 下 adopt 应被拒`);
			if (!verdict.ok) {
				assert.equal(verdict.reason, 'CARD_ACTION_LEVEL');
				assert.equal(verdict.requiredLevel, 'adopt');
				assert.equal(verdict.current, cardLevel);
				assert.ok(verdict.message.includes('采纳草稿'), verdict.message);
			}
		}
	});

	it('★ adopt ⇒ 放行', async () => {
		const tb = createTaskboard({ store: createMemoryStore(), builtinTemplates: false });
		await tb.setCardActionLevel('adopt');
		assert.equal(tb.judgeCardAction('adopt').ok, true);
	});
});

/* ────────────────────────── 全表：3 档 × 3 动作 ────────────────────────── */

describe('★ 判定表逐格：3 档 × 3 动作', () => {
	/** 判定表的真值（`permission.ts` 文件头表格的机器版）。 */
	const TABLE = {
		release: { 'no-claim': true, claim: true, adopt: true },
		claim: { 'no-claim': false, claim: true, adopt: true },
		adopt: { 'no-claim': false, claim: false, adopt: true },
	} as const;

	it('★ 9 个格子逐个对照', async () => {
		for (const cardLevel of ALL_CARD_LEVELS) {
			const tb = createTaskboard({ store: createMemoryStore(), builtinTemplates: false });
			await tb.setCardActionLevel(cardLevel);
			for (const action of ['release', 'claim', 'adopt'] as const) {
				assert.equal(
					tb.judgeCardAction(action).ok,
					TABLE[action][cardLevel],
					`${cardLevel} × ${action} 必须等于判定表`,
				);
			}
		}
	});
});

/* ────────────────────────── adopt：AI 采纳草稿的域规则 ────────────────────────── */

/*
 * 「AI 能不能采纳草稿」有两层：
 *   ① 档位（上面测的）—— 用户有没有开 adopt 档；
 *   ② 按钮表 + `allowAiAdopt` —— 该模板的「采纳」按钮本来允不允许 ai 点。
 *
 * ② 是 core 的领域规则，跟 agent 侧权限无关 ⇒ 归属本文件。
 */

describe('adopt：AI 采纳草稿的域规则（与档位判定无关）', () => {
	let dir: string;
	let tb: Taskboard;
	let ws: string;

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-adopt-'));
		tb = createTaskboard({ store: createMemoryStore(), builtinTemplates: false });
		tb.templates().register(makeTemplate('t-goal', 'goal'));
		tb.templates().register(makeTemplate('t-design', 'design'));
		tb.templates().register(makeTemplate('t-work', 'work'));
		const created = await tb.createWorkspace('采纳');
		assert.ok(created.ok);
		ws = created.workspace.id;
	});

	after(async () => {
		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	async function makeCard(kind: 't-goal' | 't-design' | 't-work'): Promise<string> {
		const result = await tb.create({
			workspaceId: ws,
			templateRef: kind,
			title: `卡-${Math.random().toString(36).slice(2, 7)}`,
			actor: 'user',
		});
		assert.ok(result.ok, JSON.stringify(result));
		return result.card.id;
	}

	it('★ AI 采纳 goal：默认拒绝', async () => {
		const id = await makeCard('t-goal');
		const result = await tb.adopt(ws, id, 'ai');
		assert.equal(result.ok, false, 'goal 的采纳按钮只有 user');
	});

	it('★ AI 采纳 goal：allowAiAdopt: true ⇒ 成功', async () => {
		const id = await makeCard('t-goal');
		const result = await tb.adopt(ws, id, 'ai', { allowAiAdopt: true });
		assert.ok(result.ok, JSON.stringify(result));
		assert.equal(result.card.status, 'TASK_STATE_SUBMITTED');
		const adoptEntry = result.card.history.find((one) => one.action === 'adopt');
		assert.equal(adoptEntry?.actor, 'ai');
	});

	it('AI 采纳 work：allowAiAdopt: true ⇒ 成功', async () => {
		const id = await makeCard('t-work');
		const result = await tb.adopt(ws, id, 'ai', { allowAiAdopt: true });
		assert.ok(result.ok, JSON.stringify(result));
	});

	it('AI 采纳 design：本来就在按钮表里对 ai 开放 ⇒ 不需要开关', async () => {
		const id = await makeCard('t-design');
		const result = await tb.adopt(ws, id, 'ai');
		assert.ok(result.ok, JSON.stringify(result));
	});

	it('user 采纳不受 allowAiAdopt 影响', async () => {
		const a = await makeCard('t-goal');
		const r1 = await tb.adopt(ws, a, 'user', { allowAiAdopt: true });
		assert.ok(r1.ok);

		const b = await makeCard('t-goal');
		const r2 = await tb.adopt(ws, b, 'user');
		assert.ok(r2.ok);
	});

	it('allowAiAdopt 不会让非草稿卡也能采纳', async () => {
		const id = await makeCard('t-goal');
		await tb.adopt(ws, id, 'user');
		const again = await tb.adopt(ws, id, 'ai', { allowAiAdopt: true });
		assert.equal(again.ok, false, '只有草稿能采纳');
	});
});
