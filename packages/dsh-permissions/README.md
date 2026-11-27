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
src/pure/        零 React 的判决逻辑（两轴面板 / 工具清单解析 / 组图 / 授权分组）
src/renderers/   PermissionBoxEntry / PermissionPanel / ToolPermissionPage / 组图编辑器
```
