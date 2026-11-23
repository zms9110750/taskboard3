/**
 * 失败契约 —— **所有工具共用**（v2 自己定的，用户说「失败的部分让他自己发挥，我要检查」）。
 *
 * ## 形状（文本 + `isError`）
 *
 * ```
 * 失败：<一句话说清发生了什么>
 * 原因码：<Failure.code>
 * 能否重试：<修正参数后可重试 | 不要重试（先修装配/权限）>
 * 下一步：<可执行的动作：调哪个工具、改哪个参数、找谁>
 * 具体问题：
 * · /path：message
 * ```
 *
 * ## 为什么这样定
 *
 * - **原因码**给宿主/日志机器可读；**下一步**给模型可行动。
 *   只有「失败」没有「下一步」时，模型会反复重试同一个错误调用（真实模型行为）。
 * - **能否重试**是两档而不是三档：`修正后可重试` 与 `不要重试`。
 *   中间态（等一下重试）在本系统的写操作里不存在 —— 所有失败都是参数/装配/权限问题。
 * - `isError: true`：MCP 据此把结果标红；DSH 不看也能读文本。
 * - **部分成功**：本系统的写操作都是「先校验 → 单次落库」，
 *   没有部分成功（建卡关系失败时卡不会建、更新校验失败时字段不会改）。
 *   所以不存在 `partial` 字段 —— 不需要。
 */

import type { Failure } from '@taskboard/protocol';
import { ERROR_HINTS, ErrorCode, failure as protocolFailure } from '@taskboard/protocol';

import type { TaskboardToolResult } from './types.ts';

/** 「能不能重试」两档。 */
export type Retryability = 'after-fix' | 'no';

/**
 * 错误码 → 默认可重试性。
 *
 * `after-fix` = 改参数 / 换目标后可以再调（不是等一会重试）；
 * `no` = 先修装配 / 权限，重试同一个调用没有意义。
 */
const RETRYABILITY: Readonly<Record<ErrorCode, Retryability>> = Object.freeze({
	FIELD_REQUIRED: 'after-fix',
	CONTENT_INVALID: 'after-fix',
	CARD_NOT_FOUND: 'after-fix',
	WORKSPACE_NOT_FOUND: 'after-fix',
	TEMPLATE_NOT_FOUND: 'after-fix',
	RELATION_TARGET_INVALID: 'after-fix',
	TRANSITION_REJECTED: 'after-fix',
	CLAIM_REJECTED: 'after-fix',
	ACTION_NOT_FOUND: 'after-fix',
	/*
	 * 完结态不可改内容 —— 「改参数」也没用（换成同一张卡还是被拦），
	 * 但**换一张卡**是有效的下一步 ⇒ 仍归 `after-fix`，不是 `no`。
	 * `no` 只留给装配/权限问题（重试同一个调用永远没意义）。
	 */
	CARD_ENDED_IMMUTABLE: 'after-fix',
	/*
	 * 总闸关着 ⇒ **重试同一个调用永远没意义**（改参数也没用，拦的是角色不是参数）。
	 * 但这不是「装配错」也不是「缺陷」—— 是用户配置。
	 * ⇒ `no`：AI 应该改道（告诉用户，让用户点按钮），不是重试。
	 *   按上面那条约定「`no` 只留给装配/权限问题」—— 这条正是权限。
	 */
	AI_STATE_CHANGE_DISABLED: 'no',
	TEMPLATES_UNAVAILABLE: 'no',
	PORT_UNAVAILABLE: 'no',
	INTERNAL_ERROR: 'no',
});

/** 能否重试的人话。 */
export function retryText(kind: Retryability): string {
	return kind === 'after-fix' ? '修正参数后可重试' : '不要重试（先修装配 / 权限）';
}

/** 失败结果的可选覆盖。 */
export interface FailureResultOptions {
	/** 覆盖默认的「下一步」。 */
	readonly next?: string;
	/** 覆盖默认可重试性。 */
	readonly retryable?: Retryability;
	/** 失败主题（比如 `建卡失败`），会拼成 `失败：建卡失败：<message>` 的两段。 */
	readonly action?: string;
}

/**
 * 把一个 `Failure` 翻成模型可行动的结果文本。
 *
 * @param fail core / protocol 的失败
 * @param options 覆盖下一步 / 可重试性
 */
export function failureResult(fail: Failure, options: FailureResultOptions = {}): TaskboardToolResult {
	const retryability = options.retryable ?? RETRYABILITY[fail.code];
	const hint = options.next ?? ERROR_HINTS[fail.code];
	const lines: string[] = [];

	lines.push(options.action === undefined ? `失败：${fail.message}` : `失败：${options.action}：${fail.message}`);
	lines.push(`原因码：${fail.code}`);
	lines.push(`能否重试：${retryText(retryability)}`);
	if (hint !== undefined && hint !== '') lines.push(`下一步：${hint}`);
	if (fail.issues !== undefined && fail.issues.length > 0) {
		lines.push('具体问题：');
		for (const issue of fail.issues) {
			lines.push(`· ${issue.path === '' ? '(整体)' : issue.path}：${issue.message}`);
		}
	}
	return { text: lines.join('\n'), isError: true };
}

/** 直接造一个协议失败再翻译（工具层自己的参数错误用它）。 */
export function toolFailure(
	code: ErrorCode,
	message: string,
	options: FailureResultOptions & {
		readonly issues?: readonly { readonly path: string; readonly message: string }[];
	} = {},
): TaskboardToolResult {
	return failureResult(protocolFailure(code, message, options.issues === undefined ? undefined : { issues: options.issues }), options);
}

/** 把宿主上下文缺失之类的问题统一成可行动失败。 */
export function hostFailure(message: string, next: string): TaskboardToolResult {
	return toolFailure(ErrorCode.PORT_UNAVAILABLE, message, { next, retryable: 'no' });
}

/** 把「参数不对」统一成可重试失败。 */
export function inputFailure(message: string, next?: string): TaskboardToolResult {
	return toolFailure(ErrorCode.FIELD_REQUIRED, message, next === undefined ? {} : { next });
}
