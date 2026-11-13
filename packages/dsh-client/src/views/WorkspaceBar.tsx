/**
 * 顶部栏 —— 空间切换下拉 + 刷新 + 新建空间。
 *
 * ## 空间切换是**本 UI 的显示状态**
 *
 * 用户 `2026-11-13`：「整个激活都只对 dsh 会话有效。」「不应该存在全局默认的垃圾堆。」
 * ⇒ 这个下拉**不写任何"默认空间"**，只改本页面显示哪个空间。
 */

import type { ReactNode } from 'react';

import { activeWorkspaces } from '../pure.ts';
import { CLS } from '../styles.ts';
import type { Workspace } from '../types.ts';

/** 顶部栏属性。 */
export interface WorkspaceBarProps {
	readonly workspaces: readonly Workspace[];
	readonly workspaceId: string;
	readonly disabled: boolean;
	readonly onSwitch: (workspaceId: string) => void;
	readonly onReload: () => void;
	readonly onCreate: () => void;
}

/**
 * 顶部栏。
 *
 * @param props 空间清单与回调
 */
export function WorkspaceBar(props: WorkspaceBarProps): ReactNode {
	const visible = activeWorkspaces(props.workspaces);
	return (
		<div className={CLS.topbar}>
			<select
				className={CLS.select}
				value={props.workspaceId}
				disabled={props.disabled || visible.length === 0}
				onChange={(event) => props.onSwitch(event.target.value)}
				title="切换显示的工作空间"
			>
				{visible.length === 0 ? <option value="">（没有空间）</option> : null}
				{visible.map((workspace) => (
					<option key={workspace.id} value={workspace.id}>
						{workspace.displayName}
					</option>
				))}
			</select>
			<button type="button" className={CLS.btn} disabled={props.disabled} onClick={props.onReload} title="重新加载">
				刷新
			</button>
			<button type="button" className={CLS.btn} disabled={props.disabled} onClick={props.onCreate} title="新建工作空间">
				＋
			</button>
		</div>
	);
}
