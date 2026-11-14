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
 *   ∪ common                         ← 通用：所有工作卡都生效
 *   ∪ ⋃{ groups[g] | ref ∈ groupMembers[g] }   ← 组：批量设置
 *   ∪ templates[ref]                  ← 独立：只对该模板
 * ```
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
 * ## 三条结构性决定
 *
 * | 决定 | 实现 |
 * |---|---|
 * | ① 工作权限必须是 BASE 的**超集** | 四档都是增量列表，生效永远 `= BASE ∪ …` ⇒ 结构上漏不掉 BASE |
 * | ② 基础策略是**常量**，不落库、不可配置 | `BASE_TOOLS` 是 `Object.freeze` 的常量，不进 kv、没有 setter |
 * | ③ 权限编辑开关**纯内存**，重启即关 | 进程内 `Set` —— 不写 kv、不写卡 |
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
 * 不读存储、不知 dsh、不做 I/O。策略与开关由调用方（`index.ts` / dsh 的 guard）
 * 通过参数传进来 —— 所以它是可穷举测试的纯函数。
 * ---
 */

/** 一次判定。 */
export type ToolCallVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

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
	'taskboard_create',
	'taskboard_update_content',
	'taskboard_update_note',
	'taskboard_transition',
	'taskboard_claim',
	'taskboard_release',
	'taskboard_registry',
	'taskboard_mark_seen',
] as const;

/**
 * **基础策略** —— 未持有任何工作卡时的可用工具。
 *
 * ## ⚠ 这是常量，不可配置、不落库
 *
 * 它是**安全基线**。可配置就可能被配成「什么都不给」⇒ 任务板工具都用不了
 * ⇒ AI 无法工作（连建卡、改状态都做不了）。
 *
 * ## 恰好 11 个，全部是 `taskboard_*`
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
const POLICY_TOOL_NAMES = [
	'taskboard_tool_policies',
	'taskboard_tool_policy_set',
	'taskboard_tool_policy_members',
	'taskboard_tool_policy_reset',
] as const;

/**
 * **权限管理工具** —— 只有权限编辑开关打开时才可用，且**永不在 `BASE_TOOLS` 里**。
 *
 * ## 为什么单独一组
 *
 * 用户：「要想办法在开启一个极高权限后，ai 可以自己去编辑一个模板对应的权限。」
 *
 * ⇒ 这批工具能**改写权限本身**，等于「能给自己发权限」。它必须：
 *
 * 1. **不在 BASE 里** —— 否则任何没领卡的 AI 都能改权限，安全基线就没了；
 * 2. **不在任何档位的增量里生效**（结构上：`judgeToolCall` 第一步就判它们，
 *    早于 BASE / 四档）⇒ 不可能通过领一张卡获得；
 * 3. **只受纯内存开关控制** —— 用户点 UI 打开，重启即关。
 *
 * ## 三个工具
 *
 * | 工具 | 作用 |
 * |---|---|
 * | `taskboard_tool_policies` | 读**完整四档策略**（AI 需要先看现状才能改） |
 * | `taskboard_tool_policy_set` | 改**某一档**（`granularity` 参数：common / group / template） |
 * | `taskboard_tool_policy_reset` | 清掉某一档（回到纯 BASE） |
 *
 * ⚠ **工具名需要与 dsh 侧对齐确认** —— core 只认字符串，dsh 负责注册。
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
	/** **通用档**：所有工作卡都生效。 */
	readonly common: ToolPolicyDelta;
	/** **组档**：组名 → 增量。 */
	readonly groups: Readonly<Record<string, ToolPolicyDelta>>;
	/** **组的成员**：组名 → `templateRef[]`。 */
	readonly groupMembers: Readonly<Record<string, readonly string[]>>;
	/** **独立档**：`templateRef` → 增量。 */
	readonly templates: Readonly<Record<string, ToolPolicyDelta>>;
}

/** 空策略（全部档位为空）。 */
export const EMPTY_POLICY_STORE: ToolPolicyStore = Object.freeze({
	common: Object.freeze([]),
	groups: Object.freeze({}),
	groupMembers: Object.freeze({}),
	templates: Object.freeze({}),
});

/**
 * 算一个模板的**生效工具集** = `BASE ∪ common ∪ 命中的组 ∪ 独立档`。
 *
 * @returns 去重后的工具名（**稳定顺序**：先 BASE 原序，再按档位叠加顺序）
 *
 * ⚠ 稳定顺序很重要：它是 `judgeToolCall` 与 UI 展示的共同来源，
 *   顺序抖动会让「同样配置两次显示不一样」。
 *   用 `Set` 的插入序（JS 保证）。
 */
export function effectiveToolsOf(store: ToolPolicyStore, templateRef: string): readonly string[] {
	const out = new Set<string>(BASE_TOOLS);

	/* 通用档：所有工作卡都吃。 */
	for (const tool of store.common) out.add(tool);

	/*
	 * 组档：只要这个 templateRef 在某个组的成员里，那个组的增量就生效。
	 * 多个组同时命中 ⇒ 全部叠加（组之间没有优先级，都是增量）。
	 */
	for (const [groupName, members] of Object.entries(store.groupMembers)) {
		if (!members.includes(templateRef)) continue;
		const delta = store.groups[groupName];
		if (delta === undefined) continue;
		for (const tool of delta) out.add(tool);
	}

	/* 独立档：只对这个模板。 */
	const own = store.templates[templateRef];
	if (own !== undefined) for (const tool of own) out.add(tool);

	return [...out];
}

/* ────────────────────────── 三种任务板模式 ────────────────────────── */

/**
 * 任务板权限模式 —— 由 DSH 的权限预设名映射而来。
 *
 * ## ⚠ 与 DSH 自己的权限**互斥**（用户原话）
 *
 * > 我说的是和dsh自己的权限互斥。只要开的是他自己或者别的插件提供的权限。
 * > 那么这个插件给的限制都不生效。
 *
 * ⇒ `mode === undefined` = 「不是我们的预设」⇒ guard **一律放行**。
 *   我们只在用户明确选了任务板的三个预设之一时才介入。
 */
export type BoardMode = 'plan' | 'work' | 'auto';

/** 预设的 sandbox 档。与 DSH 的权限预设同名词。 */
export type BoardSandbox = 'read-only' | 'workspace-write';

/** 一个预设的完整定义。dsh 注册预设时直接照抄这份。 */
export interface BoardPreset {
	/** DSH 权限预设的 key（下拉栏里选的就是它）。 */
	readonly name: string;
	readonly mode: BoardMode;
	/** 下拉栏显示名。 */
	readonly label: string;
	/** 说明（下拉栏的第二行）。 */
	readonly description: string;
	readonly sandbox: BoardSandbox;
	/**
	 * 审批策略。三个模式统一 `ask` ——
	 * 任务板管的是「这个工具给不给」，不管「要不要问用户」；
	 * 需要确认的动作交给 DSH 的审批机制。
	 */
	readonly approval: 'ask';
}

/*
 * ⚠ 裸字面量元组 + widen 导出 —— 与 `BASE_TOOL_NAMES` / `POLICY_TOOL_NAMES` 同一个理由：
 *   直接标注 `readonly BoardPreset[]` 会让元素类型 widen，下面的编译期断言判不出来。
 *   见 AGENTS.md §3.5（已踩两次）。
 */
const BOARD_PRESET_TABLE = [
	{
		name: 'taskboard-plan',
		mode: 'plan',
		label: '任务版（计划）',
		description: '只读：不能创建、不能领取工作卡，因而拿不到文件与网络工具。要先和人把方向定清楚。',
		sandbox: 'read-only',
		approval: 'ask',
	},
	{
		name: 'taskboard-work',
		mode: 'work',
		label: '任务版（工作）',
		description: '领到工作卡才拿到该卡授予的工具权限。工作区外不可写；草稿采纳由用户点。',
		sandbox: 'workspace-write',
		approval: 'ask',
	},
	{
		name: 'taskboard-auto',
		mode: 'auto',
		label: '任务版（自动工作）',
		description: '同「工作」，区别是 AI 可以自己采纳草稿，不必等用户点。工具权限仍按工作卡授予。',
		sandbox: 'workspace-write',
		approval: 'ask',
	},
] as const;

/**
 * 任务板的**三个**权限预设。
 *
 * ## 为什么是三个不是四个
 *
 * 用户 `2026-11-14`：
 *
 * > 能不能只留三个权限。开发者权限由dsh自己的完全权限去操作？
 * > 没有必要为此就让我们再开一个新的权限。
 *
 * ⇒ **「开发者」= DSH 出厂的 `danger-full-access`，我们不新增。**
 *   在那种权限下 `mode === undefined` ⇒ 我们一律放行，等于完全不干涉。
 */
export const BOARD_PRESETS: readonly BoardPreset[] = Object.freeze(BOARD_PRESET_TABLE);

/** 预设名 → 模式。不是我们的预设（含 `undefined` / 空串）⇒ `undefined`。 */
export function boardModeOf(presetName: string | undefined): BoardMode | undefined {
	if (presetName === undefined) return undefined;
	for (const preset of BOARD_PRESET_TABLE) {
		if (preset.name === presetName) return preset.mode;
	}
	return undefined;
}

/**
 * **计划模式下禁止的任务板工具** —— AI 不能创建、不能领取。
 *
 * 用户原话：「ai不能创建和领取任务」。
 *
 * ## ⚠ 只禁这两个（照字面实现）
 *
 * 没把 `update_content` / `transition` / `update_note` 列进来，因为：
 *   · 用户只说了「创建和领取」；
 *   · 设计卡 / 记录卡本来就要写内容 —— 禁掉就没法用了。
 *
 * `transition` 也留着：它管的是「这张卡走到哪个状态」，
 * 而计划模式下 AI 能碰到的卡都是已存在的，改状态不产生新任务。
 */
export const PLAN_BLOCKED_TOOLS: readonly string[] = Object.freeze([
	'taskboard_create',
	'taskboard_claim',
]);

/** `PLAN_BLOCKED_TOOLS` 的集合形式。 */
const PLAN_BLOCKED_SET: ReadonlySet<string> = new Set(PLAN_BLOCKED_TOOLS);

/* ────────────────────────── 判定 ────────────────────────── */

/**
 * 一次工具调用判定的输入（**调用方面向**）。
 *
 * `heldCards` 由 dsh 的 guard 收集后传进来（core 不认识 dsh 的 agent）。
 */
export interface ToolCallJudgement {
	/**
	 * 当前模式。**`undefined` = 不是任务板的预设**（DSH 自己的 / 别的插件的）
	 * ⇒ 一律放行，我们不干涉。
	 */
	readonly mode: BoardMode | undefined;
	readonly toolName: string;
	/** 这个 agent 当前持有的工作卡。空的、或多于一张，都是有意义的状态。 */
	readonly heldCards: readonly { readonly templateRef: string }[];
}

/**
 * 判定的外部事实（纯参数，不是注入的服务）。
 *
 * 由调用方从 `index.ts` 的策略缓存里取出来传进来 ——
 * 这样本模块保持纯函数（可穷举测试），也不需要认识存储。
 */
export interface PermissionFacts {
	/** 四档策略。 */
	readonly policies: ToolPolicyStore;
}

/**
 * 判定一次工具调用 —— **纯函数**。
 *
 * ## 判定顺序（顺序本身是规则的一部分）
 *
 * | # | 条件 | 结果 |
 * |---|---|---|
 * | ① | `mode === undefined` | **放行**（互斥：不是我们的预设，不干涉） |
 * | ② | `mode !== undefined` 且 `toolName ∈ POLICY_TOOLS` | 拒绝：权限管理工具在任务板模式下不可用 |
 * | ③ | `mode === 'plan'` 且 `toolName ∈ PLAN_BLOCKED_TOOLS` | 拒绝：计划模式不能创建 / 领取 |
 * | ④ | `toolName ∈ BASE_TOOLS` | 放行（**不需要任何卡**） |
 * | ⑤ | `mode === 'plan'` | 拒绝：**计划模式只有 BASE**，不吃四档增量 |
 * | ⑥ | `heldCards` 为空 | 拒绝：需要先领一张工作卡 |
 * | ⑦ | `heldCards` 多于一张 | 拒绝：同时持有多张工作卡（违反一次一张） |
 * | ⑧ | `toolName ∈ effectiveToolsOf(那张卡)` | 放行 |
 * | ⑨ | 否则 | 拒绝：需要持有「<模板>」的工作卡 |
 *
 * ⚠ **① 在最前面** —— 互斥语义的实现。DSH 自己的 `danger-full-access` 下我们什么都不管。
 *
 * ⚠ **② 独立于四档** —— 权限管理工具在任何任务板模式下一律拒绝。
 *   它们能改写权限本身（等于「给自己发权限」），只能靠**用户切到 DSH 自己的
 *   完全权限**（那时 `mode === undefined` ⇒ ①放行）来用。
 *   ⚠ 不能只依赖「不在 BASE、也不在四档里」—— 因为四档是**用户可配的**，
 *     有人把 `taskboard_tool_policy_set` 写进 common 就绕过去了。
 *
 * ⚠ **③ 在 ④ 之前** —— plan 模式要能禁掉 BASE 里的 `create` / `claim`，
 *   否则「不能创建」这条规则会被 BASE 那条先放行掉。
 *
 * ⚠ **⑤ 在 ⑥ 之前，且只在 plan** —— 用户原话「计划就是连网络访问和文件访问
 *   都受限的只读模式」。⇒ plan 下**不吃任何四档增量**，只有 BASE。
 *   这也封掉了「plan 模式强行持有一张卡就能拿执行权限」这条绕过路径
 *   （正常路径走不到，但库里可能有脏数据）。
 *
 * ⚠ **④ 在 ⑥ 之前** —— 「基础权限不需要领卡」这条规则的实现。
 *
 * ⚠ **⑦ 排在 ⑧ 前面**：多张卡时无法判断该用哪份权限。这个状态本身不该出现
 *   （`claim` 的「一次一张」挡着），但**库里可能有** ⇒ 拒绝且说清，不猜。
 *
 * ⚠ **只校验工具名字，不校验是否存在**（用户原话）。
 */
export function judgeToolCall(input: ToolCallJudgement, facts: PermissionFacts): ToolCallVerdict {
	const { mode, toolName, heldCards } = input;

	/* ① 不是我们的预设 ⇒ 一律放行（互斥）。 */
	if (mode === undefined) return ALLOW;

	/* ② 权限管理工具：任何任务板模式下都不可用（改权限要靠切到完全权限）。 */
	if (POLICY_SET.has(toolName)) {
		return reject(
			`「${toolName}」是权限管理工具，任务板权限模式下不可用。` +
				'要改权限，请把会话切到 DSH 自己的「完全访问」权限（那里任务板不干涉任何工具）。',
		);
	}

	/* ③ plan 模式：AI 不能创建、不能领取。 */
	if (mode === 'plan' && PLAN_BLOCKED_SET.has(toolName)) {
		return reject(
			`「${toolName}」在计划模式不可用 —— 计划模式下 AI 不能创建任务，也不能领取任务。` +
				'先和人把方向定清楚，再切到「任务版（工作）」。',
		);
	}

	/* ④ 基础策略：不需要任何卡。 */
	if (BASE_SET.has(toolName)) return ALLOW;

	/* ⑤ 计划模式只有 BASE —— 不吃四档增量。 */
	if (mode === 'plan') {
		return reject(
			`「${toolName}」在计划模式不可用 —— 计划模式只读，只允许任务板自己的基础工具。` +
				'要动文件 / 跑命令，请先切到「任务版（工作）」并领取一张工作卡。',
		);
	}

	/* ⑥ 没有工作卡 ⇒ 拒绝。 */
	if (heldCards.length === 0) {
		return reject(`「${toolName}」需要先领取一张工作卡；当前没有持有任何工作卡。`);
	}

	/* ⑦ 多张工作卡 ⇒ 无法判断该用哪一份权限，拒绝（不猜）。 */
	if (heldCards.length > 1) {
		const refs = heldCards.map((one) => one.templateRef).join('、');
		return reject(`同时持有多张工作卡（${refs}），无法判断该用哪一份额外权限；先释放到只剩一张。`);
	}

	/* ⑧ 那张卡的生效集含它 ⇒ 放行。 */
	const card = heldCards[0] as { readonly templateRef: string };
	const effective = effectiveToolsOf(facts.policies, card.templateRef);
	if (effective.includes(toolName)) return ALLOW;

	/* ⑨ 否则拒绝，并说清这张卡现在有哪些「额外」工具。 */
	const extras = extrasOf(facts.policies, card.templateRef);
	const available =
		extras.length === 0 ? '（该模板没有额外权限）' : `（它有：${extras.join('、')}）`;
	return reject(
		`「${toolName}」需要持有「${card.templateRef}」工作卡授予的权限；当前那张卡没有这项${available}。`,
	);
}

/** 一个模板的**额外**工具（从生效集里扣掉 BASE，用于错误消息）。 */
export function extrasOf(store: ToolPolicyStore, templateRef: string): readonly string[] {
	return effectiveToolsOf(store, templateRef).filter((one) => !BASE_SET.has(one));
}

/** 放行常量（复用，避免每次分配）。 */
const ALLOW: ToolCallVerdict = Object.freeze({ ok: true });

/** 造一个拒绝。 */
function reject(reason: string): ToolCallVerdict {
	return { ok: false, reason };
}

/* ────────────────────────── 编译期断言 ────────────────────────── */

type AssertTrue<T extends true> = T;

/**
 * ① `POLICY_TOOLS` 与 `BASE_TOOLS` **不相交**。
 *
 * 如果相交，权限管理工具就会「永远放行」（BASE 那条先命中），
 * 纯内存开关也就失效了 —— 而那是这个模型的安全边界。
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

/** ⑤ `BASE_TOOLS` 恰好 11 个（用户裁定的数量）。 */
type _BaseIsEleven = (typeof BASE_TOOL_NAMES)['length'] extends 11 ? true : false;

export type _PERMISSION_VOCABULARY_CONSISTENT = AssertTrue<
	[
		_PolicyNotInBase,
		_NoExecutionInBase,
		_NoReadonlyInBase,
		_PolicyNotExecution,
		_BaseIsEleven,
	] extends [true, true, true, true, true]
		? true
		: false
>;
