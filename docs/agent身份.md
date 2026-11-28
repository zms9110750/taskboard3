# dsh 里的 agent 身份（holder 用）—— 2026-11-28 现状

> **本文按代码事实重写**（2026-11-28，基线 `47e6339`）。旧版是调研 `task-12` 的
> 结论稿（「holder 用 `ctx.subagents.namesOf(agent).self`，兜底 `exec.agent.id`」），
> 那条结论**仍然成立**，但当时的「落地建议」（存 `holderId`、MCP 自报、
> 必填 `inject ['subagents']`）与现状不同。
>
> **宿主事实的来源**：DSH `0.2.2-rc.2` 的 `app.asar` 内源码
> （`B:\DeepSeek Harness\0.2.2-rc2\resources\app.asar` 里 `dsh/node_modules/@deepseek-ai/…`），
> 本次用一次性探针解出后逐条核对（**已核对 2026-11-28**），行号已更新到该版本。
> 仓库侧事实逐文件 `read`。
>
> 约定：**【已核对 2026-11-28】** = 本次读到源码并给了路径/行号；
> **【未查到】** = 本 worktree / 当前安装里找不到依据，不作推断。

---

## 一、结论（现状）

**holder 仍是「agent 的可读名」优先、UUID 兜底**，但取法有**两份实现**，且行为不完全一致：

| 谁在取 | 函数 | 输入 | 空名字时 |
|---|---|---|---|
| `@taskboard/dsh-agent-guard`（guard 判定 + 两个策略工具） | `holderOf(subagents, exec, agent?)` | **每次判定**从 DI cell 解析 `subagents` | 回落 `agent.id` |
| `@taskboard/dsh-tools`（9 个宿主无关工具） | `holderOf(subagents, exec)` | apply 时的 `subagents` **快照** | **返回 `''`** |
| `@taskboard/tools`（宿主无关工具层） | `holderOf(ctx: TaskboardToolContext)` | 宿主注入的 `ctx.holder` 字符串 | `undefined`（空串当没有） |

这三条链路最终都落到 core 的 `CardHolder.holder`（**只存一个字符串**，没有 `holderId`）：
`packages/core/src/card.ts:159-165`。

⚠ **已知静默错误风险**：guard 版「空名字 ⇒ 回落 UUID」，`dsh-tools` 版「空名字 ⇒ 返回空串」。
claim 由 `dsh-tools` 写、guard 读 ⇒ 空 self 的 agent 会出现「领了卡但权限不生效」。
两处 TODO 与一条测试专门钉住这个分歧（见第五节）。

---

## 二、仓库侧现状（三个取法逐条）

### 2.1 guard：`holderOf(subagents, exec, agent?)` + DI cell

`packages/dsh-agent-guard/src/permission.ts:123-140`：

```ts
export function holderOf(
	subagents: unknown,
	exec: unknown,
	agent: AgentLike | undefined = agentOf(exec),
): string {
	if (agent === undefined) return 'unknown';
	const id = typeof agent.id === 'string' && agent.id !== '' ? agent.id : 'unknown';
	if (!hasSubagents(subagents)) return id;                  // 形状不对 / 缺席 ⇒ UUID
	try {
		const name = subagents.namesOf(agent).self;
		if (typeof name === 'string' && name !== '') return name;   // 空串也回落
	} catch {
		/* 不在树里 ⇒ 回落 UUID。不编名字。 */
	}
	return id;
}
```

**`subagents` 从哪来：DI cell，不是快照**（用户 `2026-11-27` 裁定）：

| 环节 | 事实 | 路径 |
|---|---|---|
| 建立 cell | `ctx.inject?.(['subagents'], (scope) => { subagentsCell = scope.subagents; return () => { subagentsCell = undefined; }; })` | `packages/dsh-agent-guard/src/index.ts:190-197` |
| 传给 guard | `createPermissionGuard({ taskboard, kv, resolveSubagents })` | `index.ts:252` |
| 判定时读 | `holderOf(deps.resolveSubagents?.() ?? subagents, exec, agent)` —— **每次工具调用读当前值** | `permission.ts:241` |
| 依赖形状 | `GuardDeps.resolveSubagents?: () => unknown`（旧快照 `subagents?` 保留给测试直传） | `permission.ts:181-198` |

⇒ 服务晚激活 / 卸载中都能被看到（旧实现「服务晚到就永久拿不到，holder 永远回落 UUID」已修）。
测试：`packages/dsh-agent-guard/test/guard.test.ts:498-519`（cell 空 → 出现 → 清空，三次判定都走当前值）。

