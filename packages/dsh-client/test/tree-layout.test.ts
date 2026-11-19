/**
 * `pure/tree-layout.ts` 的测试 —— **纯函数，零 DOM、零 mock**。
 *
 * ## 最重要的一条
 *
 * > **单子卡的父卡 ⇒ `logicalRow(父) === logicalRow(唯一子卡)`**
 *
 * 旧版 `__selfTest()` 的核心断言就是这一条。它不是「最好如此」，是用户规则的定义
 * （「他连接的最下面拓扑序的最上面的是第 12 行，那么他自己也应该在第 12 行」）。
 * 一旦它不成立，画出来就是斜线 —— 而斜线正是用户不要的。
 *
 * ⚠ 多子卡的父卡只能对齐一个（`min`），其余斜线是规则本身的性质，不算失败。
 *
 * 本文件的多个测试会**从不同角度**钉这条：
 * - `⭐ 单子卡与父同行`：正常树上逐边检查
 * - `⭐ 叶子不许抢父卡的行`：专门造「叶子 id 字典序在前」的反例（旧版踩过的坑）
 * - `cmp-live 精确坐标`：两轮排序 + 从右往左的确定结果，改一处就红
 *
 * ## 其它钉住的旧坑
 *
 * - `linkCurve` 的 `to` 在 `from` **左边**时方向要翻转（旧版实测修过一次，容易写回去）
 * - 环 / 孤儿**不死循环、不丢卡**（含自环、孤儿链）
 * - 折栏的**行数分配**（41 卡 → 9/8/8/8/8；23 卡 → 8/8/7，数字与旧版 `__selfTest()` 一致）
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	boxOf,
	canvasSizeOf,
	layoutTree,
	linkCurve,
	parentCurve,
	parentEdgePaths,
	toPathData,
} from '../src/pure/tree-layout.ts';
import type { TreeCard, TreeLayout, TreeLayoutNode } from '../src/pure/tree-layout.ts';

/* ══════════════════════════════════════════════════════════════
 * 夹具与断言辅助
 * ══════════════════════════════════════════════════════════════ */

/** 造一张卡（布局只需要 id + parent）。 */
const mk = (id: string, parent: string | null = null): TreeCard => ({
	id,
	title: `卡 ${id}`,
	parent,
});

const nodeOf = (layout: TreeLayout, id: string): TreeLayoutNode => {
	const node = layout.nodes.find((one) => one.id === id);
	assert.ok(node !== undefined, `布局里应该有卡 ${id}`);
	return node;
};

/** `id → [layer, logicalRow]`：**逻辑**坐标（父子对齐看这个）。 */
const logicalShape = (layout: TreeLayout): Record<string, [number, number]> => {
	const out: Record<string, [number, number]> = {};
	for (const node of layout.nodes) out[node.id] = [node.layer, node.logicalRow];
	return out;
};

/** `id → [column, row]`：**物理**坐标（折栏后，渲染看这个）。 */
const physicalShape = (layout: TreeLayout): Record<string, [number, number]> => {
	const out: Record<string, [number, number]> = {};
	for (const node of layout.nodes) out[node.id] = [node.column, node.row];
	return out;
};

/**
 * 单子卡的父卡与它的唯一子卡**不同行**的清单（**命门断言**，正常树必须为空数组）。
 *
 * ⚠ 环里的父子可能同层（`child.layer !== parent.layer + 1`）—— 那不是「树」，
 *   不适用本规则，跳过。
 */
const slantedSingleChildren = (layout: TreeLayout): string[] => {
	const childCount = new Map<string, number>();
	for (const edge of layout.edges) {
		childCount.set(edge.from, (childCount.get(edge.from) ?? 0) + 1);
	}
	const byId = new Map(layout.nodes.map((one) => [one.id, one]));
	const bad: string[] = [];
	for (const edge of layout.edges) {
		if (childCount.get(edge.from) !== 1) continue;
		const parent = byId.get(edge.from);
		const child = byId.get(edge.to);
		if (parent === undefined || child === undefined) continue;
		if (child.layer !== parent.layer + 1) continue;
		if (parent.logicalRow !== child.logicalRow) {
			bad.push(
				`${edge.from}(${parent.layer},${parent.logicalRow}) → ${edge.to}(${child.layer},${child.logicalRow})`,
			);
		}
	}
	return bad;
};

