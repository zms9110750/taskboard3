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

// ⚠ 2026-11-27 验真：原 TODO(审查) 说「实际消费者是 dsh-core、上面引用漂移」——**不实**。
//   dsh/src/index.ts:97 `inject` 了 taskboard3Store 且消费其 kv，dsh-agent-guard 也 inject；
//   上面「dsh 那边的 inject」并没有漂移。按那条 TODO 改注释反而会写错。

// TODO(审查) 汇总 —— 本文件代码行之外的问题（package.json / tsconfig / patch / locale / test / 架构）；
// 每条：问题 + 为什么 + 可直接改 / 需用户决定。本次只加注释，未改任何逻辑/类型/测试/配置，未构建未测试。
// TODO(审查): [tsconfig] tsconfig.json:11 只 reference ../core，漏了 ../io；干净树上 tsc -b packages/store 解析不到
//   @taskboard/io/lib/types，靠根 package.json:11 的全仓构建顺序掩盖。可直接改：加 {"path":"../io"}。
// TODO(审查): [package.json] 若本包要独立安装：缺 dsh.bundle.patch、exports["./cordis.patch.yml"]、./icon；
//   files 里的 cordis.patch.yml 没有 dsh.bundle.patch 时不会被 Plugin Manager 读取，可能是死文件。需 lead/用户确认是否独立安装。
// TODO(审查): [显示] 无 README、locale 无 meta.detail → 详情页为空；无 ./icon → 默认图。可直接改：README + meta.detail + icon（仅独立安装时需要）。
// TODO(审查): [patch] cordis.patch.yml:18-23 的 !!js dshHomePath('taskboard3') 自认未实测；DSH 文档（composition-reference.md:17）形式合法，
//   但本仓从未验证。可直接改：装一次确认并删「未验证」注释；失败则回落显式路径（默认值需用户决定）。
// TODO(审查): [patch] 若 @taskboard/bundle 的 patch 已含本行，本包 cordis.patch.yml 是死文件。需 lead 确认装配归属。
// TODO(审查): [test] plugin.test.ts:101-131 依赖上一个 it 写入的 ws1（node:test 顺序执行才成立）。可直接改：每个用例独立 workspace id。
// TODO(审查): [test] plugin.test.ts:54-58 用 status: string + as Card['status']，非法状态字符串也能编译（AGENTS 3.1）。可直接改：参数类型 Card['status']。
// TODO(审查): [test] plugin.test.ts:133-137 cleanup 断言只检查「是函数」，没证明 close 生效。可直接改：cleanup 后断言 store 操作失败或库可删。
// TODO(审查): [test] plugin.test.ts:88-91 after 调完 fire-and-forget close 立刻 rmSync；Windows 上 EBUSY 窗口（推断，建议实跑 3 遍）。
//   可直接改：rmSync 加 maxRetries/retryDelay，或让 fake ctx await disposer。
// TODO(审查): [test] plugin.test.ts:35-51 假 ctx 复制「provide 同步 / effect 立即执行 / disposer 同步」假设，与真 Cordis 的偏差抓不到。
//   可直接改：加 type-only Plugin 契约断言，或一个真 Cordis 冒烟测试。
// TODO(审查): [test] 无重复激活/HMR 测试：apply 两次会开两个 SQLite 连接、provide 两次；框架是否 dispose-before-apply 未验证。
// TODO(审查): [架构建议] 若只服务 DSH：评估 ctx.storageDomain（open/get/closeAll）托管 SQLite，替代 @taskboard/io + 自管 close；
//   需用户裁定是否放弃 MCP/独立可跑。
// TODO(审查): [文档] 给第三方实现者写 README（CardStore 方法、close 语义、kv 键空间、dataDir 约定）。可直接做。

import type { CardStore } from '@taskboard/core';
import { createSqliteStore } from '@taskboard/io';

/** Cordis 插件名。 */
export const name = 'taskboard3-store';

// TODO(审查): inject 声明为 readonly string[]（接真 Cordis Plugin 类型时可能不可赋值，未核实）；空数组本身只是文档，可留可删。
// 现在 apply 不接 Context，框架签名漂移不会被 tsc 发现。可直接改：Pick<Context, 'provide' | 'effect'> + type-only Plugin 契约断言。

/** 前置服务：无。SQLite 是 Node 内置模块。 */
export const inject: readonly string[] = [];

// TODO(审查): 这里只有类型、没有运行时校验；DSH 要求 export const Config schema（host-plugin.md:62-67），
// 否则 {} / dataDir:123 能过编译、激活时才在 io 深处炸。可直接改：schemastery Schema.object({ dataDir: Schema.string().required() })。
// TODO(审查): 下面注释说「没有合理的默认值、路径由入口显式给出」，但唯一入口 patch 用 !!js dshHomePath('taskboard3') 给了值；
// 表述与装配脱节，且该表达式本仓未实测（DSH 文档 composition-reference.md:17 形式合法）。可直接改注释。

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

// TODO(审查): 自造最小 ctx 并导出 ApplyContext，绕开 import type { Context }，provide/effect/Config 约定全无编译期检查；
// type-only 导入运行时零成本，「可测」理由不成立；导出的 ApplyContext 实际也只有测试用。
// 可直接改：真 Context 类型 + 测试侧 Pick/mock，或 Cordis service class。

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

// TODO(审查): 外部无人 import STORE_SERVICE（dsh-core 硬编码 'taskboard3Store'，lead 确认），只有本包测试用；
// 两个真相改字符串不会编译失败，只会让上层安静不激活。可直接改：常量挪到 core/ports.ts 供两边共用。

/** 提供的存储服务名。换实现必须提供同名服务。 */
export const STORE_SERVICE = 'taskboard3Store' as const;

// TODO(审查): config 未运行时校验，dataDir 缺失/空串会穿透到 io 的 mkdir 抛 TypeError，看不出是 patch 配置错；
// 且 io 不 resolve 相对路径（依赖进程 cwd，AGENTS 规则 4 精神）。可直接改：先校验 typeof dataDir === 'string' && dataDir.trim()，再 path.resolve。

/**
 * 装一行：造实现并 provide。
 *
 * @param ctx 宿主上下文（只需要 `provide` / `effect`）
 * @param config `{ dataDir }`
 */
export function apply(ctx: ApplyContext, config: Config): void {
	const store: CardStore = createSqliteStore(config.dataDir);

	// TODO(审查): provide 在 effect 之前；若 provide 抛错，库句柄已建但清理未登记 ⇒ 泄漏。可直接改：先 ctx.effect(...) 再 provide。
	// TODO(审查): api 参数是 unknown，丢了 CardStore 类型；可直接改：泛型或 CardStore（行为不变）。
	ctx.provide(STORE_SERVICE, store);

	/*
	 * 关库是**本插件的副作用**：Cordis 卸载本行时调 `store.close()`。
	 *
	 * 为什么用 `effect` 而不是让调用方自己管：库句柄是**这一行**打开的，
	 * 就该由这一行关。换实现时，新实现自己登记自己的清理 —— 上层不用改。
	 */
	// TODO(审查): close(): Promise<void> 被 void 丢弃 —— 未处理拒绝可让进程退出，上层又不 await（lead 确认），卸载时旧库可能没关完；
	// Windows 测试 after 紧接 rmSync 会 EBUSY（推断，建议实跑 3 遍）。可直接改：close().catch(...) 并让 disposer 返回 Promise（需框架确认是否 await）。
	ctx.effect(() => () => {
		void store.close();
	}, 'taskboard3-store: close database');
}
