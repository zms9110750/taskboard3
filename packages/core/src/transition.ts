/**
 * 状态转移的**执行** —— 判定在 `@taskboard/protocol`，这里只负责「按判定结果改卡」。
 *
 * ## 三层分工（不要互相越界）
 *
 * | 层 | 负责 | 不负责 |
 * |---|---|---|
 * | `protocol/transition.ts` | **能不能**转（纯判定，同步） | 不碰卡、不碰存储 |
 * | **本文件** | 按判定结果**改卡**（纯函数，不改存储） | 不判规则、不落库 |
 * | `index.ts` | 读卡 → 调本文件 → 落库 | 不写业务规则 |
 *
 * ⇒ 本文件全是**纯函数**：给一张卡 + 一个时间，返回新卡或失败。
 *   好处是这几条最容易写错的规则（采纳要不要写 `adoptedAt`、重算会不会产出终结态）
 *   可以在没有任何 I/O 的情况下穷举测试。
 *
 * ## 用户裁定的核心（`2026-11-13`）
 *
 * > 状态转移。目标的自动计算，取消所有通过自动计算到达终结态的通路。
 * > 然后增加人通过按钮进入终结态的通路。
 *
 * ⇒ 两条硬规则：
 *   ① **自动计算只产 `AUTO_STATES`**（四个非终结态），由 `recomputeTargetOf` 保证；
 *   ② **终结态只能靠按钮进**，由 `judgeTransition` 的按钮表保证。
 */

import type { Failure } from '@taskboard/protocol';
import {
	AUTO_STATES,
	BUTTON_ACTIONS,
	DRAFT,
	ErrorCode,
	TaskState,
	failure,
	isEndedState,
	judgeTransition,
	labelOf,
	type Actor,
	type TransitionTrigger,
} from '@taskboard/protocol';

import type { Card, CardId } from './card.ts';
import {
	childIdsOf,
	findCard,
	holderIdsOf,
	isEndedCard,
	isHeldBy,
	withHistory,
	withHolder,
	withoutHolder,
} from './card.ts';

/* ────────────────────────────── 采纳 ────────────────────────────── */

// TODO(审查): 本文件另有一份 `adoptTargetOf(kind)`（只按 kind 建表），与 actions.ts:54 的 `(kind, from)` 同名不同参 ⇒ 两份真值易漂；改为调 `adoptTargetOf(kind, DRAFT)` 并删 `ADOPT_TARGETS`，可直接改。
/**
 * 采纳后的目标状态 —— 按类别定。
 *
 * | 类别 | 采纳后 |
 * |---|---|
 * | `goal` / `work` | 提交 |
 * | `design` / `record` | 需要授权 |
 *
 * 依据是 `BUTTON_ACTIONS` 里 `method === 'adopt'` 的 `to` —— **不在这里抄一份表**。
 * 类别不在表里 ⇒ 返回 `undefined`（调用方报 `NOT_A_BUTTON`）。
 */
export function adoptTargetOf(kind: string): TaskState | undefined {
	return ADOPT_TARGETS.get(kind);
}

/** `kind` → 采纳目标状态。**从协议按钮表派生**，不手写第二份映射。 */
const ADOPT_TARGETS: ReadonlyMap<string, TaskState> = new Map(
	BUTTON_ACTIONS.filter((action) => action.method === 'adopt').map((action) => [action.kind, action.to]),
);

/**
 * 采纳一张卡（纯函数）。
 *
 * 草稿 → 按类别定目标状态；同时写 `adoptedAt`。
 *
 * ⚠ **`adoptedAt` 与 history 里那条 `action: 'adopt'` 必须用同一个 `at`** ——
 *   两处时间不一致会让「排序用 adoptedAt、展示用 history」出现一秒的错位，
 *   而且查起来极难（两边各自都"对"）。`Card.adoptedAt` 的注释里写了这条约定。
 *
 * @param card 当前卡
 * @param actor 谁采纳（`user` / `ai`）
 * @param at 时间戳（调用方给，卡自己不取时钟）
 * @param nextId 发号函数（采纳时**不发号** —— 发号在建卡时。这里保留参数位以备将来）
 */
