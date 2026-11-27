# taskboard3 会话存档

> 用途：会话被压缩或新开会话时，先读这里恢复「用户要什么」。
> 本文件由 `.github/workflows/archive-discussion.yml` 发布到 Discussions，标题：`taskboard3 会话存档`。
> 改本文件并 push，讨论会自动更新；不要只贴在聊天里。

最后更新：2026-11-27

## 0. 权威

- 用户是唯一设计权威。
- 目标、范围、做法都由用户决定；agent 不得自行扩大范围、不得自行加问题、不得替用户解释指令。
- 用户原话 > 转写 / 文档 > 推断。

## 1. 用户明确下过的指令

1. 重构 taskboard3 前先了解内容；任何目标由用户决定，agent 无权决定做什么和怎么做。
2. 不准使用 ask 工具提问。
3. 审查发现写进源码 `// TODO(审查)` 注释，不写长报告。
4. TODO 注释提交到分叉分支 `review/todo-audit`，不动 `main`。
5. 拒绝文案：`record` 用「否认」，其余统一「否决」，并加测试。
6. 删除不正确的 TODO（`AUTO_STATES` 长度断言那条）。
7. 发给子 AI 的指令必须先给用户看过；不得擅自添加问题；子 AI 的回报原文转达。
8. 测试放到 GitHub Actions 跑，不在用户机器上跑。
9. 用 GitHub Discussion 存档，通过工作流操作。

## 2. 已完成

- `review/todo-audit`：
  - `f41630a` 审查：11 个包的 TODO(审查) 注释（96 文件 / 911 行，仅注释）
  - `8e62208` 拒绝文案统一 + 删除过时 TODO + 科技树 CSS 断言

## 3. 讨论中、未获批准

以下只是分析结论，不是用户指令：

- 新建 `@taskboard/contracts`（只放接口和常量）是否采用。
- `kind` 归属：protocol 硬编码 vs core 模板。
- `judgeToolCall` / `effectiveToolsOf` / `holderOf` 的属主。
- `Taskboard` 是否拆成窄端口。
- `io` 是否并入 `store`。

## 4. 工作流

- CI：`.github/workflows/ci.yml`（**仅 workflow_dispatch 手动**，用户 `2026-11-27`：「开手动工作流跑测试，不要推上去就测一遍」）
- 存档：`.github/workflows/archive-discussion.yml`（push `docs/ARCHIVE.md` 或手动触发）

## 5. 用户裁定（2026-11-28，#9 动机 1 的实施口径）

**唤醒机制否决。** 替代设计（用户原话归纳）：

- **用户值守**：用户作答后**直接在输入栏聊天**进入消息循环，无需任何唤醒。
  卡上出现「AI 未读」⇒ 插件做一次**上下文注入**（`agent.inject` 进 inbox）即可。
- **无人值守持续推进**：也在**消息循环层面**达成——检查「提交」和「进行中」的
  工作卡 ⇒ 上下文注入工作摘要 ⇒ 推进消息循环。不做「答案到达即唤醒」的定时器。
- 这些行为属于**入侵 DSH 的包**的范围：插件行必须有与 agent / 消息循环的
  **交互接触**才能控制循环（API 面由宿主调研确认）。

同日运作模式裁定：lead 只做设计与派发，实操派给子 AI（便宜模型），
本地仅编译验证，测试一律 GitHub 手动 CI。
