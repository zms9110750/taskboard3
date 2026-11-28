# AGENTS.md

> **给接手这个仓库的 AI agent（或人）看的操作手册。**
>
> 本文只写**规则和坐标**，不写「怎么实现某个功能」—— 那些在 `docs/` 和各包注释里。
> **事实会漂，规则不会**，所以这里尽量只写规则。

---

## 一、这个仓库是什么

`taskboard3` 是一个 **Cordis 插件 bundle**，实现「任务板」：任务卡有类型 / 有 9 个状态 / 有 6 种关系，不是 todo 树。

**先读 `docs/交付.md`** —— 交接说明：插件本体、构建/验证入口，以及**所有非插件文件**
（隔离环境、启动 web、演示数据、散落的探针脚本与截图、遗留 worktree）。

⚠ **`docs/设计.md` 是 2026-11-23 之前的契约**，之后的功能（折叠 / 归组 / 列组件化 / 取消折栏 /
工具清单全量 / 模板授权页 / 档位提到左栏）**都没有写进去** ⇒ 它可能出错，也可能不符合用户期望。
判断依据的顺序见本文第六节：**用户原话 > 代码+测试 > `docs/交付.md` > 旧 docs**。

---

## 二、⚠ 七条绝对规则

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

### 规则 7：`dev/` 不在任何 tsconfig 的 include 里 ⇒ 「tsc 过了」不算验收

`packages/dsh-client/dev/` 是**开发中组件**的暂存区（见 `dev/README.md`），
`tsconfig.json` 的 `include` 只有 `src/**`，所以：

```
tsc -b packages/dsh-client   ← 完全不检查 dev/ 下的任何 .ts / .tsx
```

⇒ **说「dev 里的组件类型检查过了」是假的**，除非另跑一次手写参数的检查：

```powershell
node node_modules/typescript/bin/tsc --noEmit \
  --jsx react-jsx --target ES2022 --module NodeNext --moduleResolution NodeNext \
  --strict --skipLibCheck --allowImportingTsExtensions --verbatimModuleSyntax \
  packages/dsh-client/dev/components/Xxx.tsx
```

**真实案例**（`2026-11-17`）：`space-dev` 主动报告了这一点，并自己补跑了检查。
若不是它报告，我们会拿着一个假的「tsc 通过」继续往下做。

**已根治**（`2026-11-18`）：`packages/dsh-client/tsconfig.dev.json` 存在，
它 include `dev/**` + `dev/` 依赖的那几个 `src/` 文件，`noEmit: true`：

```powershell
node node_modules/typescript/bin/tsc -p packages/dsh-client/tsconfig.dev.json
```

⇒ **dev 组件的验收口令改成**：`tsc -b packages/dsh-client` **且**
`tsc -p packages/dsh-client/tsconfig.dev.json` 两条都 exit 0。

⚠ 这个配置第一次跑就抓到一个真错误：`StatusCell` 传 `size={undefined}` ——
`exactOptionalPropertyTypes: true` 下不允许，必须省略 prop 而不是传 undefined。
**这就是「不检查」的代价：它在 `dev/` 里躺了一整天。**

### 规则 8：worktree **只能由 lead 创建**，子 AI 不碰

```
✅ lead: git worktree add X:\temp\dsh\开发\taskboard3-wt-x -b feat/x main
✅ lead: git -C <worktree> reset --hard main      ← 建完 / 派活前自己收干净
✅ 子 AI: 只在自己的 worktree 里干活
❌ 子 AI: git worktree add / remove / prune
❌ 子 AI: 自己换分支、自己找目录
```

**原因有三条：**

1. **并发安全**：worktree 列表是仓库级共享状态，多个 agent 同时改会互相踩。
2. **实测装不上**：新建的 worktree 里 `pnpm install` 会失败
   （`ERR_PNPM_SYMLINK_FAILED [symlinkAllModules] Maximum call stack size exceeded`），
   所以「派活时再建」这条路本来就不通 —— 必须在派活前由 lead 建好并确认能用。
3. **责任边界**：谁建的谁保证基线干净（`reset --hard main` + 同步依赖），
   否则子 AI 会拿着旧代码干活，然后在报告里说「我这边全绿」—— 而那是上一个版本。

