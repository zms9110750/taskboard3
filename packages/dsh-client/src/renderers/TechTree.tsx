/**
 * 科技树（V1）—— **只负责画**。
 *
 * ## 坐标 / 路径全部来自已定稿的 `pure/tree-layout.ts`
 *
 * | 要画什么 | 谁算的 |
 * |---|---|
 * | 每张卡的列 / 行（含折栏） | `layoutTree()` |
 * | 父子拱弧的 `d` | `parentEdgePaths()`（`parentCurve` + `boxOf`） |
 * | 任意两卡之间的连线 `d` | `linkCurve()` + `toPathData()` |
 * | 画布尺寸 | `canvasSizeOf()` |
 *
 * 本文件**不重算任何坐标** —— 布局那 726 行有 29 条测试钉着，重算等于换一套真值。
 * 这里只有「画」的决定：卡片尺寸、颜色、箭头、hover 淡化、图例、空态。
 *
 * ## 用户 `2026-11-19` 要的交互，逐条落在哪
 *
 * | # | 交互 | 实现位置 |
 * |---|---|---|
 * | 1 | 科技树视图（一列一层） | `layoutTree()` 的 `column` → `boxOf()` → 卡片绝对定位 |
 * | 2 | 箭头，尖端贴目标卡边 | `<marker refX=9 orient=auto>`；路径终点就是 `boxOf().left/right` |
 * | 3 | hover 时**无关的边淡到 25%**，相连的加粗加深 | `activeId = hoverId ?? selectedId`；`.is-dim{opacity:.25}` / `.is-active{stroke-width:3}` + 光晕 |
 * | 4 | 筛选后不匹配的卡**隐藏**（不是变淡） | `visibleCardIds()` 决定画不画；隐藏卡**不进布局、不出 DOM** |
 * | 5 | 搜索后不匹配的卡**隐藏** | 同上（`TreeFilterCriteria.search`） |
 * | 6 | 搜索回车 / 点「前往」→ 打开指定编号详情 | 由**外层**用 `jumpTargetOf()` + `onSelect` 完成（本组件受控，不持搜索框） |
 *
 * ⚠ 第 3 与第 4/5 是**两种不同处理**：hover 只改 SVG 线层的 class（卡还在），
 * 筛选/搜索直接让卡从渲染树里消失。
 *
 * ## 受控
 *
 * 卡片数据 / 选中 / hover / 筛选条件全部由外面给；本组件不拉数据、不发请求。
 * `hoverId` 特意做成**受控 prop**（而不是内部 `useState`）—— 这样「无关边淡到
 * 25%」这个效果在 SSR 里也能断言（传 `hoverId="DC01"` 直接出静态 HTML）。
 *
 * ## hover 只重画 SVG 线层
 *
 * 卡片层是 `memo(CardsLayer)`，它的 props 不含 `hoverId` ⇒ hover 时 React 只重跑
 * 本组件 + SVG 子树，卡片 DOM 不重建（设计图 ③：「hover 只重画 SVG 线层，卡片
 * DOM 不重建（不闪）」）。
 *
 * ## 卡片是独立组件
 *
 * 卡片本体在 `src/renderers/TreeCard.tsx`（独立预览 `dev/preview/treecard/`）——
 * 本文件只负责把布局算好的 `left / top / width / height` 当 `style` 传给它。
 * 位置**永远由布局算**，卡片自己不算坐标。
 *
 * ## 样式在哪
 *
 * `TECHTREE_CSS` 在 `pure/techtree-css.ts`（纯 `.ts`，`styles.ts` 和本组件都 import
 * 同一份 ⇒ 产品与预览物理上不可能漂移）。这里只是 `export { TECHTREE_CSS }` 转发，
 * 并保留 `injectTechTreeStyles()` 供预览注入。
 * 卡片里的圆点 / 徽章 / 编号沿用 `styles.ts` 已有的 `.dot` / `.badge` / `.card-id`
 * 类名（预览里由 `preview.css` 提供同一条规则），所以颜色**只有一份真值**。
 */

