/**
 * 两个「权限策略」工具的 **DSH 适配层**（定义在本包：`tool-policy.ts` / `tool-policy-read.ts`）。
 *
 * ## 为什么不用自己转 schema
 *
 * DSH 的 `defineTool` 对 JSON Schema 有两条非标准约束（`type: 'json'`、
 * `additionalProperties` 必须显式）。那套转换在 `@taskboard/dsh-tools` 的
 * `adaptDefinitions` 里 —— **本包直接复用，不复制第二份**（两份会漂移）。
 *
 * ## 宿主上下文（`TaskboardToolContext`）只有两个事实
 *
 * | 字段 | 来源 |
 * |---|---|
 * | `holder` | `holderOf(subagents, exec)` —— 与 `@taskboard/dsh-tools` 同一份回落链 |
 * | `canManageToolPolicies` | 本包的三档位 `=== 'manage-edit'` |
 *
 * ⚠ 第二个字段就是用户要的那道门槛：「agent 侧权限开关的启用后才能通过」。
 *
 * ## 为什么只有两个工具在这里
 *
 * 其余 9 个 `taskboard_*` 是**宿主无关**的（MCP 也要），住在 `@taskboard/dsh-tools`。
 * 这两个按用户裁决是 **DSH 专属**（「mcp 不提供这个 tool」）⇒ 定义搬到本包。
 */

import type { Taskboard } from '@taskboard/core';
import { adaptDefinitions, type DefineTool, type ToolLike } from '@taskboard/dsh-tools';
import type { TaskboardTool } from '@taskboard/tools';

import { createToolPolicyReadTool } from './tool-policy-read.ts';
import { createToolPolicyTool } from './tool-policy.ts';
import type { ToolGuardKv } from './tool-guard.ts';

/** 建这两个工具需要的依赖。 */
export interface AgentGuardToolDeps {
	readonly taskboard: Taskboard;
	/** 三档位的存储端口（借 store 的 kv）。 */
	readonly kv: ToolGuardKv;
	/** `ctx.subagents` 的快照（旧通道，测试直传用）；可缺席。 */
	readonly subagents?: unknown;
	/** DI 通道（2026-11-27 裁定）：建工具时解析当前 cell；没有则用快照。 */
	readonly resolveSubagents?: () => unknown;
	/** 测试注入用；省略 = DSH 的 `defineTool`。 */
	readonly defineTool?: DefineTool;
	/**
	 * 「agent 侧档位是否 manage-edit」的判定。
	 *
	 * 插件行注入 `service.isManageEdit`（与 HTTP / 其它消费方**同一份事实**，见
	 * `packages/dsh-agent-guard/src/index.ts` 的 `AgentGuardService`）。
	 * 省略 ⇒ 一律 `false`（不允许改策略）—— 与「服务缺席就 false」的语义一致；
	 * 本文件**不自己读 kv 重算**，档位只有服务那一个来源。
	 */
	readonly isManageEdit?: () => boolean;
}

/**
 * 建两个权限工具（`taskboard_tool_policy` / `taskboard_tool_policy_read`）。
 *
 * @param deps 任务板实例 + kv + subagents
 * @returns DSH 形状的工具定义（调用方逐个 `ctx.tools.register`）
 */
export function createAgentGuardTools(deps: AgentGuardToolDeps): readonly ToolLike[] {
	/* DI 通道优先（2026-11-27 裁定）—— 建工具时的快照；工具每次调用读的是这个
	 * 快照（adapter 的 subagents 是值不是 resolver），guard 那边才是每次判定时解析。 */
	const subagentsSnapshot = deps.resolveSubagents?.() ?? deps.subagents;
	const toolDeps = { taskboard: deps.taskboard };
	const definitions: readonly TaskboardTool[] = [
		createToolPolicyTool(toolDeps),
		createToolPolicyReadTool(toolDeps),
	];
	/* 插件行注入的是 `service.isManageEdit`（单一真值）；未注入 ⇒ 保守地不允许改策略。 */
	const isManageEdit = deps.isManageEdit ?? ((): boolean => false);

	return adaptDefinitions(definitions, {
		taskboard: deps.taskboard,
		isManageEdit,
		...(subagentsSnapshot === undefined ? {} : { subagents: subagentsSnapshot }),
		...(deps.defineTool === undefined ? {} : { defineTool: deps.defineTool }),
	});
}