⚠ **现实约束的演变**：`2026-11-19` 曾实测「新 worktree 里 `pnpm install` 失败」
（`ERR_PNPM_SYMLINK_FAILED [symlinkAllModules]`，当时是 pnpm 10）；现有
`taskboard3-wt-{client,host,core,store,storage}` 也已清理不复存在。
**`2026-11-28` 实测翻案**：`corepack pnpm install`（pnpm 12.23）在新建 worktree 里
**成功**（3 秒级）。⇒ 规则改为：lead 可以新建 worktree，装依赖**必须用
`corepack pnpm install`（v12+）**，不要用 pnpm 10。旧 worktree 名单已过时，
以 `git worktree list` 为准。

⚠ **`X:\temp\dsh` 是多 agent 共用目录**：写临时文件（commit message、测试输出）
必须用**唯一文件名**（`X:\temp\dsh\msg-<谁>-<什么>.txt`）。
用 `commit-msg.txt` 这种固定名会被别的 agent 覆盖 —— 已真实踩过一次
（`ws-build` 的 commit message 变成了别人的 markdown 提交消息）。

---

## 三、⚠ 十一条「动笔之前先想」

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

### 3.7 要检查「键集」必须用 `satisfies`，不能用 `as` / 类型标注

```ts
// ✅ 真的会红：少一个键 / 多一个键都报错
const TABLE = { text: …, markdown: … } satisfies Record<BuiltinType, RendererComponent>;

// ❌ 看起来像保证，实际把多余键检查关掉了
const TABLE: Readonly<Record<BuiltinType, RendererComponent>> =
  Object.freeze({ text: …, markdown: …, ask: … });
```

**为什么：** `Object.freeze({...})` 让对象字面量成了**函数实参**。
实参位置的字面量**不受 TS 的多余属性检查约束** —— 多出来的键合法地赋给更窄的 Record。

**所以「少一个键」会红，「多一个键」不会。** 而「多一个键」恰恰是
「写了组件但忘了从表里删」这个方向的错。

**真实案例**（`2026-11-19`）：`registry-design` 写注册器时用的是 `Object.freeze` + 类型标注，
注释里写着「只在文件里多一个组件 ⇒ `tsc` 红」。它**自己做了破坏性验证**，
把 `BUILTIN_TYPES` 从 3 个改成 2 个 ⇒ `tsc -b` **仍然 exit 0**。
改成 `satisfies` 之后才真的红。

⚠ **这是 AGENTS 3.5 说的同一类**：看起来像编译期保证，实际把检查关掉了。
**区别是 3.5 是「断言判不出来」，这条是「断言判得出来但你没写」。**

⚠ **推论**：凡是想让编译器「数键」的地方（注册表、映射表、常量表），
一律用 `satisfies`，**不要**写类型标注 + `Object.freeze`。

### 3.8 阈值是**测量出来的**，不是猜出来的

```css
/* ❌ 第一版写的 */
.tb3cc-page__left { max-height: 46%; }   /* 「左栏最多占一半的九成」——听着合理 */
```

**46% 是怎么来的：从任务描述里直接抄的。** 写的人（我）看着「左栏占不到一半、右栏还留一半」觉得合理，就写进了任务书，**双方都没量过左栏在 570×920 里到底多高**。

**后果**：默认状态完全正常；点开「关系」之后左栏内容 457px > 上限 376px ⇒ 出现滚动条。
**默认状态的截图和 CDP 断言全绿，bug 只在「点一下」之后才存在。**

用户原话：**「抽屉打滚动无所谓。但是工作区打滚动就不行。」**

**应该怎么先量**：写百分比之前，先在**真实容器 + 真实尺寸**下量**最坏的那个典型状态**：

| 左栏状态 | 内容自然高 |
|---|---|
| 关系收起 | 341px |
| 关系展开（空）| 457px |
| 关系展开 + 1 行关联 | 471px |

570×920 里 46% = 376px ⇒ 装不下 457/471。**46% 只对「收起」成立，而收起不是典型状态。**

