/**
 * 16 个 AI 工具 —— 把 core 的领域能力包成**宿主无关**的模型可调用工具。
 *
 * ## 本模块只做三件事
 *
 * 1. 把模型参数映射成 core 入参；
 * 2. 调 `Taskboard` 接口；
 * 3. 把结果 / `Failure` 翻译成模型能据此改对的话。
 *
 * 业务规则一律在 core（校验也在 core —— 用户裁定：「就在 core 里面验证就好了。
 * 因为用户从 ui 里面创建卡，也是走数据给 core 的」）。本层**不重复实现校验**。
 *
 * ## ⚠ schema 必须静态
 *
 * 用户裁定：工具 schema 在 prompt 前缀里，**一动就击穿 KV cache**。
 * ⇒ 参数表逐字节固定，**不按模板 / 空间 / actor / 状态动态生成**。
 *
 * 两个直接的后果：
 *
 * · `content` 是**开放对象**（`additionalProperties: true`），不按模板展开；
 * · `taskboard_transition` 的 `to` 是 **`string`**，不用 `enum`
 *   —— 状态表若扩了，`enum` 会让 schema 变、缓存全废。合法性在 handler 里判。
 *
 * ## ⚠ 本模块什么都不 import，除了 core / protocol
 *
 * 不 import `@deepseek-ai/dsh-tools`、cordis、`express`、任何 `node:` 内置，
 * 也不 import 任何运行时 schema 库（zod 等）。宿主适配层（DSH / MCP）
 * 在**自己那边**把本层产出转成宿主的工具形状 —— 见 `README.md`。
 *
 * ## 与旧实现（`packages/dsh/src/tools.ts`）的关系
 *
 * 名字、描述、行为都对齐那 16 个工具；差别只有三处，都是为了「宿主无关」：
 *
 * | 差别 | 旧（dsh） | 本包 |
 * |---|---|---|
 * | 参数表 | dsh-tools 的 `parameters` 记录（`required: true` 内联） | 完整 JSON Schema（`required: [...]`） |
 * | 调用身份 | `holderOf(ctx.subagents, exec)` | `ctx.holder`（宿主算好再传） |
 * | 默认空间 | `deps.defaultWorkspaceId`（必传） | 工厂可选注入，省略用「第一个 / 建默认」 |
 */

import type { Card, Taskboard } from '@taskboard/core';
import { BASE_TOOLS, EXECUTION_TOOLS, READONLY_TOOLS } from '@taskboard/core';
import type { TaskState } from '@taskboard/protocol';
import {
	STATE_LABELS,
	TASK_STATES,
	buttonTargetsOf,
	buttonsOf,
	groupOf as groupOfState,
	isTaskState,
	judgeTransition,
	labelOf,
} from '@taskboard/protocol';

import { adoptTargetOf, isAdoptTransition } from './adopt.ts';
import { bodyOf, cardLine, describeFailure, describeUnread, previewOf, stateText } from './format.ts';
import { errorResult, freezeSchema, textResult } from './schema.ts';
import type {
	JsonObjectSchema,
	JsonSchema,
	TaskboardTool,
	TaskboardToolContext,
	TaskboardToolResult,
	TaskboardToolsOptions,
} from './types.ts';

/* ────────────────────────── 复用的参数节点 ──────────────────────────
 *
 * 模块级常量 ⇒ **不随调用 / 模板 / 空间变化**。这是「schema 静态」的第一层保证；
 * 第二层是 `freezeSchema`（见 `schema.ts`）。
 */

const WORKSPACE_ID: JsonSchema = Object.freeze({
	type: 'string',
	description: '空间 id。省略 = 入口的默认空间。',
});

const CARD_ID: JsonSchema = Object.freeze({
	type: 'string',
	description: '卡编号，如 GU01。',
});

/** 读参数里的字符串。 */
function str(args: unknown, key: string): string | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === 'string' ? value : undefined;
}

/** 读参数里的数组（字符串数组）。 */
function strs(args: unknown, key: string): readonly string[] | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	if (!Array.isArray(value)) return undefined;
	return value.filter((one): one is string => typeof one === 'string');
}

/** 读参数里的布尔值（严格：只认 `boolean`，其它一律 `undefined`）。 */
function boolOf(args: unknown, key: string): boolean | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === 'boolean' ? value : undefined;
}

/** 读参数里的任意值。 */
function rawOf(args: unknown, key: string): unknown {
	if (typeof args !== 'object' || args === null) return undefined;
	return (args as Record<string, unknown>)[key];
}

/** 解析默认空间：有注入用注入的；否则「第一个空间，没有就建『默认』」。 */
function fallbackDefaultWorkspaceId(taskboard: Taskboard): () => Promise<string> {
	return async (): Promise<string> => {
		const first = taskboard.listWorkspaces(false)[0];
		if (first !== undefined) return first.id;
		return (await taskboard.ensureAnyWorkspace()).id;
	};
}

/**
 * 结构化地建一个工具（顺手深冻结 schema）。
 *
 * 单独一个函数是为了让 16 个工具的定义读起来是「一张表」，
 * 而不是十六段各写一遍 `Object.freeze`。
 */
function tool(definition: {
	readonly name: string;
	readonly description: string;
	readonly inputSchema: JsonObjectSchema;
	readonly handler: TaskboardTool['handler'];
}): TaskboardTool {
	return Object.freeze({
		name: definition.name,
		description: definition.description,
		inputSchema: freezeSchema(definition.inputSchema),
		handler: definition.handler,
	});
}

