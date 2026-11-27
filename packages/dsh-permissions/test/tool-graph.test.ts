/**
 * `tool-graph.ts` 的单测 —— 环检测是这一页的**唯一硬规则**，必须钉死。
 *
 * 用户 `2026-11-23`：
 * > 「创建一个组。他可以包含任何tool，或者包含任何别的组。只要不成环。」
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	addEdge,
	addNode,
	childrenOf,
	cyclePathIfAdded,
	emptyGraph,
	expandedToolIds,
	firstCycle,
	moveNode,
	nodeOf,
	parentsOf,
	pathBetween,
	removeEdge,
	removeNode,
	ancestorGroups,
	connectedGroupCount,
	layoutGraph,
	orthogonalPath,
	topoLayers,
} from '../src/pure/tool-graph.ts';
import type { ToolGraph } from '../src/pure/tool-graph.ts';

/** 造一个组节点。 */
function group(id: string, label = id): { id: string; kind: 'group'; label: string; x: number; y: number } {
	return { id, kind: 'group', label, x: 0, y: 0 };
}

/** 造一个工具节点。 */
function tool(id: string, label = id): { id: string; kind: 'tool'; label: string; source: string; x: number; y: number } {
	return { id, kind: 'tool', label, source: 'taskboard', x: 0, y: 0 };
}

/** 建一个带三个组 + 两个工具的图。 */
function fixture(): ToolGraph {
	let graph = emptyGraph();
	for (const node of [group('g:code', '编码工具'), group('g:write', '写操作'), group('g:file', '文件类')]) {
		graph = addNode(graph, node);
	}
	for (const node of [tool('t:update', 'update'), tool('t:write', 'write')]) graph = addNode(graph, node);

	const pairs: readonly (readonly [string, string])[] = [
		['g:code', 'g:write'],
		['g:write', 'g:file'],
		['g:code', 't:update'],
		['g:file', 't:write'],
	];
	for (const [from, to] of pairs) {
		const result = addEdge(graph, from, to);
		assert.equal(result.ok, true, `${from} → ${to} 应该能加`);
		if (result.ok) graph = result.graph;
	}
	return graph;
}

describe('addNode / moveNode / removeNode', () => {
	it('同 id 重复加是幂等（拖拽可能重复触发）', () => {
		let graph = addNode(emptyGraph(), group('g:a'));
		graph = addNode(graph, group('g:a', '换个名字'));
		assert.equal(graph.nodes.length, 1);
		assert.equal(nodeOf(graph, 'g:a')?.label, 'g:a', '先到的赢，不覆盖');
	});

	it('moveNode 只改坐标，不动边', () => {
		const graph = moveNode(fixture(), 'g:code', 120, 240);
		assert.equal(nodeOf(graph, 'g:code')?.x, 120);
		assert.equal(graph.edges.length, fixture().edges.length);
	});

	it('removeNode 连带删掉悬空边', () => {
		const graph = removeNode(fixture(), 'g:write');
		assert.equal(nodeOf(graph, 'g:write'), undefined);
		const dangling = graph.edges.filter((one) => one.from === 'g:write' || one.to === 'g:write');
		assert.deepEqual(dangling, [], '不该留下指向已删节点的边');
	});
});

describe('addEdge：入口校验', () => {
	it('节点不存在 ⇒ MISSING_NODE', () => {
		const result = addEdge(fixture(), 'g:nope', 'g:code');
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.code, 'MISSING_NODE');
	});

	it('工具不能当包含方 ⇒ NOT_GROUP', () => {
		const result = addEdge(fixture(), 't:update', 'g:code');
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.code, 'NOT_GROUP');
	});

	it('自环 ⇒ SELF_LOOP', () => {
		const result = addEdge(fixture(), 'g:code', 'g:code');
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.code, 'SELF_LOOP');
	});

	it('重复边 ⇒ DUPLICATE', () => {
		const result = addEdge(fixture(), 'g:code', 'g:write');
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.code, 'DUPLICATE');
	});
});