⇒ 百分比 = 最坏典型状态 / 容器高，**再留余量**。471/920 ≈ 51%，加上「几行关联」和说明块换行，定 70%（≈573px）。

**四条判据**：

1. **任何百分比 / px 阈值，只要能说「这个数是为了装下 X」，就必须先量 X。** 说不出 X 是什么，就是猜的。
2. **「任务描述里写了这个数」≠「这个数是量过的」。** 派活的人写 46% 那也是猜的 —— 写进描述**不构成依据**。
3. **量最坏典型状态，不是初始状态。** 初始状态好看不算数，用户会点。
4. **两边都要量。** 左栏提到 70% 之后要量右栏还剩多少（570×920 里剩 246px —— 够，因为它本来就比视口长、本来就要滚）。只盯一边会把另一边挤死。

### 3.9 一次性探针：跑真组件、驱动状态、只吐数字

**先猜数值是错的，后来写探针实测三档是对的。** 探针长这样（`dev/preview/<名>/_probe.mjs`）：

```
① 起 Edge headless + CDP，打开**建好的真页面**（不是手搓 HTML 片段）
② 切到真实尺寸（点预览里的舞台按钮，不是改 CSS 变量）
③ 逐个典型状态驱动过去（收起 → 点「关系」→ 点 3 次「添加关联」）
④ 每个状态只量几个数，打印数字不打印布尔
⑤ 跑完即删，不提交
```

**四个要点**：

| # | 要点 | 为什么 |
|---|---|---|
| 1 | 跑**真组件 + 真尺寸** | 手搓的片段量出来是片段，不是产品 |
| 2 | **驱动状态**，不能只看初始态 | 这次的 bug 只在「关系展开」之后存在 |
| 3 | **输出数字**，不输出 `true/false` | `scrollable: false` 只说「这档没问题」；`341/341` 才告诉你余量多少、还能撑几行 |
| 4 | 探针**用完就删** | 它是诊断工具，不是产品；留下来会变成第二套没人维护的断言 |

**更狠的一步：把探针的量法搬进 `verify.mjs` 变成常驻断言**，每个状态一条：

```
✓ 关系收起 ⇒ 左栏不滚
✓ 关系展开（空）⇒ 左栏不滚
✓ 关系展开 + 3 行关联 ⇒ 左栏不滚
✓ 高级设置展开 ⇒ 左栏不滚
```

⚠ **断言行为，不要断言那个数字。** 单测写「`max-height` ≥ 65%」是在断言**手段**。
真正的约束是「典型状态下左栏不滚」，数字随设计会变，行为不变。
⇒ 单测可以钉「别改回 46%」（防回归），但**验收必须是 CDP 里逐状态量 `scrollHeight <= clientHeight`**。

### 3.10 引用源码必须能被找到；查不到就说查不到

**对的情况**：

```
✅ 「查了 dsh-client-ui-layout/lib/client.js:21，实际常量是
     SIDEBAR_AUTO_COLLAPSE = 1024，不是 768」
✅ 「我在 195 个 dsh 包里搜 'drawer'，零命中 —— 所以 DSH 没有这个形态」
✅ 「这条我没查到，以下是我的推断（未验证）」
```

**错的情况**（`2026-11-19`，`svg-drawer` 真实踩到）：

```
❌ 「dsh-client-ui-layout/src/client/columns.ts:21：
      export const SIDEBAR_DRAWER_BREAKPOINT = 768」
   —— 这个文件不存在、这个常量不存在、768 也不存在
❌ 「AppFrame.tsx:172-175：const drawer = viewport < SIDEBAR_DRAWER_BREAKPOINT」
   —— 全盘没有 AppFrame.tsx
```

**它给的结论（「DSH 没有底部抽屉」）我独立核实了，是对的。**
但它为了显得可信，编了文件路径、行号、常量名。**这比说「我没查到」坏得多** ——
读的人会以为自己有依据，实际什么都没有。

**判据四条**：

1. **引用必须带可复现的路径**（文件存在、行号对得上）。**给不出就不要给。**
2. **不确定就标「推断（未验证）」**，不要包装成「读到」。
3. **否定式结论也要给搜索范围**：「我搜了 X 目录下的 Y 类文件，零命中」——
   而不是「DSH 没有这个」。
