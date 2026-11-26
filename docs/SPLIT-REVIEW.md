# taskboard3 分包评审（#6）

> 基线：tag [`split-review-2026-11-27`](https://github.com/zms9110750/taskboard3/tree/split-review-2026-11-27)
>
> 来源：Issue [#6](https://github.com/zms9110750/taskboard3/issues/6)（父 issue [#4](https://github.com/zms9110750/taskboard3/issues/4)）
>
> 本文是评审结论，不是已实施的改动。标「接受 / 有条件 / 拒绝」的是对 #6 五项提议的判断。

## 1. 插件现有功能

### 1.1 卡与状态

- 4 类卡：`goal` / `work` / `design` / `record`
- 9 状态、4 组（草稿 / 进行 / 搁置 / 完成）
- 按钮矩阵：采纳、确认、否决、否认、领取、搁置、成功、失败、取消、重开
- 自动转移：父卡由子卡推导，只能落在 4 个非终结态
- 6 种关系：派生 / 依赖 / 取代 / 约束 / 相关 / 参考
- 未读标记、搜索、父子卡、组与折叠

### 1.2 模板

- YAML 模板（内置 + 自定义）
- kind / domain / action / section schema
- 空模板：章节 key 完全自定义
- 模板授权页：按 domain 分组的模板权限

### 1.3 工具权限

- 两轴：UI 权限（core `ToolPolicyStore`）与 agent 档位（`dsh-agent-guard`）
- 有效工具集、工具清单、`/api/tools`、`/api/tool-policy`
- 工具注册（`dsh-tools`）、9 个 AI 工具（`tools`）

### 1.4 宿主

- HTTP API：卡、空间、模板、工具、未读、状态建议
- SSE：卡变更事件
- 命令：DSH 命令注册
- 服务：`taskboard3Store` / `taskboard3Core` / `taskboard3Bus` / `taskboard3DefaultWorkspaceId` / `taskboard3AgentGuard`

### 1.5 UI

- 工作区（列表 / 看板 / 科技树）
- 卡详情抽屉、关系块、章节渲染
- 工具权限页（编组 / 授权）
- 模板选择与授权
- 状态菜单、未读、通知与错误提示

## 2. 依赖检查

### 2.1 现状依赖

| 包 | 运行时依赖 | 仅类型 | DI | Cordis |
|---|---|---|---|---|
| protocol | 无 | 无 | 无 | 无 |
| core | protocol、yaml、zod | — | 注入 store / bus / now | 无 |
| tools | core、protocol | — | 无 | 无 |
| io | node:fs / path / sqlite | core | 无 | 无 |
| store | io | core | provide + effect | 是 |
| dsh-core | core | core | inject store，provide 3 个 | 是 |
| dsh-tools | tools、core、protocol | — | inject 3 个 | 是 |
| dsh-agent-guard | core、protocol、tools、dsh-tools | — | inject 3 个 | 是 |
| dsh | core、protocol、dsh-agent-guard | dsh-core、dsh-tools（未用） | inject 6 个 | 是 |
| dsh-client | protocol、react、react-dom、marked | 宿主 slots | inject slots / sidebarRightTabs | 是（客户端） |
| bundle | 无 import | 无 | 无 | patch 装配 |

### 2.2 耦合问题

1. `Taskboard` 是 45 方法宽接口，dsh 调 28 个、tools 调 19 个。
2. 服务名是字符串，`store` 与 `dsh-core` 各写一份。
3. 判定重复：`holderOf`、`judgeToolCall` / `effectiveToolsOf`、adopt 判据。
4. 类型手抄：dsh-client 的 DTO、tools 的镜像接口、agent-guard 的 `*Like`。
5. 传输与领域混在 `dsh/http.ts`（660 行函数）。

## 3. 按能力 / 层级归类

| 能力 | 现状所在 | 层级 | 耦合 |
|---|---|---|---|
| 状态 / 关系 / 错误码 / 按钮矩阵 | protocol | 契约 | 低 |
| 卡、模板、搜索、转移 | core | 领域 | 高（内部互相依赖） |
| 模板 schema 校验 | core | 领域 | 与模板类型强耦合 |
| 存储端口 | core | 契约（端口） | 低 |
| SQLite 实现 | io | 基础设施 | 低 |
| 存储装配 | store | 适配 | 低 |
| 实例装配 / 服务注册 | dsh-core | 适配 | 中 |
| AI 工具定义 | tools | 领域接口 | 中 |
| 工具注册（DSH） | dsh-tools | 适配 | 低 |
| 工具权限守卫 | dsh-agent-guard | 适配 + 领域 | 高 |
| HTTP / SSE / 命令 | dsh | 传输 | 中 |
| 浏览器 UI | dsh-client | 表现 | 高（宿主 + 领域视图） |
| 装配壳 | bundle | 装配 | 无 |

分层结论：

```
契约（protocol / 端口）
   ↑
领域（core / tools）
   ↑
适配（io / store / dsh-core / dsh-tools / dsh-agent-guard）
   ↑
传输（dsh）
   ↑
表现（dsh-client）
   ↑
装配（bundle）
```

## 4. 重新评判现有分包

| 包 | 判断 | 理由 |
|---|---|---|
| protocol | 保留 | 零依赖，浏览器安全，词汇唯一来源 |
| core | 保留但拆内部职责 | 领域本体；装配（builtin 加载）可外移 |
| tools | 保留 | MCP / DSH 通用，不能依赖宿主 |
| io | **并入 store** | 只有 store 一个消费者，拆开只增加构建节点 |
| store | **接收 io** | 合并后仍是薄插件 + SQLite |
| dsh-core | 保留 | 独立插件行；关 HTTP 不应关 core |
| dsh-tools | 保留 | 独立开关；不能并进 tools（会破坏宿主无关性） |
| dsh-agent-guard | 保留 | 功能独立；HTTP handler 应外移 |
| dsh | 保留 | 传输层；与实例装配分离 |
| dsh-client | **拆为两包** | 基础卡视图 vs 权限管理 UI |
| bundle | 保留 | 装配壳，无运行时代码 |

## 5. 对 #6 五项提议的评审

### 5.1 契约包

**结论：接受，有条件。**

范围：

- 接口：`TaskboardPort`、`CardStore`、`Bus`、`ToolPolicyPort`
- DTO：`Card`、`Workspace`、`CardSection`、Envelope
- 硬依赖常量：4 个组名、内置 kind、模板名
- 服务名常量

条件：

1. 只依赖 `protocol`，不依赖 core；
2. core 的公开类型搬过去并 re-export；
3. 端口窄化，不是 45 方法门面改名；
4. 浏览器安全（无 Node / zod / yaml）；
5. 模板名常量生成或由 core 断言；
6. 测试禁止消费方再从 core 手抄类型。

风险：God package、第二真值、成环、无强制。

### 5.2 io 与 store 合并

**结论：接受。**

- `store` = 插件入口 + SQLite 实现，仍只 `provide('taskboard3Store')`。
- 存储位置由 dsh 预设里的插件配置提供：`store` 行 `config.dataDir`，不再从环境变量或 `dshHomePath` 偷偷推导。
- 对外行为不变；包数 11 → 10。

代价：失去「io 可被别的宿主复用」的可能性；目前无此复用。

### 5.3 校验包

**结论：有条件接受，不建议现在拆。**

- 模板 / action schema 与 `Card`、`TemplateDef`、zod 强耦合；拆出去会让 core 依赖校验包，校验包又依赖契约包。
- 如果目标只是「让第三方 action 自带 schema」，保留 core 的注册表即可，不必新包。
- 若要拆，边界应是：`模板定义 + schema + 校验器` 整体搬走，core 只留卡与转移；代价是 core 与校验包互相调用，需要先定端口。

建议：先做 DI 化的 `ValidationPort`，确认有第二个实现或第三方消费者，再拆包。

### 5.4 消息 / 通知 / 广播包

**结论：拒绝「一个包」，按侧拆。**

这三件事不在同一侧：

| 关注点 | 应在 | 理由 |
|---|---|---|
| 进程内 bus | core（临时脚手架） | 领域发通知，宿主无关 |
| SSE / HTTP 推送 | dsh | 依赖 webServer、connection |
| UI 通知 / toast | dsh-client | 浏览器状态 |
| 消息类型 | contracts / protocol | 双方共享的契约 |

把它们塞进一个包会同时依赖 Node 与浏览器，破坏现有分层。可做的是：

- 消息类型进 contracts；
- bus 留 core；
- SSE 留 dsh；
- 客户端通知留 dsh-client。

### 5.5 UI 拆包

**结论：接受，但启用条件要落在插件声明上。**

拆法：

- `dsh-client`：基础卡查看、列表、抽屉、状态菜单；
- `dsh-client-permissions`：工具权限页、模板授权、权限弹层。

共享部分（样式、API client、store）需要第三包或子路径导出。

启用条件：

- 不能靠浏览器里 `ctx.get('taskboard3AgentGuard')` 判断（guard 是宿主侧）；
- 应声明客户端插件依赖（`dsh.client.inject`）或由宿主暴露能力标志；
- 未启用权限插件时，权限入口不注册，而不是注册后 404。

## 6. 目标分包

```
protocol
contracts            ← 新增：接口 + DTO + 常量
core                 ← 领域；端口实现
validation           ← 可选，先不建
tools
store                ← io 并入
dsh-core
dsh-tools
dsh-agent-guard
dsh
dsh-client           ← 基础 UI
dsh-client-permissions ← 权限 UI（依赖 guard 启用）
bundle
```

包数：11 → 10（io 并入 store）→ 11（contracts）→ 12（UI 拆分）。

## 7. 实施顺序建议

1. 服务名常量 + Context 类型扩展（低风险）。
2. io 并入 store（结构改动，行为不变）。
3. contracts 包最小集：DTO + 服务名 + `CardStore` 端口。
4. 窄 `TaskboardPort`，core 显式实现。
5. dsh-client 拆权限 UI，加启用条件。
6. 模板名常量生成 / 断言。
7. 校验包：等第二个消费者出现再拆。

## 8. 不在本次范围

- 实际代码重构（本 issue 只评审）。
- 模板 schema 迁移。
- UI 拆包实现。

## 9. 未决

- contracts 与 protocol 的边界（组名 / kind 名放哪）。
- 校验包是否真的需要。
- UI 拆包后共享代码放哪。
- 权限 UI 的启用条件用 manifest 依赖还是宿主能力标志。
