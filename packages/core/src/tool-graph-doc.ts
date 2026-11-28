/**
 * 工具组图的**落库文档**（kv 键 `toolGraph:v1`）—— 形状、校验、包含闭包。
 *
 * ## 为什么不塞进 `tool-graph.ts`
 *
 * `tool-graph.ts` 是**画布模型**：节点有 `label` / `x` / `y`，边是任意的
 * `id → id`。那是 UI 的视图，坐标与显示名跟后端无关。
 *
 * 本文件是**持久化契约**：只有组（`{ name, column }`）和包含边
 * （`group:<名>` / `tool:<名>`）。工具**不落库** —— 工具清单的真值在
 * `@taskboard/dsh-agent-guard` 的 `/api/tools`，core 存一份就会立刻漂。
 *
 * ```
 * { "groups": [{ "name": "编码工具", "column": 0 }],
 *   "edges": [{ "from": "group:编码工具", "to": "group:写操作" },
 *             { "from": "group:编码工具", "to": "tool:write" }] }
 * ```
 *
 * ## 一条判据：环检测只有一份
 *
 * 用户 `2026-11-28`（issue #66）：「一份环检测，不允许两份。」
 * ⇒ 这里**不重写**判定，而是把文档摊成 `ToolGraph` 之后逐条走
 *   `tool-graph.ts` 的 `addEdge()` —— 非组出边 / 自环 / 重复边 / 成环
 *   四条规则连同**环路径**都来自那一处实现。
 *
 * ## 为什么校验放在 core 而不是路由
 *
 * 与 `permission.ts` 开头那条不变量一致：**校验在 core**。
 * 路由只做「JSON → 交给 core」，AI 工具将来写图也走同一个方法 ——
 * 两边各写一份校验就必然有一边漏规则。
 */

import {
	addEdge,
	expandedToolIds,
	type AddEdgeErrorCode,
	type ToolGraph,
	type ToolGraphEdge,
	type ToolGraphNode,
} from './tool-graph.ts';

/* ────────────────────────── 键与节点前缀 ────────────────────────── */

/**
 * 组图的 kv 键。
 *
 * ⚠ 与 `toolPolicy:v2` **分键存**：策略是「模板 → 工具增量」，图是
 *   「组 → 工具/组」。两者生命周期不同（图可以整体替换），
 *   合在一个 JSON 里会让每次改图都重写策略。
 */
export const TOOL_GRAPH_KEY = 'toolGraph:v1';

/**
 * 坏数据的备份键前缀：`toolGraph:corrupt:<时间戳>`。
 *
 * 判据：坏数据可能是用户手改的、也可能是旧版本写的 —— **不许静默覆盖**。
 * 第一次写入前先把它原样挪到这个键，出问题时还能找回来。
 */
export function toolGraphCorruptKeyOf(at: number): string {
	return `toolGraph:corrupt:${String(at)}`;
}

/** 组节点的 id 前缀。 */
export const GROUP_PREFIX = 'group:';

/** 工具节点的 id 前缀。 */
export const TOOL_PREFIX = 'tool:';

/* ────────────────────────── 文档形状 ────────────────────────── */

/** 图上的一个组。 */
export interface ToolGraphGroup {
	/** 组名（唯一，去掉首尾空白后非空）。 */
	readonly name: string;
	/** 画布列号（≥ 0 的整数；省略按 0）。 */
	readonly column: number;
}

/**
 * 落库 / 线上传输的整图。
 *
 * ⚠ 与 `ToolGraph` 的区别：这里**没有 nodes**。组由 `groups` 声明，
 *   工具由边引用（`tool:<名>`）按需出现 —— 工具清单不归 core 存。
 */
export interface ToolGraphDoc {
	readonly groups: readonly ToolGraphGroup[];
	readonly edges: readonly ToolGraphEdge[];
}

/**
 * 空图（kv 里没有这个键 / 值坏了）。
 *
 * ⚠ 冻结：它会被 `getToolGraph()` 直接交出去，调用方不能改到缓存。
 */
export const EMPTY_TOOL_GRAPH: ToolGraphDoc = Object.freeze({
	groups: Object.freeze([]) as readonly ToolGraphGroup[],
	edges: Object.freeze([]) as readonly ToolGraphEdge[],
});

/**
 * 整图校验的失败码。
 *
 * 后五个**直接来自** `AddEdgeErrorCode`（环检测那套），本文件只加两个
 * 文档层自己的：形状不对、组名重复。
 */