/** 从上下文取持有者；缺席回落 `'unknown'`（与 `dsh/src/holder.ts` 一致）。 */
function holderIn(ctx: TaskboardToolContext): string {
	const holder = ctx.holder;
	return typeof holder === 'string' && holder !== '' ? holder : 'unknown';
}

/**
 * 建全部 AI 工具（**名字与顺序都是契约**，与 `dsh` 的 16 个工具同名）。
 *
 * @param taskboard 只被调用、不被包装的领域实例
 * @param options 入口策略（默认空间解析）
 * @returns 工具定义数组（顺序即注册顺序）
 */
export function createTaskboardTools(
	taskboard: Taskboard,
	options: TaskboardToolsOptions = {},
): readonly TaskboardTool[] {
	const defaultWorkspaceId = options.defaultWorkspaceId ?? fallbackDefaultWorkspaceId(taskboard);

	/** 解析目标空间：参数优先，否则入口默认。 */
	const resolveWorkspace = async (args: unknown): Promise<string> =>
		str(args, 'workspaceId') ?? (await defaultWorkspaceId());

	/** 取一张卡（带失败翻译）。 */
	const mustGetCard = (
		workspaceId: string,
		cardId: string,
	): { readonly ok: true; readonly card: Card } | { readonly ok: false; readonly result: TaskboardToolResult } => {
		const found = taskboard.get(workspaceId, cardId);
		if (!found.ok) return { ok: false, result: errorResult(describeFailure(found)) };
		return found;
	};

	/* ── 1. 空间清单 ── */
	const workspaces = tool({
		name: 'taskboard_workspaces',
		description: '列任务板的工作空间（容器）。每个空间有自己的卡。',
		inputSchema: {
			type: 'object',
			properties: {
				includeArchived: {
					type: 'boolean',
					description: '是否包含已归档的空间。省略 = 不包含。',
				},
			},
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const list = taskboard.listWorkspaces(boolOf(args, 'includeArchived') === true);
			if (list.length === 0) {
				return textResult(
					'还没有任何工作空间。请先在任务板界面上建一个（本工具集不建空间），或由宿主入口自动创建后重试。',
				);
			}
			const lines = list.map(
				(ws) =>
					`${ws.id}  ${ws.displayName}${ws.archived ? '（已归档）' : ''}  ${taskboard.list(ws.id).length} 张卡`,
			);
			return textResult(`工作空间（${list.length} 个）：\n${lines.join('\n')}`);
		},
	});

	/* ── 2. 卡列表 / 搜索 ── */
	const cards = tool({
		name: 'taskboard_cards',
		description:
			'列任务卡，可按标题、状态、类别、领域、模板、以及「谁改过而对方未读」筛选。不填条件时列出当前空间的全部有效卡（不含草稿）。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: WORKSPACE_ID,
				title: { type: 'string', description: '标题子串（大小写不敏感）。' },
				status: {
					type: 'array',
					items: { type: 'string' },
					description: '状态 id 或组 id（draft / active / shelved / ended）。数组内 OR。',
				},
				kind: { type: 'array', items: { type: 'string' }, description: '类别 id。数组内 OR。' },
				domain: { type: 'array', items: { type: 'string' }, description: '领域名。数组内 OR。' },
				templateRef: { type: 'array', items: { type: 'string' }, description: '模板 ref。数组内 OR。' },
				/*
				 * ⚠ **两个 boolean 的名字容易搞反，注释必须写清对应关系。**
				 *
				 * 字段名按「**谁改的**」命名（core 的口径）：
				 *   updates.user —— 用户改过，**AI** 还没看过
				 *   updates.ai   —— AI 改过，**用户**还没看过
				 *
				 * 所以：
				 *   userChanged ⇒ updates.user（**用户**改的）
				 *   userUnread  ⇒ updates.ai  （**用户**未读的，也就是 AI 改的）
				 *
				 * 记忆法：「Changed」说的是**作者**（谁改的）；「Unread」说的是**读者**
				 * （谁还没看）—— 两个词的视角正好相反，这是最容易错的地方。
				 */
				userChanged: {
					type: 'boolean',
					description:
						'只看「用户改过、而 AI 还没看过」的卡（对应 core 的 updates.user）。想找「AI 需要处理什么」时用它。',
				},
				userUnread: {
					type: 'boolean',
					description:
						'只看「AI 改过、而用户还没看过」的卡（对应 core 的 updates.ai）。想找「用户还没看到的改动」时用它。',
				},
			},
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const workspaceId = await resolveWorkspace(args);
			const title = str(args, 'title');
			const status = strs(args, 'status');
			const kind = strs(args, 'kind');
			const domain = strs(args, 'domain');
			const templateRef = strs(args, 'templateRef');

			/*
			 * 「谁改过、对方未读」这个**事件维度** search 自己算不出来
			 * ⇒ 这里先问 core 要结果集，再交给 search 做集合判定。
			 *
			 * ⚠ 结果集来自卡自己的 `Card.unread` 字段（用户裁定：「不能再用胶水代码了」）。
			 *   本工具**调用方式没变**，但底层语义是：**标记已读会直接改卡字段**。
			 */
			const wantUserChanged = boolOf(args, 'userChanged');
			const wantUserUnread = boolOf(args, 'userUnread');
			let updatedBy: readonly ('ai' | 'user')[] | undefined;
			let updatedCardIds: readonly string[] | undefined;
			if (wantUserChanged === true || wantUserUnread === true) {
				const updates = await taskboard.updates(workspaceId);
				const ids = new Set<string>();
				if (wantUserChanged === true) for (const id of updates.user) ids.add(id);
				if (wantUserUnread === true) for (const id of updates.ai) ids.add(id);
				updatedCardIds = [...ids];
				/* 只用于让 search 走「集合判定」分支；具体是哪个集合已由 `updatedCardIds` 决定。 */
				updatedBy = [
					...(wantUserChanged === true ? (['user'] as const) : []),
					...(wantUserUnread === true ? (['ai'] as const) : []),
				];
			}

			const list = taskboard.search(workspaceId, {
				...(title === undefined ? {} : { title }),
				...(status === undefined ? {} : { status }),
				...(kind === undefined ? {} : { kind }),
				...(domain === undefined ? {} : { domain }),
				...(templateRef === undefined ? {} : { templateRef }),
				...(updatedBy === undefined ? {} : { updatedBy }),
				...(updatedCardIds === undefined ? {} : { updatedCardIds }),
			});
			if (list.length === 0) return textResult('没有符合条件的卡。');
			return textResult(`空间「${workspaceId}」共 ${list.length} 张卡：\n${list.map(cardLine).join('\n')}`);
		},
	});

	/* ── 3. 看单卡详情 ── */
	const card = tool({
		name: 'taskboard_card',
		description:
			'看一张任务卡的详情：元数据（状态、模板、关系、备注、历史）+ 各章节内容。按编号直查，能看到草稿和已删除的卡。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: WORKSPACE_ID,
				id: CARD_ID,
			},
			required: ['id'],
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const workspaceId = await resolveWorkspace(args);
			const found = mustGetCard(workspaceId, str(args, 'id') ?? '');
			if (!found.ok) return found.result;

			const one = found.card;
			const lines: string[] = [
				`${one.id}  ${one.title}`,
				`状态：${stateText(one.status)}（组：${groupOfState(one.status)}）`,
				`模板：${one.template.ref}（${one.template.kind} / ${one.template.domain}）`,
			];
			if (one.deleted) lines.push('⚠ 这张卡已被删除（墓碑）。');
			if (one.holders.length > 0) {
				lines.push(`占用者：${one.holders.map((held) => held.holder).join('、')}`);
			}
			if (one.note !== '') lines.push(`备注：${one.note}`);

			const parent = one.relations.parent;
			if (parent !== null) lines.push(`父卡：${parent}`);
			if (one.relations.links.length > 0) {
				const links = one.relations.links.map((link) => `${link.label}→${link.to}`).join('、');
				lines.push(`关系：${links}`);
			}

			const sections = Object.entries(one.sections);
			if (sections.length === 0) {
				lines.push('', '（没有章节）');
			} else {
				lines.push('', '章节：');
				for (const [sectionId, section] of sections) {
					lines.push(`【${section.label}】（${sectionId}）`);
					lines.push(bodyOf(section.payload));
					lines.push('');
				}
			}

			if (one.history.length > 0) {
				const last = one.history.slice(-5);
				lines.push(`历史（最近 ${last.length} 条，共 ${one.history.length} 条）：`);
				for (const entry of last) {
					const when = new Date(entry.at).toISOString();
					lines.push(`  ${when}  ${entry.action}`);
				}
			}

			return textResult(lines.join('\n'));
		},
	});

	/* ── 4. 建卡 ── */
	const create = tool({
		name: 'taskboard_create',
		description:
			'建一张新任务卡。title 必填；templateRef 是模板 ref（省略 = 第一个可用模板）。content 是对象：key = 模板章节名，value = 该章节的 action payload。省略的章节用模板默认值。先调 taskboard_registry 看这个模板有哪些章节。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: WORKSPACE_ID,
				title: { type: 'string', description: '卡标题。' },
				templateRef: { type: 'string', description: '模板 ref。省略 = 第一个可用模板。' },
				content: {
					type: 'object',
					additionalProperties: true,
					description: 'key = 模板章节名（label），value = action payload 对象。可省略整个章节。',
				},
			},
			required: ['title'],
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const workspaceId = await resolveWorkspace(args);
			const title = str(args, 'title') ?? '';

			let templateRef = str(args, 'templateRef') ?? '';
			if (templateRef === '') {
				const first = taskboard.listTemplates()[0];
				if (first === undefined) {
					return errorResult(
						'当前没有任何可用模板，无法建卡。用 taskboard_registry 看模板清单；模板加载错误属于安装问题。',
					);
				}
				templateRef = first.ref;
			}

			const content = rawOf(args, 'content');
			const created = await taskboard.create({
				workspaceId,
				templateRef,
				title,
				/* ⚠ 必须显式标 `'ai'` —— 省略会默认成 `'user'`，于是「AI 改过」的角标永远不出现。 */
				actor: 'ai',
				...(content === undefined ? {} : { content }),
			});
			if (!created.ok) return errorResult(`建卡失败：\n${describeFailure(created)}`);

			const made = created.card;
			const sectionLines = Object.entries(made.sections)
				.map(([, section]) => `  · ${section.label}`)
				.join('\n');
			return textResult(
				[
					`已建卡 ${made.id}「${made.title}」（模板 ${made.template.ref}，状态 ${labelOf(made.status)}）。`,
					sectionLines === '' ? '(无章节)' : `章节：\n${sectionLines}`,
					'下一步：让用户确认后再采纳（采纳会把草稿转为提交或需要授权）。',
				].join('\n'),
			);
		},
	});

	/* ── 5. 改章节内容 ── */
	const updateContent = tool({
		name: 'taskboard_update_content',
		description:
			'改一张卡里章节的内容。content 是对象：key = 章节名（模板里的 label）或 sectionId，value = action payload。只传要改的章节；没传的保持原样。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: WORKSPACE_ID,
				id: CARD_ID,
				content: {
					type: 'object',
					additionalProperties: true,
					description: 'key = 章节名或 sectionId，value = action payload。',
				},
			},
			required: ['id'],
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';

			/*
			 * ⚠ `core.update()` 的 `content` 是**整体替换**（重建 sections），不是增量合并。
			 *   而本工具的语义是「只改这几章」。
			 *   ⇒ 先把现有章节读出来、与传入的合并，再整体提交。
			 *
			 *   这一步必须由工具做，不能指望 core —— core 的 update 语义是「给定完整 content」。
			 */
			const found = mustGetCard(workspaceId, cardId);
			if (!found.ok) return found.result;

			const incoming = rawOf(args, 'content');
			if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) {
				return errorResult('content 必须是对象：key = 章节名，value = action payload。');
			}

			/* 现有章节：key 用 label（core 的 validate 认 label 也认 sectionId）。 */
			const merged: Record<string, unknown> = {};
			for (const section of Object.values(found.card.sections)) {
				merged[section.label] = section.payload;
			}
			for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
				merged[key] = value;
			}

			const updated = await taskboard.update(workspaceId, cardId, { content: merged }, 'ai');
			if (!updated.ok) return errorResult(`改内容失败：\n${describeFailure(updated)}`);

			const changed = Object.keys(incoming as Record<string, unknown>);
			return textResult(
				`已改 ${updated.card.id}「${updated.card.title}」的 ${changed.length} 个章节：${changed.join('、')}`,
			);
		},
	});

	/* ── 6. 改备注 ── */
	const updateNote = tool({
		name: 'taskboard_update_note',
		description: '改一张卡的备注（追加型文本，不随采纳清空）。传空串 = 清空备注。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: WORKSPACE_ID,
				id: CARD_ID,
				note: { type: 'string', description: '新备注内容。空串 = 清空。' },
			},
			required: ['id', 'note'],
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';
			const note = str(args, 'note') ?? '';

			const updated = await taskboard.update(workspaceId, cardId, { note }, 'ai');
			if (!updated.ok) return errorResult(`改备注失败：\n${describeFailure(updated)}`);
			return textResult(
				note === ''
					? `已清空 ${updated.card.id} 的备注。`
					: `已更新 ${updated.card.id} 的备注（${note.length} 字）。`,
			);
		},
	});

	/* ── 7. 状态转移 / 查询可转移目标 ── */
	const transition = tool({
		name: 'taskboard_transition',
		description:
			'改一张卡的状态。to 为空 ⇒ 只回答：当前状态含义、现在能转去哪（附按钮文案）、哪些目标被拒及原因，不执行。to 有值 ⇒ 执行转移。状态 id 用协议全名（如 TASK_STATE_SUBMITTED），中文名也能认。⚠ 「采纳草稿」不是转移，用 taskboard_adopt。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: WORKSPACE_ID,
				id: CARD_ID,
				/*
				 * ⚠ **不用 `enum`** —— 状态表扩了会让 schema 变，击穿 prompt 缓存。
				 *   合法性在 handler 里判（`resolveStateId`）。
				 */
				to: { type: 'string', description: '目标状态 id。省略 = 只查询不执行。' },
			},
			required: ['id'],
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';

			const found = mustGetCard(workspaceId, cardId);
			if (!found.ok) return found.result;
			const one = found.card;
			const kind = one.template.kind;

			const toRaw = str(args, 'to');
			const to = toRaw === undefined || toRaw === '' ? undefined : resolveStateId(toRaw);
			if (toRaw !== undefined && toRaw !== '' && to === undefined) {
				return errorResult(
					`「${toRaw}」不是已知状态。可用：${TASK_STATES.map((stateId) => `${labelOf(stateId)}=${stateId}`).join('、')}`,
				);
			}

			/* ── 只查询 ── */
			if (to === undefined) {
				const allowed = buttonTargetsOf(kind, one.status, 'ai');
				const userOnly = buttonTargetsOf(kind, one.status, 'user').filter(
					(target) => !allowed.includes(target),
				);
				const lines: string[] = [
					`${one.id}「${one.title}」当前状态：${stateText(one.status)}`,
					`类别：${kind}`,
				];

				lines.push('', 'AI 现在可以转去：');
				if (allowed.length === 0) {
					lines.push('  （无）');
				} else {
					for (const target of allowed) {
						const button = buttonsOf(kind, one.status, 'ai').find((one2) => one2.to === target);
						const verdict = judgeTransition({ kind, from: one.status, to: target, trigger: 'ai' });
						const suffix = verdict.ok ? '' : `（当前不可：${verdict.reason}）`;
						/*
						 * ⚠ 采纳不是「转移」：它要写 `adoptedAt`，走的是 `taskboard_adopt`。
						 *   列表里不标这一句，模型会照着按钮文案拿 transition 去点采纳。
						 */
						const adoptNote = isAdoptTransition(kind, one.status, target)
							? '（这是「采纳」，请用 taskboard_adopt，不要用本工具）'
							: '';
						lines.push(`  · ${stateText(target)} —— 按钮「${button?.label ?? ''}」${suffix}${adoptNote}`);
					}
				}

				if (userOnly.length > 0) {
					lines.push('', '只能由用户点的：');
					for (const target of userOnly) {
						lines.push(`  · ${stateText(target)}`);
					}
				}

				/*
				 * 被拒的原因：遍历全部九个状态，看哪些到不了、为什么。
				 * ⚠ 这是**状态机的事实**，不是命运判定 —— 依赖闸门等条件由 core 在真正执行时判。
				 */
				const blocked: string[] = [];
				for (const target of TASK_STATES) {
					if (target === one.status) continue;
					if (allowed.includes(target) || userOnly.includes(target)) continue;
					const verdict = judgeTransition({ kind, from: one.status, to: target, trigger: 'ai' });
					if (!verdict.ok) blocked.push(`  · ${labelOf(target)}：${verdict.reason}`);
				}
				if (blocked.length > 0) {
					lines.push('', '到不了的（原因）：');
					lines.push(...blocked);
				}
				return textResult(lines.join('\n'));
			}

			/* ── 执行转移：AI 触发 ── */
			/*
			 * ⚠ **采纳不是转移** —— 它是独立工具 `taskboard_adopt`（从本工具拆出来的）。
			 *
			 * 理由：
			 * ① 用户把「允许采纳草稿」当成一条独立授权（core 的 `judgeToolCall`
			 *    按工具名 `taskboard_adopt` 判）—— 藏在一个「万能转移」的
			 *    action 参数里，guard 就永远命不中那条规则；
			 * ② 采纳要同时写 `adoptedAt`（与 history 那条用同一个 `at`），
			 *    与普通转移是两个 core 方法，混在一个工具里迟早漏。
			 *
			 * ⇒ 这里明确让路：告诉模型改用哪个工具，而不是静默按普通转移处理。
			 */
			if (isAdoptTransition(kind, one.status, to)) {
				return errorResult(
					`「${stateText(to)}」是**采纳草稿**，不是普通状态转移。` +
						'请改用 taskboard_adopt 工具（参数：workspaceId、id）—— ' +
						'它会走 core 的 adopt()，同时写 adoptedAt。',
				);
			}

			const applied = await taskboard.transition(workspaceId, cardId, to, 'ai');
			if (!applied.ok) return errorResult(`转移失败：\n${describeFailure(applied)}`);
			return textResult(
				`已把 ${applied.card.id} 从「${labelOf(one.status)}」改为「${labelOf(applied.card.status)}」。`,
			);
		},
	});

	/* ── 8. 采纳草稿（从 transition 拆出的独立工具） ── */
	/*
	 * ## 为什么必须是独立工具
	 *
	 * 用户把「允许采纳草稿」当成一档**独立授权**。core 的 `judgeToolCall`
	 * 第一段 ③ 就是按 `toolName === 'taskboard_adopt'` 判的 ——
	 * 如果采纳还藏在 `taskboard_transition` 的 `to` 参数里，
	 * 那条 guard 规则**永远不会命中**，用户开的档位就是个摆设。
	 *
	 * ## 参数里没有 `to`
	 *
	 * 采纳的目标状态由**类别**决定（goal/work → 提交，design/record → 需要授权），
	 * 那是 `protocol` 的 `BUTTON_ACTIONS` 里的事实（`method === 'adopt'`）。
	 * 让模型传 `to` 只会多一个可以传错的参数 —— 目标由 core 算。
	 *
	 * ## 档位
	 *
	 * 读 `taskboard.getCardActionLevel()`（core 是唯一真值）。
	 * 非 `adopt` ⇒ 直接拒绝并指路（正常路径上 guard 已经先拦了一次，
	 * 这里是 guard 缺席时的兜底 —— 加装模块没装也不该绕开用户授权）。
	 */
	const adopt = tool({
		name: 'taskboard_adopt',
		description:
			'采纳一张草稿卡：按类别转到「提交」（目标 / 工作）或「需要授权」（设计 / 记录），并写 adoptedAt。只有草稿能采纳；能否由 AI 采纳取决于任务板档位「允许采纳草稿」。普通状态转移请用 taskboard_transition。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: WORKSPACE_ID,
				id: CARD_ID,
			},
			required: ['id'],
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';

			const found = mustGetCard(workspaceId, cardId);
			if (!found.ok) return found.result;
			const one = found.card;
			const kind = one.template.kind;

			/*
			 * 先看这个 (类别, 状态) 有没有采纳按钮 —— 没有就直接说清，
			 * 不把「只有草稿能采纳」这种事实留给 core 的 TRANSITION_REJECTED
			 * （那个错误码对模型来说太泛，容易让它以为换个 to 就能过）。
			 */
			const target = adoptTargetOf(one.template.kind, one.status);
			if (target === undefined) {
				return errorResult(
					`${one.id}「${one.title}」当前状态是「${labelOf(one.status)}」（类别 ${kind}），` +
						'现在没有「采纳」这个动作。只有草稿能采纳。',
				);
			}

			const cardLevel = taskboard.getCardActionLevel();
			if (cardLevel !== 'adopt') {
				return errorResult(
					'采纳失败：当前任务板档位不允许 AI 采纳草稿。' +
						'只有「允许采纳草稿」档位才能由 AI 采纳；其它档位要用户自己在界面上点采纳。',
				);
			}

			const adopted = await taskboard.adopt(workspaceId, cardId, 'ai', { allowAiAdopt: true });
			if (!adopted.ok) return errorResult(`采纳失败：\n${describeFailure(adopted)}`);
			return textResult(
				`已把 ${adopted.card.id}「${adopted.card.title}」从草稿采纳为` +
					`「${labelOf(adopted.card.status)}」（类别 ${kind} 的采纳目标是 ${stateText(target)}）。`,
			);
		},
	});

	/* ── 9. 领取 ── */
	const claim = tool({
		name: 'taskboard_claim',
		description:
			'领取一张工作卡（提交 → 处理中）。持有者 = 你（当前 agent 的名字）。要满足核心的准入条件（依赖已结束、手上没有别的处理中工作卡等）；不满足时返回原因。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: WORKSPACE_ID,
				id: CARD_ID,
			},
			required: ['id'],
		},
		async handler(args: unknown, ctx: TaskboardToolContext): Promise<TaskboardToolResult> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';
			const holder = holderIn(ctx);

			const claimed = await taskboard.claim(workspaceId, cardId, 'ai', holder);
			if (!claimed.ok) return errorResult(`领取失败：\n${describeFailure(claimed)}`);
			return textResult(
				`已领取 ${claimed.card.id}「${claimed.card.title}」，状态 ${labelOf(claimed.card.status)}，持有者 ${holder}。`,
			);
		},
	});

	/* ── 10. 释放 ── */
	const release = tool({
		name: 'taskboard_release',
		description:
			'释放对一张处理中工作卡的领取（把自己从持有者里移除）。不算取消，改天还能再领。释放后若还有别人持有，状态不变。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: WORKSPACE_ID,
				id: CARD_ID,
			},
			required: ['id'],
		},
		async handler(args: unknown, ctx: TaskboardToolContext): Promise<TaskboardToolResult> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';
			const holder = holderIn(ctx);

			const released = await taskboard.release(workspaceId, cardId, 'ai', holder);
			if (!released.ok) return errorResult(`释放失败：\n${describeFailure(released)}`);
			return textResult(
				`已释放 ${released.card.id}「${released.card.title}」，状态 ${labelOf(released.card.status)}。`,
			);
		},
	});

	/* ── 11. 注册表 ── */
	const registry = tool({
		name: 'taskboard_registry',
		description:
			'看注册表。id 为空 ⇒ 列出所有模板与 action 的清单。给 id ⇒ 返回该模板 / action 的注册内容（模板含章节名与每章可用的 action）。kind 用来区分同名（template / action）。',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'string', description: '模板 ref 或 action 的 $type。省略 = 列清单。' },
				kind: { type: 'string', description: '`template` 或 `action`。id 有值且同名时用来区分。' },
			},
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const id = str(args, 'id');
			const kind = str(args, 'kind');

			/* ── 列清单 ── */
			if (id === undefined || id === '') {
				const templates = taskboard.listTemplates();
				const actions = taskboard.actions().list();
				const errors = taskboard.templateErrors();

				const lines: string[] = [`模板（${templates.length} 个）：`];
				for (const one of templates) {
					lines.push(`  ${one.ref}  ${one.displayName}  （${one.kind} / ${one.domain}）`);
				}
				lines.push('', `action（${actions.length} 个）：`);
				for (const one of actions) {
					lines.push(`  ${one.$type}  ${one.summary}`);
				}
				if (errors.length > 0) {
					lines.push('', `⚠ 模板加载错误（${errors.length} 条）：`);
					for (const one of errors) lines.push(`  ${one.file}：${one.message}`);
				}
				lines.push('', '给 id 看某一项的详情（模板会列出章节名与每章可用的 action）。');
				return textResult(lines.join('\n'));
			}

			/* ── 单个模板 ── */
			if (kind === 'template' || kind === undefined) {
				const meta = taskboard.templateMeta(id);
				if (meta !== undefined) {
					const lines: string[] = [
						`模板「${meta.displayName}」（${meta.ref}）`,
						`类别：${meta.kind}　领域：${meta.domain}`,
					];
					if (meta.usage !== '') lines.push('', `用法：${meta.usage}`);
					if (meta.description !== '') lines.push('', `说明：${meta.description}`);
					lines.push('', `章节（${meta.sections.length} 个，content 的 key 用引号里的名字）：`);
					for (const section of meta.sections) {
						lines.push(`  「${section.label}」→ action=${section.action}（id=${section.id}）`);
						if (section.hint !== '') lines.push(`      ${section.hint.split('\n')[0]}`);
					}
					if (meta.derives.length > 0) {
						lines.push('', '可派生：');
						for (const one of meta.derives) lines.push(`  ${one.label} → ${one.template}`);
					}
					return textResult(lines.join('\n'));
				}
				if (kind === 'template') return errorResult(`模板「${id}」不存在。`);
			}

			/* ── 单个 action ── */
			const action = taskboard.actions().get(id);
			if (action === undefined) {
				return errorResult(`没有名为「${id}」的模板或 action。先不带 id 调一次看清单。`);
			}
			return textResult(
				[`action「${action.$type}」：${action.summary}`, `默认 payload：${previewOf(action.defaultPayload)}`].join(
					'\n',
				),
			);
		},
	});

	/* ── 12. 标记已读 ── */
	const markSeen = tool({
		name: 'taskboard_mark_seen',
		description:
			'把一张卡标记为「AI 已读过」。看过之后，这张卡上「用户改过、AI 待读」的标记会被清掉。你读完一张卡、处理完用户的改动后调一次。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: WORKSPACE_ID,
				id: CARD_ID,
			},
			required: ['id'],
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';
			/*
			 * ⚠ `reader` 写死 `'ai'` —— 这是 AI 工具路径。
			 *   界面侧的「用户已读」走 HTTP 路由（那里固定 `'user'`）。
			 *   ⚠ 关键：`reader: 'ai'` 清的是 **`unread.user`**（「用户改过、AI 待读」）。
			 */
			const result = await taskboard.markSeen(workspaceId, cardId, 'ai');
			if (!result.ok) return errorResult(`标记已读失败：\n${describeFailure(result)}`);
			return textResult(`已把 ${cardId} 标记为 AI 已读。当前未读状态：${describeUnread(result.unread)}。`);
		},
	});

	/* ── 13. 权限管理：读四档策略 ── */
	const toolPolicies = tool({
		name: 'taskboard_tool_policies',
		description:
			'读工具权限策略。权限分四档，生效集永远是「BASE ∪ 通用档 ∪ 命中的组 ∪ 独立档」。⚠ BASE 是常量、改不了（也不该改）—— 它已经有 11 个任务板工具。要放开执行类 / 读文件类工具，只能往「通用档 / 组 / 独立档」里加增量。改之前先读它。',
		inputSchema: { type: 'object', properties: {} },
		async handler(): Promise<TaskboardToolResult> {
			const store = taskboard.getToolPolicies();
			const lines: string[] = [
				'## BASE（固定，改不了）',
				'这 11 个工具任何时候都有，不需要领卡：',
				...BASE_TOOLS.map((name) => `  ${name}`),
				'',
				'⚠ **不要试图把 BASE 里的工具配进任何档** —— 它们已经在里面了，配了也没用。',
				'',
				'## 需要增量才放开的工具',
				'执行类（会改动工作区）：',
				...EXECUTION_TOOLS.map((name) => `  ${name}`),
				'',
				'只读 / 外部信息类（会绕过「不知道就问」—— 用户判据：无法获得不知道的信息）：',
				...READONLY_TOOLS.map((name) => `  ${name}`),
				'',
				`## 通用档（${store.common.length} 个，所有工作卡都生效）`,
				store.common.length === 0 ? '  （空）' : `  ${store.common.join('、')}`,
			];

			/* 组：成员 + 增量。 */
			const groupNames = [...new Set([...Object.keys(store.groups), ...Object.keys(store.groupMembers)])].sort();
			lines.push('', `## 组（${groupNames.length} 个，批量设置用；组之间没有优先级，命中就叠加）`);
			if (groupNames.length === 0) {
				lines.push('  （没有组）');
			} else {
				for (const name of groupNames) {
					const members = store.groupMembers[name] ?? [];
					const delta = store.groups[name] ?? [];
					lines.push(`  「${name}」`);
					lines.push(
						`    成员（${members.length}）：${members.length === 0 ? '（空 —— 谁都不会命中）' : members.join('、')}`,
					);
					lines.push(`    增量（${delta.length}）：${delta.length === 0 ? '（空）' : delta.join('、')}`);
				}
			}

			/* 独立档。 */
			const refs = Object.keys(store.templates).sort();
			lines.push('', `## 独立档（${refs.length} 个模板，只对那个模板生效）`);
			if (refs.length === 0) {
				lines.push('  （空）');
			} else {
				for (const ref of refs) {
					const delta = store.templates[ref] ?? [];
					lines.push(`  ${ref}：${delta.length === 0 ? '（空）' : delta.join('、')}`);
				}
			}

			lines.push(
				'',
				'生效规则：未持有工作卡 = 只有 BASE；持有工作卡 X = BASE ∪ 通用档 ∪ X 命中的组 ∪ X 的独立档。',
			);
			return textResult(lines.join('\n'));
		},
	});

	/* ── 14. 权限管理：改某一档的增量 ── */
	const toolPolicySet = tool({
		name: 'taskboard_tool_policy_set',
		description:
			'改某一档的工具增量（持久化）。只存增量 —— 生效永远是「BASE ∪ 各档」，不可能把 BASE 挤掉。granularity 三选一：common（通用，所有工作卡都吃）/ group（按组，要先有组和成员）/ template（独立，只管一个模板）。传空数组 = 清空那一档。',
		inputSchema: {
			type: 'object',
			properties: {
				granularity: {
					type: 'string',
					/*
					 * ⚠ `enum` 在这里安全：三档是我们的**结构**，不随数据变。
					 *   （对比 `taskboard_transition` 的 `to`：那个随状态表变，不能用 enum。）
					 */
					enum: ['common', 'group', 'template'],
					description: 'common = 通用档 / group = 组档 / template = 独立档。',
				},
				name: {
					type: 'string',
					description: 'granularity=group 时是组名；=template 时是模板 ref；=common 时忽略。',
				},
				delta: {
					type: 'array',
					items: { type: 'string' },
					description: '增量工具名（如 bash / write / read_file）。传空数组 = 清空那一档。',
				},
			},
			required: ['granularity', 'delta'],
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const granularity = str(args, 'granularity') ?? '';
			const name = str(args, 'name') ?? '';
			const delta = strs(args, 'delta') ?? [];

			if (granularity === 'common') {
				const result = await taskboard.setCommonPolicy(delta);
				if (!result.ok) return errorResult(`改权限失败：\n${describeFailure(result)}`);
				return textResult(
					delta.length === 0
						? '已清空通用档。'
						: `已把通用档设为：${delta.join('、')}（所有工作卡都多这些）。`,
				);
			}

			if (granularity === 'group') {
				if (name.trim() === '') {
					return errorResult('granularity=group 时必须给 name（组名）。');
				}
				const result = await taskboard.setGroupPolicy(name, delta);
				if (!result.ok) return errorResult(`改权限失败：\n${describeFailure(result)}`);
				return textResult(
					delta.length === 0
						? `已清空组「${name}」的增量（成员还在，但不再授予任何工具）。`
						: `已把组「${name}」的增量设为：${delta.join('、')}（该组成员的工作卡生效）。`,
				);
			}

			if (granularity === 'template') {
				if (name.trim() === '') {
					return errorResult('granularity=template 时必须给 name（模板 ref）。');
				}
				const result = await taskboard.setTemplatePolicy(name, delta);
				if (!result.ok) return errorResult(`改权限失败：\n${describeFailure(result)}`);
				return textResult(
					delta.length === 0
						? `已清空模板「${name}」的独立档。`
						: `已把模板「${name}」的独立档设为：${delta.join('、')}。`,
				);
			}

			return errorResult(`granularity 必须是 common / group / template 之一；收到「${granularity}」。`);
		},
	});

	/* ── 15. 权限管理：设组成员 ── */
	const toolPolicyMembers = tool({
		name: 'taskboard_tool_policy_members',
		description:
			'设一个组的成员（模板列表）。组 = 一个命名的模板集合，用来批量设权限。组名不存在会自动建。传空数组 = 清空成员（组和它的增量都还在，但谁都不命中）。',
		inputSchema: {
			type: 'object',
			properties: {
				groupName: { type: 'string', description: '组名（如「代码类」）。' },
				templates: {
					type: 'array',
					items: { type: 'string' },
					description: '组成员：模板 ref 列表。传空数组 = 清空成员。',
				},
			},
			required: ['groupName', 'templates'],
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const groupName = str(args, 'groupName') ?? '';
			const templates = strs(args, 'templates') ?? [];
			const result = await taskboard.setGroupMembers(groupName, templates);
			if (!result.ok) return errorResult(`设组成员失败：\n${describeFailure(result)}`);
			return textResult(
				templates.length === 0
					? `已清空组「${groupName}」的成员。`
					: `已把组「${groupName}」的成员设为：${templates.join('、')}。`,
			);
		},
	});

	/* ── 16. 权限管理：清空某一档 ── */
	const toolPolicyReset = tool({
		name: 'taskboard_tool_policy_reset',
		description:
			'清空某一档。granularity=common ⇒ 清空通用档；=group ⇒ **整个删掉那个组**（成员 + 增量）；=template ⇒ 清空该模板的独立档。语义比 taskboard_tool_policy_set 传空数组更明确。',
		inputSchema: {
			type: 'object',
			properties: {
				granularity: {
					type: 'string',
					enum: ['common', 'group', 'template'],
					description: 'common = 通用档 / group = 整组删除 / template = 独立档。',
				},
				name: {
					type: 'string',
					description: 'granularity=group 时是组名；=template 时是模板 ref；=common 时忽略。',
				},
			},
			required: ['granularity'],
		},
		async handler(args: unknown): Promise<TaskboardToolResult> {
			const granularity = str(args, 'granularity') ?? '';
			const name = str(args, 'name') ?? '';

			if (granularity === 'common') {
				const result = await taskboard.setCommonPolicy([]);
				if (!result.ok) return errorResult(`重置失败：\n${describeFailure(result)}`);
				return textResult('已清空通用档。');
			}

			if (granularity === 'group') {
				if (name.trim() === '') return errorResult('granularity=group 时必须给 name（组名）。');
				const result = await taskboard.removeGroup(name);
				if (!result.ok) return errorResult(`重置失败：\n${describeFailure(result)}`);
				return textResult(`已删除组「${name}」（成员 + 增量都删了）。`);
			}

			if (granularity === 'template') {
				if (name.trim() === '') return errorResult('granularity=template 时必须给 name（模板 ref）。');
				const result = await taskboard.setTemplatePolicy(name, []);
				if (!result.ok) return errorResult(`重置失败：\n${describeFailure(result)}`);
				return textResult(`已清空模板「${name}」的独立档。`);
			}

			return errorResult(`granularity 必须是 common / group / template 之一；收到「${granularity}」。`);
		},
	});

	return Object.freeze([
		workspaces,
		cards,
		card,
		create,
		updateContent,
		updateNote,
		transition,
		adopt,
		claim,
		release,
		registry,
		markSeen,
		toolPolicies,
		toolPolicySet,
		toolPolicyMembers,
		toolPolicyReset,
	]);
}

/**
 * 把用户/模型给的字符串解析成状态 id。
 *
 * 认两种写法：协议全名（`TASK_STATE_SUBMITTED`）与中文名（`提交`）。
 * ⚠ 不认「热闹但不精确」的写法 —— 认不出就是 `undefined`，由调用方报错。
 */
export function resolveStateId(raw: string): TaskState | undefined {
	if (isTaskState(raw)) return raw;
	const trimmed = raw.trim();
	if (isTaskState(trimmed)) return trimmed;
	return TASK_STATES.find((state) => STATE_LABELS[state] === trimmed);
}
