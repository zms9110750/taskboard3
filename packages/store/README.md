# @taskboard/store

任务板存储的**默认实现**，一个 Cordis 插件行。它只做两件事：

1. 用 `@taskboard/io` 的 `createSqliteStore(dataDir)` 造一个 `CardStore`；
2. 把它注册成 `taskboard3Store` 服务，并在卸载时关闭。

上层（`@taskboard/core` 及其消费者）只认 `CardStore` 接口。**换实现 = 关掉本行 +
另装一行提供同名服务**，上面几层一行都不用改。

## 谁在用这个服务

`@taskboard/dsh` 与 `@taskboard/dsh-agent-guard` 的 `inject` 里有 `taskboard3Store`。
关掉本行 ⇒ 依赖不满足 ⇒ 那些行不激活（不报错）。这是设计好的失败方式。

## `CardStore` 实现者契约

接口定义在 `packages/core/src/ports.ts`。实现者必须满足：

| 方法 | 契约 |
|---|---|
| `loadAll(workspaceId)` | **同步**返回该空间的全部卡，**含草稿、含 `deleted: true` 的墓碑**；过滤是调用方的事。 |
| `save(workspaceId, card)` | 按 `card.id` 新增或整体覆盖；**单张卡的写入必须原子**（SQLite 单行 upsert；文件实现用临时文件 + rename）。不能退化成「重写整个列表」。 |
| `kvGet(key)` | 同步读全局键值；不存在返回 `undefined`。 |
| `kvSet(key, value)` | 写全局键值；`value === undefined` 表示**删除该键**。 |
| `close()` | 释放底层资源。异步方法，**建议实现成幂等**：Cordis 拆卸和测试清理可能各调一次，第二次抛错只会掩盖第一次的真错误。 |

⚠ 端口是「同步读 + 异步写」。远程 / 异步后端目前无法实现这个接口；要支持它得改端口，
不是在本包加适配层。

### `close` 语义

本行用 Cordis `effect` 登记关闭：

```ts
ctx.effect(() => () => { void store.close().catch(report) }, 'taskboard3-store: close database');
```

- `close()` 的 Promise **不保证被 await**（Cordis 的 disposer 签名不要求）；
- 因此本行必须自己接住拒绝 —— 否则是未处理的 Promise rejection，可能让进程退出；
- 实现方不要依赖「调用方会等一下再删库」。我们的 `@taskboard/io` 在 `close()` 里
  同步完成 `db.close()`，所以关闭后立即删除库文件是安全的（Windows 上也不会 EBUSY）。

## kv 键空间

kv 是**全局的**，不按 workspace 分区。键名由上层各自定义，实现应把它们当作
**不透明的字符串键**（不要假设键集合封闭，也不要给键加 TTL 或命名空间前缀）。

当前仓库里实际使用的键（改键名时两边都要改）：

| 键 | 写入方 | 用途 |
|---|---|---|
| `workspaces` | `core/src/workspace.ts` | 工作空间索引（JSON 数组） |
| `workspaceSeq` | `core/src/workspace.ts` | 工作空间序号 |
| `toolPolicy:v2` | `core/src/index.ts` | 工具档位策略 |
| `taskboard.permission.cardActionLevel` | `core/src/index.ts` | 「是否允许领卡」轴 |
| `taskboard.permission.aiStateChange` | `core/src/index.ts` | AI 改状态权限 |
| `taskboard.permission.toolGuardLevel` | `dsh-agent-guard` | agent 工具守卫档位 |
| `ui.groups.<workspaceId>` | `dsh/src/ui-state.ts` | 分组定义 |
| `ui.folded.<workspaceId>` | `dsh/src/ui-state.ts` | 折叠态 |
| `ui.expanded.<workspaceId>` | `dsh/src/ui-state.ts` | 强制展开态 |

## `dataDir` 约定

- **必填。** `Config` 里没有默认值 —— 本包不会自己编一个目录。
- 仓库自带的 `cordis.patch.yml` 用 `!!js dshHomePath('taskboard3')` 显式给出；
  ⚠ 该表达式本仓**尚未在真实 profile 里实测**（见 patch 里的注释）。
  其他入口（如 mcp 的构造参数）同样必须显式传。
- `apply` 会先校验非空字符串，再用 `path.resolve` 解析。**相对路径依赖进程 cwd**，
  跨进程复用请传绝对路径。
- 目录不存在会建。SQLite 会在里面生成：

  ```
  taskboard3.db        主库
  taskboard3.db-wal    WAL 日志（有未 checkpoint 的写入时存在）
  taskboard3.db-shm    共享内存索引
  ```

  **备份 / 迁移必须三件一起拷**（或先 checkpoint），只拷 `.db` 会丢最近的写入。
- 库以 WAL 打开（并发读写），`busy_timeout = 5000ms`（写锁等待）。
  WAL 需要本地文件系统；网络盘上 SQLite 可能拒绝 WAL，此时打开会直接报错而不是静默降级。
- 库里有 `PRAGMA user_version = 1`，为将来的 schema 迁移留口；比本程序新的库会被拒绝打开。

## 文件结构

```
src/index.ts        插件行（provide / effect / dataDir 校验）
src/host-types.d.ts 宿主 Cordis 的类型桩（只声明用到的 provide / effect）
locale/zh.json      设置页里的名字与描述
locale/en.json
icon.svg            36 网格的圆柱（存储）图标
```

## 换实现

1. 在自己 profile 的 patch 里把 `taskboard3-store` 这行改成 `disabled: true`；
2. 插一行新插件，`provide('taskboard3Store', 你的实现)`；
3. 实现必须满足上面的 `CardStore` 契约 —— 尤其是 `loadAll` 要含墓碑、`save` 要原子。
