/**
 * 权限 guard —— 「领取了工作，才有权限」的 dsh 侧接线。
 *
 * ## core 给什么、这里做什么
 *
 * `@taskboard/core` 的 `permission.ts` 是**纯判定**（`judgeToolCall`），
 * 它不认识 dsh、不知道 agent、不算持有卡。本文件做三件事：
 *
 * ```
 * ① 从 exec 取身份（scope + holder）
 * ② 收集这个身份持有的工作卡（core 要的 heldCards）
 * ③ 调 core.judgeToolCall，把拒绝理由作为 guard 的返回值
 * ```
 *
 * ## ⚠ 两个身份不是一个东西 —— 这是最容易搞错的地方
 *
 * | 用途 | 取法 | 形态 |
 * |---|---|---|
 * | **权限编辑开关的 scope** | `subagents.rootOf(agent).id` | 根会话 **UUID** |
 * | **持有卡的持有者** | `subagents.namesOf(agent).self` | agent **名字**（`lead`） |
 *
 * 为什么必须分开：
 *
 * - **卡上的 `holders` 存的是名字**（`claim` 时按 DSH 官方 Agent Teams 的做法存
 *   `namesOf().self`）⇒ 找「我持有的卡」只能比名字；
 * - **权限编辑开关是用户从界面点的**，而界面**拿不到 agent 名字**，
 *   只能拿到会话 id ⇒ 开关的 key 必须是 UUID。
 *
 * ⇒ 两者都从同一个 `agent` 推出来，但**不是同一个值**。混用会导致
 *   「开关打开了但判定看不见」或「持有卡查不到」—— 两者都是静默错误。
 *
 * ## ⚠ guard 是同步的
 *
 * `ToolGuard = (execution) => string | ToolGuardDenial | undefined`
 * （`dsh-tools/src/contracts.ts:410`）
 *
 * ⇒ 里面**不能 await**。本文件的取法全部同步：
 * `taskboard.listWorkspaces()` / `taskboard.list()` / `taskboard.judgeToolCall()` 都是同步的。
 *
 * ## ⚠ 已知限制：只看「第一个工作空间」
 *
 * guard 每次工具调用都跑，不能遍历所有空间（每个空间一次 `loadAll`，会拖慢）。
 * ⇒ 只查 `listWorkspaces(false)[0]`。
 *
 * **后果**：用户在第二个空间领的卡，guard 看不见 ⇒ 那些卡授予的 extra 不生效。
 * 这是**已知限制**，不是 bug。真要修得让 core 提供「按 holder 反查」的索引，
 * 或让调用方显式传 workspaceId。
 */

import type { Taskboard, Card } from '@taskboard/core';
import { isHeldBy } from '@taskboard/core';
import { TaskState } from '@taskboard/protocol';

/**
 * 本插件要求的权限预设名。
 *
 * 用户在这里点「任务板接管」之后，guard 才开始判权限；否则 dsh 自己的
 * 沙箱 / 审批机制照常。**这是「要不要让任务板管权限」的开关**，
 * 不是任务板自己的权限开关（那个是 `setPolicyEdit`）。
 *
 * ⚠ 需要在 profile 的 `permission-presets` 表里配出这个名字才生效 ——
 *   本插件**不替用户装配**（依赖语义）。配不出时 guard 对所有调用生效，
 *   见 `createPermissionGuard` 的 `presetName` 注释。
 */
export const PERMISSION_PRESET = 'taskboard-guard';

/* ────────────────────────── 身份 ────────────────────────── */

/**
 * `ctx.subagents` 的最小形状 —— 本文件用到**两个**方法。
 *
 * ⚠ 与 `holder.ts` 的 `SubagentsLike` 不同：那个只需要 `namesOf`（holder 用），
 *   这里还要 `rootOf`（scope 用）。**故意不合并** —— 两个文件用的能力不同，
 *   合并会让「只需要名字」的地方也假装需要 `rootOf`。
 *
 * ⚠ 两个方法都**可能抛错**（agent 不在任何 subagent 树里，或服务未就绪）
 *   ⇒ 调用方必须 try/catch。
 */
export interface PermissionSubagentsLike {
	namesOf(agent: unknown): { readonly self: string };
	rootOf(agent: unknown): { readonly id?: string };
}

/** 一次工具调用的身份。两个字段用途不同，见文件头。 */
export interface CallerIdentity {
	/** 权限编辑开关的 key —— 根会话 UUID。 */
	readonly scope: string;
	/** 卡片持有者 —— agent 名字（`lead` / `reviewer/checker`），或 UUID 兜底。 */
	readonly holder: string;
}

/** 从 `exec` 取 agent（缺席时 `undefined`）。 */
function agentOf(exec: unknown): { readonly id?: string } | undefined {
	if (typeof exec !== 'object' || exec === null) return undefined;
	const agent = (exec as { agent?: unknown }).agent;
	if (typeof agent !== 'object' || agent === null) return undefined;
	return agent as { readonly id?: string };
}

