/**
 * 任务卡 —— 类型与**纯函数**（不碰存储、不取时钟、不读环境）。
 *
 * ## 字段取舍（相对旧仓库的重新设计）
 *
 * | 旧字段 | 现在 | 为什么 |
 * |---|---|---|
 * | `relations.parent: CardId \| ''` | `parent: CardId \| null` | `''` 是一个"假的空值"，会让 `if (parent)` 这种判断静默正确、而 `parent === ''` 静默错误。用 `null`，类型系统就逼着调用方处理 |
 * | `sections: Record<id, {label, payload}>` | 同左 | 保留：`label` 是**模板章节名的副本**，模板被卸载后卡仍能显示 |
 * | `history: HistoryEntry[]` | 同左 | 保留 |
 * | `deleted: boolean` | 同左 | 墓碑是独立字段，不是状态值 |
 * | `claimedBy` / `claimedAt` 两个标量 | **`holders: CardHolder[]`** | 用户 `2026-11-13`：「现在不限制一个卡只能被一个拿」。一卡多人协作 ⇒ 持有者必须是列表，不是一个值 |
 *
 * ## 为什么 `sections` 的 key 是 sectionId 而不是 label
 *
 * 用户建卡时传的是 **label**（人写得出名字），但存的是 **id**（稳定、改 label 不破数据）。
 * 两者之间的映射只在建卡/编辑那一刻发生，之后卡自给自足。
 */

import type { Actor, LinkKindId, StatusGroup, TaskState } from '@taskboard/protocol';
import { STATUS_GROUP_OF as STATUS_GROUP } from '@taskboard/protocol';

/** 卡编号。不透明字符串 —— 本模块不解析格式、不从它反推任何东西。 */
export type CardId = string;

/** 工作空间 id。 */
export type WorkspaceId = string;

/**
 * 一张关系边。
 *
 * `label` 必须是 `protocol` 的 `LinkKindId`（五条边之一）。
 * 派生不在边表里 —— 它是 `parent` 字段。
 */
export interface RelationEntry {
	readonly label: LinkKindId;
	readonly to: CardId;
}

/** 关系集合。`parent` 是派生树，`links` 是其余五种边。 */
export interface Relations {
	/** 父卡编号；顶层为 `null`。 */
	readonly parent: CardId | null;
	readonly links: readonly RelationEntry[];
}

/**
 * 卡上的模板快照。**创建即固定** —— 模板改版不更新已建卡。
 *
 * `kind` / `domain` 是**快照**而不是回查：模板可以被卸载（mod 关闭），
 * 而卡必须能独立显示与筛选。
 */
export interface TemplateRef {
	readonly ref: string;
	readonly kind: string;
	readonly domain: string;
}

/** 卡上的一个章节。 */
export interface CardSection {
	/** 章节名的副本（模板卸载后仍能显示）。 */
	readonly label: string;
	/** action 的 payload。本模块**不校验内容**，只整体透传。 */
	readonly payload: unknown;
}

/**
 * 历史条目。
 *
 * `action` 是**封闭的机器可读标识**（英文），不是文案 —— 文案由 UI 按语言映射。
 * `at` 由 core 在写入时盖（卡本身不取时钟）。
 *
 * ## 为什么必须记 `actor`
 *
 * 用户 `2026-11-10` 的「更新计数」规则：
 *
 * > `ai` = AI 改过、用户还没看过；`user` = 用户改过、AI 还没看过
 * > （AI/MCP 靠这个知道用户改了什么）。
 *
 * 要算这个，必须知道**每条事件是谁引发的**。
 *
 * ## 为什么不能从 `action` 反推
 *
 * | 想当然的推断 | 实际 |
 * |---|---|
 * | `create` 一定是 user | **错** —— AI 工具能建卡（`origin: 'ai'`） |
 * | `claim` 一定是 ai | 错 —— 用户可以「代 AI 领取」（那是 user 点的） |
 * | `transition` 一定是 user | 错 —— AI 也能调工具转移 |
 *
 * ⇒ **作者是事件的固有属性，只能显式记。**
 */
export interface HistoryEntry {
	readonly at: number;
	readonly action: string;
	/**
	 * 谁引发的这条事件（不是卡属于谁）。
	 *
	 * 与 `Card.holders` 的分工：`holders` 只记「AI 现在持有这张卡」，
	 * 而**用户的操作没有别的字段能记** ⇒ 必须记在这里。
	 */
	readonly actor: Actor;
	readonly detail?: unknown;
}

