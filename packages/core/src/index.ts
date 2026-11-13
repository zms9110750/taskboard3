/**
 * 任务板实例 —— 工厂 + 全部公开方法。
 *
 * ## 三条不变量
 *
 * ① **所有方法显式带 `workspaceId`。** 没有会话概念，没有「激活」。
 *   用户 `2026-11-13`：「整个激活都只对 dsh 会话有效。mcp 是没法提供的。」
 *   ⇒ 默认空间是**各个入口自己的策略**，不是 core 的字段。
 *
 * ② **core 不认识 dsh。** 不 import 任何 `@deepseek-ai/*`。
 *   ⇒ dsh 入口与 mcp 入口都能用它，各自提供自己的收口。
 *
 * ③ **校验在 core，不在调用方。** 用户裁定：「就在 core 里面验证就好了。
 *   因为用户从 ui 里面创建卡，也是走数据给 core 的。」
 *
 * ## 只做核心层
 *
 * 状态转移规则不在本文件（`transition.ts` 由另一个成员负责）。本文件只提供
 * 读、建、改、删、工作空间、模板注册 —— 以及把校验接进建卡路径。
 */

import type { Failure } from '@taskboard/protocol';
import { DRAFT, ErrorCode, failure } from '@taskboard/protocol';

import type { Card, CardSection, WorkspaceId } from './card.js';
import { findCard, withoutDeleted } from './card.js';
import { buildCard, type CreateInput, type CreateResult } from './create.js';
import { createSqliteStore } from './storage/sqlite.js';
import type { CardStore, SearchCondition, SearchStrategy } from './ports.js';
import { ActionRegistry, BUILTIN_ACTIONS } from './template/actions.js';
import { DomainRegistry, BUILTIN_DOMAINS } from './template/domains.js';
import { KindRegistry, BUILTIN_KINDS } from './template/kinds.js';
import { TemplateRegistry } from './template/registry.js';
import { ContentSchemaCache } from './template/schema.js';
import type { TemplateDef, TemplateMeta, TemplateSummary } from './template/types.js';
import {
	createWorkspace,
	ensureAnyWorkspace,
	getWorkspace,
	listWorkspaces,
	renameWorkspace,
	setArchived,
	type Workspace,
} from './workspace.js';

/** 工厂参数。 */
export interface TaskboardOptions {
	/** 数据目录（SQLite 库放这里）。 */
	readonly dataDir: string;
	/** 替换存储实现；省略 = 用内置 `node:sqlite`。 */
	readonly store?: CardStore;
	/** 替换搜索实现；省略 = 用一个朴素的标题/字段筛选。 */
	readonly search?: SearchStrategy;
	/** 当前时间来源（测试注入用）。省略 = `Date.now`。 */
	readonly now?: () => number;
	/** 是否自动注册四个内置类别（默认 `true`）。 */
	readonly builtinKinds?: boolean;
	/** 是否自动注册两个内置领域（默认 `true`）。 */
	readonly builtinDomains?: boolean;
	/** 是否自动注册三个内置 action（默认 `true`）。 */
	readonly builtinActions?: boolean;
}

/** 任务板实例的公开面。 */
export interface Taskboard {
	/* ── 工作空间 ── */
	listWorkspaces(includeArchived?: boolean): readonly Workspace[];
	getWorkspace(id: WorkspaceId): Workspace | undefined;
	createWorkspace(name: string): Promise<{ readonly ok: true; readonly workspace: Workspace } | Failure>;
	archiveWorkspace(id: WorkspaceId): Promise<{ readonly ok: true; readonly changed: boolean } | Failure>;
	unarchiveWorkspace(id: WorkspaceId): Promise<{ readonly ok: true; readonly changed: boolean } | Failure>;
	renameWorkspace(id: WorkspaceId, name: string): Promise<{ readonly ok: true; readonly workspace: Workspace } | Failure>;
	/** 没有任何空间时建一个「默认」。**不是**全局默认值。 */
	ensureAnyWorkspace(): Promise<Workspace>;

	/* ── 读 ── */
	/** 一个空间的全部卡（**不含墓碑**）。 */
	list(workspaceId: WorkspaceId): readonly Card[];
	/** 按编号直查（**含墓碑** —— 「按 id 直查可见」是既定规则）。 */
	get(workspaceId: WorkspaceId, cardId: string): { readonly ok: true; readonly card: Card } | Failure;
	/** 筛选。 */
	search(workspaceId: WorkspaceId, condition: SearchCondition): readonly Card[];

	/* ── 写 ── */
	create(input: CreateInput): Promise<CreateResult>;
	/** 改标题 / 备注 / 章节（整体替换，不是增量合并）。 */
	update(
		workspaceId: WorkspaceId,
		cardId: string,
		patch: {
			readonly title?: string;
			readonly note?: string;
			readonly content?: unknown;
		},
	): Promise<{ readonly ok: true; readonly card: Card } | Failure>;
	/** 墓碑标记（只有草稿能删）。 */
	remove(workspaceId: WorkspaceId, cardId: string): Promise<{ readonly ok: true; readonly card: Card } | Failure>;

