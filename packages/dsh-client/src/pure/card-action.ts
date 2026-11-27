/**
 * `CardAction` → **服务端认的 `to`**（纯函数）。
 *
 * ## 为什么需要它
 *
 * `api.act()` 曾经发 `{ workspaceId, action: { kind, to } }`，而服务端
 * （`packages/dsh/src/http.ts` 的 `POST /cards/:id/action`）在**顶层**读 `to`：
 *
 * ```ts
 * const to = str(body, 'to') ?? '';
 * if (!isTaskState(to)) → 400「不是已知状态」
 * ```
 *
 * ⇒ `to` 读成空串 ⇒ **点任何状态按钮都 400**。
 *   和 `patchCard` 那个 bug 同一类（客户端包了一层，服务端读扁平）。
 *
 * ## 服务端**不读 `kind`**
 *
 * 它只用 `to` 反推：`isAdoptTransition(kind, from, to)` 命中就走
 * `taskboard.adopt()`，否则走 `transition()`。
 *
 * ⇒ 客户端唯一要做的事：**把「点的是什么」换算成目标状态**。
 *
 * ## 换算表
 *
 * | kind | `to` |
 * |---|---|
 * | `transition` | `action.to`（按钮表已经给了）|
 * | `adopt` | 采纳目标状态 —— **按 (类别, 源状态) 查 `BUTTON_ACTIONS`**，不硬编码 |
 * | `claim` | `TASK_STATE_WORKING`（服务端会 409 拒，那是设计）|
 * | `release` | `TASK_STATE_SUBMITTED`（同上）|
 *
 * ⚠ **`adopt` 不能硬编码 `SUBMITTED`**：`goal` / `work` 采纳到「提交」，
 *   `design` / `record` 采纳到「需要授权」（见 `protocol/transition.ts` 的
 *   `BUTTON_ACTIONS` 表）。硬编码会让后两类卡采纳到错的状态。
 *
 * ⚠ **`adopt` 也不能用 `transition.ts` 的单参数 `adoptTargetOf(kind)`**：
 *   那个只按类别查、忽略源状态，而 `isAdoptTransition` 用的是
 *   **双参数**版本（`actions.ts` 的 `adoptTargetOf(kind, from)`）。
 *   两边算出来的目标不一致时，客户端发的 `to` 服务端不认 ⇒ 404/400。
 *   ⇒ 本文件**直接查 `BUTTON_ACTIONS`**（和双参数版本同一个判据），
 *     但用 `protocol` 的**公开导出**而不是 `core` 的内部函数 ——
 *     客户端只依赖 protocol（`package.json` 里 `core` 是 devDependency）。
 */

import type { TaskState } from '@taskboard/protocol';
import { BUTTON_ACTIONS, TaskState as STATE } from '@taskboard/protocol';

import type { CardAction } from '../types.ts';

// TODO(审查): 这里用 BUTTON_ACTIONS.find 复刻了注释所称 core 的 adoptTargetOf(kind,from) 判据；两边不一致时客户端发的 to 服务端不认（见文件头 :37-43）。应把查询放进 protocol 导出（BUTTON_ACTIONS 属于 protocol），client 只调用；可直接改，但需 protocol 加导出。
/**
 * 从按钮表里查「这个类别、这个源状态，采纳到哪」。
 *
 * 判据与 `core/src/actions.ts` 的 `adoptTargetOf(kind, from)` **完全一致**
 * （`kind` + `from` + `method === 'adopt'`），只是本文件用 protocol 的公开表
 * 自己查 —— 客户端不依赖 core。
 *
 * @param kind 类别 id（`goal` / `work` / `design` / `record`）
 * @param from 源状态
 * @returns 采纳目标状态；没有采纳按钮时 `undefined`
 */
function adoptTargetOf(kind: string, from: string): TaskState | undefined {
	const hit = BUTTON_ACTIONS.find(
		(action) => action.kind === kind && action.from === from && action.method === 'adopt',
	);
	return hit?.to;
}

/**
 * 把一个 `CardAction` 换算成服务端认的目标状态。
 *
 * @param action 点按钮翻译出来的动作
 * @param card 被点的卡（`adopt` 要它的 `template.kind` + `status`）
 * @returns 目标状态；**算不出来时 `undefined`**（调用方应报错，不能发空串）
 */
// TODO(审查): `action.to as TaskState`（:79）是 types.ts:188 把 `to` 定义成 string 的连带断言；把 CardAction.transition.to 改成 TaskState 后即可删（可直接改，见 types.ts 的同类 TODO）。
export function toOfAction(action: CardAction, card: { readonly template: { readonly kind: string }; readonly status: string }): TaskState | undefined {
	switch (action.kind) {
		case 'transition':
			return action.to as TaskState;
		case 'adopt':
			return adoptTargetOf(card.template.kind, card.status);
		case 'claim':
			return STATE.WORKING;
		case 'release':
			return STATE.SUBMITTED;
	}
}
