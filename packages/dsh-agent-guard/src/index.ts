/**
 * `@taskboard/dsh-agent-guard` —— 任务板对 DSH 的**入侵式权限面**，一个可单独关闭的插件行。
 *
 * ## 这个包为什么存在（用户 `2026-11-23`）
 *
 * > 「3. agent处有一个权限选择。完全由各自agent接入处提供。这不是任务板的功能。
 * >   因为这依赖agent自己的tool。所以mcp也不提供这个功能。别的agent也不提供这个功能。
 * >   这是对于dsh私人的专属功能。
 * >  4. 由3伴生来的一个档位对工具的拦截和权限。也是我对于dsh的私人专属实现。
 * >   这个tool，不在core里提供。完全由dsh桥接包提供。并且这个ui也完全由dsh ui提供。
 * >   mcp不提供这个tool和ui。」
 *
 * > 「这个访问工具的事情也要在agentguard这个包里。因为只有他会用。」
 *
 * ## 它装了什么（五样，全在**这一行**里）
 *
 * ```
 * ① 三个 agent 侧 tool 档位   ToolGuardLevel: off / manage / manage-edit
 *                             （kv 存储借用 @taskboard/store 的端口）
 * ② 入侵式 guard              ctx.tools.guard(...) —— 挂在 DSH 的工具管线上
 * ③ 两个 AI 工具              taskboard_tool_policy / taskboard_tool_policy_read
 *                             （原来是 @taskboard/tools 的一部分 ⇒ MCP 会拿到，
 *                               用户明确说不许 ⇒ 已搬到本包）
 * ④ GET /api/tools            读 ctx.tools.schemas()（全局视图），给工具清单供数据
 * ⑤ 三档位的 UI               ⚠ **不在本包**：UI 在 `@taskboard/dsh-client`
 *                             （用户：「这个ui也完全由dsh ui提供」）
 * ```
 *
 * ## 关掉这一行会怎样
 *
 * ```
 * · 三个档位消失（composer 的权限框读不到值）
 * · guard 不再挂载 ⇒ 任务板不再干涉 agent 的工具调用
 * · 两个 policy 工具消失（MCP 本来就没有）
 * · GET /api/tools 404
 * · 任务板的其它功能（卡 / 空间 / HTTP / 界面）**不受影响**
 * ```
 *
 * ## 依赖方向
 *
 * ```
 * dsh-agent-guard ──► @taskboard/dsh-tools   （借它的 DSH schema 适配器）
 *                 ──► @taskboard/tools       （工具定义的零件）
 *                 ──► @taskboard/core        （Taskboard 实例、策略存储）
 * ```
 *
 * ⚠ **`@taskboard/dsh-tools` 不反过来依赖本包** —— 它需要读「是否 manage-edit」时，
 *   走 Cordis 服务 `ctx.get('taskboard3AgentGuard')`，不是 import。
 *   这样「关掉本行」不会让 `dsh-tools` 那一行崩。
 */

import type { Taskboard } from '@taskboard/core';

import { handleToolsRequest, type ConnectionLike, type IncomingLike, type OutgoingLike } from './http.ts';
import { createPermissionGuard } from './permission.ts';
import { createAgentGuardTools } from './tools.ts';
import {
	createToolInventory,
	type AgentsLike,
	type PresetsLike,
} from './tool-inventory.ts';
import { readToolGuardLevelOf, writeToolGuardLevel, type ToolGuardKv, type ToolGuardLevel } from './tool-guard.ts';

/** Cordis 插件名（bundle 第 6 行的 id 用 `taskboard3-agent-guard`）。 */
export const name = 'taskboard3-agent-guard';

