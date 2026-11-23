/**
 * 「模板授权」页的**纯逻辑**：解析 `/api/tool-policy` 的返回 + 按来源分组。
 *
 * ## 为什么单独一个纯文件
 *
 * 输入是**网络边界**（`unknown`），最需要被测试；而 Node 不认 `.tsx`
 * ⇒ 放 `.tsx` 里等于放弃测试（`ERR_UNKNOWN_FILE_EXTENSION`）。
 *
 * ## ⚠ 这里**不算并集**
 *
 * 并集（BASE ∪ 未领取 ∪ common ∪ 命中组 ∪ 独立档）的唯一真值是 core 的
 * `effectiveToolsOf()`，服务端已经算好放在 `effective` 里。
 * 本文件只做两件事：
 *
 *   ① 把 `unknown` 解析成干净结构（坏数据 ⇒ `undefined`，不抛）
 *   ② 按来源把「这个模板的工具」拆开展示
 *
 * 前端再算一遍并集 = 第二份真值，AGENTS 3.6 明令禁止。
 */

/** 端点返回的干净结构（已校验）。 */
export interface ToolPolicySnapshot {
	/** 恒可用、不可移除。 */
	readonly baseTools: readonly string[];
	/** 未领取卡时的额外工具。 */
	readonly unclaimed: readonly string[];
	/** 所有工作卡都生效的通用档。 */
	readonly common: readonly string[];
	/** 组档：组名 → 增量。 */
	readonly groups: readonly { readonly name: string; readonly tools: readonly string[] }[];
	/** 组的成员：组名 → 模板 ref 列表。 */
	readonly groupMembers: readonly { readonly group: string; readonly templates: readonly string[] }[];
	/** 独立档：模板 ref → 增量。 */
	readonly templates: readonly { readonly templateRef: string; readonly tools: readonly string[] }[];
	/** 服务端算好的生效集（**不要在前端重算**）。 */
	readonly effective: readonly { readonly templateRef: string; readonly tools: readonly string[] }[];
}

/** 一个「来源」分组。 */
export interface PolicySource {
	/** 稳定 key（DOM 用，也用于测试）。 */
	readonly key: string;
	/** 展示名。 */
	readonly label: string;
	/** 这个来源贡献的工具（**原始增量**，可能和别的来源重叠）。 */
	readonly tools: readonly string[];
	/** 恒可用、不可被移除（目前只有 BASE 为真）。 */
	readonly locked: boolean;
}

const isStringArray = (value: unknown): value is readonly string[] =>
	Array.isArray(value) && value.every((one) => typeof one === 'string');

const stringsOf = (value: unknown): readonly string[] | undefined => (isStringArray(value) ? value : undefined);

/** 解析 `{ name, tools }[]` 形态（服务端给的是数组，不是 map）。 */
function pairsOf(
	value: unknown,
	nameKey: string,
	listKey: string,
): readonly { readonly name: string; readonly items: readonly string[] }[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const out: { name: string; items: readonly string[] }[] = [];
	for (const one of value) {
		if (typeof one !== 'object' || one === null) continue;
		const record = one as Record<string, unknown>;
		const name = record[nameKey];
		const list = stringsOf(record[listKey]);
		if (typeof name !== 'string' || list === undefined) continue;
		out.push({ name, items: list });
	}
	return out;
}

/**
 * 解析端点返回。
 *
 * @param raw 网络原样（`unknown`）
 * @returns 干净结构；任何结构性错误 ⇒ `undefined`（调用方显示错误，不静默空列表）
 */
