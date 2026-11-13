/**
 * 搜索 —— **纯函数**，给全部卡，返回筛选并排序后的卡。
 *
 * ## 为什么并入 core
 *
 * 用户裁定：「搜索并入 core，`packages/search` 整个包取消。」
 *
 * 并入之后，原来的两个迂回全部消失：
 *
 * | 原来 | 现在 |
 * |---|---|
 * | 影子类型 `SearchableCard`（结构上兼容 `Card`） | 直接用 `Card` —— 只有一份形状 |
 * | `createSearch({ groupOf })` 必传注入 | 直接 import `STATUS_GROUP_OF` —— 只有一份映射 |
 * | 字段名 `template` / `templateRef` 两边不一致 | 统一 `templateRef`（这曾是静默失效的 bug） |
 *
 * **仍然允许替换**：「并入 core」不等于「不能换」。`core` 的
 * `TaskboardOptions.search` 保留，接口 `SearchStrategy` 不变。
 *
 * ## 一条铁律：纯函数
 *
 * 不读文件、不读环境变量、不碰 `Date.now()`、不 mutate 入参。
 * 同一输入永远同一输出 —— 这是「可替换搜索实现」的前提。
 *
 * ## 排序
 *
 * 按「**采纳时间 ?? 创建时间**」倒序（用户 `2026-11-08` 规则 5：
 * 「排序函数对草稿使用创建时间进行排序」）。
 *
 * ⚠ `Card` **没有** `adoptedAt` / `createdAt` 字段 —— 时间信息在 `history` 里。
 * 旧 search 包假设卡上有这两个字段，那条假设在 core 的 `Card` 上会**静默失效**
 * （排序永远是输入顺序）。这里改成**从 history 派生**：
 *
 *   · `adoptedAt` = 历史里 `action === 'adopt'` 的最早 `at`；
 *   · `createdAt` = 历史里 `action === 'create'` 的 `at`，没有就用 `history[0].at`。
 *
 * 这就是「并入 core」的真正收益：**两边字段名不一致的坑只有一个地方能踩。**
 *
 * ## 草稿可见性
 *
 * 用户 `2026-11-08` 规则 1 / 2 / 4：
 *
 * | 条件 | 候选集含草稿？ |
 * |---|---|
 * | 无 `status` 筛选 | ❌ 不含（规则 1：「草稿在无参数下搜不到」） |
 * | `status` 含草稿 id 或组 id `draft` | ✅ 含 |
 * | `status` 只含其它状态 | ❌ 不含 |
 */

import type { Card } from './card.js';
import type { SearchCondition, SearchStrategy } from './ports.js';
import {
	DRAFT,
	STATUS_GROUP_OF,
	isTaskState,
	type StatusGroup,
	type TaskState,
} from '@taskboard/protocol';

/**
 * 草稿状态 id —— 直接从 protocol 的 `TaskState` 取，**不写字面量**。
 *
 * 旧实现写的是 `'TASK_STATE_UNSPECIFIED'` 字符串；并入 core 后改成引用常量，
 * 协议改名时会编译失败而不是静默失配。
 */
export const DEFAULT_DRAFT_STATE: string = DRAFT;

/** 组名值域（也是 `status` 条件里可以写的组 id）。 */
export const STATUS_GROUPS = ['draft', 'active', 'shelved', 'ended'] as const;

/** 某个字符串是不是组 id。 */
export function isStatusGroup(value: string): boolean {
	return (STATUS_GROUPS as readonly string[]).includes(value);
}

/**
 * 状态 → 组名；未知状态返回 `undefined`。
 *
 * 旧 search 包靠调用方注入这个映射（它零 import）。并入 core 后直接用
 * protocol 的 `STATUS_GROUP_OF` —— **映射只有一份**，不存在漂移。
 */
function groupOfStatus(status: string): StatusGroup | undefined {
	return isTaskState(status) ? STATUS_GROUP_OF[status] : undefined;
}

/**
 * **草稿的可见性**（用户 `2026-11-08` 规则 1 / 2 / 4）。
 *
 * @param condition 搜索条件
 * @param draftState 草稿状态 id（缺省 A2A 的 `TASK_STATE_UNSPECIFIED`）
 */
export function includesDrafts(
	condition: SearchCondition,
	draftState: string = DEFAULT_DRAFT_STATE,
): boolean {
	const wanted = condition.status;
	if (wanted === undefined || wanted.length === 0) return false;
	return wanted.includes(draftState) || wanted.includes('draft');
}

/** 标题子串匹配：大小写不敏感，两侧空白忽略。空串 = 不筛（返回 `true`）。 */
export function titleMatches(title: string, needle: string | undefined): boolean {
	if (needle === undefined) return true;
	const query = needle.trim().toLocaleLowerCase();
	if (query === '') return true;
	return title.toLocaleLowerCase().includes(query);
}

/** 数组条件的 OR 判定：条件为空 ⇒ 不筛（`true`）。 */
function anyOf(values: readonly string[] | undefined, actual: string | undefined): boolean {
	if (values === undefined || values.length === 0) return true;
	if (actual === undefined) return false;
	return values.includes(actual);
}

/**
 * 状态条件判定：元素可以是状态 id，也可以是组 id。
 *
 * 例：`status: ['active']` 命中「提交」与「处理中」；
 *     `status: ['TASK_STATE_WORKING']` 只命中处理中。
 */
