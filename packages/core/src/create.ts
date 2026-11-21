/**
 * 建卡 —— 纯函数 + 一个依赖注入的执行入口。
 *
 * ## 建卡是**提交时发号**
 *
 * 用户 `2026-11-01 06:43`：「建卡是提交时发号。」
 * ⇒ 编号在建卡那一刻就分配、写进卡里。**没有"草稿无编号"这种状态。**
 *
 * ## 校验顺序（顺序是契约的一部分）
 *
 * ```
 * 1. 模板存在吗           → TEMPLATE_NOT_FOUND
 * 2. 标题非空             → FIELD_REQUIRED
 * 3. content 符合模板吗   → CONTENT_INVALID（含未知章节名与 payload 形状）
 * 4. 关系目标合法吗       → RELATION_TARGET_INVALID
 * 5. 发号
 * 6. 落库
 * ```
 *
 * ⇒ 先报"模板不存在"再报"章节名不对"，因为模板不存在时讨论章节没有意义。
 *
 * ## 初始状态一律草稿
 *
 * 用户 `2026-11-02 16:05`：`design` / `record` 的初态也是「未指定」。
 * ⇒ **所有类别都从草稿开始**，区别在采纳之后去哪。
 */

import type { Actor, Failure, LinkKindId } from '@taskboard/protocol';
import { DRAFT, ErrorCode, LINK_KINDS, failure, isLinkKindId } from '@taskboard/protocol';

import type { Card, CardSection, HistoryEntry, Relations, TemplateRef } from './card.ts';
import { UNREAD_NONE, unreadAfter } from './card.ts';
import { nextId, prefixOf } from './ids.ts';
import type { ContentSchemaCache } from './template/schema.ts';
import type { KindRegistry } from './template/kinds.ts';
import type { TemplateRegistry } from './template/registry.ts';
import type { TemplateDef } from './template/types.ts';

/** 建卡来源。 */
export type CreateOrigin = 'panel' | 'derive' | 'fork' | 'import';

/** 建卡入参。 */
export interface CreateInput {
	readonly workspaceId: string;
	readonly templateRef: string;
	readonly title: string;
	/**
	 * 章节内容：key = 章节名（label）或章节 id，value = action payload。
	 * 省略整个字段 ⇒ 全部用模板默认值。
	 */
	readonly content?: unknown;
	/** 关系。`parent` 是派生父卡；`links` 是五种边。 */
	readonly relations?: {
		readonly parent?: string | null;
		readonly links?: readonly { readonly label: string; readonly to: string }[];
	};
	/**
	 * **「目的」/ 分类覆盖**（tool contract v2，用户 `2026-11-21`）。
	 *
	 * 用户原话：
	 * > 需要选择空间、模板，选择领域和目的（这个可空，通常不要。但是在使用空模板时，这两个必要）。
	 *
	 * 「空模板」= 模板自身没写 `kind` / `domain`（`loader.ts` 允许两者缺省为空串）。
	 * 这时建卡必须补上，否则发号拿不到分类字母。
	 * - 模板已声明 ⇒ 入参必须省略或与模板一致（不一致说明调用方选错了模板，拒绝）；
	 * - 模板未声明 ⇒ 必须由入参提供。
	 *
	 * ⚠ 卡上的 `template.kind/domain` 是**快照**，取的是实际生效值。
	 */
	readonly kind?: string;
	readonly domain?: string;
	readonly note?: string;
	readonly origin?: CreateOrigin;
	/**
	 * 谁建的卡。省略 = `'user'`。
	 *
	 * ⚠ 与 `origin` 不是一回事：`origin` 说的是**从哪儿建**
	 *   （面板 / 派生 / fork / 导入），`actor` 说的是**谁**（人还是 AI）。
	 *   AI 工具建卡时 `origin: 'panel'` 且 `actor: 'ai'` 是合法组合。
	 */
	readonly actor?: Actor;
}