export function adoptCard(
	card: Card,
	actor: Actor,
	at: number,
	options?: { readonly allowAiAdopt?: boolean },
): { readonly ok: true; readonly card: Card } | Failure {
	if (card.status !== DRAFT) {
		return failure(ErrorCode.TRANSITION_REJECTED, `只有草稿能采纳；这张卡现在是「${labelOf(card.status)}」。`, {
			detail: { from: card.status, reason: 'NOT_DRAFT' },
		});
	}

	const to = adoptTargetOf(card.template.kind);
	if (to === undefined) {
		return failure(ErrorCode.TRANSITION_REJECTED, `类别「${card.template.kind}」没有采纳按钮。`, {
			detail: { kind: card.template.kind, reason: 'NOT_A_BUTTON' },
		});
	}

	/*
	 * 「自动工作」模式：AI 可以自己采纳。
	 *
	 * 用户 `2026-11-14`：「自动工作和工作的区别就是 ai 自己采纳草稿。」
	 *
	 * ⚠ `BUTTON_ACTIONS` 里 design / record 的采纳本来就对 ai 开放
	 *   （见 protocol 的 BOTH），但 goal / work 只有 user。
	 *   这里**不改那张表** —— 它问的是「谁可以点哪个按钮」，是全局真值；
	 *   改它会让 work 模式也放开 AI。⇒ 只在本函数里按入参放行。
	 *
	 * 判定顺序：先看这个开关，过了就不再问 `judgeTransition` 的 actors
	 * （否则表里 actors 仍然只有 user，永远过不去）。
	 */
	const aiAdoptAllowed = actor === 'ai' && options?.allowAiAdopt === true;

	if (!aiAdoptAllowed) {
		/* 判定层也要过（它才知道 actors 里有没有这个主体）。 */
		const verdict = judgeTransition({
			kind: card.template.kind,
			from: card.status,
			to,
			trigger: actor === 'ai' ? 'ai' : 'button',
		});
		if (!verdict.ok) {
			return rejectFailure(card, to, verdict.reason);
		}
	}

	return {
		ok: true,
		card: withHistory({ ...card, status: to, adoptedAt: at }, { at, action: 'adopt', actor }),
	};
}

/* ────────────────────────────── 领取 / 释放 ────────────────────────────── */

/**
 * 领取准入的拒绝原因。
 *
 * ⚠ **各自独立** —— 用户要求「不能合并成一句不能领取」：
 *   调用方（AI 工具）要把具体原因说给模型听，模型才知道下一步做什么。
 */
export type ClaimRejectReason =
	/** 不是「提交」状态（草稿 / 处理中 / 终结态都不能领）。 */
	| 'NOT_SUBMITTED'
	/**
	 * 这类卡**不需要领取**。
	 *
	 * 用户 `2026-11-13`：
	 * > 一次一张要的。因为自动化下。就是工作卡给的权限。这是为了防止越狱。
	 * > 因为其他的所有卡，都是可以在仅聊天下去做的。
	 *
	 * ⇒ 只有「工作」类是执行权限凭证。目标 / 设计 / 记录直接在聊天里做。
	 */
	| 'KIND_NEEDS_NO_CLAIM'
	/** 依赖（`dependsOn` 边）里有没结束的卡。 */
	| 'DEPENDENCY_NOT_ENDED'
	/** 有子任务停在「需要授权」—— 作者要先处理它。 */
	| 'CHILD_NEEDS_AUTH'
	/** 同一持有者名下已有**另一张**处理中的**工作**卡（一次只能做一件事）。 */
	| 'ALREADY_HOLDING_A_CARD';

/** 一条领取准入失败。 */
export interface ClaimRejection {
	readonly ok: false;
	readonly reason: ClaimRejectReason;
	/** 人话说明（已含具体卡号）。 */
	readonly message: string;
	/** 阻塞它的卡（依赖没结束 / 子任务要授权 / 手上那张卡）。 */
	readonly blockers?: readonly CardId[];
}

/** 领取准入的判定结果。 */
export type ClaimAdmission = { readonly ok: true } | ClaimRejection;

/** `judgeClaim` 需要的外部事实（类别注册表）。 */
export interface ClaimContext {
	/**
	 * **需要领取的类别 id 集合**。
	 *
	 * ⚠ 由调用方从 `KindRegistry` 派生（`KindDef.needsClaim`），
	 *   **不在这里写字面量 `'work'`** —— 第三方注册的类别自己声明要不要领取。
	 */
	readonly claimableKinds: ReadonlySet<string>;
}

