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

import type { Card, CardSection, CardUnread, WorkspaceId } from './card.ts';
import { findCard, withHistory, withoutDeleted } from './card.ts';
/* ⚠ 原型期脚手架，整个文件可删 —— 见 `bus.ts` 顶部的拆解步骤。 */
import type { Bus } from './bus.ts';
import { contentOfCard, parseContentPointer, replaceInContent } from './content-path.ts';
import { transitionAdviceOf, type TransitionAdvice } from './advice.ts';
import { buildCard, type CreateInput, type CreateResult } from './create.ts';
import { createSearch, type SearchCondition } from './search.ts';
import {
	BASE_TOOLS,
	CARD_ACTION_OPTIONS,
	TOOL_GUARD_OPTIONS,
	effectiveToolsOf,
	isBaseTool,
	judgeCardAction as judgeCardActionPure,
	judgeToolCall as judgeToolCallPure,
	type CardActionLevel,
	type CardActionName,
	type CardActionVerdict,
	type ToolCallVerdict,
	type ToolGuardLevel,
	type ToolPolicyDelta,
	type ToolPolicyScopeChange,
	type ToolPolicyScopeInput,
	type ToolPolicyStore,
} from './permission.ts';
import { createSqliteStore } from './storage/sqlite.ts';
import {
	computeUpdates,
	markCardSeen,
	type UpdateReader,
	type UpdatesResult,
} from './updates.ts';
import {
	adoptCard,
	claimCard,
	judgeClaim,
	recomputeChain,
	releaseCard,
	transitionCard,
} from './transition.ts';
import type { CardStore } from './ports.ts';
import { ActionRegistry, BUILTIN_ACTIONS } from './template/actions.ts';
import { DomainRegistry, BUILTIN_DOMAINS } from './template/domains.ts';
import { KindRegistry, BUILTIN_KINDS } from './template/kinds.ts';
import { TemplateRegistry } from './template/registry.ts';
import { ContentSchemaCache } from './template/schema.ts';
import type { TemplateDef, TemplateMeta, TemplateSummary } from './template/types.ts';
import {
	createWorkspace,
	ensureAnyWorkspace,
	getWorkspace,
	listWorkspaces,
	renameWorkspace,
	setArchived,
	type Workspace,
} from './workspace.ts';

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

/**
 * 从不可信的 kv 值里读一份**增量**（`string[]`）。
 *
 * 非数组 / 坏元素 ⇒ 静默降级成空。不能因为一条坏记录让权限系统不可用。
 */
function readDelta(raw: unknown): readonly string[] {
	if (!Array.isArray(raw)) return Object.freeze([]);
	return Object.freeze(raw.filter((one): one is string => typeof one === 'string'));
}

/** 从不可信的 kv 值里读 `name → 增量` 映射。 */
function readDeltaMap(raw: unknown): Record<string, readonly string[]> {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
	const out: Record<string, readonly string[]> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (key === '') continue;
		out[key] = readDelta(value);
	}
	return out;
}

/** 从不可信的 kv 值里读 `name → string[]` 映射（组的成员）。 */
function readStringListMap(raw: unknown): Record<string, readonly string[]> {
	return readDeltaMap(raw);
}

/**
 * 清洗一份增量：去首尾空白、丢空串、去重、冻结。
 *
 * ⚠ **不校验工具名是否存在。** 用户原话：
 *   「只校验工具名字。所以无所谓是否存在」「没注册的工具本来就不会生效」。
 *   core 也不知道 dsh 注册了哪些工具，校验它就是反向依赖。
 */
function cleanDelta(delta: readonly string[]): readonly string[] {
	return Object.freeze([...new Set(delta.map((one) => one.trim()).filter((one) => one !== ''))]);
}

/** 清洗名字（组名 / 模板 ref）。 */
function cleanName(name: string): string {
	return name.trim();
}

/**
 * 把内容路径的首段从「章节 label」归一成「章节 id」。
 *
 * 为什么需要：模型从 `taskboard_definitions` 的模板定义里看到的是
 * `{ id, label }` 两个键；写路径时很可能用 label（人能读的那个）。
 * 卡上存的是 `sections[sectionId]`，所以首段命中 label 时换回 id。
 * 已经是 id 的路径**原样返回**（优先级：id > label，避免歧义）。
 */
function normalizeContentPath(card: Card, segments: readonly string[]): readonly string[] {
	const first = segments[0];
	if (first === undefined) return segments;
	if (card.sections[first] !== undefined) return segments;
	for (const [sectionId, section] of Object.entries(card.sections)) {
		if (section.label === first) return [sectionId, ...segments.slice(1)];
	}
	return segments;
}

/** 空名字的失败。 */
function emptyNameFailure(what: string): Failure {
	return failure(ErrorCode.FIELD_REQUIRED, `${what}不能为空。`, {
		issues: [{ path: '/name', message: '必填' }],
	});
}

/* ────────────────────────── 两条轴的档位 ────────────────────────── */

/** UI 轴默认档位：**默认最严**（用户没配之前不放开领卡）。 */
const DEFAULT_CARD_ACTION_LEVEL: CardActionLevel = 'no-claim';

