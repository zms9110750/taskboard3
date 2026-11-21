/**
 * #6 更新卡（JSON 路径替换）。
 *
 * 用户要求：
 * > 参数为一个编号、一个空间、一个 JSON 路径、一个 JSON object。
 * > **JSON 路径之后的全部内容被这个 object 覆盖掉（替换语义，不是合并）。**
 *
 * 用户后续裁决 #7 / #8：
 * > 查看 JSON，自然是看模板内的 JSON。模板的架构就是 key，表示章节。然后里面就是 action。
 * > 覆盖是替换。所以要描述路径。
 * > 更新以后返回更新合并以后的 JSON 结果。
 *
 * ## 路径
 *
 * JSON Pointer（RFC 6901）：`''` = 整个内容对象；`/章节/字段` 逐层；
 * 数组末尾 `-` = 追加。首段可以用章节 **label**（定义里给人看的那个名字），
 * core 会归一成 sectionId。
 *
 * ## 为什么替换语义要求先看原始结构
 *
 * 替换不是合并：路径指到哪，那一整段就没了。所以工具描述强制要求
 * **先 `taskboard_raw_card` 看 JSON**，再拼路径；失败时也会把这句话再说一遍。
 *
 * ## 返回
 *
 * 用户裁决 #12：更新以后返回**合并后的完整 JSON**（不是一句话）。
 * ⇒ 成功时 text 就是 `{ [sectionKey]: payload }` 的 JSON（可直接用于下一次拼路径）。
 */

import { resolveWorkspace, rawOf } from '../context.ts';
import { failureResult, inputFailure } from '../failure.ts';
import { jsonText } from '../render.ts';
import { okText } from '../schema.ts';
import type { TaskboardToolHandler } from '../types.ts';
import { defineTool, type ToolDeps } from './shared.ts';

export function createUpdateTool(deps: ToolDeps): ReturnType<typeof defineTool> {
	const { taskboard } = deps;

	const handler: TaskboardToolHandler = async (args, ctx) => {
		const resolved = await resolveWorkspace(args, ctx);
		if (!resolved.ok) return resolved.result;
		const workspaceId = resolved.workspaceId;

		const cardId = strArg(args, 'id');
		if (cardId === undefined) return inputFailure('必须给卡编号（id）。', '先调 taskboard_cards 拿编号。');

		/* path 允许空串（= 整个内容对象），所以不能复用 `str`（它把空串当没给）。 */
		const path = stringField(args, 'path');
		if (path === undefined) {
			return inputFailure(
				'必须给 path（JSON 路径）。空串表示替换整个内容对象，写法示例：/章节id/字段 或 /章节label/字段。',
				'先用 taskboard_raw_card 看当前 JSON，再拼路径。',
			);
		}
		if (!Object.hasOwn(args as Record<string, unknown>, 'value')) {
			return inputFailure(
				'必须给 value（替换后的 JSON 值）。',
				'value 是「路径那一整段替换成什么」；要清空字段给 null（是否合法由模板校验决定）。',
			);
		}

		const updated = await taskboard.replaceContentAt(
			workspaceId,
			cardId,
			path,
			rawOf(args, 'value'),
			'ai',
		);
		if (!updated.ok) {
			return failureResult(updated, {
				action: '更新卡失败',
				next: nextForUpdateFailure(updated.code),
			});
		}

		/* 用户裁决 #12：返回合并后的完整 JSON。 */
		return okText(jsonText(updated.content));
	};

	return defineTool({
		name: 'taskboard_update',
		description:
			'按 JSON 路径替换一张卡的内容（**替换语义，不是合并**：路径之后整段换成你给的 value）。' +
			'卡的原始结构是 `{ [章节key]: action payload }`（只含模板内 JSON，不含标题/状态/关系/备注）。' +
			'**先调 taskboard_raw_card 看当前 JSON 与 key，再拼路径**。' +
			'path 用 JSON Pointer：空串=整个内容对象；`/章节/字段` 逐层；数组末尾 `-`=追加。首段可用章节 label 或 id。' +
			'成功返回合并后的完整 JSON。空间省略 = 宿主激活空间（DSH）；MCP 等没有该行为的宿主会报错。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: {
					type: 'string',
					description: '空间 id。省略 = 宿主激活空间（DSH）；MCP 等没有该行为的宿主会报错。',
				},
				id: { type: 'string', description: '卡编号（如 W1）。必填。' },
				path: {
					type: 'string',
					description: 'JSON 路径：空串=整个内容对象；`/章节id/字段`；数组末尾 `-`=追加。',
				},
				value: {
					description:
						'替换后的 JSON 值（任意 JSON：对象/数组/字符串/数字/布尔/null）。替换语义 —— 路径那一整段会被它整体取代。',
				},
			},
			required: ['id', 'path', 'value'],
		},
		handler,
	});
}

/** 读一个必须存在、但允许空串的字符串字段。 */
function stringField(args: unknown, key: string): string | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === 'string' ? value : undefined;
}

/** 读必须存在的字符串字段（空串视为没给）。 */
function strArg(args: unknown, key: string): string | undefined {
	const value = stringField(args, key);
	return value === undefined || value === '' ? undefined : value;
}

/** 更新失败的下一步。 */
function nextForUpdateFailure(code: string): string {
	switch (code) {
		case 'CONTENT_INVALID':
			return '先用 taskboard_raw_card 看当前 JSON 与字段；path 要指向已存在的中间路径，value 要符合该章节 action 的形状。';
		case 'FIELD_REQUIRED':
			return 'path 不是合法 JSON Pointer（检查 ~ 转义）；空串表示替换整个内容对象。';
		case 'CARD_NOT_FOUND':
			return '先用 taskboard_cards 确认编号（按 id 直查可见墓碑，但墓碑不能更新）。';
		default:
			return '先看当前 JSON（taskboard_raw_card）再重试。';
	}
}
