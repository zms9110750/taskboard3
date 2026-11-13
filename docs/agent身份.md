# dsh 里的 agent 身份（holder 用）

> 调研 `task-12`。**只做调研，未写任何生产代码。**
> 标注约定：**【读到】** = 有源码依据，附路径与行号；**【推断】** = 由读到的事实推出，未实测。

---

## 结论

**holder 用 `ctx.subagents.namesOf(agent).self`，兜底用 `exec.agent.id`。**

```
holder = subagents?.namesOf(agent).self ?? agent.id
```

- 正常情况拿到 `lead` / `reviewer` / `reviewer/checker`
- `ctx.subagents` 没挂载（或 agent 不在 subagent 树里）时，`namesOf` 抛错 ⇒ 回落 Session id（一个 UUID）

**这不是变通，是 DSH 官方的做法。** DSH 自己的 Agent Teams 就是这么实现的——`claim` 时取 `namesOf(caller).self` 存进 `ownerName`（`dsh-agent-team/src/task-board.ts:149-151`）。

---

## Q1. `exec` 到底有什么

**【读到】** `execute` 的第二个参数类型是 `ToolRunContext`：

`dsh-tools/src/contracts.ts:40`

```ts
execute(args: unknown, exec: ToolRunContext): Promise<unknown>
```

**【读到】** 类型继承链：

`contracts.ts:245`

```ts
export interface ToolRunContext extends ToolExecution {
  deferContext(context: UserMessage): void
  concludeTurn(): void
}
```

`contracts.ts:220`

```ts
export interface ToolExecution extends ToolExecutionInput {
  readonly rootCallId: ToolCallId
  readonly token: ToolExecutionToken
}
```

**【读到】** 完整的字段清单（`contracts.ts:175-203` 的 `ToolExecutionInput` + `220-225` + `245-262`）：

| 字段 | 类型 | 说明 | 行号 |
|---|---|---|---|
| `callId` | `ToolCallId` | 本次调用 id | 176 |
| `rootCallId` | `ToolCallId` | 根调用 id（PTC 嵌套时不同） | 182 / 222 |
| `name` | `string` | 工具名 | 182 |
| `schema?` | `ToolSchema` | PTC 内部调用时的 schema | 184 |
| `arguments` | `unknown` | 已解析、已冻结的参数 | 186 |
| **`agent?`** | **`Agent`** | **「The agent on whose behalf the call runs (set by the agent loop)」** | **188** |
| `toolSet?` | `ResolvedToolSet` | 本 step 的准入集合 | 190 |
| `parent?` | `ToolExecutionToken` | 父执行 token | 200 |
| `signal` | `AbortSignal` | 取消信号 | 202 |
| `token` | `ToolExecutionToken` | executor 分配的 token | 224 |
| `deferContext()` | 方法 | 往结果追加 context | 252 |
| `concludeTurn()` | 方法 | 标记本回合结束 | 261 |

**没有 `log`。** 任务描述里提到的 `exec.log` 在 `ToolRunContext` 里不存在——那可能来自更早的版本或其他包。**【读到】** `contracts.ts:40-262` 全文没有 `log` 字段。

---

## Q2. agent 有没有「人可读的名字」

### Q2.1 `exec.agent` 里没有名字

**【读到】** `Agent` 的类型定义在 `dsh-agent/src/types.ts:16-19`：

```ts
/** Public live-agent handle; the runtime face augments its live capabilities. */
export interface Agent {
  /** Session-backed Agent identity. */
  readonly id: SessionId
}
```

**只有 `id`**，而且是 `SessionId`（一个 brand，实际就是会话 UUID）。

**【读到】** 运行时会话里补了别的字段（`dsh-agent/src/runtime-types.ts:190-272` 的 `declare module './types.ts'`）：

