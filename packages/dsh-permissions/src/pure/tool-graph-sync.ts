/**
 * 组图的**线上文档 ↔ 画布模型**转换 + 失败原因的人话（issue #58）。
 *
 * ## 为什么要单独一个纯文件
 *
 * 这里的输入是**网络边界**（`GET/PUT /api/tool-graph` 的 JSON，`unknown`），
 * 输出决定画布画什么、保存报什么错。它必须能被 `node --test` 直接测
 * （Node 不认 `.tsx` ⇒ 不能住进 `GraphEditor.tsx`）。
 *
 * ## 两个方向
 *
 * ```
 *   GET  data { groups:[{name,column}], edges:[{from,to}] }  ──graphOfDoc──▶  ToolGraph（画布）
 *   PUT  body 同上                                          ◀─docOfGraph──   ToolGraph
 * ```
 *
 * ## 为什么不复用 core 的 `toolGraphOf()`
 *
 * core 的版本在 `@taskboard/core/tool-graph-doc`（没有子路径导出，包根会拉进
 * `yaml` / `node:fs`，浏览器半打不出来）。而客户端本来就必须**自己校验**
 * 一份不可信的响应 —— 直接把 `unknown` 当文档用是另一种「静默」。
 * 判定规则（环 / 自环 / 重复）仍只有服务端那一份；这里只做**投影**，不做判决。
 *
 * ## 工具不落库
 *
 * 工具清单的真值是 `GET /api/tools`。组图里只存「组 + 边」；边可以引用
 * 任何 `tool:<名>`。读回时**宿主已经没有的工具不会被静默丢弃**，
 * 而是留在图上并标成 `已失效`（`invalidTools`）—— 用户要能看见并决定删不删。
 */

import type { ToolGraph, ToolGraphEdge, ToolGraphNode } from './tool-graph.ts';

/* ────────────────────────── 线上文档 ────────────────────────── */

/** 图上的一个组（与服务端 `ToolGraphGroup` 同形）。 */
export interface GraphDocGroup {
	/** 组名（唯一）。 */
	readonly name: string;
	/** 画布列号提示（≥ 0 的整数）。当前布局由边算出，这个值只是随图存下的提示。 */
	readonly column: number;
}

/** 整图（与服务端 `ToolGraphDoc` 同形）。 */
export interface GraphDoc {
	readonly groups: readonly GraphDocGroup[];
	readonly edges: readonly ToolGraphEdge[];
}

/** 空图（合法的「还没有任何组」）。 */
export const EMPTY_GRAPH_DOC: GraphDoc = Object.freeze({
	groups: Object.freeze([]) as readonly GraphDocGroup[],
	edges: Object.freeze([]) as readonly ToolGraphEdge[],
});

/** 节点 id 的两个前缀（与服务端 `tool-graph-doc.ts` 一致）。 */
const GROUP_PREFIX = 'group:';
const TOOL_PREFIX = 'tool:';

/**
 * `group:编码工具` / `tool:write` → 显示名。
 *
 * @param id 节点 id
 */
export function labelOfNodeId(id: string): string {
	if (id.startsWith(GROUP_PREFIX)) return id.slice(GROUP_PREFIX.length);
	if (id.startsWith(TOOL_PREFIX)) return id.slice(TOOL_PREFIX.length);
	return id;
}

