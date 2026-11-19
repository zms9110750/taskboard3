/**
 * 卡片**筛选 / 搜索**的纯逻辑 —— 零 React、零 DOM、零网络。
 *
 * ## 为什么这一层必须存在
 *
 * 用户 `2026-11-19` 明确要求：
 *
 * > 「筛选/搜索后，不匹配的卡要**隐藏**（不是变淡）。」
 *
 * 「隐藏」在 React 里就是**不进 `map`** —— 列表只渲染通过判决的卡。
 * 把这个判决留在组件里会有两个后果：
 *
 * 1. 无法单测（`node --test` 跑不了 `.tsx`）；
 * 2. 「隐藏」和「变淡」的区别会散在 JSX 里，下一个人改样式时容易改成后者。
 *
 * ⇒ 判决全部在这里，`Workspace` 只调 `applyCardQuery()`。
 *
 * ## 形状从 `FilterBox` 的真实输出来，不是发明的
 *
 * `FilterRow` 的回调是 `onChange(id: string, next: Picked)`，其中
 * `Picked = readonly string[]` 是**从根往下的路径**（见 `pure/filter-box.ts`）。
 * ⇒ 一次筛选就是「每个 boxId 一条路径」，不是一个平铺的多选集合。
 *
 * | boxId | 路径的含义（`Workspace.tsx` 建树的方式）|
 * |---|---|
 * | `status` | `[TASK_STATE_*]` —— 状态框**一层平铺** |
 * | `kind` | `[kind]` —— 类别框一层平铺 |
 * | `domain` | `[领域]` / `[领域, 类别]` / `[领域, 类别, 模板 ref]` —— 三层 |
 *
 * ## 判决：路径必须是「这张卡在该树里的位置路径」的前缀
 *
 * 一张卡在每棵树里的位置是确定的：
 *
 * - 状态：`[card.status]`
 * - 类别：`[card.template.kind]`
 * - 领域：`[card.template.domain, card.template.kind, card.template.ref]`
 *
 * 用户选中一条路径 `picked`，它就必须是上面某条路径的**前缀**才匹配
 * ——「选了 核心›设计」= 领域是核心、类别是设计（模板不限），
 * 这正是面包屑筛选的语义。空路径 = 不约束。
 *
 * ⚠ **状态框现在是一层平铺**，所以卡的状态路径就是 `[card.status]`。
 *   哪天状态框改成「组 › 状态」两层（`草稿 / 进行 / 搁置 / 完成` 下面挂状态），
 *   只需要改 `cardPathsOf()` 里的一处：把状态路径写成
 *   `[STATUS_GROUP_OF[status], status]`。本文件其它地方不用动。
 *
 * ## 搜索匹配哪些字段
 *
 * | 字段 | 规则 | 为什么 |
 * |---|---|---|
 * | 标题 `card.title` | **子串**，大小写不敏感 | 「搜标题」是搜索框的默认预期 |
 * | 编号 `card.id` | **子串**，大小写不敏感 | 打 `C-0` 想看所有 `C-0x`，合法意图；和 `tree-filter.ts` 一致 |
 *
 * ⚠ 大小写不敏感：编号是**大写字母 + 数字**（`core/src/ids.ts` 的 `nextId`），
 *   用户手打小写 `c-03` 也应该命中。标题里中文 `toLowerCase()` 是恒等，无副作用。
 *
 * ## ⚠ 搜索过滤 vs 回车跳转：**两种匹配强度**（接线裁决 `2026-11-20`）
 *
 * | 用途 | 匹配方式 | 函数 |
 * |---|---|---|
 * | 搜索过滤（决定哪些卡可见）| 标题子串 + **编号子串** | `searchCards()` |
 * | 回车 / 点「前往」跳转（决定打开哪张）| **编号精确** | `findCardByQuery()` |
 *
 * 理由：搜索过滤时用户打 `C-0` 想看所有 `C-0x`，这是**正常**行为（继续打字
 * 就收敛）；而「输入完整编号后回车」的意图是**指认唯一一张**，输一半不能跳。
 *
 * ⚠ 列表视图和科技树视图是同一个产品的两个视图，**搜索过滤必须给同一结果集**
 *   —— 否则切视图会「怎么少了几张」（不报错的那种坏）。所以过滤这边对齐
 *   `pure/tree-filter.ts` 的 `matchesSearch()`（编号也是子串）；跳转保持精确。
 *
 * ## 搜不到 ⇒ **空数组**
 *
 * 绝不回落成「全部返回」。空结果是能看见的（`Workspace` 画空态），
 * 悄悄返回全部会让人以为筛选坏了。
 */

