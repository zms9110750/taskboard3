/**
 * 更新计数 —— 「AI 改过用户未读 / 用户改过 AI 未读」。
 *
 * ## 用户规则（`2026-11-10`）
 *
 * > `ai` = AI 改过、用户还没看过；
 * > `user` = 用户改过、AI 还没看过（AI/MCP 靠这个知道用户改了什么）。
 *
 * ⚠ **命名以「谁改的」为准**，不是「谁没看」。
 *
 * ## 两个数据源
 *
 * | 数据 | 从哪来 |
 * |---|---|
 * | 「谁改的」 | `Card.history[].actor`（`HistoryEntry.actor`） |
 * | 「看到哪儿了」 | `CardStore` 的 kv：`read:<cardId>:<reader>` → **历史下标（条数）** |
 *
 * ## 为什么已读游标不放卡上
 *
 * 卡是**共享的**（一个空间多会话读），而「看到哪儿了」是**每个读者各自的**。
 * 放卡上会让「用户看过」变成「所有人都看过」。
 * ⇒ 走 kv，键里带 reader。
 *
 * ## ⚠⚠ 游标是**历史下标**，不是时间戳（这是修过一次的真 bug）
 *
 * 曾经用「最新事件的 `at` 时间戳」当游标。那在**同一毫秒**内会永久漏掉改动：
 *
 * ```
 * 游标  = 1000      （标记已读到最新事件）
 * AI 改 = 1000      （同一毫秒又改了一次）
 * 1000 > 1000 ⇒ false ⇒ 这次改动永远不可见
 * ```
 *
 * 实测表现是**测试 flake**：103 次跑过 1 次失败，因为 `Date.now()` 的毫秒数
 * 是否撞上是运气。时间戳只适合给人看，**不适合做次序判断**。
 *
 * ⇒ 改用**历史下标**：`card.history` 是有序追加数组，下标天然全序，
 *   同毫秒多事件完全不打架。
 *
 * 语义也更准确：`markSeen` 表示「**我看到第 N 条事件了**」，
 * 比「我看到时刻 T 为止」更贴近事实。
 *
 * ## ⚠ 代价：依赖「history 只追加、不裁剪」
 *
 * 现在成立（`withHistory` 只 push）。**若将来要做历史裁剪，这套机制必须换掉** ——
 * 裁剪会让下标整体前移，已存的游标就指向错误的位置，表现为「旧的已读被当成未读」
 * 或更糟的「未读被当成已读」。
 *
 * 真到那时有两个方向：给事件发**单调递增序号**（存在每条 history 里，
 * 与数组位置解耦），或者改用「最后一条已见事件的唯一 id」。
 * 两者都要改 `HistoryEntry` 形状，所以现在不做。
 *
 * ## ⚠ 为什么不用 `Date.now()` 当游标
 *
 * 旧仓库的既定口径：
 *
 * > 打开之后又发生新事件 ⇒ 仍然算未读。
 *
 * 若存 `Date.now()`，那么「打开卡」这个动作本身会把「打开之后到达的新事件」
 * 也标记成已读（因为新事件的 at 可能 ≤ now）。那是错的。
 * 存「当前历史长度」就没有这个问题：它精确表示「我看过的那一瞬间有几条」。
 *
 * ## ⚠ `recompute` 事件不算「改过」
 *
 * 沿树重算只改**父卡状态**，那是机器推导，不是内容编辑。
 * 用户开卡看到的是内容，不是状态推演 —— 所以重算不该让卡变成「AI 改过未读」。
 * 否则一张父卡会随子任务状态变化不停地弹「AI 更新过」。
 */

import type { Failure } from '@taskboard/protocol';
import { ErrorCode, failure } from '@taskboard/protocol';

import type { Card } from './card.js';
import type { CardStore } from './ports.js';

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

/** 已读游标的 kv 键。 */
export function readCursorKey(cardId: string, reader: UpdateReader): string {
	return `read:${cardId}:${reader}`;
}