/** 组名 → 节点 id。 */
export function groupNodeIdOf(name: string): string {
	return `${GROUP_PREFIX}${name}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 校验并规范化一份**不可信**的图文档。
 *
 * 只做「能不能当文档用」的形状校验（数组 / 字符串 / 组名非空）；
 * 环、自环、重复边、悬空组的**判决在服务端**，这里不重写（AGENTS 3.6）。
 *
 * @param raw `response.json()` 的原值（`unknown`）
 * @returns 规范化文档；形状不对 ⇒ `undefined`（调用方显示错误，**不许静默当空图**）
 */
export function parseGraphDoc(raw: unknown): GraphDoc | undefined {
	if (!isRecord(raw)) return undefined;
	const rawGroups = raw['groups'];
	const rawEdges = raw['edges'];
	if (!Array.isArray(rawGroups) || !Array.isArray(rawEdges)) return undefined;

	const groups: GraphDocGroup[] = [];
	const names = new Set<string>();
	for (const entry of rawGroups) {
		if (!isRecord(entry)) continue;
		const rawName = entry['name'];
		if (typeof rawName !== 'string') continue;
		const name = rawName.trim();
		if (name === '' || names.has(name)) continue;
		const rawColumn = entry['column'];
		const column =
			typeof rawColumn === 'number' && Number.isInteger(rawColumn) && rawColumn >= 0 ? rawColumn : 0;
		names.add(name);
		groups.push({ name, column });
	}

	const edges: ToolGraphEdge[] = [];
	const seen = new Set<string>();
	for (const entry of rawEdges) {
		if (!isRecord(entry)) continue;
		const from = entry['from'];
		const to = entry['to'];
		if (typeof from !== 'string' || typeof to !== 'string') continue;
		if (!from.startsWith(GROUP_PREFIX) && !from.startsWith(TOOL_PREFIX)) continue;
		if (!to.startsWith(GROUP_PREFIX) && !to.startsWith(TOOL_PREFIX)) continue;
		/* 重复边留着只会让画布画两遍；服务端也拒（DUPLICATE）。这里直接去重。 */
		const key = `${from}\u0000${to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		edges.push({ from, to });
	}

	return { groups, edges };
}

/**
 * 文档 → 画布模型。
 *
 * @param doc 已校验的文档
 * @param knownToolNames 宿主当前注册的工具名（`GET /api/tools` 的投影）
 * @returns 画布图 + **已失效工具**的 id 集合（边仍在，只是打标记）
 */
export function graphOfDoc(
	doc: GraphDoc,
	knownToolNames: ReadonlySet<string>,
): { readonly graph: ToolGraph; readonly invalidTools: ReadonlySet<string> } {
	const nodes: ToolGraphNode[] = doc.groups.map((group) => ({
		id: groupNodeIdOf(group.name),
		kind: 'group',
		label: group.name,
	}));
	const seen = new Set(nodes.map((one) => one.id));
	const invalid = new Set<string>();

	for (const edge of doc.edges) {
		for (const id of [edge.from, edge.to]) {
			if (!id.startsWith(TOOL_PREFIX) || seen.has(id)) continue;
			seen.add(id);
			const name = labelOfNodeId(id);
			if (!knownToolNames.has(name)) invalid.add(id);
			nodes.push(
				Object.freeze({
					id,
					kind: 'tool' as const,
					label: name,
					/* 来源由清单决定；清单里没有 ⇒ 明确写「宿主已无此工具」，别装作知道。 */
					source: knownToolNames.has(name) ? undefined : '宿主已无此工具',
				}) as ToolGraphNode,
			);
		}
	}

	return { graph: { nodes, edges: doc.edges }, invalidTools: invalid };
}

/**
 * 画布模型 → 文档（PUT 的 body）。
 *
 * 只有组节点进 `groups`；工具节点**不落库**（工具会变，真值在 `/api/tools`）。
 * 边原样带上 —— 引用不存在工具的边是有意义的数据（下次那个工具回来就重新生效，
 * 或者用户能看到「已失效」并自己删）。
 *
 * @param graph 画布图
 * @param columnOf 组 id → 列号（省略 ⇒ 全 0）
 */
export function docOfGraph(graph: ToolGraph, columnOf?: (id: string) => number): GraphDoc {
	const groupIds = new Set(graph.nodes.filter((one) => one.kind === 'group').map((one) => one.id));
	const groups = graph.nodes
		.filter((one) => one.kind === 'group')
		.map((one) => ({
			name: one.label.trim(),
			column: Math.max(0, Math.trunc(columnOf?.(one.id) ?? 0)),
		}))
		.filter((one) => one.name !== '');
	/*
	 * 父节点不是组的边**不发**：服务端会以 NOT_GROUP 拒掉整张图（400），
	 * 而 UI 的交互（点组 / 勾工具）不可能造出这种边 —— 它只可能来自被改坏的本地状态。
	 * 静默丢一条边是这里唯一可接受的「静默」：它是**本地上不变量**的兜底，
	 * 服务端那份判定仍是唯一真值。
	 */
	const edges = graph.edges.filter((edge) => groupIds.has(edge.from));
	return { groups, edges };
}

