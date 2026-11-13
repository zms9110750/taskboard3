/**
 * 匹配与排序 —— 本包的全部实现。
 *
 * ## 一条铁律：纯函数
 *
 * 不读文件、不读环境变量、不碰 `Date.now()`、不 mutate 入参。
 * 同一输入永远同一输出 —— 这是「可替换搜索实现」的前提：
 * 换一个实现，只要它的输入输出一致，调用方不需要改任何东西。
 *
 * ## 排序
 *
 * 按「**采纳时间 ?? 创建时间**」倒序（用户 `2026-11-08` 规则 5：
 * 「排序函数对草稿使用创建时间进行排序」）。
 *
 * ⚠ **两者都缺失时保持输入顺序** —— 这是占位：core 的 `Card` 定稿后
 * 应保证每张卡至少有一个时间戳。`test/match.test.ts` 有一条用例锁住
 * 「不因缺时间戳而丢卡」，但**不锁**具体顺序。
 *
 * ## 分组映射由调用方注入
 *
 * 本包零 import，拿不到 `protocol` 的 `STATUS_GROUP_OF` ⇒ 由 `createSearch`
 * 的 `groupOf` 必传项提供。见 `types.ts` 顶部。
 */

import type {
	SearchCondition,
	SearchOptions,
	SearchStrategy,
	SearchableCard,
	StatusGroupName,
} from './types.ts';

/**
 * 草稿状态 id —— A2A v1.0.1 的 `TASK_STATE_UNSPECIFIED`。
 *
 * ⚠ 与 `groupOf` 不同：这是**协议常量**，不是本包的私有映射表，
 * 所以给它默认值是安全的（不会产生"两份会漂的真值"）。
 */
export const DEFAULT_DRAFT_STATE = 'TASK_STATE_UNSPECIFIED';

/** 组名值域（也是 `status` 条件里可以写的组 id）。 */
export const STATUS_GROUPS = ['draft', 'active', 'shelved', 'ended'] as const;

/** 某个字符串是不是组 id。 */
export function isStatusGroup(value: string): boolean {
	return (STATUS_GROUPS as readonly string[]).includes(value);
}

/**
 * **草稿的可见性**（用户 `2026-11-08` 规则 1 / 2 / 4）。
 *
 * | 条件 | 候选集含草稿？ |
 * |---|---|
 * | 无 `status` 筛选 | ❌ 不含（规则 1：「草稿在无参数下搜不到」） |
 * | `status` 含草稿 id 或组 id `draft` | ✅ 含（规则 2 + 用户纠正「指定为"草稿"或者"未指定"时要包含」） |
 * | `status` 只含其它状态 | ❌ 不含 |
 *
 * ⚠ **这条规则由本包判，不由调用方判** —— 否则每个调用方各抄一份，
 *   改一处必然漂（判据 #15）。
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
function statusMatches(
	cardStatus: string,
	wanted: readonly string[] | undefined,
	groupOf: (status: string) => StatusGroupName | undefined,
): boolean {
	if (wanted === undefined || wanted.length === 0) return true;
	if (wanted.includes(cardStatus)) return true;
	const group = groupOf(cardStatus);
	return group !== undefined && wanted.includes(group);
}

/** 一张卡是否满足**除草稿可见性之外**的全部条件。 */
function cardMatches(
	card: SearchableCard,
	condition: SearchCondition,
	groupOf: (status: string) => StatusGroupName | undefined,
): boolean {
	if (!titleMatches(card.title, condition.title)) return false;
	if (!statusMatches(card.status, condition.status, groupOf)) return false;
	if (!anyOf(condition.domain, card.template?.domain)) return false;
	if (!anyOf(condition.kind, card.template?.kind)) return false;
	if (!anyOf(condition.template, card.template?.ref)) return false;

	/*
	 * `updatedBy` 是**事件维度**，本包算不出来（要历史事件 + 已读游标）。
	 * 调用方把结果集通过 `updatedCardIds` 传进来；本包只做集合成员判定。
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

/** 排序键：`adoptedAt ?? createdAt ?? null`。 */
function sortKeyOf(card: SearchableCard): number | null {
	if (typeof card.adoptedAt === 'number' && Number.isFinite(card.adoptedAt)) return card.adoptedAt;
	if (typeof card.createdAt === 'number' && Number.isFinite(card.createdAt)) return card.createdAt;
	return null;
}

/**
 * 按「采纳时间 ?? 创建时间」**倒序**。
 *
 * 两个时间都没有的卡排在最后（保持它们之间的输入顺序）——
 * 它们不是"最旧"，只是"没有时间信息"，排最后最不误导。
 *
 * 用**稳定排序**（`Array.prototype.sort` 在现代 V8 里是稳定的）并显式用
 * 输入下标做兜底比较，这样"两者都缺"时确实是输入顺序。
 */
function sortCards(cards: readonly SearchableCard[]): readonly SearchableCard[] {
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

/**
 * 造一个搜索实现。
 *
 * @param options `groupOf` **必传**（状态 → 组名映射，来自 protocol）；
 *                `draftState` 可选（缺省 A2A 的 `TASK_STATE_UNSPECIFIED`）。
 * @returns 纯函数 `(cards, condition) => cards`。
 */
export function createSearch(options: SearchOptions): SearchStrategy {
	const { groupOf } = options;
	const draftState = options.draftState ?? DEFAULT_DRAFT_STATE;

	return (cards, condition) => {
		const draftsVisible = includesDrafts(condition, draftState);

		const matched: SearchableCard[] = [];
		for (const card of cards) {
			/* 草稿可见性先判 —— 它不看卡的其他字段，是最便宜的一道闸。 */
			if (!draftsVisible && card.status === draftState) continue;
			if (!cardMatches(card, condition, groupOf)) continue;
			matched.push(card);
		}

		return sortCards(matched);
	};
}
