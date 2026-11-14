# AGENTS.md

> **给接手这个仓库的 AI agent（或人）看的操作手册。**
>
> 本文只写**规则和坐标**，不写「怎么实现某个功能」—— 那些在 `docs/` 和各包注释里。
> **事实会漂，规则不会**，所以这里尽量只写规则。

---

## 一、这个仓库是什么

`taskboard3` 是一个 **Cordis 插件 bundle**，实现「任务板」：任务卡有类型 / 有 9 个状态 / 有 6 种关系，不是 todo 树。

**先读 `docs/设计.md`** —— 那里是边界与契约的当前状态。

---

## 二、⚠ 六条绝对规则

### 规则 1：相对导入写 `.ts`，不写 `.js`

```
✅ import { x } from './card.ts'
❌ import { x } from './card.js'
```

`tsconfig.base.json` 开了 `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`：
源里写 `.ts`，`tsc` 在产物里自动改写成 `.js`。

**原因**：`node --test` 直接跑 `.ts` 时，写 `.js` 会 `ERR_MODULE_NOT_FOUND`（Node 不会把 `.js` 映射回 `.ts`）。
写了 `.ts` 之后测试能直接跑源码，**不需要先构建**。

### 规则 2：`lib/` 是产物，绝不手改

```
packages/*/src/**/*.ts    ← 源码（只改这里）
packages/*/lib/**/*.js    ← tsc / tsdown 生成的产物
```

**⚠ `tsc` 不删除「源文件已不存在」的旧产物** ⇒ 改名/删文件后必须 `rm -rf lib && tsc -b`。

### 规则 3：纯 TS，不写 JS

本仓库**没有手写的 `.js` / `.mjs` 源文件**。唯一的 `.js` 是构建产物。

要让某段代码能被 `node --test` 覆盖，**把它放进不含宿主依赖的文件**（如 `dsh-client/src/pure.ts`），而不是写个 `.mjs` 测试脚本。

### 规则 4：测试不能依赖 cwd

```
✅ const dir = join(dirname(createRequire(import.meta.url).resolve('@taskboard/core/package.json')), 'templates')
✅ mkdtempSync(join(tmpdir(), 'prefix-'))
❌ join('packages', 'core', 'templates')
```

