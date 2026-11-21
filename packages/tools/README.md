# `@taskboard/tools`

任务板的 **AI 工具定义层**（**tool contract v2**）—— 与宿主无关，**MCP 与 DSH 通用**。

```
packages/tools  ──►  packages/core  ──►  packages/protocol
```

- `tools` **只调用** `core`；`core` 绝不引用 `tools`（用户原话：
  「ai tool 是一个独立在 core 之外的包。这个包只对 core 进行调用。
  core 不会调用他，因此他们的层级不一样。」）。
- 同一个包既能被 MCP server 消费，也能被 DSH 插件消费 ⇒ **不依赖**
  `@deepseek-ai/dsh-tools`、cordis、任何 HTTP 框架、任何 `node:` 内置或 zod。

## v2 的工具（10 个）

9 条用户定义 + 用户后续裁决新增的「看原始卡」。名字、顺序、参数都定义在
`src/tools.ts`（顺序是 prompt 前缀契约）。

| # | 工具 | 一句话 |
|---|---|---|
| 1 | `taskboard_workspaces` | 列空间 + 卡数 + `includeArchived`；DSH 额外标出激活空间 |
| 2 | `taskboard_cards` | 列卡/搜索：空间 + 标题模糊 + 状态/领域/分类/模板 + 用户没看/AI 没看 + `page` |
| 3 | `taskboard_card` | 按编号查看卡（强制含草稿/墓碑；acton 视图；**查看即 AI 已读**） |
| — | `taskboard_raw_card` | 看**原始 JSON** `{ [章节key]: actionPayload }`（改卡前先确认结构） |
| 4 | `taskboard_definitions` | 查看定义：`name` 可空=列出；`type` 枚举（domain/state/template/kind）消歧 |
| 5 | `taskboard_create` | 建卡：title + 模板 + 关系数组 + 模板对 action 的 JSON（空模板要 kind/domain） |
| 6 | `taskboard_update` | JSON 路径替换（JSON Pointer；**替换语义**；返回合并后的完整 JSON） |
| 7 | `taskboard_update_note` | 更新备注（空串 = 清空） |
| 8 | `taskboard_transition` | 采纳 / 领取 / 释放 / 普通转移；目标为空 = 查「可转移 + 条件目标」 |
| 9 | `taskboard_tool_policy` | **仅 DSH**：三 scope 工具权限；需 agent 侧权限开关 |

## 形状

```ts
interface TaskboardTool {
  name: string;
  description: string;
  inputSchema: JsonObjectSchema;  // 纯 JSON Schema，深冻结
  handler(args, ctx): Promise<{ text: string; isError?: boolean }>;
  hosts?: ('dsh' | 'mcp')[];      // v2：仅某些宿主可用（#9 = ['dsh']）
}

const tools = createTaskboardTools(taskboard);                       // 全部 10 个
const dsh = createTaskboardToolRegistry(tools, { host: 'dsh' });     // 10 个
const mcp = createTaskboardToolRegistry(tools, { host: 'mcp' });     // 9 个（无 #9）
```

### 宿主事实全部走 `ctx`（`TaskboardToolContext`）

| 字段 | 谁提供 | 缺失时 |
|---|---|---|
| `holder` | 宿主的 agent 身份 | claim / release 明确失败（不编名字） |
| `resolveDefaultWorkspace()` | 注册了「空间为空 = 激活空间」的宿主 | **工具报错**（MCP 等），并教 AI 显式传 workspaceId |
| `activeWorkspaceId` | DSH 的激活空间可观测性 | #1 不显示激活空间 |
| `canManageToolPolicies` | DSH 的 agent 侧权限开关 | #9 拒绝执行 |

## 失败契约（v2 自定，用户待审）

```
失败：<说清发生了什么>
原因码：<Failure.code>
能否重试：<修正参数后可重试 | 不要重试（先修装配 / 权限）>
下一步：<可执行动作：调哪个工具、改哪个参数、找谁>
具体问题：
· /path：message
```

`isError: true`。所有写操作都是「先校验 → 单次落库」，**没有部分成功**
（建卡关系失败时卡不会建；更新校验失败时内容不变）。

## 返回契约

