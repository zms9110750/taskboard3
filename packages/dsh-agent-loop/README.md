# `@taskboard/dsh-agent-loop`

任务板与 **DSH 消息循环**接触的那一行。用户裁定见 `docs/ARCHIVE.md` §5（`2026-11-28`，#9 动机 1）：
**唤醒机制否决**，改成「未读注入 + 工作泵」两件事；两件事都只在消息循环层面发生。

## 它做什么

| # | 触发 | 动作 | 会不会唤醒 agent |
|---|---|---|---|
| ① 未读注入 | `taskboard3Bus` 的写卡事件（`card:written`） | 重拉工作空间 ⇒ 找「用户改过、AI 没看过」的卡 ⇒ 对每个**活** agent `agent.inject(...)` | **不会**（进 inbox） |
| ② 工作泵 | 定时器（默认 10 分钟） | 重拉 ⇒ 有「提交 / 处理中」的 **work** 卡 ⇒ `agent.followup(...)` 推进下一轮 | 会（followup 排 next-turn） |

两条文案都以 `[任务板]` 开头，让模型分得清来源（消息形状
`{ content: [{ type: 'text', text }], source: { kind: 'user' } }`，不 import 宿主包）。

### ① 未读注入

- 只在 **bus 事件**上跑；**不定时器、不 followup**。
- 「用户改过、AI 没看过」= 卡上的 `unread.user`（`packages/core/src/updates.ts` 的字段命名按
  「谁改的」：`user` = 用户改过、AI 未读；`ai` = AI 改过、**用户**未读）。
  ⚠ 派活说明里写的 `unread.ai` 与 core 的字段语义相反，这里按 §5 与文案取 `unread.user`。
- 去重键 = **卡编号 + 最近一条 history 的时间戳**（`unreadKeyOf`）：同一张卡被用户再改一次会换键，
  于是会再注入一次。
- 已注入集合是内存 Set（本行实例独占，重启后重新注入一次 —— AI 的上下文也重建了）。
- 事件到达时**没有活 agent** ⇒ 不记已注入键，等下一个事件再投。

### ② 工作泵

- 早退条件全部是「什么都不做」：`pump=false` / 本轮在飞 / 清单空 / 无活 agent。
- 「工作卡」= `card.template.kind === 'work'`（内置类别，`packages/core/src/template/kinds.ts`
  里唯一 `needsClaim: true` 的），状态走 protocol 的 `groupOf(status) === 'active'`
  （`active` = 提交 + 处理中，不自造状态判定）。
- 清单最多列 **5 条**，超出只说「还有 N 条未列出」。
- 在飞标记：followup 发出后置位，等 agent 的 `whenIdle?.()`；没有这个方法（或它不 resolve）就
  **5 分钟后兜底清掉**。在飞期间到点的轮次直接跳过，不叠加唤醒。
- 投递失败按单个 agent 收口（一个坏 agent 不影响其余），全部失败则不算一轮。

## 配置

行配置（`cordis.patch.yml` 的 `config`）：

```yaml
- id: taskboard3-agent-loop
  name: '@taskboard/dsh-agent-loop'
  config:
    pump: true                 # 默认 true；false ⇒ 只留未读注入，不建定时器
    pumpIntervalMinutes: 10    # 默认 10；非正数会 warn 并回落默认
```

## 关掉这一行会怎样

- **未读不再注入**：用户回答 / 修改了卡，模型不会被告知。
- **无人值守停止推进**：提交 / 处理中的工作卡不再自动把 agent 叫起来。
- 任务板的卡、空间、HTTP、界面、AI 工具**都不受影响**。

（`locale/zh.json` / `locale/en.json` 的 meta.description 对用户说的是同一句话。）

## 依赖与边界

```
dsh-agent-loop ──► @taskboard/protocol     （状态分组 groupOf / 状态中文名 labelOf）
               ──► taskboard3Core          （inject，只读 listWorkspaces / list）
               ──► taskboard3Bus           （inject，原型期脚手架：收到就重拉）
               ──► ctx.get('agents')       （惰性；不写进静态 inject）
```

- **不 import 任何 `@deepseek-ai/*`**，`package.json` 里也没有 peer 依赖（`ApplyContext` 是结构式垫片）。
- `agents` 服务是**惰性解析**的：`apply()` 执行时它可能还没激活
  （先例：`packages/dsh-agent-guard/src/tool-inventory.ts:67-77`）。
- 没有浏览器半，也就没有 `dsh.manifest`。

## v1 的已知缺口（详见 `src/index.ts` 文件头 TODO）

- **冷会话**：没有活 agent 时跳过；`sessionController.resolveAgent(sessionId)` 的 resume 路径留 TODO。
- **启动时的存量未读**不会被注入（未读侧按裁定不定时器，没有事件可等）。
- 只盯**第一个未归档工作空间**。
- 已注入集合是**全 agent 共享**的：A 注入过的卡，后加入的 B 不会补一次。
- 泵没有「同一张卡每轮只推一次」的去重（不像未读有 `unreadKeyOf`）。

## 测试

```powershell
node node_modules/typescript/bin/tsc -b packages/protocol packages/dsh-agent-loop
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node --test "packages/dsh-agent-loop/test/**/*.test.ts"
```

- `test/loop-judgment.test.ts` —— 纯模块全覆盖（未读 / 工作两类判定的正反例、去重键、5 条上限）。
- `test/apply.test.ts` —— `apply` 形状：注入只在未读时发生、followup 只在泵开且有卡时发生、
  `pump=false` 全静默、bus 订阅与定时器随 `effect` 清理、在飞标记与 5 分钟兜底。