import { memo, useId, useMemo } from 'react';
import type { ReactNode } from 'react';

import { RELATION_KINDS, TASK_STATES, isLinkKindId } from '@taskboard/protocol';
import type { RelationKindId } from '@taskboard/protocol';

import { stateLabel } from '../pure/card-view.ts';
import { TECHTREE_CSS } from '../pure/techtree-css.ts';
import { isFiltering, treeCardsOf, visibleCardIds } from '../pure/tree-filter.ts';
import type { TreeFilterCriteria } from '../pure/tree-filter.ts';
import {
	boxOf,
	canvasSizeOf,
	layoutTree,
	linkCurve,
	parentEdgePaths,
	toPathData,
} from '../pure/tree-layout.ts';
import type {
	TreeBox,
	TreeCurve,
	TreeLayout,
	TreeLayoutNode,
	TreeMetrics,
} from '../pure/tree-layout.ts';
import type { Card } from '../types.ts';
import { StatusDot } from './StatusDot.tsx';
import { TreeCard } from './TreeCard.tsx';

/* ══════════════════════════════════════════════════════════════
 * 一、视觉规格（**视图的事**，布局算法只收参数不写死）
 * ══════════════════════════════════════════════════════════════ */

/**
 * 卡片尺寸与间距。
 *
 * | 值 | 来由 |
 * |---|---|
 * | 180 × 78 | 设计图（`view-1-tech-tree.svg`）里卡片就是 180×78 |
 * | 列距 56 / 行距 14 / 留白 24 | 旧版用户 `2026-11-10` 的视觉裁决（`tree-layout.ts` 文件头引用） |
 *
 * ⚠ 这些是**视图参数**：`tree-layout.ts` 的路径函数收 `TreeMetrics`，不写死。
 */
export const TREE_METRICS = {
	/*
	 * 宽度按最坏内容算（用户 2026-11-20：「编号默认是双字母的。卡不够长。
	 * 要保证 4 字母。3 个 label 都是 4 个字。状态也是 4 个字的时候可以显示完整」）：
	 * LT01（4 字符）+ 3 个 4 字 label + 4 字状态 ≈ 224px 内容 + padding。
	 */
	cardWidth: 240,
	cardHeight: 78,
	columnGap: 56,
	rowGap: 14,
	padding: 24,
} satisfies TreeMetrics;

/** 列头（「第 0 层 · 根卡」）占的高度；卡片/连线整体下移这么多。 */
export const TREE_HEADER_HEIGHT = 34;

/** 无关的边在 hover 时淡到多少（用户 `2026-11-19`：「淡到 25%」）。 */
export const TREE_DIM_OPACITY = 0.25;

/** 层的中文名（第 5 层往后只显示层号 —— 亲缘词太长，没有信息增量）。 */
const LAYER_NAMES = ['根卡', '子卡', '孙卡', '曾孙卡', '玄孙卡'] as const;

/**
 * 层号 → 列头文字。
 *
 * @param layer 逻辑层号（0 = 根）
 */
function layerLabel(layer: number): string {
	const name = LAYER_NAMES[layer];
	return name === undefined ? `第 ${String(layer)} 层` : `第 ${String(layer)} 层 · ${name}`;
}

/* ══════════════════════════════════════════════════════════════
 * 二、关系图例
 * ══════════════════════════════════════════════════════════════ */

/** 图例一项。 */
export interface TreeLegendItem {
	/** 关系 id（`derives` / `dependsOn` / …）。同时是 CSS 的 `data-rel`。 */
	readonly rel: string;
	/** 中文名（来自 `protocol` 的 `RELATION_KINDS`，不在这里编）。 */
	readonly label: string;
	/** 悬停说明。 */
	readonly title: string;
}

