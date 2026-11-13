/**
 * AI 工具 —— 把 core 的能力包成模型可调用的工具。
 *
 * ## schema 必须静态
 *
 * 用户裁定：工具 schema 在 prompt 前缀里，**一动就击穿 KV cache**。
 * ⇒ 参数表逐字节固定，**不按模板 / 空间 / actor / 状态动态生成**。
 *
 * 两个直接的后果：
 *
 * · `content` 是**开放对象**（`additionalProperties: true`），不按模板展开；
 * · `taskboard_transition` 的 `to` 是 **`string`**，不用 `enum`
 *   —— 状态表若扩了，`enum` 会让 schema 变、缓存全废。合法性在 `execute` 里判。
 *
 * ## 校验在 core，不在工具
 *
 * 用户裁定：「就在 core 里面验证就好了。因为用户从 ui 里面创建卡，也是走数据给 core 的。」
 * ⇒ 工具**不重复实现校验**，只把 core 返回的 `Failure.issues` 翻译成人话。
 *
 * ## 工具只做三件事
 *
 * 1. 把模型参数映射成 core 入参
 * 2. 调 core
 * 3. 把结果 / `Failure` 翻译成模型能据此改对的话
 *
 * ## ⚠ 本模块不 import `@deepseek-ai/dsh-tools`
 *
 * 那个包随 DSH 安装分发，作为 peerDependency 在运行时可用；
 * 但它在 npm 上没有同版本，编译期装不到（见 `src/dsh-tools.d.ts`）。
 *
 * ⇒ 本模块只声明 `ToolLike` / `DefineTool` 两个**窄形状**，
 *   `defineTool` 由调用方注入。好处：本模块可以**纯本地测试**，不需要 DSH 运行时。
 */

import type { Card, Taskboard } from '@taskboard/core';
import type { Failure, TaskState } from '@taskboard/protocol';
import {
	ERROR_HINTS,
	STATE_LABELS,
	TASK_STATES,
	buttonsOf,
	buttonTargetsOf,
	groupOf as groupOfState,
	isTaskState,
	judgeTransition,
	labelOf,
} from '@taskboard/protocol';

import { holderOf } from './holder.ts';

/** 一个已定义工具的最小形状（对齐 DSH `ToolDefinition` 的字段子集）。 */
export interface ToolLike {
	readonly name: string;
	readonly description: string;
	readonly parameters: Record<string, unknown>;
	readonly output: {
		readonly schema: Record<string, unknown>;
		readonly render: (args: unknown, value: unknown) => readonly unknown[];
	};
	execute(args: unknown, exec: unknown): Promise<unknown>;
}

/** `defineTool` 的窄形状；由 `index.ts` 注入真实实现。 */
export type DefineTool = (options: {
	readonly name: string;
	readonly description: string;
	readonly parameters: Record<string, unknown>;
	readonly output: {
		readonly schema: Record<string, unknown>;
		readonly render: (args: unknown, value: unknown) => readonly unknown[];
	};
	execute(args: never, exec: never): Promise<unknown>;
}) => ToolLike;

/** 工具依赖。 */
export interface ToolDeps {
	readonly taskboard: Taskboard;
	readonly defineTool: DefineTool;
	/** 解析默认空间（入口策略，不是 core 概念）。 */
	readonly defaultWorkspaceId: () => Promise<string>;
	/**
	 * `ctx.subagents` —— 用来取当前 agent 的**名字**（holder）。
	 *
	 * ⚠ 可以是 `undefined`：没有 subagent 环境的 profile 也该能用任务板。
	 *   那时 holder 回落 `agent.id`（UUID）。见 `src/holder.ts`。
	 */
	readonly subagents?: unknown;
}

/*
 * ⚠ 输出 schema：**所有工具共用同一个**。
 *
 * 只回一段文字给模型 —— 模型读得懂、不需要结构化 JSON。
 * 若每个工具各写一份 output schema，那是把同一件事抄九遍。
 */
const OUTPUT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		text: { type: 'string', required: true },
	},
} as const;

/** 所有工具共用的 output 块。 */
const OUTPUT = {
	schema: OUTPUT_SCHEMA,
	render: (_args: unknown, value: unknown) => [{ type: 'text', text: (value as { text: string }).text }],
} as const;

