/**
 * 消息循环判定 —— **纯函数，零宿主依赖**（不 import 任何 `@deepseek-ai/*`）。
 *
 * ## 这个模块负责什么
 *
 * `@taskboard/dsh-agent-loop` 的两种行为各自只要一个问题：
 *
 * | 函数 | 问题 | 消费者 |
 * |---|---|---|
 * | `unreadDigestOf` | 有没有「用户改过、AI 没看过」的卡 ⇒ 注入什么文案 | bus 事件（不唤醒） |
 * | `workDigestOf` | 有没有「提交 / 处理中」的工作卡 ⇒ 泵什么文案 | 定时器（`followup` 唤醒） |
 *
 * 判定留在纯函数里（AGENTS 规则 3）：`node --test` 能直接跑，宿主那一半只做
 * 「重拉 → 问判定 → 投递」。
 *
 * ## 用户裁定（`docs/ARCHIVE.md` §5，2026-11-28 —— #9 动机 1）
 *
 * > **唤醒机制否决。** 用户值守：用户作答后自己聊天进入消息循环，插件只做上下文注入；
 * > 无人值守：检查「提交」和「进行中」的工作卡 ⇒ 注入工作摘要 ⇒ 推进消息循环。
 *
 * ⇒ 本模块**只产文案**。投递方式（`inject` 不唤醒 / `followup` 排下一轮）在 `../index.ts`。
 *   **不做**「答案到达即唤醒」的定时器，也不解析总线消息的细节。
 *
 * ## ⚠ 未读读的是 `unread.user`，不是 `unread.ai`
 *
 * core 的字段名按「**谁改的**」命名（`packages/core/src/updates.ts:46-53`，`63-77` 的
 * `computeUpdates` 逐字印证）：
 *
 * | 字段 | 含义 | 与本包的关系 |
 * |---|---|---|
 * | `unread.user` | **用户**改过、**AI** 还没看过 | ✅ 该注入给 AI |
 * | `unread.ai` | **AI** 改过、**用户**还没看过 | ❌ 是给用户看的角标 |
 *
 * 裁定原文写的是「卡上出现『AI 未读』」，而注入文案是「用户回答/修改了它」；
 * 取 `unread.ai` 会让注入在 **AI 自己写完卡之后**触发，语义和文案都对不上。
 * ⇒ 按 `updates.ts` 的字段语义与 §5 取 `unread.user`。
 *
 * ## 「工作卡」怎么认（不自造状态判定）
 *
 * · **状态**：`groupOf(card.status) === 'active'` —— 走 `@taskboard/protocol` 的
 *   `STATUS_GROUP_OF`（`active` = 提交 + 处理中），不写死两个状态字面量。
 * · **类别**：`card.template.kind` 命中 `DEFAULT_WORK_KINDS`（内置 `work` 类别，
 *   `packages/core/src/template/kinds.ts:85-91`，`needsClaim: true`）。
 */

import { groupOf, labelOf, type TaskState } from '@taskboard/protocol';

/**
 * 判定需要的最小卡面。
 *
 * 用结构式声明而不是 import core 的 `Card`：
 * · 本包只读五个字段，多一个都不需要；
 * · `Taskboard.list()` 返回的 `Card[]` 结构上满足它 ⇒ 宿主那一半零转换；
 * · 纯模块的测试可以造对象，不必拖 SQLite / 内存 store 进来。
 */
export interface LoopCard {
	readonly id: string;
	readonly title: string;
	readonly status: TaskState;
	/** 卡的模板快照（`core/src/card.ts` 的 `TemplateRef`），只读 `kind`。 */
	readonly template: { readonly kind: string };
	/** 卡上的未读标记（`core/src/card.ts` 的 `CardUnread`）。 */
	readonly unread: { readonly ai: boolean; readonly user: boolean };
	/** 历史事件（只读 `at` 做去重键）。 */
	readonly history: readonly { readonly at: number }[];
}

/**
 * 一次未读注入的结果。
 *
 * 为什么不是裸字符串：宿主必须把「这次注入了哪些卡」记进内存 Set，
 * 否则下一次 bus 事件会把同一张卡再注入一遍。让判定把键一起交出来，
 * 才不会出现「文案里有的卡没记、记了的卡不在文案里」这种两处各算一遍的分叉。
 */
