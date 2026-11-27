/**
 * 工具层的小工具：读参数、解析空间、取身份、宿主事实。
 *
 * 全部是**纯读取 + 显式失败**：不猜、不静默回落。
 */

import type { Card, Taskboard, TransitionAdvice } from '@taskboard/core';
import type { Failure } from '@taskboard/protocol';

import type { TaskboardToolContext, TaskboardToolResult } from './types.ts';
import { failureResult, inputFailure } from './failure.ts';

/** 读字符串参数（空串视为没给）。 */
export function str(args: unknown, key: string): string | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * 读一个**允许空串**的字符串字段。
 *
 * 与 `str` 的唯一区别：空串是有效值 —— `taskboard_update` 的 `path: ''`（整个内容对象）、
 * `taskboard_update_note` 的 `note: ''`（清空备注）、`taskboard_transition` 的 `to: ''`（只查询）。
 * 缺 key / 非字符串仍是 `undefined`。
 *
 * 四个工具原本各抄了一份（update.ts 的 stringField、update-note.ts 的 readString、
 * transition.ts 的 readString、render.ts 的死代码 stringField）⇒ 统一到这里，一处维护。
 */
export function strAllowEmpty(args: unknown, key: string): string | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === 'string' ? value : undefined;
}

/** 读字符串数组参数（过滤非字符串项）。 */
export function strs(args: unknown, key: string): readonly string[] | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	if (!Array.isArray(value)) return undefined;
	return value.filter((one): one is string => typeof one === 'string' && one !== '');
}

/** 读布尔参数（严格：只认 boolean）。 */
export function boolOf(args: unknown, key: string): boolean | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === 'boolean' ? value : undefined;
}

/** 读整数参数（非法 = undefined）。 */
export function intOf(args: unknown, key: string): number | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/** 读任意参数。 */
export function rawOf(args: unknown, key: string): unknown {
	if (typeof args !== 'object' || args === null) return undefined;
	return (args as Record<string, unknown>)[key];
}

/** 对象参数（不是数组 / null）。 */
export function objectOf(args: unknown, key: string): Record<string, unknown> | undefined {
	const value = rawOf(args, key);
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

/** 解析空间的成功 / 失败判别联合。 */
export type WorkspaceResolution =
	| { readonly ok: true; readonly workspaceId: string }
	| { readonly ok: false; readonly result: TaskboardToolResult };

/**
 * 解析目标空间。
 *
 * ## 用户 2026-11-22 裁决：**取消「激活空间」设定**
 *
 * > 「那也可以。取消整个激活空间的设定。这个设定不要了。
 * >   也不需要 ui 上面的『激活当前空间』的按钮了。」
 *
 * ⇒ `workspaceId` **必须显式给**，所有宿主一致：
 * - 给了 ⇒ 用它；
 * - 没给 ⇒ **报错**，并告诉 AI 怎么自救（先调 `taskboard_workspaces` 拿 id）。
 *
 * ⚠ 不猜「第一个空间」：那会让写操作静默落到一个 AI 没确认的空间。
 */
export async function resolveWorkspace(
	// TODO(审查): `_ctx` 已完全不读（激活空间取消后没有任何宿主事实参与解析）—— 保留它只为和其它 handler 同形。
	// 可直接改：删参数并同步 8 个调用点；或注明「签名占位」。
	args: unknown,
	_ctx: TaskboardToolContext,
): Promise<WorkspaceResolution> {
	const explicit = str(args, 'workspaceId');
	if (explicit !== undefined && explicit !== '') return { ok: true, workspaceId: explicit };

	return {
		ok: false,
		result: inputFailure(
			'必须显式给 workspaceId —— 「激活空间」的设定已取消（用户 2026-11-22），不再有默认空间。',
			'先调 taskboard_workspaces 列空间拿 id，再把它传给本次调用。',
		),
	};
}

/** 取卡的成功 / 失败判别联合（失败已翻成给模型看的结果）。 */
export type CardRead =
	| { readonly ok: true; readonly card: Card }
	| { readonly ok: false; readonly result: TaskboardToolResult };

/**
 * 按 `workspaceId + cardId` 取一张卡（#3 查看卡 / 原始卡 / #7 更新备注共用）。
 *
 * 三个工具原本各写一遍 `taskboard.get(...)` + `failureResult(found, {...})`，
 * 只有失败主题词不同 ⇒ 收在这里，失败主题词由调用方给。
 *
 * @param action 失败主题（如 `查看卡失败`），拼成 `失败：<action>：<message>`
 */
export function readCard(
	taskboard: Taskboard,
	workspaceId: string,
	cardId: string,
	action: string,
): CardRead {
	const found = taskboard.get(workspaceId, cardId);
	if (!found.ok) return { ok: false, result: failureResult(found, { action }) };
	return { ok: true, card: found.card };
}

/** 读「当前状态 + 可转移目标」的成功 / 失败判别联合。 */
export type AdviceRead =
	| { readonly ok: true; readonly advice: TransitionAdvice }
	| { readonly ok: false; readonly failure: Failure };

/**
 * 按 `workspaceId + cardId` 读一张卡的转移建议（#8 的查询/执行、#6 #7 改完的回执共用）。
 *
 * 两处「胶水」收在这一处维护（三个调用点不再各写一遍）：
 * · `holder ?? ''` —— 空串当「没有身份」的哨兵，等 core 把 `holder` 收成 `string | undefined`；
 * · `'targets' in advice` —— 结构嗅探，等 core 的 `transitionAdvice` 给判别字段。
 *
 * ⚠ 上面两条都要 **core 改签名**才能根治（见 index.ts 的跨包待确认清单）；
 *   在这里先收成一处，core 改了之后只需要改这一个函数。
 */
export function adviceOf(
	taskboard: Taskboard,
	workspaceId: string,
	cardId: string,
	holder: string | undefined,
): AdviceRead {
	const advice = taskboard.transitionAdvice(workspaceId, cardId, holder ?? '');
	if (!('targets' in advice)) return { ok: false, failure: advice };
	return { ok: true, advice };
}

/* ══════════════════════════════════════════════════════════
   持有者
   ══════════════════════════════════════════════════════════ */

/**
 * 读持有者（agent 身份）。
 *
 * 用户裁决：持有者来自宿主注入的 `ctx.holder`（DSH 里是 agent id）。
 * 没有注入 ⇒ 返回 `undefined`（不是错误：MCP 等没有 agent 身份）。
 *
 * @param ctx 工具上下文
 */
export function holderOf(ctx: TaskboardToolContext): string | undefined {
	const value = ctx.holder;
	return typeof value === 'string' && value !== '' ? value : undefined;
}