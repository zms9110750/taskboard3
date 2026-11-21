/**
 * #8 转移状态（含采纳 / 领取 / 释放）。
 *
 * 用户要求：
 * > **采纳也是这个工具**（未指定 → 提交）。
 * > **领取也是这个工具**（提交 → 进行中，只能对工作卡领取）。
 * > **释放也是这个工具**（进行中 → 提交）。
 * > 参数为一个编号、一个空间、和一个字符串。
 * > 目标字符串为空时，展示接下来可转移的目标和条件目标。
 *
 * ## 一个字符串怎么区分三个动作
 *
 * 用户要的是「目标字符串」，不是「动作名」。⇒ 动作由
 * `(分类, 当前状态, 目标状态)` 在 protocol 的按钮表里查 —— 同一个目标
 * 「提交」在草稿上就是**采纳**、在处理中就是**释放**。
 *
 * ## 空目标 = 先问再动
 *
 * 直接执行前先调 core 的 `transitionAdvice` 拿到：
 * 目标清单、动作、AI 能不能做、不能做的原因（依赖 / 子任务 / 配额 / 只有用户能做）。
 * 目标不合法或条件不满足时，**不发写请求**，直接把原因回给模型。
 */

import type { TransitionAdvice } from '@taskboard/core';
import { CARD_ACTION_OPTIONS } from '@taskboard/core';
import { ErrorCode, STATE_LABELS, TASK_STATES, isTaskState, labelOf } from '@taskboard/protocol';

import { holderOf, resolveWorkspace } from '../context.ts';
import { failureResult, hostFailure, inputFailure, toolFailure } from '../failure.ts';
import { renderAdvice, stateText } from '../render.ts';
import { okText } from '../schema.ts';
import type { TaskboardToolHandler, TaskboardToolResult } from '../types.ts';
import type { CardActionDenied } from '@taskboard/core';
import { defineTool, type ToolDeps } from './shared.ts';

