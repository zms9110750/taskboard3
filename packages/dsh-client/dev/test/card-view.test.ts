/**
 * `pure/card-view.ts` 的测试 —— 纯函数，零 DOM。
 *
 * 每条都对应旧版某个函数的行为，或者一个已知的边界。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	KIND_ORDER,
	cardTimes,
	fmtDate,
	fmtDateTime,
	isDraftStatus,
	isEndedStatus,
	isKnownKind,
	kindTone,
	stateLabel,
	stateTone,
	unreadSide,
} from '../pure/card-view.ts';

/* 常见状态全名，省得每处写长串 */
const S = {
	draft: 'TASK_STATE_UNSPECIFIED',
	submitted: 'TASK_STATE_SUBMITTED',
	working: 'TASK_STATE_WORKING',
	inputRequired: 'TASK_STATE_INPUT_REQUIRED',
	authRequired: 'TASK_STATE_AUTH_REQUIRED',
	completed: 'TASK_STATE_COMPLETED',
	failed: 'TASK_STATE_FAILED',
	canceled: 'TASK_STATE_CANCELED',
	rejected: 'TASK_STATE_REJECTED',
} as const;

/* ══════════════════════════════════════════════════════════ */
describe('stateTone —— 9 个状态 = 9 个视觉档位', () => {
	/*
	 * 用户 `2026-11-18`：
	 * > 「颜色语义，我希望需要授权是紫色的。这个表示神秘的东西。绿色的成功，红色的失败，
	 * >  黄色的需要信息。橙色的拒绝，褐色（棕色）的取消。青色的处理中，黑色的提交。
	 * >  灰色的草稿。」
	 *
	 * ⇒ 一状态一色。**下面每条「两个必须不同」的断言，在改动之前都是「两个必须相同」** ——
	 *   它们就是这个改动本身的验收。
	 */

	it('灰：未指定 ⇒ unspecified', () => {
		assert.equal(stateTone(S.draft), 'unspecified');
	});

	it('黑：提交 ⇒ submitted', () => {
		assert.equal(stateTone(S.submitted), 'submitted');
	});

	it('青：处理中 ⇒ working', () => {
		assert.equal(stateTone(S.working), 'working');
	});

	it('黄：需要信息 ⇒ inputRequired', () => {
		assert.equal(stateTone(S.inputRequired), 'inputRequired');
	});

	it('紫：需要授权 ⇒ authRequired', () => {
		assert.equal(stateTone(S.authRequired), 'authRequired');
	});

	it('绿：成功 ⇒ completed', () => {
		assert.equal(stateTone(S.completed), 'completed');
	});

	it('红：失败 ⇒ failed', () => {
		assert.equal(stateTone(S.failed), 'failed');
	});

	it('褐：取消 ⇒ canceled', () => {
		assert.equal(stateTone(S.canceled), 'canceled');
	});

	it('橙：拒绝 ⇒ rejected', () => {
		assert.equal(stateTone(S.rejected), 'rejected');
	});

	it('⚠ 提交 ≠ 处理中（旧版同蓝，现在黑 / 青）', () => {
		assert.notEqual(stateTone(S.submitted), stateTone(S.working));
	});

	it('⚠ 需要信息 ≠ 需要授权（旧版同橙，现在黄 / 紫）', () => {
		assert.notEqual(stateTone(S.inputRequired), stateTone(S.authRequired));
	});

	it('⚠ 失败 ≠ 拒绝（旧版同红，现在红 / 橙）', () => {
		assert.notEqual(stateTone(S.failed), stateTone(S.rejected));
	});

	it('⚠ 九个状态的档位**两两互不相同**（本次改动的核心验收）', () => {
		const tones = Object.values(S).map((one) => stateTone(one));
		assert.equal(tones.length, 9);
		assert.equal(new Set(tones).size, 9);
	});

	it('未知状态 ⇒ unspecified（最淡，不引人注意）', () => {
		assert.equal(stateTone('TASK_STATE_WAT'), 'unspecified');
		assert.equal(stateTone(''), 'unspecified');
	});
});

describe('stateLabel', () => {
	it('已知状态给中文', () => {
		assert.equal(stateLabel(S.draft), '未指定');
		assert.equal(stateLabel(S.submitted), '提交');
		assert.equal(stateLabel(S.completed), '成功');
	});

	it('⚠ 未知状态去掉前缀，不编中文', () => {
		assert.equal(stateLabel('TASK_STATE_WAT'), 'WAT');
	});

	it('连前缀都没有就原样返回', () => {
		assert.equal(stateLabel('garbage'), 'garbage');
	});
});

