/**
 * `@taskboard/tools` —— 任务板的**宿主无关 AI 工具定义层**（tool contract v2）。
 *
 * ## 层级（用户原话）
 *
 * > ai tool 是一个独立在 core 之外的包。这个包只对 core 进行调用。
 * > core 不会调用他，因此他们的层级不一样。
 *
 * ```
 * packages/tools ──► packages/core ──► packages/protocol
 * ```
 *
 * ## v2 的 10 个工具
 *
 * 9 条用户定义 + 用户后续裁决新增的「看原始卡」。清单与顺序见 `tools.ts`。
 *
 * ## 三条硬边界（都有测试守着）
 *
 * · `dependencies` 只有 `@taskboard/core` / `@taskboard/protocol`；
 * · `src/` 只允许相对 `.ts` 与上面两个包名 —— 不 import dsh-tools / cordis /
 *   express / zod / 任何 `node:` 内置；
 * · 「仅 DSH」用工具上的 `hosts: ['dsh']` 元数据表达，由宿主适配层过滤，
 *   本包不判断「现在是什么宿主」。
 */

export type {
	JsonObjectSchema,
	JsonSchema,
	JsonSchemaType,
	TaskboardTool,
	TaskboardToolContext,
	TaskboardToolHandler,
	TaskboardToolRegistry,
	TaskboardToolRegistryOptions,
	TaskboardToolResult,
	ToolHost,
} from './types.ts';

export { TEXT_OUTPUT_SCHEMA, textContentBlocks, type TextContentBlock } from './schema.ts';

/**
 * 失败契约（用户：「失败的部分让他自己发挥，我要检查」）。
 *
 * 所有工具失败都走 `failureResult`：文本里带原因码 / 能否重试 / 下一步 / 字段问题，
 * `isError: true`。详见 `failure.ts` 文件头。
 */
export { failureResult, retryText, type Retryability } from './failure.ts';

export { createTaskboardToolRegistry, toolsForHost } from './registry.ts';

/** 建全部工具（名字与顺序都是契约）。 */
export { createTaskboardTools } from './tools.ts';

/** `#2` 的分页大小（宿主适配层 / 测试可引用）。 */
export { CARDS_PAGE_SIZE } from './tools/shared.ts';

/** `#8` 的目标字符串解析（状态 id 或中文名）。 */
export { resolveStateId } from './tools/transition.ts';

/** `#5` 关系数组的类型枚举。 */
export { RELATION_TYPES } from './tools/create.ts';

/** `#4` 定义类型枚举（领域 / 状态 / 模板 / 分类）。 */
export { DEFINITION_TYPES, type DefinitionType } from './definitions.ts';