export function createTransitionTool(deps: ToolDeps): ReturnType<typeof defineTool> {
	const { taskboard } = deps;

	const handler: TaskboardToolHandler = async (args, ctx) => {
		const resolved = await resolveWorkspace(args, ctx);
		if (!resolved.ok) return resolved.result;
		const workspaceId = resolved.workspaceId;

		const cardId = readString(args, 'id');
		if (cardId === undefined || cardId === '') {
			return inputFailure('必须给卡编号（id）。', '先调 taskboard_cards 拿编号。');
		}
		const holder = holderOf(ctx);
		const rawTo = readString(args, 'to');

		/* ── 目标为空 ⇒ 只展示目标 + 条件，不执行 ── */
		if (rawTo === undefined || rawTo.trim() === '') {
			const advice = taskboard.transitionAdvice(workspaceId, cardId, holder ?? '');
			if (!('targets' in advice)) return failureResult(advice, { action: '查询可转移目标失败' });
			return okText(renderAdvice(advice, holder));
		}

		const to = resolveStateId(rawTo);
		if (to === undefined) {
			return inputFailure(
				`目标「${rawTo}」不是已知状态；可用：${TASK_STATES.map((state) => `${state}（${STATE_LABELS[state]}）`).join('、')}。`,
				'不传 to 调一次，会列出当前状态接下来可转移的目标。',
			);
		}

		const advice = taskboard.transitionAdvice(workspaceId, cardId, holder ?? '');
		if (!('targets' in advice)) return failureResult(advice, { action: '查询可转移目标失败' });

		/* 同状态 = 幂等 no-op（不是错误，明确告知未执行）。 */
		if (advice.status === to) {
			return okText(`卡 ${advice.cardId}「${advice.title}」已经是「${labelOf(to)}」状态，未执行转移。`);
		}

		const target = advice.targets.find((one) => one.to === to);
		if (target === undefined) {
			const available = advice.targets.filter((one) => one.available).map((one) => `${one.to}（${one.label}）`);
			return toolFailure(
				'TRANSITION_REJECTED',
				`当前状态「${labelOf(advice.status)}」没有指向「${labelOf(to)}」的合法动作。`,
				{
					next:
						available.length === 0
							? '不传 to 调一次看当前可转移的目标；这张卡现在没有可执行的目标。'
							: `可用目标：${available.join('、')}。`,
				},
			);
		}

		/* ── 条件不满足：不写库，把原因/阻塞卡直接给模型 ── */
		if (!target.aiAllowed) {
			return conditionFailure(advice, target.conditions, '这个动作只开放给用户');
		}
		if (!target.available) {
			return conditionFailure(advice, target.conditions, `目标「${labelOf(to)}」现在不可执行`);
		}

		/* ── 执行 ── */
		/*
		 * 领卡类动作必须再过一次 UI 轴（用户第二轮）：
		 * 查询结果已经标了不可执行，这里是**防御性二次判定**（advice 是读快照，
		 * 写之前的老实做法是问 core「现在允许吗」）。
		 */
		if (target.action === 'adopt' || target.action === 'claim' || target.action === 'release') {
			const verdict = taskboard.judgeCardAction(target.action);
			if (!verdict.ok) return actionLevelFailure(verdict, target.action);
		}

		switch (target.action) {
			case 'adopt': {
				const adopted = await taskboard.adopt(workspaceId, cardId, 'ai', { allowAiAdopt: true });
				if (!adopted.ok) return failureResult(adopted, { action: '采纳失败', next: transitionNext(adopted.code) });
				return okText(
					`已采纳 ${adopted.card.id}「${adopted.card.title}」：` +
						`${labelOf(advice.status)} → ${labelOf(adopted.card.status)}（TASK_STATE 目标=${adopted.card.status}）。`,
				);
			}
			case 'claim': {
				if (holder === undefined) {
					return hostFailure(
						'宿主没有提供当前调用者身份（holder），无法领取。',
						'这是宿主接线问题：让宿主在工具上下文里传 holder 后重试。',
					);
				}
				const claimed = await taskboard.claim(workspaceId, cardId, 'ai', holder);
				if (!claimed.ok) return failureResult(claimed, { action: '领取失败', next: transitionNext(claimed.code) });
				return okText(
					`已领取 ${claimed.card.id}「${claimed.card.title}」：` +
						`${labelOf(advice.status)} → ${labelOf(claimed.card.status)}；持有者 ${holder}。`,
				);
			}
			case 'release': {
				if (holder === undefined) {
					return hostFailure(
						'宿主没有提供当前调用者身份（holder），无法释放。',
						'这是宿主接线问题：让宿主在工具上下文里传 holder 后重试。',
					);
				}
				const released = await taskboard.release(workspaceId, cardId, 'ai', holder);
				if (!released.ok) return failureResult(released, { action: '释放失败', next: transitionNext(released.code) });
				const holders = released.card.holders.map((one) => one.holder);
				return okText(
					`已释放 ${released.card.id}「${released.card.title}」；当前状态：${labelOf(released.card.status)}；` +
						(holders.length === 0 ? '当前无人持有（已退回「提交」）。' : `仍有持有者：${holders.join('、')}。`),
				);
			}
			case 'transition': {
				const applied = await taskboard.transition(workspaceId, cardId, to, 'ai');
				if (!applied.ok) return failureResult(applied, { action: '转移失败', next: transitionNext(applied.code) });
				return okText(
					`已转移 ${applied.card.id}「${applied.card.title}」：` +
						`${labelOf(advice.status)} → ${labelOf(applied.card.status)}。`,
				);
			}
		}
	};

	return defineTool({
		name: 'taskboard_transition',
		description:
			'推进一张卡的状态：**采纳、领取、释放、普通转移都用这一个工具**，区别只在目标字符串。' +
			'采纳 = 未指定 → 提交（设计/记录会改为「需要授权」）；领取 = 提交 → 处理中（只能对工作卡）；' +
			'释放 = 处理中 → 提交。' +
			'**目标字符串省略/为空时只查询**：列出接下来可转移的目标、对应动作、AI 能不能做、' +
			'不能做的具体原因与阻塞卡（依赖没结束 / 子任务等授权 / 手上已有处理中工作卡 / 只有用户能点 / UI 档位未开）。' +
			'采纳与领取默认关闭；如果用户授意，可以由用户在任务板 UI 打开对应档位。' +
			'空间省略 = 宿主激活空间（DSH）；MCP 等没有该行为的宿主会报错。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: {
					type: 'string',
					description: '空间 id。省略 = 宿主激活空间（DSH）；MCP 等没有该行为的宿主会报错。',
				},
				id: { type: 'string', description: '卡编号（如 W1）。必填。' },
				to: {
					type: 'string',
					description:
						'目标状态 id（TASK_STATE_*）或中文名（提交/处理中/成功…）。省略 = 只查询目标与条件，不执行。',
				},
			},
			required: ['id'],
		},
		handler,
	});
}