**两个策略工具的 subagents 仍是快照**（不是每次调用解析）：
`packages/dsh-agent-guard/src/tools.ts:61-64`（`resolveSubagents?.() ?? deps.subagents` 在**建工具时**取一次），
文件头注释说明了这个不对称（adapter 的 `subagents` 是值不是 resolver）。记 TODO（第五节）。

### 2.2 `@taskboard/tools`：holder 由宿主注入

`packages/tools/src/context.ts:170-173`：

```ts
export function holderOf(ctx: TaskboardToolContext): string | undefined {
	const value = ctx.holder;
	return typeof value === 'string' && value !== '' ? value : undefined;
}
```

- `TaskboardToolContext.holder?: string`（`packages/tools/src/types.ts:59-61`）。
- **`undefined` 不是错误**：MCP 等没有 agent 身份的宿主就是没有（文件头原话）。
- 需要身份的动作自己判：`claim` / `release` 拿不到 holder ⇒ 返回失败并说明「宿主接线问题」
  （`packages/tools/src/tools/transition.ts:135-141`、`:154-159`）。

### 2.3 `@taskboard/dsh-tools`：`holderOf(subagents, exec)`（apply 时快照）

`packages/dsh-tools/src/holder.ts:62-76`：

```ts
export function holderOf(subagents: unknown, exec: unknown): string {
	const agent = agentOf(exec);
	if (agent === undefined) return 'unknown';
	if (!hasNamesOf(subagents)) return idOf(agent);
	try {
		return subagents.namesOf(agent).self;      // ← 空串原样返回
	} catch {
		return idOf(agent);
	}
}
```

- 取 `subagents`：`packages/dsh-tools/src/index.ts:109-110`
  （`ctx.get('subagents')`，否则 `ctx.subagents`）——**只在 apply 时读一次**。
  同一文件 `:98-99` 有 TODO：Cordis 服务可能晚于本插件出现 ⇒ 晚到就永久拿不到。
- 用它的地方：`packages/dsh-tools/src/tools.ts:272-278` 的 `contextOf()`，
  `holder: holderOf(deps.subagents, exec)`。
- 测试：`packages/dsh-tools/test/holder.test.ts:45-93`（名字优先 / 抛错回落 / 缺席 `unknown` /
  **没有「空串回落」这一条**）。

### 2.4 三份实现的分歧（必须写清，否则下一个人会踩）

| 场景 | guard 版 | dsh-tools 版 | tools 版 |
|---|---|---|---|
| `exec.agent` 缺席 | `'unknown'` | `'unknown'` | `undefined`（那是另一个入参） |
| 没有 `subagents` 服务 | `agent.id`（空 id ⇒ `'unknown'`） | `agent.id`（空 id ⇒ `'unknown'`） | — |
| `namesOf` 抛错 | `agent.id` | `agent.id` | — |
| `namesOf` 返回 `''` | **`agent.id`** | **`''`** | — |

- 分歧由两条测试**如实钉住**：`guard.test.ts:181-193`（注释写明「与 dsh-tools 版有分歧，
  断言不改」）、`dsh-tools/test/holder.test.ts:45-93`（没有空串用例）。
- 两处 TODO 指向同一件事：`dsh-agent-guard/src/permission.ts:119-122`、
  `:81-83`（「PermissionSubagentsLike 与 holder.ts 故意不合并」的理由已被推翻，
  建议删本包私有实现、直接复用 `@taskboard/dsh-tools` 的 `holderOf`）。
  **需要用户先定语义**（空名字到底算谁），本文不擅自统一。

---

## 三、宿主事实（逐条复核，【已核对 2026-11-28】）

### 3.1 `exec` 有什么（`ToolRunContext`）

| 事实 | 出处（asar 内路径） |
|---|---|
| `execute(args: unknown, exec: ToolRunContext): Promise<unknown>` | `dsh-tools/src/contracts.ts:40` |
| `ToolRunContext extends ToolExecution`，加 `deferContext(context)` / `concludeTurn()` | `contracts.ts:245`、`:252`、`:261` |
| `ToolExecution extends ToolExecutionInput`，加 `rootCallId`（必填）/ `token` | `contracts.ts:220`、`:222`、`:224` |
| `ToolExecutionInput` 字段：`callId` / `rootCallId?` / `name` / `schema?` / `arguments` / **`agent?`** / `toolSet?` / `parent?` / `signal` | `contracts.ts:175-203`（`agent` 在 `:188`，注释：「The agent on whose behalf the call runs (set by the agent loop)」） |
| **没有 `log` 字段** | 全文 `contracts.ts` 搜 `log` 只命中注释里的 "session-log"（`:91`），无字段 |
| `ToolGuard` 的签名 | `contracts.ts:410`：`type ToolGuard = (execution: Readonly<ToolExecution>) => string \| ToolGuardDenial \| undefined`；`ToolGuardDenial` 在 `:413` |

