/**
 * `@taskboard/dsh-permissions` —— Host 半。
 *
 * ## 这个包为什么存在（#4 分包裁定，2026-11-27）
 *
 * > 「还有一条路。core←权限守卫←dsh ui。这个ui是另一套。不仅和之前的ui不相干。
 * >   而且只有权限守卫出来了才工作。而这个守卫是dsh注入才有的。」
 *
 * ⇒ 权限 UI（工具权限页 + 模板授权 + 组图 + composer 权限框）从
 *   `@taskboard/dsh-client` 拆出来，成为**独立的一行**。
 *
 * ## 激活闸门 = 本文件的 `inject`
 *
 * 守卫行（`@taskboard/dsh-agent-guard`）provide `taskboard3AgentGuard`；
 * 本行声明 `inject: ['taskboard3AgentGuard']` ⇒ **守卫行不在 ⇒ 本行不激活**，
 * 浏览器半（`./client`）也不会被宿主加载 —— 权限入口整个不出现。
 * 这是设计意图（「只有权限守卫出来了才工作」），不是缺陷。
 *
 * MCP 场景没有 agent 守卫行 ⇒ 这套权限 UI 在 MCP 下永远不出现。
 *
 * ## Host 半不做别的
 *
 * 路由和 core 在 `@taskboard/dsh`；守卫在 `@taskboard/dsh-agent-guard`；
 * 本包 Host 半只是行的入口 + 激活闸门。
 */

import type { Context } from '@deepseek-ai/cordis';

/** 插件名。 */
export const name = 'taskboard3-permissions';

/**
 * 激活闸门：守卫服务（`@taskboard/dsh-agent-guard` 的 AGENT_GUARD_SERVICE）。
 *
 * 缺它 ⇒ 本行不激活 ⇒ 浏览器半不加载 ⇒ 权限入口不出现。
 */
export const inject = ['taskboard3AgentGuard'] as const;

/** Host 半：无副作用（激活闸门已经完成它的使命）。 */
export function apply(_ctx: Context): void {
	/* 故意为空：本包的实现在浏览器半（`./client`）。 */
}
