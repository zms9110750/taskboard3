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
└─ dev/                    ← 开发中的东西（不参与产品构建）
   ├─ pure/                ←   ┐
   ├─ components/          ←   ├ 组件本体（未定稿）
   ├─ test/                ←   ┘ 它们自己的单测
   ├─ preview/             ← 展示脚手架
   │   ├─ main.tsx           预览页入口（假数据、演示布局）
   │   ├─ preview.css        只看样式，不是产品样式
   │   ├─ build.mjs          rolldown → index.html
   │   ├─ verify.mjs         CDP 断言脚本
   │   └─ index.html         生成物（双击看）
   └─ shots/               ← verify 跑出来的截图
```

## 命令

```powershell
# 建预览（改完组件就重跑，0.3 秒）
node packages/dsh-client/dev/preview/build.mjs

# 验证（CDP 点一遍 + 断言，约 16 秒）
node packages/dsh-client/dev/preview/verify.mjs

# 纯逻辑单测（0.4 秒）
node --test "packages/dsh-client/dev/test/*.test.ts"
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

## 当前 dev/ 清单

| 文件 | 行数 | 状态 |
|---|---|---|
| `pure/filter-box.ts` | 195 | ✅ 可用（27 单测）|
| `components/FilterBox.tsx` | 228 | ✅ 可用 |
| `components/FilterRow.tsx` | 95 | ✅ 可用 |
| `pure/card-view.ts` | 156 | ✅ 可用（28 单测）|
| `components/StatusDot.tsx` | 42 | ✅ 可用 |
| `components/StatusCell.tsx` | 36 | ✅ 可用 |
| `components/CardRow.tsx` | 86 | ✅ 可用 |
| `test/filter-box.test.ts` | 228 | 27 条 |
| `test/card-view.test.ts` | 170 | 28 条 |
| `pure/markdown-tokens.ts` | 899 | ✅ 可用（46 单测，含 12 条 XSS）|
| `components/Markdown.tsx` | 108 | ✅ 可用 |
| `test/markdown.test.ts` | 391 | 46 条 |
| `preview/markdown/*` | 606 | 脚手架（GFM 样本 + XSS 样本 + CDP 断言）|
| `preview/*` | 665 | 脚手架，长期保留 |

## 定稿迁移流程

组件在 `dev/` 里通过验收后：

```powershell
# 1. 组件本体 → src（按现有约定归类）
mv dev/pure/x.ts          src/x.ts
mv dev/components/X.tsx   src/views/X.tsx
mv dev/test/x.test.ts     test/x.test.ts

# 2. 修 import 路径（全部换成产品路径）

# 3. 全仓验证
tsc -b packages/*
node --test "packages/*/test/**/*.test.ts"
```

**`dev/preview/` 和 `dev/shots/` 不迁移** —— 它们是给下一个组件复用的脚手架。

## ⚠ 一条纪律

**组件在 dev/ 里改到用户验收通过，才迁 src。**

原因：`src/` 里的代码会被 `tsc -b` 检验、被产品构建打包、被 npm 发布。
**半成品进去一次，就得清理一次产物。**
