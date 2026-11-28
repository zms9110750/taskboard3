/**
 * 权限 UI 的浏览器半 —— 两个入口，都从 `@taskboard/dsh-client` 搬来（#4 分包裁定）。
 *
 * ## 注册清单（与 dsh-client 的注册面完全不相干）
 *
 * | 入口 | 槽 | 组件 |
 * |---|---|---|
 * | 左侧栏「工具权限」图标 | `sidebar.panellist` | `ToolsPermissionIcon` |
 * | 左侧栏点开的主页面 | `main` | `ToolPermissionPage`（自取 `/api/tools` + 组图 + 模板授权） |
 * | composer 工具行权限框 | `conversation.input.left` | `PermissionBoxEntry`（入口 + 浮层一体） |
 *
 * ## 激活前提
 *
 * Host 半声明了 `inject: ['taskboard3AgentGuard']` —— 守卫行不在 ⇒ 本行不激活 ⇒
 * 本文件根本不会被宿主加载。所以这里**不需要**任何「守卫在不在」的运行时探测
 * （那是 dsh-client 时代的降级逻辑，行级闸门已经取代了它）。
 *
 * ## 两个 id 各自成对
 *
 * 和 dsh-client 的 PANEL_ID 同一条规则：`panellist` 的 `id` = `main` 的 `key`，
 * label 两处必须同一个 —— 这是槽绑定的方式。
 */

import type { Context } from '@deepseek-ai/cordis';
import { createElement } from 'react';
import type { ReactNode } from 'react';

import { createApi } from './api.ts';
import { attachPermissionApi } from './pure/permission-box-state.ts';
import { PermissionBoxEntry } from './renderers/PermissionBoxEntry.tsx';
import { ToolPermissionPage } from './renderers/tool-permission/ToolPermissionPage.tsx';
import { ToolsPermissionIcon } from './renderers/ToolsPermissionIcon.tsx';
import { injectStyles } from './styles.ts';

/** 「工具权限」左侧栏面板 id —— `sidebar.panellist` 条目 id，也是 `main` 槽的 key。 */
export const TOOLS_PANEL_ID = 'taskboard3-tools';

/** 「工具权限」在 panellist 里的排序 —— 排在「任务板」（30）后面，留空隙给将来插入。 */
export const TOOLS_PANEL_ORDER = 40;

/** 权限框入口在 `conversation.input.left` 里的条目 id（同槽唯一）。 */
export const PERMISSION_ENTRY_REGISTRATION_ID = 'taskboard3-permission-entry';

/** 权限框入口的排序 —— 抽屉入口是 100，这里排在它右边。 */
export const PERMISSION_ENTRY_ORDER = 110;

/** 插件名（Cordis 用）。 */
export const name = 'taskboard3-permissions';

/** 依赖的客户端服务。 */
export const inject = ['slots'];

/**
 * 注册两个入口。
 *
 * @param ctx 客户端根上下文
 */
export function apply(ctx: Context): void {
	/* 样式只插一次（幂等）。 */
	injectStyles();

	/* ── 入口 A：左侧栏「工具权限」 + 主页面（一对槽） ── */
	ctx.effect(
		() =>
			ctx.slots.inject('sidebar.panellist', () =>
				ctx.slots.register(
					{ name: 'sidebar.panellist', id: TOOLS_PANEL_ID, order: TOOLS_PANEL_ORDER, label: '工具权限' },
					ToolsPermissionIcon,
				),
			),
		'taskboard3-permissions: register tools-permission panellist entry',
	);

	ctx.effect(
		() =>
			ctx.slots.inject('main', () =>
				ctx.slots.register({ name: 'main', key: TOOLS_PANEL_ID, label: '工具权限' }, ToolPermissionPage),
			),
		'taskboard3-permissions: register tools-permission main body',
	);

	/* ── 入口 B：composer 权限框 ──
	 *
	 * 浮层要 `GET/POST /permission`；store 是模块级的、拿不到 React 上下文，
	 * 所以在注册时把 `createApi()` 的结果喂给它一次。
	 */
	attachPermissionApi(createApi());
	/* 裸调丢返回值**不泄漏**（已核实 `2026-11-28`，源码级：`slots.inject` 内部用 `ctx.effect`
	 * 持有 factory 返回的 disposer，按声明寿命拆装）；丢掉的只是「提前手动停」的能力。 */
	ctx.slots.inject('conversation.input.left', () =>
		ctx.slots.register(
			{ name: 'conversation.input.left', id: PERMISSION_ENTRY_REGISTRATION_ID, order: PERMISSION_ENTRY_ORDER },
			PermissionBoxEntry,
		),
	);

	return;
}