⇒ guard 是**同步**的，且拿到的是 `ToolExecution`（不是 `ToolRunContext`）——它只有 `agent?`、
没有 `deferContext` / `concludeTurn`。任务板 guard 只用 `exec.agent` 与 `exec.name`。

### 3.2 `Agent` 没有名字

- `dsh-agent/src/types.ts:16-19`：`interface Agent { readonly id: SessionId }` —— **只有 id**。
- 运行期增补（`dsh-agent/src/runtime-types.ts:190-273` 的 `declare module './types.ts'`）加了
  `options` / `session` / `model` / `inbox` / `status` / `ctx` 与
  `cancel` / `whenIdle` / `runMaintenance` / `send` / `followup` / `steer` / `inject` ——
  **仍然没有 `name`**（逐行读到 `:272`）。
- ⇒ 名字只能从 `ctx.subagents` 拿。

### 3.3 名字在 `ctx.subagents.namesOf(agent)`

| 事实 | 出处 |
|---|---|
| `namesOf(agent: Agent): SubagentMemberNames`，`@throws when the caller or its runtime owner is unavailable` | `dsh-subagent/src/index.ts:304-314`（`namesOf` 在 `:312`，`@throws` 在 `:310`） |
| 返回 `{ self: string; parent?: string }`；`self` = 根的 `lead` / 斜杠路径 / 该成员的 Session id | `dsh-subagent/src/types.ts:69-74`（`self` `:71`，`parent` `:73`） |
| 根名常量 `ROOT_AGENT_NAME = 'lead'` | `dsh-subagent/src/names.ts:13` |
| 单段名字规则 `NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u` | `names.ts:16` |
| `joinAgentPath(parentPath, name)`：`parent/child` | `names.ts:33-36` |
| `agentAddress(path, id)`：`path === ''` ⇒ `'lead'`，否则 `path ?? id`（实现是 `return path`? 见下注） | `names.ts:44-47` |

⚠ `agentAddress` 的实测签名/行为：`export function agentAddress(path: string | undefined, id: string): string`，
`path === ''` 返回 `ROOT_AGENT_NAME`，否则返回 `path ?? id`（`names.ts:44-46`，三条分支：
空串 ⇒ `lead`；有 path ⇒ path；无 path ⇒ id）。旧文档对这三条的描述与源码一致，本次逐字复核通过。

### 3.4 官方自己就这么用（行为依据）

- `dsh-agent-team/src/task-board.ts:149-151`（claim）：

  ```ts
  const name = this.ctx.subagents.namesOf(caller).self
  next = { ...this.withoutOwner(current), status: 'in_progress', ownerId: caller.id,
    ...name === caller.id ? {} : { ownerName: name } }
  ```

  ⇒ **拿不到可读名（name === id）就不存 `ownerName`**；`ownerId`（UUID）与 `ownerName`（可读名）并存。

- 指派时用 `listDescendants` 的 `member.path`（`:232-236`）。
- 存储形状把 `ownerName` 标成 **"Immutable agent path captured at assignment"**
  （`dsh-agent-team/src/types.ts:70-72`，另一份同形在 `:86-88`）——名字是**快照**，之后不随改名变。
- 展示降级：`ownerName ?? ownerId`（`dsh-tool-agent-team/src/index.ts:100-101`）。
- `dsh-tool-agent-team` 的 `inject` 含 `'subagents'` 且**必填**
  （`dsh-tool-agent-team/src/index.ts:15`）——它没有 subagent 环境就不激活。

### 3.5 斜杠命令

- `CommandInvocation` 有 `readonly agent: Agent`（**非可选**），与工具那边同一个 `Agent` 类型：
  `dsh-commands/src/index.ts:41-47`（`agent` 在 `:45`）。
- ⇒ 命令侧取名字同样要 `namesOf(agent).self`；不同点是**一定有 agent**（不用处理 `undefined`）。

### 3.6 MCP

- MCP 协议本身没有「调用者身份」字段（旧调研的结论；本次**未复核** MCP 协议源码，
  不在本 worktree 的依赖里）。**【未查到】本次对 MCP 协议的核对。**
- 现状：`packages/tools` 里**没有任何 `holder` 参数**（工具参数表里搜不到），
  MCP 场景就是 `ctx.holder === undefined` ⇒ `holderOf(ctx)` 返回 `undefined` ⇒
  claim / release 直接失败并说明「宿主接线问题」。
- 旧文档建议的「MCP 调用方自报 `mcp:<名字>`」**没有实现**（记 TODO，第五节）。

---

## 四、与旧文档的差异 / 修正（本次重写改了什么）

