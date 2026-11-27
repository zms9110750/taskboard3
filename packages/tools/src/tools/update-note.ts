/**
 * #7 更新备注 / 更新标题。
 *
 * 用户第一轮：
 * > 参数为一个编号、一个空间、和一个字符串。空间为空时行为未定义。
 *
 * 用户第二轮 ②：
 * > 改标题：并进「更新备注」那个工具；**但标题只有草稿期间可以改**。
 * > - `taskboard_update_note` 加一个 `title?` 参数（和 `note` 并列）
 * > - 非草稿改 title ⇒ 失败（原因 + 下一步）；只改 note 不受限制（任何状态都能改）
 * > - 两个参数至少给一个；都不给 ⇒ 失败
 *
 * 用户第二轮 ③：
 * > 改完以后输出「现在的状态」+「这个状态在这个分类下接下来可以做什么」。
 *
 * ## 为什么标题限制在草稿
 *
 * 标题是卡的对外标识（列表/关系/历史都靠它认卡）；采纳之后再改会让
 * 「用户看到的标题」和「AI 当时汇报的标题」漂移。草稿期还没进入流程，随便改。
 */

import { ErrorCode, TaskState, labelOf } from '@taskboard/protocol';

import { holderOf, readCard, resolveWorkspace, str, strAllowEmpty } from '../context.ts';
import { failureResult, inputFailure, toolFailure } from '../failure.ts';
import { okText } from '../schema.ts';
import type { TaskboardToolHandler } from '../types.ts';
import {
	defineTool,
	stateAndNextText,
	WORKSPACE_ID_DESCRIPTION,
	WORKSPACE_ID_REQUIRED_NOTE,
	type ToolDeps,
} from './shared.ts';

export function createUpdateNoteTool(deps: ToolDeps): ReturnType<typeof defineTool> {
	const { taskboard } = deps;

	const handler: TaskboardToolHandler = async (args, ctx) => {
		const resolved = await resolveWorkspace(args, ctx);
		if (!resolved.ok) return resolved.result;
		const workspaceId = resolved.workspaceId;

		const cardId = str(args, 'id');
		if (cardId === undefined) {
			return inputFailure('必须给卡编号（id）。', '先调 taskboard_cards 拿编号。');
		}

		const title = strAllowEmpty(args, 'title');
		const note = strAllowEmpty(args, 'note');
		if (title === undefined && note === undefined) {
			return inputFailure('至少给 title 或 note 之一。', '只改备注就传 note；只改标题就传 title（仅草稿期）。');
		}
		if (title !== undefined && title.trim() === '') {
			return inputFailure('title 不能为空；要清空请只改 note。', '给一个非空标题，或去掉 title 参数。');
		}

		/* ── 标题：只有草稿期可以改（先读卡拿状态，失败不写库） ── */
		const found = readCard(taskboard, workspaceId, cardId, '更新失败');
		if (!found.ok) return found.result;
		// TODO(审查): 「草稿」在本包有两个名字：这里用 TaskState.UNSPECIFIED，cards.ts 用 protocol 的 DRAFT ——
		// 若两者是同一值的别名，择一即可，免得以后改草稿语义时漏掉一处。可直接统一。
		if (title !== undefined && found.card.status !== TaskState.UNSPECIFIED) {
			const label = labelOf(found.card.status);
			return toolFailure(
				ErrorCode.TRANSITION_REJECTED,
				`只有草稿期可以改标题；这张卡现在是「${label}」，标题已定稿。`,
				{
					next: '标题只能在草稿期改。要改内容请用 taskboard_update；改备注不受状态限制（本工具只传 note）。',
					retryable: 'no',
				},
			);
		}

		const updated = await taskboard.update(
			workspaceId,
			cardId,
			{
				...(title === undefined ? {} : { title: title.trim() }),
				...(note === undefined ? {} : { note }),
			},
			'ai',
		);
		if (!updated.ok) return failureResult(updated, { action: '更新失败' });

		const lines: string[] = [];
		if (title !== undefined) lines.push(`已把标题从「${found.card.title}」改为「${updated.card.title}」。`);
		if (note !== undefined) {
			lines.push(note === '' ? `已清空 ${updated.card.id} 的备注。` : `已更新 ${updated.card.id} 的备注（${note.length} 字）。`);
		}
		lines.push('', await stateAndNextText(deps, workspaceId, cardId, holderOf(ctx)));
		return okText(lines.join('\n'));
	};

	return defineTool({
		name: 'taskboard_update_note',
		description:
			'更新一张卡的备注和/或标题。**两个参数至少给一个**：' +
			// TODO(审查): 描述说 note 是「追加型文本」，而实现（下方 taskboard.update）是**整段替换**、空串清空 ——
			// 「追加型」会让模型以为能续写。需用户定口径（改文案 or 改实现）。
			'`note`（追加型文本，任何状态都能改；空串 = 清空）；' +
			'`title`（卡标题，**只有草稿状态可以改**，非草稿会失败并说明原因）。' +
			'改完会返回当前状态，以及这个状态在这个分类下接下来可以做什么。' +
			WORKSPACE_ID_REQUIRED_NOTE,
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: {
					type: 'string',
					description: WORKSPACE_ID_DESCRIPTION,
				},
				id: { type: 'string', description: '卡编号（如 W1）。必填。' },
				note: { type: 'string', description: '新备注内容；空串 = 清空。任何状态都能改。' },
				title: { type: 'string', description: '新标题（非空）。只有草稿状态可以改。' },
			},
			required: ['workspaceId', 'id'],
		},
		handler,
	});
}