describe('addEdge：环检测（用户唯一的硬规则）', () => {
	it('g:file → g:code 会成环（code→write→file）⇒ CYCLE + 环路径', () => {
		const result = addEdge(fixture(), 'g:file', 'g:code');
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.code, 'CYCLE');
		/* 环路径首尾都是被加边的起点，闭合。 */
		assert.deepEqual(result.cycle, ['g:file', 'g:code', 'g:write', 'g:file']);
		assert.match(result.message, /会成环/);
		assert.match(result.message, /文件类/);
	});

	it('g:write → g:code 也会成环（code→write）', () => {
		const result = addEdge(fixture(), 'g:write', 'g:code');
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.code, 'CYCLE');
	});

	it('不成环的边照样能加（g:file → g:code 的兄弟组）', () => {
		let graph = addNode(fixture(), group('g:io', '网络访问'));
		const result = addEdge(graph, 'g:io', 'g:file');
		assert.equal(result.ok, true, '新组包一个已有组，不成环');
		if (result.ok) graph = result.graph;
		assert.deepEqual(
			childrenOf(graph, 'g:io').map((one) => one.id),
			['g:file'],
		);
	});

	it('同一个工具可以属于多个组（tag 语义，多父合法）', () => {
		const graph = fixture();
		/* g:write 与 g:code 都（间接）含 update？直接测多父：让 g:file 也直接含 t:update */
		const result = addEdge(graph, 'g:file', 't:update');
		assert.equal(result.ok, true, '工具多归属不该被拒 —— 只允许单归属就退化成树了');
	});

	it('长链环也会被抓住（A→B→C→D，加 D→A）', () => {
		let graph = emptyGraph();
		for (const id of ['a', 'b', 'c', 'd']) graph = addNode(graph, group(id));
		for (const [from, to] of [
			['a', 'b'],
			['b', 'c'],
			['c', 'd'],
		] as const) {
			const step = addEdge(graph, from, to);
			assert.equal(step.ok, true);
			if (step.ok) graph = step.graph;
		}
		const result = addEdge(graph, 'd', 'a');
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, 'CYCLE');
			assert.deepEqual(result.cycle, ['d', 'a', 'b', 'c', 'd']);
		}
	});
});

describe('pathBetween / cyclePathIfAdded', () => {
	it('pathBetween 给出从 from 到 to 的路径', () => {
		assert.deepEqual(pathBetween(fixture(), 'g:code', 't:write'), ['g:code', 'g:write', 'g:file', 't:write']);
	});

	it('到不了 ⇒ undefined', () => {
		assert.equal(pathBetween(fixture(), 't:write', 'g:code'), undefined);
	});

	it('cyclePathIfAdded 不成环时是 undefined', () => {
		assert.equal(cyclePathIfAdded(fixture(), 'g:file', 'g:io'), undefined);
	});
});

describe('expandedToolIds：成员数 ≠ 生效工具数', () => {
	it('组里含组时递归展开并去重', () => {
		const ids = expandedToolIds(fixture(), 'g:code');
		assert.deepEqual([...ids].sort(), ['t:update', 't:write']);
	});

	it('同一个工具被两条路包含也只算一次', () => {
		let graph = fixture();
		const extra = addEdge(graph, 'g:write', 't:update');
		assert.equal(extra.ok, true);
		if (extra.ok) graph = extra.graph;
		const ids = expandedToolIds(graph, 'g:code');
		assert.deepEqual([...ids].sort(), ['t:update', 't:write']);
	});
});

