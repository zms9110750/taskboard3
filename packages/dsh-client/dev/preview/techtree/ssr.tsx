/**
 * 科技树的 **SSR 断言** —— 把真组件渲染成静态 HTML，然后断言 HTML。
 * 几何测量（`getBoundingClientRect`）在 `verify.mjs` 的浏览器阶段跑，
 * 两者共用同一个 runnable：`node dev/preview/techtree/verify.mjs`。
 *
 * ## 为什么 SSR 能验这几件事
 *
 * 用户要的 6 条交互里，有 4 条的结果是**结构**、不是动画：
 *
 * | 交互 | SSR 能断言吗 |
 * |---|---|
 * | 1 科技树视图（一列一层） | ✅ 卡片绝对定位的 `left/top` + 列头文字 |
 * | 2 箭头尖端贴边 | ✅ `<marker>` + `marker-end` + 路径终点坐标 |
 * | 3 hover 无关边淡到 25% | ✅ 传受控 `hoverId` ⇒ `data-dim="true"` + CSS 规则 0.25 |
 * | 4/5 筛选/搜索后**隐藏** | ✅ 隐藏卡的 id / 标题**根本不在 HTML 里**（不是 opacity） |
 * | 6 回车/前往跳详情 | 一半：`jumpTargetOf()` 的判决是纯函数（单测）；「打开右栏」是预览的 state |
 *
 * ## 运行
 *
 * 本文件是 `.tsx`（有 JSX），Node 不能直接跑 ⇒ `verify.mjs` 先用 rolldown 打包成
 * 一个临时 `.mjs` 再 import。**不需要浏览器、不需要构建产品**。
 *
 * 断言失败时把 `process.exitCode` 置 1；`verify.mjs` 会透传。
 */

import { writeFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';

import { STATE_LABELS, TASK_STATES } from '@taskboard/protocol';

import { boxOf, canvasSizeOf, layoutTree } from '../../../src/pure/tree-layout.ts';
import { jumpTargetOf, treeCardsOf, visibleCardIds } from '../../../src/pure/tree-filter.ts';
import type { TreeFilterCriteria } from '../../../src/pure/tree-filter.ts';
import { FoldPill, FoldRect } from '../../../src/renderers/FoldPill.tsx';
import {
	TECHTREE_CSS,
	TREE_HEADER_HEIGHT,
	TREE_METRICS,
	TechTree,
	TreeLegend,
} from '../../../src/renderers/TechTree.tsx';
import type { Card } from '../../../src/types.ts';
import { CARDS, CYCLE_CARDS, SHOWCASE_CARDS, kindLabelOf } from './fixtures.ts';

/* ══════════════════════════════════════════════════════════════
 * 断言工具（输出「✓ 名字 — 实测值」，失败也给出实测值）
 * ══════════════════════════════════════════════════════════════ */

interface Result {
	readonly name: string;
	readonly ok: boolean;
	readonly detail: string;
}

const results: Result[] = [];

/**
 * 记一条断言。
 *
 * @param name 断言名（人话）
 * @param ok 是否通过
 * @param detail 实测值（打印出来，便于定位）
 */
function check(name: string, ok: boolean, detail = ''): void {
	results.push({ name, ok, detail });
}

/**
 * 相等断言。
 *
 * @param name 断言名
 * @param actual 实测
 * @param expected 期望
 */
function eq(name: string, actual: unknown, expected: unknown): void {
	const ok = actual === expected;
	check(name, ok, ok ? String(actual) : `实测 ${String(actual)} ≠ 期望 ${String(expected)}`);
}

/**
 * 包含断言。
 *
 * @param name 断言名
 * @param haystack 被查的 HTML
 * @param needle 必须出现的片段
 */
function contains(name: string, haystack: string, needle: string): void {
	const ok = haystack.includes(needle);
	check(name, ok, ok ? `含 ${JSON.stringify(needle)}` : `缺 ${JSON.stringify(needle)}`);
}

/**
 * 不包含断言（「隐藏」的核心判据）。
 *
 * @param name 断言名
 * @param haystack 被查的 HTML
 * @param needle 不许出现的片段
 */
function notContains(name: string, haystack: string, needle: string): void {
	const ok = !haystack.includes(needle);
	check(name, ok, ok ? `不含 ${JSON.stringify(needle)}` : `仍然含 ${JSON.stringify(needle)}（没隐藏！）`);
}

/**
 * 数一个片段在 HTML 里出现几次。
 *
 * @param haystack 被查的 HTML
 * @param needle 片段
 */
function countOf(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

/** 空回调（受控组件在 SSR 里不需要真做事）。 */
const noop = (): void => {
	/* 故意为空。 */
};

/**
 * 渲染一个 TechTree。
 *
 * @param cards 卡
 * @param extra 其余 props（选中 / hover / 筛选）
 */
function render(
	cards: readonly Card[],
	extra: {
		readonly selectedId?: string | null;
		readonly hoverId?: string | null;
		readonly filter?: TreeFilterCriteria;
		readonly groups?: readonly { readonly id: string; readonly memberIds: readonly string[] }[];
		readonly foldedIds?: readonly string[];
		readonly expandedIds?: readonly string[];
	} = {},
): string {
	return renderToStaticMarkup(
		<TechTree
			cards={cards}
			selectedId={extra.selectedId ?? null}
			kindLabelOf={kindLabelOf}
			onSelect={noop}
			{...(extra.hoverId === undefined ? {} : { hoverId: extra.hoverId })}
			{...(extra.filter === undefined ? {} : { filter: extra.filter })}
			{...(extra.groups === undefined ? {} : { groups: extra.groups })}
			{...(extra.foldedIds === undefined ? {} : { foldedIds: extra.foldedIds })}
			{...(extra.expandedIds === undefined ? {} : { expandedIds: extra.expandedIds })}
		/>,
	);
}

/* ══════════════════════════════════════════════════════════════
 * 先算期望值（用**同一套**布局纯函数，不手写坐标）
 * ══════════════════════════════════════════════════════════════ */

/** 全量布局（没筛选）。 */
const FULL_LAYOUT = layoutTree(treeCardsOf(CARDS, visibleCardIds(CARDS, {})));

/** 全量可见时的边数：父子边 + links 边。 */
const LINK_EDGES = CARDS.flatMap((card) =>
	card.relations.links
		.filter((link) => FULL_LAYOUT.nodes.some((node) => node.id === link.to))
		.map((link) => ({ from: card.id, to: link.to, label: link.label })),
);
const TOTAL_EDGES = FULL_LAYOUT.edges.length + LINK_EDGES.length;

/** hover `DC01` 时「相连」的边（父子 + links 各算一次）。 */
const ACTIVE_EDGES = [
	...FULL_LAYOUT.edges.filter((edge) => edge.from === 'DC01' || edge.to === 'DC01'),
	...LINK_EDGES.filter((edge) => edge.from === 'DC01' || edge.to === 'DC01'),
];
const DIM_EDGES = TOTAL_EDGES - ACTIVE_EDGES.length;

/* ══════════════════════════════════════════════════════════════
 * ① 全量渲染：结构 / 卡片数 / 线 / 箭头 / 列头 / 状态图例
 * ══════════════════════════════════════════════════════════════ */

const full = render(CARDS);

/*
 * 可选：把「全量渲染」的 HTML 落盘，供人肉核对（不设环境变量就什么都不做）。
 * 用法：`set TB3_SSR_DUMP=X:\temp\dsh\tt-techtree-full.html` 再跑 verify.mjs。
 */
const dumpPath = process.env['TB3_SSR_DUMP'];
if (dumpPath !== undefined && dumpPath !== '') {
	writeFileSync(dumpPath, full, 'utf8');
	console.log(`（已把全量 HTML 写到 ${dumpPath}）`);
}

check('有 SVG 线层（data-links）', full.includes('<svg') && full.includes('data-links'));
eq('卡片数 = 输入卡片数', countOf(full, 'data-card-id="'), CARDS.length);
eq('卡片数 = 布局节点数', countOf(full, 'data-card-id="'), FULL_LAYOUT.nodes.length);
eq('物理栏数 = layout.columnCount', countOf(full, 'data-band="'), FULL_LAYOUT.columnCount);
eq('连线数 = 父子边 + links 边', Number(/data-edge-count="(\d+)"/.exec(full)?.[1]), TOTAL_EDGES);
eq(
	'每张卡有 data-layer（列背景也有，故 = 卡数 + 栏数）',
	countOf(full, 'data-layer="'),
	CARDS.length + FULL_LAYOUT.columnCount,
);

contains('列头「第 0 层 · 根卡」', full, '第 0 层 · 根卡');
contains('列头「第 1 层 · 子卡」', full, '第 1 层 · 子卡');
contains('列头「第 2 层 · 孙卡」', full, '第 2 层 · 孙卡');
contains('列头「第 3 层 · 曾孙卡」', full, '第 3 层 · 曾孙卡');

eq('箭头 marker 数 = 6 种关系', countOf(full, '<marker'), 6);
eq('marker-end 数 = 连线数', countOf(full, 'marker-end="url(#'), TOTAL_EDGES);
contains('marker 用 userSpaceOnUse（箭头大小不随线宽变）', full, 'markerUnits="userSpaceOnUse"');
contains('marker 用 orient=auto（箭头朝向 = 路径方向）', full, 'orient="auto"');
contains('有 <path> 连线元素', full, '<path');
eq('派生边带 data-edge="derives"', countOf(full, 'data-edge="derives"'), FULL_LAYOUT.edges.length);

/* ── 卡片坐标来自 layoutTree + boxOf（不是手写） ── */
const firstNode = FULL_LAYOUT.nodes.find((node) => node.column === 0 && node.row === 0);
if (firstNode === undefined) {
	check('布局里有 (column0,row0) 的卡', false, '没找到');
} else {
	const box = boxOf(firstNode, TREE_METRICS);
	const style =
		`left:${String(box.left)}px;top:${String(TREE_HEADER_HEIGHT + box.top)}px;` +
		`width:${String(TREE_METRICS.cardWidth)}px;height:${String(TREE_METRICS.cardHeight)}px`;
	contains(`卡片坐标 = boxOf(${firstNode.id})`, full, style);
	const canvas = canvasSizeOf(FULL_LAYOUT, TREE_METRICS);
	eq('SVG 宽度 = canvasSizeOf().width', Number(/width="(\d+)" height="(\d+)" viewBox/.exec(full)?.[1]), canvas.width);
}

/* ── 状态圆点：9 个状态都带中文名（不只靠颜色） ── */
eq('状态图例 9 项', countOf(full, 'data-state="'), TASK_STATES.length);
for (const state of TASK_STATES) {
	contains(`状态图例含「${STATE_LABELS[state]}」`, full, STATE_LABELS[state]);
}
contains('状态图例圆点带颜色类（dot--）', full, 'dot dot--');

/* ── 孤儿警告（X01 的 parent 不存在） ── */
contains('孤儿卡带 ▲ 警告（data-card-warning=orphan）', full, 'data-card-warning="orphan"');
contains('页脚报「布局警告 1 条（孤儿 1 / 环 0）」', full, '布局警告 1 条（孤儿 1 / 环 0）');
eq('警告数属性 = 1', Number(/data-warnings="(\d+)"/.exec(full)?.[1]), 1);

/* ── 草稿卡：无可见边框（class is-draft） ── */
contains('草稿卡带 is-draft（无可见边框）', full, 'is-draft');

/* ══════════════════════════════════════════════════════════════
 * ② hover：相连的边加粗加深，无关的边淡到 25%，**卡还在**
 * ══════════════════════════════════════════════════════════════ */

const hovered = render(CARDS, { hoverId: 'DC01' });

eq('hover 时卡片数不变（卡不消失）', countOf(hovered, 'data-card-id="'), CARDS.length);
eq('hover 时相连的边数', countOf(hovered, 'data-active="true"'), ACTIVE_EDGES.length);
eq('hover 时无关的边数（应淡到 25%）', countOf(hovered, 'data-dim="true"'), DIM_EDGES);
eq('hover 时每条边都有 active/dim 判决', countOf(hovered, 'data-dim="'), TOTAL_EDGES);
contains('无关的边带 is-dim 类', hovered, 'is-dim');
contains('相连的边带 is-active 类', hovered, 'is-active');
contains('相连的边有光晕（data-glow）', hovered, 'data-glow="true"');
eq('光晕数 = 相连的边数', countOf(hovered, 'data-glow="true"'), ACTIVE_EDGES.length);
contains('相连的 links 边上标关系名', hovered, 'data-edge-label=');

/* 淡化**只**发生在边上：卡片的 data-selected / 可见性都不变 */
eq('hover 不改变选中态', countOf(hovered, 'data-selected="true"'), 0);

/* ── 25% 这个数字在 CSS 里钉住（SSR 只验结构，数值查 CSS 文本） ── */
contains('CSS：无关的边 opacity = 0.25', TECHTREE_CSS, '.tb3t-edge.is-dim{opacity:0.25}');
contains('CSS：相连的边 stroke-width = 3', TECHTREE_CSS, '.tb3t-edge.is-active{stroke-width:3');
contains('CSS：hover 过渡只动 opacity/stroke-width', TECHTREE_CSS, 'transition:opacity .12s ease,stroke-width .12s ease');

/* ══════════════════════════════════════════════════════════════
 * ③ 筛选：不匹配的卡**隐藏**（不是变淡）
 * ══════════════════════════════════════════════════════════════ */

const filtered = render(CARDS, { filter: { status: ['TASK_STATE_COMPLETED'] } });

eq('筛选（成功）后卡片数', countOf(filtered, 'data-card-id="'), 2);
contains('筛选后保留 RB01', filtered, 'data-card-id="RB01"');
contains('筛选后保留 RL01', filtered, 'data-card-id="RL01"');
notContains('筛选后 GU01 从 HTML 消失（隐藏，不是变淡）', filtered, 'GU01');
notContains('筛选后 DC01 从 HTML 消失', filtered, 'DC01');
notContains('筛选后 GU01 的连线也消失', filtered, 'data-from="GU01"');
notContains('筛选后 DC01 的连线也消失', filtered, 'data-to="DC01"');
contains('筛选后 data-filtering="true"', filtered, 'data-filtering="true"');

/* 类别筛选：只留 design */
const kindFiltered = render(CARDS, { filter: { kind: ['design'] } });
eq('类别筛选（design）后卡片数', countOf(kindFiltered, 'data-card-id="'), 2);
notContains('类别筛选后 GU01 消失', kindFiltered, 'data-card-id="GU01"');

/* 领域前缀筛选：核心 ⇒ 核心下的卡（GU01 / RB01 / X01 / RL01；DC01 在「代码」下） */
const domainFiltered = render(CARDS, { filter: { domain: ['核心'] } });
eq('领域筛选（核心）后卡片数', countOf(domainFiltered, 'data-card-id="'), 4);
contains('领域筛选后保留 X01（孤儿也受筛选管）', domainFiltered, 'data-card-id="X01"');

/* 筛到空：不是「空间没卡」，是「没有匹配」 */
const emptyFiltered = render(CARDS, { filter: { status: ['TASK_STATE_FAILED'] } });
contains('筛到空 ⇒ data-empty="filtered"', emptyFiltered, 'data-empty="filtered"');
notContains('筛到空 ⇒ 不画 SVG', emptyFiltered, '<svg');

/* ══════════════════════════════════════════════════════════════
 * ④ 搜索：不匹配的卡**隐藏**（不是变淡）
 * ══════════════════════════════════════════════════════════════ */

const searched = render(CARDS, { filter: { search: 'WR' } });
eq('搜索 WR 后卡片数（WR01 / WR02）', countOf(searched, 'data-card-id="'), 2);
contains('搜索后保留 WR01', searched, 'data-card-id="WR01"');
contains('搜索后保留 WR02', searched, 'data-card-id="WR02"');
notContains('搜索后 DC01 消失', searched, 'data-card-id="DC01"');
notContains('搜索后 GU01 消失', searched, 'GU01');

/* 搜索大小写不敏感 */
const searchedLower = render(CARDS, { filter: { search: 'wr' } });
eq('搜索大小写不敏感（wr 也是 2 张）', countOf(searchedLower, 'data-card-id="'), 2);

/* ══════════════════════════════════════════════════════════════
 * ⑤ 搜索跳转：按编号精确（数据层判决）
 * ══════════════════════════════════════════════════════════════ */

eq('jumpTargetOf(DC02) = DC02', jumpTargetOf(CARDS, 'DC02'), 'DC02');
eq('jumpTargetOf( dc02 ) 大小写/空白不敏感', jumpTargetOf(CARDS, '  dc02 '), 'DC02');
eq('jumpTargetOf(DC) 输一半不跳', jumpTargetOf(CARDS, 'DC'), null);
eq('jumpTargetOf(不存在) = null', jumpTargetOf(CARDS, 'ZZ99'), null);

/* ══════════════════════════════════════════════════════════════
 * ⑥ 选中 / 空空间 / 环警告 / 图例
 * ══════════════════════════════════════════════════════════════ */

const selected = render(CARDS, { selectedId: 'DC01' });
eq('选中态恰好 1 张', countOf(selected, 'data-selected="true"'), 1);
contains('选中卡带 is-selected', selected, 'is-selected');

const empty = render([]);
contains('空空间 ⇒ data-empty="space"', empty, 'data-empty="space"');
notContains('空空间 ⇒ 不画 SVG', empty, '<svg');

const cycle = render(CYCLE_CARDS);
eq('环：两张卡都标 cycle 警告', countOf(cycle, 'data-card-warning="cycle"'), 2);
eq('环：警告数 = 2', Number(/data-warnings="(\d+)"/.exec(cycle)?.[1]), 2);
eq('环：三张卡一张不丢', countOf(cycle, 'data-card-id="'), CYCLE_CARDS.length);

const legend = renderToStaticMarkup(<TreeLegend />);
eq('关系图例 6 项', countOf(legend, 'data-rel="'), 6);
for (const label of ['派生', '依赖', '取代', '约束', '相关', '参考']) {
	contains(`图例含「${label}」`, legend, label);
}
contains('图例有 SVG 线 + 箭头', legend, 'tb3t-legend__head');

const showcase = render(SHOWCASE_CARDS);
for (const rel of ['derives', 'dependsOn', 'supersedes', 'constrains', 'related', 'references']) {
	contains(`六种关系全览含 ${rel}`, showcase, `data-edge="${rel}"`);
}

/* ══════════════════════════════════════════════════════════════
 * ⑦ 折叠组件（FoldPill / FoldRect）—— 真组件 SSR 渲染
 *
 * 用户 `2026-11-28` 的硬约束：
 * 1. 胶囊两态都在，class / 形状 / 样式不变，只差 caret；
 * 2. 虚线矩形收起时 **DOM 里不存在**；
 * 3. 展开时胶囊与矩形同宽、同左边缘。
 * ══════════════════════════════════════════════════════════════ */

/** 从 SSR HTML 里取第一个 class 属性的值。 */
function firstClassOf(html: string): string {
	return /class="([^"]*)"/.exec(html)?.[1] ?? '';
}

