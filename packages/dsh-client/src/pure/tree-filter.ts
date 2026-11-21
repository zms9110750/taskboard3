/**
 * 科技树的**筛选 / 搜索** —— 纯逻辑：零 React、零 DOM、零网络、零 import（只有类型）。
 *
 * ## 为什么单独一个文件
 *
 * 用户 `2026-11-19` 对科技树明确要求：
 *
 * > 「筛选后，不匹配的卡**隐藏**」
 * > 「搜索后，不匹配的卡**隐藏**」
 *
 * ⚠ **是隐藏，不是变淡**。而「变淡」是 hover 的规则（无关的边淡到 25%，
 * 卡还在）。两件事必须分开写，否则很容易实现成同一种效果 ——
 * 这正是本任务书里被单独警告过的点。
 *
 * 「隐藏」的判据是「**这张卡还在不在渲染树里**」，不是 CSS 透明度。
 * 所以判决必须在纯函数里做完、单测钉住，渲染层只做 `if (!visible) 不画`。
 *
 * ## 两个概念别混
 *
 * | 概念 | 含义 | 谁用 |
 * |---|---|---|
 * | `visibleCardIds()` | 哪些卡**该出现** | 渲染层据此决定画不画 |
 * | `treeCardsOf()` | 只留可见卡后的**布局输入** | `layoutTree()` |
 *
 * 为什么布局输入要单独造：`layoutTree()` 的「孤儿」判据是「parent 指向不存在的卡」。
 * 如果直接把可见卡丢给它，**被筛掉的父卡会让子卡变成孤儿** ——
 * 树被打散、每张卡都顶个 ▲ 警告。所以：
 *
 * - parent **在真实数据里就不存在** ⇒ 保留 parent ⇒ 真孤儿，警告照出；
 * - parent 存在但**被筛掉了** ⇒ 提到根（parent=null）⇒ 筛选视图里是一棵干净的森林。
 *
 * ## 搜索的双重语义
 *
 * 用户 `2026-11-19`：「搜索回车 或 点『前往』⇒ 打开指定编号的详情」。
 *
 * ⇒ 搜索文本同时承担两件事：
 * 1. **过滤**（`visibleCardIds` 里按 id / 标题做包含匹配）；
 * 2. **精确跳转**（`jumpTargetOf` 里按**编号精确**匹配）。
 *
 * 两者判据不同：过滤是「包含」，跳转是「精确等于编号」。混成一个函数会让
 * 「输入一半就回车」跳到一张意外的卡上。
 */

import type { Picked } from './filter-box.ts';
import type { TreeCard } from './tree-layout.ts';

/* ══════════════════════════════════════════════════════════════
 * 一、类型
 * ══════════════════════════════════════════════════════════════ */

/**
 * 参与筛选 / 搜索的卡字段。
 *
 * ⚠ 这是**结构子集**，不是 `Card` 的别名：`src/types.ts` 的 `Card` 结构上满足它，
 *   但纯逻辑单测不需要造一整张卡（sections / history / unread …）。
 */
export interface FilterableCard {
	readonly id: string;
	readonly title: string;
	readonly status: string;
	readonly template: {
		readonly ref: string;
		readonly kind: string;
		readonly domain: string;
	};
	readonly relations: {
		readonly parent: string | null;
	};
}

/**
 * 科技树的筛选条件。
 *
 * 三个 `Picked` 是筛选框的**选中路径**（和 `pure/filter-box.ts` 同一套语义）：
 *
 * | 框 | 路径形状 | 例子 |
 * |---|---|---|
 * | 状态 | `[state]` | `['TASK_STATE_COMPLETED']` |
 * | 类别 | `[kind]` | `['design']` |
 * | 领域 | `[domain, kind?, ref?]` | `['核心']` / `['核心','design']` |
 *
 * 路径是**前缀**语义：`['核心','design']` 命中「核心 › 设计」下的**全部**模板。
 *
 * ⚠ 空数组 / 省略 = 这个框没选 ⇒ 不参与过滤（**不是**「什么都不命中」）。
 */