/**
 * 哪些 `action` **不算内容变更**（不参与更新计数）。
 *
 * - `recompute` —— 沿树重算，机器推导的状态变化，不是人/AI 编辑内容。
 */
const NON_CONTENT_ACTIONS: ReadonlySet<string> = new Set(['recompute']);

/** 一条历史是不是「内容变更」。 */
function isContentChange(action: string): boolean {
	return !NON_CONTENT_ACTIONS.has(action);
}

/**
 * 这个 actor 引发的**最后一条内容变更**的历史下标 + 1。
 *
 * 为什么 +1：让 `0` 能表示「从未改过」，与游标的「0 = 从未看过」同一个基准。
 * 直接返回下标的话，「从未改过」和「改在第 0 条」都是 `0`，分不开。
 *
 * @returns `0` = 这个 actor 从未改过这张卡
 */
export function lastChangeIndexBy(card: Card, actor: UpdateReader): number {
	for (let index = card.history.length - 1; index >= 0; index -= 1) {
		const entry = card.history[index];
		if (entry === undefined) continue;
		if (entry.actor !== actor) continue;
		if (!isContentChange(entry.action)) continue;
		return index + 1;
	}
	return 0;
}

/**
 * 读已读游标 —— **历史下标（条数）**。
 *
 * 不存在（从未看过）= `0`。
 *
 * ⚠ 旧实现返回 `-Infinity`（时间戳基准）；现在返回 `0`（下标基准）。
 *   两者都是「从未看过」，但只有 `0` 与下标可比。
 */
export function readCursor(store: CardStore, cardId: string, reader: UpdateReader): number {
	const raw = store.kvGet(readCursorKey(cardId, reader));
	if (raw === undefined) return 0;
	const value = Number(raw);
	/* 脏值（非数字 / 负数）当成从未看过 —— 不能让它把未读永久吃掉。 */
	return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * 算一个空间的两类更新 —— **同步纯逻辑**（存储的 kv 读取是同步的）。
 *
 * 同步是有意的：`search()` 也是同步的，它要在条件含 `updatedBy` 时算这个。
 *
 * @param cards 该空间全部卡（含墓碑 —— 墓碑也可能是「AI 改过未读」，由调用方决定要不要过滤）
 */
export function computeUpdates(cards: readonly Card[], store: CardStore): UpdatesResult {
	const ai: string[] = [];
	const user: string[] = [];

	for (const card of cards) {
		/*
		 * `ai` 类：AI 改过、**用户**未读 ⇒ 比的是「用户的游标」。
		 * `user` 类：用户改过、**AI** 未读 ⇒ 比的是「AI 的游标」。
		 *
		 * ⚠ 比较的是**下标**，不是时间。同毫秒多事件靠这个才不打架。
		 */
		if (lastChangeIndexBy(card, 'ai') > readCursor(store, card.id, 'user')) {
			ai.push(card.id);
		}
		if (lastChangeIndexBy(card, 'user') > readCursor(store, card.id, 'ai')) {
			user.push(card.id);
		}
	}

	return { ai, user };
}

/**
 * 标记一张卡被某个读者「看过」。
 *
 * ## 写的是「当前历史长度」，不是 `now()`、也不是最新事件的 at
 *
 * 语义是「**我看到第 N 条事件了**」：
 *
 * - 之后**追加**的事件（下标 ≥ N）都算未读 ⇒ 「打开之后又发生新事件」仍然算未读；
 * - 同毫秒追加也照样算未读 ⇒ 不再有 flake。
 *
 * @returns `seenUpTo` = 写入的游标（= 当时的历史条数）；卡不存在返回 `Failure`
 */
export async function markCardSeen(
	store: CardStore,
	card: Card | undefined,
	cardId: string,
	reader: UpdateReader,
): Promise<{ readonly ok: true; readonly seenUpTo: number } | Failure> {
	if (card === undefined) {
		return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
	}

	const seenUpTo = card.history.length;
	await store.kvSet(readCursorKey(cardId, reader), String(seenUpTo));
	return { ok: true, seenUpTo };
}
