/**
 * #5 创建卡。
 *
 * 用户要求：
 * > 需要选择空间、模板，选择领域和目的（这个可空，通常不要；但使用空模板时这两个必要）。
 * > 关系数组，模板对 action 的 json。空间为空时行为未定义。
 *
 * 用户后续裁决 #4：
 * > 建卡要先看定义（#4）；没模板时提示先用 #4；加 title 参数。
 * 裁决 #11：
 * > 创建以后返回模板描述里面的「下一步」+ 模板分类的描述。
 *
 * ## 关系数组
 *
 * 用户只说「关系数组」，没说元素形状。这里定成：
 *
 * ```json
 * [{ "type": "dependsOn", "to": "W2" }]
 * ```
 *
 * `type` 取值 = 5 条边 + `parent`（父卡是派生边，卡上单独存 `relations.parent`）。
 * 关系目标必须是**同空间、存在、未删除、非草稿**（core `checkRelations` 的规则；
 * 失败时 error 里会说清是哪一条）。
 *
 * ## 「先看定义」怎么落地
 *
 * 无状态工具无法真的校验「你有没有先调 #4」——把这条做成**描述 + 错误指引**：
 * · 描述里写「先 taskboard_definitions 看模板」；
 * · 模板缺失/找不到时，错误里直接给出可用模板清单与下一步。
 */

import type { CreateInput } from '@taskboard/core';

import { resolveWorkspace, objectOf, str } from '../context.ts';
import { inputFailure, failureResult } from '../failure.ts';
import { okText } from '../schema.ts';
import type { TaskboardToolHandler } from '../types.ts';
import { defineTool, type ToolDeps } from './shared.ts';

/** 关系类型（5 条边 + parent）。 */
export const RELATION_TYPES = [
	'parent',
	'dependsOn',
	'supersedes',
	'constrains',
	'related',
	'references',
] as const;

/** 解析后的关系入参。 */
interface ParsedRelations {
	readonly parent?: string;
	readonly links: readonly { readonly label: string; readonly to: string }[];
}

