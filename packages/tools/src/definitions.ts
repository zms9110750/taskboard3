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
// TODO(审查): 这是 AGENTS 3.7 的同一个坑（Object.freeze + 类型标注）：数组形式更糟 —— **少一个成员也不会红**，
// 只有 typeLabel() 的穷尽 switch 能保证「多一个成员会红」。可直接改：按 AGENTS 3.5 补裸字面量元组 +
// `Exclude<DefinitionType, (typeof DEFINITION_TYPES)[number]> extends never ? true : never` 断言。
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

// TODO(审查): 下面 5 个 `*Like` 接口是 core 类型的手抄镜像，接住它们的是 3 处 `as readonly DomainLike[]`
// （本文件 120 / 129 / 159 行附近）—— 这正是 AGENTS 3.1 说的「断言让编译器闭嘴」：core 改名后断言仍可能通过，
// 运行时读到 undefined。⇒ 让 core 导出 DomainDef/KindDef/TemplateDef/SectionDef 后整块删除（本注释即移除条件）。
// 需 lead 推动跨包导出。
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
			// TODO(审查): usage 与 description 在这里是两个并列字段，而 tools/create.ts 的建卡回执把它俩写成
			// 「description 为空才回退 usage」的二选一 —— 同一份模板元数据两处解释不一致，措辞会漂。需用户定口径。
			template.usage === '' ? '' : `用法：${template.usage}`,
			template.description === '' ? '' : `建卡后的下一步：${template.description}`,
			'',
			`章节（${template.sections.length} 个；content 的 key 用章节 id 或 label）：`,
			sectionLines.length === 0 ? '  （没有章节：空模板）' : sectionLines.join('\n'),
			...(deriveLines.length === 0 ? [] : ['', '可派生：', deriveLines.join('\n')]),
		]
			.filter((line) => line !== '')
		// TODO(审查): 这个 filter 会连**本意要保留的空行**一起吃掉（上面 `''` 用作章节分隔），
		// 所以模板详情里从来没有空行；同时它也承担「usage/description 为空就省略」的职责，两件事混在一处。
		// 可直接改：条件分支产出 undefined，filter 判 `!== undefined`，空行留得住。
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
	// TODO(审查): 键比较用 toLocaleLowerCase() 是 i18n 雷（土耳其语 I 会变 ı，命不中机器键）；
	// 这里比的是 id / ref 这类机器键，用 toLowerCase() 就够。可直接改（下面两处比较同改）。
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