export interface TreeFilterCriteria {
	/*
	 * ⚠ 三个字段都写成 `?: Picked | undefined`（不是 `?: Picked`）：
	 *   `exactOptionalPropertyTypes: true` 下，渲染层从 `props.filter?.status`
	 *   拆出来的就是 `Picked | undefined`，要能原样拼回去。写成 `?: Picked`
	 *   会逼调用方写条件展开 —— 那是为了绕过类型检查，不是为了表达意图。
	 */
	readonly status?: Picked | undefined;
	readonly kind?: Picked | undefined;
	readonly domain?: Picked | undefined;
	/** 搜索框原文（未 trim）。空串 = 不搜索。 */
	readonly search?: string | undefined;
	/**
	 * 未读筛选 —— 用户 2026-11-21：「UI上面要有两个筛选按钮，AI未读，用户未读。」
	 *
	 * 'ai' = 只留 AI 未读的卡；'user' = 只留用户未读的卡；省略 = 不筛。
	 */
	readonly unread?: 'ai' | 'user' | undefined;
}

/** 什么都没选 —— 默认值（冻结，避免调用方改到共享对象）。 */
export const NO_TREE_FILTER: TreeFilterCriteria = Object.freeze({});

/* ══════════════════════════════════════════════════════════════
 * 二、路径匹配
 * ══════════════════════════════════════════════════════════════ */

/**
 * 选中路径是不是 `tuple` 的**前缀**。
 *
 * 空路径 = 没选 ⇒ **恒真**（没选就不该过滤掉任何卡）。
 *
 * @param picked 选中路径
 * @param tuple 这张卡在对应维度上的取值序列（如 `[domain, kind, ref]`）
 */
export function pathMatches(picked: Picked, tuple: readonly string[]): boolean {
	if (picked.length === 0) return true;
	/* 路径比取值还深（数据变了 / 脏路径）⇒ 不可能命中，别让它误伤。 */
	if (picked.length > tuple.length) return false;
	for (let index = 0; index < picked.length; index += 1) {
		if (picked[index] !== tuple[index]) return false;
	}
	return true;
}

/* ══════════════════════════════════════════════════════════════
 * 三、单卡判决
 * ══════════════════════════════════════════════════════════════ */

/**
 * 搜索文本 → 归一化（trim + 小写）。空串 ⇒ `''`。
 *
 * 大小写不敏感是**有意**的：编号 `GU01` 和小写 `gu01` 是同一张卡，
 * 用户不该因为按了 CapsLock 就搜不到。
 *
 * @param text 输入框原文
 */
export function normalizeSearch(text: string | undefined): string {
	return typeof text === 'string' ? text.trim().toLowerCase() : '';
}

/**
 * 一张卡是否命中搜索词（**包含**匹配：编号或标题）。
 *
 * 空搜索词恒真。
 *
 * @param card 卡
 * @param text 搜索框原文
 */
export function matchesSearch(card: FilterableCard, text: string | undefined): boolean {
	const query = normalizeSearch(text);
	if (query === '') return true;
	return card.id.toLowerCase().includes(query) || card.title.toLowerCase().includes(query);
}

/**
 * 一张卡是否同时命中三个筛选框 + 搜索词。
 *
 * @param card 卡
 * @param criteria 筛选条件（省略 = 全命中）
 */
export function matchesFilter(
	card: FilterableCard,
	criteria: TreeFilterCriteria = NO_TREE_FILTER,
): boolean {
	const status = criteria.status ?? [];
	if (!pathMatches(status, [card.status])) return false;
	const kind = criteria.kind ?? [];
	if (!pathMatches(kind, [card.template.kind])) return false;
	const domain = criteria.domain ?? [];
	if (!pathMatches(domain, [card.template.domain, card.template.kind, card.template.ref])) {
		return false;
	}
	if (criteria.unread === 'ai' && (card as { unread?: { ai?: boolean } }).unread?.ai !== true) return false;
	if (criteria.unread === 'user' && (card as { unread?: { user?: boolean } }).unread?.user !== true) return false;
	return matchesSearch(card, criteria.search);
}

