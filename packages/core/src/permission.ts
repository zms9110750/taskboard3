/**
 * 工具权限 —— **领取工作卡才授予执行能力**。
 *
 * ---
 * ## 用户裁定（`2026-11-13`，这是设计依据不是讨论项）
 *
 * > 权限的粒度要改。因为语义是**领取了工作，才有权限**。
 * > 而其他的就是在没有权限也能做的事情。
 * > 目标，设计，记录，根本不可能领取。所以应该是**给每个工作一个工具权限设置**。
 * > 其他所有模板，**共用一种未领取时的权限**。
 *
 * > 只校验工具名字。所以无所谓是否存在。**只对匹配的进行拦截和放出**。
 * > 因为本来就是有工具调用的时候才生效。**没注册的工具本来就不会生效。**
 *
 * ## BASE 只留 11 个任务板工具（`2026-11-14` 裁定）
 *
 * 用户给的两条排除判据：
 *
 * > **无法对工作区进行文件改动。无法获得不知道的信息。**
 *
 * > 因此，todo，是对用户目录的写，不算。todo，也是自己创造信息。不算。
 *
 * 排除 `read_file` 的具体理由：
 *
 * > 因为有可能用户质问的时候，就说"我先看看工作区"。然后没看到，就继续看，穷举了。
 * > 不回答质问。然后就自己决定方向去了。
 *
 * ⇒ **读文件不是中立行为，它给了 AI 逃避回答的借口。**
 *   读 / 看 / 搜这件事本身就是「获得不知道的信息」——
 *   而「不知道」正是该去**问用户**或**开调研卡**的状态，不是该自己去找答案。
 *
 * 所以 BASE 里**一个只读工具都没有**。要读文件？先领一张工作卡，
 * 由那张卡的策略授予（设计卡不给，因为有个叫「调研」的工作卡专门干这个）。
 *
 * ## 权限模型：四档并集
 *
 * ```
 * effective(templateRef) =
 *     BASE_TOOLS
 *   ∪ unclaimed                      ← 未领取：没有工作卡时也生效
 *   ∪ common                         ← 通用：所有工作卡都生效
 *   ∪ ⋃{ toolsOf(g) | ref ∈ groupMembers[g] }  ← 组：批量设置
 *   ∪ templates[ref]                 ← 独立：只对该模板
 * ```
 *
 * `toolsOf(g)` 的**来源有两种**（issue #66）：
 *
 * | 情况 | 组的工具集 |
 * |---|---|
 * | 有图（`graph.groups` 非空） | **图上的包含闭包**（直接含 ∪ 被含组，递归） |
 * | 无图（旧数据 / 从没建过图） | `store.groups[g]` 的增量（旧行为，原样保留） |
 *
 * ⇒ 并集语义**一点没变**，变的只是「组的工具集从哪来」。旧数据没有
 *   `toolGraph:v1` 键 ⇒ 走第二行，一个字都不受影响。
 *
 * ## 「组」不是特殊机制，就是批量设置
 *
 * 用户原话：
 *
 * > 组，用户自己手动拉一骡子放一起。相当于说**批量设置权限**。并不特别。
 *
 * ⇒ 组只是一个**命名的 templateRef 集合**。给它设一次策略，集合内都生效。
 *   它不参与判定优先级、不覆盖独立档 —— 四档全是**增量**，并集。
 *
 * ## 两套权限，**归属不同**（`2026-11-23` 用户裁决：宿主轴搬出 core）
 *
 * 用户原话：
 *
 * > 「而且我说了。权限，一个在core的ui里面。一个在agentui里面，
 * >   core完全不知道也不干涉agent的那一侧的注入权限。说白了，这个组件视图就不对。」
 *
 * | 归属 | 类型 | 取值 | 谁定 | 在哪 |
 * |---|---|---|---|---|
 * | UI 权限 | `CardActionLevel` | `no-claim` / `claim` / `adopt` | 用户 | **本文件** |
 * | agent 侧权限 | `ToolGuardLevel` | `off` / `manage` / `manage-edit` | 实现者（注入 agent 时） | **`@taskboard/dsh-tools`**（`tool-guard.ts`） |
 *
 * ⇒ 本文件**只**判定「用户授权 AI 做什么任务板动作」这一侧。
 *   「任务板这个 mod 管不管 agent 的工具调用」是 agent 连接器的权限，
 *   没有 `ctx.tools.guard` 就没有它 —— 所以它不能住在 core。
 *
 * 正交语义仍然成立，只是**两段分居两个包**：
 *
 * - 领卡类动作（`claim` / `release` / `adopt`）只看 UI 档位 ⇒ **本文件**
 *   （`judgeCardAction`）；agent 侧判定跑在 `dsh-tools` 里，第一段永远先跑且
 *   完全不看 agent 侧档位。
 * - 其它工具（含 `BASE_TOOLS` / `POLICY_TOOLS` / 卡的增量）只看 agent 侧档位
 *   ⇒ **`@taskboard/dsh-tools`** 的 `judgeToolCall`。
 *
 * ⚠ 第一段在第二段之前是**规则**，不是实现细节：
 * agent 侧把档位设成 `off`（「任务板不管理工具」）时，`claim` 仍然要受
 * UI 档位管 —— 领卡是任务板的业务规则，不管理工具不等于替用户授权领卡。
 * 反过来，agent 侧 `manage-edit` 也不会让 `no-claim` 档能领卡。
 * （实现上：`dsh-tools` 的 `judgeToolCall` 把第一段抄在自己文件里并**先跑**。）
 *
 * ## 三条结构性决定
 *
 * | 决定 | 实现 |
 * |---|---|
 * | ① 工作权限必须是 BASE 的**超集** | 四档都是增量列表，生效永远 `= BASE ∪ …` ⇒ 结构上漏不掉 BASE |
 * | ② 基础策略是**常量**，不落库、不可配置 | `BASE_TOOLS` 是 `Object.freeze` 的常量，不进 kv、没有 setter |
 * | ③ 档位权限编辑**只由宿主轴**决定 | 只有 `toolLevel === 'manage-edit'` 才放行 `POLICY_TOOLS` |
 *
 * ## 为什么决定 ① 必须由结构保证而不是配置
 *
 * 如果工作策略是平铺列表，可能被配成不含 `taskboard_*` ⇒
 * AI 领了工作卡却**无法 transition / release** ⇒ **永久卡在「处理中」**，
 * 而那张卡又占着「一次一张」配额 ⇒ **AI 彻底锁死**。
 * 那不是"权限收紧了"，是把 AI 关在门外。
 *
 * ## 这个文件是纯的
 *
 * 不读存储、不知 dsh、不做 I/O。策略与档位由调用方（`index.ts` / dsh 的 guard）
 * 通过参数传进来 —— 所以它是可穷举测试的纯函数。
 * ---
 */

