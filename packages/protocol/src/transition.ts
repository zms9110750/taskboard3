/**
 * 状态转移判定 —— **数据驱动的表 + 一个查询函数**，不做大 `switch`。
 *
 * ## 用户裁定（`2026-11-13`）
 *
 * > 状态转移。目标的自动计算，取消所有通过自动计算到达终结态的通路。
 * > 然后增加人通过按钮进入终结态的通路。
 *
 * 拆成三条规则：
 *
 * ### 规则 1 —— 自动计算仍然存在，但不许产出终结态
 *
 * 「自动计算」= 系统根据子任务状态推导父卡状态。它只允许产出
 * `SUBMITTED` / `WORKING` / `INPUT_REQUIRED` / `AUTH_REQUIRED`（见 `AUTO_STATES`）。
 *
 * **绝不能直接得出 `COMPLETED` / `FAILED` / `CANCELED` / `REJECTED`。**
 * 旧仓库里「子任务全成功 ⇒ 父变成功」「有失败 ⇒ 父变失败」两条通路全部删除。
 *
 * ### 规则 2 —— 人通过按钮才能进终结态
 *
 * `BUTTON_ACTIONS` 是**唯一**能到达终结态的路径，也是 UI 渲染按钮的唯一来源。
 *
 * ### 规则 3 —— AI 不能直接进终结态，只能提出
 *
 * 用户 `2026-11-13`：「**人**通过按钮进入终结态」。
 * `CANCELED` 属于终结态组 ⇒ AI **也不能取消**。
 * AI 可以：采纳设计与记录（→ `AUTH_REQUIRED`）、领取、搁置回提交。
 * AI 不能：置成功、置失败、置否决、取消。
 *
 * ## 为什么是表而不是 `switch`
 *
 * 「谁能从哪个状态到哪个状态」是一条**数据**，不是控制流。
 * 写成 `switch` 的代价是：加一个类别要改函数体，规则散落在分支里，
 * 编译期看不出有没有漏状态。写成表之后，下面的编译期断言可以检查它。
 *
 * ## 纯数据
 *
 * 本文件零运行时依赖（除 `./status.ts` 的词汇），无副作用、无 I/O。
 * 判定是同步纯函数：同一输入永远同一输出。
 */

import { type TaskState, TaskState as S, isTaskState, statesInGroup } from './status.ts';

/* ────────────────────────────── 词汇 ────────────────────────────── */

/**
 * 触发转移的主体种类。
 *
 * - `user`   = 人点按钮
 * - `ai`     = 模型调用工具
 * - `system` = 系统自动算出来的（沿子任务推导父卡，见 `recomputeTargetOf`）
 *
 * ## `system` 为什么要独立于 `ai`（用户 `2026-11-23`）
 *
 * > 「改卡状态的角色，还有一个系统。目标这一类自动算出来的，改卡角色都是系统。」
 *
 * 之前重算的 history 作者被写成 `'ai'`（`core/src/transition.ts` 的
 * `recomputeTargetOf`），于是「AI 改过、用户未读」这类按作者统计的东西
 * 把机器自己的推导也算成 AI 干的。**「自动算出来的」不是 AI 干的** ⇒
 * 独立成 `system`。
 *
 * ⚠ `system` **不进按钮表**（`USER` / `BOTH` 里都没有它）：自动计算走
 *   `autoTargetsOf` 那条独立通路，本来就绕开按钮表（规则 1）。
 */
export type Actor = 'user' | 'ai' | 'system';

/**
 * 类别 id。
 *
 * 内置四类（`goal` / `work` / `design` / `record`）在 `BUTTON_ACTIONS` 里。
 * 外部注册的类别**必须自带一份按钮表** —— 那是后续能力，本文件现在只认这四类，
 * 其余返回 `UNKNOWN_KIND`（明确失败，不静默放行）。
 */
export type KindId = string;