const closedPill = renderToStaticMarkup(
	<FoldPill open={false} label="组 1" count={3} onToggle={noop} width={190} />,
);
const openPill = renderToStaticMarkup(
	<FoldPill open={true} label="组 1" count={3} onToggle={noop} width={190} />,
);

eq('FoldPill 两态 class 完全相同', firstClassOf(closedPill), firstClassOf(openPill));
contains('FoldPill 收起 caret = ▸', closedPill, '>▸</span>');
contains('FoldPill 展开 caret = ▾', openPill, '>▾</span>');
contains('FoldPill 收起 aria-expanded=false', closedPill, 'aria-expanded="false"');
contains('FoldPill 展开 aria-expanded=true', openPill, 'aria-expanded="true"');
contains('FoldPill 两态都带同一个宽度样式', closedPill, 'style="width:190px"');
contains('FoldPill 展开后宽度样式不变', openPill, 'style="width:190px"');

const closedRect = renderToStaticMarkup(
	<FoldRect open={false}>内容</FoldRect>,
);
const openRect = renderToStaticMarkup(
	<FoldRect open={true}>内容</FoldRect>,
);
eq('FoldRect open=false ⇒ 返回空字符串（DOM 里没有矩形）', closedRect, '');
contains('FoldRect open=true ⇒ .tb3-fold-rect', openRect, 'class="tb3-fold-rect"');
contains('FoldRect 包住 children', openRect, '>内容</div>');

