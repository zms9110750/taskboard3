/**
 * 工具组图 —— **只是 `@taskboard/core` 的转出口**，实现只有一份。
 *
 * ## 为什么这里只剩一行 re-export
 *
 * 用户 `2026-11-28`（issue #66）：
 * > 「一份环检测，不允许两份。」
 *
 * 组图从「UI 的拖拽辅助」升级成**后端真值**（落 kv + 服务端重新校验），
 * 所以实现搬到 `packages/core/src/tool-graph.ts`（纯逻辑、无宿主依赖）。
 * 本文件保留旧导入路径，只为让 `renderers/tool-permission/GraphEditor.tsx`
 * 的 `../../pure/tool-graph.ts` 继续可解析 —— **不要再往这里加逻辑**：
 * 加进来就等于第二份实现，测试也只会测到其中一份。
 *
 * ⚠ 走子路径 `@taskboard/core/tool-graph` 而不是包根：包根的 `index.ts`
 *   会拉进 `yaml` / `node:fs`（模板加载）⇒ 浏览器半的 tsdown 打不出来。
 *   这个子路径只导出纯逻辑，零依赖。
 */

export * from '@taskboard/core/tool-graph';
