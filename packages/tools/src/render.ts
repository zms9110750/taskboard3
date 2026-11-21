/**
 * 给模型看的渲染 —— 卡的视图 / 状态词 / action 的「视图」。
 *
 * ## 「action 给的视图」（用户 #3 要求）
 *
 * 卡上每个章节存的是 `action payload`；不同 action 的 payload 形状不同
 * （`text` / `markdown` / `ask`，第三方可注册更多）。工具层按 `payload.$type`
 * 分派一个**文本视图**：
 *
 * | action | 视图 |
 * |---|---|
 * | `text` / `markdown` | 正文（`value`）；`markdown` 保留源码（模型能读） |
 * | `ask` | 问题 + 选项 + 已选 + 自填，渲染成可读清单 |
 * | 未知 `$type` / 无 `$type` | JSON（降级，不猜） |
 *
 * ⚠ 视图是**给模型理解内容**的，不是给 `taskboard_update` 拼路径用的。
 *   拼路径要先用 `taskboard_raw_card` 看原始 JSON（用户裁决 #5）。
 */

import type { Card, CardUnread, TransitionAdvice } from '@taskboard/core';
import { groupOf, labelOf, type TaskState } from '@taskboard/protocol';
import { textOfAction } from '@taskboard/core';

/** 单段视图的字符上限 —— 防止一张长卡把上下文打爆。 */
export const SECTION_VIEW_LIMIT = 2000;

/** 状态文案：`提交（TASK_STATE_SUBMITTED）`。 */
export function stateText(state: string): string {
	return `${labelOf(state)}（${state}）`;
}

/** 未读标记的紧凑文案（空串 = 无未读）。 */
export function unreadFlags(unread: CardUnread): string {
	const flags: string[] = [];
	/* 字段名说的是「谁改的」：ai = AI 改过 ⇒ 用户待读；user = 用户改过 ⇒ AI 待读。 */
	if (unread.ai) flags.push('用户待读');
	if (unread.user) flags.push('AI待读');
	return flags.join('/');
}

/** 列表里的一行卡。 */
export function cardLine(card: Card): string {
	const parts = [
		card.id,
		`[${labelOf(card.status)}]`,
		card.title,
		`（${card.template.ref} / ${card.template.kind} / ${card.template.domain}）`,
	];
	const unread = unreadFlags(card.unread);
	if (unread !== '') parts.push(`未读:${unread}`);
	if (card.holders.length > 0) parts.push(`持有:${card.holders.map((one) => one.holder).join('、')}`);
	return parts.join('  ');
}