/** 判断对象是否能当 `PermissionSubagentsLike` 用。 */
function hasSubagents(value: unknown): value is PermissionSubagentsLike {
	if (typeof value !== 'object' || value === null) return false;
	const one = value as { namesOf?: unknown; rootOf?: unknown };
	return typeof one.namesOf === 'function' && typeof one.rootOf === 'function';
}

/**
 * 取本次调用的身份。
 *
 * @param subagents `ctx.subagents`；可缺席（无 subagent 的 profile）
 * @param exec 工具执行上下文
 * @returns 两个身份；`agent` 缺席时两者都是 `'unknown'`
 */
export function identityOf(subagents: unknown, exec: unknown): CallerIdentity {
	const agent = agentOf(exec);
	if (agent === undefined) return { scope: 'unknown', holder: 'unknown' };

	const id = typeof agent.id === 'string' && agent.id !== '' ? agent.id : 'unknown';

	/* 没有 subagents 服务 ⇒ 两者都回落 UUID。
	 * ⚠ 这时 scope 与 holder 相同 —— 是**唯一**能自洽的回落：
	 *   卡上的 holder 会存成 UUID（见 holder.ts），开关的 key 也是 UUID，
	 *   两边仍然对得上。 */
	if (!hasSubagents(subagents)) return { scope: id, holder: id };

	let scope = id;
	let holder = id;

	/* ① scope：根会话 UUID。取不到（agent 不在树里）⇒ 用自己。 */
	try {
		const root = subagents.rootOf(agent);
		const rootId = typeof root.id === 'string' && root.id !== '' ? root.id : '';
		if (rootId !== '') scope = rootId;
	} catch {
		/* 不在树里 ⇒ scope 保持自己的 UUID。子 agent 各自独立开关，可接受。 */
	}

	/* ② holder：agent 名字。取不到 ⇒ 用自己。 */
	try {
		const name = subagents.namesOf(agent).self;
		if (typeof name === 'string' && name !== '') holder = name;
	} catch {
		/* 同上。**不编名字** —— 猜名字会让两个 agent 撞到同一个 holder。 */
	}

	return { scope, holder };
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
	/**
	 * 读「当前会话的权限预设名」。
	 *
	 * ⚠ 由 `index.ts` 注入，本文件不 import `@deepseek-ai/*` 的类型。
	 *   返回 `undefined` ⇒ 该会话没有预设服务 ⇒ **不归本 guard 管，放行**。
	 */
	readonly presetOf?: (agent: unknown) => string | undefined;
	/** 本插件要求的预设名。省略 = 不按预设过滤（任何预设都管）。 */
	readonly presetName?: string;
}

/** guard 的返回值（与 `dsh-tools` 的 `ToolGuard` 同形，但不 import 它的类型）。 */
export type GuardVerdict = string | undefined;

/**
 * 造一个权限 guard。
 *
 * 判定顺序：
 *
 * ```
 * ① 预设不是本插件要的那个 ⇒ 放行（不归我们管）
 * ② 取身份（scope + holder）
 * ③ 收集持有卡
 * ④ 调 core.judgeToolCall
 * ⑤ 拒绝 ⇒ 返回理由（guard 的返回值即拒绝理由）
 * ```
 *
 * ⚠ **任何一步出错都不阻断**：guard 抛错会让整个工具调用失败，
 *   而权限判定的失败方向应该是「放行并记日志」还是「拒绝」？
 *
 *   **这里选放行** —— 理由：guard 是**加装**的（DSH 默认没有这个插件），
 *   我们坏了不该让用户完全不能用 dsh。**但会 `console.error`**，不是静默。
 *   （与 `core/bus.ts` 的 emit 同一个取舍：出错要看得见。）
 */
export function createPermissionGuard(deps: GuardDeps): (exec: unknown) => GuardVerdict {
	const { taskboard, subagents, presetOf, presetName } = deps;

	return (exec: unknown): GuardVerdict => {
		const agent = agentOf(exec);
		if (agent === undefined) return undefined;

		/* ① 预设过滤：不是我们的预设 ⇒ 不管。 */
		if (presetName !== undefined && presetOf !== undefined) {
			let current: string | undefined;
			try {
				current = presetOf(agent);
			} catch {
				current = undefined;
			}
			if (current !== presetName) return undefined;
		}

		const toolName = nameOf(exec);
		if (toolName === '') return undefined;

		try {
			const identity = identityOf(subagents, exec);
			const { cards } = heldWorkCardsOf(taskboard, identity.holder);
			/*
			 * ⚠ core 要的是**窄形状**（只有 `templateRef`），不是完整 Card。
			 *   映射在这里做，而不是让 core 认识 Card —— 那是反向依赖。
			 */
			const heldCards = cards.map((card) => ({ templateRef: card.template.ref }));

			const verdict = taskboard.judgeToolCall({
				scope: identity.scope,
				toolName,
				heldCards,
			});
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