/** 一张任务卡。 */
export interface Card {
	readonly id: CardId;
	readonly title: string;
	readonly status: TaskState;
	readonly template: TemplateRef;
	readonly relations: Relations;
	/** `{ [sectionId]: { label, payload } }`。 */
	readonly sections: Readonly<Record<string, CardSection>>;
	/** 追加备注。永远可写，不随采纳清空。 */
	readonly note: string;
	/**
	 * 建卡时间（毫秒）。建卡时盖，**终身不变**。
	 *
	 * ⚠ 这是卡的**固有属性**，不是从 `history` 派生出来的数据。
	 *   早期实现把它藏在 `history[0].at` 里 ⇒ 排序要扫历史、
	 *   而 `history` 可被追加/裁剪 ⇒ 不是稳定锚点。现在显式建模。
	 */
	readonly createdAt: number;
	/**
	 * 采纳时间；未采纳为 `null`。**采纳时盖，之后不变。**
	 *
	 * 排序首选它（「采纳时间 ?? 创建时间」倒序）。
	 *
	 * ⚠ 采纳（`adopt`）尚未实装。实装时必须在这一步写 `adoptedAt: deps.now`，
	 *   与 `history` 里那条 `action: 'adopt'` 用**同一个 `at`**。
	 */
	readonly adoptedAt: number | null;
	/** 只读追加。 */
	readonly history: readonly HistoryEntry[];
	/** 墓碑标记（独立字段，不是状态值）。 */
	readonly deleted: boolean;
	/**
	 * 当前持有的 AI 身份。**可以为多个** —— 同一张卡允许多人协作。
	 *
	 * 用户 `2026-11-13`：
	 * > 现在不限制一个卡只能被一个拿，应该就没问题了。
	 *
	 * ⚠ 旧模型是 `claimedBy` / `claimedAt` 两个标量字段（一卡一人）。
	 *   新模型把「谁持有」变成**列表**：两人可同时持有同一张卡。
	 *   `at` 是**那个人**开始持有的时间，不是卡的时间。
	 */
	readonly holders: readonly CardHolder[];
	/**
	 * 未读标记 —— 「对方改过，我还没读」。
	 *
	 * ⚠ **这是卡的字段，不是从 `history` + 外部游标算出来的**（用户 `2026-11-13`
	 *   「不能再用胶水代码了」）。维护点唯一：`withHistory`。
	 *   不变量由 `test/unread.test.ts` 的逐卡比对守着。
	 */
	readonly unread: CardUnread;
}

/** 一个持有者 + 它开始持有的时间。 */
export interface CardHolder {
	/** AI 的消息循环 id / 会话 id（用户代 AI 领取时也是它）。 */
	readonly holder: string;
	/** 开始持有的时间（毫秒）。 */
	readonly at: number;
}

/**
 * 未读标记 —— 「对方改过，我还没读」。
 *
 * ## 用户原话（`2026-11-13`）
 *
 * > 由于任务版2的需求里面出现了，**ai写过，我还没读。我写过，ai还没读。**
 * > 的这种对称的东西。所以这个东西**应该要有一个字段**。
 * > 但是是**存bool还是时间**，需要考虑。
 * > 但是，总之，他现在得**作为任务卡的字段**，不能再用胶水代码了。
 *
 * ## 为什么是 bool，不是时间 / 历史下标
 *
 * | 方案 | 为什么不 |
 * |---|---|
 * | 时间戳 | 同毫秒两次事件**分不出先后** ⇒ 会重现「看过之后又改，仍算已读」的 bug |
 * | 历史下标 | 仍然是**对 `history` 的派生** ⇒ 同一事实存两处；而且见下 |
 * | **bool** | 见下 |
 *
 * **读取是全有或全无的** —— 打开一张卡就看完了，没有「读了一半」。
 * ⇒ 「看到第几条」这个粒度**根本没有意义**。
 * ⇒ 这个字段要回答的问题只有两个答案，**不需要次序**，bool 就够。
 *
 * ⚠ 旧实现把这份信息拆成两处：卡上的 `history` + 卡外的 kv 游标。
 *   那是胶水 —— 卡删了 kv 会成孤儿、`computeUpdates` 要读 store 所以不是纯函数、
 *   为了次序判断还得比时间戳。现在它是**卡自己的字段**。
 */
export interface CardUnread {
	/** AI 改过、用户还没读。 */
	readonly ai: boolean;
	/** 用户改过、AI 还没读。 */
	readonly user: boolean;
}

/** 两个都没读。 */
export const UNREAD_NONE: CardUnread = Object.freeze({ ai: false, user: false });

/**
 * 哪些 `action` **不算「改过」**（不置未读）。
 *
 * - `recompute` —— 沿树重算，机器推导的状态变化，不是人/AI 编辑内容。
 *   若不排除，一张父卡会随子任务状态变化不停地弹「AI 更新过」。
 *
 * ⚠ 这条规则原来在 `updates.ts` 的 `NON_CONTENT_ACTIONS` 里；
 *   现在未读是卡的字段、由 `withHistory` 维护 ⇒ 规则跟着搬到这里。
 */
const NON_CONTENT_ACTIONS: ReadonlySet<string> = new Set(['recompute']);