/** 建卡的依赖。 */
export interface CreateDeps {
	readonly templates: TemplateRegistry;
	readonly kinds: KindRegistry;
	readonly schemas: ContentSchemaCache;
	/** 该空间全部已用编号（含墓碑）。 */
	readonly usedIds: readonly string[];
	/** 该空间全部卡（用于关系目标校验）。 */
	readonly cards: readonly Card[];
	/** 当前时间。 */
	readonly now: number;
}

/** 建卡结果。 */
export type CreateResult =
	| {
			readonly ok: true;
			readonly card: Card;
			/**
			 * 建卡成功但有需要告知调用方的警告（不是失败）——tool contract v2 的第二轮规则：
			 * 「章节完整，但有额外的 key ⇒ 提交为草稿 + 警告」。
			 */
			readonly warnings?: readonly string[];
	  }
	| Failure;

/**
 * 建一张卡。
 *
 * 校验（上面 1–4 步）全部在这里；不碰存储 —— 落库由调用方做。
 */
export function buildCard(input: CreateInput, deps: CreateDeps): CreateResult {
	/* ── 1. 模板存在吗 ── */
	const template = deps.templates.get(input.templateRef);
	if (template === undefined) {
		return failure(ErrorCode.TEMPLATE_NOT_FOUND, `模板「${input.templateRef}」不存在。`, {
			detail: { templateRef: input.templateRef, available: deps.templates.summaries().map((one) => one.ref) },
		});
	}

	/* ── 2. 标题非空 ── */
	const title = input.title.trim();
	if (title === '') {
		return failure(ErrorCode.FIELD_REQUIRED, '卡标题不能为空。', {
			issues: [{ path: '/title', message: '必填' }],
		});
	}

	/* ── 2.5 分类 / 领域：模板没声明时必须由入参补（空模板） ── */
	const classification = resolveClassification(template, input);
	if (!classification.ok) return classification;

	/*
	 * ── 3. content 与模板章节的关系（tool contract v2 第二轮规则） ──
	 *
	 * 用户原话：
	 * > 创建卡添加约束。可以缺少部分。但是如果缺少部分章节同时有非章节的 key，
	 * > 拦截这次提交，报错。如果是有完整的章节，然后有额外的章节。提交为草稿然后进行警告。
	 *
	 * 三条规则（见 `inspectCreateContent`）：
	 * ① 部分缺失、无未知 key ⇒ 允许（缺的用模板默认值）；
	 * ② 部分缺失 + 有未知 key ⇒ 拒绝；
	 * ③ 章节完整 + 有未知 key ⇒ 建卡成功（草稿）+ warning。
	 */
	const contentCheck = inspectCreateContent(template, input.content);
	if (!contentCheck.ok) return contentCheck.failure;

	/* 只把「模板认识的 key」交给 schema 校验（未知 key 已在上面分流）。 */
	const validated = deps.schemas.validate(input.templateRef, contentCheck.content);
	if (!validated.ok) return validated;

	/* ── 4. 关系目标校验 ── */
	const relationsChecked = checkRelations(input.relations, deps.cards);
	if (!relationsChecked.ok) return relationsChecked;

	/* ── 5. 发号 ── */
	const letter = deps.kinds.letterOf(classification.kind);
	const prefix = prefixOf(letter, template.codePrefix);
	if (!prefix.ok) {
		return failure(
			ErrorCode.FIELD_REQUIRED,
			prefix.reason === 'KIND_UNKNOWN'
				? `模板「${template.ref}」的类别「${classification.kind}」未注册，无法发号。` +
					'（先用 taskboard_definitions 查看可用分类）'
				: `模板「${template.ref}」拼出的编号前缀非法（分类字母「${letter ?? '?'}」+ codePrefix「${template.codePrefix}」）。`,
			{ detail: { templateRef: template.ref, kind: classification.kind, codePrefix: template.codePrefix } },
		);
	}
	const id = nextId(prefix.prefix, deps.usedIds);

	/* ── 6. 组装卡 ── */
	const sections: Record<string, CardSection> = {};
	/*
	 * 空模板：key 就是章节 id，label 也用 key（用户 2026-11-22：
	 * 「空模板允许建卡。他的章节是完全自定义的。key 怎么写都合法。」）
	 */
	if (template.sections.length === 0) {
		for (const [key, payload] of validated.payloads) {
			if (payload === undefined) continue;
			sections[key] = { label: key, payload };
		}
	} else {
		for (const section of template.sections) {
			const payload = validated.payloads.get(section.id);
			if (payload === undefined) continue;
			sections[section.id] = { label: section.label, payload };
		}
	}

	const templateRef: TemplateRef = {
		ref: template.ref,
		kind: classification.kind,
		domain: classification.domain,
	};

	const relations: Relations = {
		parent: relationsChecked.parent,
		links: relationsChecked.links,
	};

	const createEntry: HistoryEntry = {
		at: deps.now,
		action: 'create',
		/*
		 * 谁建的卡。
		 *
		 * ⚠ **不能假设是 user** —— AI 工具也能建卡（`origin` 里就有 `'ai'` 语义）。
		 * ⇒ 由调用方在 `CreateInput` 里显式给 `actor`。
		 */
		actor: input.actor ?? 'user',
		detail: { origin: input.origin ?? 'panel', templateRef: template.ref },
	};

	const card: Card = {
		id,
		title,
		status: DRAFT,
		template: templateRef,
		relations,
		sections,
		note: input.note ?? '',
		/* 建卡时间 = 那一刻；采纳时间此时还是 `null`（采纳路径会盖）。 */
		createdAt: deps.now,
		adoptedAt: null,
		history: [createEntry],
		deleted: false,
		/* 新卡还没有人持有。持有者由 `claim` 追加，可以多个。 */
		holders: [],
		/*
		 * 未读标记由 `unreadAfter` 从「建卡之前」（两个都没读）推出来 ——
		 * **不在这里第二次手写规则**，否则 `withHistory` 那条 funnel 就绕过了，
		 * 而这正是 drift 的开始。
		 */
		unread: unreadAfter(UNREAD_NONE, createEntry),
	};

	return {
		ok: true,
		card,
		...(contentCheck.warnings.length === 0 ? {} : { warnings: contentCheck.warnings }),
	};
}

