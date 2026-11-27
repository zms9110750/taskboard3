/**
 * `src/pure/loop-judgment.ts` 的**全覆盖**测试（AGENTS 规则 6：import 源码 `.ts`）。
 *
 * 两个判定函数各自的正反例，外加最容易静默出错的三处：
 * · 未读读的是 `unread.user` 而不是 `unread.ai`（字段语义见 core 的 `updates.ts`）；
 * · 去重键带最近 history 时间戳（同一张卡再改一次要能再注入）；
 * · 「工作卡」的判定走 protocol 的状态分组（草稿 / 搁置 / 完结都不算）。
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { TaskState } from '@taskboard/protocol';

import {
	unreadDigestOf,
	unreadKeyOf,
	workDigestOf,
	WORK_DIGEST_LIMIT,
} from '../src/pure/loop-judgment.ts';
import { fakeCard, historyAt } from './fixtures.ts';

/* ────────────────────────────── unreadKeyOf ────────────────────────────── */

describe('unreadKeyOf', () => {
	test('没有 history ⇒ 编号@0（键仍然稳定）', () => {
		assert.equal(unreadKeyOf(fakeCard({ id: '7', history: [] })), '7@0');
	});

	test('取最近一条 history 的时间戳（乱序也对）', () => {
		assert.equal(unreadKeyOf(fakeCard({ id: '7', history: historyAt(3, 9, 5) })), '7@9');
	});

	test('同一张卡、更新的 history ⇒ 键必须变（否则再改一次会被当成已注入）', () => {
		const before = unreadKeyOf(fakeCard({ id: '7', history: historyAt(1) }));
		const after = unreadKeyOf(fakeCard({ id: '7', history: historyAt(1, 2) }));
		assert.notEqual(before, after);
	});
});

/* ─────────────────────────────── 未读注入 ─────────────────────────────── */

describe('unreadDigestOf', () => {
	test('没有未读 ⇒ null（宿主什么都不做）', () => {
		const cards = [fakeCard({ id: '1' }), fakeCard({ id: '2' })];
		assert.equal(unreadDigestOf(cards, new Set()), null);
	});

	test('unread.user ⇒ 一条注入文案 + 对应的去重键', () => {
		const card = fakeCard({ id: '3', title: '补一句验收标准', unread: { ai: false, user: true } });
		const digest = unreadDigestOf([card], new Set());

		assert.ok(digest !== null);
		assert.match(digest.text, /^\[任务板\] 你有未读更新：/);
		assert.match(digest.text, /3 补一句验收标准/);
		assert.match(digest.text, /用户回答\/修改了它，请查看后继续。$/);
		assert.deepEqual(digest.keys, ['3@1']);
	});

	test('只有 unread.ai 不算 —— 那是给用户看的角标，不是给 AI 的未读', () => {
		const card = fakeCard({ id: '3', unread: { ai: true, user: false } });
		assert.equal(unreadDigestOf([card], new Set()), null);
	});

	test('已注入过的键 ⇒ null（不重复打扰）', () => {
		const card = fakeCard({ id: '3', unread: { ai: false, user: true } });
		assert.equal(unreadDigestOf([card], new Set([unreadKeyOf(card)])), null);
	});

	test('同一张卡又被改了一次（history 更新）⇒ 再注入一次', () => {
		const first = fakeCard({ id: '3', unread: { ai: false, user: true }, history: historyAt(1) });
		const injected = new Set([unreadKeyOf(first)]);

		const again = fakeCard({ id: '3', unread: { ai: false, user: true }, history: historyAt(1, 2) });
		const digest = unreadDigestOf([again], injected);

		assert.ok(digest !== null, '新的 history ⇒ 新键 ⇒ 必须再注入');
		assert.deepEqual(digest.keys, ['3@2']);
	});

	test('多张未读 ⇒ 一条文案列全部，键全给（措辞用「它们」）', () => {
		const cards = [
			fakeCard({ id: '1', title: '甲', unread: { ai: false, user: true } }),
			fakeCard({ id: '2', title: '乙', unread: { ai: false, user: true } }),
		];
		const digest = unreadDigestOf(cards, new Set());

		assert.ok(digest !== null);
		assert.match(digest.text, /1 甲、2 乙/);
		assert.match(digest.text, /修改了它们/);
		assert.deepEqual(digest.keys, ['1@1', '2@1']);
	});

	test('只挑未读的卡，已读的不进文案也不进键', () => {
		const cards = [
			fakeCard({ id: '1', unread: { ai: false, user: true } }),
			fakeCard({ id: '2' }),
			fakeCard({ id: '3', unread: { ai: false, user: true } }),
		];
		const digest = unreadDigestOf(cards, new Set());

		assert.ok(digest !== null);
		assert.doesNotMatch(digest.text, /2 卡 2/);
		assert.deepEqual(digest.keys, ['1@1', '3@1']);
	});

	test('空标题 ⇒ 只出编号（不留尾随空格）', () => {
		const card = fakeCard({ id: '5', title: '   ', unread: { ai: false, user: true } });
		const digest = unreadDigestOf([card], new Set());

		assert.ok(digest !== null);
		assert.match(digest.text, /更新：5——/);
	});

	test('纯函数：不往 injectedKeys 里写', () => {
		const injected = new Set<string>();
		const card = fakeCard({ id: '9', unread: { ai: false, user: true } });
		unreadDigestOf([card], injected);

		assert.equal(injected.size, 0, '记键是宿主的责任，判定函数只读');
	});
});

