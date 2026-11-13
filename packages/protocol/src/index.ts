/**
 * 任务板协议 —— 只放**不会随实现变化**的词汇与形状。
 *
 * ## 这个包放什么、不放什么
 *
 * | 放 | 为什么 |
 * |---|---|
 * | 九个状态 + 四个组 + 中文名 | A2A 协议给定，改版要跟 |
 * | 五条边 + 派生字段 = 六种关系 | 词汇，不是实现 |
 * | 错误码 + 下一步提示 | 跨 UI / AI / 命令三处的共同语言 |
 *
 * | **不放** | 为什么 |
 * |---|---|
 * | 模板 / 章节 / action 的**形状** | 它们是**注册进来的数据**，形状归 core 的 loader；写在这里就是第二份真值 |
 * | 状态转移判决 | 规则由用户裁定，放在 core |
 * | 存储 / 搜索接口 | 它们是可替换实现，归 core 定义 |
 *
 * ## 零运行时依赖
 *
 * 本包不 import 任何东西，包括 `node:` 内置模块 ⇒ **既能进 Node 也能进浏览器**。
 * 由 `test/no-node-imports.test.ts` 守着。
 *
 * ## 谁依赖它
 *
 * ```
 * protocol ──► core ──┬──► dsh
 *                     └──► mcp（二期）
 * ```
 *
 * 三个包都只读它，谁也不改它。
 */

export {
	TaskState,
	TASK_STATES,
	DRAFT,
	GROUP_LABELS,
	STATUS_GROUP_OF,
	STATE_LABELS,
	groupOf,
	statesInGroup,
	isTaskState,
	labelOf,
	type StatusGroup,
} from './status.ts';

export {
	LINK_KINDS,
	LINK_KINDS as LINKS,
	BEHAVIOR_LINK,
	UNDIRECTED_LINK,
	RELATION_KINDS,
	linkKindOf,
	isLinkKindId,
	type LinkKind,
	type LinkKindId,
	type BehaviorLinkKind,
	type UndirectedLinkKind,
	type RelationKindId,
} from './relation.ts';

export {
	ErrorCode,
	ERROR_HINTS,
	failure,
	isFailure,
	type Failure,
	type FieldIssue,
} from './error.ts';

export {
	judgeTransition,
	autoTargetsOf,
	endedStates,
	isEndedState,
	isKnownKind,
	buttonTargetsOf,
	buttonsOf,
	AUTO_STATES,
	BUTTON_ACTIONS,
	type Actor,
	type KindId,
	type TransitionTrigger,
	type TransitionVerdict,
	type TransitionRejection,
	type TransitionRejectReason,
	type EndedTaskState,
	type ButtonAction,
	type ButtonMethod,
} from './transition.ts';