4. **结论对不等于过程对。** 编造的证据会污染下一个人（他会拿这条假引用继续做）。

⚠ **这是 AGENTS 3.3 的变体**：3.3 说「说已补上必须给 hash」，
这条说「说读到了必须给路径」。**两者的共同点是：没有可核对的凭据就等于没做。**

### 3.11 升级真 cordis 类型时的已知坑

垫片（`packages/*/src/host-types.d.ts`）是**按用法手写的窄面**，不是真实 Cordis 类型。
把真类型接进来时下面这些点会一次性全红 —— **那不是回归，是垫片一直没反映真形状**。

| # | 垫片写的 | 真实签名（出处） |
|---|---|---|
| 1 | `effect(…): void` | 返回 `Disposable<Promise<void>>` / `AsyncDisposable<Promise<void>>`（`cordis/src/fiber.ts:421-423`；`Disposable<T> = () => T` 见 `:74`）|
| 2 | `slots` / `sidebarRightTabs` / `locale` 是 `readonly`，`locale` 可选 | 真实 `Context` 上**没有**这些修饰，`locale` 恒在（源码级核对；该包不发 .d.ts）|
| 3 | `SlotRegistration` 只有 name/key/id/order/label/locale/inject | 还缺 `children` / `store` / `select` / `priority` / `registrant`；`inject` 返回 `Record<string, unknown>`、`sessionId` 非必填（`dsh-client-ui-renderer/src/client/registry.ts:209-271`）|
| 4 | `SidebarRightTabDefinition` 无 `multiple` / `keepMounted`，`guide[].order` 可选 | 缺前两个字段；`guide[].order` **必填** |
| 5 | `provide<T>(name, value)` 有 `<T>` | 真实 `provide(name, value?, check?)` **没有** `<T>`（`cordis/src/reflect.ts:46`、`:291`）⇒ `ctx.provide<CardStore>` 必红 |
| 6 | `inject` 用 `as const` | 真实 `Inject = (keyof M)[] \| { [K in keyof M]?: M[K] }` 是**可变**数组（`cordis/src/registry.ts:19`）|

**两条判据：**

1. **`inject` 不要写 `as const`，也不要用 `readonly string[]`。** 真实 `Inject` 是可变数组，
   只读元组 / 只读数组在 `satisfies Plugin` 处一定红。
2. **「加 `peerDependency` 就有类型」是假设，不是事实。** 打包后的 asar 里 `@deepseek-ai/cordis`
   只有 `lib/index.js` + `src/*.ts`；`package.json` 的 `types: lib/types/index.d.ts`
   **指向的文件不在包内** ⇒ 装上去也解析不到类型。垫片必须**随包发**才有效
   （发布方式仍待用户裁定）。

**验证方式**（不要凭包名推断，先在当前安装上看文件在不在）：

```powershell
Test-Path node_modules/@deepseek-ai/cordis/lib/types/index.d.ts
```

---

## 四、仓库坐标

