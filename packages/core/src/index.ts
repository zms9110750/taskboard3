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
import { DRAFT, ErrorCode, failure, type Actor, type TaskState } from '@taskboard/protocol';

import type { Card, CardSection, WorkspaceId } from './card.js';
import { findCard, withoutDeleted } from './card.js';
/* ⚠ 原型期脚手架，整个文件可删 —— 见 `bus.ts` 顶部的拆解步骤。 */
import type { Bus } from './bus.js';
import { buildCard, type CreateInput, type CreateResult } from './create.js';
import { createSearch, type SearchCondition } from './search.js';
import { createSqliteStore } from './storage/sqlite.js';
import {
	computeUpdates,
	markCardSeen,
	type UpdateReader,
	type UpdatesResult,
} from './updates.js';
import {
	adoptCard,
	claimCard,
	judgeClaim,
	recomputeChain,
	releaseCard,
	transitionCard,
} from './transition.js';
import type { CardStore } from './ports.js';
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

/**
 * 工厂参数 —— **判别联合**。
 *
 * ## 为什么不是「`dataDir` 必填 + `store` 可选」
 *
 * 旧写法有一个类型上说不通的组合：
 *
 * ```ts
 * createTaskboard({ dataDir: 'x', store: myStore })   // dataDir 被忽略
 * createTaskboard({ store: myStore })                 // ❌ 编译不过，虽然完全够用
 * ```
 *
 * ⇒ 判别联合让两种合法调用都成立，而「两个都不给」变成**编译错误**：
 *
 * ```ts
 * createTaskboard({})                                 // ❌ 编译错误
 * ```
 *
 * ## 搜索不在这里
 *
 * 用户裁定搜索强耦合（见 `ports.ts` 顶部）⇒ **没有 `search` 字段**。
 */
type CommonOptions = {
	/** 当前时间来源（测试注入用）。省略 = `Date.now`。 */
	readonly now?: () => number;
	/** 是否自动注册四个内置类别（默认 `true`）。 */
	readonly builtinKinds?: boolean;
	/** 是否自动注册两个内置领域（默认 `true`）。 */
	readonly builtinDomains?: boolean;
	/** 是否自动注册三个内置 action（默认 `true`）。 */
	readonly builtinActions?: boolean;
	/**
	 * 广播总线。**省略 = 不广播**（生产 / 测试默认）。
	 *
	 * ⚠ 这是**原型期脚手架**，见 `bus.ts` 顶部与拆解步骤。
	 *   拆掉时删这一行即可 —— 默认不创建，所以生产路径零开销。
	 */
	readonly bus?: Bus;
};

/** 工厂参数：给 `store` 或给 `dataDir`，二选一。 */
export type TaskboardOptions =
	| (CommonOptions & {
			/** 注入存储实现（调用方负责 `close` 之外的装配）。 */
			readonly store: CardStore;
	  })
	| (CommonOptions & {
			/** 数据目录（内置 SQLite 库建在这里）。 */
			readonly dataDir: string;
	  });

/** 状态写操作的结果：改过的卡 + 沿树被连带改动的父卡。 */
export interface StatusWriteOk {
	readonly ok: true;
	readonly card: Card;
	/** 沿 `parent` 链被连带改动的父卡（自底向上）。调用方要刷新它们。 */
	readonly recomputed: readonly Card[];
}

