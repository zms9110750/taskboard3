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
		// TODO(审查): 两件事要一起改：
		// ① hint 里 `allByName.get(one.name)?.name === name` 因名字唯一恒等于 `one.name === name`，
		//    等于 O(n) 扫全表找 1 个元素 —— 直接 `const hidden = allByName.get(name)` 即可。可直接改。
		// ② 现在的文案「可能只存在于 其它宿主」已经是**错的**：那两个名字在 taskboard_tool_policy 场景下
		//    是搬到 dsh-agent-guard 了，不是「别的宿主」；hosts 也已无人使用（见 types.ts 的 TODO）。需用户决定措辞。
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
