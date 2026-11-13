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

九个，schema **全部静态**（用户裁定：工具 schema 在 prompt 前缀里，一动就击穿 KV cache）。

| 工具 | 说明 |
|---|---|
| `taskboard_workspaces` | 列工作空间 |
| `taskboard_cards` | 列卡 / 搜索 |
| `taskboard_card` | 看单卡详情（元数据 + 章节 + 历史） |
| `taskboard_create` | 建卡 |
| `taskboard_update_content` | 改章节内容 |
| `taskboard_update_note` | 改备注 |
| `taskboard_transition` | `to` 为空 ⇒ 查可转移目标；有值 ⇒ 执行 |
| `taskboard_claim` | 领取工作卡 |
| `taskboard_release` | 释放领取 |
| `taskboard_registry` | 看模板 / action 注册内容 |

**校验在 core，不在工具**（用户裁定：「就在 core 里面验证就好了。因为用户从 ui 里面创建卡，也是走数据给 core 的。」）。

工具只做三件事：映射参数 → 调 core → 把 `Failure` 翻译成人话。

三个 schema 上的硬约束（各自对应一条裁定）：

**① `content` 是开放对象**

```jsonc
"content": { "type": "object", "additionalProperties": true }
```

不按模板展开 —— 展开会随模板变而变，击穿缓存。模型通过
`taskboard_registry({ id: '模板ref' })` 查章节清单。

**② `taskboard_transition` 的 `to` 是 `string`，不是 `enum`**

状态表若扩了，`enum` 会让 schema 变、缓存全废。合法性在 `execute` 里判
（`resolveStateId` 认协议全名与中文名两种写法）。

**③ `taskboard_update_content` 在工具里做合并**

`core.update()` 的 `content` 是**整体替换**，而本工具的语义是「只改这几章」。
⇒ 工具先读出既有章节、与传入的合并，再整体提交。**这一步必须在工具里**——
core 不该知道「增量 vs 全量」这种调用方语义。

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
