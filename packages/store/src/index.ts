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
 * ## 为什么 `ctx` 是 `Pick<Context, 'provide' | 'effect'>`
 *
 * 本包只调这两个方法。`@deepseek-ai/cordis` 是**宿主在运行时提供的**，不是本包的
 * npm 依赖：`src/host-types.d.ts` 只声明用到的成员（与 `@taskboard/dsh-client` /
 * `dsh-permissions` 同形态），编译期零依赖，也仍然能单独 `node --test`。
 *
 * ## 关闭它会怎样
 *
 * `dsh` 那边的 `inject` 里有 `taskboard3Store`，
 * 本行被关掉 ⇒ 依赖不满足 ⇒ 上层插件不激活（而不是抛错）。
 * **这是正确的失败方式。**
 */

// ⚠ 2026-11-27 验真：原 TODO(审查) 说「实际消费者是 dsh-core、上面引用漂移」——**不实**。
//   dsh/src/index.ts:97 `inject` 了 taskboard3Store 且消费其 kv，dsh-agent-guard 也 inject；
//   上面「dsh 那边的 inject」并没有漂移。按那条 TODO 改注释反而会写错。

// TODO(审查) 汇总 —— 本文件代码行之外、且**本轮清单没有覆盖**的问题（package.json / patch / 测试 / 架构）。
// TODO(审查): [package.json] 若本包要独立安装：缺 dsh.bundle.patch、exports["./cordis.patch.yml"]；
//   files 里的 cordis.patch.yml 没有 dsh.bundle.patch 时不会被 Plugin Manager 读取，可能是死文件。需 lead/用户确认是否独立安装。
// TODO(审查): [patch] cordis.patch.yml:18-23 的 !!js dshHomePath('taskboard3') 自认未实测；DSH 文档（composition-reference.md:17）形式合法，
//   但本仓从未验证。可直接改：装一次确认并删「未验证」注释；失败则回落显式路径（默认值需用户决定）。
// TODO(审查): [patch] 若 @taskboard/bundle 的 patch 已含本行，本包 cordis.patch.yml 是死文件。需 lead 确认装配归属。
// TODO(审查): [test] plugin.test.ts:35-51 假 ctx 复制「provide 同步 / effect 立即执行 / disposer 同步」假设，与真 Cordis 的偏差抓不到。
//   可直接改：加 type-only Plugin 契约断言，或一个真 Cordis 冒烟测试。
// TODO(审查): [test] 无重复激活/HMR 测试：apply 两次会开两个 SQLite 连接、provide 两次；框架是否 dispose-before-apply 未验证。
// TODO(审查): [架构建议] 若只服务 DSH：评估 ctx.storageDomain（open/get/closeAll）托管 SQLite，替代 @taskboard/io + 自管 close；
//   需用户裁定是否放弃 MCP/独立可跑。

import { resolve } from 'node:path';

import type { Context } from '@deepseek-ai/cordis';
import type { CardStore } from '@taskboard/core';
import { createSqliteStore } from '@taskboard/io';

/** Cordis 插件名。 */
export const name = 'taskboard3-store';

// TODO(审查): inject 声明为 readonly string[]（接真 Cordis Plugin 类型时可能不可赋值，未核实）；空数组本身只是文档，可留可删。

/** 前置服务：无。SQLite 是 Node 内置模块。 */
export const inject: readonly string[] = [];

/**
 * 本插件行的配置。
 *
 * ⚠ **只有类型，没有运行时 schema**：DSH 的 `Config` schema 会引入 schemastery
 *   依赖，而本包只校验一个字符串字段，不值当。运行时校验放在 `apply` 开头 ——
 *   坏配置在激活第一行就抛错，不会穿透到 io 的 `mkdir`。
 */
export interface Config {
	/**
	 * 数据目录（SQLite 库文件建在这里）。
	 *
	 * **必填；`Config` 本身不提供默认值** —— 本包不会自己编一个默认目录。
	 * 仓库自带的 `cordis.patch.yml` 用 `!!js dshHomePath('taskboard3')` 显式给值；
	 * 别的入口（如 mcp 的构造参数）同样必须显式传。
	 *
	 * 相对路径会被 `path.resolve` 按进程 cwd 解析；跨进程复用请传绝对路径。
	 */
	readonly dataDir: string;
}

/** 本插件用到的宿主上下文面（Cordis 的 `Context` 结构上满足它）。 */
export type ApplyContext = Pick<Context, 'provide' | 'effect'>;

// TODO(审查): 外部无人 import STORE_SERVICE（dsh-core 硬编码 'taskboard3Store'，lead 确认），只有本包测试用；
// 两个真相改字符串不会编译失败，只会让上层安静不激活。可直接改：常量挪到 core/ports.ts 供两边共用。

/** 提供的存储服务名。换实现必须提供同名服务。 */
export const STORE_SERVICE = 'taskboard3Store' as const;

/**
 * 装一行：造实现，登记关库副作用，再 provide。
 *
 * ⚠ 顺序是刻意的：先 `effect` 再 `provide`。`provide` 若抛错（同名服务已存在），
 *   库句柄已经建好 —— 先登记 effect 才能保证卸载时仍会关闭它。
 *
 * @param ctx 宿主上下文（只需要 `provide` / `effect`）
 * @param config `{ dataDir }`
 */
export function apply(ctx: ApplyContext, config: Config): void {
	/* 运行时校验（Config 只有类型）：坏配置在这里报，而不是在 io 的 mkdir 里炸。 */
	const rawDataDir: unknown = config?.dataDir;
	if (typeof rawDataDir !== 'string' || rawDataDir.trim() === '') {
		throw new TypeError('[taskboard3/store] 配置项 dataDir 必须是非空字符串路径');
	}
	const dataDir = resolve(rawDataDir);

	const store: CardStore = createSqliteStore(dataDir);

	/*
	 * 关库是**本插件的副作用**：Cordis 卸载本行时调 `store.close()`。
	 *
	 * 为什么用 `effect` 而不是让调用方自己管：库句柄是**这一行**打开的，
	 * 就该由这一行关。换实现时，新实现自己登记自己的清理 —— 上层不用改。
	 */
	ctx.effect(() => () => {
		/*
		 * `close()` 是异步的，而 Cordis 的 disposer 不保证被 await（本包不依赖它）。
		 * 必须接住拒绝：否则是一个未处理的 Promise rejection，可能让进程退出，
		 * 而真正的关闭失败会被完全吞掉。
		 */
		void store.close().catch((error: unknown) => {
			console.error('[taskboard3/store] 关闭 SQLite 失败：', error);
		});
	}, 'taskboard3-store: close database');

	ctx.provide<CardStore>(STORE_SERVICE, store);
}