/** 谁来推动这次转移。 */
export type TransitionTrigger =
	/** 系统自动计算（沿子任务推导父卡）。 */
	| 'auto'
	/** 人点界面按钮。 */
	| 'button'
	/** 模型调用工具。 */
	| 'ai';

/** 拒绝原因。每条对应一条裁定，见上方文件头。 */
export type TransitionRejectReason =
	/** 规则 1：自动计算想进终结态。 */
	| 'AUTO_CANNOT_END'
	/** 规则 1：自动计算想进一个它不该产出的非终结状态（例如草稿）。 */
	| 'AUTO_TARGET_INVALID'
	/** 规则 3：AI 想进终结态（成功 / 失败 / 拒绝）。 */
	| 'AI_CANNOT_END'
	/** 该 `(类别, from, to)` 没有对应的合法动作。 */
	| 'NOT_A_BUTTON'
	/** 类别未注册。 */
	| 'UNKNOWN_KIND'
	/** `from` / `to` 不是已知状态。 */
	| 'UNKNOWN_STATE'
	/** 源与目标相同。 */
	| 'SAME_STATE';

/** 放行。 */
export interface TransitionVerdict {
	readonly ok: true;
}

/** 拒绝。 */
export interface TransitionRejection {
	readonly ok: false;
	readonly reason: TransitionRejectReason;
}

/* ────────────────────────── 自动计算的可达集 ────────────────────────── */

/**
 * 自动计算**允许产出**的全部状态。
 *
 * ⚠ 这是规则 1 的**唯一实现**：终结态不在这张表里。
 * 下面的 `_AUTO_NEVER_ENDED` 编译期断言钉住这一点 ——
 * 谁往里加一个终结态，`tsc` 直接失败。
 */
export const AUTO_STATES = [
	S.SUBMITTED,
	S.WORKING,
	S.INPUT_REQUIRED,
	S.AUTH_REQUIRED,
] as const;

/** 终结态（成功 / 失败 / 取消 / 拒绝）。 */
export type EndedTaskState =
	| typeof S.COMPLETED
	| typeof S.FAILED
	| typeof S.CANCELED
	| typeof S.REJECTED;

/**
 * 终结态集合 —— **从 `status.ts` 的 `ended` 组取，不写死**。
 *
 * 用户 `2026-11-01 06:55`：「"完成"，是一个状态组。包括成功，失败，取消，拒绝。」
 * ⇒ 组的定义在 `status.ts`，这里只是查询；若将来组变了，这里自动跟上。
 */
export function endedStates(): readonly TaskState[] {
	return statesInGroup('ended');
}

/** 是否是终结态。 */
export function isEndedState(state: TaskState): state is EndedTaskState {
	return statesInGroup('ended').includes(state);
}

/* ────────────────────────────── 按钮表 ────────────────────────────── */

/** 按钮背后该调哪个门面方法。UI 用它决定点下去调什么。 */
export type ButtonMethod =
	/** 采纳：草稿 → 提交 / 需要授权（目的地按类别，已在本表里算好）。 */
	| 'adopt'
	/** 领取：提交 → 处理中（要过依赖门 / 占位门，由 core 判）。 */
	| 'claim'
	/** 搁置 / 释放领取：处理中 → 提交。 */
	| 'release'
	/** 普通状态转移。 */
	| 'transition';

/** 一个按钮 = 一条 (类别, from, to) 的合法转移 + 谁能点。 */
export interface ButtonAction {
	readonly kind: KindId;
	readonly from: TaskState;
	readonly to: TaskState;
	/** 按钮文案（中文）。用户的词，不在这里造新词。 */
	readonly label: string;
	/** 谁能触发。`user` 一定在；只有设计 / 记录的采纳、工作的领取与取消等对 AI 放开。 */
	readonly actors: readonly Actor[];
	readonly method: ButtonMethod;
}

/** 造一条按钮定义。 */
function btn<
	const K extends KindId,
	const F extends TaskState,
	const T extends TaskState,
	const L extends string,
	const A extends readonly Actor[],
	const M extends ButtonMethod,