export function parseToolPolicy(raw: unknown): ToolPolicySnapshot | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const body = raw as Record<string, unknown>;
	const baseTools = stringsOf(body['baseTools']);
	const unclaimed = stringsOf(body['unclaimed']);
	const common = stringsOf(body['common']);
	const groups = pairsOf(body['groups'], 'name', 'tools');
	const groupMembers = pairsOf(body['groupMembers'], 'group', 'templates');
	const templates = pairsOf(body['templates'], 'templateRef', 'tools');
	const effective = pairsOf(body['effective'], 'templateRef', 'tools');
	if (
		baseTools === undefined ||
		unclaimed === undefined ||
		common === undefined ||
		groups === undefined ||
		groupMembers === undefined ||
		templates === undefined ||
		effective === undefined
	) {
		return undefined;
	}
	return {
		baseTools,
		unclaimed,
		common,
		groups: groups.map((one) => ({ name: one.name, tools: one.items })),
		groupMembers: groupMembers.map((one) => ({ group: one.name, templates: one.items })),
		templates: templates.map((one) => ({ templateRef: one.name, tools: one.items })),
		effective: effective.map((one) => ({ templateRef: one.name, tools: one.items })),
	};
}

/**
 * 这个模板的**生效工具**（服务端算的）。
 *
 * @param snapshot 端点的干净结构
 * @param templateRef 模板 ref
 * @returns 工具名列表；端点里没有这个模板 ⇒ 空数组
 */
export function effectiveToolsFor(snapshot: ToolPolicySnapshot, templateRef: string): readonly string[] {
	return snapshot.effective.find((one) => one.templateRef === templateRef)?.tools ?? [];
}

/**
 * 按**来源**拆开这个模板的权限。
 *
 * 顺序（产品要读得懂的顺序）：BASE（恒可用）→ 未领卡档 → 通用档 → 命中的组（可多段）→ 模板独立档。
 * **空来源不进列表**（BASE 例外：它恒可用，永远列）。
 *
 * ⚠ 各来源之间**可能重叠**（例如同一个工具同时被 common 和某个组给出）。
 *   所以「各段之和」可能大于 `effective` 的条数；调用方要展示的是
 *   `effective` 的条数（服务端真值），分段只解释「为什么有这个工具」。
 *
 * @param snapshot 端点的干净结构
 * @param templateRef 模板 ref
 * @returns 非空来源的分组（保持稳定顺序）
 */
export function sourcesFor(snapshot: ToolPolicySnapshot, templateRef: string): readonly PolicySource[] {
	const out: PolicySource[] = [];

	out.push({ key: 'base', label: '恒可用（BASE）', tools: snapshot.baseTools, locked: true });
	if (snapshot.unclaimed.length > 0) {
		out.push({ key: 'unclaimed', label: '未领卡档', tools: snapshot.unclaimed, locked: false });
	}
	if (snapshot.common.length > 0) {
		out.push({ key: 'common', label: '通用档（领了卡就有）', tools: snapshot.common, locked: false });
	}
	/* 命中的组：这个模板在哪些组的成员里，那些组的增量就生效（可以多个组同时命中）。 */
	for (const member of snapshot.groupMembers) {
		if (!member.templates.includes(templateRef)) continue;
		const group = snapshot.groups.find((one) => one.name === member.group);
		if (group === undefined || group.tools.length === 0) continue;
		out.push({ key: `group:${member.group}`, label: `组「${member.group}」`, tools: group.tools, locked: false });
	}
	const own = snapshot.templates.find((one) => one.templateRef === templateRef);
	if (own !== undefined && own.tools.length > 0) {
		out.push({ key: 'template', label: '模板独立档', tools: own.tools, locked: false });
	}
	return out;
}

/**
 * 各来源工具名的**并集**（去重，保持首次出现顺序）。
 *
 * 用途：核对「分段加起来 = 生效集」——两者不一致时页面要提示
 * （说明服务端并集规则和分段视图不同步，是**该报出来的异常**，不许静默）。
 */
export function unionOfSources(sources: readonly PolicySource[]): readonly string[] {
	const out = new Set<string>();
	for (const source of sources) for (const tool of source.tools) out.add(tool);
	return [...out];
}

/**
 * 每个模板在 `effective` 里的工具数（给左栏列表显示）。
 *
 * @param snapshot 端点的干净结构
 * @returns `templateRef -> count`
 */
export function effectiveCounts(snapshot: ToolPolicySnapshot): ReadonlyMap<string, number> {
	const out = new Map<string, number>();
	for (const one of snapshot.effective) out.set(one.templateRef, one.tools.length);
	return out;
}
