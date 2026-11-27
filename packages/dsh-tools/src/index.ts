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

// TODO(审查): 本文件 TODO 中标注的行号以 2026-11-25 加注释前的源码为基线（注释本身会移动行号），按符号名/上下文定位。
// TODO(审查): package.json 的 build 只有 `tsc -b`，不会删「源已不存在」的旧产物（AGENTS 规则 2）。
//   可直接改：build/prepack 先删 lib 再编译（tsc -b --clean 也删不掉已移出 program 的文件，必须真删目录）。
// TODO(审查): engines >=22.13.0 与 test 脚本直接 `node --test test/*.test.ts`（无 flag）不匹配——免 flag 的 TS 类型剥离是 22.18+（推断，需按实际 node 版本核实）。
//   需用户决定：抬 engines，还是给脚本加 --experimental-strip-types。
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
// TODO(审查): inject 列了 taskboard3DefaultWorkspaceId，但它的值传到 createTools 后没有任何工具读（见 106-114 与 tools.ts:240-246）；
//   缺它会让整行不激活，而实际能力并不需要它。需跨包确认后二选一：删出 inject，或确认 tools 包仍消费 ctx.resolveDefaultWorkspace。
export const inject = ['taskboard3Core', 'taskboard3DefaultWorkspaceId', 'tools'] as const;

/** 本插件行的配置。 */
export interface Config {}

/** `@taskboard/dsh-agent-guard` provide 的服务名（只读它的一个布尔）。 */
const AGENT_GUARD_SERVICE = 'taskboard3AgentGuard';

// TODO(审查): 这里手写 ctx 形状（Cordis 实际有 Context/Plugin 类型），还带 get?/effect? 可选探测与 subagents 字段；
//   后者在真实 ctx 下永远走 ctx.get 分支（95-96）⇒ 死字段。可直接改用 cordis 的 Context 类型（依赖版本需确认），
//   至少删掉 get/effect 的可选探测——它们让「Cordis 缺 API」这类错变静默。
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
	readonly isManageEdit: () => boolean;
}

/**
 * 装工具行。
 *
 * @param ctx 宿主上下文
 * @param config 无
 */
// TODO(审查): 两个可选服务（subagents / taskboard3AgentGuard）都只在 apply 时读一次缓存；Cordis 服务可以晚于本插件出现
//   ⇒ 晚到就永久拿不到：holder 永久回落 UUID、isManageEdit 永久 false。可直接改：ctx.inject([...]) 可选注入，或每次 execute 时 ctx.get。
// TODO(审查): 默认空间策略在这里有第三份实现（inject 一份、dsh-core 一份、106-112 fallback 一份），违反「单一真值」；
//   inject 已要求该服务 ⇒ 这段 fallback 生产不可达、测试也没覆盖。确认 dsh-core 必供后可直接删，并把 ApplyContext 该字段改必填。
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
	/* 服务存在 ⇒ 它的 `isManageEdit` 必然存在（AgentGuardService 的必选方法）；只对「服务本身缺席」兜一次。 */
	const isManageEdit = (): boolean => guard?.isManageEdit() === true;

	const defaultWorkspaceId =
		ctx.taskboard3DefaultWorkspaceId ?? (async (): Promise<string> => {
			const first = taskboard.listWorkspaces(false)[0];
			if (first !== undefined) return first.id;
			const created = await taskboard.ensureAnyWorkspace();
			return created.id;
		});

	const tools = createTools({ taskboard, defaultWorkspaceId, subagents, isManageEdit });

	/*
	 * ⚠ 逐个 register 必须在同一个 try 里：第 N 个抛错时前 N-1 个**已经注册成功**，
	 *   而插件激活失败后没人会再调本行的 disposer ⇒ 半注册状态会泄漏到 reload。
	 *   ⇒ 失败时先回滚已注册的那些，再把原错误原样抛出去。
	 */
	const disposeTools: Array<() => void> = [];
	try {
		for (const tool of tools) disposeTools.push(ctx.tools.register(tool));
	} catch (error) {
		for (const dispose of disposeTools) dispose();
		throw error;
	}

	const disposeAll = (): void => {
		for (const dispose of disposeTools) dispose();
	};

	/*
	 * ⚠ `ctx.effect(execute)` 的 `execute` 会被**立即调用**，返回值才被收作 disposer。
	 *   写 `ctx.effect(disposeAll)` 会让它立刻执行 —— 工具刚注册就被删掉。
	 */
	ctx.effect?.(() => disposeAll, 'taskboard3-tools: AI tools');
}

// TODO(审查): 下面四条 re-export 在产物里是 lib/types/index.d.ts:74-77 的 './tools.ts' / './holder.ts'，而 lib/types/ 没有这些 .ts 文件
//   ⇒ 消费方在 skipLibCheck 下会把 createTools/adaptDefinitions 等类型静默降级成 any。需 lead 做跨包类型验证（本包禁止构建）。
//   不能靠「源码改 .js」绕（违反 AGENTS 规则 1）；方向：查 tsc declaration emit 改写，或把适配器下沉 dsh-core 并单独发类型。
// TODO(审查): 本行同时被当库用（agent-guard import adaptDefinitions/toDshSchema），关掉本行会破坏 agent-guard 的工具注册；
//   与文件头「关掉只是少 9 个工具」的承诺冲突。更好的归属：适配器 + holder + 垫片下沉 @taskboard/dsh-core。
export { createTools, describeFailure, describeUnread } from './tools.ts';
export type { ToolDeps, ToolLike, DefineTool } from './tools.ts';
/* DSH schema 适配器 —— `@taskboard/dsh-agent-guard` 也用它，不复制第二份。 */
export { adaptDefinitions, toDshParameters, toDshSchema } from './tools.ts';
export { holderOf, type ExecLike, type SubagentsLike } from './holder.ts';