export interface UnreadDigest {
	/** 注入给 agent 的完整文案（`[任务板]` 前缀让模型分得清来源）。 */
	readonly text: string;
	/** 本次涉及的卡的去重键（宿主原样塞进已注入集合）。 */
	readonly keys: readonly string[];
}

/**
 * 一张卡的注入去重键 = **卡编号 + 最近一条 history 的时间戳**。
 *
 * 只按卡 id 去重会漏掉「同一张卡又被用户改了一次」——
 * 那正是最需要再注入一次的情况。带上最近时间戳，用户每次新的修改都会换键。
 *
 * `history` 为空（理论上的脏卡）时取 `0`，保证键稳定。
 *
 * ⚠ **同一毫秒内同一张卡被改两次** ⇒ 键相同，第二次不会单独注入。
 *   人手操作到不了这个粒度；真出现要升级成「history 长度」或事件计数
 *   （core 的 kv 游标就因为比时间戳踩过同毫秒漏改动的真 bug，见 `updates.ts` 文件头）。
 */
export function unreadKeyOf(card: LoopCard): string {
	let latest = 0;
	for (const entry of card.history) {
		if (entry.at > latest) latest = entry.at;
	}
	return `${card.id}@${latest}`;
}

/** 文案里的卡名：`<id> <标题>`；标题为空时只出 id（不留尾随空格）。 */
function nameOf(card: LoopCard): string {
	const title = card.title.trim();
	return title === '' ? card.id : `${card.id} ${title}`;
}

/**
 * 找「用户改过、AI 还没看过」且**没注入过**的卡，产出注入文案。
 *
 * @param cards 该工作空间的全部卡（`Taskboard.list()`，已排除墓碑）
 * @param injectedKeys 已注入过的去重键集合（宿主持有的内存 Set；本函数**只读**）
 * @returns 没有新未读时 `null`（宿主据此**什么都不做**，不定时器、不唤醒）
 */
export function unreadDigestOf(
	cards: readonly LoopCard[],
	injectedKeys: ReadonlySet<string>,
): UnreadDigest | null {
	const pending = cards.filter((card) => card.unread.user && !injectedKeys.has(unreadKeyOf(card)));
	if (pending.length === 0) return null;

	const pronoun = pending.length === 1 ? '它' : '它们';
	return {
		text: `[任务板] 你有未读更新：${pending.map(nameOf).join('、')}——用户回答/修改了${pronoun}，请查看后继续。`,
		keys: pending.map(unreadKeyOf),
	};
}

/**
 * 内置的「工作卡」类别 id。
 *
 * 来源：`packages/core/src/template/kinds.ts:85-91` 的 `BUILTIN_KINDS`，
 * `work` 是唯一 `needsClaim: true` 的内置类别。
 *
 * TODO(审查): 第三方注册的类别也可以声明 `needsClaim: true`（`KindRegistry`），
 *   但纯模块不碰注册表 ⇒ v1 只认内置 `work`。接上注册表的做法是宿主把
 *   `taskboard.kinds().list().filter(k => k.needsClaim).map(k => k.id)` 传进来；
 *   需用户确认「别的类别算不算可推进的工作」后再做。
 */
export const DEFAULT_WORK_KINDS: readonly string[] = Object.freeze(['work']);

/** 泵文案里最多列几张卡（用户裁定：「清单摘要，最多 5 条」）。 */
export const WORK_DIGEST_LIMIT = 5;

/**
 * 找「提交 / 处理中」的工作卡，产出泵文案。
 *
 * @param cards 该工作空间的全部卡
 * @param workKinds 算作工作卡的类别 id（默认 `DEFAULT_WORK_KINDS`；测试 / 扩展行可覆盖）
 * @returns 一张可推进的卡都没有时 `null`（宿主据此**什么都不做**，不 followup）
 */
export function workDigestOf(
	cards: readonly LoopCard[],
	workKinds: readonly string[] = DEFAULT_WORK_KINDS,
): string | null {
	const pending = cards.filter(
		(card) => workKinds.includes(card.template.kind) && groupOf(card.status) === 'active',
	);
	if (pending.length === 0) return null;

	const shown = pending.slice(0, WORK_DIGEST_LIMIT);
	const lines = shown.map((card, index) => `${index + 1}. ${nameOf(card)}（${labelOf(card.status)}）`);
	const rest = pending.length - shown.length;
	const tail = rest > 0 ? `\n……还有 ${rest} 条未列出。` : '';

	return `[任务板] 可推进的工作：\n${lines.join('\n')}${tail}`;
}