| 工具 | 返回 |
|---|---|
| #1 | 文本：空间清单 + 卡数 + 激活空间 |
| #2 | 文本：总数/页码 + 每行一张卡（含未读标记）+ 下一页提示 |
| #3 | 文本：状态/历史/关系/备注 + 每章节的 action 视图 + 查看前后未读 |
| raw | **纯 JSON**：`{ [章节key]: payload }` |
| #4 | 文本：清单（可只列一类）或某条定义详情（模板含章节/action/默认 payload） |
| #5 | 文本：已建卡 + 模板的「下一步」+ 分类描述 + 章节 + 关系（用户裁决 #11） |
| #6 | **纯 JSON**：合并后的完整内容（用户裁决 #12） |
| #7 | 文本：已更新/已清空 + 字数 |
| #8 | 文本：执行结果（from→to、动作、持有者）；空目标时是目标/条件清单 |
| #9 | 文本：scope + 新配置 + 新增/移除/忽略/受保护明细 |

## 接到宿主上

### DSH

```ts
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  createTaskboardToolRegistry, TEXT_OUTPUT_SCHEMA, textContentBlocks,
  type JsonObjectSchema,
} from '@taskboard/tools';

/** 标准 JSON Schema → DSH 的 parameters 记录（required 内联）。 */
function toDshParameters(schema: JsonObjectSchema): Record<string, unknown> {
  const required = new Set(schema.required ?? []);
  return Object.fromEntries(
    Object.entries(schema.properties).map(([key, node]) => [
      key,
      required.has(key) ? { ...node, required: true } : node,
    ]),
  );
}

const registry = createTaskboardToolRegistry(createTaskboardTools(taskboard), { host: 'dsh' });
for (const definition of registry.tools) {
  ctx.tools.register(defineTool({
    name: definition.name,
    description: definition.description,
    parameters: toDshParameters(definition.inputSchema),
    output: { schema: TEXT_OUTPUT_SCHEMA, render: (_a, value) => textContentBlocks(value) },
    execute: (args, exec) =>
      definition.handler(args, {
        holder: holderOf(ctx.subagents, exec),
        resolveDefaultWorkspace: activeWorkspaceId,   // DSH 的「激活空间」
        activeWorkspaceId: await activeWorkspaceId(),
        canManageToolPolicies: toolGuardLevel === 'manage-edit',
      }),
  }));
}
```

### MCP

```ts
const registry = createTaskboardToolRegistry(createTaskboardTools(taskboard), { host: 'mcp' });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: registry.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  /* MCP 没注册「空间为空 = 激活空间」⇒ 不传 resolveDefaultWorkspace，工具会报错让 AI 显式传。 */
  const result = await registry.invoke(request.params.name, request.params.arguments, { holder: 'mcp' });
  return { content: textContentBlocks(result), ...(result.isError === true ? { isError: true } : {}) };
});
```

## core 侧为 v2 补的公开 API

| API | 为什么不能在 tools 层做 |
|---|---|
| `replaceContentAt(ws, id, pointer, value, actor)` | 要「整份内容重新过模板校验 + 走 `withHistory` 落库」，绕开就是第二套写路径 |
| `transitionAdvice(ws, id, holder?)` | 领取准入（依赖/子任务/配额）在 core 的 `judgeClaim`，工具层重写就是第二份真值 |
| `setToolPolicyScope({ tier \| templateRef, allow, remove })` | 权限持久化在 core 的 kv + 判定在 `judgeToolCall`，tools 层碰不到 |
| `CreateInput.kind/domain`（空模板覆盖） | 发号字母与卡上 `template` 快照由 core 的 create 决定 |
| `contentOfCard(card)` | 「模板内 JSON」的唯一投影（raw 工具与 update 路径共用） |

## 开发

```powershell
node node_modules/typescript/bin/tsc -b packages/tools   # 会先构建 protocol / core
node --test "packages/tools/test/*.test.ts"             # 直跑 src/*.ts；跨包 import 走包名 → core/lib
```

测试不依赖 cwd；`packages/tools/lib` 删掉后测试仍应全绿（跑的是 `src/`）。

## ⚠ 还没做

- `packages/dsh/src/tools.ts` 仍是 v1 的 16 个工具实现（不是薄适配层）。
  迁移时注意：`taskboard_tool_policy` 要加进 core 的 `POLICY_TOOLS`，并更新 dsh 的权限测试。
- `taskboard_update` 只能改「模板内 JSON」；**改标题**没有入口（用户 v2 参数里没有 title，
  需要时再补）。
- #5 的「先看定义」是**描述 + 错误指引**，不是硬门（工具无状态，无法真的校验调用顺序）。
