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
 * ## 两个 ctx 事实从哪来（不编造 API）
 *
 * | ctx 字段 | 来源 | 说明 |
 * |---|---|---|
 * | `holder` | `holderOf(deps.subagents, exec)` | 与 v1 同一实现（`src/holder.ts`）：subagent 名字 → UUID → unknown 三条回落 |
 * | `canManageToolPolicies` | `deps.isManageEdit()` | 由 `@taskboard/dsh-agent-guard` 的插件行决定：`packages/dsh-agent-guard/src/index.ts` 的 `service.isManageEdit` 读该包 kv 的三档位（`readToolGuardLevelOf(kv) === 'manage-edit'`）。本包**不 import 那一行**（关掉它不能让本行崩）；服务缺席 ⇒ 一律 `false` |
 *
 * ⚠ **不注入 `resolveDefaultWorkspace` / `activeWorkspaceId`**：用户 `2026-11-22`
 *   取消了「激活空间」设定，所有工具调用必须显式给 `workspaceId`
 *   （见本文件底部的 `contextOf`）。`ToolDeps.defaultWorkspaceId` 只为入口策略保留，
 *   当前不被任何工具读取。
 *
 * ## 输出
 *
 * 所有 v2 工具共用 `TEXT_OUTPUT_SCHEMA`（`{ text }`），同样转成 DSH 的内联 required 形状。
 * v2 结果里的 `isError` **不透传**：DSH 的 output schema 不允许额外字段，
 * 且 v1 的失败也是「正常返回一段文字」。失败文案本身已带原因码/下一步。
 */

// TODO(审查): 本文件 TODO 中标注的行号以 2026-11-25 加注释前的源码为基线（注释本身会移动行号），按符号名/上下文定位。
// TODO(审查): 这是 static import，但 package.json 把 @deepseek-ai/dsh-tools 标成 optional peer ⇒ 标「可选」而实际缺了就模块加载失败。
//   需用户决定：peer 改非可选（本行本来就只能跑在 DSH 上），或改动态 import + 明确降级。
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
	type TaskboardTool,
	type TaskboardToolContext,
} from '@taskboard/tools';

import { holderOf } from './holder.ts';

/* ────────────────────────── 形状（与 v1 公开面兼容） ────────────────────────── */

// TODO(审查): ToolLike/DefineTool 与 src/dsh-tools.d.ts 的 ToolDefinition/DefineToolOptions 是同一形状的两份拷贝，会漂。
//   可直接改：从 @deepseek-ai/dsh-tools 的类型（垫片）复用，删掉这两份手写形状。
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

// TODO(审查): defaultWorkspaceId（87）是死接线：contextOf（240-246）从不读它，工具拿不到默认空间；测试也靠 withWorkspace 补参掩盖。
//   若 @taskboard/tools 仍读 ctx.resolveDefaultWorkspace，则这里不传是真 bug（需跨包确认）；否则删字段与 index.ts 的传参。
// TODO(审查): isManageEdit（102）疑似死接线：只有 agent-guard 的两个策略工具消费 canManageToolPolicies，9 个宿主无关工具都不读。
//   若确认，本包不该强制要它：拆 ToolDeps，createTools 不需要 isManageEdit，adaptDefinitions 的调用方才需要。
/** 工具依赖（入口策略，不是 core 概念）。 */
export interface ToolDeps {
	readonly taskboard: Taskboard;
	/** 测试注入用；省略 = DSH 的 `defineTool`。 */
	readonly defineTool?: DefineTool;
	/** 解析默认空间（入口策略，不是 core 概念）。 */
	readonly defaultWorkspaceId?: () => Promise<string>;
	/**
	 * `ctx.subagents` —— 用来取当前 agent 的**名字**（holder）。
	 *
	 * ⚠ 可以是 `undefined`：没有 subagent 环境的 profile 也该能用任务板。
	 *   那时 holder 回落 `agent.id`（UUID）。见 `src/holder.ts`。
	 */
	readonly subagents?: unknown;
	/**
	 * 「agent 侧档位是否 manage-edit」的探针。
	 *
	 * ⚠ 三档位**不归本包**（用户 `2026-11-23`）：它随 `@taskboard/dsh-agent-guard`
	 *   那一行一起开关。本包通过 Cordis 服务读它，**不 import 那个包** ——
	 *   否则关掉那一行会让本行也崩。缺席 ⇒ 一律 `false`（不允许改策略）。
	 */
	readonly isManageEdit: () => boolean;
}

