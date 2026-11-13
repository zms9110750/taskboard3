/**
 * 卡与卡之间的关系词表。
 *
 * ## 为什么是五种边 + 一个字段 = 六种关系
 *
 * 用户口径里的「六种关系」是：**派生、依赖、取代、约束、相关、参考**。
 * 但「派生」不在这张表里 —— 它由卡上的 `parent` 字段承载，是**树**，
 * 不是边。原因：
 *
 *   · 派生是**父子**关系，一张卡只有一个父；
 *   · 派生会沿树**递归重算**（父的状态由子推导），而边不会；
 *   · 边的目标不允许是草稿，派生的目标必须是有效卡 —— 两条规则不同源。
 *
 * ⇒ `LINK_KINDS` 只有五条；第六种关系由 `relations.parent` 表达。
 *   **不要把 `derives` 塞进这张表** —— 那会让「沿边传播」和「沿树重算」
 *   混成一套代码，而它们的触发时机、递归方式、失败处理全不一样。
 *
 * ## `direction` 只有 `related` 是无向
 *
 * `dependsOn` 是有向的（A 依赖 B ≠ B 依赖 A）；`related` 是无向的。
 * 无向性影响**去重**（A→B 与 B→A 存一条）和**渲染**（两侧各画一次）。
 *
 * ## `hasBehavior` 只有 `dependsOn`
 *
 * 用户 `2026-11-01 13:18`：「有行为的只有"依赖"。效果是所有依赖对象都进入了
 * 完成态，这个卡才能被领取。」
 *
 * ⚠ 别把这两件事当「行为」：
 *   · `supersedes` 的「旧卡自动取消」是**级联**（沿图走一次），不是「沿边传播」；
 *   · `related` 的「双向」是 `direction`，不是行为。
 */

/** 一条边的定义。 */
export interface LinkKind {
	/** 稳定英文标识。存进卡里、参与判断的就是它。 */
	readonly id: string;
	/** 中文显示名。只给人看，不参与任何判断。 */
	readonly displayName: string;
	/** `forward` 有向；`both` 无向。 */
	readonly direction: 'forward' | 'both';
	/**
	 * 是否是「影响状态转移」的边（依赖闸门）。
	 *
	 * ⚠ 这不是「有没有任何效果」—— 取代会触发级联，但那不走这条判定。
	 */
	readonly hasBehavior: boolean;
}

/**
 * 五条边的词汇表。**单源** —— 任何地方要写边的标识，一律从这里派生。
 *
 * ⚠ 顺序有语义：UI 的关系选择器按这个顺序排列。
 */
export const LINK_KINDS = [
	{ id: 'dependsOn', displayName: '依赖', direction: 'forward', hasBehavior: true },
	{ id: 'supersedes', displayName: '取代', direction: 'forward', hasBehavior: false },
	{ id: 'constrains', displayName: '约束', direction: 'forward', hasBehavior: false },
	{ id: 'related', displayName: '相关', direction: 'both', hasBehavior: false },
	{ id: 'references', displayName: '参考', direction: 'forward', hasBehavior: false },
] as const;

/** 五条边中的任一标识。 */
export type LinkKindId = (typeof LINK_KINDS)[number]['id'];

/** 有状态转移行为的边（= `dependsOn`）。 */
export type BehaviorLinkKind = Extract<(typeof LINK_KINDS)[number], { hasBehavior: true }>['id'];

/** 无向边（= `related`）。 */
export type UndirectedLinkKind = Extract<(typeof LINK_KINDS)[number], { direction: 'both' }>['id'];

/**
 * 唯一「有行为」的边。
 *
 * 写的是字面量，但标注成 `BehaviorLinkKind` ⇒ 词汇表里把 `hasBehavior`
 * 挪走（或改 id）时，**这行直接编译失败**，而不是静默指向一条没行为的边。
 */
