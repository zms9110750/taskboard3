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
// TODO(审查): 表用「Object.freeze(字面量) + 类型标注」写，等于关掉了多余键检查（AGENTS 3.7）：
// Object.freeze 让对象字面量成了函数实参，不受多余属性检查约束 ⇒ 「多写一个键」不会红，而新增 ErrorCode 也可能被静默漏掉。
// 可直接改：`} satisfies Record<ErrorCode, Retryability>;`。
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

/* ══════════════════════════════════════════════════════════
   「下一步」：一张表 + per-tool 覆盖
   ══════════════════════════════════════════════════════════ */

/**
 * 错误码 → 工具层的「下一步」（各工具共用的一份口径）。
 *
 * 与 protocol 的 `ERROR_HINTS` 的分工：`ERROR_HINTS` 是**词级**默认（UI 也在用它决定按钮），
 * 这里可以点名 `taskboard_*` 工具，给模型的指引更具体。
 *
 * ⚠ 新增 `ErrorCode` 时这张表少一条 ⇒ **tsc 直接报**（`satisfies` 只检查、不 widen，AGENTS 3.7）。
 *   某个工具想换口径，就在自己文件里的 `XXX_NEXT_STEPS` 覆盖
 *   （`satisfies Partial<Record<ErrorCode, string>>`），不要另写 switch。
 */
export const TOOL_NEXT_STEPS = {
	CARD_NOT_FOUND: '先用 taskboard_cards 确认编号（按编号直查能看到墓碑，但墓碑不能改）。',
	WORKSPACE_NOT_FOUND: '先调 taskboard_workspaces 列空间，再用返回的空间 id 调用（workspaceId 必填）。',
	TEMPLATE_NOT_FOUND: '先调 taskboard_definitions 查模板清单与详情，再传正确的 templateRef。',
	CONTENT_INVALID: '先调 taskboard_raw_card 看当前 JSON，再按 issues 里的章节名与字段修正后重试。',
	TRANSITION_REJECTED: '不传 to 调一次看当前可转移目标；终结态如果用户授意，由用户推进。',
	RELATION_TARGET_INVALID: '关系目标必须是同空间中已存在、未删除、非草稿的卡；先用 taskboard_cards 确认编号。',
	CLAIM_REJECTED: '不传 to 调一次看条件目标；按 blockers 先完成依赖，或先释放手上另一张处理中工作卡。',
	FIELD_REQUIRED: '补上缺失字段后重试；不确定字段名就先看本工具的说明。',
	CARD_ENDED_IMMUTABLE: '这张卡已完结，内容不能再改。要接着做就新建一张卡（taskboard_create）；只想看内容用 taskboard_raw_card。',
	AI_STATE_CHANGE_DISABLED: '任务板当前不允许 AI 改卡状态。把要做的状态变化告诉用户，让用户点按钮；或让用户先把开关打开。',
	TEMPLATES_UNAVAILABLE: '模板注册表未就绪；这是安装问题，不是调用问题。',
	ACTION_NOT_FOUND: 'action 未注册；用 taskboard_definitions 查可用 action。',
	PORT_UNAVAILABLE: '该能力未装配；检查插件是否完整。',
	INTERNAL_ERROR: '内部错误；这是缺陷，请报告。',
} satisfies Record<ErrorCode, string>;

/**
 * 取「下一步」：per-tool 覆盖优先，其次共用表。
 *
 * 返回类型是 `string`（不是 `string | undefined`）—— 表是全的，所以失败文本里
 * 「下一步」这一段不会因为漏写一条指引而消失。
 */
export function nextStepFor(
	code: ErrorCode,
	overrides: Readonly<Partial<Record<ErrorCode, string>>>,
): string {
	return overrides[code] ?? TOOL_NEXT_STEPS[code];
}

/** 把「参数不对」统一成可重试失败。 */
export function inputFailure(message: string, next?: string): TaskboardToolResult {
	return toolFailure(ErrorCode.FIELD_REQUIRED, message, next === undefined ? {} : { next });
}