```
开发/taskboard3/
├─ AGENTS.md              本文
├─ docs/
│  ├─ 交付.md              ⭐ 交接说明（插件本体 + 构建/验证 + 所有非插件文件）；**先读这个**
│  ├─ 设计.md              ⚠ 11-23 之前的契约，之后的功能没写进去（见 §一）
│  ├─ 通道方案.md          Host↔Client 通道选型的调研（HTTP 路由 vs Typert Remote）
│  ├─ 权限两轴.md          工具权限的两个轴（core 的 UI 权限 / dsh 的 agent 权限）
│  ├─ 渲染注册表.md        渲染器注册表的设计
│  ├─ 组件清单.md          客户端组件清单
│  └─ agent身份.md         dsh 里能拿到什么 agent 身份（holder 用）
├─ package.json            根 scripts
├─ pnpm-workspace.yaml
├─ tsconfig.base.json      ⭐ 全局编译选项（唯一的配置来源）
├─ scripts/link-worktree.mjs  ⭐ 把 profile 的 @taskboard/* 指向某个 worktree
└─ packages/
   ├─ protocol/            九状态 / 六关系 / 错误码 / 转移判定
   ├─ core/                卡 / 模板 / 搜索 / 状态转移 / 存储端口 / 工具档位策略 / bus(临时)
   ├─ tools/               AI 工具定义层（MCP / DSH 通用，只调 core）
   ├─ io/                  SQLite 封装（kv + 卡）
   ├─ store/               存储的默认实现（Cordis 插件行，可替换）
   ├─ dsh-core/            Host 侧公共设施
   ├─ dsh-tools/           AI 工具的 DSH 适配（`ctx.tools.register`）
   ├─ dsh-agent-guard/     DSH 专属：agent 工具档位守卫 + `GET /api/tools`
   ├─ dsh-agent-loop/      DSH 专属：未读上下文注入 + 无人值守工作泵（#9 动机 1；裁定见 `docs/ARCHIVE.md` §5）
   ├─ dsh/                 Host 半边（HTTP + 命令 + SSE(临时)）
   ├─ dsh-client/          客户端 UI·通用链（右侧工作区 + 侧栏 + 输入框 + 悬停浮层 + 领卡档位）
   ├─ dsh-permissions/     客户端 UI·权限链（工具权限页 + 模板授权 + 组图 + composer 权限框；Host 半 inj 守卫服务，守卫行不在则整行不激活）
   └─ bundle/              ⭐ bundle 壳：`cordis.patch.yml` 里 insert 若干行
```

### 各包一句话

| 包 | 一句话 | 可替换 |
|---|---|---|
| `protocol` | 词汇与判决：9 状态、4 组、6 关系、错误码 | 包级 |
| `core` | 领域逻辑 + `CardStore` 端口 + `ToolPolicyStore`（工具档位策略） | ❌ |
| `tools` | AI 工具定义层（v2：9 条用户定义 + 原始卡，纯 JSON Schema，MCP / DSH 通用） | ❌ |
| `io` | SQLite 封装（卡 + kv） | ✅ 可换 |
| `store` | `provide('taskboard3Store', …)` 的薄插件 | ✅ **插件行** |
| `dsh-core` | Host 侧公共设施（HTTP 应答、错误映射等） | ❌ |
| `dsh-tools` | `@taskboard/tools` 的 DSH 适配（`ctx.tools.register`） | ❌ |
| `dsh-agent-guard` | **DSH 专属**：agent 工具档位守卫 + `GET /api/tools`（MCP 不提供这一层） | ❌ |
| `dsh-agent-loop` | **DSH 专属**：与消息循环接触的两件事 —— 未读上下文注入（不唤醒）+ 无人值守工作泵（followup）（#9 动机 1，`docs/ARCHIVE.md` §5） | ✅ 插件行 |
| `dsh` | HTTP 路由 + 命令 + SSE(临时) + `GET /api/tool-policy` | ❌ |
| `dsh-client` | 客户端 UI·通用链（任务板本体视图；2026-11-27 拆出权限链） | ✅ 插件行 |
| `dsh-permissions` | 客户端 UI·权限链（inj `taskboard3AgentGuard`，守卫行不在则不激活） | ✅ 插件行 |
| `bundle` | bundle 壳：`cordis.patch.yml` 里 insert | ✅ 插件行 |

### 构建与测试

```powershell
# 构建（按依赖顺序；共 12 个包）
node node_modules/typescript/bin/tsc -b `
  packages/protocol packages/core packages/tools packages/io packages/store `
  packages/dsh-core packages/dsh-tools packages/dsh-agent-guard packages/dsh-agent-loop `
  packages/dsh packages/dsh-client packages/dsh-permissions

# dev/ 暂存区单独检查（规则 7；两个客户端包各一份）
node node_modules/typescript/bin/tsc -p packages/dsh-client/tsconfig.dev.json
node node_modules/typescript/bin/tsc -p packages/dsh-permissions/tsconfig.dev.json

# 测试的 tsconfig
node node_modules/typescript/bin/tsc -p tsconfig.test.json

# 客户端 bundle（改 UI 必须重跑，否则 profile 里还是旧界面）
cd packages/dsh-client; node node_modules/tsdown/dist/run.mjs; cd ..\..

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
| **GitHub 流程变了** | §八 |