>(
	kind: K,
	from: F,
	to: T,
	label: L,
	actors: A,
	method: M,
): {
	readonly kind: K;
	readonly from: F;
	readonly to: T;
	readonly label: L;
	readonly actors: A;
	readonly method: M;
} {
	return { kind, from, to, label, actors, method };
}

/*
 * ⚠ `USER` / `BOTH` 必须是**元组字面量**（`as const`），不是 `readonly Actor[]`。
 * 用宽类型会让下面「终结态按钮不许含 ai」的编译期断言拿到 `'user' | 'ai'`，
 * 永远判不出来 —— 那是这类断言最典型的静默失效。
 */
const BOTH = ['user', 'ai'] as const satisfies readonly Actor[];
const USER = ['user'] as const satisfies readonly Actor[];

/**
 * 全部按钮。**UI 渲染按钮的唯一来源**，也是判定按钮类转移的唯一依据。
 *
 * ⚠ 不在这里的 `(kind, from, to)` ⇒ `NOT_A_BUTTON`。
 *
 * 类型标注成 `readonly ButtonAction[]` 是为了导出面稳定；
 * 下面的编译期断言读的是**这里的字面量类型**（`BUTTON_TABLE`），
 * 所以先保留裸字面量、再断言、最后才 widen 成对外的 `BUTTON_ACTIONS`。
 */