describe('parentsOf / removeEdge / firstCycle', () => {
	it('parentsOf 能返回多个父（多归属）', () => {
		let graph = fixture();
		const extra = addEdge(graph, 'g:file', 't:update');
		assert.equal(extra.ok, true);
		if (extra.ok) graph = extra.graph;
		const parents = parentsOf(graph, 't:update').map((one) => one.id);
		assert.deepEqual([...parents].sort(), ['g:code', 'g:file']);
	});

	it('removeEdge 只删那一条', () => {
		const before = fixture();
		const after = removeEdge(before, 'g:write', 'g:file');
		assert.equal(after.edges.length, before.edges.length - 1);
		assert.equal(nodeOf(after, 'g:file') !== undefined, true, '节点不受影响');
	});

	it('正常的图 firstCycle 返回 undefined', () => {
		assert.equal(firstCycle(fixture()), undefined);
	});
});

describe('topoLayers：拓扑分层（用户 2026-11-23「直接拓扑排序」）', () => {
	it('无父的组在第 0 层，子跟着往下', () => {
		const topo = topoLayers(fixture());
		const layer = (id: string): number => topo.layer.get(id) ?? -1;
		assert.equal(layer('g:code'), 0, '编码工具没有父 ⇒ 第 0 层');
		assert.equal(layer('g:write'), 1);
		assert.equal(layer('g:file'), 2);
		assert.equal(layer('t:write'), 3, '工具是叶子 ⇒ 更深');
	});

	it('所有边都从低层指向高层（严格递增）', () => {
		const graph = fixture();
		const topo = topoLayers(graph);
		for (const edge of graph.edges) {
			const from = topo.layer.get(edge.from) ?? -1;
			const to = topo.layer.get(edge.to) ?? -1;
			assert.ok(from < to, `边 ${edge.from}(${String(from)}) → ${edge.to}(${String(to)}) 必须严格递增`);
		}
	});

	it('多父时取 max(父层)+1', () => {
		let graph = addNode(fixture(), { id: 'g:extra', kind: 'group', label: '额外组', x: 0, y: 0 });
		/* t:write 原本只有 g:file（第 2 层）这个父；再加一个第 0 层的父 */
		const extra = addEdge(graph, 'g:extra', 't:write');
		assert.equal(extra.ok, true, '额外根组包一个叶子工具不该被拒');
		if (extra.ok) graph = extra.graph;
		const topo = topoLayers(graph);
		assert.equal(topo.layer.get('g:extra'), 0, '没有父的组在第 0 层');
		assert.equal(topo.layer.get('t:write'), 3, '父层是 0 和 2 ⇒ 取 2+1 = 3（不是 1）');
	});

	it('order 覆盖全部节点，且父都在子前面', () => {
		const graph = fixture();
		const topo = topoLayers(graph);
		assert.equal(topo.order.length, graph.nodes.length);
		const position = new Map(topo.order.map((id, index) => [id, index]));
		for (const edge of graph.edges) {
			assert.ok(
				(position.get(edge.from) ?? 1e9) < (position.get(edge.to) ?? -1),
				`${edge.from} 必须排在 ${edge.to} 前面`,
			);
		}
	});

	it('layoutGraph 把同层节点放在同一个 x 上', () => {
		const graph = fixture();
		const layout = layoutGraph(graph);
		const topo = topoLayers(graph);
		const byLayer = new Map<number, number[]>();
		for (const box of layout.boxes) {
			const bucket = byLayer.get(box.layer) ?? [];
			bucket.push(box.x);
			byLayer.set(box.layer, bucket);
		}
		for (const [layer, xs] of byLayer) {
			assert.equal(Math.max(...xs), Math.min(...xs), `第 ${String(layer)} 层的 x 应该一致`);
		}
		for (const box of layout.boxes) assert.equal(box.layer, topo.layer.get(box.id));
	});

	it('直角折线：横段永远向右（x2 > x1），不会回折', () => {
		const graph = fixture();
		assert.equal(layoutGraph(graph).boxes.length, graph.nodes.length);
		const layout = layoutGraph(graph);
		const boxOf = (id: string): (typeof layout.boxes)[number] => {
			const found = layout.boxes.find((one) => one.id === id);
			assert.ok(found !== undefined);
			return found;
		};
		for (const edge of graph.edges) {
			const from = boxOf(edge.from);
			const to = boxOf(edge.to);
			assert.ok(from.x + from.w < to.x, `边 ${edge.from}→${edge.to} 的源必须在目标左边`);
			assert.match(orthogonalPath(from, to), /^M \d+ \d+ H \d+ V \d+ H \d+$/);
		}
	});
});