/** 截断一段视图（保留头和尾的提示）。 */
export function truncate(text: string, limit = SECTION_VIEW_LIMIT): string {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}…（已截断，原长 ${text.length} 字；要完整内容用 taskboard_raw_card）`;
}

/** JSON 美化文本。 */
export function jsonText(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

/**
 * 一个 action payload 的文本视图。
 *
 * @param payload 卡上的 raw payload
 */
/**
 * 一个 action payload 的文本视图。
 *
 * ## 走 `ActionTextRegistry`，不是 if/else（用户 2026-11-22）
 *
 * > 「多出来的 action，翻译为 tool 的文字，这个也是渲染器。也要有分发器。」
 *
 * 内置三件（text / markdown / ask）由 `core/src/action-text.ts` 的
 * `DEFAULT_ACTION_TEXT` 注册；第三方可以 `DEFAULT_ACTION_TEXT.register(type, fn)`。
 * 没注册的 type ⇒ `textOfAction` 兜底成 `JSON.stringify`。
 *
 * @param payload 卡上的 raw payload
 */
export function renderPayload(payload: unknown): string {
	if (typeof payload === 'string') return truncate(payload);
	if (typeof payload !== 'object' || payload === null) return truncate(String(payload));
	return truncate(textOfAction(payload));
}

/** `ask` 的视图：问题、选项、已选、自填。 */
function renderAsk(payload: object): string {
	const items = arrayField(payload, 'items');
	if (items.length === 0) return jsonText(payload);
	const lines: string[] = [];
	items.forEach((raw, index) => {
		if (typeof raw !== 'object' || raw === null) {
			lines.push(`（第 ${index + 1} 组不是对象）`);
			return;
		}
		const question = stringField(raw, 'question') ?? stringField(raw, 'header') ?? `（第 ${index + 1} 个问题）`;
		const multi = boolField(raw, 'multi_select');
		lines.push(`问题 ${index + 1}${multi ? '（多选）' : '（单选）'}：${question}`);
		const options = arrayField(raw, 'options');
		const picked = arrayField(raw, 'picked').filter((one): one is string => typeof one === 'string');
		for (const option of options) {
			if (typeof option !== 'object' || option === null) continue;
			const label = stringField(option, 'label') ?? '';
			const description = stringField(option, 'description');
			const mark = picked.includes(label) ? '[x]' : '[ ]';
			lines.push(`  ${mark} ${label}${description === undefined ? '' : ` —— ${description}`}`);
		}
		if (options.length === 0) lines.push('  （没有选项）');
		if (picked.length > 0) lines.push(`  已选：${picked.join('、')}`);
		const custom = arrayField(raw, 'custom').filter((one): one is string => typeof one === 'string');
		if (custom.length > 0) lines.push(`  自填：${custom.join('、')}`);
		if (picked.length === 0 && custom.length === 0) lines.push('  状态：未选择');
		const placeholder = stringField(raw, 'placeholder');
		if (placeholder !== undefined && placeholder !== '') lines.push(`  提示：${placeholder}`);
	});
	return lines.join('\n');
}

/** 取一个字符串字段。 */
function stringField(value: object, key: string): string | undefined {
	const raw = (value as Record<string, unknown>)[key];
	return typeof raw === 'string' ? raw : undefined;
}

/** 取一个数组字段（非数组 = 空）。 */
function arrayField(value: object, key: string): readonly unknown[] {
	const raw = (value as Record<string, unknown>)[key];
	return Array.isArray(raw) ? raw : [];
}

/** 取一个布尔字段。 */
function boolField(value: object, key: string): boolean {
	const raw = (value as Record<string, unknown>)[key];
	return raw === true;
}

/** 章节标题行：`【正文】（body，action=text）`。 */
export function sectionHeading(label: string, sectionId: string, action: string): string {
	return `【${label}】（${sectionId}，action=${action}）`;
}

/** 卡的分组文案（给 #3 用）。 */
export function groupText(state: TaskState): string {
	return groupOf(state);
}

/**
 * 「当前状态 + 接下来可以做什么」的文本视图（#8 查询 / #6 #7 改完的回执共用）。
 *
 * 用户第二轮原话：
 * > 在这里改完了以后，输出现在的状态和这个状态在这个分类下，接下来可以做什么。
 *
 * ⇒ 同一份渲染给三个地方用，避免三处措辞 drift。
 */
export function renderAdvice(advice: TransitionAdvice, holder: string | undefined): string {
	const lines: string[] = [];
	lines.push(`卡 ${advice.cardId}「${advice.title}」当前状态：${stateText(advice.status)}（分类 ${advice.kind}）`);
	lines.push(
		holder === undefined
			? '调用者身份：宿主没有提供（领取 / 释放会失败）。'
			: `调用者身份：${holder}`,
	);

	const available = advice.targets.filter((one) => one.available);
	const blocked = advice.targets.filter((one) => !one.available);

	lines.push('', '接下来可转移的目标：');
	if (available.length === 0) lines.push('  （无）');
	for (const target of available) {
		lines.push(`  · ${stateText(target.to)} ——「${target.label}」（action=${target.action}）[可执行]`);
	}

	if (blocked.length > 0) {
		lines.push('', '现在不可执行的目标（条件目标）：');
		for (const target of blocked) {
			lines.push(`  · ${stateText(target.to)} ——「${target.label}」（action=${target.action}）`);
			for (const condition of target.conditions) {
				lines.push(
					`      原因：${condition.message}` +
						`（code=${condition.code}；${condition.retryable ? '修正后可重试' : '不可重试'}）`,
				);
				for (const blocker of condition.blockers ?? []) {
					lines.push(`      阻塞卡：${blocker.id}「${blocker.title}」（状态：${blocker.status}）`);
				}
			}
		}
	}

	lines.push('', '执行方式：把目标状态 id 填进 to 再调一次（例如 to=TASK_STATE_WORKING）。');
	return lines.join('\n');
}