/**
 * 六种关系的悬停说明。
 *
 * ⚠ 用 `satisfies Record<RelationKindId, string>`：protocol 的词汇表多/少一种关系时
 *   **这里直接编译失败**，而不是图例静默少一项。
 */
const RELATION_TITLES = {
	derives: '父任务 → 子任务（实线拱弧）',
	dependsOn: '这张卡依赖目标卡（必须先完成）',
	supersedes: '这张卡取代了旧卡',
	constrains: '这张卡限制了目标卡',
	related: '同一条线的工作（无向）',
	references: '只是引用，不是依赖',
} satisfies Record<RelationKindId, string>;

/**
 * 图例六项 —— 顺序和文案都来自 `protocol` 的 `RELATION_KINDS`（单一真值）。
 *
 * 颜色/线型在 `TECHTREE_CSS` 里按 `data-rel` 选：
 * 派生实线灰弧、依赖棕、取代紫、约束红、相关绿虚线、参考灰虚线（设计图 toolbar）。
 */
export const TREE_LEGEND: readonly TreeLegendItem[] = RELATION_KINDS.map((one) => ({
	rel: one.id,
	label: one.displayName,
	title: RELATION_TITLES[one.id],
}));

/**
 * 关系图例（工具栏用）。
 *
 * 单独导出是因为它画在**工具栏**（`Workspace` 的 chrome 区），不在画布里；
 * 但「六项都在」这个断言要能 SSR 到，所以做成组件而不是散在外层的 JSX。
 */
export function TreeLegend(): ReactNode {
	return (
		<div className="tb3t-legend" data-legend>
			{TREE_LEGEND.map((item) => (
				<span className="tb3t-legend__item" key={item.rel} data-rel={item.rel} title={item.title}>
					<svg className="tb3t-legend__svg" width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">
						<path
							className="tb3t-legend__path"
							d={item.rel === 'derives' ? 'M 2 11 Q 11 2, 20 7' : 'M 2 7 L 20 7'}
						/>
						<path className="tb3t-legend__head" d="M 19 3.5 L 25 7 L 19 10.5 Z" />
					</svg>
					<span>{item.label}</span>
				</span>
			))}
		</div>
	);
}

/* ══════════════════════════════════════════════════════════════
 * 三、连线几何
 * ══════════════════════════════════════════════════════════════ */

/** 一条要画的线（几何 + 关系 + 悬停标签位置）。 */
interface EdgeGeometry {
	readonly key: string;
	readonly from: string;
	readonly to: string;
	/** 关系 id：`derives` 或五种 link id。 */
	readonly rel: string;
	/** 中文名（hover 时画在线上）。 */
	readonly label: string;
	/** `true` = `links` 里的边；`false` = 父子派生边。 */
	readonly isLink: boolean;
	readonly d: string;
	/** 三次贝塞尔中点（标签位置）；父子边不画标签 ⇒ `null`。 */
	readonly labelAt: { readonly x: number; readonly y: number } | null;
}

/**
 * 关系标签 → 关系 id。
 *
 * 真实数据里 `relations.links[].label` 是 **LinkKindId**（`'dependsOn'` 这种）；
 * 但预览 / 旧数据里也出现过中文显示名（`'依赖'`）。两种都认，
 * 都不认的回落 `references`（灰虚线）—— **画错颜色比不画线好，但别丢线**。
 *
 * @param label 卡上的关系标签
 */
function resolveLinkRel(label: string): string {
	if (isLinkKindId(label)) return label;
	const byName = RELATION_KINDS.find((one) => one.displayName === label);
	return byName?.id ?? 'references';
}

/**
 * 关系 id → 中文名。
 *
 * @param rel 关系 id
 */
function relationLabel(rel: string): string {
	const hit = RELATION_KINDS.find((one) => one.id === rel);
	return hit?.displayName ?? rel;
}

/**
 * 三次贝塞尔在 `t=0.5` 的点（hover 时关系名标签的位置）。
 *
 * @param curve 曲线
 */