/* ─────────────────────────────── 工作泵 ─────────────────────────────── */

describe('workDigestOf', () => {
	test('没有卡 ⇒ null', () => {
		assert.equal(workDigestOf([]), null);
	});

	test('提交的 work 卡 ⇒ 泵文案（含编号 / 标题 / 状态中文名）', () => {
		const text = workDigestOf([
			fakeCard({ id: 'W1', title: '把守卫拆出来', status: TaskState.SUBMITTED }),
		]);

		assert.ok(text !== null);
		assert.match(text, /^\[任务板\] 可推进的工作：\n/);
		assert.match(text, /1\. W1 把守卫拆出来（提交）/);
	});

	test('处理中的 work 卡 ⇒ 也算', () => {
		const text = workDigestOf([fakeCard({ id: 'W2', title: '跑测试', status: TaskState.WORKING })]);
		assert.ok(text !== null);
		assert.match(text, /1\. W2 跑测试（处理中）/);
	});

	test('草稿 / 搁置 / 完结的 work 卡 ⇒ 都不算（走 protocol 的 active 分组）', () => {
		const idleStatuses = [
			TaskState.UNSPECIFIED,
			TaskState.INPUT_REQUIRED,
			TaskState.AUTH_REQUIRED,
			TaskState.COMPLETED,
			TaskState.FAILED,
			TaskState.CANCELED,
			TaskState.REJECTED,
		];
		for (const status of idleStatuses) {
			assert.equal(
				workDigestOf([fakeCard({ id: `X-${status}`, status })]),
				null,
				`${status} 不该算可推进的工作`,
			);
		}
	});

	test('非 work 类别 ⇒ 不算（目标 / 设计 / 记录在聊天里就能做，不需要推进）', () => {
		for (const kind of ['goal', 'design', 'record']) {
			const card = fakeCard({ id: 'N1', template: { kind }, status: TaskState.WORKING });
			assert.equal(workDigestOf([card]), null, `${kind} 不该算可推进的工作`);
		}
	});

	test(`超过 ${WORK_DIGEST_LIMIT} 条 ⇒ 只列前 ${WORK_DIGEST_LIMIT} 条，并说明还有几条`, () => {
		const cards = Array.from({ length: 6 }, (_, index) =>
			fakeCard({ id: `W${index + 1}`, title: `第 ${index + 1} 件` }),
		);
		const text = workDigestOf(cards);

		assert.ok(text !== null);
		for (let index = 1; index <= WORK_DIGEST_LIMIT; index += 1) {
			assert.match(text, new RegExp(`W${index} `));
		}
		assert.doesNotMatch(text, /W6 /);
		assert.match(text, /还有 1 条未列出/);
	});

	test('顺序按传入顺序（core 的 list 顺序），不重排', () => {
		const text = workDigestOf([
			fakeCard({ id: 'B' }),
			fakeCard({ id: 'A' }),
		]);
		assert.ok(text !== null);
		assert.match(text, /1\. B /);
		assert.match(text, /2\. A /);
	});

	test('workKinds 可覆盖（扩展行自定义类别时用）', () => {
		const chore = fakeCard({ id: 'C1', template: { kind: 'chore' } });

		assert.equal(workDigestOf([chore]), null, '默认只认 work');
		const text = workDigestOf([chore], ['chore']);
		assert.ok(text !== null);
		assert.match(text, /C1/);
	});
});
