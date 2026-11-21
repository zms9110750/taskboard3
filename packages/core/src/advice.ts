/**
 * 「当前状态下，AI 还能把这张卡推到哪」—— **纯函数**。
 *
 * ## 为什么需要它（用户 `2026-11-21`）
 *
 * > 目标字符串为空时，展示接下来可转移的目标和条件目标。
 *
 * ⇒ AI 不想先猜一个目标字符串再被拒；它要一张**可行动的清单**：
 * 每个目标是什么、对应哪个动作、现在能不能做、不能做的原因是什么、
 * 原因落在哪张卡上（依赖 / 子任务 / 配额）。
 *
 * ## 为什么不在工具层拼
 *
 * 「能不能领取」的准入判定（依赖是否结束、子任务是否等授权、一次一张配额）
 * 是 `transition.ts` 里 `judgeClaim` 的业务规则；在 tools 层重写一遍就是
 * 第二份真值，改了 core 不会同步。 ⇒ 本模块只做**组装**：
 * 按钮表（protocol）+ 领取准入（core）+ 转移判定（protocol）+ 持有者事实（card）。
 *
 * ## `adopt` 为什么对 AI 放行
 *
 * protocol 的按钮表里 `goal` / `work` 的采纳只有 `user`（那是「谁能点 UI 按钮」）。
 * 但 v2 的 `taskboard_transition` 明确把采纳并进 AI 工具（用户要求），
 * 执行时走 `adopt(..., { allowAiAdopt: true })` 那条 core 路径。
 * ⇒ 这里对 `adopt` 一律 `aiAllowed: true`，其余动作仍按按钮表的 `actors` 判。
 */

import type { ButtonAction, Failure, TaskState } from '@taskboard/protocol';
import { BUTTON_ACTIONS, judgeTransition, labelOf } from '@taskboard/protocol';

import type { Card, CardId } from './card.ts';
import { holderIdsOf, isHeldBy } from './card.ts';
import type { CardActionLevel } from './permission.ts';
import { judgeClaim, type ClaimContext } from './transition.ts';

/** 这个目标背后要调哪个 core 门面方法。 */
export type TransitionAction = 'adopt' | 'claim' | 'release' | 'transition';

/** 一个阻塞项：落在某张具体的卡上。 */
export interface TransitionBlocker {
	readonly id: CardId;
	readonly title: string;
	readonly status: TaskState;
}

/** 一条「条件」—— 目标现在不可执行的原因。 */
export interface TransitionCondition {
	/** 机器可读原因码（`judgeClaim` 的 reason / `judgeTransition` 的 reason / 本模块的码）。 */
	readonly code: string;
	/** 人话说明（AI 直接读）。 */
	readonly message: string;
	/** 具体卡死的卡（依赖 / 子任务 / 手上那张）。 */
	readonly blockers?: readonly TransitionBlocker[];
	/** 修正后重试能否解决（false = 用户授意 / 宿主 / 身份层面的变化）。 */
	readonly retryable: boolean;
}

/** 一个「接下来可去的目标」。 */
export interface TransitionTargetAdvice {
	/** 目标状态（协议全名）。 */
	readonly to: TaskState;
	/** 按钮文案（用户词，如「领取」「采纳」）。 */
	readonly label: string;
	/** 要调的动作。 */
	readonly action: TransitionAction;
	/** 协议按钮表是否允许 AI（`adopt` 按 v2 口径恒为 true）。 */
	readonly aiAllowed: boolean;
	/** 现在能不能执行。 */
	readonly available: boolean;
	/** 不可执行时的原因。 */
	readonly conditions: readonly TransitionCondition[];
}

/** 一次「接下来能去哪」的回答。 */
export interface TransitionAdvice {
	readonly cardId: CardId;
	readonly title: string;
	readonly kind: string;
	readonly status: TaskState;
	/** 当前调用者（`''` = 宿主没给身份）。 */
	readonly holder: string;
	readonly targets: readonly TransitionTargetAdvice[];
}

/** 组装 advice 需要的外部事实。 */
export interface TransitionAdviceOptions extends ClaimContext {
	/** 调用者身份（claim / release 判准入用）。省略 = `''`。 */
	readonly holder?: string;
	/**
	 * UI 轴档位（用户授权 AI 能不能领卡 / 采纳草稿）。
	 *
	 * 用户在第二轮明确要求：权限拦截要让查询结果也如实反映，
	 * 否则 AI 会看到一个「可执行」的目标、发出去才被拒。
	 */
	readonly cardLevel: CardActionLevel;
}

/**
 * 组装「接下来可转移的目标和条件目标」。
 *
 * @param card 目标卡
 * @param cards 同空间全部卡（解析依赖/子任务/配额）
 * @param options 类别事实 + 调用者身份
 */
export function transitionAdviceOf(
	card: Card,
	cards: readonly Card[],
	options: TransitionAdviceOptions,
): TransitionAdvice {
	const holder = options.holder ?? '';
	const kind = card.template.kind;

	const buttons = BUTTON_ACTIONS.filter((one) => one.kind === kind && one.from === card.status);
	const targets = buttons.map((button) => targetOf(button, card, cards, holder, options));

	return {
		cardId: card.id,
		title: card.title,
		kind,
		status: card.status,
		holder,
		targets,
	};
}

