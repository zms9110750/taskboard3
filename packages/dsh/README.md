# @taskboard/dsh

任务板的 DSH 插件：**HTTP 路由 + AI 工具 + 斜杠命令**。

业务规则全部在 [`@taskboard/core`](../core)；本包只做「翻译」与「接线」。

## 依赖

本插件在 `inject` 里声明四个 DSH 服务：

```ts
export const inject = ['webServer', 'connection', 'tools', 'commands'];
```

服务的含义：

| 服务 | 用途 |
|---|---|
| `webServer` | 注册 `/taskboard3` 前缀路由 —— 浏览器读写数据的通道 |
| `connection` | 请求鉴权（`requestRejection(req)`，返回 401 / 403 / 放行） |
| `tools` | 注册 AI 工具 |
| `commands` | 注册斜杠命令 |

**这四个都是 DSH 自带的**，正常 profile 里都有。缺任何一个 ⇒ 本插件不激活（Cordis 的依赖语义），用户会看到任务板没出现。

### 唯一可替换的依赖：存储

`@taskboard/core` 的存储是可替换实现（用户裁定：「别人可能想换实现的才拆」）：

| 依赖 | 服务名 | 缺失时 |
|---|---|---|
| 存储 | `taskboard3Store` | **插件不激活**（硬依赖，无兜底） |

⇒ 想换存储：写一个插件 `provide('taskboard3Store', ...)`，关掉 `@taskboard/store` 那一行即可。

**搜索不可替换。** 用户裁定：

> 是把搜索并入 core 强依赖。ui 和 tool 都强依赖搜索，替换了搜索，那接口也没法做啊。
> 他只能说替换底层实现，那没有意义。要么他增加 api，那又调用不了。所以没意义。就强耦合吧。

⇒ `createSearch()` 在 core 内部固定调用，`TaskboardOptions` 不接受 `search`。

## HTTP 路由

挂在 `/taskboard3` 前缀下。

