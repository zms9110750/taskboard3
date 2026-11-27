/**
 * `@taskboard/dsh-core` —— 任务板在 DSH 里的**核心实例插件行**。
 *
 * ## 这个包为什么存在（用户 `2026-11-23`）
 *
 * > 「怎么接入dsh的那几个包没了？ui也是一个包也可以关掉的啊。」
 *
 * 在这之前只有 3 个插件行，其中 `@taskboard/dsh` **一个包塞了 5 件事**
 * （14 条 HTTP 端点 / 11 个 AI 工具 / 3 个斜杠命令 / 1 个权限 guard / 1 个 SSE）。
 * 想只关掉「AI 工具」是做不到的 —— 只能整行关掉，连 HTTP 一起没。
 *
 * ## 本包的职责：**只建实例，只 provide**
 *
 * ```
 * 本包（@taskboard/dsh-core）
 *   ├─ createTaskboard({ store: ctx.taskboard3Store })
 *   ├─ provide('taskboard3Core', taskboard)      ← 其余插件行 inject 它
 *   └─ provide('taskboard3DefaultWorkspaceId', f) ← 入口的默认空间策略
 * ```
 *
 * **不注册任何路由 / 工具 / 命令** —— 那些各在自己的插件行里。
 *
 * ## 为什么必须只有一个包建实例
 *
 * `Taskboard` 是**内存状态**（卡的缓存、权限档位、模板注册表）。
 * 如果 HTTP / 工具 / 命令各自 `createTaskboard()`，就会有 3 份互不可见的
 * 内存状态 —— 工具改了卡，HTTP 读不到。**这是拆分最容易踩的坑。**
 *
 * ⇒ 由本包建一份、`provide` 出去，其余行 `inject: ['taskboard3Core']`。
 *
 * ## 为什么 `provide` 而不是 `ctx.get()`
 *
 * `provide` 是**服务声明**：其余行的 `inject` 靠它解析依赖。
 * 关掉本行 ⇒ 其余行**不激活**（而不是抛错）。这是正确的失败方式 ——
 * 和 `taskboard3Store` 那一行的语义一致。
 *
 * ## 默认空间是入口策略，不是 core 概念
 *
 * 用户裁定：「整个激活都只对 dsh 会话有效。mcp 是没法提供的。」
 *
 * 规则：取第一个未归档空间；一个都没有就建「默认」。
 * **没有全局默认值** —— 用户明确否掉了「全局默认的垃圾堆」。
 */

/*
 * TODO(审查) 非源码问题汇总（package.json / tsconfig / lib 产物）：
 * 1. `lib/policy-store.js`、`lib/policy-store.js.map`、`lib/types/policy-store.d.ts(.map)` 是删掉
 *    `src/policy-store.ts` 后的陈旧产物，src 已无对应文件；`files: ["lib"]` 会把它打进 npm。
 *    可直接改：`rm -rf lib && tsc -b`（AGENTS 规则 2）。
 * 2. `package.json` 的 test 脚本指向不存在的 `test/`，本包测试数为 0，而它是「全仓唯一实例」的关键包。
 *    可直接改：加 `test/apply.test.ts`（import '../src/index.ts'，规则 6），至少覆盖 provide 三个服务名 / close effect / 默认空间两条分支。
 * 3. `package.json` 依赖 `@taskboard/protocol` 与 `tsconfig.json` 的 `references: ["../protocol"]` 均无直接使用
 *    （src 只 import core，`lib/types/index.d.ts` 也只有 CardStore）。推断可删，但需 `tsc -b` 实跑确认 declaration 解析不依赖它。
 * 4. `tsconfig.json` 的 `tsBuildInfoFile` 指向 `lib/.tsbuildinfo`，会被 `files: ["lib"]` 一起发布；`"types": ["node"]`
 *    也无 node API 使用者。可直接改：tsBuildInfoFile 移到包根、删掉 `"types": ["node"]`（若 base 已提供）。
 */

import { createBus, createTaskboard, type Bus, type CardStore, type Taskboard } from '@taskboard/core';

/** Cordis 插件名。 */
export const name = 'taskboard3-core';

/**
 * 前置服务。
 *
 * `taskboard3Store` 由 `@taskboard/store`（或用户自己的替换品）提供。
 * 缺它 ⇒ 本行不激活 ⇒ 依赖本行的其余行也不激活。
 */