/**
 * 一条历史之后，未读标记应该变成什么（纯函数）。
 *
 * | 事件的 `actor` | 置哪个未读 | 为什么 |
 * |---|---|---|
 * | `'ai'` | `ai: true` | AI 改过 ⇒ **用户**未读 |
 * | `'user'` | `user: true` | 用户改过 ⇒ **AI** 未读 |
 *
 * ⚠ 命名以**「谁改的」**为准（与 `updates()` 的返回值一致）。
 */
export function unreadAfter(unread: CardUnread, entry: HistoryEntry): CardUnread {
	/* 机器推导不算「改过」。 */
	if (NON_CONTENT_ACTIONS.has(entry.action)) return unread;
	if (entry.actor === 'ai') return unread.ai ? unread : { ...unread, ai: true };
	return unread.user ? unread : { ...unread, user: true };
}

/**
 * 清掉某个读者自己的未读标记（纯函数）。
 *
 * @param reader 谁读完了 —— `'user'` 清 `ai`（有人读掉了「AI 改过」）；`'ai'` 清 `user`
 * @returns 没变化时返回**同一个对象**（避免无谓的持久化）
 */
export function clearedUnread(unread: CardUnread, reader: 'user' | 'ai'): CardUnread {
	if (reader === 'user') return unread.ai ? { ...unread, ai: false } : unread;
	return unread.user ? { ...unread, user: false } : unread;
}

/** 卡当前属于哪个状态组。 */
export function groupOfCard(card: Card): StatusGroup {
	return STATUS_GROUP[card.status];
}

/**
 * 追加一条历史（纯函数）—— **`unread` 的唯一维护点**。
 *
 * ## 为什么在这里
 *
 * `unread` 是**增量维护的缓存**（不是从 history 现算的）。只要有一条路径
 * 绕过本函数直接改 `history`，`unread` 就会漂 —— 而漂了**不会报错**，
 * 只表现为「角标偶尔不对」。
 *
 * ⇒ 所有追加历史的路径都必须走这个函数。`index.ts` 里原来是
 * `history: [...existing.history, entry]` 的两处（update / remove）已改成调本函数。
 *
 * 守卫：`test/unread.test.ts` 的**不变量测试**逐卡比对
 * 「`card.unread`」与「按 `history` 重算的期望值」。
 */
export function withHistory(card: Card, entry: HistoryEntry): Card {
	return {
		...card,
		history: [...card.history, entry],
		unread: unreadAfter(card.unread, entry),
	};
}

/** 改任意字段（纯函数）。用于编辑路径，调用方保证不改 `id`。 */
// TODO(审查): `withPatch` 在 core 内零使用、index 也未导出（transition.ts 注释还把它当「用不到」的例子）⇒ 死代码，可直接删。
export function withPatch(card: Card, patch: Partial<Omit<Card, 'id'>>): Card {
	return { ...card, ...patch, id: card.id };
}

/** 卡是否处于终结态。 */
export function isEndedCard(card: Card): boolean {
	return groupOfCard(card) === 'ended';
}

/** 没有被墓碑标记的卡。 */
export function withoutDeleted(cards: readonly Card[]): readonly Card[] {
	return cards.filter((card) => !card.deleted);
}

/** 按 id 找卡（含墓碑；调用方要过滤就自己过滤）。 */
export function findCard(cards: readonly Card[], id: CardId): Card | undefined {
	return cards.find((card) => card.id === id);
}

/**
 * 一张卡在关系图里的"子卡"编号 —— 沿 `parent` 反向查。
 *
 * 注意这**不做递归**：只找直接子卡。递归由调用方决定深度，因为
 * 「沿树重算」和「沿边传播」是两套不同的触发时机。
 */
export function childIdsOf(cards: readonly Card[], parentId: CardId): readonly CardId[] {
	return cards.filter((card) => card.relations.parent === parentId).map((card) => card.id);
}

/* ────────────────────────── 持有者（多人协作） ────────────────────────── */

/** 某人是否持有这张卡。 */
export function isHeldBy(card: Card, holder: string): boolean {
	return card.holders.some((one) => one.holder === holder);
}

/** 全部持有者标识。 */
export function holderIdsOf(card: Card): readonly string[] {
	return card.holders.map((one) => one.holder);
}

/**
 * 追加一个持有者（纯函数）。
 *
 * **幂等**：同一个人重复持有不重复追加、不改他已记的开始时间
 * （「我什么时候开始做这件事」不该被重复点击刷新）。
 *
 * @returns `added: false` 表示本来就有，卡没变
 */
export function withHolder(card: Card, holder: string, at: number): { card: Card; added: boolean } {
	if (isHeldBy(card, holder)) return { card, added: false };
	return { card: { ...card, holders: [...card.holders, { holder, at }] }, added: true };
}

/**
 * 移除一个持有者（纯函数）。
 *
 * @returns `removed: false` 表示本来就没有
 */
export function withoutHolder(card: Card, holder: string): { card: Card; removed: boolean } {
	const next = card.holders.filter((one) => one.holder !== holder);
	if (next.length === card.holders.length) return { card, removed: false };
	return { card: { ...card, holders: next }, removed: true };
}


