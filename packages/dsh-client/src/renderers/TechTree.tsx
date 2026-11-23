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

import { memo, useId, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { RELATION_KINDS, TASK_STATES, isLinkKindId } from '@taskboard/protocol';
import type { RelationKindId } from '@taskboard/protocol';

import { isEndedStatus, stateLabel, unreadSides } from '../pure/card-view.ts';
import { TECHTREE_CSS } from '../pure/techtree-css.ts';
import { isFiltering, treeCardsOf, visibleCardIds } from '../pure/tree-filter.ts';
import { badgeCountOf, treeFoldOf } from '../pure/tree-fold.ts';
import {
	groupLabelOf,
	type GroupableCard,
} from '../pure/sibling-groups.ts';
import type { TreeGroup } from '../pure/ui-state.ts';
import type { TreeFilterCriteria } from '../pure/tree-filter.ts';
import {
	boxOf,
	canvasSizeOf,
	lanePlansOf,
	layoutTree,
	linkCurve,
	parentEdgePathsOf,
	toPathData,
} from '../pure/tree-layout.ts';
import type {
	TreeBox,
	TreeCurve,
	TreeLane,
	TreeLayout,
	TreeLayoutNode,
	TreeMetrics,
} from '../pure/tree-layout.ts';
import type { Card } from '../types.ts';
import { uiStateStore } from '../ui-state-store.ts';
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
	cardWidth: 190,
	cardHeight: 78,
	columnGap: 56,
	rowGap: 14,
	padding: 24,
} satisfies TreeMetrics;

/** 列头（「第 0 层 · 根卡」）占的高度；卡片/连线整体下移这么多。 */
export const TREE_HEADER_HEIGHT = 34;

/**
 * 组横幅的高度（用户 2026-11-24：「把组变成很矮的横幅」）。
 *
 * 卡片高 78，横幅只有 18 ⇒ 一眼能看出「这是一条横幅，不是一张卡」。
 * 展开时把它挤在行距（14px）附近，尽量减少压到上面的卡。
 */
export const GROUP_BANNER_HEIGHT = 18;

/**
 * 一列里「收起的分组横幅」的**槽位步进**（含与下一项的间距）。
 *
 * 用户 `2026-11-24`：
 * > 「让列成为一个组件。内部管理。」
 * > 「一个横幅的占位（包括间距），让他变成0.5卡高。也就是说两个横幅=1卡（包括间距）」
 *
 * 卡槽 = 78 + 14 = 92 ⇒ 横幅槽 = 46（**两个横幅正好一个卡槽**）。
 * 横幅本体仍是 `GROUP_BANNER_HEIGHT`（18），多的 28 是这一槽的余白 —— 不把横幅拉高。
 */