/**
 * 建卡时 content 与模板章节的关系检查（v2 第二轮规则）。
 *
 * ## 为什么放在 core
 *
 * 「哪些 key 算章节」由模板定义决定（`sections[].id/label`）；判定完还要用
 * **过滤后的 content** 去过模板 schema。工具层只做「把 core 的 warning/失败翻给模型」，
 * 不重写这套规则。
 *
 * ## 三种情形
 *
 * | 缺失章节 | 有未知 key | 结果 |
 * |---|---|---|
 * | 有 | 无 | ✅ 允许（缺失章节用模板默认值） |
 * | 有 | 有 | ❌ `CONTENT_INVALID`（两次错误一起报） |
 * | 无 | 有 | ✅ 建卡（草稿）+ `warnings`（未知 key 被忽略） |
 *
 * ⚠ 未知 key 的 payload **不存进卡** —— `Card.sections` 只能装模板声明的章节。
 *   所以 warning 必须说清「已忽略」，否则调用方会以为内容被保留了。
 */
function inspectCreateContent(
	template: TemplateDef,
	raw: unknown,
): { readonly ok: true; readonly content: unknown; readonly warnings: readonly string[] } | { readonly ok: false; readonly failure: Failure } {
	if (raw === undefined || raw === null) return { ok: true, content: raw, warnings: [] };
	/* 非对象交给 schema 校验去报（那里有统一的人话错误）。 */
	if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: true, content: raw, warnings: [] };

	const record = raw as Record<string, unknown>;

	/*
	 * 空模板：章节完全自定义（用户 2026-11-22）——
	 * 每个 key 都是合法章节，原样交给下面的 schema 校验（它会原样收下）。
	 */
	if (template.sections.length === 0) {
		return { ok: true, content: record, warnings: [] };
	}
	/** 章节 id / label → sectionId。 */
	const byKey = new Map<string, string>();
	for (const section of template.sections) {
		byKey.set(section.id, section.id);
		byKey.set(section.label, section.id);
	}

	const known: Record<string, unknown> = {};
	const unknownKeys: string[] = [];
	const supplied = new Set<string>();
	for (const [key, value] of Object.entries(record)) {
		const sectionId = byKey.get(key);
		if (sectionId === undefined) {
			unknownKeys.push(key);
			continue;
		}
		known[key] = value;
		supplied.add(sectionId);
	}
	const missing = template.sections.filter((section) => !supplied.has(section.id));

	/* ② 部分缺失 + 未知 key ⇒ 拦截（两种问题一起报，让调用方一次改对）。 */
	if (unknownKeys.length > 0 && missing.length > 0) {
		const available = template.sections.map((one) => one.label);
		return {
			ok: false,
			failure: failure(
				ErrorCode.CONTENT_INVALID,
				`content 既缺少章节（${missing.map((one) => one.label).join('、')}），` +
					`又有模板里不存在的 key（${unknownKeys.join('、')}）。` +
					`可用的章节：${available.join('、')}。` +
					'要允许缺失章节，就不能同时带非章节 key：要么补全章节，要么删掉这些 key。',
				{
					issues: [
						...missing.map((one) => ({ path: `/content/${one.label}`, message: '章节缺失' })),
						...unknownKeys.map((key) => ({ path: `/content/${key}`, message: '模板里没有这个章节' })),
					],
				},
			),
		};
	}

	/* ③ 章节完整 + 未知 key ⇒ 成功 + 警告（未知 key 被忽略）。 */
	if (unknownKeys.length > 0) {
		return {
			ok: true,
			content: known,
			warnings: [`content 里有模板未声明的 key，已忽略：${unknownKeys.join('、')}。`],
		};
	}

	/* ① 正常 / 部分缺失（交给 schema 校验补默认值）。 */
	return { ok: true, content: known, warnings: [] };
}

