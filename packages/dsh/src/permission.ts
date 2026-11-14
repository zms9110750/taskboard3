/**
 * 权限 guard —— 「领取了工作，才有权限」的 dsh 侧接线。
 *
 * ## core 给什么、这里做什么
 *
 * `@taskboard/core` 的 `permission.ts` 是**纯判定**（`judgeToolCall`），
 * 它不认识 dsh、不知道 agent、不算持有卡、不读预设。本文件做四件事：
 *
 * ```
 * ① 从 exec 取 agent
 * ② 读当前会话的权限预设名 → 映射成 core 的 BoardMode
 * ③ 收集这个 agent 持有的工作卡（core 要的 heldCards）
 * ④ 调 core.judgeToolCall，把拒绝理由作为 guard 的返回值
 * ```
 *
 * ## ⚠ 核心语义：与 DSH 自己的权限**互斥**
 *
 * 用户 `2026-11-14`：
 *
 * > 我说的是和dsh自己的权限互斥。只要开的是他自己或者别的插件提供的权限。
 * > 那么这个插件给的限制都不生效。
 *
 * ⇒ 我们**只认** core 的 `BOARD_PRESETS` 那三个预设名。不是那三个
 *   （含 `undefined` = 没装预设服务）⇒ `mode === undefined` ⇒ core 一律放行。
 *
 * 这就是「开发者权限」的实现：切到 DSH 出厂的「完全访问」，我们什么都不管，
 * AI 自然能改权限。**不新增第四个预设**（用户：「没有必要为此就让我们再开一个新的权限」）。
 *
 * ## ⚠ 一个身份，不是两个
 *
 * 上一版这里有 `scope`（根会话 UUID，给权限编辑开关用）和 `holder`
 * （agent 名字，给持有卡用）两个身份。现在**开关没了** ——
 * 改权限靠切预设，不靠内存开关 ⇒ `scope` 整个删除，只剩 `holder`。
 *
 * 这不是简化，是**删掉了一个已经不存在的概念**：
 * 开关是「纯内存、重启即关」的临时机制，用户把它换成了预设表里的三个档。
 *
 * ## ⚠ guard 是同步的
 *
 * `ToolGuard = (execution) => string | ToolGuardDenial | undefined`
 * （`dsh-tools/src/contracts.ts:410`）
 *
 * ⇒ 里面**不能 await**。本文件的取法全部同步：
 * `permissionPresets.current(session)` / `taskboard.list()` / `judgeToolCall()` 都是同步的。
 *
 * ## ⚠ 已知限制：只看「第一个工作空间」
 *
 * guard 每次工具调用都跑，不能遍历所有空间（每个空间一次 `loadAll`，会拖慢）。
 * ⇒ 只查 `listWorkspaces(false)[0]`。
 *
 * **后果**：用户在第二个空间领的卡，guard 看不见 ⇒ 那些卡授予的增量不生效。
 * 这是**已知限制**，不是 bug。真要修得让 core 提供「按 holder 反查」的索引，
 * 或让调用方显式传 workspaceId。
 */

import type { BoardMode, Card, Taskboard } from '@taskboard/core';
import { boardModeOf, isHeldBy } from '@taskboard/core';
import { TaskState } from '@taskboard/protocol';

/* ────────────────────────── 身份 ────────────────────────── */

/**
 * `ctx.subagents` 的最小形状 —— 本文件只用到 `namesOf`。
 *
 * ⚠ 与 `holder.ts` 的 `SubagentsLike` **故意不合并**：
 *   两者现在字段相同，但用途不同（holder 用名字落库、guard 用名字找持有卡）。
 *   合并会让「只是要个名字」的地方被迫接受更多方法。
 *
 * ⚠ `namesOf` 会**抛错**（agent 不在任何 subagent 树里）⇒ 调用方必须 try/catch。
 */
export interface PermissionSubagentsLike {
	namesOf(agent: unknown): { readonly self: string };
}

