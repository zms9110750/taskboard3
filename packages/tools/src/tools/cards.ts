/**
 * #2 列出卡。
 *
 * 用户要求：
 * > 需要一个参数描述空间（null 时行为未定义，DSH 视为激活空间，MCP 报错）。
 * > 其他参数用于筛选：状态、领域、分类、模板，和两个 bool：用户没看、AI 没看。
 * > 筛选没写时不包含草稿；但筛选给状态明确写了草稿时，包含草稿。
 *
 * 用户后续裁决 #3：
 * > 列卡加标题模糊搜索 + page；看卡必须编号；编号强制看可以看到草稿和已删除的卡。
 *
 * ## 两个 bool 的语义（按「谁没看」命名，用户口径）
 *
 * | 参数 | 含义 | core 的卡片字段 |
 * |---|---|---|
 * | `userUnread: true` | 用户还没看（AI 改过） | `unread.ai === true` |
 * | `aiUnread: true` | AI 还没看（用户改过） | `unread.user === true` |
 *
 * 两个同时给 = **AND**（两边都未读）；只给一个 = 只筛那一边。
 *
 * ## 分页
 *
 * `page` 从 1 开始，每页固定 20 张（`CARDS_PAGE_SIZE`）。排序沿用 core 的
 * 搜索顺序（采纳时间 ?? 创建时间 倒序）。分页信息写在返回头部/尾部，
 * AI 可以据此翻页。
 */

import { DRAFT, STATE_LABELS, TASK_STATES } from '@taskboard/protocol';

import { inputFailure } from '../failure.ts';
import { boolOf, intOf, resolveWorkspace, strs, str } from '../context.ts';
import { cardLine, stateText } from '../render.ts';
import { okText } from '../schema.ts';
import type { SearchCondition } from '@taskboard/core';
import type { TaskboardToolHandler } from '../types.ts';
import { CARDS_PAGE_SIZE, defineTool, type ToolDeps } from './shared.ts';

/** 合法的状态组 id。 */
const GROUPS = ['draft', 'active', 'shelved', 'ended'] as const;

/** 把一个筛选值归一成 core 认的 status 值（状态 id / 组 id / 中文名）。 */
function normalizeStatus(value: string): string | undefined {
	if (TASK_STATES.includes(value as (typeof TASK_STATES)[number])) return value;
	if ((GROUPS as readonly string[]).includes(value)) return value;
	const byLabel = TASK_STATES.find((state) => STATE_LABELS[state] === value.trim());
	return byLabel;
}

