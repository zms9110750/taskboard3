/**
 * 工具组图 —— 节点、包含边、环检测。**纯逻辑，不碰 DOM。**
 *
 * ## 这是什么
 *
 * 任务板的「工具权限」页里，组是 **tag 语义**：一个组可以包含**任何工具**，
 * 也可以包含**任何别的组**，只要不成环。同一个工具可以在多个组里（多父），
 * 所以它是**有向图**，不是树。
 *
 * ```
 *        编码工具 ──► 写操作 ──► 文件类 ──► write
 *             │                     │
 *             └─────────────────────┴──► edit
 * ```
 * 边 = 「包含」。组是唯一能出边的节点（工具不能包含别的东西）。
 *
 * ## 为什么环检测在这里而不是在 UI 里
 *
 * 用户 `2026-11-23`：
 * > 「创建一个组。他可以包含任何tool，或者包含任何别的组。只要不成环。」
 *
 * 环是**数据结构错误**，不是交互错误 —— UI 只是把它显示给人看。
 * 所以判定必须在纯逻辑里，UI 拖拽时**边拖边问**，保存时**再问一遍**兜底。
 *
 * ## 规则
 *
 * | 情况 | 结果 |
 * |---|---|
 * | 加 `from → to`，但 `from` 不是组 | 拒 `NOT_GROUP` |
 * | 自环（`from === to`） | 拒 `SELF_LOOP` |
 * | 这条边已存在 | 拒 `DUPLICATE` |
 * | `to` 已经能走回 `from` | 拒 `CYCLE`，**带回环路径** |
 * | 其余 | 接受 |
 *
 * **环路径的写法**：从被加的那条边开始绕一圈回到起点，
 * 比如 `编码工具 → 写操作 → 文件类 → 编码工具`（最后一步是闭合）。
 */

/** 一个节点：组或工具。 */
export interface ToolGraphNode {
	/** 稳定标识（组用 `group:xxx`，工具用 `tool:xxx`）。 */
	readonly id: string;
	/** `group` = 组（可以包含别人）；`tool` = 工具（只能被包含）。 */
	readonly kind: 'group' | 'tool';
	/** 显示名。 */
	readonly label: string;
	/** 工具来源（`taskboard` / `host`），只用于展示；组没有这个字段。 */
	readonly source?: string;
	/** 画布坐标（展示用；不影响环检测）。 */
	readonly x?: number;
	readonly y?: number;
}

/** 一条包含边：`from` 包含 `to`。 */
export interface ToolGraphEdge {
	readonly from: string;
	readonly to: string;
}

/** 图。不可变 —— 所有操作返回新对象。 */
export interface ToolGraph {
	readonly nodes: readonly ToolGraphNode[];
	readonly edges: readonly ToolGraphEdge[];
}

/** `addEdge` 的失败原因。 */
export type AddEdgeErrorCode = 'MISSING_NODE' | 'NOT_GROUP' | 'SELF_LOOP' | 'DUPLICATE' | 'CYCLE';

/** `addEdge` 的结果。 */
export type AddEdgeResult =
	| { readonly ok: true; readonly graph: ToolGraph }
	| {
			readonly ok: false;
			readonly code: AddEdgeErrorCode;
			/** 人话。 */
			readonly message: string;
			/** `CYCLE` 时给出环路径（首尾同一个 id，闭合）。 */
			readonly cycle?: readonly string[];
	  };

/** 空图。 */
export function emptyGraph(): ToolGraph {
	return { nodes: [], edges: [] };
}

/** 按 id 找节点。 */
export function nodeOf(graph: ToolGraph, id: string): ToolGraphNode | undefined {
	return graph.nodes.find((one) => one.id === id);
}

/**
 * 加一个节点。
 *
 * 已存在同 id 的节点 ⇒ 原图返回（幂等）。**不抛** —— 拖拽可能重复触发。
 */
export function addNode(graph: ToolGraph, node: ToolGraphNode): ToolGraph {
	if (nodeOf(graph, node.id) !== undefined) return graph;
	return { nodes: [...graph.nodes, node], edges: graph.edges };
}

/** 移动节点（只改坐标）。 */
export function moveNode(graph: ToolGraph, id: string, x: number, y: number): ToolGraph {
	return {
		nodes: graph.nodes.map((one) => (one.id === id ? { ...one, x, y } : one)),
		edges: graph.edges,
	};
}