export function createCreateTool(deps: ToolDeps): ReturnType<typeof defineTool> {
	const { taskboard } = deps;

	const handler: TaskboardToolHandler = async (args, ctx) => {
		const resolved = await resolveWorkspace(args, ctx);
		if (!resolved.ok) return resolved.result;
		const workspaceId = resolved.workspaceId;

		const title = str(args, 'title');
		if (title === undefined) {
			return inputFailure('必须给 title（卡标题）。', '补上 title 后重试。');
		}

		/* ── 模板：没有/找不到 ⇒ 指引先看定义 ── */
		const templates = taskboard.listTemplates();
		const templateRef = str(args, 'templateRef');
		if (templateRef === undefined) {
			const available = templates.map((one) => one.ref).slice(0, 20);
			return inputFailure(
				'必须选择模板（templateRef）。' +
					(available.length === 0 ? '当前没有任何可用模板。' : `可用模板：${available.join('、')}。`),
				'先调 taskboard_definitions（不传 name）列出模板，再查具体模板详情（章节 / action / 默认 payload）后建卡。',
			);
		}
		if (!templates.some((one) => one.ref === templateRef)) {
			const available = templates.map((one) => one.ref).slice(0, 20);
			return inputFailure(
				`模板「${templateRef}」不存在。` + (available.length === 0 ? '当前没有任何可用模板。' : `可用模板：${available.join('、')}。`),
				'先调 taskboard_definitions 查模板定义，再传正确的 templateRef。',
			);
		}

		/* ── 关系数组 ── */
		const relations = parseRelations(args);
		if (!relations.ok) return relations.result;

		/* ── content（模板对 action 的 JSON） ── */
		const content = objectOf(args, 'content');
		const kindOverride = str(args, 'kind');
		const domainOverride = str(args, 'domain');

		const input: CreateInput = {
			workspaceId,
			templateRef,
			title,
			/* AI 工具建卡统一标 ai（否则「AI 改过」的未读标记永远不出现）。 */
			actor: 'ai',
			...(content === undefined ? {} : { content }),
			...relations.value,
			...(kindOverride === undefined ? {} : { kind: kindOverride }),
			...(domainOverride === undefined ? {} : { domain: domainOverride }),
		};

		const created = await taskboard.create(input);
		if (!created.ok) {
			return failureResult(created, {
				action: '建卡失败',
				next: nextForCreateFailure(created.code),
			});
		}

		const card = created.card;
		const template = taskboard.templates().get(templateRef);
		const kind = taskboard.kinds().get(card.template.kind);
		const lines: string[] = [
			`已建卡 ${card.id}「${card.title}」`,
			`模板：${card.template.ref}（分类 ${card.template.kind} / 领域 ${card.template.domain}）；状态：未指定（TASK_STATE_UNSPECIFIED）`,
		];
		/* 用户裁决 #11：返回模板描述里的「下一步」+ 分类描述。 */
		if (template !== undefined && template.description !== '') lines.push('', `下一步：${template.description}`);
		else if (template !== undefined && template.usage !== '') lines.push('', `模板用法：${template.usage}`);
		if (kind !== undefined && kind.description !== '') lines.push('', `分类（${kind.displayName}）：${kind.description}`);

		const sections = Object.entries(card.sections);
		lines.push('', `章节（${sections.length} 个）：`);
		if (sections.length === 0) lines.push('  （空模板：没有章节）');
		else for (const [sectionId, section] of sections) lines.push(`  ${sectionId}「${section.label}」`);

		const relationText = describeRelations(card.relations.parent, card.relations.links);
		if (relationText !== '') lines.push('', relationText);
		lines.push('', '下一步：需要让用户确认时再采纳（taskboard_transition，目标=提交）；改内容前先 taskboard_raw_card。');

		/*
		 * 用户第二轮 ⑤ 的第三种情形：章节完整但 content 里有模板外的 key
		 * ⇒ core 建卡成功（草稿）并给 warning。工具层用 `isError: false` 的
		 * 警告块回给模型，不要说成失败。
		 */
		if (created.warnings !== undefined && created.warnings.length > 0) {
			lines.push('', ...warningBlock(created.warnings));
		}
		return okText(lines.join('\n'));
	};

	return defineTool({
		name: 'taskboard_create',
		description:
			'建一张新任务卡。**先调 taskboard_definitions 看模板定义**（章节 key / action / 默认 payload），再建卡。' +
			'需要：title、templateRef，可选 relations（关系数组）、content（模板对 action 的 JSON：key=章节 id/label，value=action payload）；' +
			'kind/domain 通常不要给（模板已声明分类/领域），只有**空模板**（模板没声明分类/领域）时才必需。' +
			'content 可以只给部分章节（缺的用模板默认值）；但「部分章节 + 模板外 key」会被拒绝；' +
			'「章节齐全 + 模板外 key」会建卡成功并返回警告（模板外 key 被忽略）。' +
			'空间省略 = 宿主激活空间（DSH）；MCP 等没有该行为的宿主会报错。',
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: {
					type: 'string',
					description: '空间 id。省略 = 宿主激活空间（DSH）；MCP 等没有该行为的宿主会报错。',
				},
				title: { type: 'string', description: '卡标题。必填。' },
				templateRef: { type: 'string', description: '模板 ref。必填；先用 taskboard_definitions 查。' },
				content: {
					type: 'object',
					additionalProperties: true,
					description: '模板对 action 的 JSON：key = 章节 id 或 label，value = action payload。省略 = 用模板默认值。',
				},
				relations: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							type: { type: 'string', enum: [...RELATION_TYPES], description: '关系类型。' },
							to: { type: 'string', description: '目标卡编号（同空间）。' },
						},
						required: ['type', 'to'],
					},
					description:
						'关系数组：[{ type, to }]。type = parent / dependsOn / supersedes / constrains / related / references。',
				},
				kind: {
					type: 'string',
					description: '分类（目的）：只在空模板时需要；模板已声明时必须一致或省略。',
				},
				domain: { type: 'string', description: '领域：只在空模板时需要；模板已声明时必须一致或省略。' },
			},
			required: ['title'],
		},
		handler,
	});
}

