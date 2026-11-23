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
import { readToolGuardLevelOf, type ToolGuardKv } from './tool-guard.ts';

/** 建这两个工具需要的依赖。 */
export interface AgentGuardToolDeps {
	readonly taskboard: Taskboard;
	/** 三档位的存储端口（借 store 的 kv）。 */
	readonly kv: ToolGuardKv;
	/** `ctx.subagents`（可选）—— 取当前 agent 名字当 holder。 */
	readonly subagents?: unknown;
	/** 测试注入用；省略 = DSH 的 `defineTool`。 */
	readonly defineTool?: DefineTool;
}

/**
 * 建两个权限工具（`taskboard_tool_policy` / `taskboard_tool_policy_read`）。
 *
 * @param deps 任务板实例 + kv + subagents
 * @returns DSH 形状的工具定义（调用方逐个 `ctx.tools.register`）
 */
export function createAgentGuardTools(deps: AgentGuardToolDeps): readonly ToolLike[] {
	const toolDeps = { taskboard: deps.taskboard };
	const definitions: readonly TaskboardTool[] = [
		createToolPolicyTool(toolDeps),
		createToolPolicyReadTool(toolDeps),
	];

	return adaptDefinitions(definitions, {
		taskboard: deps.taskboard,
		isManageEdit: () => readToolGuardLevelOf(deps.kv) === 'manage-edit',
		...(deps.subagents === undefined ? {} : { subagents: deps.subagents }),
		...(deps.defineTool === undefined ? {} : { defineTool: deps.defineTool }),
	});
}