describe('ancestorGroups / connectedGroupCount（用户 2026-11-23 的「直接所属组 + 连通组数」）', () => {
	it('不在任何组里 ⇒ 0', () => {
		let graph = emptyGraph();
		graph = addNode(graph, tool('t:lonely', 'lonely'));
		assert.equal(connectedGroupCount(graph, 't:lonely'), 0);
		assert.deepEqual(ancestorGroups(graph, 't:lonely'), []);
	});

	it('单父 ⇒ 1', () => {
		let graph = addNode(emptyGraph(), group('g:a'));
		graph = addNode(graph, tool('t:x'));
		const step = addEdge(graph, 'g:a', 't:x');
		assert.equal(step.ok, true);
		if (step.ok) graph = step.graph;
		assert.equal(connectedGroupCount(graph, 't:x'), 1);
		assert.deepEqual(ancestorGroups(graph, 't:x'), ['g:a']);
	});

	it('两个直接父组 ⇒ 2', () => {
		let graph = emptyGraph();
		for (const id of ['g:a', 'g:b']) graph = addNode(graph, group(id));
		graph = addNode(graph, tool('t:x'));
		for (const parent of ['g:a', 'g:b']) {
			const step = addEdge(graph, parent, 't:x');
			assert.equal(step.ok, true);
			if (step.ok) graph = step.graph;
		}
		assert.equal(connectedGroupCount(graph, 't:x'), 2);
		assert.deepEqual([...ancestorGroups(graph, 't:x')].sort(), ['g:a', 'g:b']);
	});

	it('菱形去重：A→B、A→C、B→D、C→D ⇒ D 的连通组数 = 3 不是 4', () => {
		let graph = emptyGraph();
		for (const id of ['g:a', 'g:b', 'g:c']) graph = addNode(graph, group(id));
		graph = addNode(graph, tool('t:d', 'd'));
		for (const [from, to] of [
			['g:a', 'g:b'],
			['g:a', 'g:c'],
			['g:b', 't:d'],
			['g:c', 't:d'],
		] as const) {
			const step = addEdge(graph, from, to);
			assert.equal(step.ok, true, `${from}→${to}`);
			if (step.ok) graph = step.graph;
		}
		assert.deepEqual([...ancestorGroups(graph, 't:d')].sort(), ['g:a', 'g:b', 'g:c']);
		assert.equal(connectedGroupCount(graph, 't:d'), 3, 'A 从两条路都能到 ⇒ 只算一次');
	});

	it('更长的链：A→B→C→tool ⇒ 3', () => {
		let graph = emptyGraph();
		for (const id of ['g:a', 'g:b', 'g:c']) graph = addNode(graph, group(id));
		graph = addNode(graph, tool('t:x'));
		for (const [from, to] of [
			['g:a', 'g:b'],
			['g:b', 'g:c'],
			['g:c', 't:x'],
		] as const) {
			const step = addEdge(graph, from, to);
			if (step.ok) graph = step.graph;
		}
		assert.equal(connectedGroupCount(graph, 't:x'), 3);
	});

	it('组也能算（组的祖先组，不含自己）', () => {
		let graph = emptyGraph();
		for (const id of ['g:a', 'g:b', 'g:c']) graph = addNode(graph, group(id));
		for (const [from, to] of [
			['g:a', 'g:b'],
			['g:b', 'g:c'],
		] as const) {
			const step = addEdge(graph, from, to);
			if (step.ok) graph = step.graph;
		}
		assert.equal(connectedGroupCount(graph, 'g:c'), 2, 'c 的祖先只有 b 和 a');
		assert.equal(connectedGroupCount(graph, 'g:a'), 0);
	});
});
