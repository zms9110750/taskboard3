/**
 * 结果措辞 —— 把 core 的失败 / 卡字段翻译成模型能据此改对的话。
 *
 * ## 为什么在工具层而不是 core
 *
 * core 返回结构化的 `Failure`（错误码 + 消息 + 字段问题），UI 与 AI 工具
 * **对同一份事实的措辞需求不同**：
 *
 * · UI：按错误码决定「重试按钮 / 下拉 / 标红」；
 * · AI：需要「下一步该改哪个字段」的自然语言。
 *
 * 把 AI 措辞放进 core 会让 core 背上一份只服务模型的文案；放在本层则
 * 宿主（MCP / DSH）都能共用同一套措辞。
 */

import type { Failure } from '@taskboard/protocol';
import { ERROR_HINTS, labelOf } from '@taskboard/protocol';
import type { Card } from '@taskboard/core';

/**
 * 把 `Failure` 翻译成模型能据此改对的话。
 *
 * 结构：主消息 → `ERROR_HINTS` 的下一步 → 逐条字段问题。
 * 字段问题里的 `path` 为空串时表示「整体」，不能渲染成空字符串。
 */
export function describeFailure(fail: Failure): string {
	const lines: string[] = [fail.message];
	const hint = ERROR_HINTS[fail.code];
	if (hint !== undefined) lines.push(`下一步：${hint}`);
	if (fail.issues !== undefined && fail.issues.length > 0) {
		lines.push('具体问题：');
		for (const issue of fail.issues) {
			lines.push(`· ${issue.path === '' ? '(整体)' : issue.path}：${issue.message}`);
		}
	}
	return lines.join('\n');
}

/**
 * 把未读状态翻译成人话。
 *
 * ## ⚠ 两个字段的方向是**交叉**的（这是最容易搞反的地方）
 *
 * ```
 * ai: true    ⇒ AI 改过，**用户**还没读
 * user: true  ⇒ 用户改过，**AI** 还没读
 * ```
 *
 * 即字段名是「**谁改的**」，而不是「谁没读」。
 * 记忆法：`ai: true` 的意思是「有 AI 写的、待读的东西」。
 *
 * 这个方向由 core 的 `CardUnread` 定义，本函数只做措辞，不改语义。
 */
export function describeUnread(unread: { readonly ai: boolean; readonly user: boolean }): string {
	if (!unread.ai && !unread.user) return '双方都已读';
	if (!unread.ai && unread.user) return '用户改过，AI 待读';
	if (unread.ai && !unread.user) return 'AI 改过，用户待读';
	return '双方都有未读';
}

/** 人类可读的卡行。 */
export function cardLine(card: Card): string {
	return `${card.id}  [${labelOf(card.status)}]  ${card.title}  （${card.template.ref} / ${card.template.kind} / ${card.template.domain}）`;
}

/** 状态的中文名 + id（`提交（TASK_STATE_SUBMITTED）`）。 */
export function stateText(state: string): string {
	return `${labelOf(state)}（${state}）`;
}

/** 把 payload 压成一行预览（避免把整个 payload 抖给模型）。 */
export function previewOf(value: unknown, limit = 120): string {
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	if (text === undefined) return '(无)';
	const flat = text.replace(/\s+/g, ' ');
	return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

/** 从 `payload` 里取可读正文（`value` 字段或整体）。 */
export function bodyOf(payload: unknown): string {
	if (typeof payload === 'object' && payload !== null && 'value' in payload) {
		const value = (payload as { value?: unknown }).value;
		if (typeof value === 'string') return value;
	}
	return previewOf(payload);
}