/** 解析关系数组。 */
function parseRelations(
	args: unknown,
): { readonly ok: true; readonly value: Partial<Pick<CreateInput, 'relations'>> } | { readonly ok: false; readonly result: ReturnType<typeof inputFailure> } {
	const raw = (args as { relations?: unknown }).relations;
	if (raw === undefined) return { ok: true, value: {} };
	if (!Array.isArray(raw)) {
		return { ok: false, result: inputFailure('relations 必须是数组：[{ type, to }]。', '改成数组后重试。') };
	}

	let parent: string | undefined;
	const links: { label: string; to: string }[] = [];
	for (const [index, one] of raw.entries()) {
		if (typeof one !== 'object' || one === null || Array.isArray(one)) {
			return { ok: false, result: inputFailure(`relations[${index}] 不是对象。`, '每个元素形如 { type, to }。') };
		}
		const record = one as Record<string, unknown>;
		const type = record['type'];
		const to = record['to'];
		if (typeof type !== 'string' || !(RELATION_TYPES as readonly string[]).includes(type)) {
			return {
				ok: false,
				result: inputFailure(
					`relations[${index}].type 不合法；可用：${RELATION_TYPES.join('、')}。`,
					'改成上面列出的关系类型后重试。',
				),
			};
		}
		if (typeof to !== 'string' || to === '') {
			return { ok: false, result: inputFailure(`relations[${index}].to 必须是卡编号字符串。`, '补上目标卡编号。') };
		}
		if (type === 'parent') {
			if (parent !== undefined) {
				return { ok: false, result: inputFailure('只能有一个 parent（父卡）。', '去掉多余的 parent 关系。') };
			}
			parent = to;
			continue;
		}
		links.push({ label: type, to });
	}

	return {
		ok: true,
		value: {
			relations: {
				...(parent === undefined ? {} : { parent }),
				...(links.length === 0 ? {} : { links }),
			},
		},
	};
}

/** 建卡失败的下一步指引。 */
function nextForCreateFailure(code: string): string {
	switch (code) {
		case 'TEMPLATE_NOT_FOUND':
			return '先调 taskboard_definitions 查模板清单与详情，再传正确的 templateRef。';
		case 'CONTENT_INVALID':
			return '先调 taskboard_definitions 看该模板的章节 id / label、每章 action 与默认 payload，再按形状写 content。';
		case 'RELATION_TARGET_INVALID':
			return '关系目标必须是同空间中已存在、未删除、非草稿的卡；先用 taskboard_cards 确认编号。';
		case 'FIELD_REQUIRED':
			return '检查 title；若模板是空模板（定义里没有分类/领域），必须补 kind（目的/分类）与 domain（领域）。';
		default:
			return '修正参数后重试；不确定就先调 taskboard_definitions 看定义。';
	}
}

/** 关系文案。 */
function describeRelations(
	parent: string | null,
	links: readonly { readonly label: string; readonly to: string }[],
): string {
	if (parent === null && links.length === 0) return '';
	const lines = ['关系：'];
	if (parent !== null) lines.push(`  父卡：${parent}`);
	for (const link of links) lines.push(`  ${link.label} → ${link.to}`);
	return lines.join('\n');
}

/**
 * 建卡成功的**警告块**（不是失败：`isError` 不置位）。
 *
 * 用户第二轮 ⑤：
 * > 如果是有完整的章节，然后有额外的章节。提交为草稿然后进行警告。
 *
 * 与失败契约的区别只在「前缀 + isError」：原因一样要说清、下一步一样要可行动。
 */
function warningBlock(warnings: readonly string[]): readonly string[] {
	const lines = ['⚠ 警告（卡已按草稿创建，但提交内容有需要注意的地方）：'];
	for (const one of warnings) lines.push(`  · ${one}`);
	lines.push(
		'  · 这些非章节 key 不会存进卡里（卡只能装模板声明的章节）；要保留内容请把它们挪进已有章节，或先补模板定义。',
		'  · 下一步：用 taskboard_raw_card 确认卡里实际存了什么；需要正式化就先 taskboard_definitions 看模板。',
	);
	return lines;
}
