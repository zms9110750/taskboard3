/**
 * 按名字查找的注册表。
 *
 * ## 为什么需要它
 *
 * MCP 与 DSH 派发工具时都只有**名字**（模型给出的 tool call 只有 name +
 * arguments）。宿主两侧的注册 API 不同，但「名字 → handler」这一步是共同的：
 *
 * · DSH：`ctx.tools.register({ name, ... })` 后由 `dsh-tools` 按名字派发；
 * · MCP：`server.setRequestHandler(CallToolRequest)` 里按 `request.params.name` 派发。
 *
 * ⇒ 本包提供一个不可变注册表，宿主直接用它派发，不必在各自入口里再写一遍
 *   `find` / `Map` / 「找不到怎么办」。
 */

import type {
	TaskboardTool,
	TaskboardToolContext,
	TaskboardToolRegistry,
	TaskboardToolResult,
} from './types.ts';

/**
 * 用一组工具建注册表。
 *
 * @throws 名字重复 —— 重复注册是**接线错误**，必须当场暴露：
 *   否则同一个名字有两个 handler，派发到哪个取决于 Map 的插入顺序，
 *   表现是「同一次调用有时行为不同」。
 */
export function createTaskboardToolRegistry(tools: readonly TaskboardTool[]): TaskboardToolRegistry {
	const byName = new Map<string, TaskboardTool>();
	for (const tool of tools) {
		if (byName.has(tool.name)) {
			throw new Error(`重复的工具名：「${tool.name}」—— 同一任务板实例只能注册一次。`);
		}
		byName.set(tool.name, tool);
	}

	/* 快照冻结：注册表建好之后，外部的 push / sort 不能改变派发顺序。 */
	const frozenTools = Object.freeze([...tools]);
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
				/*
				 * ⚠ 抛而不是返回错误文本：宿主本该只派发注册过的工具，
				 *   走到这里说明**宿主接线错了**（或注册表与派发表不是同一份）。
				 *   静默返回「没有这个工具」会让接线 bug 变成一次「模型调错了」。
				 */
				throw new Error(
					`未知工具「${name}」。已注册：${names.join('、')}。这是宿主接线错误，不是模型参数问题。`,
				);
			}
			return tool.handler(args, ctx);
		},
	});
}
