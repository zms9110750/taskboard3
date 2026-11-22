/**
 * `@taskboard/store` —— 存储的**默认实现**，一个 Cordis 插件行。
 *
 * ## 这个包为什么存在
 *
 * 用户的拆分依据：
 * > 对于搜索，后端存储，这种东西，可能使用者想要不同的实现，
 * > 关闭部分插件并替换他的实现。
 *
 * 后来又裁掉了搜索那一半：
 * > 是把搜索并入 core 强依赖。ui 和 tool 都强依赖搜索，替换了搜索，
 * > 那接口也没法做啊。他只能说替换底层实现，那没有意义。
 * > 要么他增加 api，那又调用不了。所以没意义。就强耦合吧。
 *
 * ⇒ **今天只有存储是可替换的**，搜索已经并进 core、强耦合。
 *
 * ```
 * core 只认接口（CardStore）
 *    ↑
 *    ├── @taskboard/store ← 本包：默认实现（node:sqlite）
 *    └── 别人的实现        ← 关掉本包这行，装自己的一行
 * ```
 *
 * ⚠ 不要因为「本包曾经也 provide 搜索」就以为它还管搜索 —— 它不管了。
 *   `packages/search` 整个包已取消，`createSearch` 在 core 里。
 *
 * ## 它只做两件事
 *
 * 1. `provide('taskboard3Store', store)` —— 换实现只要提供同名服务
 * 2. 把配置里的 `dataDir` 传给实现
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
 * 「只有 2 个方法」的最小实现上跑。用 `import type` 会引入对 dsh 的
 * 编译期依赖，那与本包「薄、可测、零宿主依赖」的定位相悖。
 *
 * ⚠ `provide` 在 Cordis 里是**同步**的；`effect` 的约定是
 *   「传一个返回清理函数的函数」。这里只用到这两个方法。
 *
 * ## 关闭它会怎样
 *
 * `dsh` 那边的 `inject` 里有 `taskboard3Store`，
 * 本行被关掉 ⇒ 依赖不满足 ⇒ 上层插件不激活（而不是抛错）。
 * **这是正确的失败方式。**
 */

import type { CardStore } from '@taskboard/core';
import { createSqliteStore } from '@taskboard/io';

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

/**
 * 装一行：造实现并 provide。
 *
 * @param ctx 宿主上下文（只需要 `provide` / `effect`）
 * @param config `{ dataDir }`
 */
export function apply(ctx: ApplyContext, config: Config): void {
	const store: CardStore = createSqliteStore(config.dataDir);

	ctx.provide(STORE_SERVICE, store);

	/*
	 * 关库是**本插件的副作用**：Cordis 卸载本行时调 `store.close()`。
	 *
	 * 为什么用 `effect` 而不是让调用方自己管：库句柄是**这一行**打开的，
	 * 就该由这一行关。换实现时，新实现自己登记自己的清理 —— 上层不用改。
	 */
	ctx.effect(() => () => {
		void store.close();
	}, 'taskboard3-store: close database');
}
