/**
 * #7 更新备注。
 *
 * 用户要求：
 * > 参数为一个编号、一个空间、和一个字符串。空间为空时行为未定义。
 *
 * 语义：传空串 = 清空备注（与 core `update` 的 note patch 一致）。
 */

import { resolveWorkspace } from '../context.ts';
import { failureResult, inputFailure } from '../failure.ts';
import { okText } from '../schema.ts';
import type { TaskboardToolHandler } from '../types.ts';
import { defineTool, type ToolDeps } from './shared.ts';

export function createUpdateNoteTool(deps: ToolDeps): ReturnType<typeof defineTool> {
	const { taskboard } = deps;

	const handler: TaskboardToolHandler = async (args, ctx) => {
		const resolved = await resolveWorkspace(args, ctx);
		if (!resolved.ok) return resolved.result;

		const cardId = readString(args, 'id');
		if (cardId === undefined || cardId === '') {
			return inputFailure('必须给卡编号（id）。', '先调 taskboard_cards 拿编号。');
		}
		const note = readString(args, 'note');
		if (note === undefined) {
			return inputFailure('必须给 note 字符串（空串 = 清空备注）。', '补上 note 后重试。');
		}

		const updated = await taskboard.update(resolved.workspaceId, cardId, { note }, 'ai');
		if (!updated.ok) return failureResult(updated, { action: '更新备注失败' });

		return okText(
			note === ''
				? `已清空 ${updated.card.id} 的备注。`
				: `已更新 ${updated.card.id} 的备注（${note.length} 字）。`,
		);
	};

	return defineTool({
		name: 'taskboard_update_note',
		description:
			'更新一张卡的备注（追加型文本，不随采纳清空）。给空串 = 清空备注。' +
			'空间省略 = 宿主激活空间（DSH）；MCP 等没有该行为的宿主会报错。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: {
					type: 'string',
					description: '空间 id。省略 = 宿主激活空间（DSH）；MCP 等没有该行为的宿主会报错。',
				},
				id: { type: 'string', description: '卡编号（如 W1）。必填。' },
				note: { type: 'string', description: '新备注内容；空串 = 清空。' },
			},
			required: ['id', 'note'],
		},
		handler,
	});
}

/** 读一个允许空串的字符串字段。 */
function readString(args: unknown, key: string): string | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === 'string' ? value : undefined;
}
