/**
 * 科技树折叠组件的**浏览器几何探针**（由 `verify.mjs` 打包后交给 headless Edge）。
 *
 * 为什么要跑真浏览器：`FoldRect` 的顶边靠 `margin-top:-16px`、宽度靠 CSS 盒模型，
 * SSR 只能断言「class / 宽度字符串相同」，量不到 `getBoundingClientRect()`。
 *
 * 本页同时渲染**同一个组 g1** 的收起 / 展开两态：
 * - 收起：有胶囊、没有矩形；
 * - 展开：胶囊 + 矩形，且矩形顶边落在胶囊中线上。
 *
 * 量完把数字写进 `<pre id="fold-measurement">`，`verify.mjs` 用 `--dump-dom` 取回。
 */

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { injectTechTreeStyles, TechTree } from '../../../src/renderers/TechTree.tsx';
import { injectStyles } from '../../../src/styles.ts';
import type { TreeGroup } from '../../../src/pure/ui-state.ts';
import { CARDS, kindLabelOf } from './fixtures.ts';

const noop = (): void => {
	/* SSR 式静态测量，不需要交互。 */
};

const GROUPS: readonly TreeGroup[] = [{ id: 'g1', memberIds: ['GU01', 'RB01'] }];

/**
 * 一个固定尺寸的测量舞台。
 *
 * @param props.folded 该舞台是否让 g1 收起
 * @param props.label 人看的标签
 */
function Pane(props: { readonly folded: boolean; readonly label: string }): React.ReactNode {
	return (
		<section
			data-measure-pane={props.folded ? 'collapsed' : 'expanded'}
			style={{
				width: 760,
				height: 560,
				position: 'relative',
				overflow: 'hidden',
				border: '1px solid #d7dbe2',
				borderRadius: 8,
				background: '#fff',
			}}
		>
			<div style={{ padding: '6px 10px', fontSize: 12, color: '#6b7280' }}>{props.label}</div>
			<div style={{ position: 'absolute', inset: '34px 0 0 0' }}>
				<TechTree
					cards={CARDS}
					selectedId={null}
					kindLabelOf={kindLabelOf}
					groups={GROUPS}
					foldedIds={props.folded ? ['g1'] : []}
					expandedIds={[]}
					onToggleFold={noop}
					onSelect={noop}
				/>
			</div>
		</section>
	);
}

function App(): React.ReactNode {
	return (
		<div style={{ display: 'flex', gap: 20, padding: 20, alignItems: 'flex-start' }}>
			<Pane folded label="g1 收起：只有胶囊" />
			<Pane folded={false} label="g1 展开：胶囊 + 矩形" />
		</div>
	);
}

injectStyles();
injectTechTreeStyles();

const host = document.getElementById('root');
if (host === null) throw new Error('缺少 #root');

flushSync(() => {
	createRoot(host).render(<App />);
});

/* ══════════════════════════════════════════════════════════════
 * 测量 —— 输出数字，不输出布尔（AGENTS 3.9）
 * ══════════════════════════════════════════════════════════════ */

/** 四舍五入到 0.01px，避免浮点噪声。 */
function px(value: number): number {
	return Math.round(value * 100) / 100;
}

/** 取一个元素，缺失直接报错（测量页宁可炸，不要静默跳过）。 */
function need(root: ParentNode, selector: string): Element {
	const element = root.querySelector(selector);
	if (element === null) throw new Error(`缺元素：${selector}`);
	return element;
}

function rectOf(element: Element): DOMRect {
	return element.getBoundingClientRect();
}

function measure(): void {
	const collapsedPane = need(document, '[data-measure-pane="collapsed"]');
	const expandedPane = need(document, '[data-measure-pane="expanded"]');

	const collapsedPill = rectOf(need(collapsedPane, '[data-fold-group="g1"] .tb3-fold-pill'));
	const expandedPill = rectOf(need(expandedPane, '[data-fold-group="g1"] .tb3-fold-pill'));
	const expandedRect = rectOf(need(expandedPane, '[data-fold-group="g1"] .tb3-fold-rect'));

	/* #50：角标必须完全在卡片内部，且右侧 / 底部内距固定 10px。 */
	const gu01Card = rectOf(need(expandedPane, '[data-card-slot="GU01"] .tb3t-card'));
	const gu01Badge = rectOf(need(expandedPane, '[data-card-slot="GU01"] .tb3t-fold'));

	/* 组是原子块：同列里原本夹在成员之间的 X01 必须被推到矩形下方，不能圈进组里。 */
	const x01Card = rectOf(need(expandedPane, '[data-card-slot="X01"] .tb3t-card'));

	const output = {
		collapsedPillWidth: px(collapsedPill.width),
		expandedPillWidth: px(expandedPill.width),
		pillWidthDiff: px(Math.abs(collapsedPill.width - expandedPill.width)),
		pillLeftDiff: px(Math.abs(collapsedPill.left - expandedPill.left)),
		pillTopDiff: px(Math.abs(collapsedPill.top - expandedPill.top)),
		rectLeft: px(expandedRect.left),
		rectTop: px(expandedRect.top),
		rectWidth: px(expandedRect.width),
		rectPillLeftDiff: px(Math.abs(expandedRect.left - expandedPill.left)),
		rectPillWidthDiff: px(Math.abs(expandedRect.width - expandedPill.width)),
		/* 顶边比胶囊中线低多少：>= 0 才叫「被胶囊盖住」。 */
		rectTopBelowPillCenter: px(expandedRect.top - (expandedPill.top + expandedPill.height / 2)),
		collapsedRectCount: collapsedPane.querySelectorAll('[data-fold-rect]').length,
		expandedRectCount: expandedPane.querySelectorAll('[data-fold-rect]').length,
		/* #50 角标：全部为正 = 完全在卡片内；right/bottom 内距应 = 10。 */
		badgeRightInset: px(gu01Card.right - gu01Badge.right),
		badgeBottomInset: px(gu01Card.bottom - gu01Badge.bottom),
		badgeInsideCard:
			gu01Badge.left >= gu01Card.left &&
			gu01Badge.top >= gu01Card.top &&
			gu01Badge.right <= gu01Card.right &&
			gu01Badge.bottom <= gu01Card.bottom,
		/* 组外同列卡必须在矩形下方（组内成员连续，不把无关卡圈进来）。 */
		x01CardTop: px(x01Card.top),
		expandedRectBottom: px(expandedRect.bottom),
		x01BelowGroupRect: x01Card.top >= expandedRect.bottom,
	};
	const pre = document.getElementById('fold-measurement');
	if (pre === null) throw new Error('缺少 #fold-measurement');
	pre.textContent = JSON.stringify(output);
}

measure();
