/**
 * 工具组图**文档**（`toolGraph:v1`）的纯逻辑测试：校验 + 环路径 + 包含闭包。
 *
 * 用户 `2026-11-28`（issue #66）：
 * > 「组图现在是后端真值……服务端重新校验（成环/自环/重复/非组出边），
 * >   拒绝时 400 + 环路径。」
 * > 「一份环检测，不允许两份。」
 *
 * ⇒ 这里不重复实现判定，只钉住「文档 → 那份判定」这条接线：
 *   环路径必须**闭合**，闭包必须**递归展开**，坏形状必须**被拒而不是被吞**。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	EMPTY_TOOL_GRAPH,
	groupToolClosure,
	hasToolGraph,
	toolGraphCorruptKeyOf,
	toolGraphOf,
	validateToolGraphDoc,
} from '../src/tool-graph-doc.ts';

/* ────────────────────────── 夹具 ────────────────────────── */

/**
 * 合法图（issue #66 的例子）：
 *
 * ```
 * 编码工具 ──► 写操作 ──► 文件类 ──► write
 *     └──────────────────────────► update
 * ```
 */
function validDoc(): {
	groups: { name: string; column: number }[];
	edges: { from: string; to: string }[];
} {
	return {
		groups: [
			{ name: '编码工具', column: 0 },
			{ name: '写操作', column: 1 },
			{ name: '文件类', column: 2 },
		],
		edges: [
			{ from: 'group:编码工具', to: 'group:写操作' },
			{ from: 'group:写操作', to: 'group:文件类' },
			{ from: 'group:文件类', to: 'tool:write' },
			{ from: 'group:编码工具', to: 'tool:update' },
		],
	};
}

/* ────────────────────────── 校验：接受 ────────────────────────── */

describe('validateToolGraphDoc：合法文档', () => {
	it('原样接受，组名 trim、column 缺省补 0', () => {
		const result = validateToolGraphDoc({
			groups: [{ name: '  编码工具  ' }, { name: '写操作', column: 3 }],
			edges: [{ from: 'group:编码工具', to: 'tool:write' }],
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.deepEqual(result.doc.groups, [
			{ name: '编码工具', column: 0 },
			{ name: '写操作', column: 3 },
		]);
		assert.deepEqual(result.doc.edges, [{ from: 'group:编码工具', to: 'tool:write' }]);
	});

	it('空图也合法（清空是一种合法编辑）', () => {
		const result = validateToolGraphDoc({ groups: [], edges: [] });
		assert.equal(result.ok, true);
		if (result.ok) assert.deepEqual(result.doc, EMPTY_TOOL_GRAPH);
	});

	it('工具节点不必出现在 groups 里（工具清单不归 core 存）', () => {
		const result = validateToolGraphDoc({
			groups: [{ name: 'A', column: 0 }],
			edges: [{ from: 'group:A', to: 'tool:write' }],
		});
		assert.equal(result.ok, true);
	});
});

/* ────────────────────────── 校验：图规则 ────────────────────────── */

describe('validateToolGraphDoc：图规则（复用 tool-graph.ts 的判定）', () => {
	it('成环 ⇒ CYCLE + 闭合的环路径', () => {
		const doc = validDoc();
		doc.edges.push({ from: 'group:文件类', to: 'group:编码工具' });
		const result = validateToolGraphDoc(doc);
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.code, 'CYCLE');
		/* 首尾同一个 id ⇒ 直接能画成人话「文件类 → 编码工具 → 写操作 → 文件类」。 */
		assert.deepEqual(result.cycle, [
			'group:文件类',
			'group:编码工具',
			'group:写操作',
			'group:文件类',
		]);
		assert.equal(result.path, '/edges/4', '成环的边是第 4 条（0 起）');
		assert.match(result.message, /会成环/);
	});

	it('长链环也带路径（A→B→C，再加 C→A）', () => {
		const result = validateToolGraphDoc({
			groups: [
				{ name: 'A', column: 0 },
				{ name: 'B', column: 1 },
				{ name: 'C', column: 2 },
			],
			edges: [
				{ from: 'group:A', to: 'group:B' },
				{ from: 'group:B', to: 'group:C' },
				{ from: 'group:C', to: 'group:A' },
			],
		});
		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.equal(result.code, 'CYCLE');
		assert.deepEqual(result.cycle, ['group:C', 'group:A', 'group:B', 'group:C']);
	});

	it('自环 ⇒ SELF_LOOP', () => {
		const result = validateToolGraphDoc({
			groups: [{ name: 'A', column: 0 }],
			edges: [{ from: 'group:A', to: 'group:A' }],
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, 'SELF_LOOP');
			assert.equal(result.path, '/edges/0');
		}
	});

	it('非组出边（tool: 不能包含别的东西）⇒ NOT_GROUP', () => {
		const result = validateToolGraphDoc({
			groups: [{ name: 'A', column: 0 }],
			edges: [{ from: 'tool:write', to: 'group:A' }],
		});
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.code, 'NOT_GROUP');
	});

	it('重复边 ⇒ DUPLICATE', () => {
		const result = validateToolGraphDoc({
			groups: [{ name: 'A', column: 0 }],
			edges: [
				{ from: 'group:A', to: 'tool:write' },
				{ from: 'group:A', to: 'tool:write' },
			],
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, 'DUPLICATE');
			assert.equal(result.path, '/edges/1');
		}
	});

	it('组引用没在 groups 里声明 ⇒ MISSING_NODE', () => {
		const result = validateToolGraphDoc({
			groups: [{ name: 'A', column: 0 }],
			edges: [{ from: 'group:A', to: 'group:不存在' }],
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, 'MISSING_NODE');
			assert.equal(result.path, '/edges/0/to');
		}
	});
});