const BUTTON_TABLE = [
	/* ── 目标（goal） ── */
	btn('goal', S.UNSPECIFIED, S.SUBMITTED, '采纳', USER, 'adopt'),
	btn('goal', S.UNSPECIFIED, S.CANCELED, '取消', USER, 'transition'),
	/* 规则 2：人通过按钮进终结态。这四个状态都能收尾。 */
	btn('goal', S.SUBMITTED, S.COMPLETED, '成功', USER, 'transition'),
	btn('goal', S.SUBMITTED, S.FAILED, '失败', USER, 'transition'),
	btn('goal', S.SUBMITTED, S.CANCELED, '取消', USER, 'transition'),
	btn('goal', S.WORKING, S.COMPLETED, '成功', USER, 'transition'),
	btn('goal', S.WORKING, S.FAILED, '失败', USER, 'transition'),
	btn('goal', S.WORKING, S.CANCELED, '取消', USER, 'transition'),
	btn('goal', S.INPUT_REQUIRED, S.COMPLETED, '成功', USER, 'transition'),
	btn('goal', S.INPUT_REQUIRED, S.FAILED, '失败', USER, 'transition'),
	btn('goal', S.INPUT_REQUIRED, S.CANCELED, '取消', USER, 'transition'),
	btn('goal', S.AUTH_REQUIRED, S.COMPLETED, '成功', USER, 'transition'),
	btn('goal', S.AUTH_REQUIRED, S.FAILED, '失败', USER, 'transition'),
	btn('goal', S.AUTH_REQUIRED, S.CANCELED, '取消', USER, 'transition'),
	btn('goal', S.COMPLETED, S.CANCELED, '取消', USER, 'transition'),
	btn('goal', S.FAILED, S.CANCELED, '取消', USER, 'transition'),
	btn('goal', S.CANCELED, S.SUBMITTED, '重开', USER, 'transition'),

	/* ── 设计（design） ── */
	btn('design', S.UNSPECIFIED, S.AUTH_REQUIRED, '采纳', BOTH, 'adopt'),
	btn('design', S.AUTH_REQUIRED, S.COMPLETED, '确认', USER, 'transition'),
	btn('design', S.AUTH_REQUIRED, S.CANCELED, '取消', USER, 'transition'),
	btn('design', S.AUTH_REQUIRED, S.REJECTED, '否决', USER, 'transition'),
	btn('design', S.INPUT_REQUIRED, S.COMPLETED, '确认', USER, 'transition'),
	btn('design', S.INPUT_REQUIRED, S.CANCELED, '取消', USER, 'transition'),
	btn('design', S.INPUT_REQUIRED, S.REJECTED, '否决', USER, 'transition'),
	btn('design', S.CANCELED, S.AUTH_REQUIRED, '重开', USER, 'transition'),

	/* ── 工作（work） ── */
	btn('work', S.UNSPECIFIED, S.SUBMITTED, '采纳', USER, 'adopt'),
	btn('work', S.UNSPECIFIED, S.REJECTED, '否绝', USER, 'transition'),
	/* ⚠ 取消进终结态 ⇒ 只有 user（规则 3 含 CANCELED）。 */
	btn('work', S.UNSPECIFIED, S.CANCELED, '取消', USER, 'transition'),
	btn('work', S.SUBMITTED, S.WORKING, '领取', BOTH, 'claim'),
	btn('work', S.SUBMITTED, S.COMPLETED, '成功', USER, 'transition'),
	btn('work', S.SUBMITTED, S.FAILED, '失败', USER, 'transition'),
	btn('work', S.SUBMITTED, S.CANCELED, '取消', USER, 'transition'),
	btn('work', S.SUBMITTED, S.REJECTED, '否绝', USER, 'transition'),
	btn('work', S.WORKING, S.COMPLETED, '成功', USER, 'transition'),
	btn('work', S.WORKING, S.FAILED, '失败', USER, 'transition'),
	btn('work', S.WORKING, S.CANCELED, '取消', USER, 'transition'),
	btn('work', S.WORKING, S.REJECTED, '否绝', USER, 'transition'),
	btn('work', S.WORKING, S.SUBMITTED, '搁置', BOTH, 'release'),
	btn('work', S.INPUT_REQUIRED, S.CANCELED, '取消', USER, 'transition'),
	btn('work', S.INPUT_REQUIRED, S.FAILED, '失败', USER, 'transition'),
	btn('work', S.INPUT_REQUIRED, S.REJECTED, '否绝', USER, 'transition'),
	btn('work', S.AUTH_REQUIRED, S.CANCELED, '取消', USER, 'transition'),
	btn('work', S.AUTH_REQUIRED, S.FAILED, '失败', USER, 'transition'),
	btn('work', S.AUTH_REQUIRED, S.REJECTED, '否绝', USER, 'transition'),

	/* ── 记录（record） ── */
	btn('record', S.UNSPECIFIED, S.AUTH_REQUIRED, '采纳', BOTH, 'adopt'),
	btn('record', S.AUTH_REQUIRED, S.COMPLETED, '确认', USER, 'transition'),
	btn('record', S.AUTH_REQUIRED, S.FAILED, '否认', USER, 'transition'),
] as const;

/**
 * 全部按钮（对外，已冻结）。
 *
 * ## 与旧仓库矩阵的差异（都是本次裁定的结果）
 *
 * · **目标（goal）补了「成功 / 失败」按钮** —— 用户 `2026-11-13`：
 *   「状态的自动计算，取消所有通过自动计算到达终结态的通路。然后**增加人通过按钮
 *   进入终结态的通路**。」
 *   旧矩阵里 goal 的成功/失败只由「子任务全成功/有失败」自动推；那条通路按规则 1 删掉
 *   之后，若不给人类按钮，goal 就永远只能被取消、到不了成功 —— 任务板的核心用途会废掉。
 *   ⇒ 补 4 个状态 × 2 个按钮，`actor` 只有 `user`。
 *   ⚠ **goal 的「拒绝」仍然无入口**（旧矩阵就是无入口，由取代级联产生，不走按钮）。
 * · **任何到终结态的按钮都只有 `user`** —— 包括取消（规则 3 含 `CANCELED`）。
 * · **设计 / 记录的「确认」是用户按钮** —— 它进 `COMPLETED`。
 * · **工作（work）保留了「成功 / 失败」按钮** —— 用户点按钮进终结态是规则 2 的本意。
 */
