/**
 * 工具权限 —— **领取工作卡才授予执行能力**。
 *
 * ## 用户裁定（`2026-11-13`，这是设计依据不是讨论项）
 *
 * > 权限的粒度要改。因为语义是**领取了工作，才有权限**。
 * > 而其他的就是在没有权限也能做的事情。
 * > 目标，设计，记录，根本不可能领取。所以应该是**给每个工作一个工具权限设置**。
 * > 其他所有模板，**共用一种未领取时的权限**。
 * > 工具清单从 dsh 拿。
 * > 并且，要想办法在开启一个极高权限后，ai 可以自己去编辑一个模板对应的权限。
 * > 用户去配是不现实的。并且这个是要储存的。
 *
 * > 这个开关是**纯内存**的。重启以后他**默认关**的。
 * > 但是这个开关就要在 **core 里面**存在了。包括设置权限也要在 **core 里面有入口方法**。
 * > 然后这个权限是要**持久化的**。
 *
 * > 只校验工具名字。所以无所谓是否存在。**只对匹配的进行拦截和放出**。
 * > 因为本来就是有工具调用的时候才生效。**没注册的工具本来就不会生效。**
 *
 * ## 模型：BASE ∪ extra
 *
 * ```
 * 未持有工作卡      ⇒ BASE（常量）
 * 持有工作卡 X      ⇒ BASE ∪ extra[X]      ← extra 只存增量
 * ```
 *
 * ## 三条结构性决定的实现位置
 *
 * | 决定 | 实现 |
 * |---|---|
 * | ① 工作权限必须是 BASE 的**超集** | `extra` 是增量列表，生效永远 = `BASE ∪ extra` ⇒ 结构上漏不掉 BASE |
 * | ② 基础策略是**常量**，不落库、不可配置 | `BASE_TOOLS` 是 `Object.freeze` 的常量，不进 kv、没有 setter |
 * | ③ 权限编辑开关**纯内存**，重启即关 | `PolicySwitch` 是进程内 `Set` —— 不写 kv、不写卡 |
 *
 * ## 为什么决定 ① 必须由结构保证而不是配置
 *
 * 如果工作策略是平铺列表，可能被配成不含 `taskboard_*` ⇒
 * AI 领了工作卡却**无法 transition / release** ⇒ **永久卡在「处理中」**。
 * 那不是"权限收紧了"，是**把 AI 锁死**。
 *
 * ⇒ 工作模板只存 `extra`，生效 = `BASE ∪ extra`。**没有"配成不含 BASE"这种可能。**
 *
 * ## 这个文件是纯的
 *
 * 不读存储、不知 dsh、不做 I/O。策略与开关由调用方（`index.ts` / dsh 的 guard）
 * 通过参数传进来 —— 所以它是可穷举测试的纯函数。
 */

/** 一次判定。 */
export type ToolCallVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/*
 * ⚠ 清单先写成**裸字面量 + `as const`**，再导出 widened 版本。
 *
 * 如果直接写 `export const BASE_TOOLS: readonly string[] = [...]`，
 * 元素类型被 widen 成 `string` ⇒ 下面「`POLICY_TOOLS` 与 `BASE_TOOLS` 不相交」
 * 这类编译期断言拿到的是 `string`，**永远判不出来**（静默失效）。
 * 这与 `protocol/transition.ts` 里 `BUTTON_TABLE` / `BUTTON_ACTIONS` 的做法一致。
 */
const BASE_TOOL_NAMES = [
	/* ── 任务板自己的 11 个工具（权限管理三项不在这里，见 `POLICY_TOOLS`） ── */
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

	/* ── 只读类 ── */
	'read_file',
	'glob',
	'grep',
	'web_search',
	'web_fetch',
	'todo_write',
] as const;

/**
 * **基础策略** —— 未持有任何工作卡时的可用工具。
 *
 * ## ⚠ 这是常量，不可配置、不落库
 *
 * 它是**安全基线**。可配置就可能被配成「什么都不给」⇒ 任务板工具都用不了
 * ⇒ AI 无法工作（连建卡、改状态都做不了）。
 *
 * ## 里面有什么、没有什么
 *
 * | 类 | 内容 |
 * |---|---|
 * | 任务板自己的工具 | 11 个（读取 / 建卡 / 改内容 / 转移 / 领取 / 释放 / 查注册表 / 标已读） |
 * | 只读类 | `read_file` / `glob` / `grep` / `web_search` / `web_fetch` / `todo_write` |
 * | **执行类** | **一个都没有**（`bash` / `write` / `edit` / `delete` / `terminal` / `subagent` …） |
 *
 * ⇒ 「在没有任何权限的情况下也能做的事情」—— 读、看、记、管理任务板。
 *   跑命令 / 改文件必须**先领一张工作卡**再走 `extra`。
 *
 * ⚠ **清单待用户确认**（`工具清单从 dsh 拿`，而 dsh 注册了哪些工具会变）。
 */
export const BASE_TOOLS: readonly string[] = Object.freeze(BASE_TOOL_NAMES);

