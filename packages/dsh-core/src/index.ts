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

/** 本插件行的配置。 */
export interface Config {}

/** 提供的核心实例服务名。其余插件行 `inject` 它。 */
export const CORE_SERVICE = 'taskboard3Core' as const;

/** 提供的默认空间策略服务名。 */
export const DEFAULT_WORKSPACE_SERVICE = 'taskboard3DefaultWorkspaceId' as const;

/**
 * 提供的广播总线服务名。
 *
 * ⚠ **原型期脚手架**：与 `core/src/bus.ts` 同生共死。
 *   SSE 端点（在 `@taskboard/dsh` 里）需要它，所以由本包建、`provide` 出去。
 *   拆脚手架时删：本常量 + 本段的 `createBus()` + `createTaskboard({ bus })`
 *   + dsh 侧的 `createSseHub` 与 `GET /api/events`。
 */
export const BUS_SERVICE = 'taskboard3Bus' as const;

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
	/* ⚠ 原型期脚手架：广播总线。SSE 端点（在 `@taskboard/dsh` 里）需要它。 */
	const bus: Bus = createBus();
	const taskboard: Taskboard = createTaskboard({ store: ctx.taskboard3Store, bus });

	ctx.provide(CORE_SERVICE, taskboard);
	ctx.provide(BUS_SERVICE, bus);

	/**
	 * 入口的默认空间策略。
	 *
	 * 用户否掉了全局默认值 ⇒ 只做「第一个；没有就建一个」。
	 */
	const defaultWorkspaceId = async (): Promise<string> => {
		const list = taskboard.listWorkspaces(false);
		const first = list[0];
		if (first !== undefined) return first.id;
		const created = await taskboard.ensureAnyWorkspace();
		return created.id;
	};

	ctx.provide(DEFAULT_WORKSPACE_SERVICE, defaultWorkspaceId);

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