export const BUTTON_ACTIONS: readonly ButtonAction[] = Object.freeze(
	BUTTON_TABLE satisfies readonly ButtonAction[],
);

/* ────────────────────────── 自动计算的目标 ────────────────────────── */

/**
 * 自动计算在某类别、某状态下的**允许目标**（永远不含终结态）。
 *
 * 依据是用户矩阵里每一节的「**系统**」条目，去掉全部终结态目标：
 *
 * | 类别 | 自动可达 |
 * |---|---|
 * | `goal` | 提交 / 处理中 / 需要信息 / 需要授权（子任务推父卡） |
 * | `work` | 提交 / 需要信息 / 需要授权（子任务推父卡；`处理中` 只能领取） |
 * | `design` | 需要信息 / 需要授权（非完成调研子任务把这卡推来推去） |
 * | `record` | **无**（矩阵里记录没有系统转移） |
 *
 * ⚠ 草稿不在任何一张表里 —— 用户 `2026-11-01 01:29`：「草稿不是有效卡」，
 * 自动计算不碰它。终结态也不在 —— 规则 1。
 *
 * @param kind 类别
 * @param from 当前状态
 * @returns 允许自动到达的目标状态（不含 `from` 自身）
 */
export function autoTargetsOf(kind: KindId, from: TaskState): readonly TaskState[] {
	/* 草稿不是有效卡；终态粘滞。两者都不参与自动计算。 */
	if (from === S.UNSPECIFIED || isEndedState(from)) return [];

	const allowed = AUTO_TARGETS_BY_KIND[kind];
	if (allowed === undefined) return [];
	return allowed.filter((state) => state !== from);
}

/** 各类别的自动可达集。 */
const AUTO_TARGETS_BY_KIND: Readonly<Record<string, readonly TaskState[]>> = Object.freeze({
	goal: Object.freeze([S.SUBMITTED, S.WORKING, S.INPUT_REQUIRED, S.AUTH_REQUIRED]),
	work: Object.freeze([S.SUBMITTED, S.INPUT_REQUIRED, S.AUTH_REQUIRED]),
	design: Object.freeze([S.INPUT_REQUIRED, S.AUTH_REQUIRED]),
	record: Object.freeze([]),
});

/* ────────────────────────────── 判定 ────────────────────────────── */

/**
 * 判定一次转移。
 *
 * ## 判定顺序（顺序本身是规则的一部分）
 *
 * 1. `from` / `to` 是否已知状态 ⇒ `UNKNOWN_STATE`
 * 2. 源与目标相同 ⇒ `SAME_STATE`（幂等写入不该走到这里）
 * 3. 类别是否已注册 ⇒ `UNKNOWN_KIND`
 * 4. `trigger === 'auto'` ⇒ 规则 1（终结态 `AUTO_CANNOT_END`；越界 `AUTO_TARGET_INVALID`）
 * 5. `trigger === 'ai'` 且目标是**任一**终结态（含取消）⇒ 规则 3（`AI_CANNOT_END`）
 * 6. 查按钮表：该 `(kind, from, to)` 存在且 `actors` 含本次主体 ⇒ 放行
 * 7. 否则 ⇒ `NOT_A_BUTTON`
 *
 * ⚠ **第 4 步先于第 6 步**：终结态按钮对 auto 一律不生效。
 * ⚠ **第 5 步先于第 6 步**：即使表里某条按钮误写了 `actors: ['ai']`，
 *   AI 也过不去 —— 判定不依赖表的正确性，表另有编译期断言守着。
 *
 * @param input kind / from / to / trigger
 * @returns 放行或带原因拒绝
 */
