/**
 * `core.SearchStrategy` ⇄ `search.SearchStrategy` 之间的**薄适配**。
 *
 * ## 为什么需要适配（而不是直接赋值）
 *
 * 两个包各自声明了自己的搜索形状，**故意不互相 import**：
 *
 * | | `@taskboard/core` | `@taskboard/search` |
 * |---|---|---|
 * | 卡片入参 | `readonly Card[]` | `readonly SearchableCard[]` |
 * | 条件字段 | `title` / `status` / `kind` / `domain` / **`templateRef`** | `title` / `status` / `kind` / `domain` / **`template`** / `updatedBy` / `updatedCardIds` |
 * | 返回 | `readonly Card[]` | `readonly SearchableCard[]` |
 *
 * `Card` 结构上是 `SearchableCard` 的超集（多出 `relations` / `sections` /
 * `note` / `history` 等字段），所以：
 *
 * - **入参方向**天然兼容（`Card[]` 可以喂给只读 `SearchableCard[]`）；
 * - **返回方向**不兼容（`SearchableCard[]` 缺字段，赋不回 `Card[]`）——
 *   这就是 `tsc` 报 `TS2322` 的原因。
 *
 * ⇒ 适配要做的只有两件：
 *   1. 条件字段改名（`templateRef` → `template`）；
 *   2. 返回值把元素还原成 `Card`（**不新建对象**，原样返回 —— 搜索只读不造卡）。
 *
 * ## ⚠ 这是临时桥
 *
 * 根治办法是让 `core` 直接 import `search` 的 `SearchCondition` 类型，
 * 或者反过来让 `search` 用 `core` 的。但那会破坏 `search` 的「零 import、
 * 可进浏览器」定位 ⇒ 由 lead 统一决定。**在决定之前不要两边各改一处。**
 *
 * 这里不做 `as Card[]` 裸断言，而是走一次 `unknown` —— 让「谁在绕过类型系统」
 * 在这一个文件里可见，而不是散落在调用点。
 */

import type { Card, SearchCondition as CoreCondition, SearchStrategy as CoreSearch } from '@taskboard/core';
import type { SearchCondition as SearchCondition2, SearchStrategy as SearchSearch } from '@taskboard/search';

/**
 * 把 core 的搜索条件映射成 search 的条件。
 *
 * 唯一的字段差异是 `templateRef` → `template`。
 * `updatedBy` / `updatedCardIds` 只存在于 search 侧，core 侧没有 —— 不补（core 还没算这个）。
 */
export function toSearchCondition(condition: CoreCondition): SearchCondition2 {
	return {
		...(condition.title === undefined ? {} : { title: condition.title }),
		...(condition.status === undefined ? {} : { status: condition.status }),
		...(condition.kind === undefined ? {} : { kind: condition.kind }),
		...(condition.domain === undefined ? {} : { domain: condition.domain }),
		...(condition.templateRef === undefined ? {} : { template: condition.templateRef }),
	};
}

/**
 * 把 search 的实现适配成 core 的 `SearchStrategy`。
 *
 * @param search `createSearch({ groupOf })` 的产物
 * @returns 可以直接交给 `createTaskboard({ search })` 的函数
 */
export function asCoreSearch(search: SearchSearch): CoreSearch {
	return (cards: readonly Card[], condition: CoreCondition): readonly Card[] => {
		const hits = search(cards, toSearchCondition(condition));
		/*
		 * `search` 只从入参里挑元素返回，**不造新对象** ⇒ 这里的每个元素
		 * 都还是原来那张 `Card`。断言成立，但仍经过 `unknown` 让绕行可见。
		 */
		return hits as unknown as readonly Card[];
	};
}
