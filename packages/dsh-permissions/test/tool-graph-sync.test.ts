/**
 * 组图**线上文档 ↔ 画布模型**的单测（issue #58）。
 *
 * 这里钉三件事：
 *
 * 1. **解析不能吞数据**：一份合法文档进去，组 / 边要原样出来（顺序也不动）；
 * 2. **失效工具要显形**：边引用了宿主已经没有的工具 ⇒ 边**还在**，工具进 `invalidTools`
 *    （「静默丢弃」是 issue #58 明令禁止的）；
 * 3. **回写可逆**：`doc → graph → doc` 必须得到同一份文档（否则每次编辑都触发一次
 *    「看起来有改动」的保存，或者把服务端的列号冲掉）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	EMPTY_GRAPH_DOC,
	docKey,
	docOfGraph,
	graphFailureText,
	graphOfDoc,
	groupNodeIdOf,
	labelOfNodeId,
	parseGraphDoc,
	pruneOrphanTools,
} from '../src/pure/tool-graph-sync.ts';

const DOC = {
	groups: [
		{ name: '编码工具', column: 0 },
		{ name: '写操作', column: 1 },
	],
	edges: [
		{ from: 'group:编码工具', to: 'group:写操作' },
		{ from: 'group:编码工具', to: 'tool:write' },
	],
};

describe('parseGraphDoc', () => {
	it('合法文档：组 / 边原样投影（顺序不动）', () => {
		assert.deepEqual(parseGraphDoc(DOC), DOC);
	});

	it('不是对象 / 缺数组 ⇒ undefined（调用方显示错误，不当空图）', () => {
		assert.equal(parseGraphDoc(null), undefined);
		assert.equal(parseGraphDoc('{groups:[]}'), undefined);
		assert.equal(parseGraphDoc({}), undefined);
		assert.equal(parseGraphDoc({ groups: [], edges: 'nope' }), undefined);
	});

	it('组名 trim；重名 / 空名丢弃；列号坏值回落 0', () => {
		const parsed = parseGraphDoc({
			groups: [
				{ name: '  编码工具  ', column: 2 },
				{ name: '编码工具' },
				{ name: '   ' },
				{ name: '写操作', column: -1 },
				{ name: '读操作', column: 1.5 },
				{ name: 42 },
			],
			edges: [],
		});
		assert.deepEqual(parsed, {
			groups: [
				{ name: '编码工具', column: 2 },
				{ name: '写操作', column: 0 },
				{ name: '读操作', column: 0 },
			],
			edges: [],
		});
	});

	it('边：坏条目丢弃；重复边去重；非 group:/tool: 前缀丢弃', () => {
		const parsed = parseGraphDoc({
			groups: [{ name: 'A', column: 0 }],
			edges: [
				{ from: 'group:A', to: 'tool:read' },
				{ from: 'group:A', to: 'tool:read' },
				{ from: 'group:A', to: 'nope:x' },
				null,
				{ from: 42, to: 'tool:read' },
			],
		});
		assert.deepEqual(parsed?.edges, [{ from: 'group:A', to: 'tool:read' }]);
	});

	it(`空文档是合法状态（${'groups: []'}），不是「解析失败」`, () => {
		assert.deepEqual(parseGraphDoc({ groups: [], edges: [] }), EMPTY_GRAPH_DOC);
	});
});

describe('graphOfDoc：边引用的工具即使已下线也要留在图上', () => {
	const known = new Set(['write']);

	it('已知工具 ⇒ 正常节点，不进失效集合', () => {
		const { graph, invalidTools } = graphOfDoc(parseGraphDoc(DOC)!, known);
		assert.deepEqual(
			graph.nodes.map((one) => [one.id, one.kind]),
			[
				['group:编码工具', 'group'],
				['group:写操作', 'group'],
				['tool:write', 'tool'],
			],
		);
		assert.equal(invalidTools.size, 0);
	});

	it('宿主没有的工具 ⇒ 节点仍在、边仍在，只是标成失效', () => {
		const { graph, invalidTools } = graphOfDoc(parseGraphDoc(DOC)!, new Set());
		assert.deepEqual(invalidTools, new Set(['tool:write']));
		assert.ok(graph.edges.some((edge) => edge.to === 'tool:write'), '边不能丢');
		const node = graph.nodes.find((one) => one.id === 'tool:write');
		assert.equal(node?.label, 'write');
		assert.equal(node?.source, '宿主已无此工具');
	});

	it('同一个工具被两条边引用 ⇒ 只出现一个节点', () => {
		const doc = parseGraphDoc({
			groups: [{ name: 'A' }, { name: 'B' }],
			edges: [
				{ from: 'group:A', to: 'tool:read' },
				{ from: 'group:B', to: 'tool:read' },
			],
		})!;
		const { graph } = graphOfDoc(doc, new Set(['read']));
		assert.equal(graph.nodes.filter((one) => one.id === 'tool:read').length, 1);
	});
});

describe('docOfGraph：只存组与边（工具不落库）', () => {
	it('doc → graph → doc 是同一份（回写可逆：组与边不增不减）', () => {
		const doc = parseGraphDoc(DOC)!;
		const { graph } = graphOfDoc(doc, new Set(['write']));
		/* 列号由布局层号重新算（列号不参与布局），所以这里把它钉回原值再比。 */
		const columns = new Map([
			['group:编码工具', 0],
			['group:写操作', 1],
		]);
		const roundTrip = docOfGraph(graph, (id) => columns.get(id) ?? 0);
		assert.deepEqual(roundTrip, doc);
		assert.equal(docKey(roundTrip), docKey(doc));
	});

	it('列号可以按画布层号重新算', () => {
		const { graph } = graphOfDoc(parseGraphDoc(DOC)!, new Set(['write']));
		const columns = new Map([
			['group:编码工具', 0],
			['group:写操作', 3],
		]);
		assert.deepEqual(
			docOfGraph(graph, (id) => columns.get(id) ?? 0).groups,
			[
				{ name: '编码工具', column: 0 },
				{ name: '写操作', column: 3 },
			],
		);
	});

	it('工具节点不写进 groups（工具会变，真值在 /api/tools）', () => {
		const { graph } = graphOfDoc(parseGraphDoc(DOC)!, new Set(['write']));
		const doc = docOfGraph(graph);
		assert.equal(doc.groups.length, 2);
		assert.ok(doc.groups.every((one) => !one.name.startsWith('tool:')));
	});

	it('父节点不是组的边不发（服务端会 400 NOT_GROUP）', () => {
		const graph = {
			nodes: [
				{ id: 'group:A', kind: 'group' as const, label: 'A' },
				{ id: 'tool:read', kind: 'tool' as const, label: 'read' },
			],
			edges: [{ from: 'tool:read', to: 'group:A' }],
		};
		assert.deepEqual(docOfGraph(graph).edges, []);
	});

	it('取消最后一个包含它的边之后，孤立的工具节点被剪掉（组不受影响）', () => {
		const graph = graphOfDoc(parseGraphDoc(DOC)!, new Set(['write'])).graph;
		assert.ok(graph.nodes.some((one) => one.id === 'tool:write'));
		const pruned = pruneOrphanTools({ nodes: graph.nodes, edges: graph.edges.filter((edge) => edge.to !== 'tool:write') });
		assert.equal(pruned.nodes.some((one) => one.id === 'tool:write'), false);
		assert.equal(pruned.nodes.filter((one) => one.kind === 'group').length, 2);
	});

	it('还别的组引用它 ⇒ 不剪', () => {
		const doc = parseGraphDoc({
			groups: [{ name: 'A' }, { name: 'B' }],
			edges: [
				{ from: 'group:A', to: 'tool:read' },
				{ from: 'group:B', to: 'tool:read' },
			],
		})!;
		const graph = graphOfDoc(doc, new Set(['read'])).graph;
		const pruned = pruneOrphanTools({ nodes: graph.nodes, edges: graph.edges.filter((edge) => edge.from !== 'group:A') });
		assert.equal(pruned.nodes.some((one) => one.id === 'tool:read'), true);
	});

	it('空白组名不进文档；文档指纹能分辨改动', () => {
		const graph = { nodes: [{ id: 'group:x', kind: 'group' as const, label: '   ' }], edges: [] };
		assert.deepEqual(docOfGraph(graph).groups, []);
		const a = docOfGraph(graphOfDoc(parseGraphDoc(DOC)!, new Set(['write'])).graph);
		const b = docOfGraph(graphOfDoc(parseGraphDoc(DOC)!, new Set(['write'])).graph, (id) => (id === 'group:写操作' ? 1 : 0));
		assert.notEqual(docKey(a), docKey(b));
	});
});