**验证方式**：从 `C:\` 这种无关目录跑一次，必须全绿。

### 规则 5：验收藏自己跑，可疑项连跑 3 遍

```
✅ 自己跑 tsc + node --test
✅ flake 可疑时连跑 3 遍
❌ 相信「我这边全绿」的报告
```

**真实案例**：某成员报「110/110 全绿」，lead 实跑是 109/110 —— **flake 掩盖了一个真 bug**（同毫秒时间戳比较）。

### 规则 6：测试要能跑源码，不能只跑产物

```
✅ test/*.test.ts  import '../src/x.ts'      （node --test 直接跑源码）
❌ test/*.test.ts  import '../lib/x.js'      （必须 tsc -b 之后才能跑）
```

**为什么**：测产物有一个**假绿**路径 —— 改了源码忘了构建，测试跑的还是旧 `lib/`，**全绿但测的是上一个版本**。

**验证方式**：

```powershell
rm -rf packages/core/lib
node --test packages/core/test/*.test.ts   # 必须全绿
```

⚠ **跨包测试仍走包名**（`@taskboard/core` → `lib/`），那是 ESM 解析的必然，**不是缺陷**。
所以「全仓测试」仍需先构建；只有**本包自己的测试**必须能脱钩。

**真实案例**（`2026-11-15` 清理）：`core` 的 26 处测试导入全是 `../lib/`，删掉 `lib/` 后直接 `ERR_MODULE_NOT_FOUND`，而**其他四个包都是从 `../src/` 导入的** —— 规则一直写在文档里，但没人执行过。

---

## 三、⚠ 六条「动笔之前先想」

### 3.1 删掉断言会编译失败吗？

```
会   ⇒ 它掩盖着设计问题 ⇒ 改设计
不会 ⇒ 它只是难看 ⇒ 看成本决定
```

**不是「断言看着丑」，而是「它让编译器闭嘴」。**

已清掉的三处：

| 位置 | 掩盖的问题 |
|---|---|
| `core/template/schema.ts` 的 `z.strictObject(...) as unknown as` | zod 推不出动态键类型 |
| `core/create.ts` 的 `as Card[...]` | 断言拦不住脏关系标识（写进卡后所有下游静默跳过） |
| `dsh/index.ts` 的 `coreTransitionOf` 探查 | core 方法改名时静默答 501 而非编译错误 |

**可以留的断言**（两类）：

1. **外部依赖限制**：如 `dsh-tools.d.ts` 垫片（npm 版本与 DSH 不一致）。**必须注明移除条件。**
2. **语言固有摩擦**：如 `noUncheckedIndexedAccess` 下的数组下标。**必须后面跟真实分支**，不是为了让编译器闭嘴。

### 3.2 派活前先确认上游接口定了没有

```
定了   ⇒ 直接派
没定   ⇒ 先派上游，下游等，而不是「你自己判断要不要绕」
```

**反面教材**：我们两次让下游「先用胶水保证能跑」—— `coreTransitionOf`（等 core 的 `transition`）、`core-writes.ts`（等 core 接口补 `actor`）。**两块胶水最后都拆了，等于白写。**

⚠ 这条对**任何派活的人**有效，不只对 lead。

### 3.3 说「已合并 / 已补上」必须给 commit hash

```
✅ 「已提交 abc1234」
❌ 「已补上」
```

**真实案例**：lead 改了一行导出、跑了 `tsc`、说「已补上」—— **但忘了 commit**。成员 rebase 后找不到，白等一轮。

在 worktree 模式下这特别隐蔽：**没有 hash 就等于没做。**

### 3.4 发布前确认 `files` 字段

npm 发布时 `files` 决定打什么包。**漏了 `locale` 或 `icon.svg` ⇒ 装上去只显示包名和默认图。**

本地 linked 安装时 `files` 不生效 ⇒ **本地看着正常、发布后坏了。**

### 3.5 编译期断言必须用「裸字面量元组 + widen 导出」

```ts
// ✅ 正确
const POLICY_TOOL_NAMES = ['a', 'b'] as const;
export const POLICY_TOOLS: readonly string[] = Object.freeze(POLICY_TOOL_NAMES);
// 断言用 POLICY_TOOL_NAMES（保留字面量类型）

// ❌ 错误：元素 widen 成 string
export const POLICY_TOOLS: readonly string[] = ['a', 'b'];
type X = [Extract<(typeof POLICY_TOOLS)[number], ...>] extends [never] ? ... // 永远判不出来
```

**已踩两次**（`protocol/transition.ts` 的 `BUTTON_TABLE`、`core/permission.ts` 的 `POLICY_TOOL_NAMES`），两次都是 `tsc` 报 `TS2344` 才发现。

**症状**：断言静默通过或静默失效。**静默失效比报错更坏** —— 你会以为有守护。

### 3.6 临时绕行必须能被「编译失败」或「测试变红」找到

绕之前先问：**这个绕的地方，将来能不能靠自动化被找到？**

| 绕法 | 安全性 |
|---|---|
| 白名单 + 差集断言（core 补上时测试红） | ✅ 最安全 |
| `as` 断言 + 注释「等 X 补上后删」 | ⚠️ 注释会被删 |
| 点头绪都没有的硬编码 | ❌ |

**真实案例**：`host-dev` 在 core 没导出 `READONLY_TOOLS` 时，绕法是「指向工具注册表 + 注释说明」。补上导出后它主动换了 —— **因为它报告了**，不是因为被抓住。
另一次它用「白名单 + 差集断言」，core 补上后**测试自己变红**，逼着删白名单。后者更可靠。

---

## 四、仓库坐标

```
开发/taskboard3/
├─ AGENTS.md              本文
├─ docs/
│  ├─ 设计.md              ⭐ 边界与契约（先读这个）
│  ├─ 通道方案.md          Host↔Client 通道选型的调研（HTTP 路由 vs Typert Remote）
│  └─ agent身份.md         dsh 里能拿到什么 agent 身份（holder 用）
├─ package.json            根 scripts
├─ pnpm-workspace.yaml
├─ tsconfig.base.json      ⭐ 全局编译选项（唯一的配置来源）
└─ packages/
   ├─ protocol/            九状态 / 六关系 / 错误码 / 转移判定
   ├─ core/                卡 / 模板 / 搜索 / 状态转移 / 存储端口 / bus(临时)
   ├─ store/               存储的默认实现（Cordis 插件行，可替换）
   ├─ dsh/                 Host 半边（HTTP + AI 工具 + 命令 + SSE(临时)）
   └─ dsh-client/          客户端 UI（右侧工作区标签页，MVP）
```

### 各包一句话

| 包 | 一句话 | 可替换 |
|---|---|---|
| `protocol` | 词汇与判决：9 状态、4 组、6 关系、错误码 | 包级 |
| `core` | 领域逻辑 + 唯一的 `CardStore` 端口 | ❌ |
| `store` | `provide('taskboard3Store', …)` 的薄插件 | ✅ **插件行** |
| `dsh` | 12 条 HTTP 路由 + 11 个 AI 工具 + 3 个命令 | ❌ |
| `dsh-client` | 右侧工作区标签页（列表 / 详情 / 状态按钮 / 空间切换） | ✅ 插件行 |

### 构建与测试

```powershell
# 构建（按依赖顺序）
tsc -b packages/protocol packages/core packages/store packages/dsh packages/dsh-client

# 测试（从任意 cwd 都可以；node 需支持 .ts 直接运行）
node --test "packages/*/test/**/*.test.ts"

