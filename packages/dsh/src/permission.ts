/**
 * 权限 guard —— 「领取了工作，才有权限」的 dsh 侧接线。
 *
 * ## core 给什么、这里做什么
 *
 * `@taskboard/core` 的 `permission.ts` 是**纯判定**（`judgeToolCall`），
 * 它不认识 dsh、不知道 agent、不算持有卡。本文件做三件事：
 *
 * ```
 * ① 从 exec 取 agent
 * ② 收集这个 agent 持有的工作卡（core 要的 heldCards）
 * ③ 调 taskboard.judgeToolCall，把拒绝理由作为 guard 的返回值
 * ```
 *
 * ## ⚠ 档位**不在这里读**（`2026-11-19` 两条正交轴定稿）
 *
 * 两条轴的档位（`CardActionLevel` / `ToolGuardLevel`）是任务板的**全局状态**，
 * 由 core 实例自己从 kv 缓存读。`judgeToolCall` 的入参因此只有
 * `{ toolName, heldCards }` —— **没有档位**。
 *
 * ⇒ dsh 侧不需要、也不该知道「当前是什么档」：
 *   知道了就要在 HTTP / 工具 / guard 三处各拼一遍，三处会漂。
 *   「用户能不能让 AI 领卡 / 采纳草稿」是 core 的判定，不是 dsh 的。
 *
 * ## ⚠ 与 DSH 自己的权限**互不干涉**
 *
 * 上一版把 DSH 的权限预设名映射成 core 的 `BoardMode`（只在任务板预设下生效）。
 * 用户 `2026-11-19` 把模型改成两条正交轴之后，**预设表那一层整个删掉了** ——
 * DSH 的预设只管 DSH 的 sandbox / approval，任务板只读自己的两个档位。
 *
 * 用户 `2026-11-14`：
 *
 * > 我说的是和dsh自己的权限互斥。只要开的是他自己或者别的插件提供的权限。
 * > 那么这个插件给的限制都不生效。
 *
 * 现在的对应关系：把宿主轴调到 `off`（「任务板不管理」）就是「不设防」——
 * 那是宿主自己的选择，不再靠 DSH 预设名反推。
 *
 * ## ⚠ guard 是同步的
 *
 * `ToolGuard = (execution) => string | ToolGuardDenial | undefined`
 * （`dsh-tools/src/contracts.ts:410`）
 *
 * ⇒ 里面**不能 await**。本文件的取法全部同步：
 * `taskboard.list()` / `taskboard.judgeToolCall()` 都是同步的。
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

import type { Card, Taskboard } from '@taskboard/core';
import { isHeldBy } from '@taskboard/core';
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

/* ────────────────────────── guard ────────────────────────── */

/** guard 的依赖。 */
export interface GuardDeps {
	readonly taskboard: Taskboard;
	/** `ctx.subagents`；可缺席。 */
	readonly subagents?: unknown;
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
 * ③ 收集持有卡（core 要的 heldCards）
 * ④ 调 taskboard.judgeToolCall({ toolName, heldCards })
 * ⑤ 拒绝 ⇒ 返回理由（guard 的返回值即拒绝理由）
 * ```
 *
 * ⚠ **档位不在入参里**：core 的 `judgeToolCall` 自己从实例缓存读两条轴的档位。
 *   本文件只提供「这个 agent 持有哪些工作卡」这一个事实。
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
	const { taskboard, subagents } = deps;

	return (exec: unknown): GuardVerdict => {
		const agent = agentOf(exec);
		if (agent === undefined) return undefined;

		const toolName = nameOf(exec);
		if (toolName === '') return undefined;

		try {
			const { cards } = heldWorkCardsOf(taskboard, holderOf(subagents, exec));
			/*
			 * ⚠ core 要的是**窄形状**（只有 `templateRef`），不是完整 Card。
			 *   映射在这里做，而不是让 core 认识 Card —— 那是反向依赖。
			 */
			const heldCards = cards.map((card) => ({ templateRef: card.template.ref }));

			const verdict = taskboard.judgeToolCall({ toolName, heldCards });
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
