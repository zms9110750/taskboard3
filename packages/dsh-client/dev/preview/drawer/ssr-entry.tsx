/**
 * SSR 断言入口 —— 给 `verify.mjs` 用（这个沙箱里 headless Edge 起不来，见 `verify.mjs`）。
 *
 * 导出三样东西：
 *   1. 真组件（`DrawerEntry` / `Drawer`）+ 渲染函数；
 *   2. mock composer 的渲染函数（证明「预览照真结构画」——入口在工具行里、
 *      overlay anchor 在卡片顶部、`+` 在入口左边）；
 *   3. 槽注册函数 + 一份 Workspace props（verify 里用假 ctx 驱动注册，
 *      断言两个槽**拿到同一个 store**）。
 *
 * ⚠ 这个文件在 `dev/` 下，不进产品构建；只被 `node dev/preview/drawer/verify.mjs`
 *   用 rolldown 打包（和 build.mjs 同一套工具）。
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { initRenderers } from '../../../src/init-renderers.ts';
import { DRAWER_VARIANTS, createDrawerStore } from '../../../src/pure/drawer-view.ts';
import type { DrawerVariantId } from '../../../src/pure/drawer-view.ts';
import { Drawer, DrawerEntry } from '../../../src/renderers/Drawer.tsx';
import { Workspace } from '../../../src/renderers/Workspace.tsx';
import type { WorkspaceProps } from '../../../src/renderers/Workspace.tsx';
import {
	DRAWER_ENTRY_ORDER,
	DRAWER_ENTRY_REGISTRATION_ID,
	DRAWER_ENTRY_SLOT,
	DRAWER_PANEL_ID,
	DRAWER_PANEL_ORDER,
	DRAWER_PANEL_REGISTRATION_ID,
	DRAWER_PANEL_SLOT,
	DrawerEntrySlot,
	DrawerPanelSlot,
	registerDrawerSlots,
} from '../../../src/register-drawer.tsx';
import { DRAWER_CSS, WORKSPACE_CSS } from '../../../src/styles.ts';
import type { Workspace as SpaceEntity } from '../../../src/types.ts';
import { CARDS, KIND_LABELS, TEMPLATES, WORKSPACES } from './fixtures.ts';
import { MockComposer } from './mock-composer.tsx';

/*
 * 纯逻辑 re-export：verify.mjs 用**同一份函数**造状态、也顺手再断言一遍，
 * 保证「组件用的那份判决」和单测里那份是同一个模块。
 */
export * from '../../../src/pure/drawer-view.ts';

/** 样式也 re-export：CSS 硬约束（表插值 / 无 fixed 面板）在 verify 里断言。 */
export { DRAWER_CSS, WORKSPACE_CSS };

/** 夹具 re-export（verify 里要数卡、数工作区）。 */
export { CARDS, TEMPLATES, WORKSPACES };

/** 组件与注册 re-export。 */
export {
	DRAWER_ENTRY_ORDER,
	DRAWER_ENTRY_REGISTRATION_ID,
	DRAWER_ENTRY_SLOT,
	DRAWER_PANEL_ID,
	DRAWER_PANEL_ORDER,
	DRAWER_PANEL_REGISTRATION_ID,
	DRAWER_PANEL_SLOT,
	Drawer,
	DrawerEntry,
	DrawerEntrySlot,
	DrawerPanelSlot,
	Workspace,
	registerDrawerSlots,
	createDrawerStore,
};

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
export function sampleWorkspaceProps(selectedId: string | null = 'GU-02'): WorkspaceProps {
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
 * 渲染一个入口按钮。
 *
 * @param variantId 形态
 * @param open 是否处于打开态
 */
export function renderEntry(variantId: DrawerVariantId, open: boolean): string {
	return renderToStaticMarkup(
		createElement(DrawerEntry, {
			open,
			onToggle: noop,
			variant: DRAWER_VARIANTS[variantId],
		}),
	);
}

/**
 * 渲染一个抽屉面板（开 / 关）。
 *
 * @param variantId 形态
 * @param options 额外属性
 */
export function renderDrawer(
	variantId: DrawerVariantId,
	options: {
		readonly open?: boolean;
		readonly title?: string;
		readonly onRefresh?: boolean;
		readonly workspace?: WorkspaceProps;
	} = {},
): string {
	return renderToStaticMarkup(
		createElement(Drawer, {
			open: options.open ?? true,
			onClose: noop,
			variant: DRAWER_VARIANTS[variantId],
			workspace: options.workspace ?? sampleWorkspaceProps(),
			...(options.title === undefined ? {} : { title: options.title }),
			...(options.onRefresh === true ? { onRefresh: noop } : {}),
		}),
	);
}

/**
 * 渲染 mock composer（证明预览结构和真 composer 一致）。
 *
 * @param variantId 形态
 * @param open 抽屉是否打开
 */
export function renderMockComposer(variantId: DrawerVariantId, open: boolean): string {
	return renderToStaticMarkup(
		createElement(MockComposer, {
			variant: DRAWER_VARIANTS[variantId],
			open,
			onToggle: noop,
			onClose: noop,
			workspace: sampleWorkspaceProps(),
			title: '任务板',
			onRefresh: noop,
		}),
	);
}
