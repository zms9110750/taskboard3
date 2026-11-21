/**
 * 「查看定义」的数据整理（用户 #4）。
 *
 * > 一个参数输入名字。接受领域、状态、模板、分类。
 * > 另一个参数是枚举，范围就是前面 4 个，用于重名时指定类型。
 * > 名字可以不输入 —— 不输入 = 列出；给了枚举 = 只列出该分类下的东西。
 *
 * ## 名字从哪来（用户裁决 #4 的动机）
 *
 * 这正是要解决的问题：AI 不知道模板/领域/分类/状态叫什么时，
 * 不传 `name` 调一次就能拿到清单；拿到名字后再按名查详情。
 *
 * ## 为什么分「清单」与「详情」两种渲染
 *
 * 清单要短（一次列全，AI 扫一眼记名字）；详情要全（章节 / action / 默认 payload），
 * 因为 `taskboard_create` 的 `content` 需要它。两种混在一起会让清单变成一屏 JSON。
 */

import type { Taskboard } from '@taskboard/core';
import { STATE_LABELS, TASK_STATES, groupOf, labelOf } from '@taskboard/protocol';

/** 四种定义类型（用户：「范围就是前面 4 个」）。 */
export type DefinitionType = 'domain' | 'state' | 'template' | 'kind';

/** 枚举顺序 = 用户列举顺序（领域、状态、模板、分类）。 */
export const DEFINITION_TYPES: readonly DefinitionType[] = Object.freeze([
	'domain',
	'state',
	'template',
	'kind',
]);

/** 一条定义。 */
export interface DefinitionEntry {
	readonly type: DefinitionType;
	/** 机器键（domain/kind id、state id、template ref）。 */
	readonly key: string;
	/** 人读名字（中文名 / 模板显示名）。 */
	readonly title: string;
	/** 清单里的一行。 */
	readonly summary: string;
	/** 详情正文。 */
	readonly detail: string;
}

/* ────────────────────────────── 结构形状 ──────────────────────────────
 *
 * core 没有把 `DomainDef` / `TemplateDef` 从包根导出（它们是 `templates()` /
 * `domains()` 返回类型的一部分）。这里声明**结构形状**：结构上满足即可，
 * 不复制实现，也不依赖未导出的类型名。
 */

interface DomainLike {
	readonly id: string;
	readonly displayName: string;
	readonly description: string;
}

interface KindLike {
	readonly id: string;
	readonly displayName: string;
	readonly letter: string;
	readonly description: string;
	readonly reopenable: boolean;
	readonly needsClaim: boolean;
}

interface SectionLike {
	readonly id: string;
	readonly label: string;
	readonly hint: string;
	readonly action: string;
	readonly defaultPayload: unknown;
}

interface DeriveLike {
	readonly label: string;
	readonly description?: string;
	readonly template: string;
}

interface TemplateLike {
	readonly ref: string;
	readonly displayName: string;
	readonly kind: string;
	readonly domain: string;
	readonly usage: string;
	readonly description: string;
	readonly sections: readonly SectionLike[];
	readonly derives: readonly DeriveLike[];
}

/** 类型中文名（给错误 / 清单用）。 */
export function typeLabel(type: DefinitionType): string {
	switch (type) {
		case 'domain':
			return '领域';
		case 'state':
			return '状态';
		case 'template':
			return '模板';
		case 'kind':
			return '分类';
	}
}

/** 取全部定义（可按类型过滤）。 */
export function allDefinitions(taskboard: Taskboard, only?: DefinitionType): readonly DefinitionEntry[] {
	const entries: DefinitionEntry[] = [];
	for (const type of DEFINITION_TYPES) {
		if (only !== undefined && type !== only) continue;
		entries.push(...entriesOf(taskboard, type));
	}
	return entries;
}