/** 栏表的自洽不变量：连续、与 columnCount / rowCount 一致。 */
const assertBandsConsistent = (layout: TreeLayout): void => {
	assert.equal(layout.bands.length, layout.columnCount, 'bands 长度必须等于 columnCount');
	layout.bands.forEach((band, index) => {
		assert.equal(band.column, index, '物理栏号必须从 0 连续');
	});
	const maxRows = layout.bands.reduce((max, band) => Math.max(max, band.rowCount), 0);
	assert.equal(layout.rowCount, maxRows, 'rowCount 必须等于最大栏高');
};

/** 渲染尺寸（旧版 `views/tech-tree.js` 的常量，仅测试用）。 */
const METRICS = {
	cardWidth: 150,
	cardHeight: 64,
	columnGap: 56,
	rowGap: 14,
	padding: 24,
} as const;

/* ══════════════════════════════════════════════════════════════
 * ① 分层
 * ══════════════════════════════════════════════════════════════ */

describe('分层：一列 = 一层', () => {
	it('空输入 → 全零，不抛', () => {
		const layout = layoutTree([]);
		assert.equal(layout.columnCount, 0);
		assert.equal(layout.rowCount, 0);
		assert.deepEqual(layout.nodes, []);
		assert.deepEqual(layout.bands, []);
		assert.deepEqual(layout.warnings, []);
		assert.deepEqual(layout.edges, []);
	});

	it('单卡 → (第 0 层, 第 0 行)', () => {
		const layout = layoutTree([mk('A01')]);
		assert.deepEqual(logicalShape(layout), { A01: [0, 0] });
		assert.deepEqual(physicalShape(layout), { A01: [0, 0] });
		assert.equal(layout.columnCount, 1);
		assert.equal(layout.edges.length, 0);
		assert.equal(layout.warnings.length, 0);
	});

	it('多层树（cmp-live 形态，4 层）列号正确', () => {
		const cards = [
			mk('GU01'),
			mk('RB01'),
			mk('WR01', 'GU01'),
			mk('DC01', 'GU01'),
			mk('DC02', 'GU01'),
			mk('WR02', 'WR01'),
			mk('RL01', 'WR01'),
			mk('WT01', 'WR02'),
		];
		const layout = layoutTree(cards);
		assert.equal(layout.nodes.length, cards.length, '不丢卡');
		assert.deepEqual(logicalShape(layout), {
			GU01: [0, 0],
			RB01: [0, 1],
			WR01: [1, 0],
			DC01: [1, 1],
			DC02: [1, 2],
			WR02: [2, 0],
			RL01: [2, 1],
			WT01: [3, 0],
		});
		assert.equal(layout.columnCount, 4);
		assert.equal(layout.rowCount, 3);
		assertBandsConsistent(layout);
	});

	it('五层链 → 层号逐级 +1，全在第 0 行', () => {
		const cards = [
			mk('A'),
			mk('B', 'A'),
			mk('C', 'B'),
			mk('D', 'C'),
			mk('E', 'D'),
		];
		const layout = layoutTree(cards);
		assert.deepEqual(logicalShape(layout), {
			A: [0, 0],
			B: [1, 0],
			C: [2, 0],
			D: [3, 0],
			E: [4, 0],
		});
		assert.equal(layout.columnCount, 5);
		assert.deepEqual(slantedSingleChildren(layout), []);
	});

	it('两棵独立树：各自按自己的深度分层', () => {
		const cards = [
			mk('R01'),
			mk('A01', 'R01'),
			mk('B01', 'A01'),
			mk('R02'),
			mk('C01', 'R02'),
		];
		const layout = layoutTree(cards);
		assert.deepEqual(
			layout.nodes.map((node) => node.layer).sort((a, b) => a - b),
			[0, 0, 1, 1, 2],
		);
		assert.equal(nodeOf(layout, 'B01').layer, 2);
		assert.equal(nodeOf(layout, 'C01').layer, 1);
		assert.deepEqual(slantedSingleChildren(layout), []);
	});
});

