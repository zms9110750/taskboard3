# `@taskboard/tools`

任务板的 **AI 工具定义层** —— 与宿主无关，**MCP 与 DSH 通用**。

```
packages/tools  ──►  packages/core  ──►  packages/protocol
```

- `tools` **只调用** `core`；`core` 绝不引用 `tools`（用户原话：
  「ai tool 是一个独立在 core 之外的包。这个包只对 core 进行调用。
  core 不会调用他，因此他们的层级不一样。」）。
- 同一个包既能被 MCP server 消费，也能被 DSH 插件消费 ⇒ **不依赖**
  `@deepseek-ai/dsh-tools`、cordis 或任何 HTTP 框架。

## 为什么独立于 core

core 是领域逻辑（卡 / 状态机 / 校验 / 存储端口）。工具定义是**另一个消费者**
的契约：工具名、给模型看的描述、JSON Schema、文案。把它塞进 core 会让
core 背上「模型怎么用」的知识，并且 core 反过来要认识「工具」这个概念 ——
那正是要避免的层级倒置。

## 形状

```ts
interface TaskboardTool {
  name: string;                       // taskboard_*
  description: string;                // 给模型看
  inputSchema: JsonObjectSchema;      // 纯 JSON Schema（深冻结）
  handler(args, ctx): Promise<{ text: string; isError?: boolean }>;
}

const tools = createTaskboardTools(taskboard, {
  defaultWorkspaceId: async () => 'ws-1',   // 可选：入口的默认空间策略
});
const registry = createTaskboardToolRegistry(tools);
const result = await registry.invoke('taskboard_cards', { status: ['active'] }, { holder: 'lead' });
```

### 三个刻意的取舍

| 取舍 | 理由 |
|---|---|
| **纯 JSON Schema**，不用 zod 等运行时库 | 那是 MCP 与 DSH 协议里唯一的共同语言；用运行时库会把参数形状绑死在库版本上 |
| `handler` 只碰 `Taskboard` + `ctx.holder` | 任何 HTTP / cordis / DSH 概念一进来，包就只能被那个宿主消费 |
| 结果统一是 `{ text }` | 模型读得懂自然语言；每个工具各写一份 output schema 是把同一件事抄十六遍 |
| `inputSchema` 深冻结 | 工具 schema 在 prompt 前缀里，**一动就击穿 KV cache**（用户裁定） |

### 调用上下文只有 `holder`

其余事实的归属：

| 事实 | 放哪 | 为什么 |
|---|---|---|
| `Taskboard` 实例 | 工厂参数 | 绑定一次，不随调用变 |
| 默认空间策略 | 工厂参数 | 入口装配时确定（用户：「整个激活都只对 dsh 会话有效。mcp 是没法提供的。」） |
| 当前调用者的名字 | **每次调用的 `ctx.holder`** | 同一个任务板实例会被不同 agent 调用 |

`holder` 由**宿主**算好再传：DSH 用 `ctx.subagents.namesOf(agent).self`（兜底 UUID），
MCP 用自己配置的身份。本包不认识 `agent` / `subagents` / `exec`。

## 怎么接到宿主上

两个适配层都只做「形状转换」，不碰业务规则。

### DSH（`@deepseek-ai/dsh-tools`）

DSH 的 `parameters` 是「键 → 子 schema」记录（`required` 内联在每个属性上），
而本包的 `inputSchema` 是标准 JSON Schema（`required: [...]` 在顶层）
⇒ 适配层做一次形状转换：

```ts
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  createTaskboardToolRegistry, createTaskboardTools,
  TEXT_OUTPUT_SCHEMA, textContentBlocks,
  type JsonObjectSchema,
} from '@taskboard/tools';

/** 标准 JSON Schema → DSH 的 parameters 记录。 */
function toDshParameters(schema: JsonObjectSchema): Record<string, unknown> {
  const required = new Set(schema.required ?? []);
  return Object.fromEntries(
    Object.entries(schema.properties).map(([key, node]) => [
      key,
      required.has(key) ? { ...node, required: true } : node,
    ]),
  );
}

const registry = createTaskboardToolRegistry(createTaskboardTools(taskboard, { defaultWorkspaceId }));

for (const definition of registry.tools) {
  ctx.tools.register(defineTool({
    name: definition.name,
    description: definition.description,
    parameters: toDshParameters(definition.inputSchema),
    output: {
      schema: TEXT_OUTPUT_SCHEMA,
      render: (_args, value) => textContentBlocks(value),
    },
    execute: (args, exec) =>
      definition.handler(args, { holder: holderOf(ctx.subagents, exec) }),
  }));
}
```

### MCP

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { createTaskboardToolRegistry, createTaskboardTools } from '@taskboard/tools';

const registry = createTaskboardToolRegistry(createTaskboardTools(taskboard));

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: registry.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await registry.invoke(request.params.name, request.params.arguments, { holder: 'mcp' });
  return {
    content: textContentBlocks(result),
    ...(result.isError === true ? { isError: true } : {}),
  };
});
```

## 工具清单（16 个，名字与 `@taskboard/dsh` 的旧实现完全一致）

| 工具 | 职责 |
|---|---|
| `taskboard_workspaces` | 列空间（可含归档） |
| `taskboard_cards` | 列卡 / 搜索（标题、状态、类别、领域、模板、未读维度） |
| `taskboard_card` | 单卡详情（元数据 + 章节 + 历史，含墓碑） |
| `taskboard_create` | 建卡（AI actor） |
| `taskboard_update_content` | 改章节内容（只改传入的章节） |
| `taskboard_update_note` | 改备注 |
| `taskboard_transition` | 查 / 执行状态转移（不执行采纳） |
| `taskboard_adopt` | 采纳草稿（独立授权档位） |
| `taskboard_claim` | 领取工作卡（holder = 当前 agent） |
| `taskboard_release` | 释放领取 |
| `taskboard_registry` | 模板 / action 注册表 |
| `taskboard_mark_seen` | 标记 AI 已读 |
| `taskboard_tool_policies` | 读四档工具权限 |
| `taskboard_tool_policy_set` | 写某一档增量 |
| `taskboard_tool_policy_members` | 设组成员 |
| `taskboard_tool_policy_reset` | 清空某一档 / 删组 |

## 开发

```powershell
# 构建（会先构建 protocol / core：project references）
node node_modules/typescript/bin/tsc -b packages/tools

# 测试（直接跑 src/*.ts；跨包 import 走包名 → core/lib，所以先构建）
node --test "packages/tools/test/*.test.ts"
```

测试**不依赖 cwd**：模板目录从 `@taskboard/core/package.json` 反推，存储用内存实现。

## ⚠ 还没做

- `packages/dsh` 仍是旧实现（工具直接绑 `defineTool`）。下一步应改成**薄适配层**
  （照上面的示例），然后删掉 `packages/dsh/src/tools.ts` 里的 16 个工具本体与
  `actions.ts` 的重复判据。本包先把「宿主无关的那一半」立住，`dsh` 的改动单独做。
- MCP server 本身（`packages/mcp`）还没建。
