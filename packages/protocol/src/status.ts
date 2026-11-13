/**
 * 任务板的九个状态 —— 词汇来源是 Agent2Agent (A2A) 协议的 `TaskState`
 * （v1.0.1 的 `specification/a2a.proto`）。
 *
 * ## 为什么是这九个
 *
 * A2A v1.0 的枚举恰好九个值，第 0 个是 `TASK_STATE_UNSPECIFIED`：
 *
 * ```
 * TASK_STATE_UNSPECIFIED = 0   ← 「未指定」，本仓库的术语叫「草稿」
 * TASK_STATE_SUBMITTED   = 1   ← 「提交」
 * TASK_STATE_WORKING     = 2   ← 「处理中」
 * TASK_STATE_COMPLETED   = 3   ← 「成功」
 * TASK_STATE_FAILED      = 4   ← 「失败」
 * TASK_STATE_CANCELED    = 5   ← 「取消」
 * TASK_STATE_INPUT_REQUIRED = 6 ← 「需要信息」
 * TASK_STATE_REJECTED    = 7   ← 「拒绝」
 * TASK_STATE_AUTH_REQUIRED  = 8 ← 「需要授权」
 * ```
 *
 * ⚠ v0.3 的 JSON 形式把第 9 个叫 `unknown`，那是旧版本的线上名称。
 * 本仓库取 **v1.0.1 的 `UNSPECIFIED`**，不做任何名称转换。
 * 协议若改版，`test/a2a-conformance.test.ts` 会报错（它拿官方 SDK 的
 * `taskStateToJSON` 逐个比对），而不是靠人记得升级。
 *
 * ## 「草稿」是组名，不是状态
 *
 * 用户 `2026-11-01 00:57`：「草稿不是组。只有一个情况，做类型联合没有意义。
 * 但是，他的实际名字是未指定。而我在里面的术语都会用草稿。」
 *
 * ⇒ `UNSPECIFIED` 是**唯一成员的单元素组**，组名叫「草稿」。
 * `DRAFT` 常量是它的别名，不是第十个状态。
 *
 * ## 本文件不含行为
 *
 * 没有转移判定、没有权限、没有读写。分组用普通比较即可，
 * 转移规则在 `transition.ts`，由用户裁定。
 */

/** 九个状态。键是短名，值是 A2A 协议全名。 */
export const TaskState = {
	UNSPECIFIED: 'TASK_STATE_UNSPECIFIED',
	SUBMITTED: 'TASK_STATE_SUBMITTED',
	WORKING: 'TASK_STATE_WORKING',
	INPUT_REQUIRED: 'TASK_STATE_INPUT_REQUIRED',
	AUTH_REQUIRED: 'TASK_STATE_AUTH_REQUIRED',
	COMPLETED: 'TASK_STATE_COMPLETED',
	FAILED: 'TASK_STATE_FAILED',
	CANCELED: 'TASK_STATE_CANCELED',
	REJECTED: 'TASK_STATE_REJECTED',
} as const;

/** 九个状态中的任一。 */
export type TaskState = (typeof TaskState)[keyof typeof TaskState];

/**
 * 九个状态的清单，顺序同 A2A 枚举。
 *
 * ⚠ 手工列出，不用 `Object.values(TaskState)` —— 那样顺序依赖对象字面量的
 * 书写顺序，而这份顺序要用于契约表（状态机、UI 菜单）。显式写出，
 * 且下面有编译期断言保证它与 `TaskState` 一一对应。
 */
export const TASK_STATES = [
	TaskState.UNSPECIFIED,
	TaskState.SUBMITTED,
	TaskState.WORKING,
	TaskState.INPUT_REQUIRED,
	TaskState.AUTH_REQUIRED,
	TaskState.COMPLETED,
	TaskState.FAILED,
	TaskState.CANCELED,
	TaskState.REJECTED,
] as const;

/**
 * 「草稿」= 未指定。
 *
 * 用户 `2026-11-01 00:57`：「他的实际名字是未指定。而我在里面的术语都会用草稿。」
 * ⇒ 代码里用本常量，不写字面量；它**不是**新状态。
 */
export const DRAFT: TaskState = TaskState.UNSPECIFIED;

/**
 * 状态组 —— **四个值**。
 *
 * ⚠ 与「按钮分段」不是一回事：按钮只有「推进 / 终结」两段。
 * 组的语义是**卡片停在哪一类里**：
 *
 * | 组 | 成员 |
 * |---|---|
 * | `draft` | 未指定（单成员） |
 * | `active` | 提交、处理中 |
 * | `shelved` | 需要信息、需要授权 |
 * | `ended` | 成功、失败、取消、拒绝 |
 *
 * 用户 `2026-11-01 06:55`：「"完成"，是一个状态组。包括成功，失败，取消，拒绝。」
 */
