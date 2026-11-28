/**
 * SSR 断言入口 —— 给 `verify.mjs` 用。
 *
 * `2026-11-19` 这个沙箱里 **headless Edge 起不来**（DSH 沙箱禁止命名管道，
 * Chromium 的 mojo IPC 直接 FATAL）⇒ 没法用 CDP 点、没法截图、没法量几何。
 *
 * 退而求其次：**用 `react-dom/server` 把组件渲染成 HTML 字符串**，断言 DOM 结构。
 *
 * | 能证明 | 不能证明（报告里写明，不假装） |
 * |---|---|
 * | 两条轴 / 六个 radio / checked / disabled 的挂载 | 点击是否真的触发 onSelect（要 DOM 事件） |
 * | 「当前」胶囊、保存中转圈、错误横幅、骨架、重试按钮 | 圆点 / 间距的像素位置（要 getBoundingClientRect） |
 * | 文案确实来自 props 的 options（自定义前缀那条） | 颜色 / 动画是否好看（要截图，让用户双击预览看） |
 *
 * ⚠ 交互判决的可信度来自 `packages/dsh-permissions/test/permission-view.test.ts`
 *   （`node --test` 直接测**同一份纯函数源码**），不靠 SSR 间接证明。
 *
 * ⚠ 这个文件在 `dev/` 下，不进产品构建；它只是给 `node verify.mjs` 打包用的。
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PermissionPanel } from '../../../src/renderers/PermissionPanel.tsx';
import type { PanelState } from '../../../src/pure/permission-view.ts';

/*
 * 纯逻辑 re-export：verify.mjs 里要用**同一份函数**造状态、也顺手再断言一遍，
 * 保证「组件用的那份判决」和单测里那份是同一个模块。
 */
export * from '../../../src/pure/permission-view.ts';

/*
 * 真实选项表也从 core re-export（和服务端 HTTP 路由返回的是同一份常量）——
 * verify 用它渲染「已加载」，断言显示的是真文案，而不是测试里另抄的一份。
 */
export { CARD_ACTION_OPTIONS } from '../../../../core/src/permission.ts';
/* `TOOL_GUARD_OPTIONS` 已搬进 `@taskboard/dsh-tools`（用户 2026-11-23）。 */
export { TOOL_GUARD_OPTIONS } from '../../../../dsh-agent-guard/src/tool-guard.ts';

const noop = (): void => {};

/**
 * 把 `PermissionPanel` 渲染成 HTML 字符串（回调给 noop，结构断言不看回调）。
 *
 * @param state 面板状态（和产品里传的是同一个类型）
 */
export function renderPermissionPanel(state: PanelState): string {
	return renderToStaticMarkup(
		createElement(PermissionPanel, {
			state,
			onSelect: noop,
			onRetry: noop,
			onDismissSaveError: noop,
		}),
	);
}