/** 把 `Failure` 翻译成模型能据此改对的话。 */
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

/** 人类可读的卡行。 */
function cardLine(card: Card): string {
	return `${card.id}  [${labelOf(card.status)}]  ${card.title}  （${card.template.ref} / ${card.template.kind} / ${card.template.domain}）`;
}

/** 状态的中文名 + id（`提交（TASK_STATE_SUBMITTED）`）。 */
function stateText(state: string): string {
	return `${labelOf(state)}（${state}）`;
}

/** 把 payload 压成一行预览（避免把整个 payload 抖给模型）。 */
function previewOf(value: unknown, limit = 120): string {
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	if (text === undefined) return '(无)';
	const flat = text.replace(/\s+/g, ' ');
	return flat.length <= limit ? flat : `${flat.slice(0, limit)}…`;
}

/** 从 `payload` 里取可读正文（`value` 字段或整体）。 */
function bodyOf(payload: unknown): string {
	if (typeof payload === 'object' && payload !== null && 'value' in payload) {
		const value = (payload as { value?: unknown }).value;
		if (typeof value === 'string') return value;
	}
	return previewOf(payload);
}

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

/** 读参数里的布尔值（严格：只认 `true`，其它一律 `undefined`）。 */
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

/**
 * 建十一个工具。
 *
 * @returns 工具定义数组（调用方逐个 `ctx.tools.register`）
 */