import type { Card } from '../types.ts';
import type { Picked } from './filter-box.ts';

/* ══════════════════════════════════════════════════════════
   筛选条件
   ══════════════════════════════════════════════════════════ */

/**
 * 一次筛选 —— **就是三个 `FilterBox` 各自选中的路径**。
 *
 * 键名就是 `Workspace` 传给 `FilterRow` 的 `boxId`（`'status'` / `'kind'` /
 * `'domain'`），所以「哪个框的变化对应哪个字段」不需要第二张映射表。
 */
export interface CardFilter {
	/** 状态框的选中路径（`[]` = 不筛选）。 */
	readonly status: Picked;
	/** 类别框的选中路径。 */
	readonly kind: Picked;
	/** 领域框的选中路径（最多三层：领域 › 类别 › 模板）。 */
	readonly domain: Picked;
}

/** 什么都不筛。三个都空。 */
export const EMPTY_FILTER: CardFilter = Object.freeze({
	status: [],
	kind: [],
	domain: [],
});

/**
 * `Workspace` 的 `picked` 记录（boxId → 路径）→ 筛选条件。
 *
 * ⚠ 缺的键当空路径（= 不约束）。这样「只 seed 了领域框」这种预览初始态也不会炸。
 *
 * @param picked boxId → 选中路径
 */
export function filterOfPicked(picked: Readonly<Record<string, Picked>>): CardFilter {
	return {
		status: picked['status'] ?? [],
		kind: picked['kind'] ?? [],
		domain: picked['domain'] ?? [],
	};
}

/**
 * 有没有任何一个框在筛。
 *
 * @param filter 筛选条件
 */
export function isFilterActive(filter: CardFilter): boolean {
	return (
		filter.status.length > 0 || filter.kind.length > 0 || filter.domain.length > 0
	);
}

/* ══════════════════════════════════════════════════════════
   路径匹配
   ══════════════════════════════════════════════════════════ */

/**
 * `picked` 是不是 `path` 的前缀（逐段全等）。
 *
 * 空前缀恒真 —— 「没选」就是不约束。
 *
 * @param picked 用户选中的路径
 * @param path 一张卡在对应树里的位置路径
 */
export function isPathPrefixOf(picked: Picked, path: readonly string[]): boolean {
	if (picked.length > path.length) return false;
	for (let index = 0; index < picked.length; index += 1) {
		if (picked[index] !== path[index]) return false;
	}
	return true;
}

/** 一张卡在三棵树里的位置路径。 */
interface CardPaths {
	readonly status: readonly string[];
	readonly kind: readonly string[];
	readonly domain: readonly string[];
}

/**
 * 取卡的位置路径。
 *
 * ⚠ **状态那一行是「状态框改成两层」时唯一要改的地方**（见文件头）。
 *
 * @param card 一张卡
 */
function cardPathsOf(card: Card): CardPaths {
	return {
		status: [card.status],
		kind: [card.template.kind],
		domain: [card.template.domain, card.template.kind, card.template.ref],
	};
}

/**
 * 这张卡过不过当前筛选。
 *
 * 三个框是 **AND**：都选了就都要满足（面包屑越深，约束越强）。
 *
 * @param card 一张卡
 * @param filter 筛选条件
 */
export function isCardInFilter(card: Card, filter: CardFilter): boolean {
	const paths = cardPathsOf(card);
	return (
		isPathPrefixOf(filter.status, paths.status) &&
		isPathPrefixOf(filter.kind, paths.kind) &&
		isPathPrefixOf(filter.domain, paths.domain)
	);
}

/* ══════════════════════════════════════════════════════════
   筛选 / 搜索
   ══════════════════════════════════════════════════════════ */

/**
 * 按筛选条件过滤（**保持原顺序**）。
 *
 * 没有条件时**原样返回入参**（同一个数组引用）—— 调用方可以据此跳过重渲染。
 *
 * @param cards 全量卡（顺序 = 显示顺序）
 * @param filter 筛选条件
 */