/** 宿主轴默认档位：**默认不管工具**（用户没配之前任务板不主动限制）。 */
const DEFAULT_TOOL_GUARD_LEVEL: ToolGuardLevel = 'off';

/** kv 键：UI 轴档位。 */
const CARD_ACTION_LEVEL_KEY = 'taskboard.permission.cardActionLevel';

/** kv 键：宿主轴档位。 */
const TOOL_GUARD_LEVEL_KEY = 'taskboard.permission.toolGuardLevel';

/*
 * ⚠ 合法值**从选项常量派生**，不在这里再抄一份 ——
 *   否则「选项表加一档、读取白名单没加」会让新档位永远读成脏值回落默认（静默）。
 */
const CARD_ACTION_LEVELS: readonly CardActionLevel[] = CARD_ACTION_OPTIONS.map((one) => one.value);
const TOOL_GUARD_LEVELS: readonly ToolGuardLevel[] = TOOL_GUARD_OPTIONS.map((one) => one.value);

/**
 * 从不可信的 kv 值里读一个档位。
 *
 * ⚠ **脏值 ⇒ 回落默认 + `console.warn`，不抛错** ——
 *   一条坏记录不该让整个插件挂掉（与 `readDelta` 的静默降级同一取舍，
 *   区别是这里**要留痕**：档位错会影响安全边界，静默回落会掩盖配置问题）。
 */