/** 文档的稳定指纹（判断「和上次保存的一样吗」）。 */
export function docKey(doc: GraphDoc): string {
	return JSON.stringify({
		groups: doc.groups.map((one) => [one.name, one.column]),
		edges: doc.edges.map((one) => [one.from, one.to]),
	});
}

/**
 * 去掉**没有任何边引用**的工具节点（组永远留着）。
 *
 * 场景：从最后一个含它的组里取消勾选之后，画布上会留一个孤零零的工具卡。
 * 它不会落库（`docOfGraph` 只写组与边），但界面上看起来像「还在组里」。
 * ⇒ 取消勾选后调一次这个函数，让画布与将要保存的文档一致。
 *
 * @param graph 画布图
 */
export function pruneOrphanTools(graph: ToolGraph): ToolGraph {
	const referenced = new Set<string>();
	for (const edge of graph.edges) {
		referenced.add(edge.from);
		referenced.add(edge.to);
	}
	const nodes = graph.nodes.filter((one) => one.kind === 'group' || referenced.has(one.id));
	return nodes.length === graph.nodes.length ? graph : { nodes, edges: graph.edges };
}

/* ────────────────────────── 失败原因的人话 ────────────────────────── */

/** 一次失败的最小形状（`src/wire.ts` 的 `WireFailure` 结构子集）。 */
export interface GraphFailureLike {
	readonly status: number;
	/** 服务端信封的 message（已经是人话，但可能不够具体）。 */
	readonly message: string;
	/** 图判定码（`detail.code`）。 */
	readonly detailCode?: string | undefined;
	/** 成环时的环路径（首尾闭合）。 */
	readonly cycle?: readonly string[] | undefined;
}

/** 一条失败的人话。 */
export interface GraphFailureText {
	/** 判定码（有就显示，方便对着服务端日志找）。 */
	readonly code?: string;
	/** 给用户看的一句话。 */
	readonly message: string;
}

/**
 * 把「PUT 失败」翻译成人话 —— **成环必须画出完整环路径**。
 *
 * 用户 `2026-11-28`（issue #58）：「失败（400）要显示服务端给的 detail.code 人话：
 * 成环要把环路径显示出来（文件类 → 编码工具 → 文件类）」。
 *
 * @param failure 失败信封
 */
export function graphFailureText(failure: GraphFailureLike): GraphFailureText {
	const code = failure.detailCode;
	const cycle = failure.cycle;
	const cycleText =
		cycle === undefined || cycle.length === 0 ? undefined : cycle.map((id) => labelOfNodeId(id)).join(' → ');

	if (code === 'CYCLE') {
		return {
			code,
			message:
				cycleText === undefined
					? '会成环，服务端拒绝了这张图（它没给出环路径）'
					: `会成环：${cycleText}`,
		};
	}
	if (code === 'SELF_LOOP') return { code, message: '一个组不能包含自己' };
	if (code === 'DUPLICATE') return { code, message: '这条包含关系已经存在（可能是同一处改了两遍）' };
	if (code === 'NOT_GROUP') return { code, message: '只有组能包含别的节点；工具不能当父节点' };
	if (code === 'MISSING_NODE') return { code, message: '边引用了不存在的组（可能刚被删掉）' };
	if (code === 'DUPLICATE_GROUP') return { code, message: '组名重复了' };
	if (code === 'BAD_SHAPE') return { code, message: failure.message === '' ? '提交的图格式不对' : failure.message };

	/* 没有判定码（网络 / 鉴权 / 非图错误）⇒ 服务端 message 就是最好的解释。 */
	return {
		...(code === undefined ? {} : { code }),
		message: failure.message === '' ? `服务返回 HTTP ${String(failure.status)}` : failure.message,
	};
}
