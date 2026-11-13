/**
 * AI 工具 —— 把 core 的能力包成模型可调用的工具。
 *
 * ## schema 必须静态
 *
 * 用户裁定：工具 schema 在 prompt 前缀里，**一动就击穿 KV cache**。
 * ⇒ 参数表逐字节固定，**不按模板 / 空间 / actor 动态生成**。
 *
 * 所以 `content` 是开放对象：
 *
 * ```ts
 * { type: 'object', additionalProperties: true, description: '…' }
 * ```
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
 * 3. 把 `Failure` 翻译成模型能据此改对的话（下一轮一次改对，而不是反复试错）
 *
 * ## ⚠ 本模块不 import `@deepseek-ai/dsh-tools`
 *
 * 那个包随 DSH 安装分发，作为 peerDependency 在运行时可用；
 * 但它在 npm 上没有同版本，编译期装不到。
 *
 * ⇒ 本模块只声明 `ToolLike` / `DefineTool` 两个**窄形状**，
 *   `defineTool` 由调用方（`index.ts`，那里 import 它）注入。
 *   好处：本模块可以**纯本地测试**，不需要 DSH 运行时。
 */

import type { Taskboard } from '@taskboard/core';
import type { Failure, TaskState } from '@taskboard/protocol';
import { ERROR_HINTS, labelOf } from '@taskboard/protocol';

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
}

/*
 * ⚠ 输出 schema：**所有工具共用同一个**。
 *
 * 只回一段文字给模型 —— 模型读得懂、不需要结构化 JSON。
 * 若每个工具各写一份 output schema，那是把同一件事抄三遍。
 */
const OUTPUT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		text: { type: 'string', required: true },
	},
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
function cardLine(card: {
	readonly id: string;
	readonly title: string;
	readonly status: TaskState;
	readonly template: { readonly ref: string; readonly kind: string; readonly domain: string };
}): string {
	return `${card.id}  [${labelOf(card.status)}]  ${card.title}  （${card.template.ref} / ${card.template.kind} / ${card.template.domain}）`;
}

/**
 * 建三个工具。
 *
 * @returns 工具定义数组（调用方逐个 `ctx.tools.register`）
 */
export function createTools(deps: ToolDeps): readonly ToolLike[] {
	const { taskboard, defineTool } = deps;

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
		output: {
			schema: OUTPUT_SCHEMA,
			render: (_args: unknown, value: unknown) => [
				{ type: 'text', text: (value as { text: string }).text },
			],
		},
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
			'列任务卡，可按标题、状态、类别、领域筛选。不填条件时列出当前空间的全部有效卡（不含草稿）。',
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
		},
		output: {
			schema: OUTPUT_SCHEMA,
			render: (_args: unknown, value: unknown) => [
				{ type: 'text', text: (value as { text: string }).text },
			],
		},
		async execute(rawArgs: unknown): Promise<unknown> {
			const args = rawArgs as {
				workspaceId?: string;
				title?: string;
				status?: readonly string[];
				kind?: readonly string[];
				domain?: readonly string[];
			};
			const workspaceId = args.workspaceId ?? (await deps.defaultWorkspaceId());
			const list = taskboard.search(workspaceId, {
				...(args.title === undefined ? {} : { title: args.title }),
				...(args.status === undefined ? {} : { status: args.status }),
				...(args.kind === undefined ? {} : { kind: args.kind }),
				...(args.domain === undefined ? {} : { domain: args.domain }),
			});
			if (list.length === 0) return { text: '没有符合条件的卡。' };
			const lines = list.map(cardLine);
			return { text: `空间「${workspaceId}」共 ${list.length} 张卡：\n${lines.join('\n')}` };
		},
	});

	/* ── 3. 建卡 ── */
	const create = defineTool({
		name: 'taskboard_create',
		description:
			'建一张新任务卡。title 必填；templateRef 是模板 ref（省略 = 用第一个可用模板）。content 是对象：key = 模板章节名，value = 该章节的 action payload。省略的章节用模板默认值。先调 taskboard_templates 看这个模板有哪些章节。',
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
		output: {
			schema: OUTPUT_SCHEMA,
			render: (_args: unknown, value: unknown) => [
				{ type: 'text', text: (value as { text: string }).text },
			],
		},
		async execute(rawArgs: unknown): Promise<unknown> {
			const args = rawArgs as {
				workspaceId?: string;
				title: string;
				templateRef?: string;
				content?: unknown;
			};
			const workspaceId = args.workspaceId ?? (await deps.defaultWorkspaceId());

			let templateRef = args.templateRef ?? '';
			if (templateRef === '') {
				const first = taskboard.listTemplates()[0];
				if (first === undefined) {
					return {
						text: '当前没有任何可用模板，无法建卡。检查模板加载错误（GET /taskboard3/api/templates）。',
					};
				}
				templateRef = first.ref;
			}

			const created = await taskboard.create({
				workspaceId,
				templateRef,
				title: args.title,
				...(args.content === undefined ? {} : { content: args.content }),
			});
			if (!created.ok) return { text: `建卡失败：\n${describeFailure(created)}` };

			const card = created.card;
			const sections = Object.entries(card.sections)
				.map(([, section]) => `  · ${section.label}`)
				.join('\n');
			return {
				text: [
					`已建卡 ${card.id}「${card.title}」（模板 ${card.template.ref}，状态 ${labelOf(card.status)}）。`,
					sections === '' ? '(无章节)' : `章节：\n${sections}`,
					'下一步：让用户确认后再采纳（采纳会把草稿转为提交或需要授权）。',
				].join('\n'),
			};
		},
	});

	return [workspaces, cards, create];
}