/* ══════════════════════════════════════════════════════════════
 * ② 排行（命门）
 * ══════════════════════════════════════════════════════════════ */

describe('排行：row(父) = min(row(所有直接子卡))', () => {
	it('⭐ 单子卡与父同行（正常树逐边检查）', () => {
		const chain = [
			mk('A'),
			mk('B', 'A'),
			mk('C', 'B'),
			mk('D', 'C'),
		];
		assert.deepEqual(slantedSingleChildren(layoutTree(chain)), []);

		const wide = [
			mk('GU01'),
			mk('RB01'),
			mk('WR01', 'GU01'),
			mk('DC01', 'GU01'),
			mk('DC02', 'GU01'),
			mk('WR02', 'WR01'),
			mk('RL01', 'WR01'),
			mk('WT01', 'WR02'),
		];
		assert.deepEqual(slantedSingleChildren(layoutTree(wide)), []);
	});

	it('⭐ 叶子不许抢父卡需要的行（旧版踩过的反例）', () => {
		/*
		 * 反例形态：同列里 id 字典序在前的卡是**叶子**、在后的卡**有子卡**。
		 * 单轮排序会把 AA01 先放 row 0，把有行约束的 ZZ01 挤到 row 1 ⇒ 斜线。
		 * 两轮排序（有子卡先排）之后 ZZ01 必须拿到 row 0。
		 */
		const cards = [
			mk('P01'),
			mk('AA01', 'P01'), /* 叶子，id 字典序在前 */
			mk('ZZ01', 'P01'), /* 有子卡，id 字典序在后 */
			mk('ZZ02', 'ZZ01'),
		];
		const layout = layoutTree(cards);
		assert.deepEqual(slantedSingleChildren(layout), [], '叶子抢了父卡的行');
		const zz01 = nodeOf(layout, 'ZZ01');
		const zz02 = nodeOf(layout, 'ZZ02');
		assert.equal(zz01.logicalRow, zz02.logicalRow, '⭐ ZZ01 必须与唯一子卡 ZZ02 同行');
		assert.equal(zz01.layer, zz02.layer - 1);
		/* 叶子后退到 row 1（无约束的填剩下的空位）。 */
		assert.deepEqual(logicalShape(layout), {
			P01: [0, 0],
			AA01: [1, 1],
			ZZ01: [1, 0],
			ZZ02: [2, 0],
		});
	});

	it('多子父卡对齐「最小子行」', () => {
		const cards = [
			mk('R01'),
			mk('C01', 'R01'),
			mk('C02', 'R01'),
			mk('G01', 'C01'),
			mk('G02', 'C02'),
			mk('G03', 'C02'),
		];
		const layout = layoutTree(cards);
		assert.deepEqual(logicalShape(layout), {
			R01: [0, 0],
			C01: [1, 0],
			C02: [1, 1],
			G01: [2, 0],
			G02: [2, 1],
			G03: [2, 2],
		});
		assert.deepEqual(slantedSingleChildren(layout), []);
	});
});

/* ══════════════════════════════════════════════════════════════
 * ③ 折栏
 * ══════════════════════════════════════════════════════════════ */

