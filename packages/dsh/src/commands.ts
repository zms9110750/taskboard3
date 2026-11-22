/**
 * 斜杠命令。
 *
 * ## 适配，不做事
 *
 * 命令只读 core 的数据、拼一段文字。业务判断一律不在这一层。
 * 与 AI 工具的分工：命令是**人**敲的，工具是**模型**调的，底层是同一批 core 方法。
 *
 * ## 默认空间是**入口策略**
 *
 * 用户裁定：「整个激活都只对 dsh 会话有效。mcp 是没法提供的。」
 * ⇒ 命令从注入的 `defaultWorkspaceId` 拿默认空间，core 不知道这件事。
 */

import type { Card, Taskboard } from '@taskboard/core';
import { labelOf } from '@taskboard/protocol';

/** 命令注册器的窄形状。 */
export interface CommandRegistryLike {
	register(command: {
		name: string;
		description: string;
		input?: { readonly hint: string };
		recordInput?: boolean;
		handler(invocation: unknown): unknown;
	}): unknown;
}

/** 命令依赖。 */
export interface CommandDeps {
	readonly taskboard: Taskboard;
	readonly defaultWorkspaceId: () => Promise<string>;
}

/** DSH 命令的返回值形状。 */
interface CommandResult {
	readonly kind: 'success' | 'error';
	readonly text: string;
}

/** 从 invocation 里取用户输入（命令参数）。 */
function inputOf(invocation: unknown): string {
	if (typeof invocation !== 'object' || invocation === null) return '';
	const raw = (invocation as { rawInput?: unknown }).rawInput;
	return typeof raw === 'string' ? raw.trim() : '';
}

/** 把 payload 压成一行正文（命令输出要短）。 */
function bodyOf(payload: unknown): string {
	if (typeof payload === 'object' && payload !== null && 'value' in payload) {
		const value = (payload as { value?: unknown }).value;
		if (typeof value === 'string') return value;
	}
	if (typeof payload === 'string') return payload;
	try {
		return JSON.stringify(payload) ?? '';
	} catch {
		return '';
	}
}

/**
 * 注册三个命令。
 *
 * - `/taskboard` —— 概览：空间 + 当前空间的卡数分布
 * - `/task-card <编号>` —— 看一张卡
 * - `/task-create <标题>` —— 建一张草稿卡
 */
export function registerCommands(registry: CommandRegistryLike, deps: CommandDeps): void {
	/* ── 1. 概览 ── */
	registry.register({
		name: 'taskboard',
		description: '任务板概览：所有工作空间、当前空间的卡数、按状态分布',
		recordInput: false,
		async handler(): Promise<CommandResult> {
			const workspaces = deps.taskboard.listWorkspaces(true);
			if (workspaces.length === 0) {
				return { kind: 'success', text: '任务板还没有任何工作空间。' };
			}

			let current: string;
			try {
				current = await deps.defaultWorkspaceId();
			} catch {
				current = '';
			}

			const cards = current === '' ? [] : deps.taskboard.list(current);
			const byStatus = new Map<string, number>();
			for (const card of cards) {
				byStatus.set(card.status, (byStatus.get(card.status) ?? 0) + 1);
			}

			const lines: string[] = [`工作空间（${workspaces.length} 个）：`];
			for (const ws of workspaces) {
				const mark = ws.id === current ? '★' : ' ';
				const archived = ws.archived ? '（已归档）' : '';
				lines.push(` ${mark} ${ws.id}  ${ws.displayName}${archived}  ${deps.taskboard.list(ws.id).length} 张卡`);
			}

			lines.push('');
			lines.push(current === '' ? '当前空间：未确定' : `当前空间：${current}，共 ${cards.length} 张卡`);
			if (byStatus.size > 0) {
				for (const [status, count] of byStatus) {
					lines.push(`  · ${labelOf(status)}: ${count}`);
				}
			}

			return { kind: 'success', text: lines.join('\n') };
		},
	});

	/* ── 2. 看一张卡 ── */
	registry.register({
		name: 'task-card',
		description: '看一张任务卡：/task-card <编号>',
		input: { hint: '<编号>' },
		recordInput: false,
		async handler(invocation: unknown): Promise<CommandResult> {
			const cardId = inputOf(invocation);
			if (cardId === '') {
				return { kind: 'error', text: '用法：/task-card <编号>，例如 /task-card GU01' };
			}

			let workspaceId: string;
			try {
				workspaceId = await deps.defaultWorkspaceId();
			} catch {
				return { kind: 'error', text: '没有可用的工作空间。' };
			}

			const found = deps.taskboard.get(workspaceId, cardId);
			if (!found.ok) return { kind: 'error', text: found.message };

			const one = found.card;
			const lines: string[] = [
				`${one.id}  ${labelOf(one.status)}  ${one.title}`,
				`模板：${one.template.ref}（${one.template.kind} / ${one.template.domain}）`,
			];
			if (one.deleted) lines.push('⚠ 已被删除（墓碑）。');
			if (one.note !== '') lines.push(`备注：${one.note}`);
			if (one.relations.parent !== null) lines.push(`父卡：${one.relations.parent}`);
			if (one.relations.links.length > 0) {
				lines.push(`关系：${one.relations.links.map((link) => `${link.label}→${link.to}`).join('、')}`);
			}

			const sections = Object.entries(one.sections);
			if (sections.length > 0) {
				lines.push('');
				for (const [, section] of sections) {
					const body = bodyOf(section.payload).replace(/\s+/g, ' ').trim();
					lines.push(`【${section.label}】${body.length > 80 ? `${body.slice(0, 80)}…` : body}`);
				}
			}

			return { kind: 'success', text: lines.join('\n') };
		},
	});

	/* ── 3. 建卡 ── */
	registry.register({
		name: 'task-create',
		description: '建一张任务卡（草稿）：/task-create <标题>',
		input: { hint: '<标题>' },
		recordInput: false,
		async handler(invocation: unknown): Promise<CommandResult> {
			const title = inputOf(invocation);
			if (title === '') {
				return { kind: 'error', text: '用法：/task-create <标题>' };
			}

			let workspaceId: string;
			try {
				workspaceId = await deps.defaultWorkspaceId();
			} catch {
				return { kind: 'error', text: '没有可用的工作空间。' };
			}

			const template = deps.taskboard.listTemplates()[0];
			if (template === undefined) {
				return { kind: 'error', text: '当前没有可用模板，无法建卡。检查模板加载错误。' };
			}

			const created = await deps.taskboard.create({
				workspaceId,
				templateRef: template.ref,
				title,
				/*
				 * 斜杠命令是**人**敲的 ⇒ `'user'`。
				 *
				 * 判据在本文件头（第 7 行）：
				 * > 「与 AI 工具的分工：命令是**人**敲的，工具是**模型**调的，
				 * >   底层是同一批 core 方法。」
				 *
				 * ⇒ 这条命令的触发者只有人。AI 工具走的是 `packages/tools/src/tools/create.ts`，
				 *   那条显式传 `'ai'`，两条入口各自表态，谁也不靠默认值。
				 *
				 * ⚠ `actor` 现在是 **必填**（用户 `2026-11-22`）—— 漏传编译就红。
				 */
				actor: 'user',
			});
			if (!created.ok) return { kind: 'error', text: `建卡失败：${created.message}` };

			const card: Card = created.card;
			return { kind: 'success', text: `已建卡 ${card.id}  ${card.title}（草稿，模板 ${card.template.ref}）` };
		},
	});
}
