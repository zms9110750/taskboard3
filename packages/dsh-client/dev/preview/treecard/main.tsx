/**
 * TreeCard 形态预览 —— 用户 `2026-11-20` 问「科技树视图的卡做了组件吗？」，
 * 这个预览就是**单独看那张卡**的地方（不用开整个科技树）。
 *
 * ## 卡片的位置是**预览硬编码**的
 *
 * 产品里 `left / top / width / height` 由 `TechTree` 用 `tree-layout.ts` 算好传进来
 * （卡片自己不做布局）。预览不需要真的跑布局算法，所以这里用 `pvCell(col, row)`
 * 给一组固定值 —— 正是 `style` 这个 prop 存在的意义。
 *
 * ## 覆盖的形态（每块可单独看）
 *
 * | 块 | 形态 |
 * |---|---|
 * | ① | 普通 / 选中 / 草稿（无可见边框但仍占 2px）/ hover |
 * | ② | 布局警告：孤儿 / 环（▲ + title） |
 * | ③ | 9 个状态各一张（圆点 + 中文名，不只靠颜色） |
 * | ④ | 三个 label：齐全 / 缺模板 / 缺类别 / 长领域名 |
 * | ⑤ | 长标题截断（两行 + 省略号） |
 * | ⑥ | 点击回执（`onSelect` 真的被调到） |
 */