describe('折栏：同层超过 maxRowsPerColumn 行', () => {
	it('41 张无关系卡 → 5 栏，行数 9/8/8/8/8', () => {
		const cards = Array.from({ length: 41 }, (_, i) =>
			mk(`R${String(i + 1).padStart(2, '0')}`),
		);
		const layout = layoutTree(cards);
		assert.equal(layout.nodes.length, 41, '不丢卡');
		assert.equal(layout.columnCount, 5);
		assert.deepEqual(
			layout.bands.map((band) => band.rowCount),
			[9, 8, 8, 8, 8],
			'按行数尽量平均，最后一栏不许只剩 1 张',
		);
		assert.deepEqual(
			layout.bands.map((band) => band.layer),
			[0, 0, 0, 0, 0],
		);
		assert.equal(layout.rowCount, 9);
		const physical = physicalShape(layout);
		assert.deepEqual(physical['R01'], [0, 0]);
		assert.deepEqual(physical['R09'], [0, 8]);
		assert.deepEqual(physical['R10'], [1, 0]);
		assert.deepEqual(physical['R41'], [4, 7]);
		assertBandsConsistent(layout);
	});

	it('23 张无关系卡 → 3 栏（旧版 __selfTest 的确定数字）', () => {
		const cards = Array.from({ length: 23 }, (_, i) =>
			mk(`R${String(i + 1).padStart(2, '0')}`),
		);
		const layout = layoutTree(cards);
		assert.equal(layout.columnCount, 3);
		assert.equal(layout.rowCount, 8);
		assert.deepEqual(
			layout.bands.map((band) => band.rowCount),
			[8, 8, 7],
		);
		const physical = physicalShape(layout);
		assert.deepEqual(physical['R01'], [0, 0]);
		assert.deepEqual(physical['R11'], [1, 2]);
		assert.deepEqual(physical['R21'], [2, 4]);
		assertBandsConsistent(layout);
	});

	it('折栏不改拓扑：小树的层数 / 栏数不变', () => {
		const cards = [mk('P01'), mk('C01', 'P01'), mk('C02', 'P01')];
		const layout = layoutTree(cards);
		assert.equal(layout.columnCount, 2, '父一栏 + 子一栏');
		assert.deepEqual(logicalShape(layout), {
			P01: [0, 0],
			C01: [1, 0],
			C02: [1, 1],
		});
		assert.deepEqual(slantedSingleChildren(layout), []);
	});

	it('树折栏：父一栏、12 个子卡跨两栏', () => {
		const cards: TreeCard[] = [mk('R01')];
		for (let i = 1; i <= 12; i += 1) {
			cards.push(mk(`C${String(i).padStart(2, '0')}`, 'R01'));
		}
		const layout = layoutTree(cards);
		assert.equal(layout.columnCount, 3);
		assert.deepEqual(
			layout.bands.map((band) => [band.column, band.layer, band.rowCount, band.cardCount]),
			[
				[0, 0, 1, 1],
				[1, 1, 6, 6],
				[2, 1, 6, 6],
			],
		);
		const physical = physicalShape(layout);
		assert.deepEqual(physical['R01'], [0, 0]);
		assert.deepEqual(physical['C01'], [1, 0]);
		assert.deepEqual(physical['C06'], [1, 5]);
		assert.deepEqual(physical['C07'], [2, 0]);
		assert.deepEqual(physical['C12'], [2, 5]);
		/* 逻辑层 / 逻辑行不受折栏影响：12 个子卡逻辑行 0..11。 */
		assert.equal(nodeOf(layout, 'C12').logicalRow, 11);
		assert.equal(nodeOf(layout, 'C12').layer, 1);
		assertBandsConsistent(layout);
	});

	it('maxRowsPerColumn 选项：合法值 / 0 / NaN', () => {
		const five = Array.from({ length: 5 }, (_, i) => mk(`R${String(i + 1).padStart(2, '0')}`));
		const narrow = layoutTree(five, { maxRowsPerColumn: 2 });
		assert.equal(narrow.columnCount, 3);
		assert.deepEqual(
			narrow.bands.map((band) => band.rowCount),
			[2, 2, 1],
		);

		/* 0 ⇒ 夹到 1（每卡一栏），不能算出 NaN / 负栏数。 */
		const one = layoutTree(five, { maxRowsPerColumn: 0 });
		assert.equal(one.columnCount, 5);
		assert.equal(one.rowCount, 1);

		/* NaN / 非法值 ⇒ 回落默认 10。 */
		const twelve = Array.from({ length: 12 }, (_, i) => mk(`R${String(i + 1).padStart(2, '0')}`));
		const fallback = layoutTree(twelve, { maxRowsPerColumn: Number.NaN });
		assert.equal(fallback.columnCount, 2);
		assert.deepEqual(
			fallback.bands.map((band) => band.rowCount),
			[6, 6],
		);
	});
});