describe('labelOfNodeId / groupNodeIdOf', () => {
	it('两个前缀都能还原；未知前缀原样返回', () => {
		assert.equal(labelOfNodeId('group:编码工具'), '编码工具');
		assert.equal(labelOfNodeId('tool:write'), 'write');
		assert.equal(labelOfNodeId('nope'), 'nope');
		assert.equal(groupNodeIdOf('编码工具'), 'group:编码工具');
	});
});

describe('graphFailureText：detail.code 翻成人话（成环要带路径）', () => {
	it('CYCLE ⇒ 把环路径画出来（节点 id → 显示名）', () => {
		const text = graphFailureText({
			status: 400,
			message: '会成环：组「文件类」…',
			detailCode: 'CYCLE',
			cycle: ['group:文件类', 'group:编码工具', 'group:文件类'],
		});
		assert.equal(text.code, 'CYCLE');
		assert.equal(text.message, '会成环：文件类 → 编码工具 → 文件类');
	});

	it('CYCLE 但服务端没给路径 ⇒ 明说「没给出环路径」，不编一个', () => {
		const text = graphFailureText({ status: 400, message: '', detailCode: 'CYCLE' });
		assert.match(text.message, /没给出环路径/);
	});

	it('其余判定码各有各的人话', () => {
		const cases = ['SELF_LOOP', 'DUPLICATE', 'NOT_GROUP', 'MISSING_NODE', 'DUPLICATE_GROUP'] as const;
		for (const code of cases) {
			const text = graphFailureText({ status: 400, message: '服务端原文', detailCode: code });
			assert.equal(text.code, code);
			assert.notEqual(text.message, '服务端原文', `${code} 应该翻成人话`);
			assert.ok(text.message.length > 0);
		}
	});

	it('BAD_SHAPE 用服务端 message（它比我们猜的具体）', () => {
		const text = graphFailureText({ status: 400, message: '组名不能为空。', detailCode: 'BAD_SHAPE' });
		assert.equal(text.message, '组名不能为空。');
	});

	it('没有判定码（网络 / 鉴权）⇒ 服务端 message 或 HTTP 状态', () => {
		assert.equal(graphFailureText({ status: 500, message: '宿主内部错误' }).message, '宿主内部错误');
		assert.equal(graphFailureText({ status: 502, message: '' }).message, '服务返回 HTTP 502');
	});
});
