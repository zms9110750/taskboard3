/**
 * 工具实现的共享零件。
 */

import type { Taskboard } from '@taskboard/core';

import { renderAdvice } from '../render.ts';
import type { JsonObjectSchema, TaskboardTool } from '../types.ts';
import { freezeSchema } from '../schema.ts';

/** 每个工具工厂的依赖（只含任务板实例）。 */
export interface ToolDeps {
	readonly taskboard: Taskboard;
}

/** 列表分页大小（#2 `page` 参数）。 */
export const CARDS_PAGE_SIZE = 100;

/**
 * 「当前状态 + 在这个分类下接下来可以做什么」的回执段（#6 / #7 改完后共用）。
 *
 * 用户第二轮原话：
 * > 卡的状态用查看卡去看。在这里改完了以后，输出现在的状态和这个状态在这个分类下，
 * > 接下来可以做什么。
 *
 * 直接复用 `transitionAdvice`：状态/分类/目标/条件都从 core 来，工具层不重写规则。
 */
export async function stateAndNextText(
	deps: ToolDeps,
	workspaceId: string,
	cardId: string,
	holder: string | undefined,
): Promise<string> {
	const advice = deps.taskboard.transitionAdvice(workspaceId, cardId, holder ?? '');
	const body = 'targets' in advice ? renderAdvice(advice, holder) : `（查询当前状态/下一步失败：${advice.message}）`;
	return ['—— 当前状态与接下来可以做什么 ——', body].join('\n');
}

/** 结构化地建一个工具（顺手深冻结 inputSchema）。 */
export function defineTool(definition: {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: JsonObjectSchema;
	readonly handler: TaskboardTool['handler'];
	readonly hosts?: TaskboardTool['hosts'];
}): TaskboardTool {
	return Object.freeze({
		name: definition.name,
		description: definition.description,
		inputSchema: freezeSchema(definition.inputSchema),
		handler: definition.handler,
		...(definition.hosts === undefined ? {} : { hosts: definition.hosts }),
	});
}
