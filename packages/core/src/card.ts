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
import { DRAFT, STATUS_GROUP_OF as STATUS_GROUP } from '@taskboard/protocol';

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
}

/** 一个持有者 + 它开始持有的时间。 */
export interface CardHolder {
	/** AI 的消息循环 id / 会话 id（用户代 AI 领取时也是它）。 */
	readonly holder: string;
	/** 开始持有的时间（毫秒）。 */
	readonly at: number;
}

/** 是否是草稿。 */
export function isDraft(card: Card): boolean {
	return card.status === DRAFT;
}

/** 是否已被墓碑标记。 */
export function isDeleted(card: Card): boolean {
	return card.deleted;
}

/** 卡当前属于哪个状态组。 */
export function groupOfCard(card: Card): StatusGroup {
	return STATUS_GROUP[card.status];
}

/** 追加一条历史（纯函数，返回新数组）。 */
export function withHistory(card: Card, entry: HistoryEntry): Card {
	return { ...card, history: [...card.history, entry] };
}

/** 改状态并记一条历史（纯函数）。 */
export function withStatus(
	card: Card,
	status: TaskState,
	action: string,
	at: number,
	actor: Actor,
	detail?: unknown,
): Card {
	return withHistory({ ...card, status }, {
		at,
		action,
		actor,
		...(detail === undefined ? {} : { detail }),
	});
}

/** 改任意字段（纯函数）。用于编辑路径，调用方保证不改 `id`。 */
export function withPatch(card: Card, patch: Partial<Omit<Card, 'id'>>): Card {
	return { ...card, ...patch, id: card.id };
}

/**
 * 卡是否"有效"（参与推导计算）。
 *
 * 用户 `2026-11-01 06:55`：「占位算的是"工作"且为"处理中"。目标的处理中是不算的。」
 * 用户 `2026-11-02 13:15`：「这里的计算都要是有效卡，就是进行，或者搁置。草稿是不算的。」
 *
 * ⇒ 有效 = 处于 `active` 或 `shelved` 组。
 */
export function isValidCard(card: Card): boolean {
	const group = groupOfCard(card);
	return group === 'active' || group === 'shelved';
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

/** 沿 `label` 找指向 `card` 的边（有向边反查用）。 */
export function incomingLinks(cards: readonly Card[], to: CardId, label: LinkKindId): readonly Card[] {
	return cards.filter((card) => card.relations.links.some((link) => link.label === label && link.to === to));
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