export const inject = ['taskboard3Store'] as const;

/*
 * TODO(审查) 空 interface 是 TS 类型，编译后擦除；Cordis 只校验 `runtime.Config` 这个 standard-schema
 *   值（cordis fiber.ts:50-62），所以本导出运行期不校验任何 config，却让人以为校验过了。
 *   可直接改：删掉本 interface 与 `apply` 的 `_config` 参数；需用户决定：真要校验就用 schemastery/standard-schema。
 */
/** 本插件行的配置。 */
export interface Config {}

/*
 * TODO(审查) CORE_SERVICE / DEFAULT_WORKSPACE_SERVICE / BUS_SERVICE 三个导出无外部使用者
 *   （其它插件行硬编码 'taskboard3Core' 等字符串，lead 已确认）；改名会让消费方 inject 解析不到并静默不激活（无报错）。
 *   可直接改：让消费方 import 这些常量（inject 接受运行期字符串），或改回不导出；跨包需一起改。
 */
/** 提供的核心实例服务名。其余插件行 `inject` 它。 */
export const CORE_SERVICE = 'taskboard3Core' as const;

/*
 * TODO(审查) 服务名以 `...Id` 结尾，但服务值是 `() => Promise<string>` 函数（见 `ctx.provide(DEFAULT_WORKSPACE_SERVICE, defaultWorkspaceId)`），
 *   消费方容易当成字符串直接拼。可直接改：重命名为 taskboard3ResolveDefaultWorkspace；跨包需一起改。
 */
/** 提供的默认空间策略服务名。 */
export const DEFAULT_WORKSPACE_SERVICE = 'taskboard3DefaultWorkspaceId' as const;

/**
 * 提供的模板贡献面服务名（用户 2026-11-27 裁定：模板提供者是 DI 对象）。
 *
 * 领域扩展行 inj 它（**不需要 inj 整个 ②**）拿到三个注册表：
 * `templates`（#15）、`kinds` / `domains`（#13）。「后人依赖前人」走
 * Cordis 的 inject 等待，不靠 patch 行序。
 */
export const TEMPLATES_SERVICE = 'taskboard3Templates' as const;

/**
 * 提供的广播总线服务名。
 *
 * ⚠ **原型期脚手架**：与 `core/src/bus.ts` 同生共死。
 *   SSE 端点（在 `@taskboard/dsh` 里）需要它，所以由本包建、`provide` 出去。
 *   拆脚手架时删：本常量 + 本段的 `createBus()` + `createTaskboard({ bus })`
 *   + dsh 侧的 `createSseHub` 与 `GET /api/events`。
 */
export const BUS_SERVICE = 'taskboard3Bus' as const;

/*
 * TODO(审查) 手写垫片只单向声明，没有与真实 Cordis `Context` 做过任何编译期核对；`ctx` 由 loader 动态
 *   import 传入，签名漂移只会在运行时炸。本机 Cordis 4.1.0 核实：effect(execute, label?) 的 label 是真的、
 *   provide 返回 disposer（这里写成 void 把返回值丢了）。可直接改：type-only import '@deepseek-ai/cordis' 的 Context，或加一条编译期兼容断言。
 * TODO(审查) `effect?` 可选 + 调用处 `ctx.effect?.()`：真实 ctx 上 effect 必然存在（cordis reflect.ts:234），
 *   可选化只会在假 ctx 下静默跳过清理（与 AGENTS §3.6「绕行必须能被编译失败或测试变红找到」相反）。可直接改：改必选，测试里补 no-op effect。
 * TODO(审查) 下面注释说「只声明本包真正调用的两个方法」，实际是 3 个成员（provide / taskboard3Store / effect）。可直接改：改注释。
 */
/**
 * `apply` 用到的最小上下文。
 *
 * 只声明本包真正调用的两个方法 —— 不假装知道 Cordis 的其余部分。
 * Cordis 的 `Context` 结构上满足本接口 ⇒ 运行时能直接传进来。
 */
export interface ApplyContext {
	/** 注册/提供运行时服务。 */
	provide(serviceName: string, api: unknown): void;
	/** 存储实现（由 `@taskboard/store` 提供）。 */
	readonly taskboard3Store: CardStore;
	/**
	 * 注册一个由本插件拥有的副作用；返回清理函数。
	 *
	 * 入参是一个「返回清理函数」的函数，Cordis 在卸载时调用那个清理函数。
	 */
	effect?(effect: () => () => void, label?: string): void;
}