import { StrictMode, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { TaskState } from '@taskboard/protocol';

import { injectTechTreeStyles } from '../../../src/renderers/TechTree.tsx';
import { TreeCard } from '../../../src/renderers/TreeCard.tsx';
import type { Card } from '../../../src/types.ts';

/* ══════════════════════════════════════════════════════════════
 * 夹具
 * ══════════════════════════════════════════════════════════════ */

/** 固定时间（预览可复现）。 */
const T0 = 1_762_000_000_000;

/** 造一张卡（只填预览要显示的字段）。 */
function card(id: string, over: Partial<Card> = {}): Card {
	return {
		id,
		title: `卡 ${id} 的标题`,
		status: TaskState.WORKING,
		template: { ref: 'decision', kind: 'design', domain: '核心' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		createdAt: T0,
		adoptedAt: null,
		history: [{ at: T0, action: 'create' }],
		deleted: false,
		holders: [],
		unread: { ai: false, user: false },
		...over,
	};
}

/** 类别中文名（产品里从模板清单查；预览直接给）。 */
const KIND_LABEL: Readonly<Record<string, string>> = Object.freeze({
	goal: '目标',
	design: '设计',
	work: '工作',
	record: '记录',
});

/** 模板显示名（同上）。 */
const TEMPLATE_LABEL: Readonly<Record<string, string>> = Object.freeze({
	userNeed: '用户任务',
	decision: '决策',
	architecture: '技术架构',
	research: '调研',
	writeCode: '编写代码',
	delivery: '交付',
	blocker: '阻碍',
});

/** 卡片尺寸（和 `TREE_METRICS` 一致；预览不 import 它是为了不依赖布局）。 */
/* 宽度按最坏内容算：编号 4 字符（LT01）+ 3 个 4 字 label + 4 字状态 */
const W = 240;
const H = 78;

/**
 * 预览网格里一格的位置（硬编码，代替布局算法）。
 *
 * @param col 列（0 起）
 * @param row 行（0 起）
 */
function pvCell(col: number, row: number): { readonly left: number; readonly top: number } {
	return { left: 24 + col * (W + 36), top: 22 + row * (H + 30) };
}

/** 网格容器的高度（按行数算）。 */
function pvStageHeight(rows: number): number {
	return 22 * 2 + rows * (H + 30);
}

/* ══════════════════════════════════════════════════════════════
 * 一个格子（绝对定位的 wrapper + 卡片）
 * ══════════════════════════════════════════════════════════════ */

/** 一个格子。 */
interface CellProps {
	readonly col: number;
	readonly row: number;
	readonly card: Card;
	readonly kindLabel: string;
	readonly templateLabel: string;
	readonly selected?: boolean;
	readonly layer?: number;
	readonly warning?: { readonly kind: 'orphan' | 'cycle'; readonly cardId: string; readonly detail: string };
	/** 预览专用：静态复刻 `:hover` 的外观（真 hover 直接悬停也能看）。 */
	readonly hoverDemo?: boolean;
	readonly onSelect: (cardId: string) => void;
}

/**
 * 一格。
 *
 * ⚠ wrapper 是 `position:absolute`，卡片在里面 `left:0/top:0` —— 这样
 *   「卡片位置由外面给」这条约束在预览里也成立（预览的 wrapper 扮演 `TechTree` 的舞台）。
 */
function Cell(props: CellProps): ReactNode {
	const cell = pvCell(props.col, props.row);
	return (
		<div
			className={props.hoverDemo === true ? 'pv-cell pv-hover-demo' : 'pv-cell'}
			style={{ left: cell.left, top: cell.top, width: W, height: H }}
		>
			<TreeCard
				card={props.card}
				kindLabel={props.kindLabel}
				templateLabel={props.templateLabel}
				selected={props.selected === true}
				{...(props.warning === undefined ? {} : { warning: props.warning })}
				{...(props.layer === undefined ? {} : { layer: props.layer })}
				onSelect={props.onSelect}
				style={{ left: 0, top: 0, width: W, height: H }}
			/>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════════
 * 页面
 * ══════════════════════════════════════════════════════════════ */

/** 预览页。 */
function App(): ReactNode {
	const [log, setLog] = useState<readonly string[]>([]);
	const say = (what: string): void => {
		setLog((prev) => [...prev, what]);
	};
	const onSelect = (cardId: string): void => {
		say(`onSelect(${cardId})`);
	};

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>TreeCard / 科技树卡片</h1>
				<p>
					独立组件（从 `TechTree.tsx` 的内部函数抽出来的）· 位置尺寸由外部 `style` 传入 ·
					类名 <code>tb3t-card</code> 是契约（`techtree-css.ts` 与 SSR 断言依赖）
				</p>
			</header>

			{/* ── ① 四种状态 ── */}
			<section className="pv-block">
				<h2>① 普通 / 选中 / 草稿 / hover</h2>
				<p className="pv-note">
					草稿：**无可见边框，但保留 2px 占位**（和普通卡并排看，内容不位移）。hover
					可以直接把鼠标移上去；右下那张是**静态复刻**（给没有鼠标的截图用）。
				</p>
				<div className="pv-tc-stage" style={{ height: pvStageHeight(1) }}>
					<Cell
						col={0}
						row={0}
						card={card('DC01', { title: '普通卡：分层 + 排行' })}
						kindLabel="设计"
						templateLabel="决策"
						layer={2}
						onSelect={onSelect}
					/>
					<Cell
						col={1}
						row={0}
						card={card('DC02', { title: '选中卡：accent 边框 + 外圈' })}
						kindLabel="工作"
						templateLabel="编写代码"
						selected
						layer={2}
						onSelect={onSelect}
					/>
					<Cell
						col={2}
						row={0}
						card={card('DR01', {
							title: '草稿卡：无可见边框（2px 占位）',
							status: TaskState.UNSPECIFIED,
						})}
						kindLabel="记录"
						templateLabel="阻碍"
						layer={0}
						onSelect={onSelect}
					/>
					<Cell
						col={3}
						row={0}
						card={card('HV01', { title: 'hover 卡：静态复刻' })}
						kindLabel="目标"
						templateLabel="用户任务"
						hoverDemo
						layer={1}
						onSelect={onSelect}
					/>
				</div>
			</section>

			{/* ── ② 布局警告 ── */}
			<section className="pv-block">
				<h2>② 布局警告：孤儿（▲ + title 里有原因）</h2>
				<p className="pv-note">
					▲ 是 `layoutTree()` 的 `warnings`；`title` 里写原因，`data-card-warning` 上是
					orphan / cycle（SSR 断言查这个属性）。
				</p>
				<div className="pv-tc-stage" style={{ height: pvStageHeight(1) }}>
					<Cell
						col={0}
						row={0}
						card={card('X01', { title: '父卡不存在（孤儿）', status: TaskState.UNSPECIFIED })}
						kindLabel="记录"
						templateLabel="阻碍"
						layer={0}
						warning={{
							kind: 'orphan',
							cardId: 'X01',
							detail: 'parent 指向的卡不存在：NOPE，按第 0 层摆放',
						}}
						onSelect={onSelect}
					/>
					<Cell
						col={2}
						row={0}
						card={card('OK01', { title: '没有警告的卡（不画 ▲）' })}
						kindLabel="工作"
						templateLabel="调研"
						layer={1}
						onSelect={onSelect}
					/>
				</div>
			</section>

			{/* ── ③ 9 个状态 ── */}
			<section className="pv-block">
				<h2>③ 9 个状态：圆点 + 中文名（不只靠颜色）</h2>
				<p className="pv-note">
					一个状态一张卡。圆点颜色来自 `stateTone()`（9 状态 9 色），**中文名始终在**
					—— 色盲 / 黑白截图也能读。
				</p>
				<div className="pv-tc-stage" style={{ height: pvStageHeight(3) }}>
					{STATES.map((state, index) => (
						<Cell
							key={state.status}
							col={index % 3}
							row={Math.floor(index / 3)}
							card={card(state.id, { title: `状态：${state.label}`, status: state.status })}
							kindLabel="设计"
							templateLabel="决策"
							layer={2}
							onSelect={onSelect}
						/>
					))}
				</div>
			</section>

			{/* ── ④ 三个 label ── */}
			<section className="pv-block">
				<h2>④ 编号 + 三个 label：齐全 / 缺模板 / 缺类别 / 长领域名</h2>
				<p className="pv-note">
					列表行（`CardRow`）的三个 label 是「类别 / 领域 / 模板」。科技树设计图的卡片只有
					类别 + 领域 ⇒ `templateLabel` 传**空串就不画模板 badge**（产品当前就是这种）。
					长 label 用 ellipsis，不换行、不堆叠。
				</p>
				<div className="pv-tc-stage" style={{ height: pvStageHeight(1) }}>
					<Cell
						col={0}
						row={0}
						card={card('L01', { title: '三个 label 齐全' })}
						kindLabel="设计"
						templateLabel="技术架构"
						layer={2}
						onSelect={onSelect}
					/>
					<Cell
						col={1}
						row={0}
						card={card('L02', { title: '缺模板 label（只有类别 + 领域）' })}
						kindLabel="工作"
						templateLabel=""
						layer={2}
						onSelect={onSelect}
					/>
					<Cell
						col={2}
						row={0}
						card={card('L03', { title: '缺类别 label' })}
						kindLabel=""
						templateLabel="交付"
						layer={2}
						onSelect={onSelect}
					/>
					<Cell
						col={3}
						row={0}
						card={card('L04', {
							title: '长领域名（省略号）',
							template: { ref: 'decision', kind: 'design', domain: '一个非常非常长的领域名称' },
						})}
						kindLabel="设计"
						templateLabel="决策"
						layer={2}
						onSelect={onSelect}
					/>
				</div>
			</section>

			{/* ── ⑤ 长标题 ── */}
			<section className="pv-block">
				<h2>⑤ 长标题：两行截断 + 省略号</h2>
				<p className="pv-note">
					`-webkit-line-clamp:2` ⇒ 最多两行；完整标题在 `title` 属性里（鼠标停上去能看到）。
				</p>
				<div className="pv-tc-stage" style={{ height: pvStageHeight(1) }}>
					<Cell
						col={0}
						row={0}
						card={card('LT01', {
							title:
								'这是一个非常非常长的标题，用来验证卡片最多显示两行、第三行开始被截断并加省略号，而不是把卡片撑破或者溢出到边框外面',
						})}
						kindLabel="目标"
						templateLabel="用户任务"
						layer={0}
						onSelect={onSelect}
					/>
				</div>
			</section>

			{/* ── ⑥ 点击回执 ── */}
			<section className="pv-block">
				<h2>⑥ 点击回执（`onSelect` 真的被调到）</h2>
				<ul className="pv-events" data-event-log>
					{log.length === 0 ? <li className="pv-events__empty">（还没有点过卡）</li> : null}
					{log.map((one, index) => (
						<li key={`${String(index)}-${one}`} data-event={one}>
							{one}
						</li>
					))}
				</ul>
				<button
					type="button"
					className="ghost-btn"
					data-clear-log
					onClick={() => {
						setLog([]);
					}}
				>
					清空日志
				</button>
			</section>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════════
 * 9 个状态
 * ══════════════════════════════════════════════════════════════ */

/** 一个状态一格。 */
interface StateCell {
	readonly id: string;
	readonly status: string;
	readonly label: string;
}

/** 9 个状态（顺序 = `TASK_STATES`；中文名抄 `protocol` 的词表）。 */
const STATES: readonly StateCell[] = [
	{ id: 'S01', status: TaskState.UNSPECIFIED, label: '未指定' },
	{ id: 'S02', status: TaskState.SUBMITTED, label: '提交' },
	{ id: 'S03', status: TaskState.WORKING, label: '处理中' },
	{ id: 'S04', status: TaskState.INPUT_REQUIRED, label: '需要信息' },
	{ id: 'S05', status: TaskState.AUTH_REQUIRED, label: '需要授权' },
	{ id: 'S06', status: TaskState.COMPLETED, label: '成功' },
	{ id: 'S07', status: TaskState.FAILED, label: '失败' },
	{ id: 'S08', status: TaskState.CANCELED, label: '取消' },
	{ id: 'S09', status: TaskState.REJECTED, label: '拒绝' },
];

/* 科技树样式（`tb3t-*`）由组件那边提供同一份；预览只额外注入它。 */
injectTechTreeStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