/* ────────────────────────── 工厂 ────────────────────────── */

/**
 * 建全部 DSH 工具（v2 的 9 个宿主无关工具；两个权限策略工具在 `@taskboard/dsh-agent-guard`）。
 *
 * @returns 工具定义数组（调用方逐个 `ctx.tools.register`）
 */
export function createTools(deps: ToolDeps): readonly ToolLike[] {
	/* DSH 侧过滤 `hosts`：MCP 专属/仅其它宿主的不注册。 */
	const visible = toolsForHost(createTaskboardTools(deps.taskboard), 'dsh');
	return adaptDefinitions(visible, deps);
}

// TODO(审查): 这个导出让「插件行」兼作「库」：dsh-agent-guard 的 2 个工具注册依赖本行 ⇒ 用户关掉本行会连带 agent-guard。
//   更好的归属是 @taskboard/dsh-core（Host 公共设施）或开 "./adapter" 子路径；需用户/lead 定。
// TODO(审查): 入参用 ToolDeps 快照 ⇒ 可选服务（agent-guard/subagents）在 apply 后出现也拿不到；可直接改成「每次 execute 调 ctx 工厂」。
/**
 * 把**任意**宿主无关工具定义适配成 DSH 工具。
 *
 * 从 `createTools` 里抽出来的原因：`@taskboard/dsh-agent-guard` 那两个
 * DSH 专属工具（`taskboard_tool_policy` / `_read`）也需要同一套转换，
 * 而它们的定义搬到了那个包 ⇒ 这里必须开放一个入口，**不要复制第二份实现**
 * （两份转换器会漂移，而 DSH 的 schema 约束很细：见下面 `toDshSchema` 的注释）。
 *
 * @param definitions 宿主无关工具定义（顺序即注册顺序）
 * @param deps 宿主依赖（`isManageEdit` 提供 `canManageToolPolicies`）
 * @returns DSH 形状的工具定义
 */