/* ────────────────────────── 校验：文档形状 ────────────────────────── */

describe('validateToolGraphDoc：坏形状一律拒（不静默）', () => {
	const cases: readonly { readonly name: string; readonly raw: unknown; readonly path: string }[] = [
		{ name: '不是对象', raw: null, path: '' },
		{ name: 'groups 不是数组', raw: { groups: {}, edges: [] }, path: '/groups' },
		{ name: 'edges 不是数组', raw: { groups: [], edges: {} }, path: '/edges' },
		{ name: '组名不是字符串', raw: { groups: [{ name: 1 }], edges: [] }, path: '/groups/0/name' },
		{ name: '组名为空', raw: { groups: [{ name: '   ' }], edges: [] }, path: '/groups/0/name' },
		{ name: 'column 不是整数', raw: { groups: [{ name: 'A', column: 1.5 }], edges: [] }, path: '/groups/0/column' },
		{ name: '边缺 from', raw: { groups: [], edges: [{ to: 'tool:x' }] }, path: '/edges/0/from' },
		{
			name: '节点 id 没有前缀',
			raw: { groups: [{ name: 'A' }], edges: [{ from: 'A', to: 'tool:x' }] },
			path: '/edges/0/from',
		},
		{
			name: '空工具名',
			raw: { groups: [{ name: 'A' }], edges: [{ from: 'group:A', to: 'tool:' }] },
			path: '/edges/0/to',
		},
	];

	for (const one of cases) {
		it(one.name, () => {
			const result = validateToolGraphDoc(one.raw);
			assert.equal(result.ok, false);
			if (result.ok) return;
			assert.equal(result.code, 'BAD_SHAPE');
			assert.equal(result.path, one.path);
		});
	}

	it('组名重复 ⇒ DUPLICATE_GROUP（不是静默去重）', () => {
		const result = validateToolGraphDoc({
			groups: [
				{ name: 'A', column: 0 },
				{ name: ' A ', column: 1 },
			],
			edges: [],
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.code, 'DUPLICATE_GROUP');
			assert.equal(result.path, '/groups/1/name');
		}
	});
});

/* ────────────────────────── 包含闭包 ────────────────────────── */

describe('groupToolClosure：包含闭包（issue #66 第 3 点）', () => {
	it('A 含 B、B 含 tool:x ⇒ A 的工具集含 x', () => {
		const checked = validateToolGraphDoc({
			groups: [
				{ name: 'A', column: 0 },
				{ name: 'B', column: 1 },
			],
			edges: [
				{ from: 'group:A', to: 'group:B' },
				{ from: 'group:B', to: 'tool:x' },
			],
		});
		assert.equal(checked.ok, true);
		if (!checked.ok) return;
		assert.deepEqual([...groupToolClosure(checked.doc, 'A')], ['x']);
		assert.deepEqual([...groupToolClosure(checked.doc, 'B')], ['x']);
		assert.deepEqual([...groupToolClosure(checked.doc, '没这个组')], [], '不存在的组 ⇒ 空（不炸）');
	});

	it('直接工具 + 子组工具都算，且去重（多父）', () => {
		const checked = validateToolGraphDoc(validDoc());
		assert.equal(checked.ok, true);
		if (!checked.ok) return;
		const closure = groupToolClosure(checked.doc, '编码工具');
		assert.deepEqual([...closure].sort(), ['update', 'write']);
	});

	it('菱形不会把同一个工具算两次', () => {
		const checked = validateToolGraphDoc({
			groups: [
				{ name: 'A', column: 0 },
				{ name: 'B', column: 1 },
				{ name: 'C', column: 2 },
			],
			edges: [
				{ from: 'group:A', to: 'group:B' },
				{ from: 'group:A', to: 'group:C' },
				{ from: 'group:B', to: 'tool:x' },
				{ from: 'group:C', to: 'tool:x' },
			],
		});
		assert.equal(checked.ok, true);
		if (!checked.ok) return;
		assert.deepEqual([...groupToolClosure(checked.doc, 'A')], ['x']);
	});

	it('「有图」的判据 = groups 非空（不是「有边」）', () => {
		assert.equal(hasToolGraph(EMPTY_TOOL_GRAPH), false);
		assert.equal(
			hasToolGraph({ groups: [{ name: 'A', column: 0 }], edges: [] }),
			true,
			'只有组、没有边也算有图（组还在画布上，只是还没连）',
		);
	});

	it('toolGraphOf 摊出画布模型（组 + 边引用到的工具）', () => {
		const checked = validateToolGraphDoc(validDoc());
		assert.equal(checked.ok, true);
		if (!checked.ok) return;
		const graph = toolGraphOf(checked.doc);
		const ids = graph.nodes.map((one) => one.id).sort();
		assert.deepEqual(ids, ['group:写操作', 'group:文件类', 'group:编码工具', 'tool:update', 'tool:write']);
		assert.equal(graph.edges.length, 4);
	});

	it('坏数据备份键是 toolGraph:corrupt:<时间戳>', () => {
		assert.equal(toolGraphCorruptKeyOf(1_700_000_000_000), 'toolGraph:corrupt:1700000000000');
	});
});