/**
 * 解析一张新卡的**分类 / 领域**实际生效值（tool contract v2）。
 *
 * ## 为什么需要
 *
 * 「空模板」（模板没写 `kind` / `domain`）要能在建卡时补上这两个值，
 * 否则发号拿不到分类字母、筛选也不知道它属于哪一类。
 *
 * ## 三条规则
 *
 * | 模板 | 入参 | 结果 |
 * |---|---|---|
 * | 已声明 | 省略 / 相同 | 用模板值 |
 * | 已声明 | 不同 | **拒绝**（说明选错模板；静默忽略会让卡上的快照与模板不一致） |
 * | 未声明 | 提供 | 用入参 |
 * | 未声明 | 省略 | **拒绝**（空模板必须补） |
 *
 * 领域只做同规则，不校验是否在 `DomainRegistry` 里 —— 领域是**纯展示 + 筛选**
 * （`domains.ts` 顶部），允许第三方模板使用尚未注册的领域名。
 */
function resolveClassification(
	template: TemplateDef,
	input: CreateInput,
): { readonly ok: true; readonly kind: string; readonly domain: string } | Failure {
	const kindInput = input.kind?.trim();
	const domainInput = input.domain?.trim();

	let kind = template.kind;
	if (kind === '') {
		if (kindInput === undefined || kindInput === '') {
			return failure(
				ErrorCode.FIELD_REQUIRED,
				`模板「${template.ref}」是空模板（没有声明分类），建卡时必须给 kind（目的/分类）。`,
				{ issues: [{ path: '/kind', message: '必填（空模板）' }] },
			);
		}
		kind = kindInput;
	} else if (kindInput !== undefined && kindInput !== '' && kindInput !== kind) {
		return failure(
			ErrorCode.FIELD_REQUIRED,
			`模板「${template.ref}」的分类是「${kind}」，入参 kind「${kindInput}」不一致；不允许覆盖已声明的分类。`,
			{ issues: [{ path: '/kind', message: `与模板一致：${kind}` }] },
		);
	}

	let domain = template.domain;
	if (domain === '') {
		if (domainInput === undefined || domainInput === '') {
			return failure(
				ErrorCode.FIELD_REQUIRED,
				`模板「${template.ref}」是空模板（没有声明领域），建卡时必须给 domain（领域）。`,
				{ issues: [{ path: '/domain', message: '必填（空模板）' }] },
			);
		}
		domain = domainInput;
	} else if (domainInput !== undefined && domainInput !== '' && domainInput !== domain) {
		return failure(
			ErrorCode.FIELD_REQUIRED,
			`模板「${template.ref}」的领域是「${domain}」，入参 domain「${domainInput}」不一致；不允许覆盖已声明的领域。`,
			{ issues: [{ path: '/domain', message: `与模板一致：${domain}` }] },
		);
	}

	return { ok: true, kind, domain };
}