/* ── 接进 TechTree：同一组 g1 的收起 / 展开 ── */
const FOLD_GROUPS = [{ id: 'g1', memberIds: ['GU01', 'RB01'] }] as const;
const foldedTree = render(CARDS, { groups: FOLD_GROUPS, foldedIds: ['g1'] });
const openTree = render(CARDS, { groups: FOLD_GROUPS, foldedIds: [] });

eq('收起态仍有 1 个胶囊', countOf(foldedTree, 'data-fold-pill='), 1);
eq('展开态仍有 1 个胶囊（两态都在）', countOf(openTree, 'data-fold-pill='), 1);
eq('收起态没有容器矩形（不是透明）', countOf(foldedTree, 'data-fold-rect'), 0);
eq('展开态恰好 1 个容器矩形', countOf(openTree, 'data-fold-rect'), 1);
contains('两态胶囊 class 同一个', foldedTree, 'class="tb3-fold-pill"');
contains('展开态矩形 class 在', openTree, 'class="tb3-fold-rect"');
contains('胶囊与矩形同宽 190', openTree, 'style="width:190px"');
contains('组容器带 data-fold-group', openTree, 'data-fold-group="g1"');

/* 展开时两个成员卡必须真的被矩形包住（不是画布层另画一份）。 */
const rectAt = openTree.indexOf('data-fold-rect');
const firstMemberAt = openTree.indexOf('data-card-id="GU01"');
const secondMemberAt = openTree.indexOf('data-card-id="RB01"');
check(
	'展开态成员卡在矩形之后（DOM 里被矩形包住）',
	rectAt >= 0 && firstMemberAt > rectAt && secondMemberAt > rectAt,
	`rect@${String(rectAt)} GU01@${String(firstMemberAt)} RB01@${String(secondMemberAt)}`,
);
/* 收起态成员卡不露出（锚点也被胶囊取代）。 */
notContains('收起态 GU01 不露出', foldedTree, 'data-card-id="GU01"');
notContains('收起态 RB01 不露出', foldedTree, 'data-card-id="RB01"');

/* ══════════════════════════════════════════════════════════════
 * 汇总
 * ══════════════════════════════════════════════════════════════ */

const passed = results.filter((one) => one.ok).length;
for (const one of results) {
	console.log(`${one.ok ? '✓' : '✗'} ${one.name}${one.detail === '' ? '' : ` — ${one.detail}`}`);
}
console.log(`\nSSR 断言：${String(passed)}/${String(results.length)} 通过`);

if (passed !== results.length) {
	console.log('\n失败清单：');
	for (const one of results) {
		if (!one.ok) console.log(`  ✗ ${one.name} — ${one.detail}`);
	}
	process.exitCode = 1;
}
