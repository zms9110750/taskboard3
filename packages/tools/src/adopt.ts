/**
 * 「这次转移是不是采纳」的判据。
 *
 * ## 为什么工具层要有它
 *
 * `taskboard_transition` 必须**拒绝执行采纳**并把模型指路到 `taskboard_adopt`
 * （理由见 `tools.ts` 里 `taskboard_adopt` 的注释：采纳是一档独立授权，
 * core 的 `judgeToolCall` 按工具名判它）。而 `taskboard_adopt` 又需要知道
 * 「这个类别、这个状态的采纳目标是什么」。
 *
 * ## ⚠ 判据来自 `BUTTON_ACTIONS`，这里不抄表
 *
 * 目标状态由类别决定（`goal`/`work` → 提交，`design`/`record` → 需要授权），
 * 那是 `@taskboard/protocol` 里的事实。这里的两个函数只是**对那张表的查询**，
 * 不复制任何一行「哪些类别采纳去哪」—— 表改了，这里自动跟着改。
 *
 * ## 与 `packages/dsh/src/actions.ts` 的关系
 *
 * 那个文件里有一份**逐字相同**的查询（历史原因：它先于本包存在）。
 * 将来 `dsh` 退化成薄适配层时，应改成从本包导入这两个函数；本包不反过来
 * 依赖 `dsh`（层级方向是 tools → core，见 `index.ts` 文件头）。
 */

import type { TaskState } from '@taskboard/protocol';
import { BUTTON_ACTIONS } from '@taskboard/protocol';

/**
 * 某个类别、某个状态下的**采纳目标状态**。
 *
 * `taskboard_adopt` 不接收目标状态参数 —— 目标由类别定。
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
 * @returns `true` ⇒ 调用方应走 `Taskboard.adopt()` 而不是 `Taskboard.transition()`
 */
export function isAdoptTransition(kind: string, from: TaskState, to: TaskState): boolean {
	return adoptTargetOf(kind, from) === to;
}