import type { ToolGraphDoc } from './tool-graph-doc.ts';
import { groupToolClosure, hasToolGraph } from './tool-graph-doc.ts';

/*
 * ⚠ 清单先写成**裸字面量 + `as const`**，再导出 widened 版本。
 *
 * 如果直接写 `export const BASE_TOOLS: readonly string[] = [...]`，
 * 元素类型被 widen 成 `string` ⇒ 下面「`POLICY_TOOLS` 与 `BASE_TOOLS` 不相交」
 * 这类编译期断言拿到的是 `string`，**永远判不出来**（静默失效）。
 */
const BASE_TOOL_NAMES = [
	'taskboard_workspaces',
	'taskboard_cards',
	'taskboard_card',
	'taskboard_raw_card',
	'taskboard_definitions',
	'taskboard_create',
	'taskboard_update',
	'taskboard_update_note',
	'taskboard_transition',
] as const;

/**
 * **基础策略** —— 未持有任何工作卡时的可用工具。
 *
 * ## ⚠ 这是常量，不可配置、不落库
 *
 * 它是**安全基线**。可配置就可能被配成「什么都不给」⇒ 任务板工具都用不了
 * ⇒ AI 无法工作（连建卡、改状态都做不了）。
 *
 * ## 恰好 9 个，全部是 `taskboard_*`（tool contract v2 的工具名）
 *
 * `2026-11-22` dsh 迁移到 v2 后，任务板工具名从 16 个旧名收敛成 10 个：
 * 这里列 9 个（除 #9 权限工具外的全部）—— 权限工具在 `POLICY_TOOLS`，
 * 只能由宿主轴 `manage-edit` 放行，绝不能进 BASE。
 *
 * 判据（用户原话）：
 *
 * > **无法对工作区进行文件改动。无法获得不知道的信息。**
 *
 * ⇒ 不含任何只读工具（`read_file` / `glob` / `grep` / `web_search` / `web_fetch`）
 *   也不含 `todo_write`（对用户目录的写 + 自己创造信息）。
 *
 * 为什么连 `read_file` 都不给 —— 用户：
 *
 * > 因为有可能用户质问的时候，就说"我先看看工作区"。然后没看到，就继续看，
 * > 穷举了。不回答质问。然后就自己决定方向去了。
 *
 * ⇒ **读文件会变成 AI 逃避回答的借口。** 「不知道」应该是去问、或开调研卡。
 */
