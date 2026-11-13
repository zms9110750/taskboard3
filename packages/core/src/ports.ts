/**
 * 端口 —— core 里**唯二**的可替换实现。
 *
 * ## 为什么要端口
 *
 * 用户的判据：「别人可能想换实现的才拆，关不掉的重依赖不拆。」
 * 存储与搜索是他们明确说「可能想换」的两件事 ⇒ 只有这两个走端口。
 * 模板、状态机、关系、工作空间都是关不掉的重依赖，直接实现在 core 里。
 *
 * ## 接口必须窄
 *
 * 用户原话：「storage 没有查询的必要。一旦 ui 查看就是全量加载。」
 * ⇒ `CardStore` **没有** `query` / `index` / `transaction`。
 * 换一个实现只要满足四个操作，不需要实现一套查询引擎。
 *
 * ## 搜索是纯函数，不是服务
 *
 * 用户原话：「search 的职责是你给他全部的卡，他 linq 过滤了再给你。
 * 所以他也有全量的数据源。」
 * ⇒ `SearchStrategy` 是无状态函数，零 I/O。它可以被搬到浏览器里跑，
 *   因为它不碰 `node:` 任何东西。
 */

import type { Card } from './card.js';

/**
 * 卡的持久化端口。
 *
 * ## 四个操作就够
 *
 * · `loadAll` —— 一个工作空间的全部卡（**含草稿、含墓碑**，由调用方过滤）；
 * · `save` —— 写一张卡（新增或整体覆盖）；
 * · `kvGet` / `kvSet` —— 不按空间分的全局键值（工作空间索引、归档标记）。
 *
 * ## ⚠ `save` 的原子性由实现保证
 *
 * 契约是「一次写一张卡」。实现必须保证**这张卡的写入是原子的**
 * （SQLite 用单行 UPDATE；JSON 实现用写临时文件再 rename）。
 * 若实现退化成「重写整个列表」，1000 张卡每次编辑要写 2MB —— 那是另一种载体，不是本接口的错。
 *
 * ## ⚠ `loadAll` 不过滤
 *
 * 返回值包含 `deleted: true` 的墓碑。过滤是调用方的事 —— 因为
 * 「按 id 直查要能看到墓碑」和「列表不列墓碑」是两条不同的读路径。
 */
export interface CardStore {
	/** 一个工作空间的全部卡（含墓碑）。 */
	loadAll(workspaceId: string): readonly Card[];
	/** 写一张卡（新增或整体覆盖）。 */
	save(workspaceId: string, card: Card): Promise<void>;
	/** 读全局键值；不存在返回 `undefined`。 */
	kvGet(key: string): string | undefined;
	/** 写全局键值；`undefined` = 删除该键。 */
	kvSet(key: string, value: string | undefined): Promise<void>;
	/** 关闭底层资源（进程退出 / 测试清理用）。 */
	close(): Promise<void>;
}

/**
 * 搜索条件。
 *
 * 只有**标题模糊**与**精确字段筛选**两类 —— 用户口径里的搜索是「只搜标题」。
 *
 * ⚠ 数组字段（`status` / `kind` / `domain`）语义是 **OR**（同一字段内任一命中）。
 * 不同字段之间是 **AND**。
 */
export interface SearchCondition {
	/** 标题模糊匹配（子串、大小写不敏感）。 */
	readonly title?: string;
	/** 状态 id 或状态组 id（`draft` / `active` / `shelved` / `ended`）。 */
	readonly status?: readonly string[];
	/** 类别 id。 */
	readonly kind?: readonly string[];
	/** 领域名。 */
	readonly domain?: readonly string[];
	/** 模板 ref。 */
	readonly templateRef?: readonly string[];
}

/**
 * 搜索策略 —— **纯函数**，给全部卡，返回筛选后的卡。
 *
 * 不排序（排序是调用方的事），不改输入，不做 I/O。
 */
export type SearchStrategy = (cards: readonly Card[], condition: SearchCondition) => readonly Card[];
