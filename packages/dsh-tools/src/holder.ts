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
 * ## 只认名字：拿不到名字 ⇒ 无 holder（`''`）
 *
 * issue #42 Bug 2 + lead `2026-11-28` 裁定（fail-safe）：`subagents` 服务缺席、
 * `namesOf` 抛错、`self` 空 —— 一律返回 `''`，**不再回落 `agent.id`（UUID）**。
 *
 * 理由：
 * - 卡只以名字（`namesOf.self`）被领取 —— UUID 存进卡里既不可读，也会和
 *   guard 的读语义错位（「领了卡但权限不生效」的静默错误）；
 * - 权限系统**宁可按「无持有卡」判，也不猜一个 UUID**。身份解析不了时应当
 *   **不能领卡**（`@taskboard/tools` 的 transition 会以 needHolder 明确失败），
 *   而不是把卡存进一个 guard 永远匹配不到的 UUID。
 *
 * ⚠ 唯一的非空回落是 `exec.agent` 缺席 ⇒ `'unknown'`：那是「没有 agent 上下文」
 *   （程序化调用）的既有哨兵；本函数不把它当「名字」用。
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
	/**
	 * ⚠ `id` 仍如实保留（`exec.agent` 的实际字段），但 issue #42 Bug 2 之后
	 *   **holder 不再用它回落** —— 拿不到名字就是无 holder，不猜 UUID。
	 */
	readonly agent?: { readonly id?: string } | undefined;
}

/**
 * 取 holder 名字。
 *
 * @param subagents `ctx.subagents`；可缺席（缺席 ⇒ `''`，见文件头）
 * @param exec 工具执行上下文
 * @returns `'lead'` / `'reviewer/checker'` / `'unknown'`（agent 缺席）/ `''`（拿不到名字）
 */
export function holderOf(subagents: unknown, exec: unknown): string {
	/* ① 没有 agent 上下文（程序化调用 / standalone）⇒ 不知道是谁。 */
	const agent = agentOf(exec);
	if (agent === undefined) return 'unknown';

	/* ② 没有 subagents 服务 ⇒ 拿不到名字 ⇒ 无 holder（issue #42 Bug 2）。 */
	if (!hasNamesOf(subagents)) return '';

	/* ③ 有服务但 agent 不在 subagent 树里 ⇒ 官方实现会抛 ⇒ 同样无 holder。 */
	try {
		const name = subagents.namesOf(agent).self;
		if (typeof name === 'string' && name !== '') return name;
	} catch {
		/* 不在树里 ⇒ 无 holder。不编名字，也不猜 UUID（issue #42 Bug 2）。 */
	}
	return '';
}

/** 从 `exec` 取 agent（缺席时 `undefined`）。 */
function agentOf(exec: unknown): { readonly id?: string } | undefined {
	if (typeof exec !== 'object' || exec === null) return undefined;
	const agent = (exec as { agent?: unknown }).agent;
	if (typeof agent !== 'object' || agent === null) return undefined;
	return agent as { readonly id?: string };
}

/** 判断对象是否有可用的 `namesOf`。 */
function hasNamesOf(value: unknown): value is SubagentsLike {
	if (typeof value !== 'object' || value === null) return false;
	return typeof (value as { namesOf?: unknown }).namesOf === 'function';
}