> ⚠ 浏览器侧 `fetch` 要用**不带前导 `/`** 的相对路径（`taskboard3/api/state`），
> 因为页面可能挂在子路径下，绝对路径会跳出挂载点。
> 依据：`dsh-host-open-in-app/src/shared.ts:10-26`。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/state?workspace=<id>` | 一次拿：空间列表 + 该空间全部卡 + 模板清单 |
| `GET` | `/api/workspaces` | 空间列表 |
| `POST` | `/api/workspaces` | 建空间 `{ name }` |
| `GET` | `/api/templates[?ref=<ref>]` | 模板清单 / 单个模板的章节 |
| `GET` | `/api/search` | 筛选：`workspace` / `title` / `status` / `kind` / `domain` / `templateRef` |
| `POST` | `/api/cards` | 建卡 `{ workspaceId?, templateRef, title, content? }` |
| `GET` | `/api/cards/:id` | 单卡（含墓碑） |
| `PATCH` | `/api/cards/:id` | 改卡 `{ title?, note?, content? }` |
| `DELETE` | `/api/cards/:id` | 删除（只有草稿能删） |
| `POST` | `/api/cards/:id/action` | 状态转移 `{ to }` |

响应信封：

```jsonc
{ "ok": true, "data": { ... } }
{ "ok": false, "code": "CARD_NOT_FOUND", "message": "…", "issues": [...] }
```

### 鉴权

每个请求先过 `ctx.connection.requestRejection(req)`：

- `401` → 浏览器 cookie 缺失或无效
- `403` → Host / Origin 不可信（防 DNS rebinding）
- `undefined` → 放行

**鉴权先于路径判断** —— 未知路径的未认证请求也答 401，不泄露路由表。

### 状态转移

`POST /api/cards/:id/action` 的判定**不在这里实现**，走 `@taskboard/protocol` 的
`judgeTransition({ kind, from, to, trigger: 'button' })`：

- 人点按钮 ⇒ `trigger: 'button'`，服务端写死 —— 前端不传这个参数
- 判定表里没有的 `(kind, from, to)` ⇒ `409 TRANSITION_REJECTED`

## AI 工具

**10 个，定义全部在 `@taskboard/tools`（MCP / DSH 通用）**，本包只做薄适配层
（`src/tools.ts`：schema 转换 + ctx 注入 + `hosts` 过滤）。schema **全部静态**
（用户裁定：工具 schema 在 prompt 前缀里，一动就击穿 KV cache）。

| 工具 | 说明 |
|---|---|
| `taskboard_workspaces` | 列工作空间（含激活空间） |
| `taskboard_cards` | 列卡 / 搜索（标题 + 状态/领域/分类/模板 + 两个未读 + 分页） |
| `taskboard_card` | 看单卡（元数据 + 章节 + 历史；查看即 AI 已读） |
| `taskboard_raw_card` | 看模板内原始 JSON |
| `taskboard_definitions` | 看领域 / 状态 / 模板 / 分类定义 |
| `taskboard_create` | 建卡（title + 模板 + 关系 + action JSON） |
| `taskboard_update` | JSON 路径替换（返回合并 JSON + 状态/下一步） |
| `taskboard_update_note` | 改备注 / 改标题（标题仅草稿期） |
| `taskboard_transition` | 采纳 / 领取 / 释放 / 转移（`to` 为空 ⇒ 查目标与条件） |
| `taskboard_tool_policy` | 仅 DSH：改工具权限（需宿主轴 `manage-edit`） |

⚠ v1 的 16 个工具名（`taskboard_adopt` / `claim` / `release` / `registry` /
`mark_seen` / `update_content` / `tool_policies*`）已删除：采纳/领取/释放合并进
`taskboard_transition`，`registry` → `taskboard_definitions`，
`update_content` → `taskboard_update`，`mark_seen` 变成「看卡即已读」。

### 领取 / 释放的 holder 从哪来

`core.claim(ws, id, actor, holder)` 要一个 **holder 标识**。它的取法（`src/holder.ts`）：

```ts
holderOf(ctx.subagents, exec)   //  → 'lead' / 'reviewer/checker' / agent UUID / 'unknown'
```

依据 DSH 官方 Agent Teams 同款做法（`dsh-agent-team/src/task-board.ts:149-151`）：

```ts
const name = ctx.subagents.namesOf(caller).self;
```

**三条回落，每条对应一个真实场景**：

| 情况 | 回落 | 场景 |
|---|---|---|
| `exec.agent` 缺席 | `'unknown'` | 工具被程序化调用（不经模型） |
| `subagents` 服务不存在 | `agent.id` | 单 agent profile，没装 subagent |
| `namesOf` 抛错 | `agent.id` | agent 不在 subagent 树里（官方实现就抛） |

⚠ **三种回落都不编名字。** 猜名字会让两个不同 agent 撞到同一个 holder，
那比报错坏 —— 判据：宁可炸得响，不要安静地错。

⚠ `subagents` 是**可选**注入（`ctx.subagents` 判空），不是硬依赖：
没有 subagent 环境的 profile 也该能用任务板。

### 界面不能领 / 不能释放（409 CLAIM_REJECTED）

HTTP 请求**没有 `exec.agent`** —— 浏览器不知道「是哪个 agent 在领」。
而 claim 的语义是「指派某个 agent 去做」，持有者必须可信。

⚠ 让前端传 `?holder=` 不可行：那是**自报**，任何页面脚本都能声称自己是任意 agent
⇒「一次一张」这条约束会形同虚设。

⇒ `POST /api/cards/:id/action` 的这两种转移被拒：

| `(from → to)` | 原因码 |
|---|---|
| `任意 → WORKING` | `CLAIM_REQUIRES_AGENT` |
| `WORKING → SUBMITTED` | `RELEASE_REQUIRES_AGENT` |

两条都答 **409**。正确做法是让 AI 调 `taskboard_transition`
（`to=TASK_STATE_WORKING` 领取 / `to=提交` 释放）—— 工具那边从 `exec.agent` 取真实身份。

**状态转移本身不受影响**：采纳、成功、失败、取消、重开仍可从界面点。

**校验在 core，不在工具**（用户裁定：「就在 core 里面验证就好了。因为用户从 ui 里面创建卡，也是走数据给 core 的。」）。

工具只做三件事：映射参数 → 调 core → 把 `Failure` 翻译成人话。

三个 schema 上的硬约束（各自对应一条裁定）：

**① `content` 是开放对象**

```jsonc
"content": { "type": "object", "additionalProperties": true }
```

不按模板展开 —— 展开会随模板变而变，击穿缓存。模型通过
`taskboard_definitions({ name: '模板ref', type: 'template' })` 查章节清单。

**② `taskboard_transition` 的 `to` 是 `string`，不是 `enum`**

状态表若扩了，`enum` 会让 schema 变、缓存全废。合法性在工具层判
（`@taskboard/tools` 的 `resolveStateId` 认协议全名与中文名两种写法）。

**③ `taskboard_update` 是 JSON 路径替换，不是合并**

用户 v2 裁定：给一个 JSON 路径 + 一个 JSON 值，**该路径之后的内容整体被替换**
（JSON Pointer，替换语义）。模型先调 `taskboard_raw_card` 看当前结构，再拼路径；
成功返回合并后的完整 JSON + 当前状态/下一步。这里是**工具层语义**，core 只提供
`replaceContentAt` 的路径写入。

## 斜杠命令

| 命令 | 说明 |
|---|---|
| `/taskboard` | 概览：全部工作空间 + 当前空间，按状态分布 |
| `/task-card <编号>` | 看一张卡的元数据与章节 |
| `/task-create <标题>` | 建一张草稿卡 |

## 默认空间

**本入口的策略**，不是 core 的概念（用户裁定：「整个激活都只对 dsh 会话有效。mcp 是没法提供的。」）：

1. 请求带 `?workspace=` ⇒ 用它
2. 工具 / 命令带 `workspaceId` ⇒ 用它
3. 都没带 ⇒ 取第一个空间；一个都没有就建「默认」

**没有全局默认值** —— 用户明确否掉了「全局默认的垃圾堆」。

## 构建

```bash
pnpm install
npx tsc -b packages/protocol packages/search packages/core packages/dsh
node --test packages/dsh/test/*.test.ts
```

## 一个已知的类型垫片

`src/dsh-tools.d.ts` 是临时的 —— `dsh-tools` 在 npm 上只有 `0.2.1-rc.5`，
而 DSH 安装里是 `0.2.2-rc.2`，两者**类型 API 有差异**。原因与移除条件见该文件头。