```ts
interface Agent {
  readonly options: AgentOptions      // 模型路由
  readonly session: Session           // 会话（含日志）
  readonly model: Model
  readonly inbox: Inbox
  readonly status: AgentStatus
  readonly ctx: Context
  cancel(...)
  whenIdle(): Promise<void>
  runMaintenance(...)
  send(...) / followup(...) / steer(...) / inject(...)
}
```

**仍然没有 `name`。** 我逐行看了 190–272 行，没有任何名字字段。

### Q2.2 名字在 `ctx.subagents` 里

**【读到】** `dsh-subagent/src/index.ts:304-314`：

```ts
/**
 * Report the model-facing names of a live tree member and its direct creator.
 * The root is `lead`; a descendant is the slash-separated path of names from
 * the root, or its Session id when it or a creator below the root has no name.
 */
namesOf(agent: Agent): SubagentMemberNames {
  return this.requireManager().namesOf(agent)
}
```

**【读到】** 返回类型 `dsh-subagent/src/types.ts:68-74`：

```ts
/** Model-facing names of one live tree member and its direct creator. */
export interface SubagentMemberNames {
  /** `lead` for the root, the slash-separated path for a named descendant, otherwise the Session id. */
  readonly self: string
  /** The direct creator's name by the same rule; absent for the root. */
  readonly parent?: string
}
```

**`self` 正是我们要的 holder。**

**【读到】** 名字的生成规则在 `dsh-subagent/src/names.ts`：

- `names.ts:13` —— `export const ROOT_AGENT_NAME = 'lead'`
- `names.ts:44-47` —— `agentAddress(path, id)`：`path === ''` 返回 `'lead'`，否则返回 `path ?? id`
- `names.ts:33-36` —— `joinAgentPath(parentPath, name)`：拼接成 `parent/child`
- `names.ts:16` —— `NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u`，单段名字必须小写字母开头、≤32 字符

**【读到】** `namesOf` 会**抛错**的条件（`index.ts:310`）：

> @throws when the caller or its runtime owner is unavailable.

即：`ctx.subagents` 没挂、或这个 agent 不在任何 subagent 树里 ⇒ 抛。

### Q2.3 官方自己就这么用（铁证）

**【读到】** `dsh-agent-team/src/task-board.ts:142-151` —— Team 任务板的 `claim`：

```ts
case 'claim': {
  if (current.ownerId !== undefined && current.ownerId !== caller.id) {
    throw new TeamError(`team task "${current.id}" is owned by another member`, 'TEAM_TASK_ALREADY_CLAIMED')
  }
  if (current.status !== 'pending' || !taskReady(state, current)) {
    throw new TeamError(`team task "${current.id}" is not ready to claim`, 'TEAM_TASK_BLOCKED')
  }
  const name = this.ctx.subagents.namesOf(caller).self          // ← 就是这里
  next = { ...this.withoutOwner(current), status: 'in_progress', ownerId: caller.id,
    ...name === caller.id ? {} : { ownerName: name } }          // ← 拿不到名字就不存
  break
}
```

**三个要点：**

1. 用 `namesOf(caller).self` 取名字
2. **`name === caller.id` 时不存**（说明没拿到可读名字，只有 UUID，那就干脆不存 `ownerName`）
3. `ownerId`（UUID）和 `ownerName`（可读名）**都存**，两个都要

**【读到】** assignee 解析（`task-board.ts:231-238`）用的是另一条路——`listDescendants` 找 `.path`：