export const GROUP_BANNER_PITCH = (TREE_METRICS.cardHeight + TREE_METRICS.rowGap) / 2;

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
	boxes: ReadonlyMap<string, TreeBox>,
): readonly EdgeGeometry[] {
	const out: EdgeGeometry[] = [];

	/* ── ① 父子派生边 ── */
	for (const path of parentEdgePathsOf(layout, boxes)) {
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
		const fromBox = boxes.get(card.id);
		if (fromBox === undefined) continue;
		for (const link of card.relations.links) {
			const toBox = boxes.get(link.to);
			if (toBox === undefined) continue;
			candidates.push({
				from: card.id,
				to: link.to,
				rel: resolveLinkRel(link.label),
				fromBox,
				toBox,
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
	/**
	 * 用户显式**折叠**的 id；省略 = 读模块级单例 store（三入口共享）。
	 *
	 * ⚠ 省略时本组件自己订阅 store —— 那是产品形态；预览 / 测试传显式值，避免打网络。
	 */
	readonly foldedIds?: readonly string[];
	/** 用户显式**展开**的 id；省略 = 读 store。 */
	readonly expandedIds?: readonly string[];
	/** 点折叠三角；省略 = 写 store。 */
	readonly onToggleFold?: (id: string, folded: boolean) => void;
	/**
	 * 组的定义；省略 = 读模块级单例 store。
	 *
	 * 组只影响**布局**：折叠的组把成员藏起来、在原位置画一个组节点。
	 */
	readonly groups?: readonly TreeGroup[];
	/** 点最左「根卡」窄列；省略 = 不渲染那一列（预览 / 测试）。 */
	readonly onRootColumnClick?: () => void;
	/** 根卡关系视图是否正开着（给窄列高亮）。 */
	readonly rootColumnOpen?: boolean;
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
	/** 可以折叠的节点（有子卡）。 */
	readonly foldable: ReadonlySet<string>;
	/** 当前折叠的节点。 */
	readonly folded: ReadonlySet<string>;
	/** 「N 张」的数量查询。 */
	readonly badgeCountOf: (id: string) => number;
	readonly onToggleFold: (id: string, folded: boolean) => void;
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
			{/*
			 * ── 折叠控件：有子卡的节点才有（用户 2026-11-24） ──
			 *
			 * 用户原话：「这个箭头，放的不太对。挡住东西了。放在卡的右下角。并且不用三角形。用加号。
			 *   而且还要现实数字。默认数字。鼠标放上去他就变成加号。展开以后就是减号，不显示数字了。」
			 *
			 * ⇒ 一个控件、三态：
			 *   折叠且未 hover  → 数字（后代数）
			 *   折叠且 hover    → ＋
			 *   已展开          → －（不显示数字）
			 * 位置：卡片**右下角内侧**（原来是右上角，挡住了类别/状态）。
			 */}
			{props.items.map((item) => {
				if (!props.foldable.has(item.card.id)) return null;
				const isFolded = props.folded.has(item.card.id);
				return (
					<button
						key={`fold:${item.card.id}`}
						type="button"
						className={`tb3t-fold${isFolded ? ' is-folded' : ' is-open'}`}
						data-fold-toggle={item.card.id}
						data-folded={isFolded ? '1' : '0'}
						title={isFolded ? '展开这一棵子树' : '折叠这一棵子树'}
						aria-label={isFolded ? '展开' : '折叠'}
						aria-expanded={!isFolded}
						onClick={(event) => {
							event.stopPropagation();
							props.onToggleFold(item.card.id, !isFolded);
						}}
						style={{
							position: 'absolute',
							left: item.box.left + props.metrics.cardWidth - 28,
							top: TREE_HEADER_HEIGHT + item.box.top + props.metrics.cardHeight - 22,
						}}
					>
						{isFolded ? (
							<>
								<span className="tb3t-fold__count">
									{String(props.badgeCountOf(item.card.id))}
								</span>
								<span className="tb3t-fold__plus" aria-hidden="true">
									+
								</span>
							</>
						) : (
							<span className="tb3t-fold__minus" aria-hidden="true">
								−
							</span>
						)}
					</button>
				);
			})}
		</>
	);
});

/** 一条组横幅的渲染位置与文案（由主组件算好，列只负责画）。 */
interface BannerView {
	readonly group: TreeGroup;
	readonly label: string;
	readonly collapsed: boolean;
	readonly count: number;
	readonly left: number;
	readonly top: number;
	readonly width: number;
}

/** 列组件的属性。 */
interface TreeColumnProps {
	/** 这一列的排版结果（y 已经按列独立算好）。 */
	readonly lane: TreeLane;
	/** 这一列的列背景 + 列头（没有 band 的列不画）。 */
	readonly band:
		| { readonly layer: number; readonly label: string; readonly height: number }
		| undefined;
	/** 这一列要画的卡（已剔除被横幅取代的锚点）。 */
	readonly items: readonly CardItem[];
	/** 这一列的组横幅。 */
	readonly banners: readonly BannerView[];
	readonly metrics: TreeMetrics;
	readonly selectedId: string | null;
	readonly kindLabelOf: (kind: string) => string;
	readonly templateLabelOf: ((ref: string) => string) | undefined;
	readonly onSelect: (cardId: string) => void;
	readonly onHoverChange: ((cardId: string | null) => void) | undefined;
	readonly foldable: ReadonlySet<string>;
	readonly folded: ReadonlySet<string>;
	readonly badgeCountOf: (id: string) => number;
	readonly onToggleFold: (id: string, folded: boolean) => void;
}

/**
 * 一列（一个物理栏）—— **列自己管理自己的纵向排版**。
 *
 * 用户 `2026-11-24`：
 * > 「让列成为一个组件。内部管理。」
 * > 「一个横幅的占位（包括间距），让他变成0.5卡高。也就是说两个横幅=1卡（包括间距）」
 *
 * 坐标由 `lanePlansOf()` 按列独立算（纯函数，和主组件共用同一份 —— 主组件只用它给连线拿矩形）。
 * 本组件不写任何 y 计算：它拿到自己那一列的 `lane.items`（含 top/height）直接画。
 *
 * ⚠ 为什么用 Fragment 而不是包一层 `<div>`：卡片/横幅都是相对 `.tb3t-stage` 绝对定位的，
 *   多包一层会改掉定位基准和点击层级；列只是「渲染单元」，不是一个盒子。
 */
function TreeColumn(props: TreeColumnProps): ReactNode {
	const { lane, band, metrics, items, banners } = props;
	return (
		<>
			{band === undefined ? null : (
				<div
					className="tb3t-band"
					data-band={String(lane.lane)}
					data-layer={String(band.layer)}
					style={{ left: lane.x, top: 0, width: lane.width, height: band.height }}
				>
					<span className="tb3t-band__title">{band.label}</span>
				</div>
			)}

			<CardsLayer
				items={items}
				metrics={metrics}
				selectedId={props.selectedId}
				kindLabelOf={props.kindLabelOf}
				foldable={props.foldable}
				folded={props.folded}
				badgeCountOf={props.badgeCountOf}
				onToggleFold={props.onToggleFold}
				templateLabelOf={props.templateLabelOf}
				onSelect={props.onSelect}
				onHoverChange={props.onHoverChange}
			/>

			{banners.map((banner) => (
				<button
					type="button"
					key={`group:${banner.group.id}`}
					className={`tb3t-groupbanner${banner.collapsed ? ' is-collapsed' : ' is-expanded'}`}
					data-tree-group-banner={banner.group.id}
					data-collapsed={banner.collapsed ? '1' : '0'}
					title={banner.collapsed ? '展开这个组' : '收起这个组'}
					aria-expanded={!banner.collapsed}
					style={{
						left: banner.left,
						top: TREE_HEADER_HEIGHT + banner.top,
						width: banner.width,
					}}
					onClick={(event) => {
						event.stopPropagation();
						/* 折叠 → 展开传 false；展开 → 收起传 true。 */
						props.onToggleFold(banner.group.id, !banner.collapsed);
					}}
				>
					<span className="tb3t-groupbanner__caret">{banner.collapsed ? '▸' : '▾'}</span>
					<span className="tb3t-groupbanner__name">{banner.label}</span>
					<span className="tb3t-groupbanner__count">{String(banner.count)} 张</span>
				</button>
			))}
		</>
	);
}

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
	const unread = props.filter?.unread;

	const filtering = isFiltering(props.filter);

	/*
	 * 折叠态：省略 props 时读模块级单例（三入口共享一份，用户 2026-11-24
	 * 「三出入口用同一的。内存都是一份数据。」）。
	 */
	const uiSnapshot = useSyncExternalStore(uiStateStore.subscribe, uiStateStore.getSnapshot);
	const foldedIds = props.foldedIds ?? uiSnapshot.folded;
	const expandedIds = props.expandedIds ?? uiSnapshot.expanded;
	const onToggleFold =
		props.onToggleFold ??
		((id: string, folded: boolean): void => {
			uiStateStore.setFolded(id, folded);
		});

	/*
	 * 子树折叠（用户 2026-11-24）：
	 * 默认判据 = 自己终结 + 后代全终结 + 无用户未读 + 有子卡 + 不在 expanded 里。
	 * 折叠 ⇒ **整棵后代不参与布局**（只留折叠节点自己）。
	 */
	const foldState = useMemo(() => {
		const nodes = props.cards.map((card) => {
			const rawParent = card.relations.parent;
			return {
				id: card.id,
				parent: typeof rawParent === 'string' && rawParent !== '' ? rawParent : null,
				ended: isEndedStatus(card.status),
				userUnread: unreadSides(card.unread).left,
			};
		});
		return treeFoldOf(nodes, foldedIds, expandedIds);
	}, [props.cards, foldedIds, expandedIds]);

	const filteringVisibleIds = useMemo<ReadonlySet<string>>(
		() => visibleCardIds(props.cards, { status, kind, domain, search, unread }),
		[props.cards, status, kind, domain, search, unread],
	);
	/*
	 * 兄弟归组（用户 2026-11-24）：
	 *   折叠中的组 ⇒ 成员不参与布局（和子树折叠同一个隐藏来源）；
	 *   在原位置画一个组节点替代。
	 * 组只影响布局，不碰卡数据。
	 */
	const groups = props.groups ?? uiSnapshot.groups;
	const groupableCards = useMemo<readonly GroupableCard[]>(
		() =>
			props.cards.map((card) => ({
				id: card.id,
				title: card.title,
				parent: card.relations.parent,
			})),
		[props.cards],
	);
	const foldedIdSet = useMemo(() => new Set(foldedIds), [foldedIds]);
	/*
	 * 组的两种状态都要能被点到（用户 2026-11-24「组展开了就收不回来了」）。
	 *
	 * ⇒ 这里**不再只算折叠中的组**，而是算出「这个空间里所有还有成员的组」，
	 *   折叠态只决定两件事：
	 *     ① 折叠 ⇒ 除锚点外的成员藏起来（不参与布局）
	 *     ② 横幅画在哪（折叠 ⇒ 占锚点位置；展开 ⇒ 画在成员区域上方）
	 *
	 * 为什么折叠时留第一个成员当锚点：藏光了就没有 box 可放横幅了，
	 * 而且成员本来就在布局里占位置，留锚点位置不跳。
	 */
	const groupPlan = useMemo(() => {
		const present = new Set(props.cards.map((card) => card.id));
		const presentGroups = groups.filter((group) =>
			group.memberIds.some((id) => present.has(id)),
		);
		const anchors = new Map<string, string>();
		const hidden = new Set<string>();
		for (const group of presentGroups) {
			if (!foldedIdSet.has(group.id)) continue;
			const anchor = group.memberIds.find((id) => present.has(id));
			if (anchor === undefined) continue;
			anchors.set(group.id, anchor);
			for (const id of group.memberIds) {
				if (id !== anchor && present.has(id)) hidden.add(id);
			}
		}
		return { presentGroups, anchors, hidden };
	}, [props.cards, groups, foldedIdSet]);
	const groupHidden = groupPlan.hidden;
	const rootCardCount = useMemo(
		() => groupableCards.filter((card) => card.parent === null).length,
		[groupableCards],
	);
	/* 三个隐藏来源取交集：筛选掉的 + 子树折叠的 + 组折叠的，都不参与布局。 */
	const visibleIds = useMemo<ReadonlySet<string>>(() => {
		if (foldState.hidden.size === 0 && groupHidden.size === 0) return filteringVisibleIds;
		const out = new Set<string>();
		for (const id of filteringVisibleIds) {
			if (foldState.hidden.has(id)) continue;
			if (groupHidden.has(id)) continue;
			out.add(id);
		}
		return out;
	}, [filteringVisibleIds, foldState, groupHidden]);
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

	/*
	 * 收起的分组：那一槽只画一条 18px 横幅 ⇒ 槽位步进 46（两个横幅 = 一个卡槽）。
	 *
	 * 用户 `2026-11-24`：
	 * > 「让列成为一个组件。内部管理。」
	 * > 「一个横幅的占位（包括间距），让他变成0.5卡高。也就是说两个横幅=1卡（包括间距）」
	 *
	 * ⚠ 与上一轮的差别：上一轮是**全局行表**（所有列共享 `tops[row]`），
	 *   所以别的列同一行还有卡时，这一列压不下去。现在 `lanePlansOf` **按列独立累加**，
	 *   收起的组只影响它自己那一列后面的 item，别的列纹丝不动。
	 */
	const collapsedAnchorIds = useMemo(
		() => new Set(groupPlan.anchors.values()),
		[groupPlan.anchors],
	);
	const lanePlans = useMemo(
		() =>
			lanePlansOf(layout, metrics, (id) =>
				collapsedAnchorIds.has(id)
					? { height: GROUP_BANNER_HEIGHT, pitch: GROUP_BANNER_PITCH }
					: undefined,
			),
		[layout, metrics, collapsedAnchorIds],
	);

	const canvas = useMemo(
		() => ({
			width: canvasSizeOf(layout, metrics).width,
			height: lanePlans.stageHeight,
		}),
		[layout, metrics, lanePlans.stageHeight],
	);

	const cardById = useMemo(
		() => new Map(props.cards.map((card) => [card.id, card])),
		[props.cards],
	);

	const items = useMemo<readonly CardItem[]>(() => {
		const out: CardItem[] = [];
		for (const node of layout.nodes) {
			const card = cardById.get(node.id);
			const box = lanePlans.boxes.get(node.id);
			if (card === undefined || box === undefined) continue;
			out.push({ card, node, box });
		}
		return out;
	}, [layout, cardById, lanePlans.boxes]);

	const edges = useMemo(
		() => buildEdges(props.cards, layout, lanePlans.boxes),
		[props.cards, layout, lanePlans.boxes],
	);

	/* 组横幅：**折叠态也画、展开态也画** —— 展开后必须还能点回收起（用户 2026-11-24 报的 bug）。 */
	const groupBanners = useMemo(() => {
		if (groupPlan.presentGroups.length === 0) return [];
		const byCard = new Map(items.map((item) => [item.card.id, item]));
		/*
		 * ⚠ 「N 张」的数必须按**这个空间里真实存在的成员**算，不能按 items 算。
		 *
		 * 折叠时非锚点成员已被藏掉、不在 items 里 ⇒ 用 items 数出来永远是 1。
		 * 这是上一版真踩到的 bug（横幅写着「1 张」，实际 5 张）。
		 */
		const presentIds = new Set(groupableCards.map((card) => card.id));
		const out: {
			readonly group: TreeGroup;
			readonly label: string;
			readonly collapsed: boolean;
			readonly count: number;
			readonly left: number;
			readonly top: number;
			readonly width: number;
		}[] = [];
		for (const group of groupPlan.presentGroups) {
			const members = group.memberIds
				.map((id) => byCard.get(id))
				.filter((item): item is CardItem => item !== undefined);
			if (members.length === 0) continue;
			const collapsed = foldedIdSet.has(group.id);
			let left: number;
			let top: number;
			let width: number;
			if (collapsed) {
				// 折叠：横幅占锚点（第一个成员）的位置，其余成员已藏 ⇒ 只剩这一条
				const anchorId = groupPlan.anchors.get(group.id) ?? members[0]?.card.id;
				const anchorItem = (anchorId === undefined ? undefined : byCard.get(anchorId)) ?? members[0];
				const box = anchorItem?.box ?? { left: 0, top: 0 };
				left = box.left;
				width = metrics.cardWidth;
				/*
				 * 折叠时这一槽的步进已经是 `GROUP_BANNER_PITCH`（46，两个横幅=一卡槽）
				 * ⇒ 横幅直接贴槽顶，不在卡高里居中（居中会上下各留 30px 空白）。
				 */
				top = box.top;
			} else {
				// 展开：横幅横跨成员区域，画在成员最上方（挤进行距里，尽量不压卡）
				const lefts = members.map((item) => item.box.left);
				const rights = members.map((item) => item.box.left + metrics.cardWidth);
				const tops = members.map((item) => item.box.top);
				left = Math.min(...lefts);
				width = Math.max(...rights) - left;
				top = Math.max(0, Math.min(...tops) - GROUP_BANNER_HEIGHT - 4);
			}
			const index = groups.indexOf(group);
			out.push({
				group,
				label: groupLabelOf(group, index < 0 ? 0 : index),
				collapsed,
				count: group.memberIds.filter((id) => presentIds.has(id)).length,
				left,
				top,
				width,
			});
		}
		return out;
	}, [groupPlan, items, groupableCards, foldedIdSet, groups, metrics]);

	/*
	 * 折叠的组：锚点那张卡**不画**（横幅取代它）。
	 * 否则横幅下面还露出一张卡，读起来像「组里只有一张卡」。
	 */
	const renderItems = useMemo<readonly CardItem[]>(() => {
		if (groupPlan.anchors.size === 0) return items;
		const hide = new Set(groupPlan.anchors.values());
		return items.filter((item) => !hide.has(item.card.id));
	}, [items, groupPlan.anchors]);

	/*
	 * ── ③ 列背景 + 列头（每个**物理栏**一条） ──
	 *
	 * 栏高取该列自己的排版结果（`lanePlans.lanes[].bottom`）——
	 * 列与列独立之后，每列高度可以不同，不再从全局行表推。
	 */
	const bandByLane = useMemo(() => {
		const out = new Map<
			number,
			{ readonly layer: number; readonly label: string; readonly height: number }
		>();
		const seenPerLayer = new Map<number, number>();
		for (const band of layout.bands) {
			const lane = seenPerLayer.get(band.layer) ?? 0;
			seenPerLayer.set(band.layer, lane + 1);
			const plan = lanePlans.lanes.find((one) => one.lane === band.column);
			const bottom = plan?.bottom ?? metrics.padding;
			out.set(band.column, {
				layer: band.layer,
				label: lane === 0 ? layerLabel(band.layer) : `第 ${String(band.layer)} 层 · 第 ${String(lane + 1)} 栏`,
				height: TREE_HEADER_HEIGHT + bottom + Math.round(metrics.padding / 2),
			});
		}
		return out;
	}, [layout.bands, lanePlans.lanes, metrics.padding]);

	/*
	 * 横幅按**所在物理栏**分组（列渲染单元只画自己那一列的横幅）。
	 * 横幅的 `left` 是画布绝对坐标 ⇒ 反推栏号：left = padding + lane * (卡宽 + 列间距)。
	 */
	const bannersByLane = useMemo(() => {
		const out = new Map<number, readonly BannerView[]>();
		const pitch = metrics.cardWidth + metrics.columnGap;
		for (const banner of groupBanners) {
			const lane = Math.max(0, Math.round((banner.left - metrics.padding) / pitch));
			const list = out.get(lane) ?? [];
			out.set(lane, [...list, banner]);
		}
		return out;
	}, [groupBanners, metrics.cardWidth, metrics.columnGap, metrics.padding]);

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
			<div className="tb3t-canvas-row">
				{/*
				 * 最左「根卡」窄列（用户 2026-11-24：「加一个列头吧。一个很窄的一个列。
				 * 可以点击。进去以后只有一个关系区作为详情」）。
				 *
				 * ⚠ 它是**装饰层 + 点击热区**，不参与 `layoutTree` 的分层/折栏。
				 */}
				{props.onRootColumnClick === undefined ? null : (
					<button
						type="button"
						className={`tb3t-rootcol${props.rootColumnOpen === true ? ' is-open' : ''}`}
						data-root-column
						title="点开根卡关系（成组 / 收纳）"
						onClick={props.onRootColumnClick}
					>
						<span className="tb3t-rootcol__label">根卡</span>
						<span className="tb3t-rootcol__count">{String(rootCardCount)}</span>
					</button>
				)}
				<div className="tb3t-scroll" data-canvas-scroll>
					<div
						className="tb3t-stage"
						data-stage
						data-card-count={String(layout.nodes.length)}
						data-edge-count={String(edges.length)}
						style={{ width: stageWidth, height: stageHeight }}
					>
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

					{/*
					 * 每列一个 `TreeColumn`（用户 2026-11-24：「让列成为一个组件。内部管理」）。
					 *
					 * 列自己带着自己的 y（`lanePlansOf` 按列独立累加）：一列里的组收起，
					 * 只有这一列后面的 item 上移，别的列纹丝不动。
					 *
					 * 层叠靠 CSS 的 z-index：band 0 / svg 1 / 卡 2 / 横幅 3 ——
					 * 所以列虽然把 band 和卡画在一起，线仍然在带底色之上、在卡片之下。
					 */}
					{lanePlans.lanes.map((lane) => (
						<TreeColumn
							key={`lane:${String(lane.lane)}`}
							lane={lane}
							band={bandByLane.get(lane.lane)}
							items={renderItems.filter((item) => item.node.column === lane.lane)}
							banners={bannersByLane.get(lane.lane) ?? []}
							metrics={metrics}
							selectedId={props.selectedId}
							kindLabelOf={kindLabelOf}
							templateLabelOf={props.templateLabelOf}
							onSelect={props.onSelect}
							onHoverChange={props.onHoverChange}
							foldable={foldState.foldable}
							folded={foldState.folded}
							badgeCountOf={(id) => badgeCountOf(foldState, id)}
							onToggleFold={onToggleFold}
						/>
					))}
				</div>
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


