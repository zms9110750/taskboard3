# @taskboard/dsh-permissions

任务板的**权限面**（DSH Web 客户端插件行）。

## 这个行管什么

- 左侧栏「工具权限」入口 + 主页面：工具清单（`GET /api/tools`）、工具组图编辑、模板授权。
- composer 工具行的权限框：agent 工具档位（`GET/POST /api/permission` 的 tool 轴）+ 两轴权限面板。

## 激活闸门

Host 半声明 `inject: ['taskboard3AgentGuard']`：守卫行（`@taskboard/dsh-agent-guard`）
不在 ⇒ 本行不激活 ⇒ 浏览器半不加载 ⇒ 权限入口不出现。这是设计意图（#4 分包裁定）。

「是否允许领卡」那条轴（`cardActionLevel`）**不在这里** —— 用户裁定它归一般 UI
（`@taskboard/dsh-client` 的任务板工具栏 `CardActionControl`）。

## 行内结构

```
src/index.ts     Host 半（激活闸门，无副作用）
src/client.tsx   浏览器半（两个入口的槽注册）
src/api.ts       权限面 HTTP 子集（buildPath + getPermission/setPermission）
src/wire.ts      信封解析 / GET·PUT（组图与授权共用一份；保留 detail.code / detail.cycle）
src/pure/        零 React 的判决逻辑（两轴面板 / 工具清单解析 / 组图 / 授权分组 / 组图线上文档 / 授权编辑 / 折叠偏好）
src/renderers/   PermissionBoxEntry / PermissionPanel / ToolPermissionPage / 组图编辑器 / 授权页
```

## 跨包：折叠组件复用

授权页的折叠（`档位` / `模板` / 每个领域块）用的是 `@taskboard/dsh-client/fold-pill`
导出的 `FoldPill` / `FoldRect` —— **没有第二份实现**：

- 组件：dsh-client 的 tsdown 额外产出一个纯 ESM 的 `lib/fold-pill.js`；
- 样式：`FOLD_PILL_CSS` 是同一份字符串，本包的 `styles.ts` 也注入它
  ⇒ dsh-client 行关着时胶囊仍然有样式。

## 预览

`dev/preview/` 下四个：`permission`（两轴面板）、`permission-container` / `permission-page`
（权限选择的全屏页候选）、`tool-permission`（**本页**：编组 / 授权，桩后端把改动存
localStorage）。

```powershell
node packages/dsh-client/dev/preview/build.mjs ../../../dsh-permissions/dev/preview/tool-permission
node packages/dsh-permissions/dev/preview/tool-permission/verify.mjs
```
