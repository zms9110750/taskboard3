# `@taskboard/dsh-client`

把任务板渲染成 **DSH 右侧工作区的一个标签页**。

## 它是什么

一个 **DSH Client 插件**：浏览器里的 React 组件，注册进宿主的右侧栏标签系统。
它**没有自己的 HTML、没有自己的 HTTP 服务、没有 iframe** —— 它就是宿主页面里
的一块 UI。

## 用户要的是什么

> ui先做右边的工作区。

现在有**三处入口**：右侧工作区标签页、左侧栏全局面板、输入框旁的抽屉。
三处注册的是同一个 `WorkspaceBody`（用户 `2026-11-23`：「用同一套 dom。
让他们的视口不一样。但是视口内用同一个组件。」），差异由容器宽度（`@container`）
决定，不再有「密度」参数。

## 它显示什么

```
┌──────────────────────────────────────┐
│ [空间下拉 ▾]           [刷新] [＋]    │  ← 顶部栏
├───────────────────┬──────────────────┤
│ GU01 修登录框 提交 │ 修登录框  [状态] │
│ GU02 写测试   成功 │ ──────────────── │
│ GU03 查资料  需要信息│ 需求             │
│                   │ 把登录框修好      │
│                   │ 备注              │
└───────────────────┴──────────────────┘
```

- **左列**：卡列表（编号 + 标题 + 状态徽章）
- **右列**：选中卡的详情（标题、状态、模板、章节内容、备注）
- **「状态」按钮**：弹出这张卡当前能做的所有操作

⚠ **窄面板自动上下排**（`@container` 查询）—— 右侧栏默认就窄。

## 状态按钮从哪来

**不是本包自己算的。**

```ts
import { buttonsOf } from '@taskboard/protocol';

const buttons = buttonsOf(card.template.kind, card.status, 'user');
```

`@taskboard/protocol` 的 `BUTTON_ACTIONS` 是**唯一来源**，本包只做两件事：
渲染成按钮、点下去翻译成 API 动作（`src/actions.ts`）。

用户 `2026-11-13` 的裁定（自动计算禁入终结态、人通过按钮进终结态）全部在
`protocol` 里，UI 不重复实现 —— 改一处不会漏。

## 数据通道

**HTTP 路由**，不是 Typert Remote。理由见 `docs/通道方案.md`：Typert 的代码
生成器不随 DSH 安装分发，第三方插件作者拿不到那条链。

```
GET  taskboard3/api/state?workspace=…   一次拿全量（空间 + 卡 + 模板）
GET  taskboard3/api/workspaces
POST taskboard3/api/workspaces
POST taskboard3/api/cards
PATCH taskboard3/api/cards/:id
POST taskboard3/api/cards/:id/action
```

⚠ query 名是 **`workspace`**（不是 `workspaceId`）—— 服务端读 `query.get('workspace')`，
发错名字不会报错，只会**静默回落到默认空间**。见 `test/api.test.ts` 的回归钉。

⚠ **路径都是相对形式（无前导 `/`）** —— DSH 页面可能挂在子路径下。
见 `src/api.ts` 的 `API_BASE`。

## 文件结构

```
src/
├─ client.tsx         插件入口：注册 tab 类型 + panellist/main + 抽屉槽
├─ index.ts           Host 半（空 —— 本包只有浏览器半）
├─ WorkspaceBody.tsx  标签页 body：数据层 + Workspace + 建卡页
├─ api.ts             fetch 封装（路径拼接 + 信封解包 + ApiError）
├─ api-client.ts      包内唯一的 API 客户端单例（惰性）
├─ store.ts           useBoardState hook（只有 hook，逻辑在 pure.ts / pure/）
├─ actions.ts         按钮 → API 动作的映射
├─ styles.ts          表驱动的样式注入（各段 CSS 真值在组件目录的 *-css.ts）
├─ types.ts           本包的数据形状（不依赖 core —— core 带 node:sqlite）
├─ pure.ts            通用纯函数 —— 可被 node --test 直接跑
├─ pure/              按主题拆开的纯逻辑（filter / section / tree / drawer …）
└─ renderers/         组件（Workspace / CardDetail / Section / Markdown / 建卡页 …）
   ├─ workspace/      工作区内部部件（工具栏 / 列表头 / 分隔条 …）
   └─ create/         建卡页部件
```

## 为什么 `pure.ts` 和 `store.ts` 分开

`store.ts` 里有 `useBoardState()`，它 `import` 了 React。而 Node 的 `node --test`
加载不了 React（浏览器包，由宿主提供，本包没装）。

⇒ 纯逻辑全在 `pure.ts`（通用）或 `pure/`（按主题拆分），可测试；`store.ts` 只有薄薄一层 hook。

**以后加任何纯函数都放 `pure.ts` / `pure/`，不要放进 `store.ts`。**

## 为什么 CSS 是 TS 字符串

DSH 的客户端插件产物必须是**一个** JS 文件。用 `.css` 文件会产出独立的
`style.css`，而宿主的模块加载器不会去取它。

⇒ CSS 写成 TS 常量，`apply()` 里插一个 `<style>`（幂等，不清理）。

颜色全部走宿主主题 token `--dsw-alias-*`，浅色/深色自动跟随。

## 构建

```bash
pnpm --filter @taskboard/dsh-client build
```

两步：

1. `tsc -b` —— 类型检查 + 出 `.d.ts`（`emitDeclarationOnly`）
2. `tsdown` —— 把 `.tsx` 打成 `lib/client.js`

产物形状（与产品包一致）：

```js
window.__ModuleLoader__.load({
  id: '@taskboard/dsh-client',
  factory: (require) => { … return module.exports; },
});
```

**React 从宿主 `require('react')`**，不进 bundle。
**`@taskboard/protocol` 打进产物**（它不在宿主模块表里）。

## 测试

```bash
node --test packages/dsh-client/test/*.test.ts
```

测试在 `test/` 下、按纯逻辑模块拆分（路径拼接 / 信封解包 / 筛选 / 折叠 /
树布局 / 样式注入 …）。

⚠ **这里不写「多少条、全绿」** —— 那是会漂的事实，以 CI 结果为准
（AGENTS §七：文档只写规则和坐标，不写当前状态）。

**UI 渲染本身没有自动化测试** —— 需要真实 DSH 环境和浏览器。见下方「未验证」。

## 未验证（必须实测）

1. **`lib/client.js` 能否被宿主加载器接受** —— 形状是照产品包产物写的，但没在真实 DSH 里跑过。
2. **`ctx.sidebarRightTabs.register` / `ctx.slots.inject` 的实际签名** —— 类型是 `host-types.d.ts` 里按产品包源码声明的，参数名可能不同。
3. **HTTP 路径的挂载点** —— 若 DSH 页面挂在非根路径，相对路径应当可用，但没实测。
4. **主题 token 名称** —— 用了 `--dsw-alias-text-primary` 等，若宿主没有这些 token 会回落到浏览器默认（不崩，但样式难看）。

## 依赖

- `@taskboard/protocol` —— 状态词表、按钮表、转移判定
- React —— 由宿主提供，**不是本包依赖**