export const BEHAVIOR_LINK: BehaviorLinkKind = 'dependsOn';

/** 唯一「无向」的边。 */
export const UNDIRECTED_LINK: UndirectedLinkKind = 'related';

/** 某条边的定义（未命中返回 `undefined`）。 */
export function linkKindOf(id: string): LinkKind | undefined {
	return LINK_KINDS.find((kind) => kind.id === id);
}

/** 是否是已知的边标识。 */
export function isLinkKindId(value: unknown): value is LinkKindId {
	return typeof value === 'string' && LINK_KINDS.some((kind) => kind.id === value);
}

/**
 * 六种关系 = 五种边 + `parent`。
 *
 * 这是给 UI 的「关系类型选择器」和 AI 工具的说明书用的**展示清单**，
 * 不是判定用的词表 —— 判定要分开：边查 `LINK_KINDS`，父子查 `parent` 字段。
 *
 * ⚠ **手工列出，不用 `.map()` 派生**：`.map()` 的结果是 `LinkKind[]`，
 * 长度退化成 `number`，下面「恰好六条」的编译期断言会静默失效。
 * 手工列表的代价是重复一次 `id`；收益是「少了一种关系」直接编译失败。
 * 由 `_RelationKindsMatchLinks` 断言这份 id 清单与 `LINK_KINDS` 一致。
 */
export const RELATION_KINDS = [
	{ id: 'derives', displayName: '派生', via: 'parent' },
	{ id: 'dependsOn', displayName: '依赖', via: 'link' },
	{ id: 'supersedes', displayName: '取代', via: 'link' },
	{ id: 'constrains', displayName: '约束', via: 'link' },
	{ id: 'related', displayName: '相关', via: 'link' },
	{ id: 'references', displayName: '参考', via: 'link' },
] as const;

/** 六种关系里哪几种由卡片字段承载（不走边表）。 */
export type ParentRelationKind = Extract<(typeof RELATION_KINDS)[number], { via: 'parent' }>['id'];

/** 六种关系中的任一标识。 */
export type RelationKindId = (typeof RELATION_KINDS)[number]['id'];

/*
 * ── 编译期断言 ─────────────────────────────────────────────────────
 */

type AssertTrue<T extends true> = T;

/** 词汇表至少两条：少于两条时「有向 / 无向」的区分就退化了。 */
type _AtLeastTwo = (typeof LINK_KINDS)['length'] extends 0 | 1 ? false : true;

/** 无向边非空。 */
type _SomeUndirected = [UndirectedLinkKind] extends [never] ? false : true;

/** 无向边非全集。 */
type _SomeDirected = [Exclude<LinkKindId, UndirectedLinkKind>] extends [never] ? false : true;

/** 有行为的边非空。 */
type _SomeBehaviorLink = [BehaviorLinkKind] extends [never] ? false : true;

/** 六种关系 = 五种边 + 派生。 */
type _SixRelationKinds = (typeof RELATION_KINDS)['length'] extends 6 ? true : false;

/**
 * `RELATION_KINDS` 里的五条边与 `LINK_KINDS` 完全一致（id 逐个相等）。
 *
 * 手工列表与 `LINK_KINDS` 是两处书写，这条断言把「漂移」变成编译失败。
 */
type _LinksInRelationKinds = Extract<(typeof RELATION_KINDS)[number], { via: 'link' }>['id'];
type _RelationKindsMatchLinks = [_LinksInRelationKinds] extends [LinkKindId]
	? [LinkKindId] extends [_LinksInRelationKinds]
		? true
		: false
	: false;

export type _RELATION_VOCABULARY_CONSISTENT = AssertTrue<
	[
		_AtLeastTwo,
		_SomeUndirected,
		_SomeDirected,
		_SomeBehaviorLink,
		_SixRelationKinds,
		_RelationKindsMatchLinks,
	] extends [true, true, true, true, true, true]
		? true
		: false
>;
