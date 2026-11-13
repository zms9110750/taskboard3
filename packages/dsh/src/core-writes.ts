/**
 * core 写操作的 `actor` 参数 —— 一处收口。
 *
 * ## 为什么需要这个文件
 *
 * `core` 的**实现**已经接受 `actor`（默认 `'user'`）：
 *
 * ```ts
 * // core/src/index.ts:438
 * async update(workspaceId, cardId, patch, actor: Actor = 'user') { ... }
 * // core/src/index.ts:482
 * async remove(workspaceId, cardId, actor: Actor = 'user') { ... }
 * ```
 *
 * 但 `Taskboard` **接口声明**上还没有这两个参数 —— 那是 core 的遗漏，不是设计。
 *
 * ⇒ 本文件补一个局部扩展类型，让两个入口（`tools.ts` 的 AI 路径、
 *   `http.ts` 的界面路径）都能**显式**标 `actor`。
 *
 * ## 为什么「显式标」比「靠默认值」重要
 *
 * 默认值 `'user'` 是安全侧的兜底，但它让「忘了传」和「故意传 user」
 * 变成同一件事 —— 两者都编译通过、都运行正常、都不报错。
 *
 * 而后果是**静默的**：AI 工具忘了标 `'ai'` ⇒ 那些改动被记成用户改的
 * ⇒ `updates.ai`（用户未读）永远不增加 ⇒ 界面上「AI 改过」的角标永不出现。
 *
 * 显式传之后，`grep "actor"` 就能确认每个入口都表了态。
 *
 * ## 何时可以删掉本文件
 *
 * `Taskboard` 接口补上 `actor` 参数之后 —— 那时把这里的 `as` 换成直接调用。
 */

import type { Card, Taskboard } from '@taskboard/core';
import type { Failure } from '@taskboard/protocol';

/** 写操作的 actor（谁改的）。 */
export type WriteActor = 'user' | 'ai';

/** 一次写操作的结果。 */
type WriteOutcome = { readonly ok: true; readonly card: Card } | Failure;

/** 带 `actor` 的写方法（core 实现有、接口没声明）。 */
export interface ActorAwareWrites {
	update(
		workspaceId: string,
		cardId: string,
		patch: { readonly title?: string; readonly note?: string; readonly content?: unknown },
		actor: WriteActor,
	): Promise<WriteOutcome>;
	remove(workspaceId: string, cardId: string, actor: WriteActor): Promise<WriteOutcome>;
}

/**
 * 把 `Taskboard` 当作「带 `actor` 的写方法」用。
 *
 * ⚠ 这是 `as` 断言，不是能力探测 —— 因为 core 的**实现**确实有这两个参数
 *   （已核对源码），只是声明漏了。若哪天实现也删了，运行时才会炸
 *   （`actor` 被当第 4 个参数忽略，写入的历史会标成默认的 `'user'`）。
 *
 *   那正是本文件要防的失败方向：**显式传了、却被静默忽略** ⇒ 测试会发现
 *   （`updates.ai` 里没有那张卡）。
 */
export function actorAware(taskboard: Taskboard): ActorAwareWrites {
	return taskboard as unknown as ActorAwareWrites;
}