export const BASE_TOOLS: readonly string[] = Object.freeze(BASE_TOOL_NAMES);

/** 权限管理工具的名字（裸字面量，供编译期断言使用）。 */
const POLICY_TOOL_NAMES = ['taskboard_tool_policy'] as const;

/**
 * **权限管理工具** —— 只有宿主轴 `toolLevel === 'manage-edit'` 时才可用，
 * 且**永不在 `BASE_TOOLS` 里**。
 *
 * ## 为什么单独一组
 *
 * 用户：「要想办法在开启一个极高权限后，ai 可以自己去编辑一个模板对应的权限。」
 *
 * ⇒ 这批工具能**改写权限本身**，等于「能给自己发权限」。它必须：
 *
 * 1. **不在 BASE 里** —— 否则任何没领卡的 AI 都能改权限，安全基线就没了；
 * 2. **不在任何档位的增量里生效**（结构上：`judgeToolCall` 第二段最先判它们，
 *    早于 BASE / 四档）⇒ 不可能通过领一张卡获得；
 * 3. **只由宿主轴 `manage-edit` 放行** —— 用户把宿主档位调到那一档才允许。
 *
 * ## v2 只剩一个工具
 *
 * | 工具 | 作用 |
 * |---|---|
 * | `taskboard_tool_policy` | 改三 scope 的工具权限（`tier` / `templateRef` + allow/remove） |
 *
 * ⚠ **工具名必须与 dsh 注册的名字逐字一致** —— core 只认字符串；
 *   v1 的四个 `taskboard_tool_policy*` 名字已随 v1 工具删除。
 */
export const POLICY_TOOLS: readonly string[] = Object.freeze(POLICY_TOOL_NAMES);

/** 执行类工具的名字（裸字面量，供编译期断言使用）。 */
const EXECUTION_TOOL_NAMES = [
	'bash',
	'pwsh',
	'write',
	'edit',
	'delete',
	'terminal',
	'subagent',
	'workflow',
	'job_kill',
] as const;

/**
 * **执行类工具** —— 明确不允许出现在 `BASE_TOOLS` 里的清单。
 *
 * ⚠ 这不是运行时用的拒绝表（本模块是白名单制：不在允许集合里就拒）。
 *   它存在是为了**给测试和审计一个可断言的名单** ——
 *   否则「BASE 里没有 bash」只能靠人眼看出。
 */
export const EXECUTION_TOOLS: readonly string[] = Object.freeze(EXECUTION_TOOL_NAMES);

/** 只读 / 外部信息类工具的名字（裸字面量，供编译期断言使用）。 */
const READONLY_TOOL_NAMES = [
	'read_file',
	'glob',
	'grep',
	'web_search',
	'web_fetch',
	'todo_write',
] as const;

/**
 * **只读 / 外部信息类工具** —— 同样明确不允许出现在 `BASE_TOOLS` 里。
 *
 * 判据（用户原话）：「**无法获得不知道的信息**」。
 *
 * ⚠ 与 `EXECUTION_TOOLS` 分开列，因为它们被排除的**理由不同**：
 *   · 执行类是「会改动工作区」；
 *   · 这一组是「会绕过『不知道就问』」。
 *   合并成一个名单会让理由丢失。
 */