export type StatusGroup = 'draft' | 'active' | 'shelved' | 'ended';

/** 四个组的中文名。 */
export const GROUP_LABELS: Readonly<Record<StatusGroup, string>> = Object.freeze({
	draft: '草稿',
	active: '进行',
	shelved: '搁置',
	ended: '完成',
});

/**
 * 每个状态属于哪个组。
 *
 * ⚠ 类型是 `Record<TaskState, StatusGroup>` ⇒ 九个状态**每个都必须有归属**，
 * 漏一个就编译失败。这比「用四个 `is*Status` 函数各判断一次」更硬：
 * 那种写法漏一个只会落到假分支，不会报错。
 */
export const STATUS_GROUP_OF: Readonly<Record<TaskState, StatusGroup>> = Object.freeze({
	[TaskState.UNSPECIFIED]: 'draft',
	[TaskState.SUBMITTED]: 'active',
	[TaskState.WORKING]: 'active',
	[TaskState.INPUT_REQUIRED]: 'shelved',
	[TaskState.AUTH_REQUIRED]: 'shelved',
	[TaskState.COMPLETED]: 'ended',
	[TaskState.FAILED]: 'ended',
	[TaskState.CANCELED]: 'ended',
	[TaskState.REJECTED]: 'ended',
});

/** 某个状态属于哪个组。 */
export function groupOf(state: TaskState): StatusGroup {
	return STATUS_GROUP_OF[state];
}

/** 某个组包含哪些状态（顺序同 `TASK_STATES`）。 */
export function statesInGroup(group: StatusGroup): readonly TaskState[] {
	return TASK_STATES.filter((state) => STATUS_GROUP_OF[state] === group);
}

/** 是否是已知状态（用于校验外部输入）。 */
export function isTaskState(value: unknown): value is TaskState {
	return typeof value === 'string' && (TASK_STATES as readonly string[]).includes(value);
}

/**
 * 状态的中文名。
 *
 * 用户 `2026-11-01 06:43`：「9态的中文只在终端。例如 ui 层，ai 工具层，dsh 命令层。
 * 任务板内部交互用的就是英文名。」
 *
 * ⇒ 词表在这里，**消费方读它、不复制它**。
 *
 * ⚠ 措辞来自用户矩阵原话，不是我们造的：
 *   · `SUBMITTED` 是「提交」不是「已提交」（用户原话：「用户点击`采纳`，变成`提交`」）；
 *   · `ended` 是「完成」不是「结束」（用户原话：「"完成"，是一个状态组」）。
 */
export const STATE_LABELS: Readonly<Record<TaskState, string>> = Object.freeze({
	[TaskState.UNSPECIFIED]: '未指定',
	[TaskState.SUBMITTED]: '提交',
	[TaskState.WORKING]: '处理中',
	[TaskState.INPUT_REQUIRED]: '需要信息',
	[TaskState.AUTH_REQUIRED]: '需要授权',
	[TaskState.COMPLETED]: '成功',
	[TaskState.FAILED]: '失败',
	[TaskState.CANCELED]: '取消',
	[TaskState.REJECTED]: '拒绝',
});

/** 状态的中文名；未知状态回落原值（不抛，便于展示脏数据）。 */
export function labelOf(state: string): string {
	return isTaskState(state) ? STATE_LABELS[state] : state;
}

/*
 * ── 编译期断言：清单与词表必须一一对应 ─────────────────────────────
 *
 * 只存在于编译期，运行时零开销。失败侧必须是 `false` 而不是 `never`
 * —— `never` 满足任何约束，断言会静默通过。
 */

type AssertTrue<T extends true> = T;

/** `TASK_STATES` 恰好九个。 */
type _ExactlyNine = (typeof TASK_STATES)['length'] extends 9 ? true : false;

/** `TASK_STATES` 覆盖 `TaskState` 的每个值（不多不少）。 */
type _CoversAll = [TaskState] extends [(typeof TASK_STATES)[number]] ? true : false;

/** 每个状态都有组归属。 */
type _EveryStateGrouped = [TaskState] extends [keyof typeof STATUS_GROUP_OF] ? true : false;

/** 每个状态都有中文名。 */
type _EveryStateLabeled = [TaskState] extends [keyof typeof STATE_LABELS] ? true : false;

export type _STATUS_VOCABULARY_CONSISTENT = AssertTrue<
	[_ExactlyNine, _CoversAll, _EveryStateGrouped, _EveryStateLabeled] extends [
		true,
		true,
		true,
		true,
	]
		? true
		: false
>;
