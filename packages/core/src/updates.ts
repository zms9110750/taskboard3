/**
 * 更新计数 —— 现在只是**读卡上的 `unread` 字段**，不是派生计算。
 *
 * ## 用户裁定（`2026-11-13`）
 *
 * > 由于任务版2的需求里面出现了，**ai写过，我还没读。我写过，ai还没读。**
 * > 的这种对称的东西。所以这个东西**应该要有一个字段**。
 * > 但是是**存bool还是时间**，需要考虑。
 * > 但是，总之，他现在得**作为任务卡的字段**，不能再用胶水代码了。
 *
 * ## 这个文件曾经是「派生计算」，现在只剩两个轻量操作
 *
 * 旧设计：卡上的 `history` + **卡外**的 kv 游标 `read:<cardId>:<reader>`，
 * 每次算更新都要读 store、扫 history、比时间戳/下标。
 *
 * 那是胶水：
 *
 * · **两处存储** —— 卡删了 kv 会成孤儿；
 * · `computeUpdates(cards, store)` 要读 store ⇒ **不是纯函数**，`search()` 也跟着不纯；
 * · 为了「次序判断」要比时间戳 ⇒ **同毫秒会永久漏掉改动**（真 bug，已修过一次）。
 *
 * ⇒ 现在未读是 `Card.unread`（bool 对），**字段本身就是真值**。
 *   本文件不再持有任何机制，只剩「读一遍、按条件挑 id」。
 *
 * ## 维护点在哪
 *
 * **`card.ts` 的 `withHistory`** —— 它是唯一往 `history` 追加事件的地方，
 * 也是唯一维护 `unread` 的地方。本文件只读不写。
 *
 * 守卫：`test/unread.test.ts` 的**不变量测试**逐卡比对
 * 「`card.unread`」与「按 `history` 重算的期望值」。
 */

import type { Failure } from '@taskboard/protocol';
import { ErrorCode, failure } from '@taskboard/protocol';

import type { Card, CardUnread } from './card.js';
import { clearedUnread } from './card.js';

/** 读者。`user` = 人，`ai` = 模型 / MCP。 */
export type UpdateReader = 'user' | 'ai';

/**
 * 两类更新的卡 id。
 *
 * 字段名按**「谁改的」**命名（用户口径）：
 * - `ai` —— AI 改过，**用户**还没看过；
 * - `user` —— 用户改过，**AI** 还没看过。
 */
export interface UpdatesResult {
	readonly ai: readonly string[];
	readonly user: readonly string[];
}

/**
 * 算一个空间的两类更新 —— **纯函数**，不碰存储。
 *
 * 旧签名是 `computeUpdates(cards, store)`；`store` 参数已删除 ——
 * kv 游标没了，未读就在卡上。
 *
 * @param cards 该空间全部卡（含墓碑 —— 墓碑也可能带未读标记，由调用方决定要不要过滤）
 */
export function computeUpdates(cards: readonly Card[]): UpdatesResult {
	const ai: string[] = [];
	const user: string[] = [];

	for (const card of cards) {
		/*
		 * `ai` 类：AI 改过、**用户**未读 ⇒ 看 `unread.ai`。
		 * `user` 类：用户改过、**AI** 未读 ⇒ 看 `unread.user`。
		 */
		if (card.unread.ai) ai.push(card.id);
		if (card.unread.user) user.push(card.id);
	}

	return { ai, user };
}

/**
 * 标记一张卡被某个读者「看过」—— **纯函数**，只清标记，不改 history。
 *
 * ## 为什么不清 history 里的事件
 *
 * 历史是**审计记录**，不是未读状态。读完了不代表那件事没发生过。
 * ⇒ 只翻 bool，history 一条不动。
 *
 * ## 只清「自己的」那一半
 *
 * | `reader` | 清哪个 | 为什么 |
 * |---|---|---|
 * | `'user'` | `unread.ai` | 用户读掉了「AI 改过」 |
 * | `'ai'` | `unread.user` | AI 读掉了「用户改过」 |
 *
 * ⇒ `markSeen('user')` **不动** `unread.user`（那是「用户改过、AI 未读」，
 *   只有 AI 读了才算清）。
 *
 * @returns `card` 未变时是**同一个对象**（调用方可据此跳过持久化）
 */
export function markCardSeen(
	card: Card | undefined,
	cardId: string,
	reader: UpdateReader,
): { readonly ok: true; readonly card: Card; readonly changed: boolean } | Failure {
	if (card === undefined) {
		return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
	}

	const unread: CardUnread = clearedUnread(card.unread, reader);
	if (unread === card.unread) return { ok: true, card, changed: false };
	return { ok: true, card: { ...card, unread }, changed: true };
}
