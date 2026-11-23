/**
 * `@taskboard/dsh-tools` —— 任务板**给 AI 的工具面**插件行（宿主无关的 9 个工具）。
 *
 * ## 这个包为什么存在（用户 `2026-11-23`）
 *
 * > 「怎么接入dsh的那几个包没了？ui也是一个包也可以关掉的啊。」
 *
 * ## 本包只做两件事
 *
 * ```
 * ① 9 个宿主无关 taskboard_* 工具 → ctx.tools.register(...)
 * ② DSH schema 适配器（`toDshSchema` / `toDshParameters`）—— 也借给
 *    `@taskboard/dsh-agent-guard`，避免两份实现漂移
 * ```
 *
 * 定义在 `@taskboard/tools`（**纯库，MCP 也吃同一份**）。
 *
 * ## ⚠ 权限 guard 与两个策略工具**不在这里**（用户 `2026-11-23`）
 *
 * > 「这个tool，不在core里提供。完全由dsh桥接包提供。并且这个ui也完全由dsh ui提供。
 * >   mcp不提供这个tool和ui。」
 *
 * ```
 * ToolGuardLevel（off / manage / manage-edit） + 入侵式 guard
 * + taskboard_tool_policy / taskboard_tool_policy_read
 * + GET /api/tools
 * ⇒ 全在 `@taskboard/dsh-agent-guard` 那一行（可单独关闭）
 * ```
 *
 * 本包需要知道「是否 manage-edit」时，**走 Cordis 服务 `ctx.get(...)`**，
 * 不 import 那个包 —— 否则关掉那一行会让本行一起崩。
 *
 * ## 关掉它会怎样
 *
 * 数据和界面都还在（HTTP 在 `@taskboard/dsh` 那一行），只是 **agent 调不到
 * 任务板的 9 个通用工具了**。
 */

import type { Taskboard } from '@taskboard/core';

import { createTools } from './tools.ts';

/** Cordis 插件名。 */
export const name = 'taskboard3-tools';

/**
 * 前置服务。
 *
 * `taskboard3Core` 由 `@taskboard/dsh-core` 提供（`Taskboard` 实例）。
 * `taskboard3DefaultWorkspaceId` 也由它提供（入口的默认空间策略）。
 * `tools` 是 DSH 的工具注册表。
 *
 * ⚠ **三个都要列**（AGENTS §3.10）：少列一个不报「缺依赖」，而是 `apply` 里
 *   第一次读 `ctx.<服务>` 时才抛 `cannot get property … without inject`。
 *   症状：profile 启动报 `dsh: warning: 1 entry did not activate`。
 */
export const inject = ['taskboard3Core', 'taskboard3DefaultWorkspaceId', 'tools'] as const;

/** 本插件行的配置。 */
export interface Config {}

/** `@taskboard/dsh-agent-guard` provide 的服务名（只读它的一个布尔）。 */
const AGENT_GUARD_SERVICE = 'taskboard3AgentGuard';

/** `apply` 用到的最小上下文形状。 */
export interface ApplyContext {
	readonly taskboard3Core: Taskboard;
	taskboard3DefaultWorkspaceId?: () => Promise<string>;
	readonly tools: {
		register(tool: unknown): () => void;
	};
	readonly subagents?: unknown;
	get?(name: string): unknown;
	effect?(effect: () => () => void, label?: string): void;
}

/** `@taskboard/dsh-agent-guard` 服务的最小面。 */
interface AgentGuardLike {
	readonly isManageEdit?: () => boolean;
}

/**
 * 装工具行。
 *
 * @param ctx 宿主上下文
 * @param config 无
 */
export function apply(ctx: ApplyContext, _config: Config = {}): void {
	const taskboard = ctx.taskboard3Core;

	/*
	 * `ctx.subagents` 是**可选**服务 —— 用可选访问读它，不能写进 inject。
	 * 缺席时 holder 回落 `agent.id`（UUID）。
	 */
	const subagents =
		typeof ctx.get === 'function' ? ctx.get('subagents') : (ctx as { subagents?: unknown }).subagents;

	/*
	 * 「能否改策略」的唯一来源是 agent-guard 那一行的三档位。
	 * 那一行被关掉 ⇒ 服务不存在 ⇒ 一律 false（不允许改策略，符合「关掉就没了」）。
	 */
	const guard =
		typeof ctx.get === 'function' ? (ctx.get(AGENT_GUARD_SERVICE) as AgentGuardLike | undefined) : undefined;
	const isManageEdit = (): boolean => guard?.isManageEdit?.() === true;

	const defaultWorkspaceId =
		ctx.taskboard3DefaultWorkspaceId ?? (async (): Promise<string> => {
			const first = taskboard.listWorkspaces(false)[0];
			if (first !== undefined) return first.id;
			const created = await taskboard.ensureAnyWorkspace();
			return created.id;
		});

	const tools = createTools({ taskboard, defaultWorkspaceId, subagents, isManageEdit });
	const disposeTools = tools.map((tool) => ctx.tools.register(tool));

	const disposeAll = (): void => {
		for (const dispose of disposeTools) {
			if (typeof dispose === 'function') (dispose as () => void)();
		}
	};

	/*
	 * ⚠ `ctx.effect(execute)` 的 `execute` 会被**立即调用**，返回值才被收作 disposer。
	 *   写 `ctx.effect(disposeAll)` 会让它立刻执行 —— 工具刚注册就被删掉。
	 */
	ctx.effect?.(() => disposeAll, 'taskboard3-tools: AI tools');
}

export { createTools, describeFailure, describeUnread } from './tools.ts';
export type { ToolDeps, ToolLike, DefineTool } from './tools.ts';
/* DSH schema 适配器 —— `@taskboard/dsh-agent-guard` 也用它，不复制第二份。 */
export { adaptDefinitions, toDshParameters, toDshSchema } from './tools.ts';
export { holderOf, type ExecLike, type SubagentsLike } from './holder.ts';
