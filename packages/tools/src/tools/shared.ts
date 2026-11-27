/**
 * 工具实现的共享零件。
 */

import type { Taskboard } from '@taskboard/core';

import { adviceOf } from '../context.ts';
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
 * `workspaceId` 的 schema 描述（7 个需要空间的工具共用）。
 *
 * 用户 `2026-11-22` 取消了「激活空间」设定 ⇒ `context.resolveWorkspace` 对缺 `workspaceId`
 * **一律报错**。所以这里只能写「必填」，不能复制旧文案「省略 = 宿主激活空间」
 * （那是旧世界的谎话：模型会照着省略参数，然后吃一个它没预料到的失败）。
 */
export const WORKSPACE_ID_DESCRIPTION =
	'空间 id。**必填** —— 每个工具调用都必须显式给 workspaceId（没有「激活空间」默认值）；先调 taskboard_workspaces 拿 id。';

/**
 * 工具描述末尾那句「必填」声明（同样 7 个工具共用，与 `WORKSPACE_ID_DESCRIPTION` 一处维护）。
 *
 * 口径以 `tools/workspaces.ts` 的「每个工具调用都必须显式给 workspaceId」为准。
 */
export const WORKSPACE_ID_REQUIRED_NOTE =
	'每次调用都必须显式给 workspaceId（没有「激活空间」默认值）：先调 taskboard_workspaces 拿空间 id。';

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
	const read = adviceOf(deps.taskboard, workspaceId, cardId, holder);
	const body = read.ok ? renderAdvice(read.advice, holder) : `（查询当前状态/下一步失败：${read.failure.message}）`;
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