/** 删节点；**连带删掉它相关的边**（否则会留下悬空边）。 */
export function removeNode(graph: ToolGraph, id: string): ToolGraph {
	return {
		nodes: graph.nodes.filter((one) => one.id !== id),
		edges: graph.edges.filter((one) => one.from !== id && one.to !== id),
	};
}

/**
 * 加一条包含边 —— **环检测在入口处**。
 *
 * 判定顺序就是执行顺序：先看节点在不在，再看 `from` 是不是组，
 * 再看自环 / 重复，**最后才查环**（查环最贵）。
 */
export function addEdge(graph: ToolGraph, from: string, to: string): AddEdgeResult {
	const fromNode = nodeOf(graph, from);
	const toNode = nodeOf(graph, to);
	if (fromNode === undefined || toNode === undefined) {
		return { ok: false, code: 'MISSING_NODE', message: '节点不存在' };
	}
	if (fromNode.kind !== 'group') {
		return { ok: false, code: 'NOT_GROUP', message: `「${fromNode.label}」不是组，工具不能包含别的东西` };
	}
	if (from === to) {
		return { ok: false, code: 'SELF_LOOP', message: `「${fromNode.label}」不能包含自己` };
	}
	if (graph.edges.some((one) => one.from === from && one.to === to)) {
		return { ok: false, code: 'DUPLICATE', message: `「${fromNode.label}」已经包含「${toNode.label}」` };
	}

	const cycle = cyclePathIfAdded(graph, from, to);
	if (cycle !== undefined) {
		return {
			ok: false,
			code: 'CYCLE',
			message: `会成环：${cycle.map((id) => nodeOf(graph, id)?.label ?? id).join(' → ')}`,
			cycle,
		};
	}

	return { ok: true, graph: { nodes: graph.nodes, edges: [...graph.edges, { from, to }] } };
}

/** 删一条边。不存在 ⇒ 原图返回。 */
export function removeEdge(graph: ToolGraph, from: string, to: string): ToolGraph {
	return {
		nodes: graph.nodes,
		edges: graph.edges.filter((one) => !(one.from === from && one.to === to)),
	};
}

/**
 * 如果加 `from → to` 会成环，返回**闭合的环路径**；否则 `undefined`。
 *
 * 判据：加边之后环存在 ⟺ **当前图里 `to` 能走到 `from`**。
 * 路径首尾都是 `from`，直接能拿去显示成人话。
 */
export function cyclePathIfAdded(graph: ToolGraph, from: string, to: string): readonly string[] | undefined {
	const path = pathBetween(graph, to, from);
	if (path === undefined) return undefined;
	return [from, ...path];
}

/**
 * 从 `from` 到 `to` 的一条路径（BFS，边是 `from → to` 方向）。没有 ⇒ `undefined`。
 *
 * 用 BFS 不是 DFS：**最短路径让环提示更好读**（用户要看的是「怎么绕回去的」）。
 */
export function pathBetween(graph: ToolGraph, from: string, to: string): readonly string[] | undefined {
	if (from === to) return [from];

	const queue: string[] = [from];
	const cameFrom = new Map<string, string>();
	const seen = new Set<string>([from]);

	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) break;

		for (const edge of graph.edges) {
			if (edge.from !== current) continue;
			const next = edge.to;
			if (seen.has(next)) continue;
			seen.add(next);
			cameFrom.set(next, current);

			if (next === to) {
				/* 回溯出路径。 */
				const path = [to];
				let cursor = to;
				while (cursor !== from) {
					const parent = cameFrom.get(cursor);
					if (parent === undefined) break;
					path.unshift(parent);
					cursor = parent;
				}
				return path;
			}

			queue.push(next);
		}
	}

	return undefined;
}

/** 直接成员（一层的子节点）。 */
export function childrenOf(graph: ToolGraph, id: string): readonly ToolGraphNode[] {
	const ids = graph.edges.filter((one) => one.from === id).map((one) => one.to);
	return graph.nodes.filter((one) => ids.includes(one.id));
}

