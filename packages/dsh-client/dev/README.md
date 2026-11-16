# dev/ —— 开发中的组件

> **这里的东西还不是产品。** 确认可用后才 `mv` 回 `src/`。
>
> 用户 `2026-11-17`：
> > 「开发中的组件放在 dev 文件夹。组件，展示组件的 html，都分开。
> >  在确认组件可用以后再把 ts 放回去 src」

---

## 三件事分开放

```
packages/dsh-client/
├─ src/                    ← 产品代码（会打进插件、发 npm）
├─ test/                   ← 产品代码的测试
└─ dev/                    ← 开发中的东西（不进行产品构建）
   ├─ pure/                ←   ┐
   ├─ components/          ←   ├ 组件本体（未定稿）
   ├─ test/                ←   ┘ 它们自己的单测
   ├─ preview/             ← 展示脚手架：入口 + CSS + 构建 + 验证
   │   ├─ main.tsx           预览页入口（假数据、演示布局）
   │   ├─ preview.css        只看样式，不是产品样式
   │   ├─ build.mjs          rolldown → index.html
   │   ├─ verify.mjs         CDP 断言脚本
   │   └─ index.html         生成物（双击看）
   └─ shots/               ← verify 跑出来的截图
```

## 为什么这样分

| 目录 | 进产品构建吗 | 会被 npm 发布吗 |
|---|---|---|
| `src/` | ✅ tsdown entry = `src/client.tsx` | ✅（`files: ["lib"]`）|
| `test/` | ❌ 只跑测试 | ❌ |
| `dev/` | ❌ 完全不参与 | ❌ |

**之前 `src/preview/main.tsx` 在 `src/` 下**，`tsc -b` 就给它出了
`lib/preview/main.d.ts` —— 展示脚手架混进了产物目录，`files: ["lib"]` 会把它发出去。
（`2026-11-17` 发现的，已移出。）

## 定稿迁移流程

组件在 `dev/` 里通过验收后：

```powershell
# 1. 组件本体 → src（按层归类）
mv dev/pure/x.ts        src/x.ts            # 纯逻辑放 src 根（和 pure.ts 并列）
mv dev/components/X.tsx src/views/X.tsx     # 组件放 views/（现有约定）

# 2. 单测 → test
mv dev/test/x.test.ts   test/x.test.ts

# 3. 修 import 路径（全部换成产品路径）

# 4. 全仓验证
tsc -b packages/*          # 必须过
node --test "packages/*/test/**/*.test.ts"
```

**`dev/preview/` 和 `dev/shots/` 不迁移** —— 它们是给下一个组件复用的脚手架。

## 当前 dev/ 里的东西

| 项 | 状态 | 说明 |
|---|---|---|
| `pure/filter-box.ts`（195 行）| ✅ 可用，待迁移 | 面包屑路径逻辑，27 条单测 |
| `components/FilterBox.tsx`（228 行）| ✅ 可用，待迁移 | |
| `components/FilterRow.tsx`（95 行）| ✅ 可用，待迁移 | |
| `test/filter-box.test.ts`（228 行）| ✅ 27 条全过 | |
| `preview/*` | 脚手架，长期保留 | 下个组件改 `main.tsx` 复用 |

**FilterBox 已通过验收（用户 `2026-11-16` 确认）。可以迁移。**
