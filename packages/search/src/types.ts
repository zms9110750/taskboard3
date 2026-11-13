/**
 * 搜索包自己的最小结构接口。
 *
 * ## 为什么不 import core 的 `Card`
 *
 * `packages/search` 是一个**可整体替换**的实现领域（用户裁定的拆分依据：
 * 「别人可能想换实现的才拆」）。若它 import core 的 `Card`，换 core 的数据形状
 * 就会连带改搜索包 —— 那它就不独立了。
 *
 * ⇒ 本包只声明「我读哪些字段」，并且**全部只读、全部可选**（除 `id`）。
 *   core 的 `Card` 结构上满足本接口即可传入。
 *
 * ## 零 import 的代价：调用方必须传 `groupOf`
 *
 * 状态 → 组名的映射（`TASK_STATE_SUBMITTED → active`）是 `protocol` 的词汇。
 * 本包不 import protocol（连 `import type` 都不需要：`StatusGroup` 的定义边界
 * 就到这里为止），**所以这份映射必须由调用方注入**。
 *
 * ⇒ `createSearch({ groupOf })` 的 `groupOf` **是必传项，没有默认值**。
 *
 * ⚠ **刻意不留默认值。** 留一个兜底表只有一种效果：某天有人忘了传，就静默用了
 *   包内的那份拷贝 —— 那是「第二处真值」最坏的形态（不报错、不漂移检测、
 *   改 protocol 不会通知到这里）。宁可让漏传变成**编译错误**。
 *
 * ## 为什么也不 import protocol 的类型
 *
 * 只用 `import type` 本来可以，但 `TaskState` / `StatusGroup` 在运行时要取值
 * （要拿 `TASK_STATE_UNSPECIFIED` 字面量、要判组）。一旦为了取一个值而 import，
 * 本包就不再是零依赖。
 *
 * ⇒ 本包**零 import**：类型自带，草稿状态 id 作为可注入参数（默认值是 A2A
 *   v1.0.1 的协议常量，不是本包的私有词汇）。
 */

/** 一张卡里搜索要用到的部分。结构上兼容 core 的 `Card`。 */
export interface SearchableCard {
	/** 卡编号。唯一，不吃筛选。 */
	readonly id: string;
	/** 标题。`title` 条件按子串匹配。 */
	readonly title: string;
	/** 状态 id（协议全名，如 `TASK_STATE_SUBMITTED`）。 */
	readonly status: string;
	/** 模板快照；空模板建出来的卡也可能缺字段。 */
	readonly template?: {
		readonly ref?: string;
		readonly kind?: string;
		readonly domain?: string;
	};
	/**
	 * 采纳时间（毫秒）。排序首选。
	 *
	 * ⚠ 字段名待 core 的 `Card` 定稿后对齐。不一致时排序静默失效（不报错）。
	 */
	readonly adoptedAt?: number;
	/**
	 * 创建时间（毫秒）。排序次选（采纳时间为空时用它）。
	 *
	 * ⚠ 字段名待 core 的 `Card` 定稿后对齐。不一致时排序静默失效（不报错）。
	 */
	readonly createdAt?: number;
}

/**
 * 搜索条件。
 *
 * 语义：**字段之间 AND，字段内部（数组）OR。**
 * 这是用户 `2026-11-08` 对筛选的表述（「点了以后 UI 的显示结果」按条件收窄）。
 */
export interface SearchCondition {
	/** 标题模糊：子串、大小写不敏感。空串 = 不筛。 */
	readonly title?: string;
	/**
	 * 状态筛选。数组元素可以是**状态 id**，也可以是**组 id**
	 * （`draft` / `active` / `shelved` / `ended`）。数组内 OR。
	 *
	 * ⚠ 不给 `status` ⇒ 结果**不含草稿**（见 `includesDrafts`）。
	 */
	readonly status?: readonly string[];
	/** 领域。数组内 OR。 */
	readonly domain?: readonly string[];
	/** 类别（目标 / 设计 / 工作 / 记录）。数组内 OR。 */
	readonly kind?: readonly string[];
	/** 模板 ref。数组内 OR。 */
	readonly template?: readonly string[];
	/**
	 * 「谁改过、对方还没看过」这个**事件维度**的筛选。
	 *
	 * ⚠ 本包**不算**这个 —— 它要历史事件与已读游标，属于 core。
	 *   调用方把这套算出来的卡 id 通过 `updatedCardIds` 传进来。
	 *   本字段存在只是为了让「条件形状」完整、可序列化。
	 */
	readonly updatedBy?: readonly ('ai' | 'user')[];
	/** `updatedBy` 的**结果集**：这些 id 的卡保留。见 `updatedBy`。 */
	readonly updatedCardIds?: readonly string[];
}

/**
 * 搜索实现。
 *
 * 输入**全量卡**，输出过滤并排序后的卡。纯函数：不改入参、不碰 I/O。
 *
 * ⚠ 用户裁定：「search 的职责是你给他全部的卡，他 linq 过滤了再给你。
 * 所以他也有全量的数据源。因此后端存储做半查是不可能的。」
 */
export type SearchStrategy = (
	cards: readonly SearchableCard[],
	condition: SearchCondition,
) => readonly SearchableCard[];

/**
 * 组名。与 protocol 的 `StatusGroup` 同值域，但**本包不 import 它** ——
 * 类型边界到这里为止，字符串值由调用方的 `groupOf` 提供。
 */
export type StatusGroupName = 'draft' | 'active' | 'shelved' | 'ended';

/** `createSearch` 的可注入项。 */
export interface SearchOptions {
	/**
	 * 状态 → 组名的映射。**必传，没有默认值。**
	 *
	 * 为什么要注入：这是 `protocol` 的词汇（`STATUS_GROUP_OF`），本包零 import
	 * 拿不到它。注入让单一真值仍在 protocol，本包不留拷贝。
	 *
	 * 为什么不留兜底：见 `types.ts` 顶部「零 import 的代价」。
	 *
	 * @example
	 * ```ts
	 * import { STATUS_GROUP_OF } from '@local/taskboard3-protocol';
	 * const search = createSearch({ groupOf: (s) => STATUS_GROUP_OF[s] });
	 * ```
	 */
	readonly groupOf: (status: string) => StatusGroupName | undefined;
	/**
	 * 草稿状态 id。缺省 `TASK_STATE_UNSPECIFIED`（A2A v1.0.1 的协议常量）。
	 *
	 * ⚠ 它不是本包的私有词汇，是 A2A 的协议值，所以有默认值是安全的 ——
	 *   与 `groupOf` 不同（那个是**映射关系**，有两份就会漂）。
	 */
	readonly draftState?: string;
}