/** 直接父节点（谁包含它）。多父是合法的。 */
export function parentsOf(graph: ToolGraph, id: string): readonly ToolGraphNode[] {
	const ids = graph.edges.filter((one) => one.to === id).map((one) => one.from);
	return graph.nodes.filter((one) => ids.includes(one.id));
}

/**
 * 展开后这个组真正贡献的**工具**（递归展开子组，工具去重）。
 *
 * 这是「成员数」和「生效工具数」的区别：组里含组时两者不等。
 */
export function expandedToolIds(graph: ToolGraph, id: string): readonly string[] {
	const out = new Set<string>();
	const seenGroups = new Set<string>();

	const walk = (groupId: string): void => {
		if (seenGroups.has(groupId)) return; // 防御：正常图无环，这里只是兜底
		seenGroups.add(groupId);
		for (const child of childrenOf(graph, groupId)) {
			if (child.kind === 'tool') out.add(child.id);
			else walk(child.id);
		}
	};

	walk(id);
	return [...out];
}

/**
 * 整图校验 —— 保存前的兜底。返回第一个环（正常构建路径下不该有）。
 */
export function firstCycle(graph: ToolGraph): readonly string[] | undefined {
	const visiting = new Set<string>();
	const done = new Set<string>();
	let found: readonly string[] | undefined;

	const walk = (id: string, stack: readonly string[]): boolean => {
		if (done.has(id)) return false;
		if (visiting.has(id)) {
			const at = stack.indexOf(id);
			found = [...stack.slice(at), id];
			return true;
		}
		visiting.add(id);
		for (const edge of graph.edges) {
			if (edge.from !== id) continue;
			if (walk(edge.to, [...stack, id])) return true;
		}
		visiting.delete(id);
		done.add(id);
		return false;
	};

	for (const node of graph.nodes) {
		if (walk(node.id, [])) break;
	}
	return found;
}


/* ══════════════════════════════════════════════════════════
   拓扑分层 + 布局
   ══════════════════════════════════════════════════════════ */

/** 拓扑分层的失败原因。 */
export type TopoError = 'CYCLE';

/** 一次拓扑分层的结果。 */
export interface TopoResult {
	/** 节点 id → 层号（0 起）。 */
	readonly layer: ReadonlyMap<string, number>;
	/** 按层号排好的节点 id（同层保持输入顺序）。 */
	readonly order: readonly string[];
	/** 有环时非空（正常构建路径下不该出现）。 */
	readonly cycle?: readonly string[] | undefined;
}

/**
 * Kahn 拓扑排序 + 分层：`layer(n) = max(父层) + 1`，无父节点为 0。
 *
 * 用户 `2026-11-23`：
 * > 「都到图了，为什么还是扭曲的线条。直接拓扑排序啊。」
 *
 * 分层是**布局的唯一依据** —— 边只从低层指向高层，所以画出来不会有回折。
 */
export function topoLayers(graph: ToolGraph): TopoResult {
	const indegree = new Map<string, number>();
	for (const node of graph.nodes) indegree.set(node.id, 0);
	for (const edge of graph.edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);

	const layer = new Map<string, number>();
	for (const node of graph.nodes) layer.set(node.id, 0);

	const queue = graph.nodes.filter((one) => (indegree.get(one.id) ?? 0) === 0).map((one) => one.id);
	const order: string[] = [];
	let guard = 0;
	const limit = graph.nodes.length * graph.nodes.length + graph.nodes.length + 4;

	while (queue.length > 0) {
		guard += 1;
		if (guard > limit) break; // 防御性：不该发生
		const current = queue.shift();
		if (current === undefined) break;
		order.push(current);

		for (const edge of graph.edges) {
			if (edge.from !== current) continue;
			layer.set(edge.to, Math.max(layer.get(edge.to) ?? 0, (layer.get(current) ?? 0) + 1));
			const left = (indegree.get(edge.to) ?? 0) - 1;
			indegree.set(edge.to, left);
			if (left === 0) queue.push(edge.to);
		}
	}

	if (order.length !== graph.nodes.length) {
		return { layer, order, cycle: firstCycle(graph) };
	}
	return { layer, order };
}

/** 一个节点的摆放结果。 */
export interface LayoutBox {
	readonly id: string;
	readonly layer: number;
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
}