| # | 旧文档 | 现状 / 本次处理 |
|---|---|---|
| 1 | 行号：`contracts.ts:245/220/188/410`、`agent/src/types.ts:16-19`、`namesOf` `index.ts:304-314`、`SubagentMemberNames` `types.ts:68-74`、`names.ts:13/16/44-47`、`task-board.ts:142-151`、`types.ts:64-75`、`commands/src/index.ts:40-58`、`tool-agent-team/index.ts:15`、`:100-101` | 全部**复核过**，结论对；行号小幅漂移已按 0.2.2-rc.2 更新（`namesOf` 在 `:312`、`SubagentMemberNames` 在 `:69-74`、claim 在 `:149-151`、`resolveAssignee` 在 `:232-236`） |
| 2 | 「`agentAddress`：`path === ''` 返回 `'lead'`，否则 `path ?? id`」 | 与源码一致（`names.ts:44-46`）；本次只是逐字复核，未改结论 |
| 3 | 「`namesOf` 抛错 ⇒ 回落 Session id」 | 对；**补充**：它也可能返回**空串**（`dsh-tools` 版会原样存空串），这是两版分歧的根因 |
| 4 | 落地建议「`inject = ['tools','subagents']` 必填」/「或可选 `ctx.inject` / `ctx.get`」 | guard 选了 **`ctx.inject` 的 DI cell**（2026-11-27 裁定，每次判定读当前值）；`dsh-tools` 仍是 **apply 时 `ctx.get` 快照**（晚到拿不到，有 TODO） |
| 5 | 落地建议「`holder` 和 `holderId` 都存」 | **未实现**：core 的 `CardHolder` 只有 `holder` + `at`（`card.ts:159-165`），没有 `holderId` |
| 6 | 「MCP 调用方自报 `mcp:<名字>`」 | **未实现**（工具参数里没有 holder）；MCP 下 claim / release 会明确失败 |
| 7 | 文末「最小代码片段」（v1 `taskboard_claim`、`core.claim`、`holderId`） | **已过时**，不要照抄：v2 领取走 `taskboard_transition` 的 `claim` 动作，且没有 `holderId` |
| 8 | 「未能确认的事」4 条（`namesOf` 抛错条件 / `exec.agent` 何时 undefined / `SessionId` 形态 / `listDescendants.path`） | 前两条仍未有定论（本次也没查 manager 实现）；后两条本次未展开 —— 保持「未查到/推断」标注，不包装成事实 |

---

## 五、已知漂移 / TODO（只记，不扩面）

1. **两版 `holderOf` 在「空 self」上行为不同** ⇒ 静默「领了卡但权限不生效」。
   证据：`guard.test.ts:181-193`（断言钉住分歧）、`permission.ts:119-122`（TODO）、
   `dsh-tools/test/holder.test.ts`（无空串用例）。**需用户先定语义**再合并成一份。
2. **guard 只看第一个工作空间**：`heldWorkCardsOf()` 只查 `listWorkspaces(false)[0].id`
   （`permission.ts:54-61`、`:161-176`，注释写明「已知限制，不是 bug」）——
   用户在第二个空间领的卡，guard 看不见。
3. **策略工具的 subagents 是建工具时快照**，与 guard 的「每次判定读 cell」不对称
   （`dsh-agent-guard/src/tools.ts:61-64`）。
4. **`dsh-tools` 的 subagents 在 apply 时取一次**（`index.ts:98-110`），晚激活的服务永久错过。
5. **`holderId` 未存**：core 无法用 UUID 做程序判定（旧文档的双字段设计只剩一半）。
6. **MCP 自报身份未实现**。
7. **`PermissionSubagentsLike` 与 `SubagentsLike` 两份接口**：`permission.ts:81-86` 的 TODO
   已推翻「故意不合并」的理由，但合并需跨包确认依赖方向。

---

## 六、旧文档原话 / 表述锚（保留）

旧文档（基线 `47e6339` 的 `docs/agent身份.md`）没有 `用户 \`日期\`：` 形式的原话锚；
它记的是一条**无日期的用户裁决**（转引自 `packages/tools/src/context.ts:162-166`）：

> 用户裁决：持有者来自宿主注入的 `ctx.holder`（DSH 里是 agent id）。
> 没有注入 ⇒ 返回 `undefined`（不是错误：MCP 等没有 agent 身份）。

以及旧文档自己的立论（保留供追溯，不作为规范）：

> **holder 用 `ctx.subagents.namesOf(agent).self`，兜底用 `exec.agent.id`。**
>
> - 正常情况拿到 `lead` / `reviewer` / `reviewer/checker`
> - `ctx.subagents` 没挂载（或 agent 不在 subagent 树里）时，`namesOf` 抛错 ⇒ 回落 Session id（一个 UUID）

这两条与现状一致（差异只在「空串」这个第三种情况，见第二节）。
