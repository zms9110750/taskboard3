/**
 * `pure/update-focus.ts` 的测试 —— 纯函数，零 DOM。
 *
 * ## 每条期望值的依据来源
 *
 * 旧版（只读，未改）坐标都在 `taskboard2/packages/browser/` 下：
 *   · `src/lib/store.ts` —— 焦点模式信号 + 两个更新集合
 *   · `src/views/card-list/index.ts` —— 给卡加 `is-update-hit`、给 `body` 加 `is-update-focus`
 *   · `src/views/card-list/filter-row.ts` —— 两个按钮的文案与 title
 *   · `public/styles.css` —— 真正的淡化规则（`opacity: .22`）
 *
 * 个别期望值是**推断**（旧版没有对应路径），测试里显式标了「推断」并写了理由。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { focusOf } from '../src/pure/update-focus.ts';

/** 造未读字段（两边独立）。 */
function flags(ai: boolean, user: boolean): { ai: boolean; user: boolean } {
	return { ai, user };
}

/* ══════════════════════════════════════════════════════════ */
describe('没开焦点模式 —— 谁都不淡化', () => {
	/*
	 * 依据：旧版 `store.ts:241` 的默认值就是 `''`（没开）；此时
	 * `card-list/index.ts:162` 不会给 body 加 `is-update-focus`，
	 * 而淡化规则 `styles.css:3442-3445` 要求 `body.is-update-focus` ⇒ 一条都不命中。
	 */
	it("mode='none' + AI 改过未读 ⇒ normal / focus-off", () => {
		assert.deepEqual(focusOf(flags(true, false), 'none'), {
			focus: 'normal',
			reason: 'focus-off',
		});
	});

	it("mode='none' + 我改过 AI 未读 ⇒ normal / focus-off", () => {
		assert.deepEqual(focusOf(flags(false, true), 'none'), {
			focus: 'normal',
			reason: 'focus-off',
		});
	});

	/*
	 * 依据：旧版「没开」的字面值就是空串（`store.ts:241` 的类型
	 * `'ai' | 'user' | ''`；`setUpdateFocus` 再点同一按钮时置回 `''`，`store.ts:268-271`）。
	 * ⇒ 空串必须等价于没开，不能当成「未知模式」。
	 */
	it("旧版空串 '' 等价于没开 ⇒ normal / focus-off", () => {
		assert.deepEqual(focusOf(flags(true, true), ''), {
			focus: 'normal',
			reason: 'focus-off',
		});
	});

	/*
	 * 依据：没开模式时旧版根本不用未读集合（`index.ts:160-171` 只在开关打开时
	 * 才按集合 toggle `is-update-hit`）⇒ 字段缺失也不该导致任何淡化。
	 */
	it('未读字段整个缺失 + 没开模式 ⇒ normal / focus-off', () => {
		assert.deepEqual(focusOf(undefined, 'none'), {
			focus: 'normal',
			reason: 'focus-off',
		});
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('「AI 更新过」模式 —— 只认 unread.ai', () => {
	/*
	 * 依据：`index.ts:165` 在 kind==='ai' 时取 `aiUpdatedIds` 作命中集合，
	 * `index.ts:170` 命中 ⇒ `is-update-hit=true` ⇒ `styles.css:3442` 的
	 * `:not(.is-update-hit)` 不命中 ⇒ 不淡化。
	 */
	it('unread.ai=true ⇒ normal / ai-hit', () => {
		assert.deepEqual(focusOf(flags(true, false), 'ai'), {
			focus: 'normal',
			reason: 'ai-hit',
		});
	});

	/*
	 * 依据：`aiUpdatedIds` 只装「AI 引发的事件」（`store.ts:223`），
	 * 用户改过的卡不在这个集合里 ⇒ `is-update-hit=false` ⇒ 被淡化（`styles.css:3442-3445`）。
	 */
	it('只 unread.user=true（用户改过）⇒ dimmed / ai-miss', () => {
		assert.deepEqual(focusOf(flags(false, true), 'ai'), {
			focus: 'dimmed',
			reason: 'ai-miss',
		});
	});

	it('两边都 false（都看过）⇒ dimmed / ai-miss', () => {
		assert.deepEqual(focusOf(flags(false, false), 'ai'), {
			focus: 'dimmed',
			reason: 'ai-miss',
		});
	});

	/*
	 * 依据：`index.ts:165-170` 只看「在不在集合里」，不做互斥判断；
	 * 旧版两个集合独立算（`store.ts:230-234`），同一张卡可以同时在两边
	 * （v3 `core/test/updates.test.ts:130` 也构造过「两边都为真」的脏状态）。
	 * ⇒ 在 ai 集合里就算命中，不因为 user 那边也为真而取消。
	 */
	it('两边都 true（脏数据）⇒ normal / ai-hit', () => {
		assert.deepEqual(focusOf(flags(true, true), 'ai'), {
			focus: 'normal',
			reason: 'ai-hit',
		});
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('「AI未读」模式 —— 只认 unread.user', () => {
	/*
	 * 依据：`filter-row.ts:190` 按钮 title「淡化不在『AI未读』里的卡」；
	 * `index.ts:165` 在 kind==='user' 时取 `userUpdatedIds`（= 用户改过、AI 没读）。
	 */
	it('unread.user=true ⇒ normal / user-hit', () => {
		assert.deepEqual(focusOf(flags(false, true), 'user'), {
			focus: 'normal',
			reason: 'user-hit',
		});
	});

	/*
	 * 依据：同上，`userUpdatedIds` 只装「用户引发的事件」（`store.ts:224`），
	 * AI 改过的卡不在这个集合里 ⇒ 淡化。
	 */
	it('只 unread.ai=true（AI 改过）⇒ dimmed / user-miss', () => {
		assert.deepEqual(focusOf(flags(true, false), 'user'), {
			focus: 'dimmed',
			reason: 'user-miss',
		});
	});

	it('两边都 false（都看过）⇒ dimmed / user-miss', () => {
		assert.deepEqual(focusOf(flags(false, false), 'user'), {
			focus: 'dimmed',
			reason: 'user-miss',
		});
	});

	it('两边都 true（脏数据）⇒ normal / user-hit', () => {
		assert.deepEqual(focusOf(flags(true, true), 'user'), {
			focus: 'normal',
			reason: 'user-hit',
		});
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('边界：字段缺失 / 未知值', () => {
	/*
	 * 依据：旧版 `store.ts:261-265` —— 更新清单取不到时「保守清空（不假装有更新）」，
	 * 两个集合变空 ⇒ 模式开着时每一张卡都 `is-update-hit=false` ⇒ 全部淡化。
	 * ⇒ 字段缺失按「未命中」处理，绝不假装有更新。
	 */
	it("unread 整个缺失（undefined）+ mode='ai' ⇒ dimmed / ai-miss", () => {
		assert.deepEqual(focusOf(undefined, 'ai'), {
			focus: 'dimmed',
			reason: 'ai-miss',
		});
	});

	it("unread 为 null + mode='user' ⇒ dimmed / user-miss", () => {
		assert.deepEqual(focusOf(null, 'user'), {
			focus: 'dimmed',
			reason: 'user-miss',
		});
	});

	it("unread 是空对象 + mode='ai' ⇒ dimmed / ai-miss", () => {
		assert.deepEqual(focusOf({}, 'ai'), {
			focus: 'dimmed',
			reason: 'ai-miss',
		});
	});

	/*
	 * 推断（旧版没有这条路径）：旧版字段由后端 JSON 给出、按布尔用，不存在
	 * 「字符串 'true'」这种形状。但这是判决点，收到非布尔值只能二选一：
	 * 猜「像真的」会伪造出「有更新」，比当作没读更坏 ⇒ 只认 `=== true`。
	 */
	it("ai 是字符串 'true' ⇒ 不认 ⇒ dimmed / ai-miss", () => {
		assert.deepEqual(focusOf({ ai: 'true' }, 'ai'), {
			focus: 'dimmed',
			reason: 'ai-miss',
		});
	});

	it('ai 是数字 1 ⇒ 不认 ⇒ dimmed / ai-miss', () => {
		assert.deepEqual(focusOf({ ai: 1 }, 'ai'), {
			focus: 'dimmed',
			reason: 'ai-miss',
		});
	});

	it("user 是字符串 'yes' ⇒ 不认 ⇒ dimmed / user-miss", () => {
		assert.deepEqual(focusOf({ user: 'yes' }, 'user'), {
			focus: 'dimmed',
			reason: 'user-miss',
		});
	});

	/* 一边脏不连累另一边：user 缺失，但 ai 明确为 true ⇒ 「AI 更新过」照样命中。 */
	it('user 缺失 + ai=true + mode=ai ⇒ normal / ai-hit', () => {
		assert.deepEqual(focusOf({ ai: true }, 'ai'), {
			focus: 'normal',
			reason: 'ai-hit',
		});
	});

	/*
	 * 推断（旧版不可达）：旧版 `updateFocus` 的类型只有 `'ai' | 'user' | ''`
	 * （`store.ts:241`），不认识的模式值不可能出现，所以旧版**没有**这条语义。
	 * 字面照搬旧代码会变成「全部淡化」，但那是「两个集合都空」的副作用，不是语义。
	 * ⇒ 不知道该淡哪一类时，**不施加视觉变化**（normal），并把原因单独标出来。
	 */
	it("mode='bogus'（未知模式）⇒ normal / unknown-focus", () => {
		assert.deepEqual(focusOf(flags(true, true), 'bogus'), {
			focus: 'normal',
			reason: 'unknown-focus',
		});
	});

	/* 推断同上：模式值大小写敏感，`'AI'` 不等于 `'ai'`。 */
	it("mode='AI'（大写）⇒ normal / unknown-focus", () => {
		assert.deepEqual(focusOf(flags(true, false), 'AI'), {
			focus: 'normal',
			reason: 'unknown-focus',
		});
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('自洽性与纯粹性', () => {
	/*
	 * 不变量：`focus === 'dimmed'` **当且仅当** reason 是 `*-miss`。
	 * 依据：旧版淡化选择器只认「有模式 且 没 is-update-hit」（`styles.css:3442`），
	 * 不存在「命中却淡化」或「没开模式却淡化」的组合。
	 */
	it('20 种组合：dimmed ⇔ reason 以 -miss 结尾', () => {
		for (const mode of ['none', '', 'ai', 'user', 'bogus']) {
			for (const ai of [true, false]) {
				for (const user of [true, false]) {
					const verdict = focusOf({ ai, user }, mode);
					assert.equal(
						verdict.focus === 'dimmed',
						verdict.reason.endsWith('-miss'),
						`mode=${mode} ai=${ai} user=${user} ⇒ ${verdict.focus}/${verdict.reason}`,
					);
				}
			}
		}
	});

	/* 纯函数：不读时钟、不改入参、同输入同输出（入参冻结后调用也不该抛）。 */
	it('入参冻结后调用不抛，且同输入结果稳定、入参没被改', () => {
		const unread = Object.freeze({ ai: true, user: false });

		const first = focusOf(unread, 'ai');
		const second = focusOf(unread, 'ai');

		assert.deepEqual(first, second);
		assert.deepEqual(unread, { ai: true, user: false });
		assert.deepEqual(focusOf(unread, 'user'), { focus: 'dimmed', reason: 'user-miss' });
	});
});
