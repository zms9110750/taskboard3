/**
 * 「看原始卡」—— 用户后续裁决 #5：
 * > 新增「看原始卡」工具 —— 用这个确认卡的原始 JSON，再改卡。
 *
 * 用户裁决 #7 定义了「原始 JSON」的形状：
 * > 查看 JSON，自然是看模板内的 JSON。模板的架构就是 key，表示章节。
 * > 然后里面就是 action。
 *
 * ⇒ 返回**纯 JSON 文本**：`{ [sectionKey]: actionPayload }`，不夹一句人话。
 *   这是刻意的：AI 拿到后可以直接照抄 key 拼 `taskboard_update` 的 JSON 路径，
 *   夹正文会增加它「照抄时把正文也抄进路径」的概率。
 *
 * 与 #3 的分工：`taskboard_card` 给**视图**（理解内容），本工具给**结构**
 * （改内容前确认路径）。
 */

import { contentOfCard } from '@taskboard/core';

import { resolveWorkspace, str } from '../context.ts';
import { failureResult, inputFailure } from '../failure.ts';
import { jsonText } from '../render.ts';
import { okText } from '../schema.ts';
import type { TaskboardToolHandler } from '../types.ts';
import { defineTool, type ToolDeps } from './shared.ts';

export function createRawCardTool(deps: ToolDeps): ReturnType<typeof defineTool> {
	const { taskboard } = deps;

	const handler: TaskboardToolHandler = async (args, ctx) => {
		const resolved = await resolveWorkspace(args, ctx);
		if (!resolved.ok) return resolved.result;
		const cardId = str(args, 'id');
		if (cardId === undefined) {
			return inputFailure('必须给卡编号（id）。', '先调 taskboard_cards 拿编号。');
		}

		const found = taskboard.get(resolved.workspaceId, cardId);
		if (!found.ok) return failureResult(found, { action: '查看原始卡失败' });

		/* 纯 JSON：key = 章节 id，value = action payload。 */
		return okText(jsonText(contentOfCard(found.card)));
	};

	return defineTool({
		name: 'taskboard_raw_card',
		description:
			'查看一张卡的**原始 JSON**：`{ [章节key]: action payload }`（只含模板内 JSON，不含标题/状态/关系等元数据）。' +
			'改卡之前用它确认结构与 key，再调 taskboard_update 用 JSON 路径替换。按编号直查，草稿/已删除也能看。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: {
					type: 'string',
					description: '空间 id。省略 = 宿主激活空间（DSH）；MCP 等没有该行为的宿主会报错。',
				},
				id: { type: 'string', description: '卡编号（如 W1）。必填。' },
			},
			required: ['id'],
		},
		handler,
	});
}