/**
 * 前置服务。
 *
 * · `taskboard3Core`  —— `@taskboard/dsh-core` 提供的实例
 * · `taskboard3Store` —— `@taskboard/store` 提供的 kv 端口（存三档位）
 * · `tools`           —— DSH 工具注册表 + guard
 * · `webServer`       —— 挂 `GET /api/tools`
 *
 * ⚠ **四个都要列**（AGENTS §3.10 的教训）：少列一个不报「缺依赖」，
 *   而是 `apply` 里第一次读 `ctx.<服务>` 时才抛 `cannot get property … without inject`，
 *   症状是 profile 启动报 `dsh: warning: 1 entry did not activate`。
 */
export const inject = ['taskboard3Core', 'taskboard3Store', 'tools'] as const;

/** 本插件行的配置（暂无）。 */
export interface Config {}

/** 本包 provide 给别的行用的服务名。 */
export const AGENT_GUARD_SERVICE = 'taskboard3AgentGuard' as const;

/** `AGENT_GUARD_SERVICE` 的形状。 */
export interface AgentGuardService {
	/** 读当前档位。 */
	readonly readLevel: () => ToolGuardLevel;
	/** 写档位（UI / HTTP 用）。 */
	readonly writeLevel: (level: ToolGuardLevel) => Promise<void>;
	/** `manage-edit` 才允许编辑档位权限（`canManageToolPolicies` 的唯一来源）。 */
	readonly isManageEdit: () => boolean;
	/** GET /api/tools 的处理器（由 `@taskboard/dsh` 的 prefix handler 转过来）。 */
	readonly handleTools: (connection: ConnectionLike, req: IncomingLike, res: OutgoingLike) => boolean;
}

/** `apply` 用到的最小上下文形状。 */
export interface ApplyContext {
	readonly taskboard3Core: Taskboard;
	readonly taskboard3Store: ToolGuardKv;
	readonly tools: {
		register(tool: unknown): () => void;
		guard(fn: (exec: unknown) => unknown): () => void;
	};
	readonly webServer: {
		register(route: {
			kind: 'exact' | 'prefix';
			path: string;
			handler: (req: never, res: never) => void | Promise<void>;
		}): () => void;
	};
	readonly subagents?: unknown;
	/**
	 * `ctx.loader`（cordis loader）。
	 *
	 * 只用来 `await()` 等挂载稳定 —— 枚举 preset 之前要先等挂载完成，
	 * 否则会拿到「还没注册完」的半个注册表。可选：没有就跳过等待。
	 */
	readonly loader?: { await?(): Promise<unknown> } | undefined;
	get?(name: string): unknown;
	provide(serviceName: string, api: unknown): void;
	effect?(effect: () => () => void, label?: string): void;
}

/**
 * 装这一行。
 *
 * @param ctx 宿主上下文（只需要上面声明的那几个服务）
 * @param config 无
 */