/* ══════════════════════════════════════════════════════════════
 * ④ 孤儿 / 环
 * ══════════════════════════════════════════════════════════════ */

describe('孤儿 / 环：落第 0 层 + 警告，绝不死循环、绝不丢卡', () => {
	it('孤儿卡（parent 指向不存在的卡）→ 第 0 层 + orphan 警告', () => {
		const layout = layoutTree([mk('A01'), mk('X01', 'ZZZ')]);
		assert.equal(layout.nodes.length, 2, '不丢卡');
		const x01 = nodeOf(layout, 'X01');
		assert.equal(x01.layer, 0);
		assert.equal(x01.warning?.kind, 'orphan');
		assert.match(x01.warning?.detail ?? '', /ZZZ/, 'detail 要点出缺的是哪个 parent');
		assert.deepEqual(layout.warnings.map((warning) => [warning.cardId, warning.kind]), [
			['X01', 'orphan'],
		]);
		/* 孤儿不成边（parent 卡不存在，画不出这条线）。 */
		assert.deepEqual(layout.edges, []);
		assert.deepEqual(slantedSingleChildren(layout), []);
	});

	it('孤儿链：孤儿的孩子仍按正常深度分层', () => {
		const layout = layoutTree([mk('X01', 'NOPE'), mk('Y01', 'X01')]);
		assert.deepEqual(logicalShape(layout), {
			X01: [0, 0],
			Y01: [1, 0],
		});
		assert.deepEqual(layout.warnings.map((warning) => warning.cardId), ['X01']);
		assert.deepEqual(layout.edges, [{ from: 'X01', to: 'Y01' }]);
	});

	it('两卡环（A↔B）+ 环外 C：环落第 0 层，C 正常', () => {
		const layout = layoutTree([
			mk('A01', 'B01'),
			mk('B01', 'A01'),
			mk('C01', 'B01'),
		]);
		assert.equal(layout.nodes.length, 3, '不丢卡');
		assert.equal(nodeOf(layout, 'A01').layer, 0);
		assert.equal(nodeOf(layout, 'B01').layer, 0);
		assert.equal(nodeOf(layout, 'A01').warning?.kind, 'cycle');
		assert.equal(nodeOf(layout, 'B01').warning?.kind, 'cycle');
		assert.equal(nodeOf(layout, 'C01').layer, 1, '环外卡有合法深度');
		assert.equal(nodeOf(layout, 'C01').warning, undefined, '不许误标环外卡');
		assert.equal(layout.warnings.length, 2);
		assertBandsConsistent(layout);
	});

	it('自环（parent === 自己）→ cycle 警告、不进图、不崩', () => {
		const layout = layoutTree([mk('S01', 'S01')]);
		assert.equal(layout.nodes.length, 1);
		assert.equal(nodeOf(layout, 'S01').layer, 0);
		assert.equal(nodeOf(layout, 'S01').warning?.kind, 'cycle');
		assert.deepEqual(layout.edges, [], '自环不成父子边');
		assertBandsConsistent(layout);
	});

	it('三卡环（A→B→C→A）→ 三张全 cycle + 终止', () => {
		const layout = layoutTree([
			mk('A01', 'B01'),
			mk('B01', 'C01'),
			mk('C01', 'A01'),
		]);
		assert.equal(layout.nodes.length, 3);
		assert.equal(layout.warnings.length, 3);
		for (const node of layout.nodes) {
			assert.equal(node.layer, 0);
			assert.equal(node.warning?.kind, 'cycle');
		}
	});

	it('重复 id：只保留第一张，不出两个坐标', () => {
		const layout = layoutTree([mk('A01'), mk('A01', 'OTHER'), mk('B01')]);
		assert.equal(layout.nodes.length, 2);
		assert.deepEqual(
			layout.nodes.map((node) => node.id),
			['A01', 'B01'],
			'nodes 顺序 = 输入去重后的顺序',
		);
	});
});