/** 从 `exec` 取 agent（缺席时 `undefined`）。 */
function agentOf(exec: unknown): { readonly id?: string; readonly session?: unknown } | undefined {
	if (typeof exec !== 'object' || exec === null) return undefined;
	const agent = (exec as { agent?: unknown }).agent;
	if (typeof agent !== 'object' || agent === null) return undefined;
	return agent as { readonly id?: string; readonly session?: unknown };
}

/** 判断对象是否能当 `PermissionSubagentsLike` 用。 */
function hasSubagents(value: unknown): value is PermissionSubagentsLike {
	if (typeof value !== 'object' || value === null) return false;
	return typeof (value as { namesOf?: unknown }).namesOf === 'function';
}

/**
 * 取本次调用的 holder（卡片持有者标识）。
 *
 * 三条回落与 `holder.ts` 完全一致 —— **必须一致**，否则
 * 「claim 时存的 holder」和「guard 时找的 holder」会对不上，
 * 表现是「领了卡但权限不生效」这种静默错误。
 *
 * @param subagents `ctx.subagents`；可缺席（无 subagent 的 profile）
 * @param exec 工具执行上下文
 */
export function holderOf(subagents: unknown, exec: unknown): string {
	const agent = agentOf(exec);
	if (agent === undefined) return 'unknown';

	const id = typeof agent.id === 'string' && agent.id !== '' ? agent.id : 'unknown';
	if (!hasSubagents(subagents)) return id;

	try {
		const name = subagents.namesOf(agent).self;
		if (typeof name === 'string' && name !== '') return name;
	} catch {
		/* 不在树里 ⇒ 回落 UUID。**不编名字** —— 猜名字会让两个 agent 撞到同一个 holder。 */
	}
	return id;
}

/* ────────────────────────── 持有卡 ────────────────────────── */

/**
 * 收集一个 holder 当前持有的**工作卡**。
 *
 * ## 为什么只查第一个空间
 *
 * 见文件头的「已知限制」。
 *
 * ## 为什么过滤 `TASK_STATE_WORKING`
 *
 * core 的判定模型是「领取了工作，才有权限」——
 * 只有「处理中」的卡才带执行权限。搁置 / 提交态的卡不算持有（虽然 `holders` 里有名字）。
 *
 * @returns core 的 `judgeToolCall` 要的形状（**只有 `templateRef`**，不是完整 Card）
 */
export function heldWorkCardsOf(
	taskboard: Taskboard,
	holder: string,
): { readonly cards: readonly Card[]; readonly workspaceId: string } {
	if (holder === '' || holder === 'unknown') return { cards: [], workspaceId: '' };

	const workspace = taskboard.listWorkspaces(false)[0];
	if (workspace === undefined) return { cards: [], workspaceId: '' };

	/* 同步：`list()` 从内存读，一次 `loadAll`。 */
	const cards = taskboard
		.list(workspace.id)
		.filter((card) => card.status === TaskState.WORKING && isHeldBy(card, holder));

	return { cards, workspaceId: workspace.id };
}

/* ────────────────────────── 模式 ────────────────────────── */

/** 预设名解析器（由 `index.ts` 注入 —— 本文件不 import `@deepseek-ai/*`）。 */
export type PresetNameOf = (agent: unknown) => string | undefined;

/**
 * 取当前会话的模式。
 *
 * @returns `undefined` = 不是任务板的预设（**含「没装预设服务」**）⇒ 一律放行
 *
 * ⚠ 任何一步失败都返回 `undefined`（放行方向）——
 *   取不到预设名说明我们不知道现在是什么模式，而**不知道就不该拦**：
 *   拦截错误的代价是用户完全不能用 dsh，放行的代价只是这一轮没设防。
 */
export function modeOf(presetNameOf: PresetNameOf | undefined, agent: unknown): BoardMode | undefined {
	if (presetNameOf === undefined) return undefined;
	try {
		return boardModeOf(presetNameOf(agent));
	} catch {
		return undefined;
	}
}

/* ────────────────────────── guard ────────────────────────── */