export const READONLY_TOOLS: readonly string[] = Object.freeze(READONLY_TOOL_NAMES);

/** `BASE_TOOLS` 的集合形式（判定用）。 */
const BASE_SET: ReadonlySet<string> = new Set(BASE_TOOLS);

/** `POLICY_TOOLS` 的集合形式。 */
const POLICY_SET: ReadonlySet<string> = new Set(POLICY_TOOLS);

/** 是否是基础策略里的工具。 */
export function isBaseTool(toolName: string): boolean {
	return BASE_SET.has(toolName);
}

/** 是否是权限管理工具。 */
export function isPolicyTool(toolName: string): boolean {
	return POLICY_SET.has(toolName);
}

/* ────────────────────────── 四档策略的数据形状 ────────────────────────── */

/** 一份策略**增量** —— 只加不减。 */
export type ToolPolicyDelta = readonly string[];

/**
 * 一组工作模板（用户手动挑的），给它们**批量**设策略。
 *
 * ⚠ 组不是"特殊机制" —— 它只是「一个命名的 templateRef 集合」。
 *   见文件头「组的语义」。
 */
export interface ToolPolicyGroup {
	/** 用户起的名字，如 `'代码类'`。 */
	readonly name: string;
	/** 这个组包含哪些工作模板（`templateRef` 列表）。 */
	readonly templates: readonly string[];
}

/**
 * **四档策略的完整存储形状**（kv 一个键）。
 *
 * ⚠ 四档都是**增量**，都不含 BASE —— 生效集永远是 `BASE ∪ 四档`。
 */
export interface ToolPolicyStore {
	/**
	 * **未领取档**（v2 新增）：没有持有工作卡时额外允许的工具。
	 *
	 * 用户 `2026-11-21`（tool contract v2）：
	 * > 设置未领取卡 / 领取了工作卡 / 一个指定工作模板，允许的工具调用。
	 *
	 * ⚠ **只存增量，不能覆盖 `BASE_TOOLS`**：基础任务板工具是硬底线
	 *   （放手永远允许、领取后能转态），不允许被这个档移除 —— 否则 AI 会把自己锁死。
	 *   理由见 `packages/tools` 的 `taskboard_tool_policy` 实现与 `docs/设计.md`。
	 */
	readonly unclaimed: ToolPolicyDelta;
	/** **通用档**：所有工作卡都生效。 */
	// TODO(审查): 本字段现在承载 v2 的「claimed 档」语义（index.ts 的 setToolPolicyScope 写入此处），但 wire 名 `common` 被 dsh/client 按名解析 ⇒ 不能直接改名；建议内部加 `claimed` 别名或注释，需跨包确认后再动。
	readonly common: ToolPolicyDelta;
	/** **组档**：组名 → 增量。 */
	readonly groups: Readonly<Record<string, ToolPolicyDelta>>;
	/** **组的成员**：组名 → `templateRef[]`。 */
	readonly groupMembers: Readonly<Record<string, readonly string[]>>;
	/** **独立档**：`templateRef` → 增量。 */
	readonly templates: Readonly<Record<string, ToolPolicyDelta>>;
	/**
	 * **组图快照**（kv 键 `toolGraph:v1`，与四档策略**分开存**）。
	 *
	 * ⚠ 它不是「档位」—— 但 `effectiveToolsOf` 必须同时看图和策略：
	 *   有图时「组的工具集」来自图的包含闭包，无图时才回退 `groups[g]`。
	 *   由 `getToolPolicies()` 一并带出，**旧调用方不传 = 无图 = 旧行为**。
	 */
	readonly graph?: ToolGraphDoc;
}

/** 空策略（全部档位为空）。 */
export const EMPTY_POLICY_STORE: ToolPolicyStore = Object.freeze({
	unclaimed: Object.freeze([]),
	common: Object.freeze([]),
	groups: Object.freeze({}),
	groupMembers: Object.freeze({}),
	templates: Object.freeze({}),
});