export function judgeTransition(input: {
	readonly kind: KindId;
	readonly from: TaskState;
	readonly to: TaskState;
	readonly trigger: TransitionTrigger;
}): TransitionVerdict | TransitionRejection {
	const { kind, from, to, trigger } = input;

	/* 1. 状态合法性 */
	if (!isTaskState(from) || !isTaskState(to)) return reject('UNKNOWN_STATE');

	/* 2. 同状态：不是转移。幂等写入请直接跳过，不要经过本函数。 */
	if (from === to) return reject('SAME_STATE');

	/* 3. 类别必须已注册（有按钮表或自动表） */
	if (!isKnownKind(kind)) return reject('UNKNOWN_KIND');

	/* 4. 规则 1：自动计算不许进终结态，也不许越出它的可达集。 */
	if (trigger === 'auto') {
		if (isEndedState(to)) return reject('AUTO_CANNOT_END');
		return autoTargetsOf(kind, from).includes(to) ? ALLOW : reject('AUTO_TARGET_INVALID');
	}

	/* 5. 规则 3：AI 不能进**任何**终结态 —— 包括取消。 */
	if (trigger === 'ai' && isEndedState(to)) return reject('AI_CANNOT_END');

	/* 6. 按钮表：这是规则 2 的实现 —— 只有表里的转移，人才点得出来。 */
	const actor: Actor = trigger === 'ai' ? 'ai' : 'user';
	const action = BUTTON_ACTIONS.find(
		(one) => one.kind === kind && one.from === from && one.to === to,
	);
	if (action === undefined) return reject('NOT_A_BUTTON');
	if (!action.actors.includes(actor)) return reject('NOT_A_BUTTON');

	return ALLOW;
}

/**
 * 规则 3（AI 不能进终结态）的完整口径。
 *
 * 用户 `2026-11-13`：「**人**通过按钮进入终结态」。
 * `CANCELED` 在终结态组里（`status.ts` 的 `ended` 组）⇒ **AI 一旦能取消，
 * 就是 AI 进了终结态，违反规则**。
 *
 * ⇒ AI 禁止的是**全部四个终结态**，不只是成功 / 失败 / 拒绝。
 * 旧矩阵里那些「ai 调用取消」不保留。
 *
 * 这条口径由 `isEndedState(to)` 实现（同一个组判别），
 * 另有编译期断言 `_AI_NEVER_REACHES_ENDED` 与测试穷举兜住。
 */

/** 类别是否已注册。 */
export function isKnownKind(kind: KindId): boolean {
	return Object.hasOwn(AUTO_TARGETS_BY_KIND, kind);
}

/** 放行常量（复用，避免每次分配）。 */
const ALLOW: TransitionVerdict = Object.freeze({ ok: true });

/** 造一个拒绝。 */
function reject(reason: TransitionRejectReason): TransitionRejection {
	return Object.freeze({ ok: false, reason });
}

/* ────────────────────────── 查询辅助（给 UI / AI 用） ────────────────────────── */

/**
 * 某类别在某状态下，某个主体**可以**走的目标状态。
 *
 * = `BUTTON_ACTIONS` 里 `from` 匹配、`actors` 含该主体的条目。
 * 给 UI 渲染菜单、给 AI 工具回答「现在能转去哪」。
 *
 * ⚠ 只回答「有没有按钮」，不判条件（依赖是否完成、是否已有处理中的工作卡）——
 *   那些要外部事实，由 core 判。
 */
export function buttonTargetsOf(kind: KindId, from: TaskState, actor: Actor): readonly TaskState[] {
	return BUTTON_ACTIONS.filter(
		(one) => one.kind === kind && one.from === from && one.actors.includes(actor),
	).map((one) => one.to);
}

/**
 * 某类别在某状态下的按钮清单（给人看的形状）。
 *
 * @param actor `'user'` 渲染界面；`'ai'` 用于工具说明
 */
export function buttonsOf(kind: KindId, from: TaskState, actor: Actor): readonly ButtonAction[] {
	return BUTTON_ACTIONS.filter(
		(one) => one.kind === kind && one.from === from && one.actors.includes(actor),
	);
}

