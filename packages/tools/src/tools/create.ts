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
 * Issue #35（#15 附加项②）：
 * > 「下一步」还要按**所建卡的类别 / 领域**给动态提示：类别说明与领域说明从
 * > core 的 `kinds()` / `domains()` 注册表取；「下一张卡」引用的类别名也从
 * > 注册表取，不在工具层另造第三份词表。
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
import type { ErrorCode } from '@taskboard/protocol';

import { resolveWorkspace, objectOf, str } from '../context.ts';
import { inputFailure, failureResult, nextStepFor } from '../failure.ts';
import { domainText, findDomain, kindNextStepText } from '../render.ts';
import { okText } from '../schema.ts';
import type { TaskboardToolHandler } from '../types.ts';
import {
	defineTool,
	WORKSPACE_ID_DESCRIPTION,
	WORKSPACE_ID_REQUIRED_NOTE,
	type ToolDeps,
} from './shared.ts';

/** 关系类型（5 条边 + parent）。 */
// TODO(审查): 这 6 个关系是 protocol「词汇与判决」层的硬编码副本（本包为状态都从 protocol 取 STATE_LABELS/TASK_STATES），
// 关系却在这里另立一份真值；protocol 加关系时这里会静默漏掉。⇒ 若 protocol 已导出关系标签，改成从那里派生。需 lead 确认。
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

	/*
	 * 「可用模板」的拼装（缺失 / 不存在两个分支共用 —— 逻辑级化简，TODO(审查) ① 同款判断；
	 * 首句与 next 各分支仍各写各的）。
	 */
	const templateHelp = (): string => {
		const available = taskboard.listTemplates().map((one) => one.ref).slice(0, 20);
		return available.length === 0 ? '当前没有任何可用模板。' : `可用模板：${available.join('、')}。`;
	};

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
			return inputFailure(
				'必须选择模板（templateRef）。' + templateHelp(),
				'先调 taskboard_definitions（不传 name）列出模板，再查具体模板详情（章节 / action / 默认 payload）后建卡。',
			);
		}
		if (!templates.some((one) => one.ref === templateRef)) {
			return inputFailure(
				`模板「${templateRef}」不存在。` + templateHelp(),
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
				next: nextStepFor(created.code, CREATE_NEXT_STEPS),
			});
		}

		const card = created.card;
		const template = taskboard.templates().get(templateRef);
		const kind = taskboard.kinds().get(card.template.kind);
		const lines: string[] = [
			`已建卡 ${card.id}「${card.title}」`,
		// TODO(审查): 这里手写「状态：未指定（TASK_STATE_UNSPECIFIED）」，而 render.ts 早就有 stateText(card.status)。
		// 状态改名/加状态时这行不会跟着变（词汇层又一份副本）。可直接改：改成 stateText(card.status)。
			`模板：${card.template.ref}（分类 ${card.template.kind} / 领域 ${card.template.domain}）；状态：未指定（TASK_STATE_UNSPECIFIED）`,
		];
		/* 用户裁决 #11：返回模板描述里的「下一步」。 */
		// TODO(审查): description 为空就回退展示 usage（两个语义不同的字段二选一），而 definitions.ts 的模板详情是两者并列显示。
		// 同一份模板元数据两处解释不一致。需用户定口径；改法很轻。
		if (template !== undefined && template.description !== '') lines.push('', `下一步：${template.description}`);
		else if (template !== undefined && template.usage !== '') lines.push('', `模板用法：${template.usage}`);

		/*
		 * Issue #35（#15 附加项②）：在模板自己的「下一步」之后，按**这张卡的
		 * 类别 / 领域**补动态提示。文案全部从 core 的注册表取（类别说明、领域
		 * 说明、以及「下一张卡」引用的类别名），工具层不另造词表。
		 */
		if (kind !== undefined) {
			const kindBlock: string[] = [];
			if (kind.description !== '') kindBlock.push(`分类（${kind.displayName}）：${kind.description}`);
			kindBlock.push(`下一张卡通常：${kindNextStepText(kind, (id) => taskboard.kinds().get(id))}`);
			lines.push('', ...kindBlock);
		}
		lines.push('', domainText(findDomain(taskboard.domains().list(), card.template.domain), card.template.domain));

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
			WORKSPACE_ID_REQUIRED_NOTE,
		inputSchema: {
			type: 'object',
			properties: {
				workspaceId: {
					type: 'string',
					description: WORKSPACE_ID_DESCRIPTION,
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
			required: ['workspaceId', 'title'],
		},
		handler,
	});
}

/** 解析关系数组。 */
function parseRelations(
	args: unknown,
): { readonly ok: true; readonly value: Partial<Pick<CreateInput, 'relations'>> } | { readonly ok: false; readonly result: ReturnType<typeof inputFailure> } {
	// TODO(审查): 这里用 `as` 绕过 context.ts 的读取器（其它工具都走 str/rawOf）。当前 args 已被 resolveWorkspace
	// 保证是对象，所以不炸；但 args 为 null 时 `(null as {...}).relations` 会抛 TypeError —— 潜在雷。
	// 可直接改：改成 rawOf(args, 'relations')。
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
		// TODO(审查): `(RELATION_TYPES as readonly string[]).includes(...)` 这种「先断言成 string[] 再 includes」在本包出现 5 处
		// （本处、cards.ts 两处、tools/definitions.ts 两处）。可直接改：写 isRelationType(x): x is RelationType 类型守卫，
		// 顺带把后面的 `as RelationType` 也去掉。
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

/** 建卡失败的下一步：只覆盖建卡口径不同的几条，其余走 `failure.ts` 的共用表。 */
const CREATE_NEXT_STEPS = {
	TEMPLATE_NOT_FOUND: '先调 taskboard_definitions 查模板清单与详情，再传正确的 templateRef。',
	CONTENT_INVALID: '先调 taskboard_definitions 看该模板的章节 id / label、每章 action 与默认 payload，再按形状写 content。',
	RELATION_TARGET_INVALID: '关系目标必须是同空间中已存在、未删除、非草稿的卡；先用 taskboard_cards 确认编号。',
	FIELD_REQUIRED: '检查 title；若模板是空模板（定义里没有分类/领域），必须补 kind（目的/分类）与 domain（领域）。',
} satisfies Partial<Record<ErrorCode, string>>;

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
