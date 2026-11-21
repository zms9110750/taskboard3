/**
 * 按名字查找的注册表 + 宿主过滤。
 *
 * 用户裁决：「#9 仅在 DSH 中」。工具定义上标 `hosts: ['dsh']`，
 * 由宿主用 `createTaskboardToolRegistry(tools, { host })` 过滤 —— 工具层不认识「宿主是谁」。
 */

import type {
	TaskboardTool,
	TaskboardToolContext,
	TaskboardToolRegistry,
	TaskboardToolRegistryOptions,
	TaskboardToolResult,
	ToolHost,
} from './types.ts';

/** 过滤出某宿主可用的工具。 */
export function toolsForHost(tools: readonly TaskboardTool[], host: ToolHost): readonly TaskboardTool[] {
	return tools.filter((tool) => tool.hosts === undefined || tool.hosts.includes(host));
}

/**
 * 建注册表。
 *
 * @throws 名字重复（接线错误：同一实例两个同名 handler，派发结果取决于插入顺序）
 */
export function createTaskboardToolRegistry(
	tools: readonly TaskboardTool[],
	options: TaskboardToolRegistryOptions = {},
): TaskboardToolRegistry {
	const allByName = new Map<string, TaskboardTool>();
	for (const tool of tools) {
		if (allByName.has(tool.name)) {
			throw new Error(`重复的工具名：「${tool.name}」—— 同一任务板实例只能注册一次。`);
		}
		allByName.set(tool.name, tool);
	}

	const visible = options.host === undefined ? [...tools] : toolsForHost(tools, options.host);
	const byName = new Map<string, TaskboardTool>();
	for (const tool of visible) byName.set(tool.name, tool);

	const frozenTools = Object.freeze([...visible]);
	const names = Object.freeze([...byName.keys()]);

	return Object.freeze({
		tools: frozenTools,
		names,
		get(name: string): TaskboardTool | undefined {
			return byName.get(name);
		},
		has(name: string): boolean {
			return byName.has(name);
		},
		async invoke(
			name: string,
			args: unknown = {},
			ctx: TaskboardToolContext = {},
		): Promise<TaskboardToolResult> {
			const tool = byName.get(name);
			if (tool === undefined) {
				const hint =
					options.host === undefined
						? ''
						: `（当前宿主 ${options.host} 不可见；它可能只存在于 ${[
								...new Set(
									tools
										.filter((one) => allByName.get(one.name)?.name === name)
										.flatMap((one) => one.hosts ?? []),
								),
							].join('/') || '其它宿主'}）`;
				throw new Error(
					`未知工具「${name}」。已注册（当前宿主可见）：${names.join('、')}。${hint}这是宿主接线错误，不是模型参数问题。`,
				);
			}
			return tool.handler(args, ctx);
		},
	});
}
