/**
 * 按钮的 `method` 判定 —— 「这次转移是不是采纳」。
 *
 * ## 为什么单独一个文件
 *
 * 两个入口都要判它：
 *
 * | 入口 | 位置 |
 * |---|---|
 * | HTTP（用户点按钮） | `src/http.ts` 的 `POST /api/cards/:id/action` |
 * | AI 工具 | `src/tools.ts` 的 `taskboard_transition` |
 *
 * 而它**必须走同一条判据** —— 否则「界面点采纳」和「AI 采纳」会走不同的
 * core 方法，其中一条会漏写 `adoptedAt`。
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
 * `Card.adoptedAt` 是 `search` 的排序键（`adoptedAt ?? createdAt`，
 * 见 `core/src/search.ts:158`）。如果采纳走了 `transition()`，
 * 状态对了但 `adoptedAt` 仍是 `null` ⇒ **排序错乱，且不报错**。
 * 这是静默错误，所以必须分开走。
 *
 * ## ⚠ 判据来自 `BUTTON_ACTIONS`，不在这里抄表
 *
 * 目标状态由类别决定（`goal`/`work` → `SUBMITTED`，`design`/`record` →
 * `AUTH_REQUIRED`）。在这里抄一份「哪些类别采纳去哪」就是**第二处真值**：
 * 表改了这里不会报错，表现是「某个类别的采纳走了 transition、漏写 adoptedAt」。
 *
 * ⇒ 查 `BUTTON_ACTIONS` 的 `method` 字段。表是唯一真值。
 */

import { BUTTON_ACTIONS } from '@taskboard/protocol';
import type { TaskState } from '@taskboard/protocol';

/**
 * 这次转移是不是「采纳」按钮。
 *
 * @param kind 类别 id（`goal` / `work` / `design` / `record`）
 * @param from 源状态
 * @param to 目标状态
 * @returns `true` ⇒ 调用方应走 `taskboard.adopt()` 而不是 `transition()`
 */
export function isAdoptTransition(kind: string, from: TaskState, to: TaskState): boolean {
	return BUTTON_ACTIONS.some(
		(action) => action.kind === kind && action.from === from && action.to === to && action.method === 'adopt',
	);
}
