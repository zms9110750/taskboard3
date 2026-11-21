/**
 * tool contract v2 的 core 测试夹具 —— **只给测试用**。
 *
 * 用内存 store（不开 SQLite）让用例跑得飞快；模板用程序注册，
 * 这样才能造出「空模板」（`kind` / `domain` 为空）这种内置 YAML 里没有的形态。
 */

import { createTaskboard, type Taskboard } from '../src/index.ts';
import type { SectionDef, TemplateDef } from '../src/template/types.ts';
import { createMemoryStore } from './memory-store.ts';

/** 一个 text 章节。 */
export function textSection(
	id = 'body',
	label = '正文',
	action = 'text',
	defaultPayload: unknown = { $type: 'text' },
): SectionDef {
	return { id, label, hint: '', action, defaultPayload };
}

/** 造一个模板定义。 */
export function makeTemplate(input: {
	readonly ref: string;
	readonly kind: string;
	readonly domain?: string;
	readonly codePrefix?: string;
	readonly sections?: readonly SectionDef[];
}): TemplateDef {
	return {
		ref: input.ref,
		displayName: input.ref,
		kind: input.kind,
		domain: input.domain ?? '核心',
		codePrefix: input.codePrefix ?? 'X',
		usage: '',
		description: '',
		sections: input.sections ?? [textSection()],
		derives: [],
	};
}

/** 建一个内存任务板 + 一个工作空间，并注册给定模板。 */
export async function makeBoard(
	templates: readonly TemplateDef[],
): Promise<{ readonly tb: Taskboard; readonly ws: string }> {
	const tb = createTaskboard({ store: createMemoryStore() });
	for (const template of templates) tb.templates().register(template);
	const created = await tb.createWorkspace('测试空间');
	if (!created.ok) throw new Error(`建空间失败：${created.message}`);
	return { tb, ws: created.workspace.id };
}

/** 建一张卡并断言成功，返回卡编号。 */
export async function makeCard(
	tb: Taskboard,
	ws: string,
	templateRef: string,
	title: string,
	actor: 'ai' | 'user' = 'user',
): Promise<string> {
	const created = await tb.create({ workspaceId: ws, templateRef, title, actor });
	if (!created.ok) throw new Error(`建卡失败：${created.message}`);
	return created.card.id;
}