/**
 * 判「能不能领取」—— **纯函数**。
 *
 * ## 三条准入（用户 `2026-11-13` 的新口径）
 *
 * > 一次一张要的。因为自动化下。就是工作卡给的权限。这是为了防止越狱。
 * > 比如编写代码是没有命令行的。跑一边要另外开卡。这也是为了记录流程。
 * > 而只能一个人领取其实没啥用。那是为了防止两个ai一起做。
 * > 那返回来说。应该有任何人领取，就是进行中。然后显示有谁拿了。
 * > 现在不限制一个卡只能被一个拿，应该就没问题了。
 *
 * | # | 条件 | 为什么 |
 * |---|---|---|
 * | ① | 必须是**需要领取的类别**（= 工作） | 领取 = 执行权限凭证；其它类在纯聊天里就能做 |
 * | ② | 必须是「提交」状态 | 已经处理中 / 终结态的卡不用再领 |
 * | ③ | 这个 holder 名下**没有另一张**处理中的**工作**卡 | 「一次一张」—— 防止一个 AI 同时开两条执行线 |
 *
 * ## ⚠ 「一张卡只能一个人领」这条**已删除**
 *
 * 用户明确否掉了：「只能一个人领取其实没啥用」。同一张卡允许多人协作，
 * 各自占各自那份配额（AB 都持有 X ⇒ AB 各自都不能再领 Y）。
 *
 * ## ⚠ 配额判定要**排除正在 claim 的这张卡本身**
 *
 * 否则「我已持有 X，再 claim X」会被自己拦住。重复 claim 应当幂等成功。
 *
 * @param card 要领取的卡
 * @param cards 同空间全部卡（用于查依赖、子任务、配额）
 * @param holder 领取者（AI 消息循环 id / 会话 id；**必传**）
 * @param context 类别事实
 */
export function judgeClaim(
	card: Card,
	cards: readonly Card[],
	holder: string,
	context: ClaimContext,
): ClaimAdmission {
	/* ① 这类卡要不要领取 */
	if (!context.claimableKinds.has(card.template.kind)) {
		return {
			ok: false,
			reason: 'KIND_NEEDS_NO_CLAIM',
			message:
				`类别「${card.template.kind}」不需要领取 —— 只有需要执行权限的工作卡才领取；` +
				'这类卡直接在聊天里做。',
		};
	}

	/* ② 必须是「提交」 */
	// TODO(审查): 代码允许 `WORKING`（含**另一个** holder 加入在途卡），但下面拒绝文案写「只有「提交」能领」⇒ 代码与文案必有一处不对；按用户本意收紧准入或改文案，需用户决定。
	if (card.status !== TaskState.SUBMITTED && card.status !== TaskState.WORKING) {
		return {
			ok: false,
			reason: 'NOT_SUBMITTED',
			message: `「${labelOf(card.status)}」的卡不能领取；只有「提交」能领。`,
		};
	}

	/* ③ 依赖全部结束 */
	const unfinished: CardId[] = [];
	for (const link of card.relations.links) {
		if (link.label !== 'dependsOn') continue;
		const target = findCard(cards, link.to);
		if (target === undefined) continue;
		if (!isEndedCard(target)) unfinished.push(target.id);
	}
	if (unfinished.length > 0) {
		return {
			ok: false,
			reason: 'DEPENDENCY_NOT_ENDED',
			message: `依赖还没结束：${unfinished.join('、')}。`,
			blockers: unfinished,
		};
	}

	/* ④ 没有子任务停在「需要授权」 */
	const waitingAuth = childIdsOf(cards, card.id).filter((id) => {
		const child = findCard(cards, id);
		return child !== undefined && child.status === TaskState.AUTH_REQUIRED;
	});
	if (waitingAuth.length > 0) {
		return {
			ok: false,
			reason: 'CHILD_NEEDS_AUTH',
			message: `有子任务在等授权：${waitingAuth.join('、')}。先处理它们。`,
			blockers: waitingAuth,
		};
	}

	/*
	 * ⑤ 配额：这个 holder 名下不能有**另一张**处理中的**工作**卡。
	 *
	 * ⚠ 三个过滤缺一不可：
	 *   · `one.id !== card.id` —— 排除正在 claim 的这张（重复 claim 要幂等成功）；
	 *   · `one.status === WORKING` —— 只算处理中的；
	 *   · `context.claimableKinds.has(one.template.kind)` —— **只看工作卡**
	 *     （目标卡也可能处于处理中，那是重算推出来的，不该占配额）。
	 *   · `isHeldBy(one, holder)` —— 是这个人持有的。
	 */
	const occupied = cards.find(
		(one) =>
			one.id !== card.id &&
			!one.deleted &&
			one.status === TaskState.WORKING &&
			context.claimableKinds.has(one.template.kind) &&
			isHeldBy(one, holder),
	);
	if (occupied !== undefined) {
		return {
			ok: false,
			reason: 'ALREADY_HOLDING_A_CARD',
			message: `手上已有处理中的工作卡「${occupied.id}」；先完成或释放它。`,
			blockers: [occupied.id],
		};
	}

	return { ok: true };
}