	/* ── 模板 / 类别 / 领域 / action 注册面 ── */
	templates(): TemplateRegistry;
	kinds(): KindRegistry;
	domains(): DomainRegistry;
	actions(): ActionRegistry;
	listTemplates(): readonly TemplateSummary[];
	templateMeta(ref: string): TemplateMeta | undefined;
	/** 上一次目录加载的错误。 */
	templateErrors(): readonly { readonly file: string; readonly message: string }[];

	/** 关闭底层资源。 */
	close(): Promise<void>;
}

/** 默认搜索：标题子串 + 字段精确（数组内 OR，字段间 AND）。 */
const naiveSearch: SearchStrategy = (cards, condition) => {
	const title = condition.title?.toLowerCase();
	const statuses = condition.status;
	const kinds = condition.kind;
	const domains = condition.domain;
	const refs = condition.templateRef;

	return cards.filter((card) => {
		if (title !== undefined && !card.title.toLowerCase().includes(title)) return false;
		if (statuses !== undefined && statuses.length > 0 && !statuses.includes(card.status)) return false;
		if (kinds !== undefined && kinds.length > 0 && !kinds.includes(card.template.kind)) return false;
		if (domains !== undefined && domains.length > 0 && !domains.includes(card.template.domain)) return false;
		if (refs !== undefined && refs.length > 0 && !refs.includes(card.template.ref)) return false;
		return true;
	});
};

/**
 * 建一个任务板实例。
 *
 * @throws 存储打不开（这是装配错误，不该静默降级）
 */
