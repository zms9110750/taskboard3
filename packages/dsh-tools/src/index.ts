/**
 * `@taskboard/dsh-tools` —— 任务板**给 AI 的工具面**插件行。
 *
 * ## 这个包为什么存在（用户 `2026-11-23`）
 *
 * > 「怎么接入dsh的那几个包没了？ui也是一个包也可以关掉的啊。」
 *
 * 之前 `@taskboard/dsh` 一个包塞了 5 件事。想只关掉「AI 工具」做不到 ——
 * 只能整行关掉，连 HTTP 和命令一起没。
 *
 * ## 本包只做两件事
 *
 * ```
 * ① 11 个 taskboard_* 工具  →  ctx.tools.register(...)
 * ② 权限 guard              →  ctx.tools.guard(...)
 * ```
 *
 * 定义在 `@taskboard/tools`（**纯库，宿主无关，MCP 也吃同一份**）。
 * 本包是 DSH 侧的薄适配：schema 形状转换 + 注册。
 *
 * ## 依赖谁
 *
 * ```
 * inject: ['taskboard3Core', 'tools']
 *            ↑ 实例由 @taskboard/dsh-core 那一行 provide
 *                        ↑ DSH 自带
 * ```
 *
 * **⚠ 不自己 `createTaskboard()`** —— 那会有第二份内存状态，
 *   工具改了卡 HTTP 读不到。见 `@taskboard/dsh-core` 的文件头。
 *
 * ## 关掉它会怎样
 *
 * 数据和界面都还在（HTTP 路由在 `@taskboard/dsh` 那一行），
 * 只是 **agent 调不到任务板的工具了**。这就是用户要的「可单独关」。
 *
 * ## 为什么 `defineTool` 只在这里 import
 *
 * 它不是 Cordis 服务，只能从 `@deepseek-ai/dsh-tools` 拿；而它在 npm 上
 * 没有与 DSH 同版本 ⇒ 编译期用 `src/dsh-tools.d.ts` 垫片。
 * **整个仓库只有本包 import 它一次**（ADR：`AGENTS.md` §3.1）。
 */

import type { Taskboard } from '@taskboard/core';

import { createPermissionGuard } from './permission.ts';
import { createTools } from './tools.ts';

/** Cordis 插件名。 */
export const name = 'taskboard3-tools';

/**
 * 前置服务。
 *
 * `taskboard3Core` 由 `@taskboard/dsh-core` 提供（`Taskboard` 实例）。
 * `tools` 是 DSH 的工具注册表。
 */
export const inject = ['taskboard3Core', 'tools'] as const;

/** 本插件行的配置。 */
export interface Config {}

/**
 * `apply` 用到的最小上下文形状。
 *
 * 只声明本包真正调用的方法 —— 不假装知道 Cordis 的其余部分。
 */
export interface ApplyContext {
	/** `@taskboard/dsh-core` 提供的实例。 */
	readonly taskboard3Core: Taskboard;
	/** 默认空间策略（由 `@taskboard/dsh-core` 提供）。 */
	taskboard3DefaultWorkspaceId?: () => Promise<string>;
	/** DSH 的工具服务：注册 + guard。 */
	readonly tools: {
		register(tool: unknown): () => void;
		guard(fn: (exec: unknown) => unknown): () => void;
	};
	/** `ctx.subagents`（可选）—— 取当前 agent 名字当 holder。 */
	readonly subagents?: unknown;
	/**
	 * Cordis 的 `ctx.get(name)` —— 可选访问服务，不触发 inject 检查。
	 *
	 * ⚠ 读 `ctx.subagents` 会走 Cordis 属性拦截器，服务不在 `inject` 里就抛
	 *   `cannot get property "subagents" without inject`。用这个探测。
	 */
	get?(name: string): unknown;
	effect?(effect: () => () => void, label?: string): void;
}

/**
 * 装工具行。
 *
 * @param ctx 宿主上下文
 * @param config 无（本行目前不接受配置）
 */
export function apply(ctx: ApplyContext, _config: Config = {}): void {
	const taskboard = ctx.taskboard3Core;

	/*
	 * `ctx.subagents` 是**可选**服务 —— 用可选访问读它，**不能**写进 `inject`。
	 * 没有 subagent 环境的 profile（隔离 profile 就是这样）也该能用。
	 * 缺席时 holder 回落 `agent.id`（UUID）。
	 */
	const subagents =
		typeof ctx.get === 'function' ? (ctx.get('subagents') as ApplyContext['subagents']) : ctx.subagents;

	/*
	 * 权限 guard —— **加装**在 DSH 的工具管线上。
	 *
	 * ⚠ 档位不在本包：两条正交轴是任务板的全局状态，`taskboard.judgeToolCall`
	 *   自己从 core 缓存读。guard 只提供「这个 agent 持有哪些工作卡」这一个事实。
	 *
	 * ⚠ **不往 DSH 的权限预设表注册任何东西**（`2026-11-19` 用户裁定：
	 *   「因为细节问题没必要给 dsh 开一堆权限」）。
	 */
	const permissionGuard = createPermissionGuard({ taskboard, subagents });
	const disposeGuard = ctx.tools.guard(permissionGuard);

	const defaultWorkspaceId =
		ctx.taskboard3DefaultWorkspaceId ?? (async (): Promise<string> => {
			const first = taskboard.listWorkspaces(false)[0];
			if (first !== undefined) return first.id;
			const created = await taskboard.ensureAnyWorkspace();
			return created.id;
		});

	/* 工具：定义在 `@taskboard/tools`，本包只做 DSH 适配 + 注册。 */
	const tools = createTools({ taskboard, defaultWorkspaceId, subagents });
	const disposeTools = tools.map((tool) => ctx.tools.register(tool));

	const disposeAll = (): void => {
		/* 先摘 guard，再清工具：卸载过程中不该再有机会按旧档位判定。 */
		disposeGuard();
		for (const dispose of disposeTools) {
			if (typeof dispose === 'function') (dispose as () => void)();
		}
	};

	/*
	 * ⚠ **`ctx.effect(execute)` 的 `execute` 会被立即调用，返回值才被收作 disposer。**
	 *   写 `ctx.effect(disposeAll)` 会让 `disposeAll` 立刻执行 ——
	 *   工具刚注册就被删掉（2026-11-23 在隔离 profile 里实测过这个 bug）。
	 */
	ctx.effect?.(() => disposeAll, 'taskboard3-tools: AI tools + guard');
}

export { createTools, describeFailure, describeUnread } from './tools.ts';
export type { ToolDeps, ToolLike, DefineTool } from './tools.ts';
export { holderOf, type ExecLike, type SubagentsLike } from './holder.ts';
export {
	createPermissionGuard,
	heldWorkCardsOf,
	type GuardDeps,
	type GuardVerdict,
} from './permission.ts';