/* ══════════════════════════════════════════════════════════════
 * ⑤ 连线路径（纯几何）
 * ══════════════════════════════════════════════════════════════ */

describe('连线路径：方向自适应 + 输出可序列化', () => {
	it('parentCurve 父子同行 → 拱形（两端同高、控制点向上抬）', () => {
		const from = boxOf({ column: 0, row: 0 }, METRICS);
		const to = boxOf({ column: 1, row: 0 }, METRICS);
		const curve = parentCurve(from, to);
		assert.equal(curve.start.x, from.right, '从父卡右边出线');
		assert.equal(curve.end.x, to.left, '从子卡左边进线');
		assert.equal(curve.start.y, curve.end.y, '同行 ⇒ 两端 y 相同（拱弧不是斜线）');
		assert.ok(curve.c1.y < curve.start.y, '控制点向上抬起');
		assert.ok(curve.c2.y < curve.end.y, '控制点向上抬起');
		const d = toPathData(curve);
		assert.equal(typeof d, 'string');
		assert.match(d, /^M /);
		assert.match(d, / C /);
		assert.doesNotMatch(d, /NaN|undefined/);
	});

	it('parentCurve 子卡在左（异常数据 / 环）→ 镜像出线，不横穿', () => {
		const from = boxOf({ column: 1, row: 0 }, METRICS);
		const to = boxOf({ column: 0, row: 0 }, METRICS);
		const curve = parentCurve(from, to);
		assert.equal(curve.start.x, from.left, '子卡在左 ⇒ 从父卡左边出线');
		assert.equal(curve.end.x, to.right, '从子卡右边进线');
		assert.ok(curve.c1.x < curve.start.x);
		assert.ok(curve.c2.x > curve.end.x);
	});

	it('parentCurve 同栏（环里的父子）→ 改走纵向，不画横穿线', () => {
		const from = boxOf({ column: 0, row: 0 }, METRICS);
		const to = boxOf({ column: 0, row: 1 }, METRICS);
		const curve = parentCurve(from, to);
		assert.equal(curve.start.x, from.midX);
		assert.equal(curve.end.x, to.midX);
		assert.equal(curve.start.y, from.bottom);
		assert.equal(curve.end.y, to.top);
		assert.doesNotMatch(toPathData(curve), /NaN/);
	});

	it('linkCurve 向右：从右边缘出、左边缘进，控制点在走廊内', () => {
		const from = boxOf({ column: 0, row: 0 }, METRICS);
		const to = boxOf({ column: 1, row: 0 }, METRICS);
		const curve = linkCurve(from, to);
		assert.equal(curve.start.x, from.right);
		assert.equal(curve.end.x, to.left);
		assert.ok(curve.c1.x >= curve.start.x && curve.c1.x <= curve.end.x);
		assert.ok(curve.c2.x >= curve.start.x && curve.c2.x <= curve.end.x);
	});

	it('⭐ linkCurve 向左（旧版实测踩过的坑）：方向必须翻转', () => {
		/*
		 * 旧版写死「a 在左、b 在右」：`to` 在 `from` 左边时
		 * 控制点跑到两端之外 ⇒ 曲线从右侧甩出去、横穿整个画布再兜回来。
		 * 这里断言：从左边缘出、右边缘进，且控制点落在两卡之间的走廊里。
		 */
		const from = boxOf({ column: 1, row: 0 }, METRICS);
		const to = boxOf({ column: 0, row: 0 }, METRICS);
		const curve = linkCurve(from, to);
		assert.equal(curve.start.x, from.left, '向左走必须从左边出线（不是右边）');
		assert.equal(curve.end.x, to.right, '必须从目标卡的右边进线（不是左边）');
		assert.ok(
			curve.c1.x >= curve.end.x && curve.c1.x <= curve.start.x,
			'控制点必须落在两卡之间的走廊（不许跑到画布外）',
		);
		assert.ok(curve.c2.x >= curve.end.x && curve.c2.x <= curve.start.x);
		assert.doesNotMatch(toPathData(curve), /NaN/);
	});

	it('linkCurve 纵向（同栏不同行）→ 上下出线', () => {
		const from = boxOf({ column: 0, row: 0 }, METRICS);
		const to = boxOf({ column: 0, row: 2 }, METRICS);
		const curve = linkCurve(from, to);
		assert.equal(curve.start.x, from.midX);
		assert.equal(curve.end.x, to.midX);
		assert.equal(curve.start.y, from.bottom);
		assert.equal(curve.end.y, to.top);
	});

	it('parentEdgePaths：每条有效边都有 d；孤儿无边；无 NaN', () => {
		const cards = [
			mk('GU01'),
			mk('WR01', 'GU01'),
			mk('WR02', 'WR01'),
			mk('WT01', 'WR02'),
		];
		const layout = layoutTree(cards);
		const paths = parentEdgePaths(layout, METRICS);
		assert.equal(paths.length, layout.edges.length);
		assert.equal(paths.length, 3);
		for (const one of paths) {
			assert.match(one.d, /^M /);
			assert.doesNotMatch(one.d, /NaN|undefined/);
		}
		/*
		 * 父子被排到同一逻辑行 ⇒ WR01（第 1 栏）→ WR02（第 2 栏）的两端 y 必须相同
		 * （56 = 24 padding + 64/2）。顺带钉住 `d` 的格式，改动格式会在这里红。
		 */
		const aligned = paths.find((one) => one.from === 'WR01' && one.to === 'WR02');
		assert.equal(aligned?.d, 'M 380 56 C 402.4 49, 413.6 49, 436 56');

		const orphan = layoutTree([mk('A01'), mk('X01', 'ZZZ')]);
		assert.deepEqual(parentEdgePaths(orphan, METRICS), [], '孤儿不成边');
	});

	it('canvasSizeOf：空布局 / 正常布局', () => {
		assert.deepEqual(canvasSizeOf(layoutTree([]), METRICS), {
			width: 48,
			height: 48,
		});
		const cards = [mk('A'), mk('B', 'A'), mk('C', 'B')];
		const layout = layoutTree(cards);
		/* 3 栏 1 行：(3-1)*206 + 150 + 48 = 610；1 行：64 + 48 = 112。 */
		assert.deepEqual(canvasSizeOf(layout, METRICS), { width: 610, height: 112 });
	});
});

