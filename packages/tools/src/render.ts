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

import type { Card, CardUnread, KindDef, TransitionAdvice } from '@taskboard/core';
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
 * ## 走 `ActionTextRegistry`，不是 if/else（用户 2026-11-22）
 *
 * > 「多出来的 action，翻译为 tool 的文字，这个也是渲染器。也要有分发器。」
 *
 * 内置三件（text / markdown / ask）由 `core/src/action-text.ts` 的
 * `DEFAULT_ACTION_TEXT` 注册；第三方可以 `DEFAULT_ACTION_TEXT.register(type, fn)`。
 * 没注册的 type ⇒ 走注册表的**降级函数**（`registry.fallback()`，默认是 JSON，第三方可换）。
 *
 * @param payload 卡上的 raw payload
 */
export function renderPayload(payload: unknown): string {
	if (typeof payload === 'string') return truncate(payload);
	if (typeof payload !== 'object' || payload === null) return truncate(String(payload));
	return truncate(textOfAction(payload));
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
		// TODO(审查): 这段「原因：…（code=…；…）」+「阻塞卡：…」的排版，在 tools/transition.ts 的 conditionFailure
		// 里又原样写了一遍（两份文本真值，措辞迟早漂）。可直接改：抽成 conditionLines() 供两处共用。
				lines.push(
					`      原因：${condition.message}` +
						`（code=${condition.code}；${condition.retryable ? '修正后可重试' : '不可重试'}）`,
				);
				for (const blocker of condition.blockers ?? []) {
					/* `status` 可选：查不到阻塞卡时不编造状态，也就不打印「状态：undefined」。 */
					const status = blocker.status === undefined ? '' : `（状态：${blocker.status}）`;
					lines.push(`      阻塞卡：${blocker.id}「${blocker.title}」${status}`);
				}
			}
		}
	}

	lines.push('', '执行方式：把目标状态 id 填进 to 再调一次（例如 to=TASK_STATE_WORKING）。');
	return lines.join('\n');
}

/* ──────────────── 建卡回执的「下一步」：按类别 / 领域动态补 ──────────────── */

/**
 * 领域定义的结构形状。
 *
 * `core` 没有从包根导出 `DomainDef`（它只是 `domains()` 返回类型的一部分），
 * 所以这里声明结构形状：结构上满足即可，**不复制实现**。
 */
export interface DomainView {
	readonly id: string;
	readonly displayName: string;
	readonly description: string;
}

/**
 * 按 id 或显示名找领域定义。
 *
 * 卡上的 `template.domain` 是**模板里的原文**：内置模板写的是中文显示名
 * （「核心」/「代码」），第三方也可以写注册表 id。两种都认；
 * 认不出返回 `undefined`，由调用方如实说「注册表里没有」，**不编描述**。
 */
export function findDomain(domains: readonly DomainView[], name: string): DomainView | undefined {
	return domains.find((one) => one.id === name) ?? domains.find((one) => one.displayName === name);
}

/** 类别引用文案：名字取自注册表；未注册就只给 id，不猜名字。 */
function kindRef(def: KindDef | undefined, id: string): string {
	return def === undefined ? `kind=${id} 的卡` : `「${def.displayName}」卡（kind=${def.id}）`;
}

/**
 * 「这个类别下一张卡通常是什么」（#15 附加项② / issue #35）。
 *
 * ## 为什么有四条按 id 的分支
 *
 * 这四句是**行为**（下一张卡该开什么），不是词表：类别显示名与说明仍然从
 * `KindRegistry`（`KindDef.displayName` / `description`）取；
 * 交叉引用的目标类别（`work` / `record`）也先按 id 去注册表解析再取显示名 ——
 * 注册表内容变了，回执跟着变，不会留在工具层一份硬编码文案。
 *
 * 未知类别（第三方 `register` 的）**不猜语义**，只按 `KindDef` 自己声明的
 * `needsClaim` / `reopenable` 给一条保守提示。
 */
export function kindNextStepText(kind: KindDef, findKind: (id: string) => KindDef | undefined): string {
	const work = kindRef(findKind('work'), 'work');
	const record = kindRef(findKind('record'), 'record');
	switch (kind.id) {
		case 'goal':
			return `目标确立后，建${work}执行它。`;
		case 'design':
			return `等用户确认方向后，再建${work}执行它。`;
		case 'work':
			return `完成后要有交付记录：建${record}作证据。`;
		case 'record':
			return '确认后作为证据存档。';
		default:
			if (kind.needsClaim) return `完成后要有交付记录：建${record}作证据。`;
			if (kind.reopenable) return `方向/目标明确后，再建${work}执行它。`;
			return '确认后作为证据存档。';
	}
}

/**
 * 领域的回执文案 —— **只补一句注册表里的描述**。
 *
 * 领域不参与任何判定（`core/src/template/domains.ts`：纯展示 + 筛选），
 * 所以这里不给它编行为提示；没注册的领域也不编描述。
 */
export function domainText(domain: DomainView | undefined, raw: string): string {
	if (domain === undefined) return `领域「${raw}」：领域注册表里没有它，未提供描述。`;
	if (domain.description === '') return `领域（${domain.displayName}）`;
	return `领域（${domain.displayName}）：${domain.description}`;
}