export function adaptDefinitions(
	definitions: readonly TaskboardTool[],
	deps: ToolDeps,
): readonly ToolLike[] {
	const define = deps.defineTool ?? dshDefineTool;
	/* 所有工具共用同一份 output schema ⇒ 只转换一次（`toDshSchema` 是纯函数，行为不变）。 */
	const output = { schema: toDshSchema(TEXT_OUTPUT_SCHEMA), render: renderText };

	return definitions.map((tool) => {
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

/**
 * 把一个 schema 节点转成 DSH 参数 spec（`required` 内联）。
 *
 * ## 两个 DSH 特有的约束（不是 JSON Schema 标准）
 *
 * DSH 的 `defineTool` 编译 schema 时强制：
 *
 * 1. **`type: 'object'` 必须显式带 `additionalProperties: true | false`**
 *    ```
 *    JsonSchemaError: parameters.relations.items.additionalProperties
 *                     must be explicitly true or false
 *    ```
 * 2. **`type` 必须是 `string/number/integer/boolean/null/array/object/json`**
 *    ```
 *    JsonSchemaError: parameters.value.type must be string/number/integer/
 *                     boolean/null/array/object/json, or use oneOf
 *    ```
 *    裸 `{}`（= 任意 JSON）在 v2 里合法，在 DSH 里必须写成
 *    `type: 'json'`（DSH 的专用类型）。`taskboard_update` 的 `value` 就是这种。
 *
 * `@taskboard/tools` 保持宿主无关（MCP 不吃这两个字段）⇒ 在这里补，
 * 这是薄适配层唯一的职责：v2 的平面 schema → DSH 能编译的形状。
 *
 * ## `additionalProperties` 默认 `false`（收紧）
 *
 * v2 里出现的 object 全是 `properties` 明确的参数对象 / 关系项；
 * 放开 `true` 会让模型塞任意额外字段，而下游 `buildCard` / `update`
 * 一律不读它们 ⇒ 静默丢弃。
 * 故意开放的对象（`content`）在 v2 里已显式写 `true`，这里不动。
 *
 * ## 已知取舍：只搬白名单关键字（测试钉着现状，不 throw）
 *
 * 本函数只搬 `type / description / enum / additionalProperties / items / properties`；
 * `oneOf / anyOf / const / default / minimum` 等关键字会被**静默丢弃**。
 * 直接 throw 是行为变化（要先确认 v2 的 schema 真的没用这些关键字、且 DSH 侧
 * 能表达它们），所以当前只记录 + 由 `test/tools.test.ts` 的 schema 用例钉住
 * 「丢弃且不报错」这个现状 —— 将来谁改了搬运策略，那些用例会红。
 *
 * 同理，**「有 `properties` 但没有 `type: 'object'`」** 的合法 JSON Schema
 * （本仓库 v2 没这么写）既不会被推断成 `object`，也不会补
 * `additionalProperties: false`。这类节点真出现时 DSH 会按自己的约束报错 ——
 * 现状同样由测试钉住；要不要自动补是产品/契约决定，不在适配层擅自猜。
 */
// TODO(审查): 先确认 @deepseek-ai/dsh-tools 是否已导出 JSON Schema → ParameterSchemaSpec 的辅助函数（本包不能读 DSH 包）；
//   若有，直接用它替掉下面这套手写转换，别维护两份契约。
export function toDshSchema(node: JsonSchema): Record<string, unknown> {
	const spec: Record<string, unknown> = {};

	/*
	 * 没有 `type` 的节点 = 「任意 JSON」（v2 用 `{}` 表达）。
	 * DSH 必须显式 `type: 'json'`，否则报上面对应的错。
	 */
	if (node.type !== undefined) spec['type'] = node.type;
	else if (node.properties === undefined) spec['type'] = 'json';

	if (node.description !== undefined) spec['description'] = node.description;
	if (node.enum !== undefined) spec['enum'] = node.enum;
	if (node.additionalProperties !== undefined) spec['additionalProperties'] = node.additionalProperties;
	else if (node.type === 'object') spec['additionalProperties'] = false;
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

// TODO(审查): 这里不注入默认空间（符合用户 11-22 取消激活空间的决定），但 ToolDeps 仍收着 defaultWorkspaceId ⇒ 死接线。
//   canManageToolPolicies 也只有 agent-guard 的策略工具消费，9 个工具都不读——跨包确认后删 isManageEdit 依赖。
/**
 * 一次执行的宿主事实。
 *
 * ⚠ 用户 2026-11-22 取消了「激活空间」设定 ⇒ 这里**不再注入**
 *   `resolveDefaultWorkspace` / `activeWorkspaceId`，所有工具调用必须显式给 workspaceId。
 */
function contextOf(deps: ToolDeps, exec: unknown): TaskboardToolContext {
	return {
		holder: holderOf(deps.subagents, exec),
		/* agent 侧「允许编辑档位权限」= manage-edit；档位由 `@taskboard/dsh-agent-guard` 的 `tool-guard.ts` 拥有。 */
		canManageToolPolicies: deps.isManageEdit(),
	};
}
// TODO(审查): describeFailure/describeUnread 是本包内零调用者的 v1 兼容导出（注释自己说「新代码不要用它」）；确认无外部 importer 后
//   直接删函数 + index.ts 导出 + 两条测试（test/tools.test.ts:538-555）。
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
