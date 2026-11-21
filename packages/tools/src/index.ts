/**
 * `@taskboard/tools` —— 任务板的**宿主无关 AI 工具定义层**。
 *
 * ## 为什么独立于 `@taskboard/core`
 *
 * 用户原话：
 *
 * > ai tool 是一个独立在 core 之外的包。这个包只对 core 进行调用。
 * > core 不会调用他，因此他们的层级不一样。
 *
 * ⇒ 依赖是**单向**的：
 *
 * ```
 * packages/tools ──► packages/core ──► packages/protocol
 * ```
 *
 * `core` 不认识本包（不 import 它、也没有任何注册表指向它）。本包只把
 * `Taskboard` 接口翻译成模型能调用的工具。
 *
 * ## 为什么独立于 `@taskboard/dsh`
 *
 * 用户原话：
 *
 * > 这个是 mcp 和 dsh 通用的。
 *
 * 两边的**工具契约不同**：
 *
 * | | MCP | DSH |
 * |---|---|---|
 * | 参数表 | 完整 JSON Schema（`inputSchema`） | `parameters` 记录（dsh-tools 自己转换） |
 * | 执行结果 | `content: [{ type: 'text', text }]` | `output.render` 返回同样的块 |
 * | 调用上下文 | 自己的 identity | `ctx.subagents.namesOf(agent).self` |
 *
 * ⇒ 本包**只产出两者共同的部分**：工具名、描述、纯 JSON Schema、只碰 `Taskboard`
 *   的 handler。宿主差异（`defineTool` 包装、holder 怎么算、默认空间策略）由
 *   **各自的薄适配层**提供 —— 见 `README.md` 里的接线示例。
 *
 * ## 硬边界（都有测试守着）
 *
 * · `package.json` 的 `dependencies` 只有 `@taskboard/core` / `@taskboard/protocol`；
 * · `src/` 里只允许 `./x.ts` 相对导入与上面两个包名 ——
 *   **不 import** `@deepseek-ai/*`、cordis、`express`、`zod`、任何 `node:` 内置。
 */

export type {
	JsonObjectSchema,
	JsonSchema,
	JsonSchemaType,
	TaskboardTool,
	TaskboardToolContext,
	TaskboardToolHandler,
	TaskboardToolRegistry,
	TaskboardToolResult,
	TaskboardToolsOptions,
} from './types.ts';

export {
	textContentBlocks,
	TEXT_OUTPUT_SCHEMA,
	type TextContentBlock,
} from './schema.ts';

export { describeFailure, describeUnread } from './format.ts';

export { adoptTargetOf, isAdoptTransition } from './adopt.ts';

export { createTaskboardToolRegistry } from './registry.ts';

/**
 * 全部 16 个工具（名字与顺序都是契约）。
 *
 * 名字与 `packages/dsh/src/tools.ts` 那 16 个**完全一致** —— 目的不是抄，
 * 而是让 `dsh` 将来能退化成薄适配层时，**已有会话里模型记住的工具名不变**
 * （改名字等于破坏 prompt 缓存与历史对话里的调用）。
 */
export { createTaskboardTools, resolveStateId } from './tools.ts';
