/**
 * DSH 工具**适配层** —— 把 `@taskboard/tools` 的 v2 工具定义转成 DSH `defineTool`。
 *
 * ## 这个文件是什么
 *
 * v1 这里放着 16 个工具的本体（约 1000 行：参数解析、失败翻译、文案、调用 core）。
 * `2026-11-22` 起这些全在 `@taskboard/tools`（MCP / DSH 通用），本文件只做三件事：
 *
 * 1. **schema 转换**：v2 的 `inputSchema` 是纯 JSON Schema
 *    （`{ type:'object', properties, required: [...] }`），DSH 的 `parameters`
 *    是「每个参数一条 spec，required 内联成 `required: true`」⇒ `toDshSchema`。
 * 2. **宿主上下文注入**：v2 的 `handler(args, ctx)` 需要 holder / 默认空间 /
 *    激活空间 / 权限开关 —— 全部在每次 `execute` 时从 DSH 侧事实现取。
 * 3. **hosts 过滤**：v2 的 `taskboard_tool_policy` 标了 `hosts: ['dsh']`，
 *    用 `toolsForHost(..., 'dsh')` 过滤（MCP 适配层将来自己按 'mcp' 过滤）。
 *
 * ## ⚠ `@deepseek-ai/dsh-tools` 在本包只出现在这里
 *
 * `defineTool` 是 DSH 的静态依赖（不是 Cordis 服务）。为了**测试能注入假实现**，
 * `createTools` 接受可选的 `defineTool`；省略时用真实现。
 * ⇒ 全 `dsh/src` 只有这一处 `import '@deepseek-ai/dsh-tools'`。
 *
 * ## 三个 ctx 事实从哪来（不编造 API）
 *
 * | ctx 字段 | 来源 | 说明 |
 * |---|---|---|
 * | `holder` | `holderOf(ctx.subagents, exec)` | 与 v1 同一实现（`src/holder.ts`）：subagent 名字 → UUID → unknown 三条回落 |
 * | `resolveDefaultWorkspace` | `deps.defaultWorkspaceId()` | DSH 入口策略：显式 `workspaceId` 优先，否则「第一个空间；没有就建默认」（`index.ts` 原注释） |
 * | `activeWorkspaceId` | `taskboard.listWorkspaces(false)[0]?.id` | **DSH 没有服务端的「UI 当前空间」状态**（`docs/设计.md` 说 `currentId` 在客户端；HTTP 路由靠 `?workspace=`）。这里把「激活空间」定义为**第一个未归档空间**，与默认空间策略一致 —— 不是新 API，只是复用 core 的列表。真实 UI 当前空间要等 HTTP 层把 `?workspace=` 持久化后再接。 |
 * | `canManageToolPolicies` | `taskboard.getToolGuardLevel() === 'manage-edit'` | core 的宿主轴档位，选项文案就是「允许编辑档位权限」；它同时是 `POLICY_TOOLS` 的放行条件 ⇒ 单真值复用，不在 dsh 侧再存一份开关 |
 *
 * ## 输出
 *
 * 所有 v2 工具共用 `TEXT_OUTPUT_SCHEMA`（`{ text }`），同样转成 DSH 的内联 required 形状。
 * v2 结果里的 `isError` **不透传**：DSH 的 output schema 不允许额外字段，
 * 且 v1 的失败也是「正常返回一段文字」。失败文案本身已带原因码/下一步。
 */

import { defineTool as dshDefineTool } from '@deepseek-ai/dsh-tools';
import type { Taskboard } from '@taskboard/core';
import { ERROR_HINTS, type Failure } from '@taskboard/protocol';
import {
	TEXT_OUTPUT_SCHEMA,
	createTaskboardTools,
	textContentBlocks,
	toolsForHost,
	type JsonObjectSchema,
	type JsonSchema,
	type TaskboardToolContext,
} from '@taskboard/tools';

import { holderOf } from './holder.ts';

/* ────────────────────────── 形状（与 v1 公开面兼容） ────────────────────────── */

/** 一个已定义工具的最小形状（对齐 DSH `ToolDefinition` 的字段子集）。 */
export interface ToolLike {
	readonly name: string;
	readonly description: string;
	readonly parameters: Record<string, unknown>;
	readonly output: {
		readonly schema: Record<string, unknown>;
		readonly render: (args: unknown, value: unknown) => readonly unknown[];
	};
	execute(args: unknown, exec: unknown): Promise<unknown>;
}

/** `defineTool` 的窄形状；默认用 DSH 真实现，测试可注入假实现。 */
export type DefineTool = (options: {
	readonly name: string;
	readonly description: string;
	readonly parameters: Record<string, unknown>;
	readonly output: {
		readonly schema: Record<string, unknown>;
		readonly render: (args: unknown, value: unknown) => readonly unknown[];
	};
	execute(args: never, exec: never): Promise<unknown>;
}) => ToolLike;

/** 工具依赖（入口策略，不是 core 概念）。 */
export interface ToolDeps {
	readonly taskboard: Taskboard;
	/** 测试注入用；省略 = DSH 的 `defineTool`。 */
	readonly defineTool?: DefineTool;
	/** 解析默认空间（入口策略，不是 core 概念）。 */
	readonly defaultWorkspaceId: () => Promise<string>;
	/**
	 * `ctx.subagents` —— 用来取当前 agent 的**名字**（holder）。
	 *
	 * ⚠ 可以是 `undefined`：没有 subagent 环境的 profile 也该能用任务板。
	 *   那时 holder 回落 `agent.id`（UUID）。见 `src/holder.ts`。
	 */
	readonly subagents?: unknown;
}

/* ────────────────────────── 工厂 ────────────────────────── */

