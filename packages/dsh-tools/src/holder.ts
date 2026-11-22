/**
 * holder 的取法 —— 「这张卡现在由谁持有」。
 *
 * ## 为什么名字要从 `subagents` 拿
 *
 * DSH 的 `Agent` 接口**只有 `id`（SessionId / UUID），没有 name**。
 * 而任务板需要的是**人可读、可比较**的持有者标识（`lead` / `reviewer/checker`）——
 * UUID 存进卡里，用户看不出是谁，AI 之间也没法用名字对话。
 *
 * ⇒ 名字只能从 `ctx.subagents` 拿。
 *
 * ## 依据：DSH 官方 Agent Teams 同款做法
 *
 * `dsh-agent-team/src/task-board.ts:149-151`：
 *
 * ```ts
 * const name = ctx.subagents.namesOf(caller).self;   // 'lead' / 'reviewer/checker'
 * ```
 *
 * ## 三条回落（每一条都有理由，不是「防一手」）
 *
 * | 情况 | 回落 | 为什么 |
 * |---|---|---|
 * | `exec.agent` 缺席 | `'unknown'` | 工具可以被程序化调用（不经模型），那时没有 agent |
 * | `subagents` 服务不存在 | `agent.id` | 没有 subagent 环境的 profile（单 agent 场景）也该能用任务板 |
 * | `namesOf` 抛错 | `agent.id` | agent 不在 subagent 树里时官方实现就抛 —— UUID 仍是**唯一且稳定**的标识 |
 *
 * ⚠ 三种回落都**不编名字**：`agent.id` 是 DSH 给的真标识，
 *   而「猜一个名字」会让两个不同的 agent 撞到同一个 holder —— 那比报错坏。
 *
 * ## 为什么 `subagents` 用最小结构接口
 *
 * 本包不该 import `@deepseek-ai/dsh-subagent` 的类型：
 *   · 它在 npm 上没有与 DSH 同版本（同 `dsh-tools` 的问题）；
 *   · 本包只用到 `namesOf` 一个方法。
 *
 * ⇒ 声明最小形状。`ctx.subagents` 结构上满足它 ⇒ 运行时能直接传。
 */

/**
 * `ctx.subagents` 的最小形状。
 *
 * ⚠ 用**可选调用**探测：真实实现里 `namesOf` 会**抛错**（agent 不在树里时），
 *   所以调用方必须用 try/catch，不能只看 `=== undefined`。
 */
export interface SubagentsLike {
	namesOf(agent: unknown): { readonly self: string };
}

/** `exec` 的最小形状（`ToolRunContext` 的字段子集）。 */
export interface ExecLike {
	readonly agent?: { readonly id?: string } | undefined;
}

/**
 * 取 holder 名字。
 *
 * @param subagents `ctx.subagents`；可缺席（见文件头的回落表）
 * @param exec 工具执行上下文
 * @returns `'lead'` / `'reviewer/checker'` / agent UUID / `'unknown'`
 */
export function holderOf(subagents: unknown, exec: unknown): string {
	/* ① 没有 agent 上下文（程序化调用 / standalone）⇒ 不知道是谁。 */
	const agent = agentOf(exec);
	if (agent === undefined) return 'unknown';

	/* ② 没有 subagents 服务 ⇒ 用 UUID。它唯一、稳定，只是不好看。 */
	if (!hasNamesOf(subagents)) return idOf(agent);

	/* ③ 有服务但 agent 不在 subagent 树里 ⇒ 官方实现会抛 ⇒ 回落 UUID。 */
	try {
		return subagents.namesOf(agent).self;
	} catch {
		return idOf(agent);
	}
}

/** 从 `exec` 取 agent（缺席时 `undefined`）。 */
function agentOf(exec: unknown): { readonly id?: string } | undefined {
	if (typeof exec !== 'object' || exec === null) return undefined;
	const agent = (exec as { agent?: unknown }).agent;
	if (typeof agent !== 'object' || agent === null) return undefined;
	return agent as { readonly id?: string };
}

/** 取 agent 的 UUID；缺席时回落 `'unknown'`。 */
function idOf(agent: { readonly id?: string }): string {
	const id = agent.id;
	return typeof id === 'string' && id !== '' ? id : 'unknown';
}

/** 判断对象是否有可用的 `namesOf`。 */
function hasNamesOf(value: unknown): value is SubagentsLike {
	if (typeof value !== 'object' || value === null) return false;
	return typeof (value as { namesOf?: unknown }).namesOf === 'function';
}