/** 条件不满足的失败（带阻塞卡 / UI 权限指引）。 */
function conditionFailure(
	advice: TransitionAdvice,
	conditions: TransitionAdvice['targets'][number]['conditions'],
	title: string,
): TaskboardToolResult {
	const lines = [`失败：${title}：`];
	for (const condition of conditions) {
		lines.push(`  原因：${condition.message}（code=${condition.code}；${condition.retryable ? '修正后可重试' : '不可重试'}）`);
		for (const blocker of condition.blockers ?? []) {
			lines.push(`  阻塞卡：${blocker.id}「${blocker.title}」（状态：${blocker.status}）`);
		}
	}
	const uiNext = uiNextOf(conditions);
	lines.push(
		'下一步：' +
			(uiNext ??
				'不传 to 调一次看全部目标与条件；能先解除的条件（比如依赖、配额）先处理另一个目标。'),
	);
	return { text: lines.join('\n'), isError: true };
}

/** 条件里如果有 UI 轴（用户授权）拦截，下一步要明确告诉 AI「找用户开哪一档」。 */
function uiNextOf(conditions: TransitionAdvice['targets'][number]['conditions']): string | undefined {
	const codes = new Set(conditions.map((one) => one.code));
	if (codes.has('CARD_ACTION_LEVEL_ADOPT')) {
		return '如果用户授意，可以由用户把档位调到「允许采纳草稿」后重试。';
	}
	if (codes.has('CARD_ACTION_LEVEL_CLAIM')) {
		return '如果用户授意，可以由用户把档位调到「允许领卡」或「允许采纳草稿」后重试。';
	}
	return undefined;
}

/** 执行时二次确认 UI 轴（对 adopt / claim / release）。 */
function actionLevelFailure(verdict: CardActionDenied, action: 'adopt' | 'claim' | 'release'): TaskboardToolResult {
	const requiredLabel =
		CARD_ACTION_OPTIONS.find((one) => one.value === verdict.requiredLevel)?.label ?? verdict.requiredLevel;
	const currentLabel = CARD_ACTION_OPTIONS.find((one) => one.value === verdict.current)?.label ?? verdict.current;
	return toolFailure(action === 'claim' ? ErrorCode.CLAIM_REJECTED : ErrorCode.TRANSITION_REJECTED, verdict.message, {
		next: `如果用户授意，可以由用户把档位调到「${requiredLabel}」（当前档位是「${currentLabel}」）后重试。`,
	});
}

/** 转移失败的下一步。 */
function transitionNext(code: string): string {
	switch (code) {
		case 'CLAIM_REJECTED':
			return '不传 to 调一次看条件目标；按 blockers 先完成依赖，或先释放手上另一张处理中工作卡。';
		case 'TRANSITION_REJECTED':
			return '不传 to 调一次看当前可转移目标；终结态如果用户授意，由用户推进。';
		case 'CARD_NOT_FOUND':
			return '先用 taskboard_cards 确认编号；已删除的卡不能转移。';
		default:
			return '不传 to 调一次看当前可转移目标。';
	}
}

/** 「接下来能去哪」的文本视图由 `render.renderAdvice` 统一渲染（#6/#7 也用它）。 */

/** 把用户/模型给的目标字符串解析成状态 id（英文 id 或中文名）。 */
export function resolveStateId(raw: string): (typeof TASK_STATES)[number] | undefined {
	if (isTaskState(raw)) return raw;
	const trimmed = raw.trim();
	if (isTaskState(trimmed)) return trimmed;
	return TASK_STATES.find((state) => STATE_LABELS[state] === trimmed);
}

/** 读一个允许空串的字符串字段。 */
function readString(args: unknown, key: string): string | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === 'string' ? value : undefined;
}