export type ToolGraphDocErrorCode = AddEdgeErrorCode | 'BAD_SHAPE' | 'DUPLICATE_GROUP';

/** 整图校验 / 保存的结果。 */
export type ToolGraphDocResult =
	| { readonly ok: true; readonly doc: ToolGraphDoc }
	| {
			readonly ok: false;
			readonly code: ToolGraphDocErrorCode;
			/** 人话。 */
			readonly message: string;
			/** 出错位置（JSON Pointer 风格；空串 = 整个 body）。 */
			readonly path: string;
			/** `CYCLE` 时给出环路径（首尾同一个 id，闭合）。 */
			readonly cycle?: readonly string[];
	  };

/* ────────────────────────── 形状工具 ────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 造一个失败。`cycle` 缺省时**不写这个键**（`exactOptionalPropertyTypes`）。 */
function failureOf(
	code: ToolGraphDocErrorCode,
	message: string,
	path: string,
	cycle?: readonly string[],
): ToolGraphDocResult {
	return { ok: false, code, message, path, ...(cycle === undefined ? {} : { cycle }) };
}

/** 文档里的组名 ↔ 节点 id。 */
function groupNodeIdOf(name: string): string {
	return `${GROUP_PREFIX}${name}`;
}

/** `tool:<名>` → `<名>`。 */
function toolNameOfId(id: string): string {
	return id.startsWith(TOOL_PREFIX) ? id.slice(TOOL_PREFIX.length) : id;
}

/* ────────────────────────── 校验 ────────────────────────── */

/**
 * 校验一份**不可信**的图文档（kv 读回 / `PUT /api/tool-graph` 的 body）。
 *
 * 判定顺序：形状 → 组名唯一 → 节点归属（`group:` 必须在 `groups` 里声明）
 * → 逐条边走 `addEdge()`（非组出边 / 自环 / 重复 / 成环）。
 *
 * @returns 成功时是**规范化并冻结**的文档（组名已 trim、`column` 缺省补 0）
 */
export function validateToolGraphDoc(raw: unknown): ToolGraphDocResult {
	if (!isRecord(raw)) return failureOf('BAD_SHAPE', '工具组图必须是 { groups, edges } 对象。', '');

	const rawGroups = raw['groups'];
	if (!Array.isArray(rawGroups)) return failureOf('BAD_SHAPE', 'groups 必须是数组。', '/groups');
	const rawEdges = raw['edges'];
	if (!Array.isArray(rawEdges)) return failureOf('BAD_SHAPE', 'edges 必须是数组。', '/edges');

	/* ── 1. 组：名字 + 列号 ── */
	const groups: ToolGraphGroup[] = [];
	const groupNames = new Set<string>();
	for (const [index, entry] of rawGroups.entries()) {
		const at = `/groups/${String(index)}`;
		if (!isRecord(entry)) return failureOf('BAD_SHAPE', '组必须是 { name, column } 对象。', at);

		const rawName = entry['name'];
		if (typeof rawName !== 'string') return failureOf('BAD_SHAPE', '组名必须是字符串。', `${at}/name`);
		const name = rawName.trim();
		if (name === '') return failureOf('BAD_SHAPE', '组名不能为空。', `${at}/name`);
		if (groupNames.has(name)) {
			return failureOf('DUPLICATE_GROUP', `组名「${name}」出现了两次。`, `${at}/name`);
		}

		const rawColumn = entry['column'];
		if (
			rawColumn !== undefined &&
			(typeof rawColumn !== 'number' || !Number.isInteger(rawColumn) || rawColumn < 0)
		) {
			return failureOf('BAD_SHAPE', 'column 必须是 ≥ 0 的整数。', `${at}/column`);
		}

		groupNames.add(name);
		groups.push(Object.freeze({ name, column: rawColumn ?? 0 }));
	}

	/* ── 2. 边：先建节点，再逐条加（判定复用 tool-graph.ts） ── */
	const edges: ToolGraphEdge[] = [];
	const nodes = new Map<string, ToolGraphNode>();
	for (const name of groupNames) {
		const id = groupNodeIdOf(name);
		nodes.set(id, { id, kind: 'group', label: name });
	}

	for (const [index, entry] of rawEdges.entries()) {
		const at = `/edges/${String(index)}`;
		if (!isRecord(entry)) return failureOf('BAD_SHAPE', '边必须是 { from, to } 对象。', at);

		const rawFrom = entry['from'];
		const rawTo = entry['to'];
		if (typeof rawFrom !== 'string') return failureOf('BAD_SHAPE', 'from 必须是字符串。', `${at}/from`);
		if (typeof rawTo !== 'string') return failureOf('BAD_SHAPE', 'to 必须是字符串。', `${at}/to`);

		for (const [side, id] of [
			['from', rawFrom],
			['to', rawTo],
		] as const) {
			if (id.startsWith(GROUP_PREFIX)) {
				if (id === GROUP_PREFIX) return failureOf('BAD_SHAPE', '组节点 id 不能为空（要写成 group:<组名>）。', `${at}/${side}`);
				/* 没声明的组 ⇒ 悬空引用。这条在下面 addEdge 之前判，错误码更具体。 */
				if (!groupNames.has(id.slice(GROUP_PREFIX.length))) {
					return failureOf('MISSING_NODE', `组「${id.slice(GROUP_PREFIX.length)}」不在 groups 里。`, `${at}/${side}`);
				}
				continue;
			}
			if (id.startsWith(TOOL_PREFIX)) {
				if (id === TOOL_PREFIX) return failureOf('BAD_SHAPE', '工具节点 id 不能为空（要写成 tool:<工具名>）。', `${at}/${side}`);
				/* 工具节点按需出现：它在边里被引用就算存在（工具清单不归 core 存）。 */
				if (!nodes.has(id)) nodes.set(id, { id, kind: 'tool', label: toolNameOfId(id) });
				continue;
			}
			return failureOf(
				'BAD_SHAPE',
				`节点 id「${id}」必须以 ${GROUP_PREFIX} 或 ${TOOL_PREFIX} 开头。`,
				`${at}/${side}`,
			);
		}

		edges.push(Object.freeze({ from: rawFrom, to: rawTo }));
	}

	/* ── 3. 逐条边走唯一那份判定 ── */
	let graph: ToolGraph = { nodes: [...nodes.values()], edges: [] };
	for (const [index, edge] of edges.entries()) {
		const added = addEdge(graph, edge.from, edge.to);
		if (!added.ok) {
			return failureOf(added.code, added.message, `/edges/${String(index)}`, added.cycle);
		}
		graph = added.graph;
	}

	return {
		ok: true,
		doc: Object.freeze({ groups: Object.freeze(groups), edges: Object.freeze(edges) }),
	};
}

