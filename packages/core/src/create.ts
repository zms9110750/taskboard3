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

import type { Actor, Failure } from '@taskboard/protocol';
import { DRAFT, ErrorCode, failure } from '@taskboard/protocol';

import type { Card, CardSection, Relations, TemplateRef } from './card.js';
import { nextId, prefixOf } from './ids.js';
import type { ContentSchemaCache } from './template/schema.js';
import type { KindRegistry } from './template/kinds.js';
import type { TemplateRegistry } from './template/registry.js';

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
export type CreateResult = { readonly ok: true; readonly card: Card } | Failure;

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

	/* ── 3. content 校验（动态 schema） ── */
	const validated = deps.schemas.validate(input.templateRef, input.content);
	if (!validated.ok) return validated;

	/* ── 4. 关系目标校验 ── */
	const relationsChecked = checkRelations(input.relations, deps.cards);
	if (!relationsChecked.ok) return relationsChecked;

	/* ── 5. 发号 ── */
	const letter = deps.kinds.letterOf(template.kind);
	const prefix = prefixOf(letter, template.codePrefix);
	if (!prefix.ok) {
		return failure(
			ErrorCode.FIELD_REQUIRED,
			prefix.reason === 'KIND_UNKNOWN'
				? `模板「${template.ref}」的类别「${template.kind}」未注册，无法发号。`
				: `模板「${template.ref}」拼出的编号前缀非法（分类字母「${letter ?? '?'}」+ codePrefix「${template.codePrefix}」）。`,
			{ detail: { templateRef: template.ref, kind: template.kind, codePrefix: template.codePrefix } },
		);
	}
	const id = nextId(prefix.prefix, deps.usedIds);

	/* ── 6. 组装卡 ── */
	const sections: Record<string, CardSection> = {};
	for (const section of template.sections) {
		const payload = validated.payloads.get(section.id);
		if (payload === undefined) continue;
		sections[section.id] = { label: section.label, payload };
	}

	const templateRef: TemplateRef = {
		ref: template.ref,
		kind: template.kind,
		domain: template.domain,
	};

	const relations: Relations = {
		parent: relationsChecked.parent,
		links: relationsChecked.links,
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
		history: [
			{
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
			},
		],
		deleted: false,
		/* 新卡还没有人持有。持有者由 `claim` 追加，可以多个。 */
		holders: [],
	};

	return { ok: true, card };
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

	const links: { label: Card['relations']['links'][number]['label']; to: string }[] = [];
	for (const link of input?.links ?? []) {
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
		links.push({ label: link.label as Card['relations']['links'][number]['label'], to: link.to });
	}

	return { ok: true, parent: parent === '' ? null : parent, links };
}