/**
 * 造一个「从 exec 读模式」的读取器。
 *
 * ⚠ 工具层（`tools.ts` 的 `taskboard_adopt`）也要读模式 ——
 *   但工具拿到的是 `exec`，而 `modeOf` 要的是 `agent`。
 *   本函数把这一层转换收口，避免两处各自拆 `exec.agent`。
 *
 * @returns 读取器；`presetNameOf` 缺席时恒返回 `undefined`（= 非任务板预设）
 */
export function execModeReader(
	presetNameOf: PresetNameOf | undefined,
): (exec: unknown) => BoardMode | undefined {
	return (exec: unknown) => modeOf(presetNameOf, agentOf(exec));
}

/** guard 的依赖。 */
export interface GuardDeps {
	readonly taskboard: Taskboard;
	/** `ctx.subagents`；可缺席。 */
	readonly subagents?: unknown;
	/**
	 * 读「当前会话的权限预设名」。
	 *
	 * ⚠ 由 `index.ts` 注入。`undefined` ⇒ 没有预设服务 ⇒ 模式取不到 ⇒ 一律放行。
	 */
	readonly presetNameOf?: PresetNameOf;
}

/** guard 的返回值（与 `dsh-tools` 的 `ToolGuard` 同形，但不 import 它的类型）。 */
export type GuardVerdict = string | undefined;

/**
 * 造一个权限 guard。
 *
 * 判定顺序：
 *
 * ```
 * ① 取 agent（缺席 ⇒ 放行：程序化调用不归我们管）
 * ② 取工具名（空 ⇒ 放行）
 * ③ 取模式（`undefined` ⇒ 放行：不是任务板的预设）
 * ④ 收集持有卡
 * ⑤ 调 core.judgeToolCall
 * ⑥ 拒绝 ⇒ 返回理由（guard 的返回值即拒绝理由）
 * ```
 *
 * ⚠ **任何一步出错都不阻断**：guard 抛错会让整个工具调用失败，
 *   而权限判定的失败方向应该是「放行并记日志」还是「拒绝」？
 *
 *   **这里选放行** —— 理由：guard 是**加装**的（DSH 默认没有这个插件），
 *   我们坏了不该让用户完全不能用 dsh。**但会 `console.error`**，不是静默。
 *   （与 `core/bus.ts` 的 emit 同一个取舍：出错要看得见。）
 *
 *   注意这与「core 判定拒绝」是**两件事**：core 返回 `{ok:false}` 是**正常拒绝**
 *   （语义上的「没权限」），不走这条；只有**代码抛异常**才放行。
 */
export function createPermissionGuard(deps: GuardDeps): (exec: unknown) => GuardVerdict {
	const { taskboard, subagents, presetNameOf } = deps;

	return (exec: unknown): GuardVerdict => {
		const agent = agentOf(exec);
		if (agent === undefined) return undefined;

		const toolName = nameOf(exec);
		if (toolName === '') return undefined;

		try {
			const mode = modeOf(presetNameOf, agent);
			/* ③ 不是任务板的预设 ⇒ 一律放行（互斥语义）。 */
			if (mode === undefined) return undefined;

			const { cards } = heldWorkCardsOf(taskboard, holderOf(subagents, exec));
			/*
			 * ⚠ core 要的是**窄形状**（只有 `templateRef`），不是完整 Card。
			 *   映射在这里做，而不是让 core 认识 Card —— 那是反向依赖。
			 */
			const heldCards = cards.map((card) => ({ templateRef: card.template.ref }));

			const verdict = taskboard.judgeToolCall({ mode, toolName, heldCards });
			return verdict.ok ? undefined : `[任务板权限] ${verdict.reason}`;
		} catch (error) {
			/* 见上面 JSDoc：加装模块坏了不该让用户完全不能用 dsh，但必须看得见。 */
			console.error('[taskboard3-permission] 权限判定失败，本次放行：', error);
			return undefined;
		}
	};
}

/** 从 `exec` 取工具名。 */
function nameOf(exec: unknown): string {
	if (typeof exec !== 'object' || exec === null) return '';
	const name = (exec as { name?: unknown }).name;
	return typeof name === 'string' ? name : '';
}