/**
 * 有没有在筛选（任一条件非空）。
 *
 * 渲染层用它区分两种空态：「这个空间还没有卡」vs「筛选后没有匹配的卡」。
 *
 * @param criteria 筛选条件
 */
export function isFiltering(criteria: TreeFilterCriteria = NO_TREE_FILTER): boolean {
	const status = criteria.status ?? [];
	const kind = criteria.kind ?? [];
	const domain = criteria.domain ?? [];
	return status.length > 0 || kind.length > 0 || domain.length > 0 || normalizeSearch(criteria.search) !== '';
}

/* ══════════════════════════════════════════════════════════════
 * 四、集合判决
 * ══════════════════════════════════════════════════════════════ */

/**
 * 该显示的卡 id 集合。
 *
 * ⚠ 返回的是 `Set`（不是数组）：渲染层要按 id 反复查「这张在不在」，
 *   数组 `includes` 是 O(n²)。
 *
 * @param cards 全部卡
 * @param criteria 筛选条件
 */
export function visibleCardIds(
	cards: readonly FilterableCard[],
	criteria: TreeFilterCriteria = NO_TREE_FILTER,
): ReadonlySet<string> {
	const visible = new Set<string>();
	for (const card of cards) {
		if (matchesFilter(card, criteria)) visible.add(card.id);
	}
	return visible;
}

/* ══════════════════════════════════════════════════════════════
 * 五、布局输入
 * ══════════════════════════════════════════════════════════════ */

/**
 * 只留可见卡、并处理「父卡被筛掉」后的**布局输入**。
 *
 * 规则见文件头「两个概念别混」：
 * - parent 在**全量数据**里不存在 ⇒ 保留（真孤儿，`layoutTree` 出警告）；
 * - parent 存在但**不可见** ⇒ 提到根（避免筛选把树打散成一堆假孤儿）；
 * - 其余原样保留（含自环：交给 `layoutTree` 的环警告）。
 *
 * 顺序 = 输入顺序（`layoutTree` 的确定性依赖这个）。
 *
 * @param cards 全部卡
 * @param visibleIds 该显示的 id 集合（来自 `visibleCardIds`）
 */
export function treeCardsOf(
	cards: readonly FilterableCard[],
	visibleIds: ReadonlySet<string>,
): readonly TreeCard[] {
	const allIds = new Set(cards.map((card) => card.id));
	const out: TreeCard[] = [];
	for (const card of cards) {
		if (!visibleIds.has(card.id)) continue;
		const raw = card.relations.parent;
		const parent = typeof raw === 'string' && raw !== '' ? raw : null;
		let effective = parent;
		if (parent !== null && allIds.has(parent) && !visibleIds.has(parent)) {
			/* 父卡真实存在、只是被筛掉了 ⇒ 提到根（不制造假孤儿）。 */
			effective = null;
		}
		out.push({ id: card.id, title: card.title, parent: effective });
	}
	return out;
}

/* ══════════════════════════════════════════════════════════════
 * 六、搜索跳转
 * ══════════════════════════════════════════════════════════════ */

/**
 * 搜索框内容 → 要打开的那张卡的 id（**按编号精确匹配**）。
 *
 * 用户 `2026-11-19`：「搜索回车 或 点『前往』⇒ 打开指定编号的详情」。
 *
 * 判据是**精确等于编号**（trim + 大小写不敏感），不是包含匹配 ——
 * 否则输入 `GU` 回车会跳到 `GU01`，而用户可能还没输完。
 *
 * @param cards 全部卡
 * @param text 搜索框原文
 * @returns 命中的卡 id（返回**卡上原始大小写**的 id）；没命中 `null`
 */
export function jumpTargetOf(
	cards: readonly Pick<FilterableCard, 'id'>[],
	text: string | undefined,
): string | null {
	const query = normalizeSearch(text);
	if (query === '') return null;
	for (const card of cards) {
		if (card.id.toLowerCase() === query) return card.id;
	}
	return null;
}
