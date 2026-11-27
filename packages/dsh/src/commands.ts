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
 *
 * ## ⚠ 改内容的命令：错误原因来自 core，本层只负责原样输出
 *
 * 用户 `2026-11-23`：
 * > 「处于完结态的卡，action 内容不可再改变。在 core 里面设置。
 * >   并对 tool 和 dsh 指令这两处调用打错误原因」
 *
 * **今天没有任何命令会改卡内容**（`/taskboard`、`/task-card` 只读，
 * `/task-create` 只建新卡），所以本层没有「完结态」分支 —— 也不该有：
 * 那条规则在 core 的写方法里判（`update({content})` / `replaceContentAt`），
 * core 返回的 `Failure.message` 已经带**卡 id + 状态中文名**。
 *
 * ⇒ 将来加写命令时，**照 `/task-create` 的失败分支写**即可：
 *
 * ```ts
 * if (!changed.ok) return { kind: 'error', text: `改内容失败：${changed.message}` };
 * ```
 *
 * 不要在这一层再判一次「是不是完结态」—— 那样会造出第二份真值，
 * 两处不一致时不会报错，只会让某条入口悄悄放行。
 */

/*
 * TODO(审查) 汇总 —— 本包审查发现的问题（只记录，不改逻辑）
 *
 * TODO(审查): [测试] `test/commands.test.ts` 里 `it('注册了四个命令')` 被放进 `describe('/task-card')` 下，是分组笔误；测试本次禁止改，记录于此。
 * TODO(审查): [决定记录] `bodyOf` 的 `JSON.stringify` 兜底、以及命令输出压成一行，都是有意的现状（无更合适的现成库），不是待办。
 */

import type { Card, Taskboard } from '@taskboard/core';
import { labelOf } from '@taskboard/protocol';

/**
 * 命令注册器的窄形状。**唯一一份** ——
 * `src/types.ts` 的 `CommandsLike` 只是把它按「DSH 服务」的口径重命名导出。
 *
 * ⚠ 不要在这里之外再声明同形接口：靠方法参数双变编得过，但那是巧合不是约束。
 */
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
	/*
	 * 「解析默认空间」的三段 try/catch 收敛（TODO(审查) ① 同款判断）：
	 * 失败 = `undefined`，各命令自己的兜底语义留在原地 ——
	 * /taskboard 回落空串、另两处回 error（两处语义不一致是原状，统一属行为变化需另行裁定）。
	 */
	const resolveDefaultWorkspace = async (): Promise<string | undefined> => {
		try {
			return await deps.defaultWorkspaceId();
		} catch {
			return undefined;
		}
	};

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

			const resolvedCurrent = await resolveDefaultWorkspace();
			const current = resolvedCurrent ?? '';

			const cards = current === '' ? [] : deps.taskboard.list(current);
			const byStatus = new Map<string, number>();
			for (const card of cards) {
				byStatus.set(card.status, (byStatus.get(card.status) ?? 0) + 1);
			}

			const lines: string[] = [`工作空间（${workspaces.length} 个）：`];
			// TODO(审查): [①] 每个空间各调一次 `list(ws.id)` 只为取数量（N+1）；上面已经整表拿过一次 cards，同理可复用。
			//   低频命令，可留；真要省就在循环里复用已取的数据。
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

			const workspaceId = await resolveDefaultWorkspace();
			if (workspaceId === undefined) {
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

			const workspaceId = await resolveDefaultWorkspace();
			if (workspaceId === undefined) {
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

	/* ── 4. 总闸 ── */
	registry.register({
		name: 'task-ai-switch',
		description:
			'开关：角色为 ai 的改卡状态操作允不允许。/task-ai-switch 看当前值，/task-ai-switch on|off 改它',
		input: { hint: '[on|off]' },
		recordInput: false,
		async handler(invocation: unknown): Promise<CommandResult> {
			const arg = inputOf(invocation).trim().toLowerCase();

			/*
			 * 用户 `2026-11-23`：
			 * > 「core提供的后端里面有一个开关设置和权限。**用指令和UI可以改这个开关**。
			 * >   然后会限制改卡状态的角色为ai的部分的操作。」
			 *
			 * ⇒ 命令是「改这个开关」的两条入口之一（另一条是 `POST /api/permission`，
			 *   界面用）。两条都只写 core 的那一个 kv 键，不各存一份。
			 */
			if (arg === '') {
				const on = deps.taskboard.getAiStateChangeAllowed();
				return {
					kind: 'success',
					text: `AI 改卡状态：${on ? '允许' : '不允许'}\n（/task-ai-switch on 打开；/task-ai-switch off 关闭）\n注意：关掉后只拦角色为 ai 的操作；人点按钮和系统自动重算不受影响。`,
				};
			}

			if (arg !== 'on' && arg !== 'off') {
				return { kind: 'error', text: `用法：/task-ai-switch [on|off]（收到「${arg}」）` };
			}

			const on = arg === 'on';
			await deps.taskboard.setAiStateChangeAllowed(on);
			return {
				kind: 'success',
				text: on ? '已允许 AI 改卡状态。' : '已禁止 AI 改卡状态（人点按钮、系统自动重算仍照常）。',
			};
		},
	});
}
