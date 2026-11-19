/**
 * SSR 断言入口 —— 给 `verify.mjs` 用。
 *
 * `2026-11-20` 这个沙箱里 **headless Edge 起不来**（DSH 沙箱禁命名管道，
 * Chromium 的 mojo IPC 直接 FATAL）⇒ 没法点、没法量几何、没法截图。
 *
 * 退而求其次：**用 `react-dom/server` 把组件渲染成 HTML 字符串**，断言 DOM 结构。
 *
 * | 能证明 | 不能证明（报告里写明，不假装）|
 * |---|---|
 * | 抽屉层/面板/顶栏/关闭/刷新按钮的挂载与尺寸标注 | 面板是不是真的贴在父容器底边（要布局）|
 * | 「第二个 Workspace 实例」真的存在，且两个实例选中不同的卡 | 两个实例的滚动位置是否真的独立（要 DOM）|
 * | compact 档的 chrome 收起规则在 CSS 里（以及没有 position:fixed） | 两栏是不是真的各自滚（要 getBoundingClientRect / scrollHeight）|
 * | 触发器开/关两态的 DOM（aria-expanded / chevron 朝向） | Esc / 点外部是否真的关（要 DOM 事件）|
 *
 * ⚠ 交互判决的可信度来自 `test/drawer-view.test.ts`（`node --test` 直接测**
 *   同一份纯函数源码**），不靠 SSR 间接证明。
 *
 * ⚠ 这个文件在 `dev/` 下，不进产品构建；它只是给 `node verify.mjs` 打包用的。
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { initRenderers } from '../../../src/init-renderers.ts';
import { DRAWER_PANEL_ID, Drawer, DrawerToggle } from '../../../src/renderers/Drawer.tsx';
import { Workspace } from '../../../src/renderers/Workspace.tsx';
import type { WorkspaceProps } from '../../../src/renderers/Workspace.tsx';
import { DRAWER_CSS, WORKSPACE_CSS } from '../../../src/styles.ts';
import type { Workspace as SpaceEntity } from '../../../src/types.ts';
import { CARDS, KIND_LABELS, TEMPLATES, WORKSPACES } from './fixtures.ts';

/*
 * 纯逻辑 re-export：verify.mjs 用**同一份函数**造状态、也顺手再断言一遍，
 * 保证「组件用的那份判决」和单测里那份是同一个模块。
 */
export * from '../../../src/pure/drawer-view.ts';

/** 样式也 re-export：CSS 硬约束（无 fixed / 间距数值 / 谁在滚）在 verify 里断言。 */
export { DRAWER_CSS, WORKSPACE_CSS };

/** 夹具 re-export（verify 里要拿真实的第 5 张卡之类做断言）。 */
export { CARDS, TEMPLATES, WORKSPACES };

/** 组件 re-export（verify 里单独渲染它们；面板 id 给 aria-controls 断言用）。 */
export { DRAWER_PANEL_ID, Drawer, DrawerToggle, Workspace };

/* 产品里 `client.tsx` 的 `apply()` 第一件事就是它；预览/SSR 也要先注册再渲染。 */
initRenderers();

/** 空回调 —— 结构断言不看回调。 */
const noop = (): void => {};

/** 一个空间列表（含一个归档，用来证明「显示已归档」那条不变量）。 */
const SPACES: readonly SpaceEntity[] = WORKSPACES;

/**
 * 造一份 Workspace props。
 *
 * @param selectedId 选中的卡（`null` = 详情关闭）
 */
function workspaceProps(selectedId: string | null): WorkspaceProps {
	return {
		workspaces: SPACES,
		currentId: 'default',
		viewingId: 'default',
		showArchived: false,
		cards: CARDS,
		templates: TEMPLATES,
		selectedId,
		kindLabelOf: (kind) => KIND_LABELS[kind] ?? kind,
		aiUnreadCount: 1,
		aiUpdatedCount: 2,
		onView: noop,
		onActivate: noop,
		onToggleArchived: noop,
		onToggleShowArchived: noop,
		onCreateWorkspace: noop,
		onSelect: noop,
		onCreateCard: noop,
		onAction: noop,
		onAddRelation: noop,
		onDerive: noop,
		onNoteChange: noop,
		onOpenPermission: noop,
	};
}

/**
 * 渲染一个合上/打开的抽屉。
 *
 * @param open 是否打开
 * @param options 额外属性（标题 / 刷新 / 底边距 / 选中卡）
 */
export function renderDrawer(
	open: boolean,
	options: {
		readonly title?: string;
		readonly onRefresh?: boolean;
		readonly bottomOffset?: number;
		readonly selectedId?: string | null;
		readonly workspaceId?: string;
	} = {},
): string {
	const drawer = createElement(Drawer, {
		open,
		onClose: noop,
		workspace: {
			...workspaceProps(options.selectedId ?? 'GU-02'),
			...(options.workspaceId === undefined ? {} : { viewingId: options.workspaceId }),
		},
		...(options.title === undefined ? {} : { title: options.title }),
		...(options.onRefresh === true ? { onRefresh: noop } : {}),
		...(options.bottomOffset === undefined ? {} : { bottomOffset: options.bottomOffset }),
	});
	return renderToStaticMarkup(drawer);
}

/**
 * 渲染「页签实例 + 抽屉实例」两个 Workspace —— 证明**状态独立**。
 *
 * 页签选 GU-01、抽屉选 GU-02：两个实例同时存在，各自画自己的选中卡。
 *
 * @param drawerOpen 抽屉是否打开
 */
export function renderTwoInstances(drawerOpen: boolean): string {
	return renderToStaticMarkup(
		createElement(
			'div',
			{ 'data-scene': 'two-instances' },
			createElement(Workspace, workspaceProps('GU-01')),
			createElement(Drawer, {
				open: drawerOpen,
				onClose: noop,
				workspace: workspaceProps('GU-02'),
				onRefresh: noop,
				bottomOffset: 136,
			}),
		),
	);
}

/**
 * 只渲染 Chevron 触发器（开 / 关两态）。
 *
 * @param open 开态
 */
export function renderToggle(open: boolean): string {
	return renderToStaticMarkup(createElement(DrawerToggle, { open, onToggle: noop }));
}