/** 一次状态写的结果。 */
export type StatusWriteResult = StatusWriteOk | Failure;

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

	/* ── 更新计数 ── */

	/**
	 * 两类「更新」的卡 id 清单。
	 *
	 * - `ai` —— AI 改过，**用户**还没看过；
	 * - `user` —— 用户改过，**AI** 还没看过。
	 *
	 * 「看过」的游标存在 `CardStore` 的 kv 里（`read:<cardId>:<reader>`），
	 * 截止时间是**卡历史里最新事件的 `at`**，不是当前时间。
	 */
	updates(workspaceId: WorkspaceId): Promise<UpdatesResult>;
	/**
	 * 标记一张卡被某个读者「看过」。
	 *
	 * @returns 写入的游标时间（= 卡历史里最新事件的 `at`，**不是 `now()`**）
	 */
	markSeen(
		workspaceId: WorkspaceId,
		cardId: string,
		reader: UpdateReader,
	): Promise<{ readonly ok: true; readonly at: number } | Failure>;

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
		/**
		 * 谁改的。默认 `'user'`。
		 *
		 * ⚠ **每个入口都应显式传。** 默认值让「忘了传」和「故意传 user」
		 * 变成同一件事 —— 两者都编译通过、都运行正常、都不报错。
		 * 而后果是静默的：AI 忘了标 `'ai'` ⇒ 那些改动被记成用户改的。
		 */
		actor?: Actor,
	): Promise<{ readonly ok: true; readonly card: Card } | Failure>;
	/** 墓碑标记（只有草稿能删）。 */
	remove(
		workspaceId: WorkspaceId,
		cardId: string,
		/** 谁删的。默认 `'user'`。语义同 `update` 的 `actor`。 */
		actor?: Actor,
	): Promise<{ readonly ok: true; readonly card: Card } | Failure>;

	/* ── 状态转移 ──
	 *
	 * 判定在 `@taskboard/protocol` 的 `judgeTransition`（纯函数），
	 * 改卡在 `transition.ts`（纯函数），本层只做「读卡 → 判定 → 落库 → 沿树重算」。
	 *
	 * 每个写方法都返回 `recomputed`：沿 `parent` 链被连带改动的父卡。
	 * 调用方需要刷新它们，否则界面会拿着旧状态。
	 */

	/** 采纳：草稿 → 按类别进「提交」或「需要授权」；同时写 `adoptedAt`。 */
	adopt(workspaceId: WorkspaceId, cardId: string, actor: Actor): Promise<StatusWriteResult>;
	/**
	 * 领取：把「执行权限」发给一个 AI 身份。
	 *
	 * ## claim 是**权限边界**，不是并发锁（用户 `2026-11-13`）
	 *
	 * > 一次一张要的。因为自动化下。就是工作卡给的权限。这是为了防止越狱。
	 * > 比如编写代码是没有命令行的。跑一边要另外开卡。这也是为了记录流程。
	 * > 而只能一个人领取其实没啥用。那是为了防止两个ai一起做。
	 * > 应该有任何人领取，就是进行中。然后显示有谁拿了。
	 * > 现在不限制一个卡只能被一个拿，应该就没问题了。
	 *
	 * | 规则 | 内容 |
	 * |---|---|
	 * | 只对工作卡 | 目标 / 设计 / 记录在纯聊天里就能做，不需要执行权限 ⇒ 领取被拒 |
	 * | 可多人持有 | 同一张卡能被多个 holder 同时持有（`Card.holders` 是列表） |
	 * | 一次一张 | 每个 holder 名下只能有**一张**处理中的**工作**卡 |
	 *
	 * ⚠ 「AB 都持有 X ⇒ AB 都不能领 Y」—— X 是工作卡，各自占了自己那份配额。这是用户明确要的。
	 * ⚠ 重复 claim 同一张卡**幂等**：不重复追加、不报错。
	 *
	 * @param actor 谁点的（只影响 `history`，**不影响任何判定**）
	 * @param holder **AI 消息循环 id / 会话 id**（必传）。
	 *   用户点按钮是「代 AI 指派」，此时也传那个 AI 的 holder。
	 */
	claim(
		workspaceId: WorkspaceId,
		cardId: string,
		actor: Actor,
		holder: string,
	): Promise<StatusWriteResult>;
	/**
	 * 释放：把自己从持有者里移除。
	 *
	 * - 自己不在列表里 ⇒ 拒（并列出当前持有者）；
	 * - 移除后列表还有别人 ⇒ **状态不变**；
	 * - 移除后列表空了 ⇒ 状态回「提交」。
	 *
	 * @param holder 谁在释放（必须是持有者之一）
	 */
	release(
		workspaceId: WorkspaceId,
		cardId: string,
		actor: Actor,
		holder: string,
	): Promise<StatusWriteResult>;
	/**
	 * 通用状态转移。
	 *
	 * @param trigger `'button'`（人点界面）/ `'ai'`（模型调工具）。
	 *                **由调用方写死，不从前端传** —— 否则前端传 `button` 就能冒充用户。
	 */
	transition(
		workspaceId: WorkspaceId,
		cardId: string,
		to: TaskState,
		trigger: 'button' | 'ai',
	): Promise<StatusWriteResult>;
	/**
	 * 沿 `parent` 链向上重算并落库。
	 *
	 * **自动计算绝不产出终结态** —— 候选只来自 `AUTO_STATES`。
	 * @returns 被改动的父卡（自底向上）
	 */
	recomputeUpward(workspaceId: WorkspaceId, cardId: string): Promise<readonly Card[]>;

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