export function apply(ctx: ApplyContext, _config: Config = {}): void {
	const taskboard = ctx.taskboard3Core;
	const kv = ctx.taskboard3Store;

	/*
	 * `ctx.subagents` 是**可选**服务 —— 用可选访问读它，不能写进 inject。
	 * 没有 subagent 环境的 profile 也该能用（holder 回落 `agent.id`）。
	 */
	const subagents =
		typeof ctx.get === 'function' ? ctx.get('subagents') : (ctx as { subagents?: unknown }).subagents;

	/* ① 档位读写 + 对外服务（`dsh` 的 /api/permission 和 composer 权限框都靠它）。 */

	/* ④ GET /api/tools 的处理器（服务上暴露给 `@taskboard/dsh` 的 prefix handler）。 */
	/*
	 * 数据源 = 全量并集：全局层 ∪ 每个 agent preset 的 scope ∪ 活 agent。
	 *
	 * ⚠ `agentPresets` / `agents` 都是**可选**服务（preset registry 只在 web-app 形态存在），
	 *   只能 `ctx.get(…)` 可选访问 —— 写进 `inject` 会让 TUI / headless profile 整行不激活。
	 *   现成先例：上面 `ctx.get('subagents')`。
	 */
	const optionalService = <T>(serviceName: string): T | undefined => {
		if (typeof ctx.get !== 'function') return undefined;
		const found = ctx.get(serviceName);
		return found === undefined || found === null ? undefined : (found as T);
	};
	const permissionTools = ctx.tools as unknown as ToolsSchemasLike;
	/*
	 * ⚠ 全部用**延迟解析**（函数），不在 apply 时固化。
	 *
	 * `apply()` 执行时别的插件可能还没激活（本行是 bundle 第 6 行，
	 * preset-registry 由 `dsh-web-app` 插入，激活顺序不由我们决定）。
	 * 第一版就是在这里取一次值 ⇒ `/api/tools` 只返回 16 个（preset 层被静默跳过）。
	 * 枚举发生在**请求到达时**，那时服务早就齐了。
	 */
	const toolInventory = createToolInventory({
		schemas: (scope?: unknown) => permissionTools.schemas?.(scope) ?? [],
		resolvePresets: () => optionalService<PresetsLike>('agentPresets'),
		resolveAgents: () => optionalService<AgentsLike>('agents'),
		resolveAwaitReady: () => {
			const loader = ctx.loader ?? optionalService<{ await?(): Promise<unknown> }>('loader');
			if (loader?.await === undefined) return undefined;
			return async (): Promise<unknown> => loader.await?.();
		},
		warn: (message) => {
			console.warn(`[taskboard3-agent-guard] ${message}`);
		},
	});

	const handleTools = (connection: ConnectionLike, req: IncomingLike, res: OutgoingLike): boolean =>
		handleToolsRequest(connection, req, res, toolInventory);

	const service: AgentGuardService = {
		readLevel: () => readToolGuardLevelOf(kv),
		writeLevel: async (level) => {
			await writeToolGuardLevel(kv, level);
		},
		isManageEdit: () => readToolGuardLevelOf(kv) === 'manage-edit',
		handleTools,
	};
	ctx.provide(AGENT_GUARD_SERVICE, service);

	/* ② 入侵式 guard —— 加装在 DSH 的工具管线上。 */
	const permissionGuard = createPermissionGuard({ taskboard, kv, subagents });
	const disposeGuard = ctx.tools.guard(permissionGuard);

	/* ③ 两个 AI 工具（写 / 读三档策略）—— 定义在本包，不再进 `@taskboard/tools`。 */
	const tools = createAgentGuardTools({ taskboard, kv, subagents });
	const disposeTools = tools.map((tool) => ctx.tools.register(tool));

	const disposeAll = (): void => {
		/* 先摘 guard，再清工具：卸载过程中不该再有机会按旧档位判定。 */
		disposeGuard();
		for (const dispose of disposeTools) {
			if (typeof dispose === 'function') (dispose as () => void)();
		}
	};

	/*
	 * ⚠ `ctx.effect(execute)` 的 `execute` 会被**立即调用**，返回值才被收作 disposer。
	 *   写 `ctx.effect(disposeAll)` 会让它立刻执行 —— 工具刚注册就被删掉。
	 */
	ctx.effect?.(() => disposeAll, 'taskboard3-agent-guard: guard + policy tools + /api/tools');
}

/** `ctx.tools` 上本包用到的 `schemas()` 最小面（DSH `ToolsService`）。 */
interface ToolsSchemasLike {
	schemas(scope?: unknown): unknown[];
}

export { handleToolsRequest, TOOLS_TAIL, type ConnectionLike, type IncomingLike, type OutgoingLike } from './http.ts';
export { createAgentGuardTools, type AgentGuardToolDeps } from './tools.ts';
export { createToolPolicyTool } from './tool-policy.ts';
export { createToolPolicyReadTool } from './tool-policy-read.ts';
export {
	createPermissionGuard,
	heldWorkCardsOf,
	type GuardDeps,
	type GuardVerdict,
} from './permission.ts';
export * from './tool-guard.ts';