/** 一个按钮 → 一条目标建议。 */
function targetOf(
	button: ButtonAction,
	card: Card,
	cards: readonly Card[],
	holder: string,
	options: TransitionAdviceOptions,
): TransitionTargetAdvice {
	const base = {
		to: button.to,
		label: button.label,
		action: button.method,
	};

	/* 采纳：v2 明确由 AI 工具执行，但必须过 UI 轴（用户第二轮要求）。 */
	if (button.method === 'adopt') {
		if (options.cardLevel !== 'adopt') {
			return cardLevelDenied(
				base,
				'CARD_ACTION_LEVEL_ADOPT',
				'当前任务板档位不允许 AI 采纳草稿；如果用户授意，可以由用户把档位调到「允许采纳草稿」。',
			);
		}
		return { ...base, aiAllowed: true, available: true, conditions: [] };
	}

	const aiAllowed = button.actors.includes('ai');

	/* 领取：准入规则在 `judgeClaim`（依赖 / 子任务 / 配额），但先过 UI 轴。 */
	if (button.method === 'claim') {
		if (!aiAllowed) return userOnly(base);
		if (options.cardLevel === 'no-claim') {
			return cardLevelDenied(
				base,
				'CARD_ACTION_LEVEL_CLAIM',
				'当前任务板档位不允许 AI 领取工作卡；如果用户授意，可以由用户把档位调到「允许领卡」（或「允许采纳草稿」）。',
			);
		}
		if (holder === '') return needHolder(base, '领取');
		const admission = judgeClaim(card, cards, holder, options);
		if (admission.ok) return { ...base, aiAllowed, available: true, conditions: [] };
		return {
			...base,
			aiAllowed,
			available: false,
			conditions: [
				{
					code: admission.reason,
					message: admission.message,
					...(admission.blockers === undefined
						? {}
						: { blockers: blockersOf(admission.blockers, cards) }),
					retryable: true,
				},
			],
		};
	}

	/* 释放：只有当前持有者能放。 */
	if (button.method === 'release') {
		if (!aiAllowed) return userOnly(base);
		if (holder === '') return needHolder(base, '释放');
		if (!isHeldBy(card, holder)) {
			const current = holderIdsOf(card);
			return {
				...base,
				aiAllowed,
				available: false,
				conditions: [
					{
						code: 'NOT_A_HOLDER',
						message:
							current.length === 0
								? '这张卡当前无人持有，无法释放。'
								: `你不是这张卡的持有者；当前持有者：${current.join('、')}。`,
						retryable: false,
					},
				],
			};
		}
		return { ...base, aiAllowed, available: true, conditions: [] };
	}

	/* 普通转移：判定在 protocol（AI 不能进终结态等）。 */
	const verdict = judgeTransition({ kind: card.template.kind, from: card.status, to: button.to, trigger: 'ai' });
	if (verdict.ok) return { ...base, aiAllowed, available: true, conditions: [] };

	if (!aiAllowed) return userOnly(base);

	return {
		...base,
		aiAllowed,
		available: false,
		conditions: [
			{
				code: verdict.reason,
				message: rejectMessage(verdict.reason),
				retryable: false,
			},
		],
	};
}

/** 只开放给用户的目标。 */
function userOnly(base: Pick<TransitionTargetAdvice, 'to' | 'label' | 'action'>): TransitionTargetAdvice {
	return {
		...base,
		aiAllowed: false,
		available: false,
		conditions: [
			{
				code: 'USER_ONLY',
				message: '这个动作只开放给用户；如果用户授意，由用户执行。',
				retryable: false,
			},
		],
	};
}

/** 缺少调用者身份。 */
function needHolder(base: Pick<TransitionTargetAdvice, 'to' | 'label' | 'action'>, action: string): TransitionTargetAdvice {
	return {
		...base,
		aiAllowed: true,
		available: false,
		conditions: [
			{
				code: 'HOLDER_MISSING',
				message: `宿主没有提供当前调用者身份（holder），无法${action}。这是宿主接线问题，不是参数问题。`,
				retryable: false,
			},
		],
	};
}

/** UI 轴（用户授权）没打开 ⇒ 目标不可执行，并告诉 AI「如果用户授意，由用户开哪一档」。 */
function cardLevelDenied(
	base: Pick<TransitionTargetAdvice, 'to' | 'label' | 'action'>,
	code: string,
	message: string,
): TransitionTargetAdvice {
	return {
		...base,
		aiAllowed: true,
		available: false,
		conditions: [{ code, message, retryable: true }],
	};
}

/** 把卡 id 解析成「id + 标题 + 状态」。 */
function blockersOf(ids: readonly CardId[], cards: readonly Card[]): readonly TransitionBlocker[] {
	return ids.map((id) => {
		const found = cards.find((one) => one.id === id);
		return { id, title: found?.title ?? '', status: found?.status ?? ('TASK_STATE_UNSPECIFIED' as TaskState) };
	});
}

/** `judgeTransition` 的拒绝原因 → 给 AI 的人话。 */
function rejectMessage(reason: string): string {
	switch (reason) {
		case 'AI_CANNOT_END':
			return '这是终结态；AI 不能把卡推进终结态；如果用户授意，由用户推进。';
		case 'NOT_A_BUTTON':
			return '当前状态到目标状态在按钮表里没有合法动作。';
		case 'SAME_STATE':
			return '目标状态就是当前状态，无需转移。';
		case 'UNKNOWN_KIND':
			return '这张卡的分类未注册，状态机不认它。';
		case 'UNKNOWN_STATE':
			return '状态值不合法。';
		default:
			return `转移被拒：${reason}。`;
	}
}

/** 编译期留痕：`Failure` 类型与 advice 的失败形态同源，避免未知原因映射时静默。 */
export type TransitionAdviceFailure = Failure;
