/**
 * 工具定义层的数据形状 —— **只有形状，没有行为**（tool contract v2）。
 *
 * 三个刻意的设计：
 *
 * 1. **`inputSchema` 是纯 JSON Schema**（MCP 与 DSH 都吃这套），不用 zod 之类的
 *    运行时库把形状绑死；DSH 适配层负责把它转成 `parameters` 记录。
 * 2. **`handler` 只碰 `Taskboard` + `TaskboardToolContext`**，不碰 HTTP / cordis /
 *    DSH exec —— 宿主差异全部从 `ctx` 注入。
 * 3. **`hosts` 元数据**表达「这个工具只在某些宿主有」。v2 的
 *    `taskboard_tool_policy` 只在 DSH 出现（MCP 没有「拦工具调用」这件事），
 *    由宿主适配层按 `hosts` 过滤，**不在工具 handler 里判宿主**。
 */

/** JSON Schema 允许的 `type` 值（只列本包用到的子集）。 */
export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';

/**
 * 一个 JSON Schema 节点。
 *
 * 只放本包真的用到的关键字。**额外留空 schema `{}`**（= 任意 JSON）给
 * `taskboard_update` 的 `value`：路径可能指向字符串、数组、对象，
 * 锁成 object 会让「改一个文本字段」都写不了。
 */
export interface JsonSchema {
	readonly type?: JsonSchemaType;
	readonly description?: string;
	readonly properties?: Readonly<Record<string, JsonSchema>>;
	readonly required?: readonly string[];
	readonly items?: JsonSchema;
	readonly enum?: readonly string[];
	readonly additionalProperties?: boolean;
}

/** 工具入参的顶层 schema：必须是对象。 */
export interface JsonObjectSchema extends JsonSchema {
	readonly type: 'object';
	readonly properties: Readonly<Record<string, JsonSchema>>;
}

/** 一个宿主。v2 只有两个消费方。 */
// TODO(审查): hosts 过滤机制已空转 —— 两个 DSH 专属工具搬到 dsh-agent-guard 后，
// 9 个工具都不再标 hosts（contract.test.ts 还专门断言了这一点），toolsForHost / TaskboardToolRegistryOptions.host
// 没有可过滤的东西。它现在唯一的可见效果是 registry.ts 拼出一句误导文案「可能只存在于其它宿主」。可直接删（或注明保留原因）。
export type ToolHost = 'dsh' | 'mcp';

/**
 * 一次工具调用的**宿主侧上下文**。
 *
 * 这里只放「每次调用会变」的宿主事实。任务板实例本身是工厂参数。
 *
 * | 字段 | 谁提供 | 缺失时 |
 * |---|---|---|
 * | `holder` | 宿主的 agent 身份 | claim / release 会明确失败（不编名字） |
 * | `resolveDefaultWorkspace` | 宿主注册了「空间为空」的行为时 | 工具报错（MCP 等） |
 * | `activeWorkspaceId` | DSH 激活空间的可观测性 | #1 不显示激活空间 |
 * | `canManageToolPolicies` | DSH 的 agent 侧权限开关 | #9 拒绝执行 |
 */
export interface TaskboardToolContext {
	/** 当前调用者（claim / release 的持有者）。 */
	readonly holder?: string;
	/**
	 * 宿主对「空间参数为空」的解析器。
	 *
	 * - DSH 注入「激活空间」解析；
	 * - MCP 等**不注入** ⇒ 工具返回「本宿主没有注册该行为」的失败，
	 *   并提示 AI 显式传 workspaceId（用户前提：「MCP 等进行报错」）。
	 */
	readonly resolveDefaultWorkspace?: () => Promise<string> | string;
	/** 宿主已知的激活空间 id（用于 #1 展示；不参与解析）。 */
	readonly activeWorkspaceId?: string;
	/** agent 侧权限开关是否启用（#9 的门槛）。 */
	readonly canManageToolPolicies?: boolean;
	// TODO(审查): 上面三个字段（resolveDefaultWorkspace / activeWorkspaceId / canManageToolPolicies）在 tools/src 里
	// **零读取**（只有测试夹具 fixtures.ts 还在填）：激活空间已被用户 2026-11-22 取消，权限工具已搬到 dsh-agent-guard；
	// 而本文件 52-54 行的「谁提供 / 缺失时」表格仍在承诺行为。⇒ 删字段或注明「保留接口、当前无消费者」。需用户决定是否保留这个公开面。
}

/**
 * 一次工具调用的结果。
 *
 * 所有工具共用一份 `TEXT_OUTPUT_SCHEMA`（见 `schema.ts`）；模型读文字。
 * `isError` 用于宿主把结果翻成 MCP 的 `isError` / UI 标红。
 */
export interface TaskboardToolResult {
	readonly text: string;
	readonly isError?: boolean;
}

/** 工具处理函数。 */
export type TaskboardToolHandler = (
	args: unknown,
	ctx: TaskboardToolContext,
) => Promise<TaskboardToolResult>;

/** 一个宿主无关的工具定义。 */
export interface TaskboardTool {
	/** 工具名。**权限只匹配这个名字**（用户：「权限只匹配 tool 名字，不匹配重载和参数」）。 */
	readonly name: string;
	/** 给模型看的说明。 */
	readonly description: string;
	/** 纯 JSON Schema 入参。 */
	readonly inputSchema: JsonObjectSchema;
	/** 执行体。 */
	readonly handler: TaskboardToolHandler;
	/** 只在哪些宿主可用；省略 = 所有宿主。 */
	readonly hosts?: readonly ToolHost[];
}

/** 按名字查找的注册表。 */
export interface TaskboardToolRegistry {
	/** 当前宿主可见的工具（顺序 = 注册顺序）。 */
	readonly tools: readonly TaskboardTool[];
	/** 当前宿主可见的工具名。 */
	readonly names: readonly string[];
	/** 按名字取工具。 */
	get(name: string): TaskboardTool | undefined;
	has(name: string): boolean;
	/**
	 * 按名字执行。
	 *
	 * @throws 名字不存在 —— 宿主接线错误（不是模型传错参数）。
	 */
	invoke(name: string, args?: unknown, ctx?: TaskboardToolContext): Promise<TaskboardToolResult>;
}

/** 注册表选项。 */
export interface TaskboardToolRegistryOptions {
	/** 按宿主过滤 `hosts` 元数据。省略 = 全部（不推荐宿主直接用）。 */
	readonly host?: ToolHost;
}
