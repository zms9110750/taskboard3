/**
 * `@taskboard/store` —— 存储与搜索的**默认实现**，一个 Cordis 插件行。
 *
 * ## 这个包为什么存在
 *
 * 用户的拆分依据：
 * > 对于搜索，后端存储，这种东西，可能使用者想要不同的实现，
 * > 关闭部分插件并替换他的实现。
 *
 * ⇒ 存储与搜索是**可替换的服务**，不是一个写死在 core 里的函数。
 *
 * ```
 * core 只认接口（CardStore / SearchStrategy）
 *    ↑
 *    ├── @taskboard/store ← 本包：默认实现（sqlite + 纯函数搜索）
 *    └── 别人的实现        ← 关掉本包这行，装自己的一行
 * ```
 *
 * ## 它只做三件事
 *
 * 1. `provide('taskboard3Store', store)` —— 换实现只要提供同名服务
 * 2. `provide('taskboard3Search', search)` —— 同理
 * 3. 把配置里的 `dataDir` 传给实现
 *
 * **不做业务判断、不认识卡的状态、不碰模板。** 那些在 core。
 *
 * ## 为什么 `inject` 是空的
 *
 * `node:sqlite` / `node:fs` / `node:path` 都是 Node 内置模块。
 * 本包不需要任何宿主服务，所以没有依赖 —— 单独开它也能跑。
 *
 * ## 为什么 `ctx` 用最小结构接口而不是 `import type { Context } from '@deepseek-ai/cordis'`
 *
 * 本包要能被单独测试（`node --test`，不需要真 Cordis），也要能在
 * 「只有 3 个方法」的最小实现上跑。用 `import type` 会引入对 dsh 的
 * 编译期依赖，那与本包「薄、可测、零宿主依赖」的定位相悖。
 *
 * ⚠ `provide` 在 Cordis 里是**同步**的；`effect` 的约定是
 *   「传一个返回清理函数的函数」。这里只用到这两个方法。
 *
 * ## 关闭它会怎样
 *
 * `dsh` 那边的 `inject` 里有 `taskboard3Store` / `taskboard3Search`，
 * 本行被关掉 ⇒ 依赖不满足 ⇒ 上层插件不激活（而不是抛错）。
 * **这是正确的失败方式。**
 */

import { createSqliteStore } from '@taskboard/core';
import type { CardStore, SearchStrategy } from '@taskboard/core';
import { STATUS_GROUP_OF } from '@taskboard/protocol';
import { createSearch } from '@taskboard/search';

import { asCoreSearch } from './adapt.ts';

import type { TaskState } from '@taskboard/protocol';

/** Cordis 插件名。 */
export const name = 'taskboard3-store';

/** 前置服务：无。SQLite 是 Node 内置模块。 */
export const inject: readonly string[] = [];

/** 本插件行的配置。 */
export interface Config {
	/**
	 * 数据目录（SQLite 库文件建在这里）。
	 *
	 * **必填。** 没有合理的默认值 —— 默认到 `~/.dsh` 之类的地方会让
	 * 「装了插件就往用户主目录写数据库」变成静默行为。
	 * 路径由入口（dsh 的 patch / mcp 的构造参数）显式给出。
	 */
	readonly dataDir: string;
}

/**
 * `apply` 用到的最小 Cordis 上下文形状。
 *
 * 只声明本插件真正调用的两个方法 —— 不假装知道 Cordis 的其余部分。
 */
export interface ApplyContext {
	/** 注册/提供运行时服务。 */
	provide(serviceName: string, api: unknown): void;
	/**
	 * 注册一个由本插件拥有的副作用；返回清理函数。
	 *
	 * 入参是一个"返回清理函数"的函数，Cordis 在卸载时调用那个清理函数。
	 */
	effect(effect: () => () => void, label?: string): void;
}

/** 提供的存储服务名。换实现必须提供同名服务。 */
export const STORE_SERVICE = 'taskboard3Store' as const;

/** 提供的搜索服务名。换实现必须提供同名服务。 */
export const SEARCH_SERVICE = 'taskboard3Search' as const;

/**
 * 装一行：造实现并 provide。
 *
 * @param ctx 宿主上下文（只需要 `provide` / `effect`）
 * @param config `{ dataDir }`
 */
export function apply(ctx: ApplyContext, config: Config): void {
	const store: CardStore = createSqliteStore(config.dataDir);

	/*
	 * 搜索是纯函数，但要注入 `groupOf`（状态 → 组名）。
	 * 那是 protocol 的词汇，本包 import 它、**不留拷贝** ——
	 * 所以这里直接传 `STATUS_GROUP_OF` 的查询函数。
	 *
	 * `STATUS_GROUP_OF` 的类型是 `Record<TaskState, StatusGroup>`，
	 * 而 search 只要求 `(status: string) => StatusGroupName | undefined`。
	 * 用一次安全查找把「未知状态」变成 `undefined`（search 内部按"不命中"处理），
	 * 而不是 `as` 断言让未知状态被当成某个组。
	 */
	const groupOf = (status: string): 'draft' | 'active' | 'shelved' | 'ended' | undefined =>
		STATUS_GROUP_OF[status as TaskState];

	/*
	 * `@taskboard/search` 的 `SearchStrategy` 与 `@taskboard/core` 的
	 * `SearchStrategy` **形状不同**（条件字段 `template` vs `templateRef`、
	 * 返回 `SearchableCard[]` vs `Card[]`）。两者故意不互相 import，
	 * 所以这里要过一层薄适配 —— 见 `adapt.ts` 顶部说明。
	 *
	 * ⚠ 这是临时桥。根治要让 lead 统一两侧的类型来源，不要在 store 里长期留着。
	 */
	const search: SearchStrategy = asCoreSearch(createSearch({ groupOf }));

	ctx.provide(STORE_SERVICE, store);
	ctx.provide(SEARCH_SERVICE, search);

	/*
	 * 关库是**本插件的副作用**：Cordis 卸载本行时调 `store.close()`。
	 *
	 * ⚠ 不在 `apply` 里直接 `close` —— 那样插件一装上库就关了。
	 *   必须登记成待清理的资源。
	 */
	ctx.effect(() => () => {
		void store.close();
	}, 'taskboard3-store: close database on unload');
}