/** 布局尺寸参数（画布坐标）。 */
export interface LayoutOptions {
	readonly gapX: number;
	readonly gapY: number;
	readonly paddingX: number;
	readonly paddingY: number;
	readonly groupW: number;
	readonly groupH: number;
	readonly toolW: number;
	readonly toolH: number;
}

/** 默认布局参数 —— 和 CSS 里的节点尺寸一致。 */
export const DEFAULT_LAYOUT: LayoutOptions = {
	gapX: 150,
	gapY: 26,
	paddingX: 40,
	paddingY: 30,
	groupW: 172,
	groupH: 46,
	toolW: 146,
	toolH: 34,
};

/**
 * 按拓扑层摆放节点：**x 由层号决定，y 由同层内的次序决定**。
 *
 * 同层内先放组、再放工具，各自保持输入顺序 —— 这样父组在左、叶子在右，
 * 边不会往回绕。
 */
export function layoutGraph(
	graph: ToolGraph,
	options: LayoutOptions = DEFAULT_LAYOUT,
): { readonly boxes: readonly LayoutBox[]; readonly width: number; readonly height: number } {
	const topo = topoLayers(graph);
	const byLayer = new Map<number, ToolGraphNode[]>();
	for (const node of graph.nodes) {
		const layer = topo.layer.get(node.id) ?? 0;
		const bucket = byLayer.get(layer) ?? [];
		bucket.push(node);
		byLayer.set(layer, bucket);
	}

	const boxes: LayoutBox[] = [];
	let width = 0;
	let height = 0;

	for (const [layer, nodes] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
		/* 同层：先组后工具，各自按输入顺序。 */
		const sorted = [...nodes].sort((a, b) => {
			if (a.kind !== b.kind) return a.kind === 'group' ? -1 : 1;
			return graph.nodes.indexOf(a) - graph.nodes.indexOf(b);
		});

		const columnX = options.paddingX + layer * (options.groupW + options.gapX);
		let cursorY = options.paddingY;
		for (const node of sorted) {
			const w = node.kind === 'group' ? options.groupW : options.toolW;
			const h = node.kind === 'group' ? options.groupH : options.toolH;
			boxes.push({ id: node.id, layer, x: columnX, y: cursorY, w, h });
			cursorY += h + options.gapY;
		}
		width = Math.max(width, columnX + options.groupW);
		height = Math.max(height, cursorY);
	}

	return { boxes, width: width + options.paddingX, height: height + options.paddingY };
}

/**
 * 直角折线：源右边缘 → 中间竖线 → 目标左边缘。
 *
 * 用直角不用贝塞尔 —— 用户原话「为什么还是扭曲的线条」。
 * 因为边一定从低层指向高层，折线的横段永远向右，不会回折。
 */
export function orthogonalPath(from: LayoutBox, to: LayoutBox): string {
	const x1 = from.x + from.w;
	const y1 = from.y + from.h / 2;
	const x2 = to.x;
	const y2 = to.y + to.h / 2;
	const midX = Math.round((x1 + x2) / 2);
	return `M ${String(x1)} ${String(y1)} H ${String(midX)} V ${String(y2)} H ${String(x2)}`;
}

/**
 * 一个节点的**全部祖先组**（直接 + 间接，去重）。
 *
 * 用户 `2026-11-23`：
 * > 「描述直接所属组（复数）和一个数量描述连通组的数量（包括直接和间接。只有数字）」
 *
 * 「连通」不是「深度」：同一个组从两条路都能到达时**只算一次**。
 * 例如菱形 A→B、A→C、B→D、C→D，D 的祖先组是 {B, C, A} ⇒ 3，不是 4。
 */
export function ancestorGroups(graph: ToolGraph, nodeId: string): readonly string[] {
	const seen = new Set<string>();
	const queue: string[] = [nodeId];

	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) break;
		for (const edge of graph.edges) {
			if (edge.to !== current) continue;
			if (seen.has(edge.from)) continue;
			seen.add(edge.from);
			queue.push(edge.from);
		}
	}

	return [...seen];
}

/** 包含该节点的组个数（直接 + 间接，去重）。没有被任何组包含 ⇒ 0。 */
export function connectedGroupCount(graph: ToolGraph, nodeId: string): number {
	return ancestorGroups(graph, nodeId).length;
}