/**
 * `setToolPolicyScope` 的入参（tool contract v2）。
 *
 * `tier` 与 `templateRef` **二选一**（用户：「工作模板（这个参数和档位互斥）」）。
 */
export interface ToolPolicyScopeInput {
	/** 档位：未领取卡 / 领取了工作卡。 */
	readonly tier?: 'unclaimed' | 'claimed';
	/** 指定工作模板的 ref（`templates[ref]`）。 */
	readonly templateRef?: string;
	/** 与原有取并集。 */
	readonly allow?: readonly string[];
	/** 与原有取交集（只移除已存在的）。 */
	readonly remove?: readonly string[];
}

/** `setToolPolicyScope` 的结果明细（给 AI 回话用）。 */
export interface ToolPolicyScopeChange {
	/** 实际改的 scope。 */
	readonly scope: 'unclaimed' | 'claimed' | 'template';
	/** `scope === 'template'` 时是模板 ref。 */
	readonly templateRef?: string;
	/** 改完之后该 scope 的配置（**不含 BASE**）。 */
	readonly configured: readonly string[];
	/** 本次新增的名字。 */
	readonly added: readonly string[];
	/** 本次真正移除的名字。 */
	readonly removed: readonly string[];
	/** 请求移除但本来就不在集合里的名字（幂等，不算错）。 */
	readonly ignoredRemovals: readonly string[];
	/** 请求移除但属于 BASE 硬底线、被保护下来的名字。 */
	readonly protectedRemovals: readonly string[];
	/** `allow` 里属于 BASE 的名字（恒可用，无需额外授权）。 */
	readonly alreadyBase: readonly string[];
}

/**
 * 算一个模板的**生效工具集** = `BASE ∪ 未领取 ∪ common ∪ 命中的组 ∪ 独立档`。
 *
 * @returns 去重后的工具名（**稳定顺序**：先 BASE 原序，再按档位叠加顺序）
 *
 * ⚠ 稳定顺序很重要：它是 `judgeToolCall` 与 UI 展示的共同来源，
 *   顺序抖动会让「同样配置两次显示不一样」。
 *   用 `Set` 的插入序（JS 保证）。
 */
export function effectiveToolsOf(store: ToolPolicyStore, templateRef: string): readonly string[] {
	const out = new Set<string>(BASE_TOOLS);

	/*
	 * 未领取档：没有工作卡时也生效；持有卡时继续生效（并集语义）。
	 *
	 * `?? []`：v1 的调用方/测试可能传没有这个字段的 store 字面量
	 * （v2 加字段时旧数据/旧构造路径不应炸；缺失 = 空增量）。
	 */
	for (const tool of store.unclaimed ?? []) out.add(tool);

	/* 通用档：所有工作卡都吃。 */
	for (const tool of store.common) out.add(tool);

	/*
	 * 组档：只要这个 templateRef 在某个组的成员里，那个组的工具就生效。
	 * 多个组同时命中 ⇒ 全部叠加（组之间没有优先级，都是增量）。
	 *
	 * ## 组的工具集从哪来（issue #66）
	 *
	 * | 情况 | 来源 |
	 * |---|---|
	 * | 有图（`graph.groups` 非空） | 图上的**包含闭包**（直接含 ∪ 被含组，递归） |
	 * | 无图 | `groups[groupName]` 的增量 —— **旧行为，逐字保留** |
	 *
	 * ⚠ 有图时**不再读 `groups[groupName]`**：图是组的唯一真值，两边都读
	 *   会让「图上删掉的工具」靠旧增量偷偷复活 —— 那是最难查的一类静默错误。
	 */
	const graph = store.graph !== undefined && hasToolGraph(store.graph) ? store.graph : undefined;
	for (const [groupName, members] of Object.entries(store.groupMembers)) {
		if (!members.includes(templateRef)) continue;
		if (graph !== undefined) {
			for (const tool of groupToolClosure(graph, groupName)) out.add(tool);
			continue;
		}
		const delta = store.groups[groupName];
		if (delta === undefined) continue;
		for (const tool of delta) out.add(tool);
	}

	/* 独立档：只对这个模板。 */
	const own = store.templates[templateRef];
	if (own !== undefined) for (const tool of own) out.add(tool);

	return [...out];
}

