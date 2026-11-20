/**
 * 预览用的 Workspace props —— 两个预览页共用（数据来自 `fixtures.ts`）。
 *
 * 为什么抽出来：候选对比页有三个面板、单栏页有一个面板，**同一份形状**；
 * 各写一份迟早漂（改一边忘另一边，预览和 SSR 断言看的不是同一份数据）。
 */

import type { ButtonAction } from '@taskboard/protocol';

import type { Picked } from '../../../src/pure/filter-box.ts';
import type { WorkspaceProps } from '../../../src/renderers/Workspace.tsx';
import { CARDS, KIND_LABELS, TEMPLATES, WORKSPACES } from './fixtures.ts';

/** 造 props 的输入。 */
export interface MockWorkspaceOptions {
	/** 当前选中的卡（`null` = 详情关闭）。 */
	readonly selectedId: string | null;
	/** 选卡。 */
	readonly onSelect: (cardId: string | null) => void;
	/** 预览里的假回执（没有服务端）。 */
	readonly onSay: (message: string) => void;
}

/**
 * 造一份完整的 `WorkspaceProps`。
 *
 * @param options 选中卡 + 回调
 */
export function mockWorkspaceProps(options: MockWorkspaceOptions): WorkspaceProps {
	const say = options.onSay;

	return {
		workspaces: WORKSPACES,
		currentId: 'default',
		viewingId: 'default',
		showArchived: false,
		cards: CARDS,
		templates: TEMPLATES,
		selectedId: options.selectedId,
		kindLabelOf: (kind) => KIND_LABELS[kind] ?? kind,
		aiUnreadCount: 1,
		aiUpdatedCount: 2,
		onView: (id) => {
			say(`切换视图：${id}（预览：不落库）`);
		},
		onActivate: (id) => {
			say(`「${id}」设为当前空间（预览：不落库）`);
		},
		onToggleArchived: (id) => {
			say(`切换「${id}」归档态（预览：不落库）`);
		},
		onToggleShowArchived: () => {
			say('切换「显示已归档」（预览：S 状态没接）');
		},
		onCreateWorkspace: () => {
			say('新建任务板（预览：没有服务端）');
		},
		onSelect: options.onSelect,
		onCreateCard: () => {
			say('打开建卡页（预览：入口没接）');
		},
		onFilterChange: (id: string, next: Picked) => {
			say(`筛选 ${id} → ${next.length === 0 ? '（清空）' : next.join(' / ')}`);
		},
		onSearchChange: () => {
			say('搜索（预览：过滤在本组件内已生效）');
		},
		onAction: (cardId: string, action: ButtonAction) => {
			say(`状态转移 ${cardId} →「${action.label}」（预览：不发请求、不落库）`);
		},
		onAddRelation: (cardId: string) => {
			say(`打开 ${cardId} 的关系浮层（关系区还没做）`);
		},
		onDerive: (cardId: string) => {
			say(`从 ${cardId} 派生子任务（预览：入口没接）`);
		},
		onNoteChange: (cardId: string) => {
			say(`备注已提交 ${cardId}（预览：不落库）`);
		},
		onOpenPermission: () => {
			say('权限与约定面板（另一个任务里做）');
		},
	};
}