/**
 * 校验关系。
 *
 * 规则：
 * · `parent` 指向的卡必须存在，且**不是草稿**（用户：「墓碑只有草稿才能进去。
 *   而草稿是不能被指的。」⇒ 草稿不能被指，所以父卡必须非草稿）；
 * · `links.to` 同理；
 * · 不能指向自己（建卡时 id 还没发号，这条只能靠调用方保证 —— 派生时父卡 ≠ 新卡）。
 */
function checkRelations(
	input: CreateInput['relations'],
	cards: readonly Card[],
): { readonly ok: true; readonly parent: string | null; readonly links: Card['relations']['links'] } | Failure {
	const parent = input?.parent ?? null;
	if (parent !== null && parent !== '') {
		const found = cards.find((one) => one.id === parent);
		if (found === undefined) {
			return failure(ErrorCode.RELATION_TARGET_INVALID, `父卡「${parent}」不存在。`, {
				detail: { parent },
			});
		}
		if (found.deleted) {
			return failure(ErrorCode.RELATION_TARGET_INVALID, `父卡「${parent}」已被删除，不能指向它。`, {
				detail: { parent },
			});
		}
		if (found.status === DRAFT) {
			/* 用户：「草稿不可派生，要写字，草稿不能创建关系。」 */
			return failure(ErrorCode.RELATION_TARGET_INVALID, '草稿不能创建关系；先采纳父卡。', {
				detail: { parent },
			});
		}
	}

	const links: { label: LinkKindId; to: string }[] = [];
	for (const link of input?.links ?? []) {
		/*
		 * 关系标识必须真的是五条边之一。
		 *
		 * ⚠ 这里曾经是 `link.label as Card[...]['label']` —— 那是个**假校验**：
		 *   类型断言不会拦住 `'totallyMadeUp'`，于是脏关系会被写进卡里，
		 *   而所有按 `label` 分支的代码（级联、渲染、筛选）都静默跳过它。
		 * ⇒ 改成真判定 `isLinkKindId`，失败给可修的错误。
		 */
		if (!isLinkKindId(link.label)) {
			return failure(
				ErrorCode.RELATION_TARGET_INVALID,
				`关系标识「${link.label}」不存在；可用：${LINK_KINDS.map((one) => one.id).join('、')}。`,
				{ detail: { label: link.label, to: link.to } },
			);
		}

		const target = cards.find((one) => one.id === link.to);
		if (target === undefined) {
			return failure(ErrorCode.RELATION_TARGET_INVALID, `关系目标「${link.to}」不存在。`, {
				detail: { to: link.to, label: link.label },
			});
		}
		if (target.deleted) {
			return failure(ErrorCode.RELATION_TARGET_INVALID, `关系目标「${link.to}」已被删除。`, {
				detail: { to: link.to, label: link.label },
			});
		}
		if (target.status === DRAFT) {
			return failure(ErrorCode.RELATION_TARGET_INVALID, `关系目标「${link.to}」还是草稿，不能指向它。`, {
				detail: { to: link.to, label: link.label },
			});
		}
		links.push({ label: link.label, to: link.to });
	}

	return { ok: true, parent: parent === '' ? null : parent, links };
}

