/**
 * #9 工具权限（**仅 DSH**）。
 *
 * 用户要求：
 * > 设置未领取卡 / 领取了工作卡 / 一个指定工作模板，允许的工具调用。
 * > 参数：档位（枚举：未领取卡 / 领取卡）、工作模板（与档位互斥）、
 * > 允许的工具数组（与原有取并集）、移除的工具数组（与原有取交集）。
 *
 * 用户后续裁决 #10：
 * > #9 就是在 agent 侧权限开关的启用后才能通过。
 *
 * 用户裁决 #6：
 * > 权限只匹配 tool 名字，不匹配重载和参数。AI 天然知道自己的 tool，不需要工具列出。
 *
 * ## 宿主表达
 *
 * · 工具定义上标 `hosts: ['dsh']` ⇒ MCP 适配层过滤掉它（用户：「仅在 DSH 中才有」）；
 * · 「agent 侧权限开关」由宿主通过 `ctx.canManageToolPolicies` 传进来。
 *   没启用 ⇒ 明确失败（不是静默跳过）。**本工具不自己判断宿主是谁** ——
 *   它只回答「开关开了没有」这一个事实。
 *
 * ## 语义（用户原话的算术）
 *
 * ```
 * next = (current ∪ allow) \ (current ∩ remove)
 * ```
 *
 * remove 只对已存在的名字生效（这就是「取交集」）；同时出现在 allow/remove
 * 里的名字 **remove 优先**（一次调用里「移除」比「添加」更不可逆，应该赢）。
 */

import {
	defineTool,
	failureResult,
	hostFailure,
	inputFailure,
	okText,
	str,
	strs,
	type TaskboardToolHandler,
	type ToolDeps,
} from '@taskboard/tools';

/** 把外部传入的 `tier` 收窄成档位字面量（与 `inputSchema` 的 `enum` 一致）。 */
function parseTier(value: string): 'unclaimed' | 'claimed' | undefined {
	return value === 'unclaimed' || value === 'claimed' ? value : undefined;
}

export function createToolPolicyTool(deps: ToolDeps): ReturnType<typeof defineTool> {
	const { taskboard } = deps;

	const handler: TaskboardToolHandler = async (args, ctx) => {
		/* ── 门槛：agent 侧权限开关 ── */
		if (ctx.canManageToolPolicies !== true) {
			return hostFailure(
				'agent 侧权限开关未启用，不能通过本工具修改工具权限。',
				'让宿主 / 用户启用「允许编辑工具权限」后再调；本工具仅在 DSH 且开关启用时可用。',
			);
		}

		const rawTier = str(args, 'tier');
		const templateRef = str(args, 'templateRef');
		const hasTier = rawTier !== undefined;
		const hasTemplate = templateRef !== undefined;
		if (hasTier === hasTemplate) {
			return inputFailure(
				'`tier`（档位）与 `templateRef`（工作模板）必须**二选一**（正好给一个）。',
				'给 tier=unclaimed/claimed，或给 templateRef=模板 ref，但不要两个都给。',
			);
		}
		/*
		 * ⚠ 不用 `tier as 'unclaimed' | 'claimed'`（AGENTS 3.1）：`string` 不是字面量联合，
		 *   靠 `!==` 排除法收窄不出来 ⇒ 让解析函数直接返回收窄后的字面量（校验与收窄一次完成）。
		 */
		const tier = rawTier === undefined ? undefined : parseTier(rawTier);
		if (hasTier && tier === undefined) {
			return inputFailure(`tier 只能是 unclaimed（未领取卡）/ claimed（领取了工作卡）；收到「${rawTier}」。`);
		}

		const allow = strs(args, 'allow') ?? [];
		const remove = strs(args, 'remove') ?? [];

		const result = await taskboard.setToolPolicyScope({
			...(tier !== undefined ? { tier } : {}),
			...(hasTemplate ? { templateRef } : {}),
			allow,
			remove,
		});
		if (!result.ok) {
			return failureResult(result, {
				action: '改工具权限失败',
				next:
					result.code === 'TEMPLATE_NOT_FOUND'
						? '先用 taskboard_definitions（type=template）确认模板 ref。'
						: '检查 tier / templateRef 与数组参数后重试。',
			});
		}

		const change = result.change;
		const scopeText =
			change.scope === 'template'
				? `模板「${change.templateRef ?? ''}」的额外权限`
				: change.scope === 'unclaimed'
					? '未领取卡（unclaimed）的额外权限'
					: '领取了工作卡（claimed）的额外权限';
		const lines: string[] = [];
		lines.push(`已更新：${scopeText}`);
		lines.push(`配置（不含 BASE）：${change.configured.length === 0 ? '（空）' : change.configured.join('、')}`);
		if (change.added.length > 0) lines.push(`本次新增：${change.added.join('、')}`);
		if (change.removed.length > 0) lines.push(`本次移除：${change.removed.join('、')}`);
		if (change.ignoredRemovals.length > 0) {
			lines.push(`忽略（原本就不在配置里，幂等）：${change.ignoredRemovals.join('、')}`);
		}
		if (change.protectedRemovals.length > 0) {
			lines.push(
				`受保护未移除（BASE 基础工具，硬底线）：${change.protectedRemovals.join('、')}`,
				'（基础任务板工具恒可用：放手、转移、建卡这些不能被权限档移除，否则 AI 会把自己锁死。）',
			);
		}
		if (change.alreadyBase.length > 0) {
			lines.push(`无需添加（已在 BASE 恒可用）：${change.alreadyBase.join('、')}`);
		}
		lines.push(
			'',
			'生效口径：未领取卡 = BASE ∪ unclaimed；持有工作卡 = BASE ∪ unclaimed ∪ claimed；指定模板 = 上述 ∪ 模板配置。',
		);
		return okText(lines.join('\n'));
	};

	return defineTool({
		name: 'taskboard_tool_policy',
		description:
			'设置「未领取卡 / 领取了工作卡 / 指定工作模板」允许的额外工具（仅 DSH；需要 agent 侧权限开关启用）。' +
			'`tier` 与 `templateRef` 二选一：tier=unclaimed（未领取卡）/ claimed（领取了工作卡）；templateRef=一个工作模板。' +
			'`allow` 与原有配置取并集；`remove` 与原有配置取交集（只移除已存在的；同时出现在两者里的名字以 remove 为准）。' +
			'BASE 基础任务板工具是硬底线，不能被移除（会明确列出来）。',
		inputSchema: {
			/*
			 * 这里**故意不写** `additionalProperties`：DSH 适配层的 `toDshSchema`
			 * （`@taskboard/dsh-tools` 的 `src/tools.ts`）对 `type: 'object'` 一律补
			 * `additionalProperties: false`（除非源 schema 显式给值）。写在这里等于
			 * 同一事实两份 —— DSH 要求显式是**适配层**的职责，由它一处保证。
			 */
			type: 'object',
			properties: {
				tier: {
					type: 'string',
					enum: ['unclaimed', 'claimed'],
					description: '档位：unclaimed=未领取卡；claimed=领取了工作卡。与 templateRef 二选一。',
				},
				templateRef: {
					type: 'string',
					description: '工作模板 ref（只对这个模板生效）。与 tier 二选一。',
				},
				allow: {
					type: 'array',
					items: { type: 'string' },
					description: '要允许的工具名数组（与原有配置取并集）。',
				},
				remove: {
					type: 'array',
					items: { type: 'string' },
					description: '要移除的工具名数组（与原有配置取交集，只移除已存在的）。',
				},
			},
		},
		hosts: ['dsh'],
		handler,
	});
}
