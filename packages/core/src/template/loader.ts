/**
 * 模板 YAML 加载 —— **纯解析**，不碰注册表。
 *
 * ## 为什么与注册表分开
 *
 * 「解析一个 YAML 变成一个 `TemplateDef`」和「把它放进注册表并通知监听器」
 * 是两件事：
 *
 *   · 前者是**纯函数**，可以在测试里单独喂对象、单独测边界；
 *   · 后者有副作用（广播变更），调用点越少越好。
 *
 * ⇒ 本文件只做前者。注册、注销、通知在 `registry.ts`。
 *
 * ## 逐文件容错
 *
 * 一个坏模板文件不该让整个注册表不可用。用户：「如果他出错了，core 可以继续开。」
 * ⇒ `loadFile` 返回错误对象而不是抛；调用方决定记下来还是忽略。
 */

import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';

import type { DeriveDef, SectionDef, TemplateDef } from './types.ts';

/** YAML 里 `sections` 的一项（原始形状，未校验）。 */
interface RawSection {
	label?: unknown;
	hint?: unknown;
	default?: unknown;
	action?: unknown;
}

/** YAML 里的原始模板（未校验）。 */
interface RawTemplate {
	name?: unknown;
	displayName?: unknown;
	kind?: unknown;
	domain?: unknown;
	codePrefix?: unknown;
	usage?: unknown;
	description?: unknown;
	sections?: unknown;
	derive?: unknown;
}

/** 把 YAML 里的 `derive` 数组解析成 `DeriveDef[]`。 */
function parseDerives(raw: unknown): readonly DeriveDef[] {
	if (!Array.isArray(raw)) return [];
	const out: DeriveDef[] = [];
	for (const one of raw) {
		if (typeof one !== 'object' || one === null) continue;
		const item = one as { label?: unknown; description?: unknown; template?: unknown };
		if (typeof item.template !== 'string' || item.template === '') continue;
		out.push({
			label: typeof item.label === 'string' && item.label !== '' ? item.label : item.template,
			...(typeof item.description === 'string' && item.description !== ''
				? { description: item.description }
				: {}),
			template: item.template,
		});
	}
	return out;
}

/**
 * 从 YAML 的 `sections` 对象解析章节清单。
 *
 * ⚠ YAML 里 `sections` 是**对象**（key = sectionId，value = 定义），
 * 而存储 / 卡上用的是数组 —— 因为**顺序有意义**（UI 按书写顺序排）。
 * YAML 对象的键顺序在 `yaml` 库里是保留的（普通 mapping），所以顺序可靠。
 *
 * ## `action` 从哪来
 *
 * YAML 可以显式写 `action: text`；不写时从 `default.$type` 推 ——
 * 这是兼容旧仓库模板（旧模板只有 `default`，没有 `action` 字段）。
 */
function parseSections(raw: unknown, ref: string): { sections: SectionDef[] } | { error: string } {
	if (raw === undefined || raw === null) return { sections: [] };
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		return { error: `模板「${ref}」的 sections 必须是对象（key = 章节 id）` };
	}

	const sections: SectionDef[] = [];
	const seenLabels = new Set<string>();

	for (const [id, value] of Object.entries(raw as Record<string, RawSection>)) {
		if (id === '') return { error: `模板「${ref}」有一个空章节 id` };
		if (typeof value !== 'object' || value === null) {
			return { error: `模板「${ref}」的章节「${id}」必须是对象` };
		}

		const label = typeof value.label === 'string' && value.label !== '' ? value.label : id;
		/*
		 * 章节名是**传参的 key** ⇒ 同一模板内必须唯一。
		 * 重复会让「按 label 找章节」有歧义，而这种歧义只会表现为"校验过了但写错了章"。
		 */
		if (seenLabels.has(label)) {
			return { error: `模板「${ref}」的章节名「${label}」重复（章节名是传参的 key，必须唯一）` };
		}
		seenLabels.add(label);

		const declared = typeof value.action === 'string' && value.action !== '' ? value.action : undefined;
		const fromDefault =
			typeof (value.default as { $type?: unknown } | undefined)?.$type === 'string'
				? String((value.default as { $type: string }).$type)
				: undefined;

		/*
		 * ## ⚠ `action` 和 `default.$type` 必须一致（用户 2026-11-18 的注册表设计要求）
		 *
		 * 卡上存的 `CardSection` **只有 `{ label, payload }`，没有 `action` 字段**
		 * （见 `card.ts`）。所以运行期只能从 `payload.$type` 反推 action：
		 *
		 *   ① 接通检查：按**模板的** `section.action` 算「需要哪些渲染器」
		 *   ③ 真渲染时：按**卡上 payload 的** `$type` 查渲染器
		 *
		 * 若两者不一致（模板写 `action: text` 但 `default.$type: markdown`），
		 * 则 ① 检查 `text`、③ 按 `markdown` 查 ⇒ **① 通过而 ③ 必然报错**。
		 * 那不是「漏注册」，是**模板写错了**，而且永远修不好。
		 *
		 * ⇒ 在**加载期**就拒掉。这样 ① 和 ③ 用的必然是同一个字符串。
		 *   错误走现有的 `templateErrors()` 出口（`{ file, message }`），不新造一套。
		 */
		if (declared !== undefined && fromDefault !== undefined && declared !== fromDefault) {
			return {
				error:
					`模板「${ref}」的章节「${label}」action 与 default.$type 不一致：` +
					`action: ${declared}，default.$type: ${fromDefault}。` +
					'卡上只存 payload，运行期按 payload.$type 查渲染器 —— 两者不一致会让「缺渲染器」检查永远对不上。',
			};
		}

		sections.push({
			id,
			label,
			hint: typeof value.hint === 'string' ? value.hint : '',
			action: declared ?? fromDefault ?? 'text',
			defaultPayload: value.default,
		});
	}
	return { sections };
}

/**
 * 把一个已解析的 YAML 对象变成 `TemplateDef`。
 *
 * @param ref 模板引用（文件名去扩展名）。YAML 里的 `name` 与它不一致时以 `ref` 为准 ——
 *           因为**卡上存的是 ref**，文件名是唯一稳定的键。
 */
export function fromRaw(ref: string, raw: unknown): { template: TemplateDef } | { error: string } {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return { error: `模板「${ref}」的 YAML 顶层必须是对象` };
	}
	const value = raw as RawTemplate;

	const sections = parseSections(value.sections, ref);
	if ('error' in sections) return sections;

	return {
		template: {
			ref,
			displayName:
				typeof value.displayName === 'string' && value.displayName !== '' ? value.displayName : ref,
			kind: typeof value.kind === 'string' ? value.kind : '',
			domain: typeof value.domain === 'string' ? value.domain : '',
			codePrefix: typeof value.codePrefix === 'string' ? value.codePrefix : '',
			usage: typeof value.usage === 'string' ? value.usage : '',
			description: typeof value.description === 'string' ? value.description : '',
			sections: sections.sections,
			derives: parseDerives(value.derive),
		},
	};
}

/** 从单个 YAML 文件读一个模板（不抛，返回错误对象）。 */
export function loadFile(file: string, ref: string): { template: TemplateDef } | { error: string } {
	let text: string;
	try {
		text = readFileSync(file, 'utf8');
	} catch (error) {
		return { error: `读不了文件：${error instanceof Error ? error.message : String(error)}` };
	}
	let parsed: unknown;
	try {
		parsed = parseYaml(text);
	} catch (error) {
		return { error: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}` };
	}
	return fromRaw(ref, parsed);
}

