/**
 * 按钮的 `method` 判定 —— 「这次转移是不是采纳」。
 *
 * ## 为什么在 core（原本在 `dsh/src/actions.ts`）
 *
 * `2026-11-22` 迁移 dsh 到 tool contract v2 时，v1 的 `dsh/src/actions.ts`
 * 被删掉：它是 dsh 侧的重复判据文件。判据本身（`BUTTON_ACTIONS` 的 `method`）
 * 属于领域词汇，HTTP（用户点按钮）和 AI 工具（v2 内部已由 core 的
 * `transitionAdvice` 给出 `action`）都必须走同一条真值。
 *
 * ⚠ 任务书说「改用 `packages/tools` 的 adoptTargetOf / isAdoptTransition」——
 *   实测 v2 的 `@taskboard/tools` **没有导出这两个函数**（导出面见
 *   `packages/tools/src/index.ts`：只有 `resolveStateId` 等），所以放在 **core**：
 *   core 是允许改的包，且按钮语义本来就属于 core/protocol 的领域。
 *
 * ## 为什么要判
 *
 * 采纳（`adopt`）和普通转移（`transition`）在 core 里是**两个方法**：
 *
 * ```
 * adopt()      → 改状态 **且** 写 adoptedAt
 * transition() → 只改状态
 * ```
 *
 * `Card.adoptedAt` 是 `search` 的排序键（`adoptedAt ?? createdAt`）。
 * 如果采纳走了 `transition()`，状态对了但 `adoptedAt` 仍是 `null`
 * ⇒ **排序错乱，且不报错**。这是静默错误，所以必须分开走。
 *
 * ## ⚠ 判据来自 `BUTTON_ACTIONS`，不在这里抄表
 *
 * 目标状态由类别决定（`goal`/`work` → `SUBMITTED`，`design`/`record` →
 * `AUTH_REQUIRED`）。在这里抄一份「哪些类别采纳去哪」就是**第二处真值**；
 * 表改了这里不会报错，表现是「某个类别的采纳走了 transition、漏写 adoptedAt」。
 *
 * ⇒ 查 `BUTTON_ACTIONS` 的 `method` 字段。表是唯一真值。
 */

import { BUTTON_ACTIONS } from '@taskboard/protocol';
import type { TaskState } from '@taskboard/protocol';

/**
 * 某个类别、某个状态下的**采纳目标状态**。
 *
 * TODO(审查): 与 transition.ts:66 的 `adoptTargetOf(kind)` 同名不同参（那边只按 kind、隐含 from=DRAFT）⇒ 两份真值易漂；建议保留本函数为唯一实现，那边改为 `(kind, DRAFT)`，可直接改。
 *
 * v1 的 `taskboard_adopt` 工具（AI 侧）只需要「我在草稿态，采纳会去哪」；
 * 它不接收目标状态参数 —— 目标由类别定。v2 的 `taskboard_transition` 不再
 * 需要它（core 的 `transitionAdvice` 已把 `action: 'adopt'` 算好），但 HTTP 的
 * 用户按钮路由仍要判「这次 `to` 是不是采纳」。
 *
 * ⚠ 这是「查采纳目标」的唯一实现：`isAdoptTransition` 也走它，
 *   不在这里再抄一遍 `BUTTON_ACTIONS` 的查询条件（第二份判据会漂）。
 *
 * @returns `undefined` ⇒ 这个 (类别, 状态) 没有采纳按钮
 */
export function adoptTargetOf(kind: string, from: TaskState): TaskState | undefined {
	return BUTTON_ACTIONS.find(
		(action) => action.kind === kind && action.from === from && action.method === 'adopt',
	)?.to;
}

/**
 * 这次转移是不是「采纳」按钮。
 *
 * @param kind 类别 id（`goal` / `work` / `design` / `record`）
 * @param from 源状态
 * @param to 目标状态
 * @returns `true` ⇒ 调用方应走 `taskboard.adopt()` 而不是 `transition()`
 */
export function isAdoptTransition(kind: string, from: TaskState, to: TaskState): boolean {
	return adoptTargetOf(kind, from) === to;
}