```ts
private async resolveAssignee(root: Agent, target: SessionId, signal?: AbortSignal): Promise<{ ownerId: SessionId; ownerName?: string }> {
  if (target === root.id) return { ownerId: target, ownerName: this.ctx.subagents.namesOf(root).self }
  const descendants = await this.ctx.subagents.listDescendants(root.id, signal)
  const member = descendants.find(entry => entry.kind !== 'diagnostic' && entry.mode === 'continuable' && entry.id === target)
  if (member !== undefined) return { ownerId: target, ...member.path === undefined ? {} : { ownerName: member.path } }
  throw new TeamError(`agent "${target}" is not a continuable descendant of this task board's root`, 'TEAM_MEMBER_NOT_FOUND')
}
```

**【读到】** 存储形状（`dsh-agent-team/src/types.ts:64-75`）：

```ts
export interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  /** Immutable agent path captured at assignment; absent on unnamed historical owners. */
  readonly ownerName?: string
  ...
}
```

**「Immutable agent path captured at assignment」** —— 名字是**快照**，之后就固定了，不随 agent 改名而变。

**【读到】** 对模型展示时的降级（`dsh-tool-agent-team/src/index.ts:100-101`）：

```ts
const withOwnerName = ({ ownerId, ownerName, ...task }: TeamTaskView): NamedTaskView =>
  ownerId === undefined ? task : { ...task, owner: ownerName ?? ownerId }
```

**展示时 `ownerName ?? ownerId`** —— 有名字用名字，没有就用 UUID。这是官方的兜底写法，直接抄。

### Q2.4 工具要 inject 什么

**【读到】** `dsh-tool-agent-team/src/index.ts:15`：

```ts
export const inject = ['agentTeams', 'subagents', 'tools', 'systemPrompt']
```

**要 `'subagents'`。** 注意这是**必填 inject**——服务不在，整个插件不激活。

**【推断】** taskboard3 的情况不同：它不该因为 `subagents` 没挂就整个不激活。应该用 `ctx.inject(['subagents'], ...)` 的可选注入，或者在调用时 `ctx.get('subagents')` 判空。这样没有 subagent 环境的 profile 也能用任务板（只是 holder 显示 UUID）。

---

## Q3. 斜杠命令那边

**【读到】** `dsh-commands/src/index.ts:40-58`：

```ts
/** Invocation passed to one registered command handler. */
export interface CommandInvocation {
  readonly commandId: CommandId
  /** Exact agent whose UI received the command. */
  readonly agent: Agent
  readonly rawInput: string
  readonly attachments: readonly (ImageBlock | FileBlock)[]
  readonly signal: AbortSignal
}
```

**有 `agent: Agent`，和工具那边同一个类型。** 所以同样没有名字，同样要 `namesOf(agent).self`。

⚠ 注意类型是 `Agent`（**非可选**），工具那边是 `Agent | undefined`。

**【读到】** 现有 `taskboard2` 的命令实现用 `invocation.agent?.session?.id`（`taskboard2/packages/dsh-command/src/index.ts:20`）——那拿的是会话 UUID。要名字得换 `namesOf`。

---

## Q4. MCP 那边

**【读到】** MCP 协议本身**没有「调用者身份」这个概念**。我读的 DSH MCP 客户端 README（`dsh-mcp-client/README.md`）只讲：

- 服务端配置（`serverName` / `transport` / `command`）
- 工具名形如 `mcp__github__create_issue`（README:12）
- 工具注册到 `ctx.tools`

**没有一节讲「调用者是谁」。**

**【推断】** 两个方向要分开：

**方向一：taskboard 作为 MCP 客户端去调别人的工具** —— 不相关，我们不关心。

**方向二：taskboard 作为 MCP 服务器（二期），别人家的 agent 来调我们的 tool** —— 这才是 Q4 问的。

MCP 的 `tools/call` 请求体只有 `{ name, arguments }`。**没有调用者身份字段。** 所以：

- **holder 必须自报** —— 在 tool 的 parameters 里加一个 `holder` 参数，让调用方填
- 或者用 MCP 连接的**服务端配置名**（比如 `mcpServers.taskboard-claude` 这个配置项的名字）当 holder

**【推断】** 推荐自报 + 前缀标记：

```
holder = args.holder ?? 'mcp:unknown'
```

文档里写清「MCP 调用方必须自报身份，例如 `mcp:claude-desktop`」。

⚠ **安全提醒（推断）**：MCP 的 holder 是**自称**的，不可信。不能拿它做权限判定，只能做展示和流程记录。真正的权限判定在 MCP 连接层面（谁能连上这个 server）。

---

## 最小代码片段

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const inject = ['tools', 'subagents']

/**
 * 取本次调用的 holder 名字。
 *
 * 优先 agent 路径名（`lead` / `reviewer/checker`）—— DSH 自己的 Agent Teams
 * 也是这么取的（dsh-agent-team/src/task-board.ts:149）。
 * 拿不到就回落 Session id：界面上是 UUID，但至少不崩。
 */
function holderOf(ctx: Context, agent: Agent | undefined): string {
  if (agent === undefined) return 'unknown'
  try {
    return ctx.subagents.namesOf(agent).self
  } catch {
    // 不在 subagent 树里，或 subagents 服务未就绪：回落会话 id。
    return agent.id
  }
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'taskboard_claim',
    description: '领取一张工作卡。holder 由运行时身份自动填写。',
    parameters: {
      workspace: { type: 'string', description: '空间 id。省略 = 本会话默认空间。' },
      card_id: { type: 'string', required: true, description: '卡编号。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['ok', 'holder'], properties: {
        ok: { type: 'boolean', required: true },
        holder: { type: 'string', required: true },
        card: { type: 'string' },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const holder = holderOf(ctx, exec.agent)
      const result = await ctx.taskboard3Core.claim({
        workspace: args.workspace,
        cardId: args.card_id,
        holder,                       // ← 人可读名，落库
        holderId: exec.agent?.id,     // ← UUID，一起存
        actor: 'ai',
      })
      return result.ok
        ? { ok: true, holder, card: result.card.id }
        : { ok: false, holder }
    },
  }))
}
```