/* ══════════════════════════════════════════════════════════════
 * ⑥ 性能
 * ══════════════════════════════════════════════════════════════ */

describe('性能：1000 张卡', () => {
	it('1000 层深链 → 不超时、不丢卡', () => {
		const cards: TreeCard[] = [mk('N0000')];
		for (let i = 1; i < 1000; i += 1) {
			cards.push(mk(`N${String(i).padStart(4, '0')}`, `N${String(i - 1).padStart(4, '0')}`));
		}
		const startedAt = Date.now();
		const layout = layoutTree(cards);
		const elapsed = Date.now() - startedAt;
		assert.equal(layout.nodes.length, 1000);
		assert.equal(layout.columnCount, 1000);
		assert.equal(layout.rowCount, 1);
		assert.equal(layout.warnings.length, 0);
		assert.ok(elapsed < 5000, `1000 层深链耗时 ${elapsed}ms，疑似 O(n²) 以上`);
	});

	it('1000 张无关系卡 → 100 栏、不超时', () => {
		const cards = Array.from({ length: 1000 }, (_, i) =>
			mk(`Z${String(i).padStart(4, '0')}`),
		);
		const startedAt = Date.now();
		const layout = layoutTree(cards);
		const elapsed = Date.now() - startedAt;
		assert.equal(layout.nodes.length, 1000);
		assert.equal(layout.columnCount, 100);
		assert.equal(layout.rowCount, 10);
		assert.equal(layout.warnings.length, 0);
		assertBandsConsistent(layout);
		assert.ok(elapsed < 5000, `1000 张无关系卡耗时 ${elapsed}ms，疑似 O(n²) 以上`);
	});
});