export function createTaskboard(options: TaskboardOptions): Taskboard {
	const now = options.now ?? (() => Date.now());
	const store = options.store ?? createSqliteStore(options.dataDir);
	const search = options.search ?? naiveSearch;

	const templates = new TemplateRegistry();
	const kinds = new KindRegistry();
	const domains = new DomainRegistry();
	/* 变更通知由各自的注册表广播；schema 缓存自己订阅（见 `ContentSchemaCache.start`）。 */
	const actions = new ActionRegistry();
	const schemas = new ContentSchemaCache(templates, actions);
	schemas.start();

	if (options.builtinKinds !== false) for (const kind of BUILTIN_KINDS) kinds.register(kind);
	if (options.builtinDomains !== false) for (const domain of BUILTIN_DOMAINS) domains.register(domain);
	if (options.builtinActions !== false) for (const action of BUILTIN_ACTIONS) actions.register(action);

	/** 读一个空间全部卡。 */
	const load = (workspaceId: WorkspaceId): readonly Card[] => store.loadAll(workspaceId);

	/** 落库 + 返回。 */
	const persist = async (workspaceId: WorkspaceId, card: Card): Promise<Card> => {
		await store.save(workspaceId, card);
		return card;
	};

	return {
		/* ── 工作空间 ── */
		listWorkspaces(includeArchived = false) {
			return listWorkspaces(store, includeArchived);
		},
		getWorkspace(id) {
			return getWorkspace(store, id);
		},
		async createWorkspace(name) {
			const result = await createWorkspace(store, name, now());
			if ('error' in result) {
				return failure(
					ErrorCode.FIELD_REQUIRED,
					result.error === 'NAME_EMPTY' ? '空间名字不能为空。' : '已有同名空间。',
					{ detail: { reason: result.error } },
				);
			}
			return { ok: true, workspace: result.workspace };
		},
		async archiveWorkspace(id) {
			const result = await setArchived(store, id, true);
			if ('error' in result) return failure(ErrorCode.WORKSPACE_NOT_FOUND, `空间「${id}」不存在。`);
			return { ok: true, changed: result.changed };
		},
		async unarchiveWorkspace(id) {
			const result = await setArchived(store, id, false);
			if ('error' in result) return failure(ErrorCode.WORKSPACE_NOT_FOUND, `空间「${id}」不存在。`);
			return { ok: true, changed: result.changed };
		},
		async renameWorkspace(id, name) {
			const result = await renameWorkspace(store, id, name);
			if ('error' in result) {
				const messages = {
					NOT_FOUND: `空间「${id}」不存在。`,
					NAME_EMPTY: '空间名字不能为空。',
					NAME_TAKEN: '已有同名空间。',
				} as const;
				return failure(ErrorCode.FIELD_REQUIRED, messages[result.error], { detail: { reason: result.error } });
			}
			return { ok: true, workspace: result.workspace };
		},
		ensureAnyWorkspace() {
			return ensureAnyWorkspace(store, now());
		},

		/* ── 读 ── */
		list(workspaceId) {
			return withoutDeleted(load(workspaceId));
		},
		get(workspaceId, cardId) {
			const card = findCard(load(workspaceId), cardId);
			if (card === undefined) {
				return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
			}
			return { ok: true, card };
		},
		search(workspaceId, condition) {
			/* 搜索走**读路径** ⇒ 过滤墓碑（「按 id 直查可见」是另一条路径）。 */
			return search(withoutDeleted(load(workspaceId)), condition);
		},

		/* ── 写 ── */
		async create(input) {
			const cards = load(input.workspaceId);
			const usedIds = cards.map((card) => card.id);

			const built = buildCard(input, {
				templates,
				kinds,
				schemas,
				usedIds,
				cards,
				now: now(),
			});
			if (!built.ok) return built;

			await persist(input.workspaceId, built.card);
			return { ok: true, card: built.card };
		},

		async update(workspaceId, cardId, patch) {
			const cards = load(workspaceId);
			const existing = findCard(cards, cardId);
			if (existing === undefined) {
				return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
			}
			if (existing.deleted) {
				return failure(ErrorCode.CARD_NOT_FOUND, `卡「${cardId}」已被删除。`);
			}

			const title = patch.title === undefined ? existing.title : patch.title.trim();
			if (title === '') {
				return failure(ErrorCode.FIELD_REQUIRED, '卡标题不能为空。', {
					issues: [{ path: '/title', message: '必填' }],
				});
			}

			let sections: Record<string, CardSection> = { ...existing.sections };
			if (patch.content !== undefined) {
				const validated = schemas.validate(existing.template.ref, patch.content);
				if (!validated.ok) return validated;
				sections = {};
				const template = templates.get(existing.template.ref);
				if (template !== undefined) {
					for (const section of template.sections) {
						const payload = validated.payloads.get(section.id);
						if (payload === undefined) continue;
						sections[section.id] = { label: section.label, payload };
					}
				}
			}

			const at = now();
			const next: Card = {
				...existing,
				title,
				sections,
				note: patch.note ?? existing.note,
				history: [...existing.history, { at, action: 'update' }],
			};
			await persist(workspaceId, next);
			return { ok: true, card: next };
		},

		async remove(workspaceId, cardId) {
			const cards = load(workspaceId);
			const existing = findCard(cards, cardId);
			if (existing === undefined) {
				return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
			}
			if (existing.deleted) {
				return failure(ErrorCode.CARD_NOT_FOUND, `卡「${cardId}」已经删除了。`);
			}
			/* 用户：「墓碑只有草稿才能进去。」 */
			if (existing.status !== DRAFT) {
				return failure(ErrorCode.TRANSITION_REJECTED, '只有草稿能删除；已采纳的卡不能删。');
			}
			const at = now();
			const next: Card = {
				...existing,
				deleted: true,
				history: [...existing.history, { at, action: 'delete' }],
			};
			await persist(workspaceId, next);
			return { ok: true, card: next };
		},

		/* ── 注册面 ── */
		templates() {
			return templates;
		},
		kinds() {
			return kinds;
		},
		domains() {
			return domains;
		},
		actions() {
			return actions;
		},
		listTemplates() {
			return templates.summaries();
		},
		templateMeta(ref) {
			return templates.meta(ref);
		},
		templateErrors() {
			return templates.errors();
		},

		async close() {
			schemas.stop();
			await store.close();
		},
	};
}

/** 从一个目录加载模板（便捷函数）。 */
export function loadTemplatesFrom(tb: Taskboard, dir: string): { readonly loaded: number } {
	const result = tb.templates().loadDirectory(dir);
	return { loaded: result.loaded };
}

/* ────────────────────────── 对外契约（下游 import 这些） ──────────────────────────
 *
 * ## 为什么在这里再导出一次
 *
 * 下面这些名字的实现分散在 `ports.ts` / `card.ts` / `storage/sqlite.ts`，
 * 但**下游只该认一个入口**（`package.json` 的 `exports` 只有 `"."`）。
 * ⇒ 内部怎么分文件是 core 的自由，对外面只暴露这一个面。
 *
 * ⚠ **导出 ≠ 让下游乱用**：`createSqliteStore` 是给「默认存储插件行」和
 *   「测试 / mcp 入口」用的。dsh 与 store 插件应该通过 `CardStore` 端口拿实例，
 *   而不是自己 new 一个 —— 否则「替换存储实现」这件事就绕过去了。
 */

export { createSqliteStore } from './storage/sqlite.ts';

export type {
	CardStore,
	SearchCondition,
	SearchStrategy,
} from './ports.ts';

export type {
	Card,
	CardId,
	WorkspaceId,
	CardSection,
	HistoryEntry,
	RelationEntry,
	Relations,
	TemplateRef,
} from './card.ts';

