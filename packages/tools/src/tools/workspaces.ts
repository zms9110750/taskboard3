/**
 * #1 列出空间。
 *
 * 用户要求：
 * > 列出有多少个空间和他们有多少个卡。一个 bool 参数选择是否列出归档。
 *
 * 用户后续裁决 #2：
 * > DSH 侧的 tool 额外列出当前激活空间（激活空间的可观测性由 DSH 侧补，不进通用包）。
 *
 * ⇒ 通用实现只在**宿主通过 ctx 给了** `activeWorkspaceId` 时多回一行。
 *   「激活空间」这个概念不写进工具语义，只是宿主告诉我「当前是哪个」。
 */

import { okText } from '../schema.ts';
import { boolOf } from '../context.ts';
import type { TaskboardToolHandler } from '../types.ts';
import { defineTool, type ToolDeps } from './shared.ts';

export function createWorkspacesTool(deps: ToolDeps): ReturnType<typeof defineTool> {
	const { taskboard } = deps;
	const handler: TaskboardToolHandler = async (args, ctx) => {
		const includeArchived = boolOf(args, 'includeArchived') === true;
		const list = taskboard.listWorkspaces(includeArchived);
		const lines: string[] = [];
		if (list.length === 0) {
			lines.push('没有任何工作空间。空间需要由宿主 / 用户创建；本工具只负责列出。');
		} else {
			lines.push(`工作空间（${list.length} 个）：`);
			for (const workspace of list) {
				const count = taskboard.list(workspace.id).length;
				lines.push(
					`  ${workspace.id}  ${workspace.displayName}${workspace.archived ? '（已归档）' : ''}  ${count} 张卡`,
				);
			}
			if (includeArchived === false) lines.push('（归档的空间已隐藏；要包含它们把 includeArchived 设为 true。）');
		}
		/* 用户 2026-11-22：取消「激活空间」设定 ⇒ 不再回显这一行。 */
		/* 无归档空间时不必多一行；保持输出紧凑。 */
		const archivedCount = taskboard.listWorkspaces(true).filter((one) => one.archived).length;
		if (includeArchived === true && archivedCount > 0) lines.push(`其中已归档：${archivedCount} 个`);

		return okText(lines.join('\n').replace(/\n{3,}/gu, '\n\n'));
	};

	return defineTool({
		name: 'taskboard_workspaces',
		description:
			'列任务板的工作空间（容器）以及每个空间有多少张卡。includeArchived=true 时包含已归档空间。' +
			'每个工具调用都必须显式给 workspaceId（没有「激活空间」默认值）。',
		inputSchema: {
			type: 'object',
			properties: {
				includeArchived: {
					type: 'boolean',
					description: '是否包含已归档的空间。省略 = 不包含。',
				},
			},
		},
		handler,
	});
}