/* ────────────────────────────── 编译期断言 ────────────────────────────── */

/*
 * 只存在于编译期，运行时零开销。失败侧必须是 `false` 而不是 `never`
 * —— `never` 满足任何约束，断言会静默通过。
 */

type AssertTrue<T extends true> = T;

/** 规则 1：`AUTO_STATES` 里一个终结态都没有。 */
type _AUTO_NEVER_ENDED = [Extract<EndedTaskState, (typeof AUTO_STATES)[number]>] extends [never]
	? true
	: false;

/** `AUTO_STATES` 覆盖了全部非终结状态（不多不少：四个组里除了 draft 与 ended）。 */
type _AUTO_COVERS_NON_ENDED = [
	Exclude<TaskState, typeof S.UNSPECIFIED | EndedTaskState>,
] extends [(typeof AUTO_STATES)[number]]
	? true
	: false;

/** 每条按钮的 `to` 都是合法状态（由字面量类型保证，这里显式收口一次）。 */
type _BUTTON_TARGETS_VALID = (typeof BUTTON_TABLE)[number]['to'] extends TaskState ? true : false;

/**
 * 规则 2 的结构性保证：**按钮表至少要能到达全部四个终结态**。
 * 少一个 ⇒ 那张卡永远收不了尾，是死锁。
 */
type _EVERY_ENDED_STATE_HAS_BUTTON = [EndedTaskState] extends [
	Extract<(typeof BUTTON_TABLE)[number]['to'], EndedTaskState>,
]
	? true
	: false;

/**
 * 规则 3 的结构性保证：**任何到终结态的按钮都不许把 `ai` 放进 `actors`**。
 *
 * 这是「AI 不能进终结态」在**表**这一层的硬约束 ——
 * 只改 `judgeTransition` 的判定还不够：表里留一条 `actors: ['user','ai']` 的
 * 终结按钮，判定虽然会拒，但 UI 若直接读表渲染就会给 AI 显示一个点不动的按钮。
 *
 * ⚠ 靠 `USER` 是 `as const` 元组才判得出来。若 `USER` 是 `readonly Actor[]`，
 * 这里会拿到 `'user' | 'ai'`，断言静默通过 —— 这类断言的典型失效方式。
 */
type _AI_NEVER_REACHES_ENDED = [
	Extract<(typeof BUTTON_TABLE)[number], { to: EndedTaskState }>['actors'][number],
] extends ['user']
	? true
	: false;

/**
 * 规则 2 补充：**goal 必须能由人点按钮到成功与失败**。
 *
 * 用户 `2026-11-13`：「然后增加人通过按钮进入终结态的通路。」
 * goal 的成功/失败旧来靠子任务自动推，那条通路被规则 1 删了
 * ⇒ 若表里没有这两条，goal 永远到不了成功，任务板的核心用途就废了。
 *
 * ⚠ **goal 的「拒绝」不在此断言里** —— 旧矩阵就是无入口（由取代级联产生），
 *   本次裁定也没有要求补它。
 */
type _GOAL_HAS_SUCCESS_AND_FAIL_BUTTONS = [
	Extract<(typeof BUTTON_TABLE)[number], { kind: 'goal'; to: typeof S.COMPLETED }>,
] extends [never]
	? false
	: [Extract<(typeof BUTTON_TABLE)[number], { kind: 'goal'; to: typeof S.FAILED }>] extends [never]
		? false
		: true;

export type _TRANSITION_TABLE_CONSISTENT = AssertTrue<
	[
		_AUTO_NEVER_ENDED,
		_AUTO_COVERS_NON_ENDED,
		_BUTTON_TARGETS_VALID,
		_EVERY_ENDED_STATE_HAS_BUTTON,
		_AI_NEVER_REACHES_ENDED,
		_GOAL_HAS_SUCCESS_AND_FAIL_BUTTONS,
	] extends [true, true, true, true, true, true]
		? true
		: false
>;