/**
 * 领取（纯函数）。**调用方先用 `judgeClaim` 判准入。**
 *
 * - 追加 `holder` 到 `holders`（**幂等**：已在列表里就不重复追加）；
 * - 状态置为「处理中」。
 *
 * @param card 已通过准入的卡
 * @param holder 领取者
 * @param at 时间戳
 */
export function claimCard(
	card: Card,
	holder: string,
	actor: Actor,
	at: number,
): { readonly ok: true; readonly card: Card } | Failure {
	const added = withHolder(card, holder, at);
	const next =
		added.card.status === TaskState.WORKING
			? added.card
			: { ...added.card, status: TaskState.WORKING };

	return {
		ok: true,
		card: withHistory(next, {
			at,
			action: 'claim',
			actor,
			detail: { holder, added: added.added },
		}),
	};
}

/**
 * 释放（纯函数）：把 `holder` 从 `holders` 里移除。
 *
 * ## 两条结果（用户口径）
 *
 * - **列表空了 ⇒ 状态回「提交」** —— 没人做了，回到待领取。
 * - **列表还有别人 ⇒ 状态不变** —— 别人还在做，不能把卡退回排队。
 *
 * @param card 当前卡
 * @param holder 谁在释放（必须是持有者之一）
 * @param at 时间戳
 */
export function releaseCard(
	card: Card,
	holder: string,
	actor: Actor,
	at: number,
): { readonly ok: true; readonly card: Card } | Failure {
	const removed = withoutHolder(card, holder);
	if (!removed.removed) {
		const current = card.holders.length === 0 ? '（无人持有）' : holderIdsOf(card).join('、');
		return failure(
			ErrorCode.TRANSITION_REJECTED,
			`「${holder}」不是这张卡的持有者；当前持有者：${current}。`,
			{ detail: { reason: 'NOT_A_HOLDER', holder, holders: holderIdsOf(card) } },
		);
	}

	/* 还有别人在持有 ⇒ 状态不变；否则退回「提交」。 */
	const stillHeld = removed.card.holders.length > 0;
	const nextStatus = stillHeld ? removed.card.status : TaskState.SUBMITTED;

	return {
		ok: true,
		card: withHistory(
			{ ...removed.card, status: nextStatus },
			{ at, action: 'release', actor, detail: { holder, remaining: removed.card.holders.length } },
		),
	};
}

/* ────────────────────────────── 通用转移 ────────────────────────────── */

/**
 * 通用状态转移（纯函数）：先过判定，过了才改卡。
 *
 * @param card 当前卡
 * @param to 目标状态
 * @param trigger 谁来推（调用方写死：人点按钮 = `button`，AI 调工具 = `ai`）
 * @param at 时间戳
 */
export function transitionCard(
	card: Card,
	to: TaskState,
	trigger: Exclude<TransitionTrigger, 'auto'>,
	at: number,
): { readonly ok: true; readonly card: Card } | Failure {
	const verdict = judgeTransition({ kind: card.template.kind, from: card.status, to, trigger });
	if (!verdict.ok) return rejectFailure(card, to, verdict.reason);

	/*
	 * 进终结态时清空持有者：一张卡结束了却还挂着 holders，
	 * 会让那些人的「一次一张」配额永远卡住。
	 *
	 * 用户：「现在不限制一个卡只能被一个拿」—— 但**结束时所有人都该释放**，
	 * 因为卡已经不需要再执行了。
	 */
	const ended = isEndedState(to);
	/* `trigger` 就是事件的作者：`'ai'` 是模型，`'button'` 是人点的。 */
	const actor: Actor = trigger === 'ai' ? 'ai' : 'user';
	return {
		ok: true,
		card: withHistory(
			{
				...card,
				status: to,
				...(ended ? { holders: [] } : {}),
			},
			{ at, action: 'transition', actor, detail: { to, trigger } },
		),
	};
}

