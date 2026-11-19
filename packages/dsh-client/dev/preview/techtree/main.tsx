/**
 * 科技树预览入口 —— 只在 `dev/preview/techtree/` 里，不碰根 `main.tsx`。
 *
 * ## 这个预览里什么是真的
 *
 * - **组件是真的**：`TechTree` / `TreeLegend` / `FilterRow` / `CardDetail` 全部来自
 *   `src/renderers/`，一个替身都没有。
 * - **样式是真的**：`injectStyles()`（工作区 + 六个定稿组件）+ `injectTechTreeStyles()`
 *   （科技树自己的 `tb3t-*`）—— 预览和产品用同一份 CSS。
 * - **交互是真的**：hover 变淡、筛选隐藏、搜索隐藏、回车/「前往」跳转、点卡开详情，
 *   全部走真代码路径。
 * - **布局是真的**：`layoutTree()` 算坐标，本文件不算任何一个位置。
 *
 * ## 这个预览里什么是假的
 *
 * - **数据**：没有服务端。9 张卡照设计图 `view-1-tech-tree.svg` 造（编号 / 状态 /
 *   类别 / 领域 / 标题 / 父子关系都是图上的值）。
 * - **列表视图**：V3 已定稿的另一个视图，本预览不做（点「列表」只弹说明）。
 * - **状态转移 / 加关系 / 派生**：点只弹预览回执，不发请求、不落库。
 *
 * ## 怎么验用户要的 6 条交互
 *
 * | # | 交互 | 在这个预览里怎么点 |
 * |---|---|---|
 * | 1 | 科技树视图（一列一层） | 打开就是；列头写着「第 N 层 · 根卡/子卡/…」 |
 * | 2 | 箭头，尖端贴目标卡边 | 看任意一条线：箭头尖正好在目标卡边上 |
 * | 3 | hover 后无关的边淡到 25% | 鼠标悬停 `DC01`：3 条相连边加粗 + 光晕 + 线上标关系名，其余变淡 |
 * | 4 | 筛选后不匹配的卡**隐藏** | 顶部「状态 / 类别 / 领域」任选一个：不匹配的卡**消失**（不是变淡） |
 * | 5 | 搜索后不匹配的卡**隐藏** | 搜索框输入 `WR`：只剩编号/标题含 `WR` 的卡 |
 * | 6 | 搜索回车 / 点「前往」→ 打开指定编号详情 | 输入完整编号（如 `DC02`）回车，或点「前往」 |
 */

