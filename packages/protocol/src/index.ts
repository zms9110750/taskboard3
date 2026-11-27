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
 * TODO(审查): 这张表说“状态转移判决不吃、放 core”，但本包 src/transition.ts 就是判决表 + judgeTransition，且从本文件导出。
 * 二选一：(A) 承认 protocol 是内置状态机所有者，改这张表并把 kind 词汇收进来；(B) 把表+判定迁去 core。属架构裁定，需用户定。
 *
 * ## 零运行时依赖
 *
 * 本包不 import 任何东西，包括 `node:` 内置模块 ⇒ **既能进 Node 也能进浏览器**。
 * 由 `test/no-node-imports.test.ts` 守着。
 *
 * TODO(审查): 这个测试文件不存在（test/ 下只有 transition.test.ts）⇒ 零 node 依赖无人守。
 * 可直接改：补测试（node:fs 扫 src/** 的 import 说明符，零新依赖），或删掉这句承诺。
 *
 * TODO(审查): package.json `files:["lib"]` + tsconfig.base 的 declarationMap/sourceMap ⇒ 产物 map 的 sources 指向 ../../src/*.ts，
 * 而 src 不随包发布，点“跳到源码”会断。可直接改：files 加 "src"，或本包关掉 declarationMap/sourceMap（非源码问题，故记在文件头）。
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
	// TODO(审查): LINKS 是死别名 —— lead 核实四个包 src 零命中（外部 MCP 未知），包内也零引用。
	// 可直接改：删掉这行别名导出；本包尚未给外部发布，删除成本最低。
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