/** 权限管理工具的名字（裸字面量，供编译期断言使用）。 */
const POLICY_TOOL_NAMES = [
	'taskboard_tool_policies',
	'taskboard_tool_policy_set',
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
 * 2. **不在任何模板的 `extra` 里** —— 否则领一张工作卡就能改全部权限；
 * 3. **只受纯内存开关控制** —— 用户点 UI 打开，重启即关。
 *
 * ## 三个工具
 *
 * | 工具 | 作用 |
 * |---|---|
 * | `taskboard_tool_policies` | 读全部模板的 extra（AI 需要先看现状才能改） |
 * | `taskboard_tool_policy_set` | 改一个模板的 extra（持久化到 kv） |
 * | `taskboard_tool_policy_reset` | 把一个模板的 extra 清空（回到纯 BASE） |
 *
 * ⚠ **工具名需要与 dsh 侧对齐确认** —— core 只认字符串，dsh 负责注册；
 *   两边名字不一致会表现为「永远拒绝」（比"永远放行"安全，但仍是错）。
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

/** `BASE_TOOLS` 的集合形式（判定用，避免每次 `includes` 线性扫）。 */
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

/**
 * 一次工具调用判定的输入（**调用方面向**）。
 *
 * `heldCards` 由 dsh 的 guard 收集后传进来（core 不认识 dsh 的 agent）。
 */
export interface ToolCallJudgement {
	/** 判定作用域 —— 不透明字符串（dsh 侧传会话 / agent id）。只用于开关查询。 */
	readonly scope: string;
	readonly toolName: string;
	/** 这个 agent 当前持有的工作卡。空的、或多于一张，都是有意义的状态。 */
	readonly heldCards: readonly { readonly templateRef: string }[];
}

/**
 * 判定的外部事实（纯参数，不是注入的服务）。
 *
 * 由调用方从 `index.ts` 的策略缓存 / 开关集合里取出来传进来 ——
 * 这样本模块保持纯函数（可穷举测试），也不需要认识存储。
 */
export interface PermissionFacts {
	/** `templateRef → extra 工具名`。未出现的模板 = 没有额外权限。 */
	readonly policies: Readonly<Record<string, readonly string[]>>;
	/** 权限编辑开关**开着的** scope 集合（纯内存）。 */
	readonly policyEditOn: ReadonlySet<string>;
}

/**
 * 判定一次工具调用 —— **纯函数**。
 *
 * ## 判定顺序（顺序本身是规则的一部分）
 *
 * | # | 条件 | 结果 |
 * |---|---|---|
 * | ① | `toolName ∈ POLICY_TOOLS` | 开关开着的 scope ⇒ 放行；否则拒绝 |
 * | ② | `toolName ∈ BASE_TOOLS` | 放行（**不需要任何卡**） |
 * | ③ | `heldCards` 为空 | 拒绝：需要先领一张工作卡 |
 * | ④ | `heldCards` 多于一张 | 拒绝：同时持有多张工作卡（违反一次一张） |
 * | ⑤ | 那张卡的 `extra` 含 `toolName` | 放行 |
 * | ⑥ | 否则 | 拒绝：需要持有「<模板>」的工作卡 |
 *
 * ⚠ **①② 在 ③ 之前** —— 这是「基础权限不需要领卡」这条规则的实现。
 *   若把 ③ 提到前面，没领卡的 AI 连读卡都不行了。
 *
 * ⚠ **④ 排在 ⑤ 前面**：多张卡时无法判断该用哪张卡的 extra。
 *   这个状态本身就不该出现（`claim` 的「一次一张」准入挡着），
 *   但**库里可能有**（历史数据 / 别的入口违反）⇒ 拒绝且说清，不猜。
 *
 * ⚠ **只校验工具名字，不校验是否存在**（用户原话：「没注册的工具本来就不会生效」）。
 *   core 不知道 dsh 注册了哪些工具，也不该知道（那是反向依赖）。
 */
export function judgeToolCall(input: ToolCallJudgement, facts: PermissionFacts): ToolCallVerdict {
	const { scope, toolName, heldCards } = input;

	/* ① 权限管理工具：只看开关。 */
	if (POLICY_SET.has(toolName)) {
		return facts.policyEditOn.has(scope)
			? ALLOW
			: reject(
					`「${toolName}」是权限管理工具，需要用户先在界面上打开「权限编辑」开关（纯内存，重启即关）。`,
				);
	}

	/* ② 基础策略：不需要任何卡。 */
	if (BASE_SET.has(toolName)) return ALLOW;

	/* ③ 没有工作卡 ⇒ 拒绝。 */
	if (heldCards.length === 0) {
		return reject(`「${toolName}」需要先领取一张工作卡；当前没有持有任何工作卡。`);
	}

	/* ④ 多张工作卡 ⇒ 无法判断该用哪一份权限，拒绝（不猜）。 */
	if (heldCards.length > 1) {
		const refs = heldCards.map((one) => one.templateRef).join('、');
		return reject(
			`同时持有多张工作卡（${refs}），无法判断该用哪一份额外权限；先释放到只剩一张。`,
		);
	}

	/* ⑤ 唯一那张卡的 extra 含它 ⇒ 放行。 */
	const card = heldCards[0] as { readonly templateRef: string };
	const extra = facts.policies[card.templateRef];
	if (extra !== undefined && extra.includes(toolName)) return ALLOW;

	/* ⑥ 否则拒绝，并说清该领哪种卡。 */
	const available = extra === undefined || extra.length === 0 ? '（该模板没有额外权限）' : `（它有：${extra.join('、')}）`;
	return reject(
		`「${toolName}」需要持有「${card.templateRef}」工作卡授予的权限；当前那张卡没有这项${available}。`,
	);
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

/**
 * ③ 权限管理工具**也不在**执行类里（两组互不重叠，便于审计）。
 *
 * ⚠ 这条不是安全要求，是清单整洁要求 —— 但错了说明分组混乱。
 */
type _PolicyNotExecution = [
	Extract<(typeof POLICY_TOOL_NAMES)[number], (typeof EXECUTION_TOOL_NAMES)[number]>,
] extends [never]
	? true
	: false;

export type _PERMISSION_VOCABULARY_CONSISTENT = AssertTrue<
	[_PolicyNotInBase, _NoExecutionInBase, _PolicyNotExecution] extends [true, true, true] ? true : false
>;