export function createCardsTool(deps: ToolDeps): ReturnType<typeof defineTool> {
	const { taskboard } = deps;

	const handler: TaskboardToolHandler = async (args, ctx) => {
		const resolved = await resolveWorkspace(args, ctx);
		if (!resolved.ok) return resolved.result;
		const workspaceId = resolved.workspaceId;

		/* ── 状态筛选归一 + 草稿可见性 ── */
		const rawStatus = strs(args, 'status');
		const status: string[] = [];
		if (rawStatus !== undefined) {
			for (const value of rawStatus) {
				const normalized = normalizeStatus(value);
				if (normalized === undefined) {
					return inputFailure(
						`状态筛选值「${value}」不认识；可用：${TASK_STATES.map((state) => `${state}（${STATE_LABELS[state]}）`).join('、')}，或组 id：${GROUPS.join(' / ')}。`,
						'改成上面列出的状态 id / 中文名 / 组 id 后重试。',
					);
				}
				status.push(normalized);
			}
		}
		const draftsIncluded = status.includes(DRAFT) || status.includes('draft');

		/* ── 未读筛选（两个 bool，AND / 单边） ── */
		const wantUserUnread = boolOf(args, 'userUnread') === true; /* 用户没看 = unread.ai */
		const wantAiUnread = boolOf(args, 'aiUnread') === true; /* AI 没看 = unread.user */
		let unreadIds: ReadonlySet<string> | undefined;
		if (wantUserUnread || wantAiUnread) {
			const updates = await taskboard.updates(workspaceId);
			const users = new Set(updates.ai); /* AI 改过 ⇒ 用户没看 */
			const ais = new Set(updates.user); /* 用户改过 ⇒ AI 没看 */
			if (wantUserUnread && wantAiUnread) {
				unreadIds = new Set([...users].filter((id) => ais.has(id)));
			} else if (wantUserUnread) {
				unreadIds = users;
			} else {
				unreadIds = ais;
			}
		}

		/* ── core 搜索（未读在工具层做集合过滤：AND 语义 core 的 updatedBy 表达不了） ── */
		const title = str(args, 'title');
		const kind = strs(args, 'kind');
		const domain = strs(args, 'domain');
		const templateRef = strs(args, 'templateRef');
		const condition: SearchCondition = {
			...(title === undefined ? {} : { title }),
			...(status.length === 0 ? {} : { status }),
			...(kind === undefined ? {} : { kind }),
			...(domain === undefined ? {} : { domain }),
			...(templateRef === undefined ? {} : { templateRef }),
		};
		let cards = taskboard.search(workspaceId, condition);
		if (unreadIds !== undefined) cards = cards.filter((card) => unreadIds.has(card.id));

		/* ── 分页 ── */
		const page = intOf(args, 'page') ?? 1;
		if (page < 1) {
			return inputFailure('page 必须是 >= 1 的整数。', 'page 从 1 开始。');
		}
		const total = cards.length;
		const totalPages = Math.max(1, Math.ceil(total / CARDS_PAGE_SIZE));
		if (page > totalPages) {
			return inputFailure(
				`page=${page} 超出范围：当前筛选下共 ${total} 张卡，按每页 ${CARDS_PAGE_SIZE} 张算只有 ${totalPages} 页。`,
				`改用 page 1~${totalPages}；或者调整筛选条件。`,
			);
		}
		const start = (page - 1) * CARDS_PAGE_SIZE;
		const pageCards = cards.slice(start, start + CARDS_PAGE_SIZE);

		/* ── 渲染 ── */
		const filters = describeFilters(args, status, draftsIncluded, wantUserUnread, wantAiUnread);
		const lines: string[] = [];
		lines.push(
			`空间「${workspaceId}」共 ${total} 张卡` +
				`${filters === '' ? '' : `（筛选：${filters}）`}` +
				`；第 ${page}/${totalPages} 页（每页 ${CARDS_PAGE_SIZE} 张）。`,
		);
		if (draftsIncluded) lines.push('（状态筛选包含草稿 ⇒ 本次结果包含草稿。）');
		if (pageCards.length === 0) {
			lines.push('没有符合条件的卡。');
		} else {
			lines.push('');
			for (const card of pageCards) lines.push(cardLine(card));
		}
		if (page < totalPages) {
			lines.push('', `还有下一页：page=${page + 1}。`);
		} else if (total > 0) {
			lines.push('', '已经是最后一页。');
		}

		return okText(lines.join('\n'));
	};

	return defineTool({
		name: 'taskboard_cards',
		description:
			'列任务卡 / 搜索。空间省略时用宿主激活空间（没有该行为的宿主会报错）。可按标题（模糊）、状态、领域、分类、模板筛选，' +
			'以及「用户没看 / AI 没看」两个未读筛选（两个同时给 = 两边都未读）。' +
			'不写状态筛选时**不含草稿**；状态里明确写了草稿（draft / TASK_STATE_UNSPECIFIED / 中文「未指定」）才包含草稿。' +
			`结果分页（每页 ${CARDS_PAGE_SIZE} 张，page 从 1 开始）。`,
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: {
					type: 'string',
					description: '空间 id。省略 = 宿主激活空间（DSH）；MCP 等没有该行为的宿主会报错。',
				},
				title: { type: 'string', description: '标题模糊搜索（子串，大小写不敏感）。' },
				status: {
					type: 'array',
					items: { type: 'string' },
					description:
						'状态筛选：状态 id（TASK_STATE_*）、中文名、或组 id（draft/active/shelved/ended）。数组内 OR。',
				},
				kind: { type: 'array', items: { type: 'string' }, description: '分类 id。数组内 OR。' },
				domain: { type: 'array', items: { type: 'string' }, description: '领域名。数组内 OR。' },
				templateRef: { type: 'array', items: { type: 'string' }, description: '模板 ref。数组内 OR。' },
				userUnread: {
					type: 'boolean',
					description: '只看「用户还没看」的卡（AI 改过、用户未读）。',
				},
				aiUnread: {
					type: 'boolean',
					description: '只看「AI 还没看」的卡（用户改过、AI 未读）。',
				},
				page: { type: 'integer', description: `页码，从 1 开始；每页 ${CARDS_PAGE_SIZE} 张。省略 = 1。` },
			},
		},
		handler,
	});
}

/** 把本次筛选渲染成一行说明。 */
function describeFilters(
	args: unknown,
	status: readonly string[],
	draftsIncluded: boolean,
	wantUserUnread: boolean,
	wantAiUnread: boolean,
): string {
	const parts: string[] = [];
	const title = str(args, 'title');
	if (title !== undefined) parts.push(`标题含「${title}」`);
	if (status.length > 0) parts.push(stateSummary(status));
	if (strs(args, 'kind') !== undefined) parts.push(`分类=${(strs(args, 'kind') ?? []).join('/')}`);
	if (strs(args, 'domain') !== undefined) parts.push(`领域=${(strs(args, 'domain') ?? []).join('/')}`);
	if (strs(args, 'templateRef') !== undefined) parts.push(`模板=${(strs(args, 'templateRef') ?? []).join('/')}`);
	if (wantUserUnread) parts.push('用户没看');
	if (wantAiUnread) parts.push('AI 没看');
	if (draftsIncluded) parts.push('含草稿');
	return parts.join('；');
}

/** 状态筛选值的可读摘要。 */
function stateSummary(status: readonly string[]): string {
	const labels = status.map((value) =>
		(TASK_STATES as readonly string[]).includes(value) ? stateText(value) : `${value}（组）`,
	);
	return `状态=${labels.join(' / ')}`;
}
