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
 * 任务板的权限是**两条正交轴**（`2026-11-19` 定稿）：
 *
 * ```
 * UI 轴（用户定）    CardActionLevel : no-claim / claim / adopt
 * 宿主轴（DSH 定）   ToolGuardLevel  : off / manage / manage-edit
 * ```
 *
 * 两条轴都是**任务板自己的全局状态**（core 从 kv 读），与 DSH 自己的
 * sandbox / approval 权限**互不映射**：任务板既不读 DSH 的权限项，
 * 也不往 DSH 的权限注册表里写任何东西。
 *
 * 用户 `2026-11-14`：
 *
 * > 我说的是和dsh自己的权限互斥。只要开的是他自己或者别的插件提供的权限。
 * > 那么这个插件给的限制都不生效。
 *
 * 现在的对应关系：把宿主轴调到 `off`（「任务板不管理」）就是「不设防」——
 * 那是宿主自己的选择。
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

import { judgeToolCall, readToolGuardLevelOf, type ToolGuardKv } from './tool-guard.ts';

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
// TODO(审查): 这条「与 holder.ts 的 SubagentsLike 故意不合并」的理由已被推翻：@taskboard/dsh-tools 的
//   holder.ts 存在且导出 holderOf，本包应直接复用而不是维护第二份。需用户决定：删掉本接口并 import
//   dsh-tools 的类型（依赖方向本来就允许）。
export interface PermissionSubagentsLike {
	namesOf(agent: unknown): { readonly self: string };
}

/** 从 `exec` 取 agent（缺席时 `undefined`）。 */
interface AgentLike {
	readonly id?: string;
	readonly session?: unknown;
}

function agentOf(exec: unknown): AgentLike | undefined {
	if (typeof exec !== 'object' || exec === null) return undefined;
	const agent = (exec as { agent?: unknown }).agent;
	if (typeof agent !== 'object' || agent === null) return undefined;
	return agent as AgentLike;
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
 * @param agent 已经解析过的 `exec.agent`（可选）。`createPermissionGuard` 自己解析过一次，
 *   传进来避免对同一个 `exec` 解析两遍；省略时内部仍从 `exec` 解析（向后兼容）。
 */
// TODO(审查): 与 @taskboard/dsh-tools holder.ts 的 holderOf 有一处行为分歧：namesOf 返回空 self 时，
//   本函数回落 agent.id，而 dsh-tools 版直接返回 ''。claim 用 dsh-tools 写、guard 用本函数读 ⇒ 空 self
//   的 agent 领卡后 holder 对不上，权限静默不生效（推断 root 的 self 为空，未核实）。需用户决定语义后
//   两边只留一份（建议直接复用 dsh-tools 的 holderOf）。
export function holderOf(
	subagents: unknown,
	exec: unknown,
	agent: AgentLike | undefined = agentOf(exec),
): string {
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
 * @returns `cards` —— 完整的「处理中 + 本 holder 持有」卡（**不是**窄形状；映射成
 *   `{ templateRef }` 是 `createPermissionGuard` 的职责，本函数不替 core 减字段）。
 *   `workspaceId` —— 本次查的是哪个工作空间，**仅供测试 / 演示断言**；
 *   生产调用方（`createPermissionGuard`）直接丢弃它。
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
	/**
	 * agent 侧档位的存储端口（`CardStore` 的 kv 两方法）。
	 *
	 * ⚠ 档位**不归 core**（用户 `2026-11-23`）：它由本包拥有，
	 *   借用 store 的 kv 端口落库（键沿用 `taskboard.permission.toolGuardLevel`）。
	 */
	readonly kv: ToolGuardKv;
	/** `ctx.subagents` 的快照（旧通道，测试直传用）；可缺席。 */
	readonly subagents?: unknown;
	/**
	 * DI 通道（用户 `2026-11-27` 裁定）：每次判定时解析当前 subagents。
	 *
	 * 优先于 `subagents` 快照 —— 晚激活 / 卸载中的服务都能被看到。
	 */
	readonly resolveSubagents?: () => unknown;
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
	const { taskboard, kv, subagents } = deps;

	return (exec: unknown): GuardVerdict => {
		const agent = agentOf(exec);
		if (agent === undefined) return undefined;

		const toolName = nameOf(exec);
		if (toolName === '') return undefined;

		try {
			/* DI 通道优先：每次判定读当前 cell（2026-11-27 裁定）；没有则用快照。 */
			const held = holderOf(deps.resolveSubagents?.() ?? subagents, exec, agent);
			const { cards } = heldWorkCardsOf(taskboard, held);
			/*
			 * ⚠ core 要的是**窄形状**（只有 `templateRef`），不是完整 Card。
			 *   映射在这里做，而不是让 core 认识 Card —— 那是反向依赖。
			 */
			const heldCards = cards.map((card) => ({ templateRef: card.template.ref }));

			/*
			 * 判定在本包的 `tool-guard.ts`（`2026-11-23` 从 core 搬来）。
			 *
			 * 三个输入各来自不同归属：
			 *   · `cardLevel`  ← core（用户授权 AI 做什么卡动作）—— core 拥有
			 *   · `toolLevel`  ← 本包的 kv（agent 侧注入权限）—— 本包拥有
			 *   · `policies`   ← core（任务板自己那几个工具的放行表）
			 */
			const verdict = judgeToolCall(
				{
					cardLevel: taskboard.getCardActionLevel(),
					toolLevel: readToolGuardLevelOf(kv),
					toolName,
					heldCards,
				},
				{ policies: taskboard.getToolPolicies() },
			);
			return verdict.ok ? undefined : `[任务板权限] ${verdict.reason}`;
		} catch (error) {
			/* 见上面 JSDoc：加装模块坏了不该让用户完全不能用 dsh，但必须看得见。 */
			// TODO(审查): 本包有 3 套日志前缀（此处 taskboard3-permission、tool-guard.ts:104 的
			// taskboard3-tool-guard、其余 taskboard3-agent-guard），且这里在 guard 热路径上每次失败都打。
			// 可直接改：统一一个 logger + 按错误去重。
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