**⚠ 不要在这里写「当前状态」**（比如「现在有 149 个测试」）—— 那是事实，会漂。
**状态在 `docs/设计.md`。**

---

## 八、GitHub：讨论存档与 CI

**仓库私有，远端 `origin` 是 GitHub。测试与讨论都在 GitHub 上，不在本机。**

### 8.1 讨论存档（防会话压缩丢失）

- 源文件：`docs/ARCHIVE.md`
- 工作流：`.github/workflows/archive-discussion.yml`
- 触发：push 修改 `docs/ARCHIVE.md`，或手动 `workflow_dispatch`
- 行为：按标题 `taskboard3 会话存档` 创建或更新 Discussion（分类 `General`）
- **需要留档的指令先写进 `docs/ARCHIVE.md` 再 push；只写在聊天里不算**
- 会话被压缩后：先读这个 Discussion / 文件，再动手

### 8.2 CI

- 工作流：`.github/workflows/ci.yml`
- 触发：**仅 `workflow_dispatch`（手动）**——push / PR 不自动跑（用户 `2026-11-27`：「开手动工作流跑测试，不要推上去就测一遍」）
- 步骤：`pnpm install --frozen-lockfile` → `pnpm run build` → `pnpm run check:dev` → `pnpm run check:test-types` → `pnpm run test`
- **测试以 CI 结果为准，不在用户机器上跑全量**
- 改动推上去后：**手动 dispatch 一次 ci，看绿再继续**；CI 不可用时才本地补跑

### 8.3 GitHub MCP

- 读仓库 / 工作流 / 讨论走 GitHub MCP
- 写代码优先本地 + push；不要用 MCP 直接改源码
- 工作流失败先看 `actions_list` / `get_job_logs`，不要靠猜

### 8.4 发帖身份

- **禁止用 MCP（用户账号）发 Discussion / Issue 评论**
- 要发东西就落地成文件，再走 `github-actions[bot]` 工作流：
  - 讨论：`docs/ARCHIVE.md` → `archive-discussion.yml`
  - 分包讨论：`docs/PACKAGES.md` → `packages-discussion.yml`
  - Issue 评论：`bot-issue-write.yml`（workflow_dispatch，纯内存输入 `issue` + `body`，不落文件；重复触发会先清掉该 issue 旧的 bot 评论）
- 发完看 `author`：必须是 `github-actions`，不是 `zms9110750`

### 8.5 讨论必须带版本与来源

- **每个讨论正文第一段必须 link 一个 tag**：写明「这是对哪个版本的评审」
- **由 issue 创建的讨论，必须 link 该 issue**（父 issue 也一并 link）
- 格式：

```md
> 基线：tag [`<tag>`](https://github.com/<owner>/<repo>/tree/<tag>)
>
> 来源：Issue [#N](https://github.com/<owner>/<repo>/issues/N)
```

- tag 必须指向正文所述版本对应的 commit，并在 discussion 创建前推上去
- 光有 commit hash 不够：**没有 tag 的讨论视为不合规**

### 8.6 分包评审从行为出发

- **不要以现有包为起点**描述分包；重构后现有分包不存在
- 先列「系统能做什么」的行为总表，不看代码目录
- 把行为打乱成池，再按四条直觉聚类：一起变 / 同一条调用链 / 谁拥有数据 / 部署哪一侧
- 聚类完成后再映射到包；现有包只作为「落位参考」
- 保留的是行为，不是目录

### 8.7 PR 流程：先 issue 后 PR（用户 `2026-11-28`）

- **每个 PR 必须先有描述它要解决的问题的 issue**——如同真实 GitHub 开发流程；
  没有任务描述记录时，用 GitHub issue 描述整个过程
- issue：开 issue 描述问题，**link 相关 issue / 讨论**；由 AI 起草的正文注明 AI 作者（issue 经 MCP 建立时会显示为 owner 账号，正文首段声明）
- PR：body 里 **link 那个 issue**（`Closes #N` 或引用），说明改动如何回应问题
- 本规则适用于功能与修复类 PR；纯会话存档类 docs 推送不在此列