describe('isDraftStatus / isEndedStatus', () => {
	it('草稿组只有未指定', () => {
		assert.equal(isDraftStatus(S.draft), true);
		assert.equal(isDraftStatus(S.submitted), false);
	});

	it('收尾组有四个', () => {
		for (const key of ['completed', 'failed', 'canceled', 'rejected'] as const) {
			assert.equal(isEndedStatus(S[key]), true, key);
		}
		assert.equal(isEndedStatus(S.working), false);
	});

	it('未知状态两个都 false', () => {
		assert.equal(isDraftStatus('x'), false);
		assert.equal(isEndedStatus('x'), false);
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('KIND_ORDER / isKnownKind / kindTone', () => {
	it('四个分类，顺序固定', () => {
		assert.deepEqual([...KIND_ORDER], ['goal', 'design', 'work', 'record']);
	});

	it('isKnownKind 只认四个', () => {
		assert.equal(isKnownKind('goal'), true);
		assert.equal(isKnownKind('record'), true);
		assert.equal(isKnownKind('unknown'), false);
		assert.equal(isKnownKind(''), false);
	});

	it('⚠ 未知分类回落 record（灰）—— 让「不认识」看得见', () => {
		assert.equal(kindTone('unknown'), 'record');
	});

	it('已知分类原样返回', () => {
		assert.equal(kindTone('design'), 'design');
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('fmtDate / fmtDateTime', () => {
	/* 用一个确定的时间戳：2026-11-17 00:24 本地时间 */
	const base = new Date(2026, 10, 17, 0, 24, 5).getTime();

	it('MM-DD 补零', () => {
		assert.equal(fmtDate(base), '11-17');
	});

	it('MM-DD HH:mm 补零', () => {
		assert.equal(fmtDateTime(base), '11-17 00:24');
	});

	it('⚠ 0 / 负数 / undefined / NaN ⇒ 空串（不编默认值）', () => {
		assert.equal(fmtDate(0), '');
		assert.equal(fmtDate(-1), '');
		assert.equal(fmtDate(undefined), '');
		assert.equal(fmtDate(Number.NaN), '');
		assert.equal(fmtDateTime(0), '');
		assert.equal(fmtDateTime(undefined), '');
	});

	it('⚠ Infinity ⇒ 空串（不能抛 RangeError）', () => {
		assert.equal(fmtDate(Number.POSITIVE_INFINITY), '');
		assert.equal(fmtDateTime(Number.POSITIVE_INFINITY), '');
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('cardTimes —— 从 history 取时间', () => {
	it('空历史 ⇒ 两个都 undefined', () => {
		assert.deepEqual(cardTimes([]), { created: undefined, last: undefined });
	});

	it('只有 create ⇒ created 和 last 是同一个', () => {
		const t = cardTimes([{ at: 100, action: 'create' }]);
		assert.deepEqual(t, { created: 100, last: 100 });
	});

	it('多条历史 ⇒ last 取最后一条', () => {
		const t = cardTimes([
			{ at: 100, action: 'create' },
			{ at: 200, action: 'claim' },
			{ at: 300, action: 'transition' },
		]);
		assert.deepEqual(t, { created: 100, last: 300 });
	});

	it('⚠ 没有 create 记录 ⇒ created undefined，last 仍有', () => {
		const t = cardTimes([
			{ at: 100, action: 'claim' },
			{ at: 200, action: 'transition' },
		]);
		assert.deepEqual(t, { created: undefined, last: 200 });
	});

	it('⚠ create 不在第一条 ⇒ 仍然能找出来', () => {
		const t = cardTimes([
			{ at: 50, action: 'import' },
			{ at: 100, action: 'create' },
		]);
		assert.deepEqual(t, { created: 100, last: 100 });
	});

	it('⚠ at 不是数字 ⇒ 当 undefined（不返回垃圾值）', () => {
		const t = cardTimes([
			{ at: 'oops' as unknown as number, action: 'create' },
		]);
		assert.deepEqual(t, { created: undefined, last: undefined });
	});
});

/* ══════════════════════════════════════════════════════════ */
describe('unreadSide —— 未读亮哪一边', () => {
	/*
	 * 用户 2026-11-17：
	 * > 「然后你这个两边都改过是不可能的。这个东西是，一边改了而且另一边没读。
	 * >  他要改肯定会读啊。不点开读怎么改？」
	 *
	 * ⇒ 现实里两个不会同时为真。但数据层允许它是坏的（core 的 unreadAfter
	 *   只置位不清位，客户端漏调 markSeen 就写会造成两边都真）。
	 *   ⇒ 这里是唯一判决点。
	 */

	it('都没改 ⇒ none', () => {
		assert.equal(unreadSide({ ai: false, user: false }), 'none');
	});

	it('AI 改过我没读 ⇒ 左边', () => {
		assert.equal(unreadSide({ ai: true, user: false }), 'left');
	});

	it('我改过 AI 没读 ⇒ 右边', () => {
		assert.equal(unreadSide({ ai: false, user: true }), 'right');
	});

	it('⚠ 两边都真（脏数据）⇒ 只亮左边，不两边都亮', () => {
		/* 两边都亮会被误认为「选中」；且「我有未读」是用户能行动的信息。 */
		assert.equal(unreadSide({ ai: true, user: true }), 'left');
	});

	it('⚠ 返回值只有三种，不会同时返回两个', () => {
		const all = [
			unreadSide({ ai: true, user: true }),
			unreadSide({ ai: true, user: false }),
			unreadSide({ ai: false, user: true }),
			unreadSide({ ai: false, user: false }),
		];
		assert.equal(all.every((one) => ['left', 'right', 'none'].includes(one)), true);
	});
});