**为什么 `holder` 和 `holderId` 都存**：照抄 Agent Teams 的 `ownerId` + `ownerName` 双字段（`dsh-agent-team/src/types.ts:70-72`）。UUID 用于程序判定（谁能释放），名字用于界面显示。

---

## 落地建议

| 场景 | holder 来源 | 可靠性 |
|---|---|---|
| dsh AI 工具 | `ctx.subagents.namesOf(agent).self` | ✅ 官方 API |
| dsh 斜杠命令 | 同上（`invocation.agent`） | ✅ 官方 API |
| dsh 无 subagent 环境 | `agent.id`（UUID） | 可用但不友好 |
| UI（人点按钮） | 固定 `'user'` | ✅ |
| MCP（二期） | 调用方自报 `mcp:<名字>` | ⚠ 不可信，仅展示 |

**存两个字段：`holderId`（UUID，程序用）+ `holder`（可读名，界面用）。** 展示时 `holder ?? holderId`，和 DSH 的 `ownerName ?? ownerId` 一致。

---

## 未能确认的事

1. **`namesOf` 在什么具体条件下抛错**：`index.ts:310` 只说「when the caller or its runtime owner is unavailable」。我推断是「`ctx.subagents` 未挂」或「agent 不在任何树里」，但**没读 `manager.ts` 的 `namesOf` 实现确认**。写代码时按「可能抛」处理即可，`try/catch` 兜住。
2. **`exec.agent` 是否可能为 `undefined`**：类型上是 `Agent | undefined`（`contracts.ts:188`），但**什么情况下为 undefined** 我没查到。`dsh-tool-agent-team` 的 `callingAgent()`（`index.ts:83-87`）用 `when` 条件保证工具只在有 agent 时可见，说明它认为这是可能发生的。taskboard3 也要处理这个分支。
3. **`SessionId` 的字符串形态**：`brandString` 生成的 brand，实际值应该是 UUID 文本，但我没读 `dsh-session` 的 `SessionId` 定义确认格式。展示兜底时按「不透明字符串」处理。
4. **`listDescendants` 的 `path` 字段**：`task-board.ts:236` 用了 `member.path`，但那个类型在 `list-children.ts` 里，我没读。如果只取「当前 agent 自己的名字」，用 `namesOf` 就够，不需要它。