/**
 * 建一个任务板实例。
 *
 * @throws 存储打不开（这是装配错误，不该静默降级）
 */
export function createTaskboard(options: TaskboardOptions): Taskboard {
	const now = options.now ?? (() => Date.now());
	/*
	 * 判别联合的窄化：`'store' in options` 在类型层就把两条分支分开，
	 * 不需要 `as`。给了 `store` 时**绝不**去碰 `dataDir`（那个字段不存在）。
	 */
	const store: CardStore = 'store' in options ? options.store : createSqliteStore(options.dataDir);
	/*
	 * 搜索**不可注入** —— 用户裁定强耦合（见 `ports.ts` 顶部）。
	 * `createSearch()` 是无参的：状态 → 组名的映射直接 import protocol，不再需要注入。
	 */
	const search = createSearch();

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

	/**
	 * 「需要领取」的类别集合 —— 从 `KindDef.needsClaim` 派生，**不写 `'work'` 字面量**。
	 *
	 * 第三方注册的类别自己声明要不要领取，`judgeClaim` 只查这个集合。
	 */
	const needsClaimKinds = (): ReadonlySet<string> =>
		new Set(kinds.list().filter((one) => one.needsClaim).map((one) => one.id));

	/**
	 * 落库 + 返回。
	 *
	 * ## ⚠ 这里是**唯一的广播收口**（原型期脚手架）
	 *
	 * 所有写卡路径都经过本函数 —— `create` / `update` / `remove` / `adopt` /
	 * `claim` / `release` / `transition` / `recomputeUpward` 全部。
	 * ⇒ 在这一处 `emit` 就覆盖了全部卡片写入，不需要在每个方法里各发一次。
	 *
	 * ## 已知代价（刻意接受）
	 *
	 * 一次 `update` 如果连带重算了 2 张父卡，会发出 **3 条** `card:written`。
	 * 消费方会重拉 3 次 —— **这是原型期刻意接受的浪费**，换「一处收口、一处可拆」。
	 *
	 * 合并成一条要等其他写路径也收口、或者干脆拆掉这条管道换成真接口。
	 * 现在合并会引入「批次」概念（begin/chunk/commit），那是给临时脚手架修永久设施。
	 */
	const persist = async (workspaceId: WorkspaceId, card: Card): Promise<Card> => {
		await store.save(workspaceId, card);
		/*
		 * 消息只带「有事发生」+ 被写的那**一张**卡。
		 * 消费方收到后自己 `loadAll` 重拉 —— 不解析细节（见 `bus.ts`）。
		 */
		options.bus?.emit({ type: 'card:written', workspaceId, cards: [card] });
		return card;
	};

	/**
	 * 工作空间变更的广播 —— **当前故意不接**（见下）。
	 *
	 * ## 发现：工作空间写路径完全绕开 `persist`
	 *
	 * 工作空间 CRUD 写的是 `store.kvSet`（`workspace.ts` 的 `writeAll`），
	 * **不经过 `persist`**。所以卡片广播对空间变更是无效的。
	 *
	 * ## 为什么现在不接
	 *
	 * 接它有两种做法，都超出「可拆 = 3 处」的预算：
	 *
	 * 1. 在 4 个空间方法里各加一行 `emit` ⇒ 删除成本从 3 处变成 8 处；
	 * 2. 加一个 `emitWorkspace()` 收口 + 5 处调用 ⇒ 仍是多一处必须删的东西。
	 *
	 * ⇒ **宁可让 `workspace:written` 类型暂时空着**，保持「删 3 处就能拆干净」。
	 *   这是原型期的功能缺口，已报给 lead 决策 —— 要补的时候按上面 2 做。
	 *
	 * ⚠ 别在这里留一行注释掉的 `emit` 假装接了。
	 */

	/**
	 * 沿 `parent` 链向上重算并落库。
	 *
	 * **自动计算绝不产出终结态** —— 候选只来自 `recomputeTargetOf`，
	 * 它只会返回 `AUTO_STATES` 的四个成员之一。
	 */
	const recomputeUpward = async (
		workspaceId: WorkspaceId,
		cardId: string,
	): Promise<readonly Card[]> => {
		const cards = load(workspaceId);
		const steps = recomputeChain(cardId, cards, now());
		const changed: Card[] = [];
		for (const step of steps) {
			await persist(workspaceId, step.card);
			changed.push(step.card);
		}
		return changed;
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
		async ensureAnyWorkspace() {
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
			const visible = withoutDeleted(load(workspaceId));

			/*
			 * `updatedBy` 是**事件维度**：搜索实现算不出（要已读游标）。
			 * ⇒ 在这一层先算 `updates()`，把结果集塞进条件再交给搜索。
			 *
			 * `search` 本身仍是同步的 —— 游标读的是 kv（同步接口），
			 * 所以这里不需要 async。
			 */
			if (condition.updatedBy !== undefined && condition.updatedBy.length > 0) {
				const { ai, user } = computeUpdates(visible, store);
				const wanted = new Set<string>();
				for (const reader of condition.updatedBy) {
					if (reader === 'ai') for (const id of ai) wanted.add(id);
					if (reader === 'user') for (const id of user) wanted.add(id);
				}
				return search(visible, { ...condition, updatedCardIds: [...wanted] });
			}

			return search(visible, condition);
		},

		/* ── 更新计数 ── */
		async updates(workspaceId) {
			return computeUpdates(withoutDeleted(load(workspaceId)), store);
		},
		async markSeen(workspaceId, cardId, reader) {
			const cards = load(workspaceId);
			return markCardSeen(store, findCard(cards, cardId), cardId, reader);
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

		async update(workspaceId, cardId, patch, actor: Actor = 'user') {
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
				history: [...existing.history, { at, action: 'update', actor }],
			};
			await persist(workspaceId, next);
			return { ok: true, card: next };
		},

		async remove(workspaceId, cardId, actor: Actor = 'user') {
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
				history: [...existing.history, { at, action: 'delete', actor }],
			};
			await persist(workspaceId, next);
			return { ok: true, card: next };
		},

		/* ── 状态转移（判定在 protocol，改卡在 transition.ts） ── */

		async adopt(workspaceId, cardId, actor) {
			const cards = load(workspaceId);
			const existing = findCard(cards, cardId);
			if (existing === undefined) {
				return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
			}
			if (existing.deleted) {
				return failure(ErrorCode.CARD_NOT_FOUND, `卡「${cardId}」已被删除。`);
			}

			const result = adoptCard(existing, actor, now());
			if (!result.ok) return result;

			await persist(workspaceId, result.card);
			const recomputed = await recomputeUpward(workspaceId, result.card.id);
			return { ok: true, card: result.card, recomputed };
		},

		async claim(workspaceId, cardId, actor, holder) {
			const cards = load(workspaceId);
			const existing = findCard(cards, cardId);
			if (existing === undefined) {
				return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
			}
			if (existing.deleted) {
				return failure(ErrorCode.CARD_NOT_FOUND, `卡「${cardId}」已被删除。`);
			}

			/*
			 * ## claim 是**权限边界**，不是并发控制（用户 `2026-11-13`）
			 *
			 * > 一次一张要的。因为自动化下。就是工作卡给的权限。这是为了防止越狱。
			 * > 比如编写代码是没有命令行的。跑一边要另外开卡。这也是为了记录流程。
			 * > 而只能一个人领取其实没啥用。那是为了防止两个ai一起做。
			 * > 应该有任何人领取，就是进行中。然后显示有谁拿了。
			 * > 现在不限制一个卡只能被一个拿，应该就没问题了。
			 *
			 * ⇒ 三条准入由 `judgeClaim` 判（类别必须是工作 + 状态 + 配额），
			 *   一张卡可以被**多个人同时持有**。
			 *
			 * `actor` 只影响 history 记谁点的，**不影响任何判定** ——
			 * 用户点按钮是「代 AI 指派」，占的是那个 AI 的配额。
			 */
			const admission = judgeClaim(existing, cards, holder, {
				claimableKinds: needsClaimKinds(),
			});
			if (!admission.ok) {
				return failure(ErrorCode.CLAIM_REJECTED, admission.message, {
					detail: {
						reason: admission.reason,
						...(admission.blockers === undefined ? {} : { blockers: admission.blockers }),
					},
				});
			}

			const result = claimCard(existing, holder, actor, now());
			if (!result.ok) return result;

			await persist(workspaceId, result.card);
			const recomputed = await recomputeUpward(workspaceId, result.card.id);
			return { ok: true, card: result.card, recomputed };
		},

		async release(workspaceId, cardId, actor, holder) {
			const cards = load(workspaceId);
			const existing = findCard(cards, cardId);
			if (existing === undefined) {
				return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
			}
			if (existing.deleted) {
				return failure(ErrorCode.CARD_NOT_FOUND, `卡「${cardId}」已被删除。`);
			}

			/*
			 * 只移除**自己**那一条。列表里还有别人 ⇒ 状态不变；
			 * 空了才回「提交」—— 那由 `releaseCard` 处理。
			 */
			const result = releaseCard(existing, holder, actor, now());
			if (!result.ok) return result;

			await persist(workspaceId, result.card);
			const recomputed = await recomputeUpward(workspaceId, result.card.id);
			return { ok: true, card: result.card, recomputed };
		},

		async transition(workspaceId, cardId, to, trigger) {
			const cards = load(workspaceId);
			const existing = findCard(cards, cardId);
			if (existing === undefined) {
				return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
			}
			if (existing.deleted) {
				return failure(ErrorCode.CARD_NOT_FOUND, `卡「${cardId}」已被删除。`);
			}

			const result = transitionCard(existing, to, trigger, now());
			if (!result.ok) return result;

			await persist(workspaceId, result.card);
			const recomputed = await recomputeUpward(workspaceId, result.card.id);
			return { ok: true, card: result.card, recomputed };
		},

		/** 见 `recomputeUpward` 的内部实现（闭包里那份）。 */
		recomputeUpward,
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

/*
 * ── 广播总线（⚠ 原型期脚手架，整个可删） ──
 *
 * `bus.ts` 的文件头写了拆解步骤。**导出 `createBus` 是为了让入口（dsh / mcp）
 * 能真的造出一个 bus 传给 `createTaskboard({ bus })`** —— 不导出它，入口只能
 * 自己照结构再写一个（dsh 现在就是这么绕的），那正是要避免的「第二份真值」。
 */
export { createBus, type Bus, type TaskboardMessage } from './bus.ts';


/*
 * ── 搜索（core 强依赖） ──
 *
 * 用户裁定：「就强耦合吧」⇒ 搜索不是端口，`TaskboardOptions` 里没有 `search`。
 * 下面导出的是 core 自己的搜索实现及其零件 —— 供 UI / AI 工具直接复用
 * （比如 UI 在客户端本地筛选时用同一套规则，不另写一份）。
 */
export {
	createSearch,
	includesDrafts,
	titleMatches,
	isStatusGroup,
	STATUS_GROUPS,
	DEFAULT_DRAFT_STATE,
	type SearchCondition,
	type SearchOptions,
	type SearchStrategy,
} from './search.ts';

export type { CardStore } from './ports.ts';

export type {
	Card,
	CardId,
	WorkspaceId,
	CardSection,
	CardHolder,
	HistoryEntry,
	RelationEntry,
	Relations,
	TemplateRef,
} from './card.ts';

/** 持有者工具（多人协作）。 */
export { isHeldBy, holderIdsOf, withHolder, withoutHolder } from './card.ts';

/** 更新计数（读游标 + 事件作者）。 */
export {
	computeUpdates,
	lastChangeBy,
	latestEventAt,
	markCardSeen,
	readCursor,
	readCursorKey,
	type UpdateReader,
	type UpdatesResult,
} from './updates.ts';

/** 类别定义（`needsClaim` 由它声明）。 */
export { BUILTIN_KINDS, KindRegistry, type KindDef } from './template/kinds.ts';