/* ────────────────────────── 两条正交轴 ────────────────────────── */

/**
 * UI 侧：用户对「AI 能不能做任务板动作」的授权档位。
 *
 * | 档位 | 领卡 | 采纳草稿 |
 * |---|---|---|
 * | `no-claim` | ❌ | ❌ |
 * | `claim` | ✅ | ❌ |
 * | `adopt` | ✅ | ✅ |
 *
 * ⚠ 这是**用户**授权，不是宿主授权 —— 所以它不受 `ToolGuardLevel` 影响。
 */
export type CardActionLevel = 'no-claim' | 'claim' | 'adopt';


/**
 * **UI 轴的全档位选项** —— 给任务板 UI 的下拉列表 / HTTP 路由直接渲染。
 *
 * ⚠ 这是档位的**唯一一份**定义：dsh 的 HTTP 路由不要自己再硬编码第二份
 *   （`value` 拼错就是静默不生效，两处清单还会漂）。
 *
 * ⚠ 用 `as const satisfies`，不用类型标注：
 *   · `satisfies` 让「`value` 写了个不存在的档位」编译失败；
 *   · `as const` 保留字面量类型 ⇒ 下面「每档恰好出现一次」的编译期断言才判得出来
 *     （AGENTS 3.5：类型标注会把元素 widen 成 union，断言静默失效）。
 */
export const CARD_ACTION_OPTIONS = [
	{
		value: 'no-claim',
		label: '不允许领卡',
		description: 'AI 不能领取工作卡，也不能采纳草稿。',
	},
	{
		value: 'claim',
		label: '允许领卡',
		description: 'AI 可以领取工作卡；草稿仍由用户自己点采纳。',
	},
	{
		value: 'adopt',
		label: '允许采纳草稿',
		description: 'AI 可以领取工作卡，也可以自己采纳草稿。',
	},
] as const satisfies readonly {
	readonly value: CardActionLevel;
	readonly label: string;
	readonly description: string;
}[];


/* ────────────────────────── 领卡类动作的 UI 轴判定 ────────────────────────── */

/** 领卡类动作（v2 合并进一个 `taskboard_transition` 工具后，判定改按“动作”而不是工具名）。 */
export type CardActionName = 'adopt' | 'claim' | 'release';

/** UI 轴放行。 */
export interface CardActionAllowed {
	readonly ok: true;
}

/** UI 轴拒绝。 */
export interface CardActionDenied {
	readonly ok: false;
	readonly reason: 'CARD_ACTION_LEVEL';
	/** 人话原因。 */
	readonly message: string;
	/** 需要在 UI 上打开到哪一档。 */
	readonly requiredLevel: 'claim' | 'adopt';
	/** 当前档位。 */
	readonly current: CardActionLevel;
}

/** UI 轴判定结果。 */
export type CardActionVerdict = CardActionAllowed | CardActionDenied;

const CARD_ACTION_ALLOW: CardActionAllowed = Object.freeze({ ok: true });

/**
 * 判定一次**领卡类动作**是否被 UI 轴允许（用户 `2026-11-21` 第二轮要求）。
 *
 * 用户原话：
 * > 这个有权限拦截。必须在 ui 侧用户手开这个权限才能让 ai 领取。
 *
 * ## 与 `judgeToolCall` 第一段的关系
 *
 * v1 按**工具名**判（`taskboard_claim` / `taskboard_adopt` / `taskboard_release`）；
 * v2 把三个动作合并进 `taskboard_transition`，工具名不再携带动作信息
 * ⇒ 判定改按**动作**（`adopt` / `claim` / `release`），规则与旧第一段逐条一致：
 *
 * | 动作 | no-claim | claim | adopt |
 * |---|---|---|---|
 * | `release` | ✅ 永远允许（放手；否则 AI 会被卡锁死） | ✅ | ✅ |
 * | `claim` | ❌ | ✅ | ✅ |
 * | `adopt` | ❌ | ❌ | ✅ |
 *
 * ⚠ 本函数**只看 UI 轴**（用户授权），不看宿主轴 —— 领卡类动作与
 *   `ToolGuardLevel` 正交（旧的同一条规则）。
 */
