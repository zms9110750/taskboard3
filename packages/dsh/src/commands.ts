/**
 * 斜杠命令。
 *
 * ## 适配，不做事
 *
 * 命令只读 core 的数据、拼一段文字。业务判断一律不在这一层。
 *
 * ## 默认空间是**入口策略**
 *
 * 用户裁定：「整个激活都只对 dsh 会话有效。mcp 是没法提供的。」
 * ⇒ 命令从注入的 `defaultWorkspaceId` 拿默认空间，core 不知道这件事。
 */

import type { Taskboard } from '@taskboard/core';
import { labelOf } from '@taskboard/protocol';

/** 命令注册器的窄形状。 */
export interface CommandRegistryLike {
	register(command: {
		name: string;
		description: string;
		input?: { readonly hint: string };
		recordInput?: boolean;
		handler(invocation: unknown): unknown;
	}): unknown;
}

/** 命令依赖。 */
export interface CommandDeps {
	readonly taskboard: Taskboard;
	readonly defaultWorkspaceId: () => Promise<string>;
}

/** `/taskboard` 的返回值形状（DSH 的命令协议）。 */
interface CommandResult {
	readonly kind: 'success' | 'error';
	readonly text: string;
}

/** 建命令并注册。 */
export function registerCommands(registry: CommandRegistryLike, deps: CommandDeps): void {
	registry.register({
		name: 'taskboard',
		description: '任务板概览：所有工作空间、当前空间的卡数、按状态分布',
		recordInput: false,
		async handler(): Promise<CommandResult> {
			const workspaces = deps.taskboard.listWorkspaces(true);
			if (workspaces.length === 0) {
				return { kind: 'success', text: '任务板还没有任何工作空间。' };
			}

			let current: string;
			try {
				current = await deps.defaultWorkspaceId();
			} catch {
				current = '';
			}

			const cards = current === '' ? [] : deps.taskboard.list(current);
			const byStatus = new Map<string, number>();
			for (const card of cards) {
				byStatus.set(card.status, (byStatus.get(card.status) ?? 0) + 1);
			}

			const lines: string[] = [`工作空间（${workspaces.length} 个）：`];
			for (const ws of workspaces) {
				const mark = ws.id === current ? '★' : ' ';
				const archived = ws.archived ? '（已归档）' : '';
				lines.push(` ${mark} ${ws.id}  ${ws.displayName}${archived}  ${deps.taskboard.list(ws.id).length} 张卡`);
			}

			lines.push('');
			lines.push(current === '' ? '当前空间：未确定' : `当前空间：${current}，共 ${cards.length} 张卡`);
			if (byStatus.size > 0) {
				for (const [status, count] of byStatus) {
					lines.push(`  · ${labelOf(status)}: ${count}`);
				}
			}

			return { kind: 'success', text: lines.join('\n') };
		},
	});
}
