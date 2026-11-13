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
 * | 「看到哪儿了」 | `CardStore` 的 kv：`read:<cardId>:<reader>` → 毫秒时间戳 |
 *
 * ## 为什么已读游标不放卡上
 *
 * 卡是**共享的**（一个空间多会话读），而「看到哪儿了」是**每个读者各自的**。
 * 放卡上会让「用户看过」变成「所有人都看过」。
 * ⇒ 走 kv，键里带 reader。
 *
 * ## ⚠ 已读游标的截止时间 = 「卡历史里最新事件的 `at`」，不是 `Date.now()`
 *
 * 旧仓库的既定口径：
 *
 * > 打开之后又发生新事件 ⇒ 仍然算未读。
 *
 * 若存 `Date.now()`，那么「打开卡」这个动作本身会把「打开之后到达的新事件」
 * 也标记成已读 —— 那是错的。
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
 * 这张卡里，某个 actor 引发的**最后一条内容变更**的时间。
 *
 * @returns `null` = 这个 actor 从未改过这张卡
 */
export function lastChangeBy(card: Card, actor: UpdateReader): number | null {
	let latest: number | null = null;
	for (const entry of card.history) {
		if (entry.actor !== actor) continue;
		if (!isContentChange(entry.action)) continue;
		if (latest === null || entry.at > latest) latest = entry.at;
	}
	return latest;
}

/**
 * 这张卡里**最后一条**（任何 actor 的）事件时间。
 *
 * 这是 `markSeen` 要写的截止时间 —— 不是 `Date.now()`。
 *
 * @returns `null` = 卡没有任何历史（不该发生：建卡必然写一条）
 */
export function latestEventAt(card: Card): number | null {
	let latest: number | null = null;
	for (const entry of card.history) {
		if (latest === null || entry.at > latest) latest = entry.at;
	}
	return latest;
}

/** 读已读游标（不存在 = 从未看过，视为 `-Infinity`）。 */
export function readCursor(store: CardStore, cardId: string, reader: UpdateReader): number {
	const raw = store.kvGet(readCursorKey(cardId, reader));
	if (raw === undefined) return Number.NEGATIVE_INFINITY;
	const value = Number(raw);
	return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
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
		 */
		const aiChangedAt = lastChangeBy(card, 'ai');
		if (aiChangedAt !== null && aiChangedAt > readCursor(store, card.id, 'user')) {
			ai.push(card.id);
		}

		const userChangedAt = lastChangeBy(card, 'user');
		if (userChangedAt !== null && userChangedAt > readCursor(store, card.id, 'ai')) {
			user.push(card.id);
		}
	}

	return { ai, user };
}

/**
 * 标记一张卡被某个读者「看过」。
 *
 * ## 写的是「最新事件的 at」，不是 `now()`
 *
 * 见文件头。返回值也是那个时间 —— 调用方可以据此显示「已读至 …」。
 *
 * @returns 游标写入的时间；卡不存在返回 `Failure`
 */
export async function markCardSeen(
	store: CardStore,
	card: Card | undefined,
	cardId: string,
	reader: UpdateReader,
): Promise<{ readonly ok: true; readonly at: number } | Failure> {
	if (card === undefined) {
		return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
	}

	const at = latestEventAt(card);
	if (at === null) {
		/* 没有历史 ⇒ 没有「看到哪儿」，视为已看到 0。 */
		await store.kvSet(readCursorKey(cardId, reader), '0');
		return { ok: true, at: 0 };
	}

	await store.kvSet(readCursorKey(cardId, reader), String(at));
	return { ok: true, at };
}
