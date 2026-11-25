/**
 * #3 查看卡。
 *
 * 用户要求：
 * > 包括卡的状态、历史、关系、备注、action 给的视图。参数是一个编号和一个空间。
 * > 只要查看了就是 AI 已经读过。
 *
 * 用户后续裁决 #3：
 * > 看卡必须编号；编号强制看可以看到草稿和已删除的卡。
 *
 * ## 「编号强制看」
 *
 * 本工具**不经过列表/筛选**，直接按编号取卡 ⇒ 草稿、墓碑都能看到。
 * 这是刻意的：AI 需要一个「无论如何都能看到这张卡」的入口（比如核对墓碑）。
 *
 * ## 查看即已读
 *
 * 成功取到卡之后调 `markSeen(..., 'ai')`（清「用户改过、AI 未读」）。
 * 已读失败**不阻断**查看 —— 读是主目的，副作用失败只提示。
 */

import type { Card } from '@taskboard/core';

import { resolveWorkspace, str } from '../context.ts';
import { failureResult, inputFailure } from '../failure.ts';
import { groupText, renderPayload, sectionHeading, stateText, unreadFlags } from '../render.ts';
import { okText } from '../schema.ts';
import type { TaskboardToolHandler } from '../types.ts';
import { defineTool, type ToolDeps } from './shared.ts';

/** 历史展示条数上限（避免大卡把上下文打爆；总数单独给）。 */
const HISTORY_LIMIT = 10;

export function createCardTool(deps: ToolDeps): ReturnType<typeof defineTool> {
	const { taskboard } = deps;

	const handler: TaskboardToolHandler = async (args, ctx) => {
		const resolved = await resolveWorkspace(args, ctx);
		if (!resolved.ok) return resolved.result;
		const workspaceId = resolved.workspaceId;
		const cardId = str(args, 'id');
		if (cardId === undefined) {
			return inputFailure('必须给卡编号（id）；本工具不靠筛选定位。', '先调 taskboard_cards 拿编号，再按编号查看。');
		}

		const found = taskboard.get(workspaceId, cardId);
		if (!found.ok) return failureResult(found, { action: '查看卡失败' });
		const card = found.card;

		/* 关系目标标题（同空间的卡；墓碑不在列表里时只显示编号）。 */
		// TODO(审查): 为了给关系目标配标题，把整个空间的卡全量 list() 一遍（O(全库) 拿全部卡对象），
		// 而被引用的 id 通常只有几个。可改成先收集 parent/links 的 id 再逐个 get() —— 但那样墓碑标题会显示出来，
		// 与现在「墓碑不在列表里时只显示编号」不一致 ⇒ 行为变化，需用户决定。
		const titles = new Map<string, string>();
		for (const one of taskboard.list(workspaceId)) titles.set(one.id, one.title);
		const titleOf = (id: string): string => {
			const title = titles.get(id);
			return title === undefined ? '' : `「${title}」`;
		};

		const lines: string[] = [];
		lines.push(`${card.id}「${card.title}」`);
		lines.push(`状态：${stateText(card.status)}（组：${groupText(card.status)}）`);
		lines.push(`模板：${card.template.ref}（分类 ${card.template.kind} / 领域 ${card.template.domain}）`);
		if (card.deleted) lines.push('⚠ 这张卡已被删除（墓碑）。按编号强制查看，能看到它的最后内容。');
		lines.push(`持有者：${card.holders.length === 0 ? '（无人持有）' : card.holders.map((one) => one.holder).join('、')}`);
		lines.push(`备注：${card.note === '' ? '（空）' : card.note}`);

		/* ── 关系 ── */
		const links = card.relations.links;
		if (card.relations.parent !== null || links.length > 0) {
			lines.push('', '关系：');
			if (card.relations.parent !== null) {
				lines.push(`  父卡：${card.relations.parent}${titleOf(card.relations.parent)}`);
			}
			for (const link of links) lines.push(`  ${link.label} → ${link.to}${titleOf(link.to)}`);
		}

		/* ── 章节（action 给的视图） ── */
		const template = taskboard.templates().get(card.template.ref);
		const sections = Object.entries(card.sections);
		lines.push('', `章节（${sections.length} 个）：`);
		if (sections.length === 0) {
			lines.push('（没有章节：空模板）');
		} else {
			for (const [sectionId, section] of sections) {
				const action =
					// TODO(审查): 这里的 `String((payload as {$type: string}).$type)` 是为了兜住「断言没收窄类型」：
					// 先 `const t = (payload as {$type?: unknown}).$type;` 再 `typeof t === 'string'`，就能自然收窄、不必 String()。
					// （AGENTS 3.1 的微型版：断言让编译器闭嘴，代价是多一次无意义转换。）可直接改。
					template?.sections.find((one) => one.id === sectionId)?.action ??
					(typeof section.payload === 'object' &&
					section.payload !== null &&
					typeof (section.payload as { $type?: unknown }).$type === 'string'
						? String((section.payload as { $type: string }).$type)
						: 'unknown');
				lines.push('', sectionHeading(section.label, sectionId, action));
				lines.push(renderPayload(section.payload));
			}
		}

		/* ── 历史 ── */
		if (card.history.length > 0) {
			const recent = card.history.slice(-HISTORY_LIMIT);
			lines.push('', `历史（最近 ${recent.length} 条，共 ${card.history.length} 条）：`);
			for (const entry of recent) {
				lines.push(`  ${new Date(entry.at).toISOString()}  ${entry.action}（${entry.actor}）`);
			}
		}

		/* ── 查看即已读（副作用失败不阻断） ── */
		lines.push('', `查看前未读：${unreadText(card)}`);
		const seen = await taskboard.markSeen(workspaceId, cardId, 'ai');
		if (seen.ok) {
			lines.push(`查看后未读：${unreadText({ unread: seen.unread })}（已标记 AI 已读）`);
		} else {
			lines.push(`⚠ 标记 AI 已读失败（不影响本次查看）：${seen.message}`);
		}
		lines.push('（注：本工具按编号强制查看，不受草稿/筛选限制。）');

		// TODO(审查): 这个 `\n{3,}` 归一会作用在**整段输出**上，包括各章节 payload 的正文 ——
		// markdown / code 块里的连续空行会被压掉（内容变形）。可直接改：只在拼装层用空行控制，别事后正则洗全文。
		return okText(lines.join('\n').replace(/\n{3,}/gu, '\n\n'));
	};

	return defineTool({
		name: 'taskboard_card',
		description:
			'按编号查看一张卡：状态、历史、关系、备注、各章节的 action 视图。' +
			'**必须给编号**（不靠筛选定位）；按编号直查，所以草稿和已删除的卡也能看到。' +
			'**查看即 AI 已读**：会清掉这张卡上「用户改过、AI 未读」的标记。' +
			'要改卡内容请先用 taskboard_raw_card 看原始 JSON。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: {
					type: 'string',
					// TODO(审查): 旧文案：缺 workspaceId 直接失败，不是「用激活空间」；7 个工具都有这处。可直接改成「必填」。
					description: '空间 id。省略 = 宿主激活空间（DSH）；MCP 等没有该行为的宿主会报错。',
				},
				id: { type: 'string', description: '卡编号（如 W1）。必填。' },
			},
			required: ['id'],
		},
		handler,
	});
}

/** 未读文案（before / after 共用）。 */
function unreadText(card: Pick<Card, 'unread'>): string {
	const flags = unreadFlags(card.unread);
	return flags === '' ? '无' : flags;
}