/** 某一种类型的全部定义。 */
function entriesOf(taskboard: Taskboard, type: DefinitionType): readonly DefinitionEntry[] {
	if (type === 'domain') {
		return (taskboard.domains().list() as readonly DomainLike[]).map((one) => ({
			type,
			key: one.id,
			title: one.displayName,
			summary: `  ${one.id}  ${one.displayName} —— ${one.description}`,
			detail: [`领域「${one.displayName}」（${one.id}）`, '', `说明：${one.description || '（无）'}`].join('\n'),
		}));
	}
	if (type === 'kind') {
		return (taskboard.kinds().list() as readonly KindLike[]).map((one) => ({
			type,
			key: one.id,
			title: one.displayName,
			summary:
				`  ${one.id}  ${one.displayName}（字母 ${one.letter}，` +
				`${one.needsClaim ? '需要领取' : '不需要领取'}）`,
			detail: [
				`分类「${one.displayName}」（${one.id}）`,
				`编号字母：${one.letter}`,
				`需要领取：${one.needsClaim ? '是（工作卡）' : '否'}`,
				`可重开：${one.reopenable ? '是' : '否'}`,
				'',
				`说明：${one.description || '（无）'}`,
			].join('\n'),
		}));
	}
	if (type === 'state') {
		return TASK_STATES.map((state) => ({
			type,
			key: state,
			title: labelOf(state),
			summary: `  ${state}  ${labelOf(state)}（组：${groupOf(state)}）`,
			detail: [
				`状态「${labelOf(state)}」（${state}）`,
				`组：${groupOf(state)}`,
				`中文名：${STATE_LABELS[state]}`,
			].join('\n'),
		}));
	}
	return (taskboard.templates().list() as readonly TemplateLike[]).map((template) => {
		const sectionLines = template.sections.map((section, index) => {
			const lines = [`  ${index + 1}. 「${section.label}」（${section.id}）→ action=${section.action}`];
			if (section.hint !== '') lines.push(`     提示：${section.hint.replace(/\s+/gu, ' ').slice(0, 160)}`);
			lines.push(`     默认 payload：${JSON.stringify(section.defaultPayload)}`);
			return lines.join('\n');
		});
		const deriveLines = template.derives.map(
			(one) => `  ${one.label} → ${one.template}${one.description === undefined ? '' : `（${one.description}）`}`,
		);
		const detail = [
			`模板「${template.displayName}」（${template.ref}）`,
			`分类：${template.kind}　领域：${template.domain}`,
			template.usage === '' ? '' : `用法：${template.usage}`,
			template.description === '' ? '' : `建卡后的下一步：${template.description}`,
			'',
			`章节（${template.sections.length} 个；content 的 key 用章节 id 或 label）：`,
			sectionLines.length === 0 ? '  （没有章节：空模板）' : sectionLines.join('\n'),
			...(deriveLines.length === 0 ? [] : ['', '可派生：', deriveLines.join('\n')]),
		]
			.filter((line) => line !== '')
			.join('\n');
		return {
			type,
			key: template.ref,
			title: template.displayName,
			summary: `  ${template.ref}  ${template.displayName}（${template.kind} / ${template.domain}）`,
			detail,
		};
	});
}

/**
 * 按名字找定义（不区分大小写；id / ref 或中文显示名都认）。
 *
 * @returns 命中的条目；`[]` = 没找到；`>1` = 重名（调用方要求传 type）
 */
export function findDefinitions(
	taskboard: Taskboard,
	name: string,
	only?: DefinitionType,
): readonly DefinitionEntry[] {
	const needle = name.trim().toLocaleLowerCase();
	if (needle === '') return [];
	return allDefinitions(taskboard, only).filter(
		(entry) => entry.key.toLocaleLowerCase() === needle || entry.title.toLocaleLowerCase() === needle,
	);
}

/** 清单模式的文本。 */
export function listText(entries: readonly DefinitionEntry[], only?: DefinitionType): string {
	const types = only === undefined ? DEFINITION_TYPES : [only];
	const blocks: string[] = [];
	for (const type of types) {
		const own = entries.filter((one) => one.type === type);
		blocks.push(`${typeLabel(type)}（${own.length} 个）：`);
		if (own.length === 0) blocks.push('  （没有）');
		else for (const entry of own) blocks.push(entry.summary);
		blocks.push('');
	}
	return blocks.join('\n').trimEnd();
}

/** 重名时给 AI 的候选清单。 */
export function candidatesText(entries: readonly DefinitionEntry[]): string {
	return entries.map((one) => `  · ${typeLabel(one.type)}：${one.key}（${one.title}）`).join('\n');
}