/* ────────────────────────── 查询 ────────────────────────── */

/**
 * 「有图」的判据：**`groups` 非空**（用户口径，不是「有边」）。
 *
 * 无图 ⇒ `effectiveToolsOf` 回退旧行为（`store.groups[g]` 的增量）。
 * 见 `permission.ts` 的「命中的组」那一段。
 */
export function hasToolGraph(doc: ToolGraphDoc): boolean {
	return doc.groups.length > 0;
}

/** 把文档摊成画布用的 `ToolGraph`（纯转换，不校验）。 */
export function toolGraphOf(doc: ToolGraphDoc): ToolGraph {
	const nodes = new Map<string, ToolGraphNode>();
	for (const group of doc.groups) {
		const id = groupNodeIdOf(group.name);
		nodes.set(id, { id, kind: 'group', label: group.name });
	}
	for (const edge of doc.edges) {
		for (const id of [edge.from, edge.to]) {
			if (!id.startsWith(TOOL_PREFIX)) continue;
			if (nodes.has(id)) continue;
			nodes.set(id, { id, kind: 'tool', label: toolNameOfId(id) });
		}
	}
	return { nodes: [...nodes.values()], edges: doc.edges };
}

/**
 * 一个组的**包含闭包**工具集（裸工具名，稳定顺序）。
 *
 * 定义（issue #66）：直接包含的工具 ∪ 被包含组的工具集，递归展开；
 * `visited` 防环（正常图无环 —— 校验保证，这里只是兜底）。
 *
 * ⚠ 顺序 = 深度优先展开顺序。`effectiveToolsOf` 用 `Set` 去重，
 *   所以顺序只影响「新工具出现在哪个位置」，不影响集合本身。
 *
 * 例：`编码工具 → 写操作 → tool:write` ⇒ `['write']`。
 */
export function groupToolClosure(doc: ToolGraphDoc, groupName: string): readonly string[] {
	const ids = expandedToolIds(toolGraphOf(doc), groupNodeIdOf(groupName));
	return Object.freeze(ids.map((id) => toolNameOfId(id)));
}