/** 把判定拒绝翻成 `Failure`。 */
function rejectFailure(card: Card, to: TaskState, reason: string): Failure {
	const messages: Readonly<Record<string, string>> = {
		AUTO_CANNOT_END: '自动计算不能把卡推到终结态；那要人来点按钮。',
		AUTO_TARGET_INVALID: '自动计算不能产生这个状态。',
		AI_CANNOT_END: 'AI 不能把卡推到终结态；请让用户点按钮。',
		NOT_A_BUTTON: `没有「${labelOf(card.status)}」→「${labelOf(to)}」的按钮。`,
		UNKNOWN_KIND: `类别「${card.template.kind}」未注册。`,
		UNKNOWN_STATE: '状态不合法。',
		SAME_STATE: '源与目标是同一个状态。',
	};
	return failure(ErrorCode.TRANSITION_REJECTED, messages[reason] ?? `转移被拒：${reason}`, {
		detail: { from: card.status, to, reason },
	});
}

/* ────────────────────────── 沿树重算（自动计算） ────────────────────────── */

/**
 * 由子任务推导出的父卡状态 —— **永远落在 `AUTO_STATES` 里**。
 *
 * ## 规则（用户矩阵里每一节的「系统」条目，去掉终结态）
 *
 * | 子任务情况 | 父卡 |
 * |---|---|
 * | 有子任务在「处理中」 | 处理中 |
 * | 无处理中，有「需要信息」 | 需要信息 |
 * | 无处理中/需要信息，有「需要授权」 | 需要授权 |
 * | 其它 | 提交 |
 *
 * ## ⚠ 这条函数是「不产出终结态」的唯一实现
 *
 * 返回类型的**运行时保证**：只会是 `AUTO_STATES` 的成员。
 * 下面的 `_RECOMPUTE_ONLY_AUTO` 编译期断言 + 测试里对 4 个终结态的穷举共同守着它。
 *
 * ⚠ **草稿子任务不参与计算** —— 用户 `2026-11-02 13:15`：
 *   「这里的计算都要是有效卡，就是进行，或者搁置。草稿是不算的。」
 *
 * @param children 直接子卡（调用方保证不含墓碑）
 * @returns 父卡应当处于的状态（一定非终结）
 */
export function recomputeTargetOf(children: readonly Card[]): TaskState {
	/* 草稿不是有效卡，不参与推导。 */
	const effective = children.filter((child) => child.status !== DRAFT);

	if (effective.some((child) => child.status === TaskState.WORKING)) return TaskState.WORKING;
	if (effective.some((child) => child.status === TaskState.INPUT_REQUIRED)) {
		return TaskState.INPUT_REQUIRED;
	}
	if (effective.some((child) => child.status === TaskState.AUTH_REQUIRED)) {
		return TaskState.AUTH_REQUIRED;
	}
	return TaskState.SUBMITTED;
}

/** 重算的一次结果：这张卡要不要改。 */
export interface RecomputeStep {
	readonly card: Card;
	readonly from: TaskState;
	readonly to: TaskState;
}

/**
 * 对一张卡做一次重算（纯函数）。
 *
 * @returns `null` 表示不需要改（状态已一致 / 卡是草稿或终结态 / 没有子卡）
 */