function readLevel<T extends string>(
	raw: string | undefined,
	choices: readonly T[],
	fallback: T,
	key: string,
): T {
	if (raw === undefined) return fallback;
	for (const choice of choices) if (choice === raw) return choice;
	console.warn(
		`[taskboard3-core] kv「${key}」的值「${raw}」不是合法档位，已回落默认「${fallback}」。`,
	);
	return fallback;
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

	/* ── 更新计数 ── */

	/**
	 * 两类「更新」的卡 id 清单。
	 *
	 * - `ai` —— AI 改过，**用户**还没看过；
	 * - `user` —— 用户改过，**AI** 还没看过。
	 *
	 * ⚠ 未读现在是**卡上的字段**（`Card.unread`），不是从 `history` + kv 游标
	 *   算出来的（用户 `2026-11-13`：「不能再用胶水代码了」）。
	 *   ⇒ 本方法只是「挑出未读的 id」，纯读。
	 */
	updates(workspaceId: WorkspaceId): Promise<UpdatesResult>;
	/**
	 * 标记一张卡被某个读者「看过」—— **写卡**（清 `Card.unread` 的对应一位）。
	 *
	 * | `reader` | 清哪个 | 语义 |
	 * |---|---|---|
	 * | `'user'` | `unread.ai` | 用户读掉了「AI 改过」 |
	 * | `'ai'` | `unread.user` | AI 读掉了「用户改过」 |
	 *
	 * 不清 history（历史是审计记录，读完不代表没发生过）。
	 * 没有变化时不落库、不广播。
	 *
	 * @returns `unread` = 清完之后的那张卡上的标记
	 */
	markSeen(
		workspaceId: WorkspaceId,
		cardId: string,
		reader: UpdateReader,
	): Promise<{ readonly ok: true; readonly unread: CardUnread } | Failure>;

	/* ── 工具权限（模型见 `permission.ts` 顶部） ── */

	/**
	 * 读**完整四档策略**（通用 / 组 / 组成员 / 独立）。
	 *
	 * ⚠ 返回的是**增量**集合，不是生效集。生效集用 `effectiveToolsOf(ref)`。
	 */
	getToolPolicies(): ToolPolicyStore;
	/**
	 * 算一个模板的**生效工具集** = `BASE ∪ common ∪ 命中的组 ∪ 独立档`。
	 *
	 * @returns 去重、稳定顺序（先 BASE 原序，再按档位叠加）
	 */
	effectiveToolsOf(templateRef: string): readonly string[];

	/**
	 * **通用档**：所有工作卡都吃这份增量。
	 *
	 * @param delta 传空数组 = 清掉通用档
	 */
	setCommonPolicy(delta: ToolPolicyDelta): Promise<{ readonly ok: true } | Failure>;
	/**
	 * **组档**：给一个组设增量。组内所有模板都吃。
	 *
	 * ⚠ 组名不存在时自动创建（只是名字，不校验"组是否已存在"）。
	 *   只设策略不设成员 ⇒ 组存在但没人，谁都不生效 —— 合法状态。
	 *
	 * @param groupName 用户起的名字
	 * @param delta 传空数组 = 清掉这个组的增量（组成员保留）
	 */
	setGroupPolicy(groupName: string, delta: ToolPolicyDelta): Promise<{ readonly ok: true } | Failure>;
	/**
	 * **独立档**：只对这一个模板生效。
	 *
	 * ⚠ **保守旧名字**（dsh 已有工具调它），语义从「唯一一档」变成「四档之一」。
	 *
	 * @param templateRef 模板 ref（会校验存在性 —— 这是唯一校验的粒度）
	 * @param delta 传空数组 = 清掉该模板的独立档
	 */
	setTemplatePolicy(
		templateRef: string,
		delta: ToolPolicyDelta,
	): Promise<{ readonly ok: true } | Failure>;

	/**
	 * 设置一个组的**成员**（`templateRef` 列表）。
	 *
	 * ⚠ **不校验模板是否存在** —— 用户「无所谓是否存在」。
	 *   组里有个不存在的模板名只会静默不生效。
	 */
	setGroupMembers(
		groupName: string,
		templates: readonly string[],
	): Promise<{ readonly ok: true } | Failure>;
	/** 删掉一个组（策略 + 成员一起删）。幂等：组不存在也算成功。 */
	removeGroup(groupName: string): Promise<{ readonly ok: true } | Failure>;

	/**
	 * 判定一次工具调用。
	 *
	 * ## ⚠ 调用方**不传档位**
	 *
	 * 两个档位（`cardActionLevel` / `toolGuardLevel`）是任务板的全局状态，
	 * 由实例自己从内存缓存读 —— dsh / MCP 只需要给 `toolName` 和 `heldCards`。
	 * 档位存在与否是 core 的内部实现，调用方不该知道（否则每个入口都要拼一遍）。
	 *
	 * 判定本身在 `permission.ts` 的**纯函数**里（`judgeToolCall`），
	 * 本方法只做「读缓存档位 + 读四档策略 → 交给纯函数」。
	 *
	 * `heldCards` 由 dsh 的 guard 收集后传进来（core 不认识 dsh 的 agent）。
	 */
	judgeToolCall(input: {
		readonly toolName: string;
		readonly heldCards: readonly { readonly templateRef: string }[];
	}): ToolCallVerdict;

	/**
	 * 改**某一个 scope** 的工具权限（tool contract v2，用户 `2026-11-21`）。
	 *
	 * ## 三个 scope
	 *
	 * | scope | 含义 | 存储 |
	 * |---|---|---|
	 * | `{ tier: 'unclaimed' }` | 没持有工作卡时的额外权限 | `unclaimed`（v2 新增） |
	 * | `{ tier: 'claimed' }` | 持有工作卡时的额外权限 | 原 `common` |
	 * | `{ templateRef }` | 某个工作模板的额外权限 | 原 `templates[ref]` |
	 *
	 * ## 增量语义（用户原话）
	 *
	 * > 允许的工具数组（和原有的取并集）、移除的工具数组（和原有的取交集）。
	 *
	 * ⇒ `next = (current ∪ allow) \ (current ∩ remove)`。
	 *   remove 只对**已存在**的名字生效（这就是「取交集」）；不在集合里的记进
	 *   `ignoredRemovals`，不报错（幂等，重复移除同一项不会失败）。
	 *
	 * ## ⚠ 硬底线：`BASE_TOOLS` 不能被移除
	 *
	 * 用户 `2026-11-13` 的裁定（放手永远允许 / 领取后能转态）靠 BASE 是常量保证。
	 * 允许从「未领取档」移除 BASE 工具 = 能让 AI 把自己锁死。
	 * ⇒ BASE 里的名字：`allow` 里出现视为已满足（记 `alreadyBase`），
	 *   `remove` 里出现拒绝执行（记 `protectedRemovals`），**不报错但明确告知**。
	 *
	 * @returns 该 scope 的**新配置**（不含 BASE）+ 生效/忽略明细
	 */
	setToolPolicyScope(input: ToolPolicyScopeInput): Promise<{ readonly ok: true; readonly change: ToolPolicyScopeChange } | Failure>;

	/* ── 两条轴的档位（持久化在 kv，默认 见 permission.ts） ── */

	/** 读 UI 轴档位（用户授权 AI 能不能领卡 / 采纳草稿）。 */
	getCardActionLevel(): CardActionLevel;
	/** 写 UI 轴档位（落 kv，下次启动仍在）。 */
	setCardActionLevel(level: CardActionLevel): Promise<void>;
	/**
	 * 判定一次**领卡类动作**（v2 合并工具后按动作判，不按工具名）。
	 *
	 * `adopt` / `claim` / `release` 三个动作必须过 UI 轴（用户第二轮）：
	 * UI 没打开对应档位 ⇒ 拒绝，并给出「如果用户授意，由用户开哪一档」。
	 *
	 * `release` 永远放行（放手，否则 AI 会被卡锁死）——旧裁定不变。
	 */
	judgeCardAction(action: CardActionName): CardActionVerdict;
	/** 读宿主轴档位（任务板管不管工具调用）。 */
	getToolGuardLevel(): ToolGuardLevel;
	/** 写宿主轴档位（落 kv，下次启动仍在）。 */
	setToolGuardLevel(level: ToolGuardLevel): Promise<void>;

	/* ── 写 ── */
	create(input: CreateInput): Promise<CreateResult>;
	/**
	 * 按 **JSON Pointer 路径**替换卡的内容（tool contract v2）。
	 *
	 * 用户 `2026-11-21`：
	 * > 参数为**一个编号和一个空间，和一个 JSON 路径，一个 JSON object**。
	 * > **JSON 路径之后的全部内容被这个 object 覆盖掉**（替换语义，不是合并）。
	 *
	 * 「内容」= 卡的**模板内 JSON**：`{ [sectionKey]: actionPayload }`（用户裁定）。
	 * ⇒ 这个入口**碰不到** title / status / holders / history / unread / relations，
	 *   所以不存在「用路径绕过状态机或改审计」的通路。
	 *
	 * 步骤：读卡 → 拼路径 → 替换 → **整份内容重新过模板校验** → 落库（走 `withHistory`）。
	 *
	 * @param pointer JSON Pointer（`''` = 替换整个内容对象；`-` = 数组末尾追加）
	 * @param value 替换值
	 * @param actor 谁改的（AI 工具传 `'ai'`）
	 * @returns 更新后的卡 + 合并后的完整内容（工具层直接回给模型）
	 */
	replaceContentAt(
		workspaceId: WorkspaceId,
		cardId: string,
		pointer: string,
		value: unknown,
		actor?: Actor,
	): Promise<{ readonly ok: true; readonly card: Card; readonly content: Readonly<Record<string, unknown>> } | Failure>;
	/**
	 * 改标题 / 备注 / 章节（整体替换，不是增量合并）。
	 */
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

	/**
	 * 采纳：草稿 → 按类别进「提交」或「需要授权」；同时写 `adoptedAt`。
	 *
	 * ## `allowAiAdopt` —— 「自动工作」模式的唯一差异
	 *
	 * 用户 `2026-11-14`：「自动工作和工作的区别就是 ai 自己采纳草稿。」
	 *
	 * | 情况 | 结果 |
	 * |---|---|
	 * | `actor === 'user'` | 照常放行（不管 `options`） |
	 * | `actor === 'ai'` + `allowAiAdopt !== true` | 拒绝（`AI_CANNOT_ADOPT`） |
	 * | `actor === 'ai'` + `allowAiAdopt === true` | 放行（`cardLevel === 'adopt'`） |
	 *
	 * ⚠ **`allowAiAdopt` 由调用方按当前档位传**（`dsh` 侧：`{ allowAiAdopt: cardLevel === 'adopt' }`）。
	 *   core 不认识「档位」，只认识这一个开关 —— 否则要把 `CardActionLevel` 灌进 core 的每个方法。
	 *
	 * ⚠ **`protocol` 的 `BUTTON_ACTIONS` 不改**：那张表是「谁可以点哪个按钮」的全局真值，
	 *   在这里放开 AI 会让**所有场景**都允许 AI 采纳（包括未允许采纳草稿的档位）。
	 */
	adopt(
		workspaceId: WorkspaceId,
		cardId: string,
		actor: Actor,
		options?: { readonly allowAiAdopt?: boolean },
	): Promise<StatusWriteResult>;
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
	/**
	 * 「接下来能去哪」—— **读**，不改任何东西（tool contract v2）。
	 *
	 * 用户 `2026-11-21`：
	 * > 目标字符串为空时，展示接下来可转移的目标和条件目标。
	 *
	 * 每个目标带：动作（采纳/领取/释放/普通转移）、AI 能不能做、
	 * 现在能不能执行、不能执行的具体原因与卡死的卡（依赖 / 子任务 / 配额）。
	 *
	 * @param holder 当前调用者（判领取/释放准入用；省略 = 没有身份）
	 */
	transitionAdvice(workspaceId: WorkspaceId, cardId: string, holder?: string): TransitionAdvice | Failure;

	/* ── 模板 / 类别 / 领域 / action 注册面 ── */
	templates(): TemplateRegistry;
	kinds(): KindRegistry;
	domains(): DomainRegistry;
	actions(): ActionRegistry;
	listTemplates(): readonly TemplateSummary[];
	templateMeta(ref: string): TemplateMeta | undefined;
	/** 上一次目录加载的错误。 */
	templateErrors(): readonly { readonly file: string; readonly message: string }[];
	/**
	 * 所有模板**实际用到**的 action type（去重 + 排序）。
	 *
	 * ## 为什么需要这个
	 *
	 * 用户 `2026-11-18`：
	 * > 「core看着模板，说我这里需要什么什么……
	 * >  ui在和core接通的时候，core就看ui给的注册。如果没有对应的，就进行警告。」
	 *
	 * 现有 `listTemplates()` 返回的 `TemplateSummary` **不含 sections**
	 * ⇒ 客户端拿不到「模板需要哪些 action」。这个方法补上那一半。
	 *
	 * ⚠ 是「**模板用到的**」，不是「`BUILTIN_ACTIONS` 里的」：
	 *   某个 action 可能暂时没有模板用 —— 那种情况不需要渲染器，
	 *   不该进 ① 的比对集合（否则会对 UI 喊「你缺一个没人用的渲染器」）。
	 */
	requiredActions(): readonly string[];

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

	/* ── 工具权限的状态（见 `permission.ts`） ── */

	/**
	 * kv 里的键：**四档策略**（一张表存全部，改动频率极低）。
	 *
	 * ## ⚠ v1 → v2 不迁移
	 *
	 * `v1` 是旧的 `{ [templateRef]: extra }` 平铺结构。新结构是
	 * `{ common, groups, groupMembers, templates }` —— 形状完全不同。
	 *
	 * 用户说过旧数据不需要迁移 ⇒ **直接换键，旧值不读也不删**
	 * （留着不碍事；真要清，`kvSet('toolPolicy:v1', undefined)` 一行）。
	 */
	const TOOL_POLICY_KEY = 'toolPolicy:v2';

	/**
	 * 策略缓存 —— **初值从 kv 读一次**，之后写入时同步更新 + 整体写回。
	 *
	 * 为什么缓存：`judgeToolCall` 每次工具调用都要读它，而它是同步纯判定；
	 * 每次去 `kvGet` + `JSON.parse` 不值得。
	 *
	 * ⚠ 缓存是**可变的**（`common` / `groups` 等字段会被赋值）——
	 *   因为 `setCommonPolicy` 这类方法是"改一个档位再整体写回"。
	 *   对外 `getToolPolicies()` 返回的是**浅拷贝**，防止调用方改到缓存。
	 */
	const toolPolicies: {
		unclaimed: readonly string[];
		common: readonly string[];
		groups: Record<string, readonly string[]>;
		groupMembers: Record<string, readonly string[]>;
		templates: Record<string, readonly string[]>;
	} = (() => {
		const raw = store.kvGet(TOOL_POLICY_KEY);
		const empty = {
			unclaimed: [] as readonly string[],
			common: [] as readonly string[],
			groups: {},
			groupMembers: {},
			templates: {},
		};
		if (raw === undefined) return empty;
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return empty;

			const source = parsed as Record<string, unknown>;
			return {
				/*
				 * v2 新增字段：旧 kv（v1/v2 早期）里没有它 ⇒ 读成空增量。
				 * 不升 key 版本：同一个 JSON 加字段向后兼容，升版本反而要迁移。
				 */
				unclaimed: readDelta(source['unclaimed']),
				common: readDelta(source['common']),
				groups: readDeltaMap(source['groups']),
				groupMembers: readStringListMap(source['groupMembers']),
				templates: readDeltaMap(source['templates']),
			};
		} catch {
			/* 整个值坏掉 ⇒ 回到空策略（不能因为一条坏记录让权限系统不可用）。 */
			return empty;
		}
	})();

	/** 把策略表整体写回 kv（原子覆盖，不做单条更新）。 */
	const saveToolPolicies = async (): Promise<void> => {
		await store.kvSet(TOOL_POLICY_KEY, JSON.stringify(toolPolicies));
	};

	/*
	 * ── 两条正交轴的档位缓存 ──
	 *
	 * 与 `toolPolicies` 同一个模式：**初值从 kv 读一次**，写入时同步更新缓存 + 写回。
	 *
	 * 缓存理由同上：`judgeToolCall` 每次工具调用都要同步判定，不能每次 `kvGet`。
	 *
	 * ⚠ 与四档策略**分开存两个键** —— 它们是两件正交的事：
	 *   档位 = 「用户/宿主授权到哪一档」，四档策略 = 「每张卡授予哪些工具」。
	 *   混在一个 JSON 里，改档位会连带重写策略表，写放大且容易互相踩。
	 */
	let cardActionLevel: CardActionLevel = readLevel(
		store.kvGet(CARD_ACTION_LEVEL_KEY),
		CARD_ACTION_LEVELS,
		DEFAULT_CARD_ACTION_LEVEL,
		CARD_ACTION_LEVEL_KEY,
	);
	let toolGuardLevel: ToolGuardLevel = readLevel(
		store.kvGet(TOOL_GUARD_LEVEL_KEY),
		TOOL_GUARD_LEVELS,
		DEFAULT_TOOL_GUARD_LEVEL,
		TOOL_GUARD_LEVEL_KEY,
	);

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

	/*
	 * ── 工作空间变更**不广播** ──
	 *
	 * 工作空间 CRUD 写的是 `store.kvSet`（见 `workspace.ts` 的 `writeAll`），
	 * **不经过 `persist`**（那是写卡专用）。
	 *
	 * 早期 `TaskboardMessage.type` 里有一个 `'workspace:written'` 成员，
	 * 但**没有任何路径会发出它** —— 消费方写了处理分支也永远收不到。
	 * 已删掉那个类型成员（`2026-11-15` 清理），只留 `'card:written'`。
	 *
	 * ⇒ 要补空间广播，先给这里加一个收口函数，再往 `TaskboardMessage.type` 里加成员。
	 *   在当前（原型期）不需要：UI 改空间后自己重拉即可。
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
			 * `updatedBy` 是**未读维度**。未读现在是卡上的字段 ⇒ 纯读取，
			 * 不碰存储、不需要 async。
			 */
			if (condition.updatedBy !== undefined && condition.updatedBy.length > 0) {
				const { ai, user } = computeUpdates(visible);
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
			return computeUpdates(withoutDeleted(load(workspaceId)));
		},
		async markSeen(workspaceId, cardId, reader) {
			const cards = load(workspaceId);
			const result = markCardSeen(findCard(cards, cardId), cardId, reader);
			if (!result.ok) return result;

			/*
			 * 没有变化 ⇒ 不落库、不广播。
			 * 这不是优化，是语义：重复「我已经看过了」不该产生一次写事件
			 * （否则别人的「用户改过、AI 未读」角标会被无谓的事件搅动）。
			 */
			if (result.changed) await persist(workspaceId, result.card);

			return { ok: true, unread: result.card.unread };
		},

		/* ── 工具权限（模型见 permission.ts 顶部） ── */

		getToolPolicies() {
			return toolPolicies;
		},

		effectiveToolsOf(templateRef) {
			return effectiveToolsOf(toolPolicies, templateRef);
		},

		async setCommonPolicy(delta) {
			toolPolicies.common = cleanDelta(delta);
			await saveToolPolicies();
			return { ok: true };
		},

		async setGroupPolicy(groupName, delta) {
			const name = cleanName(groupName);
			if (name === '') return emptyNameFailure('组名');

			toolPolicies.groups[name] = cleanDelta(delta);
			/*
			 * 只设策略不设成员时，组存在但没有成员 ⇒ 谁都不生效。
			 * 那是合法状态（用户刚建组还没拉人），不是错误。
			 */
			await saveToolPolicies();
			return { ok: true };
		},

		async setTemplatePolicy(templateRef, delta) {
			const ref = templateRef.trim();
			if (ref === '') {
				return failure(ErrorCode.FIELD_REQUIRED, '模板 ref 不能为空。', {
					issues: [{ path: '/templateRef', message: '必填' }],
				});
			}

			/*
			 * 模板不存在 ⇒ 拒。这是**唯一**的校验 —— 工具名不校验
			 * （用户：「无所谓是否存在」「没注册的工具本来就不会生效」）。
			 * core 也不知道 dsh 有哪些工具，校验它就是反向依赖。
			 */
			if (!templates.has(ref)) {
				return failure(ErrorCode.TEMPLATE_NOT_FOUND, `模板「${ref}」不存在。`, {
					detail: { templateRef: ref },
				});
			}

			toolPolicies.templates[ref] = cleanDelta(delta);
			await saveToolPolicies();
			return { ok: true };
		},

		async setToolPolicyScope(input) {
			const hasTier = input.tier !== undefined;
			const hasTemplate = input.templateRef !== undefined;
			if (hasTier === hasTemplate) {
				return failure(ErrorCode.FIELD_REQUIRED, 'tier 与 templateRef 必须二选一（正好给一个）。', {
					issues: [{ path: '/tier', message: '与 /templateRef 二选一' }],
				});
			}

			/* ── 1. 定位 scope 与当前配置 ── */
			let scope: 'unclaimed' | 'claimed' | 'template';
			let templateRef: string | undefined;
			let current: readonly string[];
			if (hasTier) {
				if (input.tier === 'unclaimed') {
					scope = 'unclaimed';
					current = toolPolicies.unclaimed;
				} else if (input.tier === 'claimed') {
					scope = 'claimed';
					current = toolPolicies.common;
				} else {
					return failure(ErrorCode.FIELD_REQUIRED, `tier 只能是 unclaimed / claimed；收到「${String(input.tier)}」。`, {
						issues: [{ path: '/tier', message: 'unclaimed | claimed' }],
					});
				}
			} else {
				const ref = (input.templateRef ?? '').trim();
				if (ref === '') {
					return failure(ErrorCode.FIELD_REQUIRED, 'templateRef 不能为空。', {
						issues: [{ path: '/templateRef', message: '必填' }],
					});
				}
				if (!templates.has(ref)) {
					return failure(ErrorCode.TEMPLATE_NOT_FOUND, `模板「${ref}」不存在。`, { detail: { templateRef: ref } });
				}
				scope = 'template';
				templateRef = ref;
				current = toolPolicies.templates[ref] ?? [];
			}

			/* ── 2. 增量运算：next = (current ∪ allow) \ (current ∩ remove) ── */
			const requestedAllow = cleanDelta(input.allow ?? []);
			const requestedRemove = cleanDelta(input.remove ?? []);

			/*
			 * ⚠ BASE 硬底线：allow 里出现 BASE 名字 ⇒ 本来就恒可用（记 alreadyBase）；
			 *   remove 里出现 BASE 名字 ⇒ 拒绝移除（记 protectedRemovals）。
			 *   **不报错**，但把「你这条操作没生效」明确回给调用方，避免静默。
			 */
			const alreadyBase = requestedAllow.filter((name) => isBaseTool(name));
			const protectedRemovals = requestedRemove.filter((name) => isBaseTool(name));
			const allow = requestedAllow.filter((name) => !isBaseTool(name));
			const remove = requestedRemove.filter((name) => !isBaseTool(name));

			const present = new Set(current);
			const next: string[] = [...current];
			const added: string[] = [];
			for (const name of allow) {
				if (present.has(name)) continue;
				present.add(name);
				next.push(name);
				added.push(name);
			}
			const removed: string[] = [];
			const ignoredRemovals: string[] = [];
			for (const name of remove) {
				if (!present.has(name)) {
					ignoredRemovals.push(name);
					continue;
				}
				present.delete(name);
				removed.push(name);
			}
			/* 同时出现在 allow / remove 里的名字：remove 优先（上面的循环顺序保证）。 */
			const configured: readonly string[] = Object.freeze(next.filter((name) => present.has(name)));

			/* ── 3. 落库 ── */
			if (scope === 'unclaimed') toolPolicies.unclaimed = configured;
			else if (scope === 'claimed') toolPolicies.common = configured;
			else if (templateRef !== undefined) toolPolicies.templates[templateRef] = configured;
			await saveToolPolicies();

			return {
				ok: true,
				change: {
					scope,
					...(templateRef === undefined ? {} : { templateRef }),
					configured,
					added: Object.freeze(added),
					removed: Object.freeze(removed),
					ignoredRemovals: Object.freeze(ignoredRemovals),
					protectedRemovals: Object.freeze(protectedRemovals),
					alreadyBase: Object.freeze(alreadyBase),
				},
			};
		},

		async setGroupMembers(groupName, members) {
			const name = cleanName(groupName);
			if (name === '') return emptyNameFailure('组名');

			/*
			 * ⚠ **不校验模板是否存在** —— 用户「无所谓是否存在」。
			 *   组里有个不存在的模板名只会静默不生效（`effectiveToolsOf` 按
			 *   `member` 匹配，那个 ref 永远不会被任何卡命中）。
			 *   校验它反而会在"模板暂时卸载"时拒掉一次合理的批量设置。
			 */
			toolPolicies.groupMembers[name] = Object.freeze(
				[...new Set(members.map((one) => one.trim()).filter((one) => one !== ''))],
			);
			await saveToolPolicies();
			return { ok: true };
		},

		async removeGroup(groupName) {
			const name = cleanName(groupName);
			if (name === '') return emptyNameFailure('组名');

			/* 组名不存在不算错误 —— 幂等删除。 */
			delete toolPolicies.groups[name];
			delete toolPolicies.groupMembers[name];
			await saveToolPolicies();
			return { ok: true };
		},

		/* ── 两条轴的档位 ── */

		getCardActionLevel() {
			return cardActionLevel;
		},

		async setCardActionLevel(level) {
			cardActionLevel = level;
			await store.kvSet(CARD_ACTION_LEVEL_KEY, level);
		},

		judgeCardAction(action) {
			/* 档位从缓存读（与 `judgeToolCall` 同一取舍：调用方不该拼档位）。 */
			return judgeCardActionPure({ action, cardLevel: cardActionLevel });
		},

		getToolGuardLevel() {
			return toolGuardLevel;
		},

		async setToolGuardLevel(level) {
			toolGuardLevel = level;
			await store.kvSet(TOOL_GUARD_LEVEL_KEY, level);
		},

		judgeToolCall(input) {
			/*
			 * 档位从缓存读，不让调用方传 —— 调用方（dsh / MCP）只需要知道
			 * 工具名和持有卡；档位是任务板的全局状态。
			 */
			return judgeToolCallPure(
				{
					cardLevel: cardActionLevel,
					toolLevel: toolGuardLevel,
					toolName: input.toolName,
					heldCards: input.heldCards,
				},
				{ policies: toolPolicies },
			);
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
			return {
				ok: true,
				card: built.card,
				...(built.warnings === undefined ? {} : { warnings: built.warnings }),
			};
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
			/*
			 * ⚠ **不直接写 `history:`** —— 那会绕过 `withHistory` 里的 `unread` 维护，
			 * 让未读标记漂掉（不报错，只表现为角标偶尔不对）。
			 */
			const next = withHistory(
				{ ...existing, title, sections, note: patch.note ?? existing.note },
				{ at, action: 'update', actor },
			);
			await persist(workspaceId, next);
			return { ok: true, card: next };
		},

		async replaceContentAt(workspaceId, cardId, pointer, value, actor: Actor = 'user') {
			const cards = load(workspaceId);
			const existing = findCard(cards, cardId);
			if (existing === undefined) {
				return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
			}
			if (existing.deleted) {
				return failure(ErrorCode.CARD_NOT_FOUND, `卡「${cardId}」已被删除。`);
			}

			/* ── 1. 解析路径（JSON Pointer；允许省略开头 `/`） ── */
			const parsed = parseContentPointer(pointer);
			if (!parsed.ok) {
				return failure(ErrorCode.FIELD_REQUIRED, parsed.message, {
					issues: [{ path: '/path', message: '不是合法的 JSON 路径' }],
				});
			}

			/* ── 2. 首段允许用章节 label（模型从定义里拿到的是 label；卡上存的是 id） ── */
			const segments = normalizeContentPath(existing, parsed.segments);

			/* ── 3. 在「模板内 JSON」上做替换 ── */
			const current = contentOfCard(existing);
			const replaced = replaceInContent(current, segments, value);
			if (!replaced.ok) {
				return failure(ErrorCode.CONTENT_INVALID, replaced.message, {
					issues: [{ path: '/path', message: '路径指向的位置不可替换' }],
				});
			}

			/* ── 4. 整份内容重新过模板校验（替换语义下这是唯一的安全网） ── */
			const validated = schemas.validate(existing.template.ref, replaced.next);
			if (!validated.ok) return validated;

			const sections: Record<string, CardSection> = {};
			const template = templates.get(existing.template.ref);
			if (template !== undefined) {
				for (const section of template.sections) {
					const payload = validated.payloads.get(section.id);
					if (payload === undefined) continue;
					sections[section.id] = { label: section.label, payload };
				}
			}

			const at = now();
			/* 同 `update`：走 `withHistory` 这条唯一 funnel，不手写 history/unread。 */
			const next = withHistory({ ...existing, sections }, { at, action: 'update', actor });
			await persist(workspaceId, next);

			return { ok: true, card: next, content: contentOfCard(next) };
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
			/* 同上：走 `withHistory`，不手写 `history`。 */
			const next = withHistory({ ...existing, deleted: true }, { at, action: 'delete', actor });
			await persist(workspaceId, next);
			return { ok: true, card: next };
		},

		/* ── 状态转移（判定在 protocol，改卡在 transition.ts） ── */

		async adopt(workspaceId, cardId, actor, options) {
			const cards = load(workspaceId);
			const existing = findCard(cards, cardId);
			if (existing === undefined) {
				return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
			}
			if (existing.deleted) {
				return failure(ErrorCode.CARD_NOT_FOUND, `卡「${cardId}」已被删除。`);
			}

			const result = adoptCard(existing, actor, now(), options);
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

		transitionAdvice(workspaceId, cardId, holder = '') {
			const cards = load(workspaceId);
			const existing = findCard(cards, cardId);
			if (existing === undefined) {
				return failure(ErrorCode.CARD_NOT_FOUND, `编号「${cardId}」不存在。`);
			}
			if (existing.deleted) {
				return failure(ErrorCode.CARD_NOT_FOUND, `卡「${cardId}」已被删除，无法转移。`);
			}
			return transitionAdviceOf(existing, cards, {
				claimableKinds: needsClaimKinds(),
				holder,
				cardLevel: cardActionLevel,
			});
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
		requiredActions() {
			/*
			 * 从**全部已加载模板**收集 sections[].action。
			 *
			 * ⚠ 加载出错的文件不在 `templates.list()` 里（注册表只放成功的），
			 *   所以「能用几个算几个」是自然结果，不需要额外处理。
			 * ⚠ 去重后排序：输出稳定，方便和 UI 的注册清单逐行 diff。
			 */
			const types = new Set<string>();
			for (const template of templates.list()) {
				for (const section of template.sections) types.add(section.action);
			}
			return [...types].sort();
		},

		async close() {
			schemas.stop();
			await store.close();
		},
	};
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

/** 「模板内 JSON」投影（tool contract v2：`{ [sectionKey]: actionPayload }`）。 */
export { contentOfCard } from './content-path.ts';

/** 建卡入参（AI 工具层要构造它；公开面的一部分）。 */
export type { CreateInput, CreateOrigin, CreateResult } from './create.ts';

/** 状态转移建议（「接下来能去哪 + 条件目标」，tool contract v2）。 */
export {
	transitionAdviceOf,
	type TransitionAction,
	type TransitionAdvice,
	type TransitionAdviceOptions,
	type TransitionBlocker,
	type TransitionCondition,
	type TransitionTargetAdvice,
} from './advice.ts';

/** 按钮 `method` 判据（「这次转移是不是采纳」；HTTP 用户按钮用，v1 在 dsh/actions.ts）。 */
export { adoptTargetOf, isAdoptTransition } from './actions.ts';

/** 工具权限（BASE 常量 + 四档增量 + 两条正交轴 + 纯判定）。 */
export {
	BASE_TOOLS,
	POLICY_TOOLS,
	EXECUTION_TOOLS,
	READONLY_TOOLS,
	EMPTY_POLICY_STORE,
	CARD_ACTION_OPTIONS,
	TOOL_GUARD_OPTIONS,
	judgeCardAction,
	judgeToolCall,
	isBaseTool,
	isPolicyTool,
	effectiveToolsOf,
	extrasOf,
	type CardActionAllowed,
	type CardActionDenied,
	type CardActionLevel,
	type CardActionName,
	type CardActionVerdict,
	type PermissionFacts,
	type ToolCallJudgement,
	type ToolCallVerdict,
	type ToolGuardLevel,
	type ToolPolicyDelta,
	type ToolPolicyGroup,
	type ToolPolicyScopeChange,
	type ToolPolicyScopeInput,
	type ToolPolicyStore,
} from './permission.ts';

/** 未读工具（卡上的字段 + 维护它的纯函数）。 */
export {
	UNREAD_NONE,
	clearedUnread,
	unreadAfter,
	type CardUnread,
} from './card.ts';

/** 更新计数（未读是卡的字段，这里只做挑选）。 */
export {
	computeUpdates,
	markCardSeen,
	type UpdateReader,
	type UpdatesResult,
} from './updates.ts';

/** 类别定义（`needsClaim` 由它声明）。 */
export { BUILTIN_KINDS, KindRegistry, type KindDef } from './template/kinds.ts';

/* ── 渲染注册表（core 侧：只比对字符串 / 只算描述，零 React）──
 *
 * 用户 `2026-11-18`：「core看着模板，说我这里需要什么什么……
 * ui在和core接通的时候，core就看ui给的注册。如果没有对应的，就进行警告。
 * ui真用了，而没有注册的时候，就报错。并core提供备用的渲染器：直接渲染只读的格式化json。」
 *
 * ⚠ 这两个是**纯函数**，能不能单测是设计的一部分 —— 所以它们不写日志、不抛。
 */
export {
	missingRenderers,
	jsonPreviewOf,
	JSON_PREVIEW_MAX_ITEMS,
	JSON_PREVIEW_MAX_DEPTH,
	JSON_PREVIEW_MAX_STRING,
	type JsonPreview,
} from './render/registry.ts';