function midPointOf(curve: TreeCurve): { readonly x: number; readonly y: number } {
	return {
		x: (curve.start.x + 3 * curve.c1.x + 3 * curve.c2.x + curve.end.x) / 8,
		y: (curve.start.y + 3 * curve.c1.y + 3 * curve.c2.y + curve.end.y) / 8,
	};
}

/**
 * 一对节点的**无向**键（`related` 是双向的，两个方向要当成同一对来错开）。
 *
 * @param a 一端
 * @param b 另一端
 */
function pairKey(a: string, b: string): string {
	return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * 算全部连线。
 *
 * ① 父子边：直接用 `parentEdgePaths()`（方向自适应已经在纯函数里测过）；
 * ② `links` 边：`linkCurve()` + `toPathData()`，同一对节点的多条边用 `bend` 错开
 *    （设计图 ②「同对节点多条边用 bend 错开，不重合」）。
 *
 * ⚠ 两端必须都**在布局里**（= 都可见）。隐藏的卡没有位置，线也不该留着。
 *
 * @param cards 全部卡（顺序决定边顺序，确定性）
 * @param layout 布局结果（只含可见卡）
 * @param metrics 卡片尺寸
 */
function buildEdges(
	cards: readonly Card[],
	layout: TreeLayout,
	metrics: TreeMetrics,
): readonly EdgeGeometry[] {
	const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
	const out: EdgeGeometry[] = [];

	/* ── ① 父子派生边 ── */
	for (const path of parentEdgePaths(layout, metrics)) {
		out.push({
			key: `parent:${path.from}>${path.to}`,
			from: path.from,
			to: path.to,
			rel: 'derives',
			label: '派生',
			isLink: false,
			d: path.d,
			labelAt: null,
		});
	}

	/* ── ② links 边：先收集候选，再按「无向对」分配 bend ── */
	interface Candidate {
		readonly from: string;
		readonly to: string;
		readonly rel: string;
		readonly fromBox: TreeBox;
		readonly toBox: TreeBox;
	}
	const candidates: Candidate[] = [];
	for (const card of cards) {
		const fromNode = nodeById.get(card.id);
		if (fromNode === undefined) continue;
		for (const link of card.relations.links) {
			const toNode = nodeById.get(link.to);
			if (toNode === undefined) continue;
			candidates.push({
				from: card.id,
				to: link.to,
				rel: resolveLinkRel(link.label),
				fromBox: boxOf(fromNode, metrics),
				toBox: boxOf(toNode, metrics),
			});
		}
	}

	const pairCount = new Map<string, number>();
	for (const candidate of candidates) {
		const key = pairKey(candidate.from, candidate.to);
		pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
	}
	const pairSeen = new Map<string, number>();
	for (const candidate of candidates) {
		const key = pairKey(candidate.from, candidate.to);
		const seen = pairSeen.get(key) ?? 0;
		pairSeen.set(key, seen + 1);
		const count = pairCount.get(key) ?? 1;
		/* 居中对齐：n=1 ⇒ 0；n=2 ⇒ ±12；n=3 ⇒ -24/0/+24。 */
		const bend = (seen - (count - 1) / 2) * 24;
		const curve = linkCurve(candidate.fromBox, candidate.toBox, bend);
		out.push({
			key: `link:${candidate.from}>${candidate.to}:${candidate.rel}:${String(seen)}`,
			from: candidate.from,
			to: candidate.to,
			rel: candidate.rel,
			label: relationLabel(candidate.rel),
			isLink: true,
			d: toPathData(curve),
			labelAt: midPointOf(curve),
		});
	}

	return out;
}

/* ══════════════════════════════════════════════════════════════
 * 四、组件属性
 * ══════════════════════════════════════════════════════════════ */

/** 科技树属性 —— 数据、选中、hover、筛选全部由外面给。 */
export interface TechTreeProps {
	/** 本空间的全部卡（**不是**筛过的 —— 筛选在本组件内做，才能 SSR 断言「隐藏」）。 */
	readonly cards: readonly Card[];
	/** 选中的卡（右栏详情由外层渲染；这里只画选中框）。`null` = 没选。 */
	readonly selectedId: string | null;
	/**
	 * 正在 hover 的卡。**受控**：省略 = 没有 hover。
	 *
	 * ⚠ 做成受控是为了让「无关的边淡到 25%」能被 SSR 断言 —— 传一个 id 直接出静态 HTML。
	 */
	readonly hoverId?: string | null;
	/** 筛选 / 搜索条件；省略 = 不过滤。 */
	readonly filter?: TreeFilterCriteria;
	/** 类别中文名（从模板清单查；不传显示英文 id —— 不编中文）。 */
	readonly kindLabelOf?: (kind: string) => string;
	/**
	 * 模板显示名（从模板清单查）。
	 *
	 * 省略 = 卡片上**不画**模板 badge（科技树设计图的卡片只有类别 + 领域，
	 * 产品当前就是这个形态）；传了 = 多一个 `badge--template`
	 * （列表行 `CardRow` 那种「类别 / 领域 / 模板」三个 label）。
	 */
	readonly templateLabelOf?: (ref: string) => string;
	/** 每栏最多几行（超过折栏）；省略 = `tree-layout.ts` 的默认 10。 */
	readonly maxRowsPerColumn?: number;
	/** 点一张卡。 */
	readonly onSelect: (cardId: string) => void;
	/** hover 变化（离开时传 `null`）。省略 = 不响应 hover（仍可点选）。 */
	readonly onHoverChange?: (cardId: string | null) => void;
}

/* ══════════════════════════════════════════════════════════════
 * 五、卡片层（memo —— hover 时不重建）
 * ══════════════════════════════════════════════════════════════ */

/** 一张卡 + 它的位置（布局里已经有坐标，这里只加盒子）。 */
interface CardItem {
	readonly card: Card;
	readonly node: TreeLayoutNode;
	readonly box: TreeBox;
}

/** 卡片层属性。 */
interface CardsLayerProps {
	readonly items: readonly CardItem[];
	readonly metrics: TreeMetrics;
	readonly selectedId: string | null;
	readonly kindLabelOf: (kind: string) => string;
	/** 模板显示名；`undefined` = 不画模板 badge（产品当前就是这种，见 TreeCard 文件头）。 */
	readonly templateLabelOf: ((ref: string) => string) | undefined;
	readonly onSelect: (cardId: string) => void;
	readonly onHoverChange: ((cardId: string | null) => void) | undefined;
}

/**
 * 卡片层 —— 只是把布局算好的位置套到 `TreeCard` 上。
 *
 * ⚠ `memo` 的意义：`hoverId` **不在**它的 props 里 ⇒ hover 只重画 SVG 线层，
 *   卡片 DOM 不重建（设计图 ③）。默认浅比较即可 —— 调用方要保证回调 / 卡片数组
 *   的引用稳定（预览里用 `useState` 的 setter 和模块级常量，天然稳定）。
 *
 * ⚠ 卡片本体在 `TreeCard.tsx`（独立组件，有独立预览 `dev/preview/treecard/`）。
 *   这里只负责：把 `node` 的层号 / 警告 / 盒子翻译成 `TreeCard` 的 props。
 */
const CardsLayer = memo(function CardsLayer(props: CardsLayerProps): ReactNode {
	return (
		<>
			{props.items.map((item) => (
				<TreeCard
					key={item.card.id}
					card={item.card}
					kindLabel={props.kindLabelOf(item.card.template.kind)}
					templateLabel={props.templateLabelOf?.(item.card.template.ref) ?? ''}
					selected={item.card.id === props.selectedId}
					{...(item.node.warning === undefined ? {} : { warning: item.node.warning })}
					layer={item.node.layer}
					onSelect={props.onSelect}
					onHoverChange={props.onHoverChange}
					style={{
						left: item.box.left,
						top: TREE_HEADER_HEIGHT + item.box.top,
						width: props.metrics.cardWidth,
						height: props.metrics.cardHeight,
					}}
				/>
			))}
		</>
	);
});

/* ══════════════════════════════════════════════════════════════
 * 六、主组件
 * ══════════════════════════════════════════════════════════════ */

/**
 * 科技树画布。
 *
 * @param props 见 `TechTreeProps`
 */
export function TechTree(props: TechTreeProps): ReactNode {
	const metrics = TREE_METRICS;
	const kindLabelOf = props.kindLabelOf ?? ((kind: string): string => kind);

	/* ── ① 筛选 / 搜索：隐藏不匹配的卡（不是变淡） ── */
	const status = props.filter?.status;
	const kind = props.filter?.kind;
	const domain = props.filter?.domain;
	const search = props.filter?.search;
	const filtering = isFiltering(props.filter);

	const visibleIds = useMemo(
		() => visibleCardIds(props.cards, { status, kind, domain, search }),
		[props.cards, status, kind, domain, search],
	);

	const treeCards = useMemo(
		() => treeCardsOf(props.cards, visibleIds),
		[props.cards, visibleIds],
	);

	/* ── ② 布局（已定稿算法，不重算） ── */
	const layout = useMemo(() => {
		const options = props.maxRowsPerColumn === undefined
			? undefined
			: { maxRowsPerColumn: props.maxRowsPerColumn };
		return layoutTree(treeCards, options);
	}, [treeCards, props.maxRowsPerColumn]);

	const canvas = useMemo(() => canvasSizeOf(layout, metrics), [layout, metrics]);

	const cardById = useMemo(
		() => new Map(props.cards.map((card) => [card.id, card])),
		[props.cards],
	);

	const items = useMemo<readonly CardItem[]>(() => {
		const out: CardItem[] = [];
		for (const node of layout.nodes) {
			const card = cardById.get(node.id);
			if (card === undefined) continue;
			out.push({ card, node, box: boxOf(node, metrics) });
		}
		return out;
	}, [layout, cardById, metrics]);

	const edges = useMemo(
		() => buildEdges(props.cards, layout, metrics),
		[props.cards, layout, metrics],
	);

	/* ── ③ 列背景 + 列头（每个**物理栏**一条；折栏后同层多栏各自有头） ── */
	const bands = useMemo(() => {
		const laneOf = new Map<number, number>();
		const seenPerLayer = new Map<number, number>();
		return layout.bands.map((band) => {
			const lane = seenPerLayer.get(band.layer) ?? 0;
			seenPerLayer.set(band.layer, lane + 1);
			laneOf.set(band.column, lane);
			const x = band.column * (metrics.cardWidth + metrics.columnGap) + metrics.padding;
			const height =
				TREE_HEADER_HEIGHT +
				metrics.padding +
				(band.rowCount - 1) * (metrics.cardHeight + metrics.rowGap) +
				metrics.cardHeight +
				Math.round(metrics.padding / 2);
			return {
				column: band.column,
				layer: band.layer,
				lane,
				x,
				width: metrics.cardWidth,
				height,
				label: lane === 0 ? layerLabel(band.layer) : `第 ${String(band.layer)} 层 · 第 ${String(lane + 1)} 栏`,
			};
		});
	}, [layout.bands, metrics]);

	/* ── ④ hover / 选中 ⇒ 相连的边高亮，无关的淡到 25% ── */
	const nodeIds = useMemo(() => new Set(layout.nodes.map((node) => node.id)), [layout]);
	const rawActiveId = props.hoverId ?? props.selectedId;
	/* hover 到一张被筛掉的卡（状态残留）时不要「全部变淡」—— 当作没有 hover。 */
	const activeId = rawActiveId !== null && rawActiveId !== undefined && nodeIds.has(rawActiveId)
		? rawActiveId
		: null;

	const edgeViews = useMemo(() => {
		if (activeId === null) {
			return edges.map((edge) => ({ edge, active: false, dim: false }));
		}
		return edges.map((edge) => {
			const active = edge.from === activeId || edge.to === activeId;
			return { edge, active, dim: !active };
		});
	}, [edges, activeId]);

	/* 先画无关的（淡），再画相连的（盖在上面）。 */
	const orderedEdgeViews = useMemo(() => {
		if (activeId === null) return edgeViews;
		return [...edgeViews.filter((one) => !one.active), ...edgeViews.filter((one) => one.active)];
	}, [edgeViews, activeId]);

	const markerPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');

	/* ── ⑤ 空态：两种要分开说 ── */
	if (props.cards.length === 0) {
		return (
			<div className="tb3t-root" data-view="tech-tree">
				<div className="tb3t-empty" data-empty="space">
					这个空间还没有卡。
				</div>
			</div>
		);
	}
	if (layout.nodes.length === 0) {
		return (
			<div className="tb3t-root" data-view="tech-tree">
				<div className="tb3t-empty" data-empty="filtered">
					没有匹配的卡（共 {String(props.cards.length)} 条被筛选 / 搜索隐藏）。
				</div>
			</div>
		);
	}

	const orphanCount = layout.warnings.filter((one) => one.kind === 'orphan').length;
	const cycleCount = layout.warnings.filter((one) => one.kind === 'cycle').length;
	const stageWidth = canvas.width;
	const stageHeight = canvas.height + TREE_HEADER_HEIGHT;

	return (
		<div
			className="tb3t-root"
			data-view="tech-tree"
			data-filtering={filtering ? 'true' : 'false'}
			data-selected={props.selectedId ?? ''}
		>
			<div className="tb3t-scroll" data-canvas-scroll>
				<div
					className="tb3t-stage"
					data-stage
					data-card-count={String(layout.nodes.length)}
					data-edge-count={String(edges.length)}
					style={{ width: stageWidth, height: stageHeight }}
				>
					{/* 列背景 + 列头（在 SVG / 卡片下面） */}
					{bands.map((band) => (
						<div
							className="tb3t-band"
							key={`band:${String(band.column)}`}
							data-band={String(band.column)}
							data-layer={String(band.layer)}
							style={{ left: band.x, top: 0, width: band.width, height: band.height }}
						>
							<span className="tb3t-band__title">{band.label}</span>
						</div>
					))}

					{/* SVG 线层：箭头 / 关系色 / hover 淡化都在这层 */}
					<svg
						className="tb3t-links"
						width={canvas.width}
						height={canvas.height}
						viewBox={`0 0 ${String(canvas.width)} ${String(canvas.height)}`}
						style={{ top: TREE_HEADER_HEIGHT }}
						aria-hidden="true"
						data-links
					>
						<defs>
							{TREE_LEGEND.map((item) => (
								<marker
									key={item.rel}
									id={`${markerPrefix}-arrow-${item.rel}`}
									className={`tb3t-arrow tb3t-arrow--${item.rel}`}
									viewBox="0 0 10 10"
									refX="9"
									refY="5"
									markerWidth="8"
									markerHeight="8"
									markerUnits="userSpaceOnUse"
									orient="auto"
								>
									<path d="M 0 1 L 9 5 L 0 9 z" />
								</marker>
							))}
						</defs>

						{orderedEdgeViews.map(({ edge, active, dim }) => (
							<g
								key={edge.key}
								data-edge={edge.rel}
								data-from={edge.from}
								data-to={edge.to}
								data-link={edge.isLink ? 'true' : 'false'}
							>
								{/* 相连的边：宽 10 的低透明度光晕（设计图「加粗 + 加深 + 阴影」） */}
								{active ? (
									<path
										className={`tb3t-edge-glow tb3t-edge--${edge.rel}`}
										d={edge.d}
										data-glow="true"
									/>
								) : null}
								<path
									className={[
										'tb3t-edge',
										`tb3t-edge--${edge.rel}`,
										dim ? 'is-dim' : '',
										active ? 'is-active' : '',
									]
										.filter((one) => one !== '')
										.join(' ')}
									d={edge.d}
									data-dim={dim ? 'true' : 'false'}
									data-active={active ? 'true' : 'false'}
									markerEnd={`url(#${markerPrefix}-arrow-${edge.rel})`}
								/>
								{/* hover 时在相连的 links 边上标关系名（父子边不标） */}
								{active && edge.isLink && edge.labelAt !== null ? (
									<text
										className={`tb3t-edge-label tb3t-edge-label--${edge.rel}`}
										x={edge.labelAt.x}
										y={edge.labelAt.y - 5}
										data-edge-label={edge.rel}
									>
										{edge.label}
									</text>
								) : null}
							</g>
						))}
					</svg>

					{/* 卡片层（memo：hover 不重建；卡片本体在 TreeCard.tsx） */}
					<CardsLayer
						items={items}
						metrics={metrics}
						selectedId={props.selectedId}
						kindLabelOf={kindLabelOf}
						templateLabelOf={props.templateLabelOf}
						onSelect={props.onSelect}
						onHoverChange={props.onHoverChange}
					/>
				</div>
			</div>

			{/* 画布下面：状态图例（圆点 + 中文名，不只靠颜色）+ 布局警告 */}
			<div className="tb3t-footer" data-footer>
				<div className="tb3t-footer__states" data-state-legend>
					<span className="tb3t-footer__label">状态圆点</span>
					{TASK_STATES.map((state) => (
						<span className="tb3t-footer__state" key={state} data-state={state}>
							<StatusDot status={state} size={5} />
							<span>{stateLabel(state)}</span>
						</span>
					))}
				</div>
				<div
					className={layout.warnings.length > 0 ? 'tb3t-footer__warn has-warning' : 'tb3t-footer__warn'}
					data-warnings={String(layout.warnings.length)}
					title={
						layout.warnings.length === 0
							? undefined
							: layout.warnings.map((one) => one.detail).join('\n')
					}
				>
					{layout.warnings.length === 0
						? '▲ = 布局警告（孤儿 / 环）'
						: `▲ 布局警告 ${String(layout.warnings.length)} 条（孤儿 ${String(orphanCount)} / 环 ${String(cycleCount)}）`}
				</div>
			</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════════
 * 七、样式（合并时并进 `src/styles.ts`）
 * ══════════════════════════════════════════════════════════════ */

/** 注入用的 `<style>` id（幂等，同 `styles.ts` 的手法）。 */
export const TECHTREE_STYLE_ID = 'taskboard3-techtree-styles';

/**
 * 科技树样式 —— 前缀 `tb3t-`。
 *
 * ⚠ **CSS 本体不在这里**：在 `pure/techtree-css.ts`，和 `styles.ts` 共用同一份。
 *   曾经这里是两份复制（`styles.ts` 不能 import `.tsx`，而组件又不能 import
 *   `styles.ts`），靠人肉保证一致 —— 那是「改了不会被任何测试发现」的形态。
 *   抽成纯 `.ts` 之后两份都 import 它，物理上不可能漂移。
 */
export { TECHTREE_CSS };


/**
 * 把科技树样式插进文档（幂等）。
 *
 * ⚠ 合并时应改成 `styles.ts` 的 `injectStyles()` 里拼上 `TECHTREE_CSS`；
 *   这个函数留在这里是为了让预览（没有宿主样式注入）也能用同一份 CSS。
 */
export function injectTechTreeStyles(): void {
	if (typeof document === 'undefined') return;
	if (document.getElementById(TECHTREE_STYLE_ID) !== null) return;
	const element = document.createElement('style');
	element.id = TECHTREE_STYLE_ID;
	element.textContent = TECHTREE_CSS;
	document.head.appendChild(element);
}