export function recomputeOne(card: Card, cards: readonly Card[], at: number): RecomputeStep | null {
	/*
	 * 草稿与终结态**不参与自动计算**：
	 *   · 草稿不是有效卡（用户 11-02 13:15）；
	 *   · 终结态是"人点了按钮"的结果，自动计算不许覆盖它 —— 否则人刚置成功，
	 *     一次子任务变更就把它推回「处理中」，等于人的决定被机器撤销。
	 */
	if (card.status === DRAFT || isEndedState(card.status)) return null;
	if (card.deleted) return null;

	const children = childIdsOf(cards, card.id)
		.map((id) => findCard(cards, id))
		.filter((one): one is Card => one !== undefined && !one.deleted);
	if (children.length === 0) return null;

	const to = recomputeTargetOf(children);
	if (to === card.status) return null;

	return {
		card: withHistory(
			{ ...card, status: to },
			/*
			 * 重算的**作者是 `'system'`** —— 用户 `2026-11-23`：
			 * > 「改卡状态的角色，还有一个系统。目标这一类自动算出来的，
			 * >   改卡角色都是系统。」
			 *
			 * ⚠ **曾经写成 `'ai'`**，那是个错误：这是系统沿子任务推导出来的
			 *   父卡状态，不是模型干的。「AI 改过、用户未读」这类按作者统计的
			 *   东西会把机器自己的推导算成 AI 的功劳/过错。
			 *
			 * ⚠ 但仍然不能无条件算「有人改过」—— 重算只改**父卡状态**，
			 *   而「改过、用户未读」这条计数关心的是**内容变更**。
			 *   详见 `updates.ts`：那里会**跳过 `recompute` 事件**。
			 */
			{ at, action: 'recompute', actor: 'system', detail: { to } },
		),
		from: card.status,
		to,
	};
}

/**
 * 从某张卡出发，沿 `parent` 链向上重算（纯函数）。
 *
 * ## 环保护
 *
 * `parent` 理论上是一棵树，但数据可能被写成环（手工改库 / 迁移出错）。
 * ⇒ 用 `visited` 集合，遇到已访问的 id 就停 —— **不死循环**。
 *
 * ## 为什么不在这里落库
 *
 * 本函数返回「哪些卡要改成什么样」，由 `index.ts` 一个个 `save`。
 * 这样「算什么」与「存什么」分开，测试不用碰存储。
 *
 * @param startId 起点（通常是刚被改过状态的卡）
 * @param cards 同空间全部卡
 * @param at 时间戳
 * @returns 需要改动的卡（自底向上顺序：先父卡、再父卡的父卡）
 */
export function recomputeChain(
	startId: CardId,
	cards: readonly Card[],
	at: number,
): readonly RecomputeStep[] {
	const steps: RecomputeStep[] = [];
	const visited = new Set<CardId>([startId]);

	/* 用一份可变副本，让上层的重算能看到下层刚算出的新状态。 */
	const working = new Map<CardId, Card>();
	for (const card of cards) working.set(card.id, card);

	let current = findCard(cards, startId);
	let guard = 0;
	const MAX_DEPTH = 1000;

	while (current !== undefined && guard < MAX_DEPTH) {
		guard += 1;
		const parentId = current.relations.parent;
		if (parentId === null || parentId === '') break;
		if (visited.has(parentId)) break; /* 环 */
		visited.add(parentId);

		const parent = working.get(parentId);
		if (parent === undefined) break;

		const snapshot = [...working.values()];
		const step = recomputeOne(parent, snapshot, at);
		if (step === null) {
			/*
			 * 父卡不用改，但仍然要**继续往上走** ——
			 * 上层的状态可能依赖更下层的其他子任务，不能因为这一层没变就停。
			 */
			current = parent;
			continue;
		}
		steps.push(step);
		working.set(step.card.id, step.card);
		current = step.card;
	}

	return steps;
}

/* ────────────────────────────── 编译期断言 ────────────────────────────── */

type AssertTrue<T extends true> = T;

/**
 * 「重算不产终结态」在**类型层**的收口。
 *
 * `recomputeTargetOf` 的返回类型是 `TaskState`（运行时才定），所以这里断言的是
 * 「候选集来自 `AUTO_STATES`」这条实现约束：`AUTO_STATES` 里没有终结态
 * （由 protocol 的 `_AUTO_NEVER_ENDED` 保证）。
 *
 * 真正的运行时保证靠 `test/transition-exec.test.ts` 里对 4 个终结态的穷举。
 */
type _AutoStatesAreFour = (typeof AUTO_STATES)['length'] extends 4 ? true : false;

export type _RECOMPUTE_ONLY_AUTO = AssertTrue<_AutoStatesAreFour>;

// TODO(审查): 这条注释已过时（import 列表已裁干净，withPatch 也已无人用）⇒ 可直接删掉本注释块。
/*
 * `groupOf` / `withPatch` 在本文件暂时用不到；显式标注「故意不用的 import」
 * 不如直接不 import —— 已按实际使用裁剪，见文件顶部的 import 列表。
 */