/**
 * 建全部 DSH 工具（v2 的 10 个，其中 `taskboard_tool_policy` 仅 DSH）。
 *
 * @returns 工具定义数组（调用方逐个 `ctx.tools.register`）
 */
export function createTools(deps: ToolDeps): readonly ToolLike[] {
	const define = deps.defineTool ?? dshDefineTool;
	/* DSH 侧过滤 `hosts`：MCP 专属/仅其它宿主的不注册。 */
	const visible = toolsForHost(createTaskboardTools(deps.taskboard), 'dsh');

	return visible.map((tool) => {
		const output = { schema: toDshSchema(TEXT_OUTPUT_SCHEMA), render: renderText };
		return define({
			name: tool.name,
			description: tool.description,
			parameters: toDshParameters(tool.inputSchema),
			output,
			async execute(args: unknown, exec: unknown): Promise<unknown> {
				const result = await tool.handler(args, contextOf(deps, exec));
				return { text: result.text };
			},
		});
	});
}

/* ────────────────────────── ① schema 转换 ────────────────────────── */

/**
 * 纯 JSON Schema → DSH 的 `parameters` 记录。
 *
 * DSH 用「每个参数一条 spec + 属性级 `required: true`」，不是 JSON Schema 的
 * `required: [...]` 数组。递归保留 `type / description / enum / items /
 * additionalProperties / 嵌套 properties`。
 */
export function toDshParameters(schema: JsonObjectSchema): Record<string, unknown> {
	return propertiesOf(schema);
}

/** 把一个 schema 节点转成 DSH 参数 spec（`required` 内联）。 */
export function toDshSchema(node: JsonSchema): Record<string, unknown> {
	const spec: Record<string, unknown> = {};
	if (node.type !== undefined) spec['type'] = node.type;
	if (node.description !== undefined) spec['description'] = node.description;
	if (node.enum !== undefined) spec['enum'] = node.enum;
	if (node.additionalProperties !== undefined) spec['additionalProperties'] = node.additionalProperties;
	if (node.items !== undefined) spec['items'] = toDshSchema(node.items);
	if (node.properties !== undefined) spec['properties'] = propertiesOf(node);
	return spec;
}

/** `properties` 表 → DSH 参数记录（`required` 从数组变成属性上的 true）。 */
function propertiesOf(node: JsonSchema): Record<string, unknown> {
	const required = new Set(node.required ?? []);
	const out: Record<string, unknown> = {};
	for (const [name, property] of Object.entries(node.properties ?? {})) {
		out[name] = {
			...toDshSchema(property),
			...(required.has(name) ? { required: true } : {}),
		};
	}
	return out;
}

/** DSH 的 output.render：把 `{ text }` 翻成 content 块（与 MCP 同形）。 */
function renderText(_args: unknown, value: unknown): readonly unknown[] {
	return textContentBlocks(value);
}

/* ────────────────────────── ② 宿主上下文 ────────────────────────── */

/** 一次执行的宿主事实（三个能力 + 激活空间）。 */
function contextOf(deps: ToolDeps, exec: unknown): TaskboardToolContext {
	const first = deps.taskboard.listWorkspaces(false)[0];
	return {
		holder: holderOf(deps.subagents, exec),
		/* DSH 入口策略：显式 workspaceId 优先，否则「第一个空间；没有就建默认」。 */
		resolveDefaultWorkspace: () => deps.defaultWorkspaceId(),
		/* 激活空间 = 第一个未归档空间（见文件头：DSH 没有服务端 UI currentId）。 */
		...(first === undefined ? {} : { activeWorkspaceId: first.id }),
		/* 宿主轴「允许编辑档位权限」= core 的 manage-edit；不在 dsh 侧另存开关。 */
		canManageToolPolicies: deps.taskboard.getToolGuardLevel() === 'manage-edit',
	};
}

/* ────────────────────────── 公开面兼容（v1 导出） ────────────────────────── */

/**
 * 把 `Failure` 翻译成模型能据此改对的话。
 *
 * ⚠ v2 的工具内部已经用 `@taskboard/tools` 的失败契约输出（原因码/可重试/
 *   下一步/字段问题），本函数只保留给 `index.ts` 的**公开导出**（v1 API 兼容），
 *   不再被任何工具调用。新代码不要用它。
 */
export function describeFailure(fail: Failure): string {
	const lines: string[] = [fail.message];
	const hint = ERROR_HINTS[fail.code];
	if (hint !== undefined) lines.push(`下一步：${hint}`);
	if (fail.issues !== undefined && fail.issues.length > 0) {
		lines.push('具体问题：');
		for (const issue of fail.issues) {
			lines.push(`· ${issue.path === '' ? '(整体)' : issue.path}：${issue.message}`);
		}
	}
	return lines.join('\n');
}

/**
 * 把未读状态翻译成人话。
 *
 * ## ⚠ 两个字段的方向是**交叉**的（这是最容易搞反的地方）
 *
 * ```
 * ai: true    ⇒ AI 改过，**用户**还没读
 * user: true  ⇒ 用户改过，**AI** 还没读
 * ```
 *
 * 即字段名是「**谁改的**」，而不是「谁没读」。
 * v2 的列表/详情工具内部用自己的渲染（`@taskboard/tools` 的 `render.ts`）；
 * 本函数保留给 `index.ts` 的公开导出。
 */
export function describeUnread(unread: { readonly ai: boolean; readonly user: boolean }): string {
	if (!unread.ai && !unread.user) return '双方都已读';
	if (!unread.ai && unread.user) return '用户改过，AI 待读';
	if (unread.ai && !unread.user) return 'AI 改过，用户待读';
	return '双方都有未读';
}