function statusMatches(cardStatus: string, wanted: readonly string[] | undefined): boolean {
	if (wanted === undefined || wanted.length === 0) return true;
	if (wanted.includes(cardStatus)) return true;
	const group = groupOfStatus(cardStatus);
	return group !== undefined && wanted.includes(group);
}

/** 一张卡是否满足**除草稿可见性之外**的全部条件。 */
function cardMatches(card: Card, condition: SearchCondition): boolean {
	if (!titleMatches(card.title, condition.title)) return false;
	if (!statusMatches(card.status, condition.status)) return false;
	if (!anyOf(condition.domain, card.template.domain)) return false;
	if (!anyOf(condition.kind, card.template.kind)) return false;
	if (!anyOf(condition.templateRef, card.template.ref)) return false;

	/*
	 * `updatedBy` 是**事件维度**：要历史事件 + 已读游标，搜索实现算不出来。
	 * 调用方把结果集通过 `updatedCardIds` 传进来，这里只做集合成员判定。
	 *
	 * ⚠ 给了 `updatedBy` 却没给 `updatedCardIds` ⇒ 视为「没有命中任何卡」，
	 *   而不是「不筛」—— 后者会静默返回全量，是最危险的错法。
	 */
	if (condition.updatedBy !== undefined && condition.updatedBy.length > 0) {
		const ids = condition.updatedCardIds;
		if (ids === undefined) return false;
		if (!ids.includes(card.id)) return false;
	}

	return true;
}

/**
 * 从 `history` 里派生出排序用的两个时间戳。
 *
 * ⚠ 这是**并入 core 后新增的映射**：旧 search 包假设卡上直接有
 * `adoptedAt` / `createdAt` 字段，而 core 的 `Card` 没有 —— 那条假设会让排序
 * 静默退化成输入顺序。见文件头注释。
 */
function timestampsOf(card: Card): { adoptedAt: number | null; createdAt: number | null } {
	let adoptedAt: number | null = null;
	let createdAtom: number | null = null;

	for (const entry of card.history) {
		if (entry.action === 'adopt' && adoptedAt === null) adoptedAt = entry.at;
		if (entry.action === 'create' && createdAtom === null) createdAtom = entry.at;
	}

	/* 没有 create 事件时回落最早的历史时间（至少能排序）。 */
	const createdAt = createdAtom ?? (card.history[0]?.at ?? null);
	return { adoptedAt, createdAt };
}

/** 排序键：`adoptedAt ?? createdAt ?? null`。 */
function sortKeyOf(card: Card): number | null {
	const { adoptedAt, createdAt } = timestampsOf(card);
	if (adoptedAt !== null && Number.isFinite(adoptedAt)) return adoptedAt;
	if (createdAt !== null && Number.isFinite(createdAt)) return createdAt;
	return null;
}

/**
 * 按「采纳时间 ?? 创建时间」**倒序**。
 *
 * 两个时间都没有的卡排在最后（保持它们之间的输入顺序）——
 * 它们不是"最旧"，只是"没有时间信息"，排最后最不误导。
 *
 * 用稳定排序并显式用输入下标做兜底比较，这样"两者都缺"时确实是输入顺序。
 */
function sortCards(cards: readonly Card[]): readonly Card[] {
	const indexed = cards.map((card, index) => ({ card, index, key: sortKeyOf(card) }));
	indexed.sort((a, b) => {
		if (a.key === null && b.key === null) return a.index - b.index;
		if (a.key === null) return 1;
		if (b.key === null) return -1;
		if (a.key !== b.key) return b.key - a.key;
		return a.index - b.index;
	});
	return indexed.map((one) => one.card);
}

/** `createSearch` 的可注入项。 */
export interface SearchOptions {
	/**
	 * 草稿状态 id。缺省 A2A v1.0.1 的 `TASK_STATE_UNSPECIFIED`。
	 *
	 * 旧实现把「状态 → 组名」也做成注入项（因为那个包零 import）。并入 core 后
	 * 那条注入不再需要 —— 映射直接 import，只有一份。**只留草稿 id 一个注入点**，
	 * 它用于「换一套状态词表」这种极端替换。
	 */
	readonly draftState?: string;
}

/**
 * 造一个搜索实现。
 *
 * @param options 只有 `draftState` 可注入；省略即可。
 * @returns 纯函数 `(cards, condition) => cards`
 */
export function createSearch(options: SearchOptions = {}): SearchStrategy {
	const draftState = options.draftState ?? DEFAULT_DRAFT_STATE;

	return (cards, condition) => {
		const draftsVisible = includesDrafts(condition, draftState);

		const matched: Card[] = [];
		for (const card of cards) {
			/* 草稿可见性先判 —— 它不看卡的其他字段，是最便宜的一道闸。 */
			if (!draftsVisible && card.status === draftState) continue;
			if (!cardMatches(card, condition)) continue;
			matched.push(card);
		}

		return sortCards(matched);
	};
}

/*
 * ⚠ `TaskState` 在这里被 import 但只在类型位置使用（`DEFAULT_DRAFT_STATE` 取的是
 * `DRAFT`）。显式 re-export 一个常量类型标记，避免「未使用 import」告警。
 */
export type DraftStateId = TaskState;