import { StrictMode, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { TASK_STATES } from '@taskboard/protocol';

import { KIND_ORDER, stateLabel } from '../../../src/pure/card-view.ts';
import type { Picked } from '../../../src/pure/filter-box.ts';
import type { FilterNode } from '../../../src/pure/filter-box.ts';
import { jumpTargetOf } from '../../../src/pure/tree-filter.ts';
import type { TreeFilterCriteria } from '../../../src/pure/tree-filter.ts';
import { CardDetail } from '../../../src/renderers/CardDetail.tsx';
import { FilterRow } from '../../../src/renderers/FilterRow.tsx';
import type { FilterSpec } from '../../../src/renderers/FilterRow.tsx';
import {
	TechTree,
	TreeLegend,
	injectTechTreeStyles,
} from '../../../src/renderers/TechTree.tsx';
import { injectStyles } from '../../../src/styles.ts';
import type { Card } from '../../../src/types.ts';
import {
	CARDS,
	CYCLE_CARDS,
	SHOWCASE_CARDS,
	TEMPLATES,
	kindLabelOf,
	templateLabelOf,
} from './fixtures.ts';

/* ══════════════════════════════════════════════════════════════
 * 舞台（两种真实尺寸）
 * ══════════════════════════════════════════════════════════════ */

/** 一个舞台。 */
interface Stage {
	readonly id: 'full' | 'narrow';
	readonly label: string;
	readonly note: string;
	readonly width: number;
	readonly height: number;
}

const STAGES: readonly Stage[] = Object.freeze([
	{
		id: 'full',
		label: '全屏 1600 × 1000',
		note: '科技树画布横向滚动；右栏详情 min 300 / max 440',
		width: 1600,
		height: 1000,
	},
	{
		id: 'narrow',
		label: '工作区 570 × 920',
		note: '窄而高 ⇒ 上下堆叠：科技树 56% / 详情吃剩余；画布横竖都能滚',
		width: 570,
		height: 920,
	},
]);

/* ══════════════════════════════════════════════════════════════
 * 筛选树
 * ══════════════════════════════════════════════════════════════ */

/** 状态筛选：9 个状态平铺（和 Workspace 同一份词表）。 */
const STATUS_NODES: readonly FilterNode[] = TASK_STATES.map((state) => ({
	value: state,
	label: stateLabel(state),
}));

/** 类别筛选：四个已知 kind（顺序固定）。 */
const KIND_NODES: readonly FilterNode[] = KIND_ORDER.map((kind) => ({
	value: kind,
	label: kindLabelOf(kind),
}));

/** 领域筛选：领域 › 类别 › 模板（层次来自模板清单本身，不维护第二份词表）。 */
const DOMAIN_NODES: readonly FilterNode[] = (() => {
	const domains: string[] = [];
	for (const template of TEMPLATES) {
		if (!domains.includes(template.domain)) domains.push(template.domain);
	}
	return domains.map((domain) => ({
		value: domain,
		label: domain,
		children: KIND_ORDER.map((kind) => ({
			value: kind,
			label: kindLabelOf(kind),
			children: TEMPLATES.filter((one) => one.domain === domain && one.kind === kind).map((one) => ({
				value: one.ref,
				label: one.displayName,
			})),
		})).filter((node) => (node.children ?? []).length > 0),
	}));
})();

/* ══════════════════════════════════════════════════════════════
 * 页面
 * ══════════════════════════════════════════════════════════════ */

/** 预览页。 */
function App(): React.ReactNode {
	const [stageId, setStageId] = useState<'full' | 'narrow'>('full');
	const [selectedId, setSelectedId] = useState<string | null>('DC01');
	const [hoverId, setHoverId] = useState<string | null>(null);
	const [search, setSearch] = useState('');
	const [picked, setPicked] = useState<Readonly<Record<string, Picked>>>({});
	const [notice, setNotice] = useState<string | undefined>(undefined);
	const paneRef = useRef<HTMLDivElement>(null);

	const stage = STAGES.find((one) => one.id === stageId) ?? (STAGES[0] as Stage);

	/** 假回执（没有服务端）。 */
	const say = (message: string): void => {
		setNotice(message);
	};

	/*
	 * 筛选条件 —— **useMemo 保持引用稳定**。
	 *
	 * ⚠ 不稳定的话：hover 改 `hoverId` 会重算 `visibleIds` / `layout`，
	 *   卡片层 memo 失效 —— 「hover 只重画 SVG 线层」就不成立了。
	 */
	const criteria = useMemo<TreeFilterCriteria>(
		() => ({
			status: picked['status'] ?? [],
			kind: picked['kind'] ?? [],
			domain: picked['domain'] ?? [],
			search,
		}),
		[picked, search],
	);

	const filters = useMemo<readonly FilterSpec[]>(
		() => [
			{ id: 'status', title: '状态', nodes: STATUS_NODES, picked: picked['status'] ?? [] },
			{ id: 'kind', title: '类别', nodes: KIND_NODES, picked: picked['kind'] ?? [] },
			{ id: 'domain', title: '领域', nodes: DOMAIN_NODES, picked: picked['domain'] ?? [] },
		],
		[picked],
	);

	const selectedCard: Card | null =
		selectedId === null ? null : (CARDS.find((one) => one.id === selectedId) ?? null);

	/** 搜索框内容精确等于某个编号时，可以「前往」。 */
	const jumpTarget = useMemo(() => jumpTargetOf(CARDS, search), [search]);

	/**
	 * 打开指定编号的详情（回车 / 点「前往」都走这里）。
	 *
	 * 除了选中，还把它滚到画布中间 —— 科技树可能比视口宽得多，
	 * 不滚的话「打开了详情但看不见卡」。
	 */
	const jump = (): void => {
		if (jumpTarget === null) return;
		setSelectedId(jumpTarget);
		requestAnimationFrame(() => {
			const pane = paneRef.current;
			if (pane === null) return;
			const element = pane.querySelector(`[data-card-id="${jumpTarget}"]`);
			if (element instanceof HTMLElement) {
				element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
			}
		});
	};

	const changeFilter = (id: string, next: Picked): void => {
		setPicked((prev) => ({ ...prev, [id]: next }));
	};

	return (
		<div className="pv">
			{/* 舞台切换条 —— 预览专属，挂在舞台外面 */}
			<header className="pv-bar">
				<span className="pv-bar__tag">V1 TechTree · 两种真实尺寸</span>
				{STAGES.map((one) => (
					<button
						key={one.id}
						type="button"
						className={`pv-bar__btn${one.id === stage.id ? ' is-on' : ''}`}
						data-stage-btn={one.id}
						onClick={() => {
							setStageId(one.id);
						}}
					>
						{one.label}
					</button>
				))}
				<span className="pv-bar__note">{stage.note}</span>
			</header>

			<div className="pv-scroll">
				<div
					className="pv-stage"
					data-stage={stage.id}
					style={{ width: `${String(stage.width)}px`, height: `${String(stage.height)}px` }}
				>
					<div className="pv-tabbar" data-pv-tabbar>
						<span>▦ 任务板 · 科技树</span>
						{stage.id === 'narrow' ? <span className="pv-tabbar__hint">570 × 920 · 真实 tab 尺寸</span> : null}
					</div>

					<div className="pv-ws">
						<div className="tb3w-root" data-view="tree">
							<div className="tb3w-page">
								<div className="tb3w-chrome">
									{/* 空间头（产品里由 SpaceBar 画；本预览只放最小信息） */}
									<div className="tb3t-head" data-head>
										<span className="tb3t-head__title">开发任务板</span>
										<span className="tb3t-head__meta">当前空间 · 核心 · {String(CARDS.length)} 条</span>
										<span className="tb3t-head__right">独立浏览器入口 · 已连上服务</span>
									</div>

									{/* 工具栏：条数 / 关系图例 / 视图切换 / 新建 */}
									<div className="tb3w-toolbar" data-toolbar>
										<span className="tb3w-toolbar__title">
											任务
											<span className="tb3w-toolbar__count">共 {String(CARDS.length)} 条</span>
										</span>

										<span className="tb3w-toolbar__legend" data-legend-wrap>
											<TreeLegend />
										</span>

										<span className="tb3w-toolbar__actions">
											<span className="tb3w-seg" role="group" aria-label="视图切换">
												<button
													type="button"
													className="tb3w-seg__btn is-on"
													data-view-btn="tree"
													aria-pressed
												>
													科技树
												</button>
												<button
													type="button"
													className="tb3w-seg__btn"
													data-view-btn="list"
													onClick={() => {
														say('列表视图是 V3 已定稿的另一个视图（本预览只做科技树）');
													}}
												>
													列表
												</button>
											</span>
											<button
												type="button"
												className="tb3w-btn-primary"
												data-create-card
												onClick={() => {
													say('打开建卡页（预览：入口没接）');
												}}
											>
												新建
											</button>
										</span>
									</div>

									{/* 筛选行：状态 / 类别 / 领域 + 搜索 + 前往 */}
									<div className="tb3w-filters">
										<FilterRow
											filters={filters}
											onChange={changeFilter}
											trailing={
												<span className="tb3w-filters__tail">
													<label className="tb3w-search">
														<svg
															className="tb3w-search__icon"
															width="12"
															height="12"
															viewBox="0 0 12 12"
															aria-hidden="true"
														>
															<circle
																cx="5"
																cy="5"
																r="3.4"
																fill="none"
																stroke="currentColor"
																strokeWidth="1.2"
															/>
															<line
																x1="7.6"
																y1="7.6"
																x2="10.4"
																y2="10.4"
																stroke="currentColor"
																strokeWidth="1.2"
																strokeLinecap="round"
															/>
														</svg>
														<input
															type="search"
															data-search
															value={search}
															placeholder="搜标题，或输入完整编号后回车…"
															onChange={(event) => {
																setSearch(event.target.value);
															}}
															onKeyDown={(event) => {
																if (event.key === 'Enter') {
																	event.preventDefault();
																	jump();
																}
															}}
														/>
													</label>
													<button
														type="button"
														className="ghost-btn tb3t-jump"
														data-jump
														disabled={jumpTarget === null}
														title={
															jumpTarget === null
																? '输入完整编号后可用（如 DC02）'
																: `打开 ${jumpTarget} 的详情`
														}
														onClick={jump}
													>
														前往
													</button>
												</span>
											}
										/>
									</div>
								</div>

								<div className="tb3t-main" data-main>
									<section className="tb3t-pane" ref={paneRef} data-tree-pane>
										<TechTree
											cards={CARDS}
											selectedId={selectedId}
											hoverId={hoverId}
											filter={criteria}
											kindLabelOf={kindLabelOf}
											/*
											 * ⚠ 直接传 `useState` 的 setter（引用天然稳定），不要写成内联箭头函数：
											 *   内联箭头每次 render 都是新引用 ⇒ `CardsLayer` 的 memo 失效 ⇒
											 *   hover 时卡片层也跟着重渲染，「hover 只重画 SVG 线层」就不成立了。
											 */
											onSelect={setSelectedId}
											onHoverChange={setHoverId}
										/>
									</section>

									{selectedCard === null ? (
										<aside className="tb3t-detail" data-detail-empty>
											<div className="tb3w-detail__empty">点画布上一张卡看详情。</div>
										</aside>
									) : (
										<aside className="tb3t-detail" data-detail-pane>
											<CardDetail
												card={selectedCard}
												templateLabel={templateLabelOf(selectedCard.template.ref)}
												kindLabel={kindLabelOf(selectedCard.template.kind)}
												onTransition={(to) => {
													say(`状态转移：${selectedCard.id} → ${to}（预览：不发请求、不落库）`);
												}}
												onAddRelation={() => {
													say(`打开 ${selectedCard.id} 的关系浮层（关系区还没做）`);
												}}
												onDerive={() => {
													say(`从 ${selectedCard.id} 派生子任务（预览：入口没接）`);
												}}
												onNoteChange={() => {
													say(`备注已提交 ${selectedCard.id}（预览：不落库）`);
												}}
												onClose={() => {
													setSelectedId(null);
												}}
												onExpand={() => {
													say('放大成 1200 × 400 抽屉（V4 还没做）');
												}}
											/>
										</aside>
									)}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			{notice === undefined ? null : (
				<div className="pv-toast" data-pv-toast>
					<span>{notice}</span>
					<button
						type="button"
						onClick={() => {
							setNotice(undefined);
						}}
					>
						知道了
					</button>
				</div>
			)}

			{/* ── 下面三块是「组件陈列」：不占舞台，给用户逐条对照 ── */}
			<div className="pv-body">
			<div className="pv-block">
				<h2>六种关系全览（派生 + 依赖 / 取代 / 约束 / 相关 / 参考 各一条）</h2>
				<p className="pv-note">
					颜色 / 线型 / 箭头方向一次看全：派生=实线灰弧、依赖=棕、取代=紫、约束=红、相关=绿虚线、参考=灰虚线。
					hover 任意一张卡：相连的边加粗 + 光晕，无关的淡到 25%（卡**不会**消失）。
				</p>
				<div className="pv-tree-frame">
					<TechTree
						cards={SHOWCASE_CARDS}
						selectedId={null}
						kindLabelOf={kindLabelOf}
						onSelect={() => {
							say('陈列区的卡不接详情（看上面舞台）');
						}}
					/>
				</div>
			</div>

			<div className="pv-block">
				<h2>布局警告：孤儿 / 环（▲ 标记，不死循环、不丢卡）</h2>
				<p className="pv-note">
					`CY01 ↔ CY02` 的 parent 成环 ⇒ 两张都落第 0 层并标 ▲；`CY03` 指向环但不在环上，正常分层。
					上面主舞台的 `X01` 是孤儿（parent 指向不存在的 `NOPE`），也带 ▲。
				</p>
				<div className="pv-tree-frame">
					<TechTree
						cards={CYCLE_CARDS}
						selectedId={null}
						kindLabelOf={kindLabelOf}
						onSelect={() => {
							say('陈列区的卡不接详情（看上面舞台）');
						}}
					/>
				</div>
			</div>

			<div className="pv-block">
				<h2>六条交互的验收点</h2>
				<ul className="pv-list">
					<li>
						① 一列一层：列头「第 N 层 · 根卡/子卡/孙卡/曾孙卡」，坐标全部来自{' '}
						<code>layoutTree()</code>。
					</li>
					<li>
						② 箭头：SVG <code>&lt;marker refX=9 orient=auto&gt;</code>，路径终点就是目标卡边
						（<code>boxOf().left/right</code>）⇒ 尖端贴边。
					</li>
					<li>
						③ hover：悬停 <code>DC01</code> ⇒ 3 条相连边加粗 + 光晕 + 线上标关系名；无关边{' '}
						<code>opacity: 0.25</code>，<b>卡还在</b>。
					</li>
					<li>
						④ 筛选：任选「状态 / 类别 / 领域」⇒ 不匹配的卡<b>从 DOM 里消失</b>（隐藏，不是变淡），
						连它的连线一起消失。
					</li>
					<li>
						⑤ 搜索：输入 <code>WR</code> ⇒ 只剩编号/标题含 WR 的卡；<b>同样是隐藏</b>。
					</li>
					<li>
						⑥ 跳转：输入完整编号 <code>DC02</code> 回车，或点「前往」⇒ 右栏打开它的详情并滚到画布中间。
					</li>
				</ul>
				<p className="pv-note">
					本机没有截图能力（headless Edge 起不来），SSR 断言见{' '}
					<code>node dev/preview/techtree/verify.mjs</code>（SSR + 纯函数断言，不依赖浏览器）。
				</p>
			</div>
			</div>
		</div>
	);
}

/* 产品样式 + 科技树样式：预览和产品同一份，不在 style.css 里抄。 */
injectStyles();
injectTechTreeStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