export function createTools(deps: ToolDeps): readonly ToolLike[] {
	const { taskboard, defineTool } = deps;

	/** 解析目标空间：参数优先，否则入口默认。 */
	const resolveWorkspace = async (args: unknown): Promise<string> =>
		str(args, 'workspaceId') ?? (await deps.defaultWorkspaceId());

	/** 取一张卡（带失败翻译）。 */
	const mustGetCard = (
		workspaceId: string,
		cardId: string,
	): { readonly ok: true; readonly card: Card } | { readonly ok: false; readonly text: string } => {
		const found = taskboard.get(workspaceId, cardId);
		if (!found.ok) return { ok: false, text: describeFailure(found) };
		return found;
	};

	/* ── 1. 空间清单 ── */
	const workspaces = defineTool({
		name: 'taskboard_workspaces',
		description: '列任务板的工作空间（容器）。每个空间有自己的卡。',
		parameters: {
			includeArchived: {
				type: 'boolean',
				description: '是否包含已归档的空间。省略 = 不包含。',
			},
		},
		output: OUTPUT,
		async execute(args: unknown): Promise<unknown> {
			const { includeArchived } = args as { includeArchived?: boolean };
			const list = taskboard.listWorkspaces(includeArchived === true);
			if (list.length === 0) {
				return {
					text: '还没有任何工作空间。可以先建一个（POST /taskboard3/api/workspaces，或界面上点「新建」）。',
				};
			}
			const lines = list.map(
				(ws) =>
					`${ws.id}  ${ws.displayName}${ws.archived ? '（已归档）' : ''}  ${taskboard.list(ws.id).length} 张卡`,
			);
			return { text: `工作空间（${list.length} 个）：\n${lines.join('\n')}` };
		},
	});

	/* ── 2. 卡列表 / 搜索 ── */
	const cards = defineTool({
		name: 'taskboard_cards',
		description:
			'列任务卡，可按标题、状态、类别、领域、模板、以及「谁改过而对方未读」筛选。不填条件时列出当前空间的全部有效卡（不含草稿）。',
		parameters: {
			workspaceId: { type: 'string', description: '空间 id。省略 = 入口的默认空间。' },
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
			 * （谁还没看）—— 两个词的视角正好相反，这是文件名最容易错的地方。
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
		output: OUTPUT,
		async execute(args: unknown): Promise<unknown> {
			const workspaceId = await resolveWorkspace(args);
			const title = str(args, 'title');
			const status = strs(args, 'status');
			const kind = strs(args, 'kind');
			const domain = strs(args, 'domain');
			const templateRef = strs(args, 'templateRef');

			/*
			 * 「谁改过、对方未读」这个**事件维度** search 自己算不出来
			 * （它要历史事件 + 已读游标）⇒ 这里先问 core 要结果集，再交给 search 做集合判定。
			 *
			 * ⚠ 两个 boolean 的映射见上面参数注释 —— **名和方向是反的**，别照字面理解。
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
			if (list.length === 0) return { text: '没有符合条件的卡。' };
			return {
				text: `空间「${workspaceId}」共 ${list.length} 张卡：\n${list.map(cardLine).join('\n')}`,
			};
		},
	});

	/* ── 3. 看单卡详情 ── */
	const card = defineTool({
		name: 'taskboard_card',
		description:
			'看一张任务卡的详情：元数据（状态、模板、关系、备注、历史）+ 各章节内容。按编号直查，能看到草稿和已删除的卡。',
		parameters: {
			workspaceId: { type: 'string', description: '空间 id。省略 = 入口的默认空间。' },
			id: { type: 'string', required: true, description: '卡编号，如 GU01。' },
		},
		output: OUTPUT,
		async execute(args: unknown): Promise<unknown> {
			const workspaceId = await resolveWorkspace(args);
			const found = mustGetCard(workspaceId, str(args, 'id') ?? '');
			if (!found.ok) return { text: found.text };

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

			return { text: lines.join('\n') };
		},
	});

	/* ── 4. 建卡 ── */
	const create = defineTool({
		name: 'taskboard_create',
		description:
			'建一张新任务卡。title 必填；templateRef 是模板 ref（省略 = 第一个可用模板）。content 是对象：key = 模板章节名，value = 该章节的 action payload。省略的章节用模板默认值。先调 taskboard_registry 看这个模板有哪些章节。',
		parameters: {
			workspaceId: { type: 'string', description: '空间 id。省略 = 入口的默认空间。' },
			title: { type: 'string', required: true, description: '卡标题。' },
			templateRef: { type: 'string', description: '模板 ref。省略 = 第一个可用模板。' },
			content: {
				type: 'object',
				additionalProperties: true,
				description: 'key = 模板章节名（label），value = action payload 对象。可省略整个章节。',
			},
		},
		output: OUTPUT,
		async execute(args: unknown): Promise<unknown> {
			const workspaceId = await resolveWorkspace(args);
			const title = str(args, 'title') ?? '';

			let templateRef = str(args, 'templateRef') ?? '';
			if (templateRef === '') {
				const first = taskboard.listTemplates()[0];
				if (first === undefined) {
					return {
						text: '当前没有任何可用模板，无法建卡。检查模板加载错误（GET /taskboard3/api/templates）。',
					};
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
			if (!created.ok) return { text: `建卡失败：\n${describeFailure(created)}` };

			const made = created.card;
			const sectionLines = Object.entries(made.sections)
				.map(([, section]) => `  · ${section.label}`)
				.join('\n');
			return {
				text: [
					`已建卡 ${made.id}「${made.title}」（模板 ${made.template.ref}，状态 ${labelOf(made.status)}）。`,
					sectionLines === '' ? '(无章节)' : `章节：\n${sectionLines}`,
					'下一步：让用户确认后再采纳（采纳会把草稿转为提交或需要授权）。',
				].join('\n'),
			};
		},
	});

	/* ── 5. 改章节内容 ── */
	const updateContent = defineTool({
		name: 'taskboard_update_content',
		description:
			'改一张卡里章节的内容。content 是对象：key = 章节名（模板里的 label）或 sectionId，value = action payload。只传要改的章节；没传的保持原样。',
		parameters: {
			workspaceId: { type: 'string', description: '空间 id。省略 = 入口的默认空间。' },
			id: { type: 'string', required: true, description: '卡编号。' },
			content: {
				type: 'object',
				additionalProperties: true,
				description: 'key = 章节名或 sectionId，value = action payload。',
			},
		},
		output: OUTPUT,
		async execute(args: unknown): Promise<unknown> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';

			/*
			 * ⚠ `core.update()` 的 `content` 是**整体替换**（`if (patch.content !== undefined)` 重建 sections），
			 *   不是增量合并。而本工具的语义是「只改这几章」。
			 *   ⇒ 先把现有章节读出来、与传入的合并，再整体提交。
			 *
			 *   这一步必须由工具做，不能指望 core —— core 的 update 语义是「给定完整 content」。
			 */
			const found = mustGetCard(workspaceId, cardId);
			if (!found.ok) return { text: found.text };

			const incoming = rawOf(args, 'content');
			if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) {
				return { text: 'content 必须是对象：key = 章节名，value = action payload。' };
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
			if (!updated.ok) return { text: `改内容失败：\n${describeFailure(updated)}` };

			const changed = Object.keys(incoming as Record<string, unknown>);
			return {
				text: `已改 ${updated.card.id}「${updated.card.title}」的 ${changed.length} 个章节：${changed.join('、')}`,
			};
		},
	});

	/* ── 6. 改备注 ── */
	const updateNote = defineTool({
		name: 'taskboard_update_note',
		description: '改一张卡的备注（追加型文本，不随采纳清空）。传空串 = 清空备注。',
		parameters: {
			workspaceId: { type: 'string', description: '空间 id。省略 = 入口的默认空间。' },
			id: { type: 'string', required: true, description: '卡编号。' },
			note: { type: 'string', required: true, description: '新备注内容。空串 = 清空。' },
		},
		output: OUTPUT,
		async execute(args: unknown): Promise<unknown> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';
			const note = str(args, 'note') ?? '';

			const updated = await taskboard.update(workspaceId, cardId, { note }, 'ai');
			if (!updated.ok) return { text: `改备注失败：\n${describeFailure(updated)}` };
			return {
				text: note === ''
					? `已清空 ${updated.card.id} 的备注。`
					: `已更新 ${updated.card.id} 的备注（${note.length} 字）。`,
			};
		},
	});

	/* ── 7. 状态转移 / 查询可转移目标 ── */
	const transition = defineTool({
		name: 'taskboard_transition',
		description:
			'改一张卡的状态。to 为空 ⇒ 只回答：当前状态含义、现在能转去哪（附按钮文案）、哪些目标被拒及原因，不执行。to 有值 ⇒ 执行转移。状态 id 用协议全名（如 TASK_STATE_SUBMITTED），中文名也能认。',
		parameters: {
			workspaceId: { type: 'string', description: '空间 id。省略 = 入口的默认空间。' },
			id: { type: 'string', required: true, description: '卡编号。' },
			/*
			 * ⚠ **不用 `enum`** —— 状态表扩了会让 schema 变，击穿 prompt 缓存。
			 *   合法性在 execute 里判（`resolveStateId`）。
			 */
			to: { type: 'string', description: '目标状态 id。省略 = 只查询不执行。' },
		},
		output: OUTPUT,
		async execute(args: unknown): Promise<unknown> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';

			const found = mustGetCard(workspaceId, cardId);
			if (!found.ok) return { text: found.text };
			const one = found.card;
			const kind = one.template.kind;

			const toRaw = str(args, 'to');
			const to = toRaw === undefined || toRaw === '' ? undefined : resolveStateId(toRaw);
			if (toRaw !== undefined && toRaw !== '' && to === undefined) {
				return {
					text: `「${toRaw}」不是已知状态。可用：${TASK_STATES.map((one2) => `${labelOf(one2)}=${one2}`).join('、')}`,
				};
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
						lines.push(`  · ${stateText(target)} —— 按钮「${button?.label ?? ''}」${suffix}`);
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
				return { text: lines.join('\n') };
			}

			/* ── 执行转移：AI 触发 ── */
			const applied = await taskboard.transition(workspaceId, cardId, to, 'ai');
			if (!applied.ok) return { text: `转移失败：\n${describeFailure(applied)}` };
			return {
				text: `已把 ${applied.card.id} 从「${labelOf(one.status)}」改为「${labelOf(applied.card.status)}」。`,
			};
		},
	});

	/* ── 8. 领取 ── */
	const claim = defineTool({
		name: 'taskboard_claim',
		description:
			'领取一张工作卡（提交 → 处理中）。持有者 = 你（当前 agent 的名字）。要满足核心的准入条件（依赖已结束、手上没有别的处理中工作卡等）；不满足时返回原因。',
		parameters: {
			workspaceId: { type: 'string', description: '空间 id。省略 = 入口的默认空间。' },
			id: { type: 'string', required: true, description: '卡编号。' },
		},
		output: OUTPUT,
		async execute(args: unknown, exec: unknown): Promise<unknown> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';
			const holder = holderOf(deps.subagents, exec);

			const claimed = await taskboard.claim(workspaceId, cardId, 'ai', holder);
			if (!claimed.ok) return { text: `领取失败：\n${describeFailure(claimed)}` };
			return {
				text: `已领取 ${claimed.card.id}「${claimed.card.title}」，状态 ${labelOf(claimed.card.status)}，持有者 ${holder}。`,
			};
		},
	});

	/* ── 9. 释放 ── */
	const release = defineTool({
		name: 'taskboard_release',
		description:
			'释放对一张处理中工作卡的领取（把自己从持有者里移除）。不算取消，改天还能再领。释放后若还有别人持有，状态不变。',
		parameters: {
			workspaceId: { type: 'string', description: '空间 id。省略 = 入口的默认空间。' },
			id: { type: 'string', required: true, description: '卡编号。' },
		},
		output: OUTPUT,
		async execute(args: unknown, exec: unknown): Promise<unknown> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';
			const holder = holderOf(deps.subagents, exec);

			const released = await taskboard.release(workspaceId, cardId, 'ai', holder);
			if (!released.ok) return { text: `释放失败：\n${describeFailure(released)}` };
			return {
				text: `已释放 ${released.card.id}「${released.card.title}」，状态 ${labelOf(released.card.status)}。`,
			};
		},
	});

	/* ── 10. 注册表 ── */
	const registry = defineTool({
		name: 'taskboard_registry',
		description:
			'看注册表。id 为空 ⇒ 列出所有模板与 action 的清单。给 id ⇒ 返回该模板 / action 的注册内容（模板含章节名与每章可用的 action）。kind 用来区分同名（template / action）。',
		parameters: {
			id: { type: 'string', description: '模板 ref 或 action 的 $type。省略 = 列清单。' },
			kind: { type: 'string', description: '`template` 或 `action`。id 有值且同名时用来区分。' },
		},
		output: OUTPUT,
		async execute(args: unknown): Promise<unknown> {
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
				return { text: lines.join('\n') };
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
					return { text: lines.join('\n') };
				}
				if (kind === 'template') return { text: `模板「${id}」不存在。` };
			}

			/* ── 单个 action ── */
			const action = taskboard.actions().get(id);
			if (action === undefined) {
				return { text: `没有名为「${id}」的模板或 action。先不带 id 调一次看清单。` };
			}
			return {
				text: [
					`action「${action.$type}」：${action.summary}`,
					`默认 payload：${previewOf(action.defaultPayload)}`,
				].join('\n'),
			};
		},
	});

	/* ── 11. 标记已读 ── */
	const markSeen = defineTool({
		name: 'taskboard_mark_seen',
		description:
			'把一张卡标记为「AI 已看过」。看过之后，用户那些早于这一刻的改动就不再算「AI 未读」（updates.user 里不再出现它）。你读完一张卡、处理完它的改动后调一次。',
		parameters: {
			workspaceId: { type: 'string', description: '空间 id。省略 = 入口的默认空间。' },
			id: { type: 'string', required: true, description: '卡编号。' },
		},
		output: OUTPUT,
		async execute(args: unknown): Promise<unknown> {
			const workspaceId = await resolveWorkspace(args);
			const cardId = str(args, 'id') ?? '';
			/*
			 * ⚠ `reader` 写死 `'ai'` —— 这是 AI 工具路径。
			 *   界面侧的「用户已读」走 `POST /api/cards/:id/seen`（那里固定 `'user'`）。
			 */
			const result = await taskboard.markSeen(workspaceId, cardId, 'ai');
			if (!result.ok) return { text: `标记已读失败：\n${describeFailure(result)}` };
			const at = new Date(result.at).toISOString();
			return { text: `已把 ${cardId} 标记为 AI 已读（游标时间 ${at}）。` };
		},
	});

	return [
		workspaces,
		cards,
		card,
		create,
		updateContent,
		updateNote,
		transition,
		claim,
		release,
		registry,
		markSeen,
	];
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
