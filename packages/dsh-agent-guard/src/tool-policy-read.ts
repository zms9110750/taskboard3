/**
 * #9b 读工具权限（**仅 DSH**）—— 用户 2026-11-22：
 *
 * > 「那就再加一个 tool 用来读。」
 *
 * ## 为什么需要它
 *
 * `taskboard_tool_policy` 只有写（并集 / 交集），AI 改之前不知道现在是什么。
 * 这就是审计里的「只能盲改」—— 现在补上读。
 *
 * ## 和写的分工
 *
 * · **读**（本工具）：无门槛，只看得到。
 * · **写**（`taskboard_tool_policy`）：有 `canManageToolPolicies` 门槛。
 */

import {
	defineTool,
	okText,
	str,
	type TaskboardToolHandler,
	type ToolDeps,
} from '@taskboard/tools';

/**
 * 一串增量工具名的可读文本。
 *
 * @param names 增量集合（`ToolPolicyDelta` 就是 `readonly string[]`）
 */
function deltaText(names: readonly string[]): string {
	return names.length === 0 ? '（空）' : names.join('、');
}

/**
 * 造「读工具权限」工具。
 *
 * @param deps 依赖
 */
export function createToolPolicyReadTool(deps: ToolDeps): ReturnType<typeof defineTool> {
	const { taskboard } = deps;

	const handler: TaskboardToolHandler = async (args) => {
		const templateRef = str(args, 'templateRef');
		const store = taskboard.getToolPolicies();

		const lines: string[] = [];
		lines.push('【当前工具权限（只存增量，BASE 恒可用）】');
		lines.push(`· 未领取档（unclaimed）：${deltaText(store.unclaimed)}`);
		lines.push(`· 通用档（common）：${deltaText(store.common)}`);

		const groupNames = Object.keys(store.groups);
		if (groupNames.length === 0) {
			lines.push('· 组档：无');
		} else {
			lines.push('· 组档：');
			for (const name of groupNames) {
				const members = store.groupMembers[name] ?? [];
				const delta = store.groups[name] ?? [];
				lines.push(`    ${name}（成员：${members.length === 0 ? '无' : members.join('、')}）：${deltaText(delta)}`);
			}
		}

		const templateNames = Object.keys(store.templates);
		if (templateNames.length === 0) {
			lines.push('· 独立档（按模板）：无');
		} else {
			lines.push('· 独立档（按模板）：');
			for (const name of templateNames) {
				lines.push(`    ${name}：${deltaText(store.templates[name] ?? [])}`);
			}
		}

		if (templateRef !== undefined && templateRef !== '') {
			const effective = taskboard.effectiveToolsOf(templateRef);
			lines.push('');
			lines.push(`【模板 ${templateRef} 的生效工具集（BASE ∪ common ∪ 命中的组 ∪ 独立档）】`);
			lines.push(effective.length === 0 ? '（空）' : effective.join('、'));
		}

		lines.push('');
		lines.push('【说明】BASE 任务板工具是硬底线，不能被档位移除 —— 释放永远允许、领取后能转态。');
		lines.push('要修改请用 taskboard_tool_policy（需要 agent 侧权限开关已启用）。');

		return okText(lines.join('\n'));
	};

	return defineTool({
		name: 'taskboard_tool_policy_read',
		description:
			'读取当前任务板的工具权限设置（未领取档 / 通用档 / 组档 / 独立档 + BASE 恒可用）。' +
			'给 templateRef 时额外返回该模板的生效工具集。只读，不会修改任何东西。',
		hosts: ['dsh'],
		inputSchema: {
			type: 'object',
			properties: {
				templateRef: {
					type: 'string',
					description: '可选。给了就额外返回这个模板的生效工具集。',
				},
			},
			additionalProperties: false,
		},
		handler,
	});
}
