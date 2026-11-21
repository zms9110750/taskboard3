/**
 * 工具实现的共享零件。
 */

import type { Taskboard } from '@taskboard/core';

import type { JsonObjectSchema, TaskboardTool } from '../types.ts';
import { freezeSchema } from '../schema.ts';

/** 每个工具工厂的依赖（只含任务板实例）。 */
export interface ToolDeps {
	readonly taskboard: Taskboard;
}

/** 列表分页大小（#2 `page` 参数）。 */
export const CARDS_PAGE_SIZE = 20;

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