# 装依赖（worktree 各不相同，合并后要重装）
pnpm install
```

⚠ **每个 worktree 的 `node_modules` 不共享。** 合并后如果测试报「找不到包」，跑一次 `pnpm install`。

---

## 五、⚠ 临时脚手架（将来要拆）

这两个是**用户明确要求的原型期产物**，不是永久架构：

| 文件 | 拆解步骤在哪 |
|---|---|
| `core/src/bus.ts` | 文件头有 5 步 |
| `dsh/src/sse.ts` | 文件头指明跟 `bus.ts` 一起拆 |

**设计目标不是「优雅」，是「可拆」。** 不要给它们加能力（比如往 `TaskboardMessage.type` 里塞新成员）。

---

## 六、⚠ 用户是唯一设计权威

**这个仓库的每一条设计决定，最终都来自用户原话。**

- `docs/设计.md` 第四节记了**四条**最关键的裁定（状态转移、claim 语义、未读标记、工具权限）
- 代码注释里标 `用户 \`2026-11-13\`：` 的地方是**用户原话的时间锚**

**⚠ 判据：用户原话 > 任何转写 / 文档 > 我们的推断。**

**⇒ 所以：**
- **不要用「文档这么写的」去推翻用户原话**
- **发现文档与用户原话冲突时，改文档**
- **不确定时，问用户，不要推断**

---

## 七、这份文件该什么时候改

| 触发 | 改哪 |
|---|---|
| **发现一个新的「静默错误」来源** | §二 或 §三 加一条 |
| **目录结构变了** | §四 |
| **脚手架拆了** | §五 删掉对应行 |
| **清单里某条不再适用** | 删掉它（**别留「以前的规则」**） |

**⚠ 不要在这里写「当前状态」**（比如「现在有 149 个测试」）—— 那是事实，会漂。
**状态在 `docs/设计.md`。**