export function judgeCardAction(input: {
	readonly action: CardActionName;
	readonly cardLevel: CardActionLevel;
}): CardActionVerdict {
	if (input.action === 'release') return CARD_ACTION_ALLOW;

	if (input.action === 'claim') {
		if (input.cardLevel !== 'no-claim') return CARD_ACTION_ALLOW;
		return {
			ok: false,
			reason: 'CARD_ACTION_LEVEL',
			message: '当前任务板档位不允许 AI 领取工作卡。',
			requiredLevel: 'claim',
			current: input.cardLevel,
		};
	}

	if (input.cardLevel === 'adopt') return CARD_ACTION_ALLOW;
	return {
		ok: false,
		reason: 'CARD_ACTION_LEVEL',
		message: '当前任务板档位不允许 AI 采纳草稿。',
		requiredLevel: 'adopt',
		current: input.cardLevel,
	};
}


/** 一个模板的**额外**工具（从生效集里扣掉 BASE，用于错误消息）。 */
export function extrasOf(store: ToolPolicyStore, templateRef: string): readonly string[] {
	return effectiveToolsOf(store, templateRef).filter((one) => !BASE_SET.has(one));
}

/* ────────────────────────── 编译期断言 ────────────────────────── */

type AssertTrue<T extends true> = T;

/**
 * ① `POLICY_TOOLS` 与 `BASE_TOOLS` **不相交**。
 *
 * 如果相交，权限管理工具就会「永远放行」（BASE 那条先命中），
 * 宿主轴 `manage-edit` 也就失效了 —— 而那是这个模型的安全边界。
 */
type _PolicyNotInBase = [Extract<(typeof POLICY_TOOL_NAMES)[number], (typeof BASE_TOOL_NAMES)[number]>] extends [
	never,
]
	? true
	: false;

/** ② 执行类工具**一个都不在** `BASE_TOOLS` 里。 */
type _NoExecutionInBase = [
	Extract<(typeof EXECUTION_TOOL_NAMES)[number], (typeof BASE_TOOL_NAMES)[number]>,
] extends [never]
	? true
	: false;

/** ③ 只读 / 外部信息类**一个都不在** `BASE_TOOLS` 里（`2026-11-14` 裁定）。 */
type _NoReadonlyInBase = [
	Extract<(typeof READONLY_TOOL_NAMES)[number], (typeof BASE_TOOL_NAMES)[number]>,
] extends [never]
	? true
	: false;

/** ④ 权限管理工具不在执行类里（两组互不重叠，便于审计）。 */
type _PolicyNotExecution = [
	Extract<(typeof POLICY_TOOL_NAMES)[number], (typeof EXECUTION_TOOL_NAMES)[number]>,
] extends [never]
	? true
	: false;

/** ⑤ `BASE_TOOLS` 恰好 9 个（tool contract v2：全部任务板工具除 #9 权限工具）。 */
type _BaseIsNine = (typeof BASE_TOOL_NAMES)['length'] extends 9 ? true : false;

/**
 * ⑥ UI 轴选项表**覆盖全部档位且恰好 3 条**（没有漏档、没有重复档）。
 *
 * ⚠ 靠 `as const` 保留的字面量类型才判得出来：若漏了 `adopt`，
 *   `Exclude<CardActionLevel, …>` 就是 `'adopt'` 而不是 `never` ⇒ 编译失败。
 */
type _CardOptionsCoverAll =
	Exclude<CardActionLevel, (typeof CARD_ACTION_OPTIONS)[number]['value']> extends never
		? (typeof CARD_ACTION_OPTIONS)['length'] extends 3
			? true
			: false
		: false;

export type _PERMISSION_VOCABULARY_CONSISTENT = AssertTrue<
	[
		_PolicyNotInBase,
		_NoExecutionInBase,
		_NoReadonlyInBase,
		_PolicyNotExecution,
		_BaseIsNine,
		_CardOptionsCoverAll,
	] extends [true, true, true, true, true, true]
		? true
		: false
>;