/**
 * 造实例并 provide。
 *
 * @param ctx 宿主上下文（只需要 `provide` / `taskboard3Store` / `effect`）
 * @param config 无（本行目前不接受配置）
 */
export function apply(ctx: ApplyContext, _config: Config = {}): void {
	/*
	 * TODO(审查) 总线脚手架放在「只建实例」的核心行里，拆 SSE 时要同时改 dsh-core 与 dsh 两处；
	 *   更可拆的做法是单独一行 taskboard3-bus + 本包可选 inject（需 core 确认 createTaskboard 的 bus 可否省略）。需 lead/用户决定。
	 */
	/* ⚠ 原型期脚手架：广播总线。SSE 端点（在 `@taskboard/dsh` 里）需要它。 */
	const bus: Bus = createBus();
	const taskboard: Taskboard = createTaskboard({ store: ctx.taskboard3Store, bus });

	ctx.provide(CORE_SERVICE, taskboard);
	ctx.provide(BUS_SERVICE, bus);

	/*
	 * ③ 模板贡献面（用户 2026-11-27 裁定：模板提供者是 DI 对象）。
	 *
	 * 领域扩展行**不需要 inject ②（整个实例）**也能注册自己的领域资产：
	 * inj `taskboard3Templates` 拿到三个注册表 —— 模板（#15）、类别 / 领域
	 * （#13）。前人包先装、后人包 inj 它 ⇒ 依赖走 DI 的 inject 等待，不靠
	 * patch 行序。schema 校验留在注册表里（#15：扩展行只喂内容，不带校验）。
	 */
	const contribution = Object.freeze({
		templates: taskboard.templates(),
		kinds: taskboard.kinds(),
		domains: taskboard.domains(),
	});
	ctx.provide(TEMPLATES_SERVICE, contribution);

	/*
	 * TODO(审查) 本文件头声明「默认空间是入口策略，不是 core 概念」，但策略住在核心实例包里；
	 *   第二入口（MCP / 命令行）复用它就得依赖 dsh-core，改策略也要改核心包。建议移到入口行或独立一行。需 lead/用户决定。
	 */
	/**
	 * 入口的默认空间策略。
	 *
	 * 用户否掉了全局默认值 ⇒ 只做「第一个；没有就建一个」。
	 */
	const defaultWorkspaceId = async (): Promise<string> => {
		/*
		 * TODO(审查) core 的 ensureAnyWorkspace() 本身就是「取第一个未归档，没有就建默认」（lead 已确认）；
		 *   这里先 list 再 ensure 是同一策略的第二份实现：core 改排序/筛选规则时两处会分叉。可直接改：`return (await taskboard.ensureAnyWorkspace()).id`。
		 * TODO(审查) 并发首次调用可能都看到空并各建一个「默认」空间；缓存 in-flight promise 可消除。需用户决定（产品行为）。
		 */
		const list = taskboard.listWorkspaces(false);
		const first = list[0];
		if (first !== undefined) return first.id;
		const created = await taskboard.ensureAnyWorkspace();
		return created.id;
	};

	ctx.provide(DEFAULT_WORKSPACE_SERVICE, defaultWorkspaceId);

	/*
	 * TODO(审查) 异步 close() 被 `void` 丢弃：Cordis 只在 disposer **返回** Promise 时才 await 并 catch 记录
	 *   （cordis fiber.ts:720-730）；现在卸载不等 close 完成，close 若 reject 会变成未处理 rejection（Node 可能终止进程）。
	 *   可直接改：`() => taskboard.close()`（先用 core 确认 close 为 async）；可选：把本 effect 提前到 createTaskboard 之后，避免后续 provide 抛错时实例无人关（会改变 dispose 顺序）。
	 */
	/*
	 * 关实例是**本行的副作用**：Cordis 卸载本行时调 `taskboard.close()`。
	 *
	 * ⚠ **不关 store** —— 它属于提供它的那一行（`@taskboard/store`）。
	 *   本包只是使用者。关别人的资源是所有权越界。
	 */
	ctx.effect?.(() => () => {
		void taskboard.close();
	}, 'taskboard3-core: close taskboard');
}