export function filterCards(cards: readonly Card[], filter: CardFilter): readonly Card[] {
	if (!isFilterActive(filter)) return cards;
	return cards.filter((card) => isCardInFilter(card, filter));
}

/** 查询词归一化：去首尾空格 + 小写。 */
function normalizeQuery(query: string): string {
	return query.trim().toLowerCase();
}

/**
 * 有没有实际搜索词（纯空格不算）。
 *
 * @param query 输入框原始值
 */
export function isQueryActive(query: string): boolean {
	return normalizeQuery(query) !== '';
}

/**
 * 这张卡命中搜索词吗。
 *
 * 规则见文件头：标题**子串**、编号**子串**，都大小写不敏感。
 * （跳转用的 `findCardByQuery()` 是**编号精确**，那是另一套强度，别混。）
 *
 * @param card 一张卡
 * @param query 输入框原始值
 */
export function isCardMatched(card: Card, query: string): boolean {
	const wanted = normalizeQuery(query);
	if (wanted === '') return true;
	return card.id.toLowerCase().includes(wanted) || card.title.toLowerCase().includes(wanted);
}

/**
 * 按搜索词过滤（**保持原顺序**）。
 *
 * - 空词 / 纯空格 ⇒ **原样返回入参**（不过滤）
 * - 搜不到 ⇒ **空数组**（不是返回全部）
 *
 * @param cards 全量卡（顺序 = 显示顺序）
 * @param query 输入框原始值
 */
export function searchCards(cards: readonly Card[], query: string): readonly Card[] {
	if (!isQueryActive(query)) return cards;
	return cards.filter((card) => isCardMatched(card, query));
}

/**
 * 两者叠加：**先筛选，后搜索**。
 *
 * 顺序不影响结果集（两个判决都是逐卡的），但先筛选让搜索只在可见卡里跑，
 * 语义上也更直观：搜索的是「筛选之后你正在看的那一堆」。
 *
 * @param cards 全量卡（顺序 = 显示顺序）
 * @param filter 筛选条件
 * @param query 输入框原始值
 */
export function applyCardQuery(
	cards: readonly Card[],
	filter: CardFilter,
	query: string,
): readonly Card[] {
	return searchCards(filterCards(cards, filter), query);
}

/**
 * 按**完整编号**找一张卡 —— 「输入完整编号后回车 ⇒ 打开那张卡的详情」。
 *
 * 语义与搜索不同：这里**只认编号**（不匹配标题），且必须完整。
 * 找不到返回 `null`（调用方保持原选中不变）。
 *
 * @param cards 全量卡（**不受当前筛选影响** —— 编号是唯一标识，不该被筛选挡住）
 * @param query 输入框原始值
 */
export function findCardByQuery(cards: readonly Card[], query: string): Card | null {
	const wanted = normalizeQuery(query);
	if (wanted === '') return null;
	return cards.find((card) => card.id.toLowerCase() === wanted) ?? null;
}

/* ══════════════════════════════════════════════════════════
   空态原因
   ══════════════════════════════════════════════════════════ */

/** 列表为什么是空的。 */
export type EmptyReason = 'space-empty' | 'filter' | 'search' | 'both';

/**
 * 列表空了的**原因** —— 决定空态文案。
 *
 * 为什么要在纯逻辑里判：空态文案是「用户看到的唯一解释」，
 * 判错了（比如筛出来 0 条却说「这个空间还没有卡」）会让人以为数据丢了。
 *
 * @param total 这个空间一共有多少卡（**过滤前**）
 * @param filter 筛选条件
 * @param query 输入框原始值
 */
export function emptyReasonOf(
	total: number,
	filter: CardFilter,
	query: string,
): EmptyReason {
	if (total === 0) return 'space-empty';
	const byFilter = isFilterActive(filter);
	const bySearch = isQueryActive(query);
	if (byFilter && bySearch) return 'both';
	if (byFilter) return 'filter';
	if (bySearch) return 'search';
	/*
	 * 有卡、没条件，却来问「为什么空」—— 说明调用方在过滤结果为空时才问。
	 * 这个分支不该被走到；回落成「空间没有卡」是最不会误导人的答案。
	 */
	return 'space-empty';
}
