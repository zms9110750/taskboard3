/**
 * 工具定义层的数据形状 —— **只有形状，没有行为**。
 *
 * 这里的每个类型都刻意保持「宿主中立」：
 *
 * · `inputSchema` 是**纯 JSON Schema**（MCP 与 DSH 都吃这套），不是 zod 之类的
 *   运行时库对象。用运行时库会把「参数形状」绑死在某个库的版本上；
 *   而 JSON Schema 是两边协议里唯一的共同语言。
 * · `handler` 只接收「模型给的参数」+「宿主给的调用上下文」，**不接收
 *   HTTP 请求 / cordis Context / DSH exec** —— 那些是适配层的事。
 */

/** JSON Schema 允许的 `type` 值（只列本包用到的子集）。 */
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';

/**
 * 一个 JSON Schema 节点。
 *
 * ## 为什么不用 `Record<string, unknown>`
 *
 * 那样「schema 里写错一个键（`propeties`）」不会有任何编译错误，
 * 而且宿主拿到坏 schema 时的失败方式各不相同。窄类型让错键在 `tsc` 就红。
 *
 * ## 为什么故意不完整
 *
 * 只放本包真的用到的关键字（`type` / `properties` / `required` / `items` /
 * `enum` / `additionalProperties` / `description`）。**不追求覆盖 JSON Schema
 * 全集** —— 工具参数表不是通用 schema 编辑器，多放一个关键字就多一份
 * 「宿主能否解释它」的兼容性风险。
 */
export interface JsonSchema {
	readonly type?: JsonSchemaType;
	/** 给模型看的说明（会进 prompt，所以措辞要短、要能指导选参）。 */
	readonly description?: string;
	readonly properties?: Readonly<Record<string, JsonSchema>>;
	/** 必填的**属性名**（不是属性值），顺序即 prompt 里的顺序。 */
	readonly required?: readonly string[];
	readonly items?: JsonSchema;
	/** 只用于结构封闭、不随数据变化的枚举（如权限档位三选一）。 */
	readonly enum?: readonly string[];
	/** `true` ⇒ 允许任意额外键（开放对象，见 `taskboard_create` 的 `content`）。 */
	readonly additionalProperties?: boolean;
}

/**
 * 工具入参的顶层 schema：**必须是对象**。
 *
 * MCP 与 DSH 都要求工具入参是对象（模型产出的是键值对）。
 * 用更窄的类型把这条约束钉在编译期，而不是等宿主报错。
 */
export interface JsonObjectSchema extends JsonSchema {
	readonly type: 'object';
	readonly properties: Readonly<Record<string, JsonSchema>>;
}

/**
 * 一次工具调用的**宿主侧上下文**。
 *
 * ## 为什么只有 `holder`
 *
 * 另外三样东西都不是「每次调用」的事实：
 *
 * | 事实 | 放哪 | 为什么 |
 * |---|---|---|
 * | `Taskboard` 实例 | 工厂参数 | 绑定一次，不随调用变 |
 * | 默认空间策略 | 工厂参数 | 入口装配时确定（见 `TaskboardToolsOptions`） |
 * | 当前调用者的名字 | **本上下文** | 同一个任务板实例会被不同 agent 调用 |
 *
 * ⚠ `holder` 由**宿主**算好再传：DSH 用 `ctx.subagents.namesOf(agent).self`
 *   兜底 UUID；MCP 用自己配置的身份。本包不认识 `agent` / `subagents` /
 *   `exec` —— 认识任何一个都会把本包绑回某个宿主。
 */
export interface TaskboardToolContext {
	/**
	 * 当前调用者的持有者标识（`lead` / `reviewer/checker` / UUID）。
	 *
	 * 省略 ⇒ `'unknown'`（程序化调用没有身份；`claim` / `release` 仍可用，
	 * 只是卡上会记成 `unknown`，与 `dsh/src/holder.ts` 的回落一致）。
	 */
	readonly holder?: string;
}

/**
 * 一次工具调用的结果。
 *
 * ## 为什么是 `{ text }` 而不是结构化 JSON
 *
 * 模型读得懂自然语言；每个工具各写一份结构化 output schema 是把同一件事
 * 抄十六遍，而且改一次文案就要改 schema。⇒ 所有工具共用
 * `TEXT_OUTPUT_SCHEMA`（见 `schema.ts`），宿主直接从 `text` 生成 content 块。
 *
 * ## `isError` 的语义
 *
 * `true` ⇒ **这次调用失败**（领域失败 / 参数不合形状）。MCP 会把它翻成
 * tool result 的 `isError`，UI 会标红；DSH 侧可以忽略（纯文本仍可读）。
 * 注意：「查询结果为空」**不是**错误（`taskboard_cards` 找不到卡返回正常文本）。
 */
export interface TaskboardToolResult {
	readonly text: string;
	readonly isError?: boolean;
}

/** 工具处理函数：只碰 `Taskboard` 与本层上下文。 */
export type TaskboardToolHandler = (
	args: unknown,
	ctx: TaskboardToolContext,
) => Promise<TaskboardToolResult>;

/** 一个宿主无关的工具定义。 */
export interface TaskboardTool {
	/** 工具名（`taskboard_*`）。**是契约**：同名同义，改名等于破坏已有会话。 */
	readonly name: string;
	/** 给模型看的说明。 */
	readonly description: string;
	/** 纯 JSON Schema 入参。 */
	readonly inputSchema: JsonObjectSchema;
	/** 执行体。 */
	readonly handler: TaskboardToolHandler;
}

/**
 * 工厂参数 —— **入口策略**，不是 core 概念。
 *
 * 用户 `2026-11-13`：
 *
 * > 整个激活都只对 dsh 会话有效。mcp 是没法提供的。
 *
 * ⇒ 「默认空间」只能由各入口自己决定。本层不假设「当前空间」这种全局状态，
 *   只提供一个可注入的解析函数；不传则退化为「第一个空间，没有就建『默认』」
 *   （与 `dsh` 入口的策略一致，让 MCP 侧开箱可用）。
 */
export interface TaskboardToolsOptions {
	/**
	 * 解析「这次调用没带 workspaceId 时用哪个空间」。
	 *
	 * 省略 ⇒ `listWorkspaces(false)[0]`，一个空间都没有时 `ensureAnyWorkspace()`。
	 */
	readonly defaultWorkspaceId?: () => Promise<string> | string;
}

/** 按名字查找的注册表。 */
export interface TaskboardToolRegistry {
	/** 全部工具（顺序 = 注册顺序 = 工厂返回顺序）。 */
	readonly tools: readonly TaskboardTool[];
	/** 全部工具名（快照，不可变）。 */
	readonly names: readonly string[];
	/** 按名字取工具；不存在返回 `undefined`。 */
	get(name: string): TaskboardTool | undefined;
	/** 按名字判存在。 */
	has(name: string): boolean;
	/**
	 * 按名字执行。
	 *
	 * @throws 名字不存在 —— 这是**宿主接线错误**，不是模型传错参数。
	 *   静默返回一段「没有这个工具」的文本会把接线 bug 藏起来
	 *   （宿主本该只派发注册过的工具）。
	 */
	invoke(name: string, args?: unknown, ctx?: TaskboardToolContext): Promise<TaskboardToolResult>;
}
