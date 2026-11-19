/**
 * 工作区（V3）—— 把六个**已定稿**组件拼成一个完整页面。
 *
 * ## 它只做「拼装 + 布局」
 *
 * | 块 | 谁画 | 本文件的责任 |
 * |---|---|---|
 * | 空间 chip 行 | `SpaceBar` | 把 workspaces / current / viewing 原样传进去 |
 * | 工具栏 | **本文件** | 条数 / 关系图例 / 科技树⇄列表 / 新建（纯布局 + 文案）|
 * | 筛选行 | `FilterRow` + `FilterBox` | 建三棵树（状态 / 类别 / 领域）+ 尾部搜索框 |
 * | 列表 | `CardRow` × N | 排序（按最后动过）+ 空态 + 列名行 |
 * | 详情 | `CardDetail` | 传 labels / 回调；**不碰**它的显示判决 |
 * | 状态菜单 | `StatusMenu` | 锚点是详情里那个状态格（`[data-meta="status"]`）|
 *
 * ## 受控 vs 自持
 *
 * - **受控**（数据在外面）：workspaces / cards / templates / selectedId / 回调。
 *   和六个组件一样 —— 这个组件不拉数据、不发请求。
 * - **自持**（纯 UI 状态）：筛选的 picked、搜索框文字、科技树/列表切换、分隔条比例。
 *   ⚠ 筛选**不在这里过滤 cards**：它只把 `onFilterChange` 上报，
 *     真正过滤归数据层（V3 是视图，不是 store，见文件顶「只做拼装」）。
 *     预览里因此列表不随筛选变化 —— 这是**待接数据层**，不是视觉决定。
 *
 * ## 布局（两个维度，不是两个宽度档）
 *
 * ```
 * 宽（> 700px）                    窄（≤ 700px，570×920 的真实 tab）
 * ┌───────────────────────────┐    ┌───────────────────────────┐
 * │ SpaceBar                  │    │ SpaceBar（折 3 行）        │
 * │ 工具栏（一行）             │    │ 工具栏（条数 / 切换 / 新建）│
 * │ FilterRow（一行）          │    │ 图例（第二行）             │
 * ├──────────────┬────────────┤    │ FilterRow（折 2 行）       │
 * │ 列表 flex:2  │ 详情 flex:1.2│   ├───────────────────────────┤
 * │              │ min300/max460│   │ 列表 52%                   │
 * └──────────────┴────────────┘    ├─ 可拖分隔条 ───────────────┤
 *                                  │ 详情 剩余（约 45%）         │
 *                                  └───────────────────────────┘
 * ```
 *
 * ⚠ **判据是宽，不是面积**：570×920 窄而高 ⇒ 堆叠；1200×400 宽而矮 ⇒ 横排。
 *   同一条理由写在 `CREATE_CSS` 的 `@container tb3cc` 注释里（那边已经踩过）。
 * ⚠ 百分比的门槛是**量出来的**：窄版列表 52% 让列表露出 4~5 行、
 *   详情露出头部 + 两章 + 备注（见 `dev/preview/workspace/verify.mjs` 的几何断言）。
 *
 * ## 设计图里没有画、但必须有的东西
 *
 * - **状态菜单的触发点**：设计图详情里的状态是「圆点 + 文字」（`StatusCell`，
 *   定稿组件里它就是不可点的）。菜单必须有个锚点 ⇒ 这里**不新增按钮**，
 *   用事件委托把详情里的状态格变成触发器（`.tb3w-detail [data-meta="status"]`），
 *   CSS 给它 hover 底色 + `⌄` 角标。改的是**样式钩子**，没改 `CardDetail` 的行为。
 * - **空详情 / 空列表 / 科技树占位**：设计图没画空态，但页面必须有。
 *
 * ## 相对导入带后缀
 *
 * 全仓规则：`./x.ts` / `./x.tsx`（见 AGENTS.md 规则 1）。
 */

import { useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';

import { TASK_STATES, buttonsOf, isTaskState } from '@taskboard/protocol';
import type { ButtonAction } from '@taskboard/protocol';

import { KIND_ORDER, cardTimes, stateLabel } from '../pure/card-view.ts';
import type { FilterNode, Picked } from '../pure/filter-box.ts';
import type { Card, TemplateSummary, Workspace as SpaceEntity } from '../types.ts';
import { CardDetail } from './CardDetail.tsx';
import { CardRow } from './CardRow.tsx';
import type { FilterSpec } from './FilterRow.tsx';
import { FilterRow } from './FilterRow.tsx';
import { SpaceBar } from './SpaceBar.tsx';
import { StatusMenu } from './StatusMenu.tsx';

/* ══════════════════════════════════════════════════════════
   关系图例

   ⚠ 图例的颜色**不是状态色**（那是 9 状态一状态一色那套）。六种关系各一个
   色相/线型，和旧版一致；数值抄设计图 view-3-workspace.svg 的图例段。
   ══════════════════════════════════════════════════════════ */

/** 图例一项。`rel` 只用于 CSS 选择颜色/线型（`data-rel`）。 */
interface LegendItem {
	readonly rel: string;
	readonly label: string;
	readonly title: string;
}

const LEGEND: readonly LegendItem[] = Object.freeze([
	{ rel: 'derives', label: '派生', title: '父任务 → 子任务' },
	{ rel: 'depends', label: '依赖', title: '必须先完成' },
	{ rel: 'supersedes', label: '取代', title: '这张卡取代了旧卡' },
	{ rel: 'constrains', label: '约束', title: '限制了另一张卡' },
	{ rel: 'related', label: '相关', title: '同一条线的工作' },
	{ rel: 'references', label: '参考', title: '只是引用，不是依赖' },
]);

/* ══════════════════════════════════════════════════════════
   组件属性
   ══════════════════════════════════════════════════════════ */

/** 工作区属性 —— 数据全部由外面给（本组件不拉数据）。 */
export interface WorkspaceProps {
	/** 全部空间（含归档）。 */
	readonly workspaces: readonly SpaceEntity[];
	/** 当前**激活**空间（写操作 / AI 默认空间）。 */
	readonly currentId: string;
	/** 正在**查看**的空间。 */
	readonly viewingId: string;
	/** 「显示已归档」开关（受控）。 */
	readonly showArchived: boolean;
	/** 正在查看的空间的卡（全量，已由数据层按空间取好）。 */
	readonly cards: readonly Card[];
	/** 模板清单（只在里面查 displayName / 领域 / 类别）。 */
	readonly templates: readonly TemplateSummary[];
	/** 当前选中的卡；`null` = 详情关闭。 */
	readonly selectedId: string | null;
	/**
	 * 筛选框的**初始**选中路径（按 boxId）。
	 *
	 * ⚠ 只是 `defaultValue` 语义：挂了之后 picked 由本组件自持、按用户点击变。
	 *   预览用它把初始态钉成设计图那个状态（状态：提交 / 类别：设计 / 领域：核心›设计）；
	 *   产品里不传 = 三个框都没选。
	 */
	readonly defaultPicked?: Readonly<Record<string, Picked>>;
	/** 分类中文名。不传就显示英文 id（`card-view.ts` 的口径：不编中文）。 */
	readonly kindLabelOf?: (kind: string) => string;
	/** AI 未读条数（P4 未接，只显示计数）。`0` / 不传 = 不显示这颗 chip。 */
	readonly aiUnreadCount?: number;
	/** AI 更新过的条数（同上）。 */
	readonly aiUpdatedCount?: number;

	/* ── 回调 ── */
	readonly onView: (id: string) => void;
	readonly onActivate: (id: string) => void;
	readonly onToggleArchived: (id: string) => void;
	readonly onToggleShowArchived: () => void;
	readonly onCreateWorkspace: () => void;
	readonly onSelect: (cardId: string | null) => void;
	readonly onCreateCard: () => void;
	/** 筛选变化（**只上报**，过滤由数据层做；见文件头）。 */
	readonly onFilterChange?: (id: string, next: Picked) => void;
	/** 搜索框变化（同上：只上报）。 */
	readonly onSearchChange?: (text: string) => void;
	/** 菜单里选了某个转移按钮。 */
	readonly onAction?: (cardId: string, action: ButtonAction) => void;
	readonly onAddRelation?: (cardId: string) => void;
	readonly onDerive?: (cardId: string) => void;
	readonly onNoteChange?: (cardId: string, text: string) => void;
	/** 工具栏「权限与约定」。不传 = 不显示这个按钮（V2 还没做）。 */
	readonly onOpenPermission?: () => void;
	/** 详情右上角 ⧉（放大成抽屉，V4）。不传 = 不画这个按钮。 */
	readonly onExpandDetail?: () => void;
}

/* ══════════════════════════════════════════════════════════
   组件
   ══════════════════════════════════════════════════════════ */

/**
 * 工作区。
 *
 * @param props 见 `WorkspaceProps`
 */
export function Workspace(props: WorkspaceProps): ReactNode {
	/* ── 纯 UI 状态 ── */
	const [view, setView] = useState<'list' | 'tree'>('list');
	const [search, setSearch] = useState<string>('');
	const [picked, setPicked] = useState<Readonly<Record<string, Picked>>>(
		() => props.defaultPicked ?? {},
	);
	const [menu, setMenu] = useState<{ readonly cardId: string; readonly anchor: HTMLElement } | null>(
		null,
	);
	/** 分隔条拖过之后的列表占比；`null` = 用 CSS 默认（宽 2:1.2 / 窄 52%）。 */
	const [splitRatio, setSplitRatio] = useState<number | null>(null);

	const mainRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLElement>(null);
	const splitRef = useRef<HTMLDivElement>(null);

	/* ── 派生数据 ── */

	const kindLabel = (kind: string): string => props.kindLabelOf?.(kind) ?? kind;

	const templateLabels = useMemo<ReadonlyMap<string, string>>(
		() => new Map(props.templates.map((one) => [one.ref, one.displayName])),
		[props.templates],
	);
	const templateLabel = (ref: string): string => templateLabels.get(ref) ?? ref;

	/** 按「最后动过」倒排（设计图列表头上写着「按更新时间」）。 */
	const sortedCards = useMemo<readonly Card[]>(
		() =>
			[...props.cards].sort(
				(left, right) =>
					(cardTimes(right.history).last ?? 0) - (cardTimes(left.history).last ?? 0),
			),
		[props.cards],
	);

	const selectedCard = useMemo<Card | null>(
		() => props.cards.find((one) => one.id === props.selectedId) ?? null,
		[props.cards, props.selectedId],
	);

	/** 状态菜单的按钮表（`buttonsOf(kind, from, 'user')` —— 唯一来源）。 */
	const actions = useMemo<readonly ButtonAction[]>(
		() =>
			selectedCard !== null && isTaskState(selectedCard.status)
				? buttonsOf(selectedCard.template.kind, selectedCard.status, 'user')
				: [],
		[selectedCard],
	);

	/* ── 三棵筛选树 ── */

	const statusNodes = useMemo<readonly FilterNode[]>(
		() => TASK_STATES.map((state) => ({ value: state, label: stateLabel(state) })),
		[],
	);

	const kindNodes = useMemo<readonly FilterNode[]>(
		() => KIND_ORDER.map((kind) => ({ value: kind, label: props.kindLabelOf?.(kind) ?? kind })),
		[props.kindLabelOf],
	);

	/**
	 * 领域树：**领域 › 类别 › 模板**（设计图展开态那三段）。
	 *
	 * 层次来自模板清单本身（`TemplateSummary` 有 domain / kind / ref），
	 * 不在这里维护第二份词表。
	 */
	const domainNodes = useMemo<readonly FilterNode[]>(() => {
		const labelOf = (kind: string): string => props.kindLabelOf?.(kind) ?? kind;
		const domains: string[] = [];
		for (const one of props.templates) {
			if (!domains.includes(one.domain)) domains.push(one.domain);
		}
		return domains.map((domain) => ({
			value: domain,
			label: domain,
			children: KIND_ORDER.map((kind) => ({
				value: kind,
				label: labelOf(kind),
				children: props.templates
					.filter((one) => one.domain === domain && one.kind === kind)
					.map((one) => ({ value: one.ref, label: one.displayName })),
			})).filter((kindNode) => (kindNode.children ?? []).length > 0),
		}));
	}, [props.templates, props.kindLabelOf]);

	const filters = useMemo<readonly FilterSpec[]>(
		() => [
			{ id: 'status', title: '状态', nodes: statusNodes, picked: picked['status'] ?? [] },
			{ id: 'kind', title: '类别', nodes: kindNodes, picked: picked['kind'] ?? [] },
			{ id: 'domain', title: '领域', nodes: domainNodes, picked: picked['domain'] ?? [] },
		],
		[statusNodes, kindNodes, domainNodes, picked],
	);

	const changeFilter = (id: string, next: Picked): void => {
		setPicked((prev) => ({ ...prev, [id]: next }));
		props.onFilterChange?.(id, next);
	};

	/* ── 交互 ── */

	const select = (cardId: string | null): void => {
		setMenu(null);
		props.onSelect(cardId);
	};

	/**
	 * 详情里的状态格 → 打开状态菜单。
	 *
	 * 为什么是事件委托而不是给 `CardDetail` 加 prop：它是**已定稿**组件，
	 * 状态在它里面是不可点的 `StatusCell`。这里只读它的 DOM 钩子
	 * `[data-meta="status"]`（`DetailHead` 自己写的），不改它的结构。
	 */
	const onDetailClick = (event: ReactMouseEvent<HTMLElement>): void => {
		if (selectedCard === null) return;
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const statusCell = target.closest('[data-meta="status"]');
		if (!(statusCell instanceof HTMLElement)) return;
		setMenu({ cardId: selectedCard.id, anchor: statusCell });
	};

	/**
	 * 分隔条拖动 —— 两种情况（宽版横拖 / 窄版竖拖）**同一套代码**：
	 * 方向从 `.tb3w-main` 计算后的 `flex-direction` 读，不猜。
	 *
	 * 结果写成**百分比**（`flex-basis`），所以容器换尺寸后比例仍然成立
	 * —— 写死 px 的话切一次舞台就会溢出。
	 */
	const onSplitMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
		const main = mainRef.current;
		const list = listRef.current;
		if (main === null || list === null) return;
		event.preventDefault();

		const column = getComputedStyle(main).flexDirection === 'column';
		const startPos = column ? event.clientY : event.clientX;
		const mainBox = main.getBoundingClientRect();
		const listBox = list.getBoundingClientRect();
		const mainSize = column ? mainBox.height : mainBox.width;
		const startSize = column ? listBox.height : listBox.width;
		if (mainSize <= 0) return;

		/* 两头都留最小值，否则会把某一栏挤成 0（拖不回来）。 */
		const MIN_LIST = 160;
		const MIN_DETAIL = 180;

		const onMove = (moveEvent: globalThis.MouseEvent): void => {
			const delta = (column ? moveEvent.clientY : moveEvent.clientX) - startPos;
			const next = Math.min(
				Math.max(startSize + delta, MIN_LIST),
				mainSize - MIN_DETAIL,
			);
			setSplitRatio(next / mainSize);
		};
		const onUp = (): void => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	};

	/* 拖过之后才写内联 style；没拖过让 CSS 说话（宽 2:1.2、窄 52%）。 */
	const listStyle =
		splitRatio === null ? undefined : { flex: `0 0 ${String(splitRatio * 100)}%` };
	const detailStyle =
		splitRatio === null ? undefined : { flex: '1 1 0', maxWidth: 'none' };

	/* ── 渲染 ── */

	const detailOpen = selectedCard !== null;

	/**
	 * 详情面板。抽成函数而不是内联 JSX —— 内联时 `selectedCard` 的收窄
	 * 要穿过事件回调（TS 不保证），这里用**参数是 `Card`** 把收窄钉死。
	 *
	 * @param card 当前选中的卡（已非空）
	 */
	const renderDetail = (card: Card): ReactNode => (
		<aside className="tb3w-detail" style={detailStyle} data-detail-pane onClick={onDetailClick}>
			<CardDetail
				card={card}
				templateLabel={templateLabel(card.template.ref)}
				kindLabel={kindLabel(card.template.kind)}
				onTransition={(to) => {
					const hit = actions.find((one) => one.to === to);
					if (hit !== undefined) props.onAction?.(card.id, hit);
				}}
				onAddRelation={() => {
					props.onAddRelation?.(card.id);
				}}
				onDerive={() => {
					props.onDerive?.(card.id);
				}}
				onNoteChange={(text) => {
					props.onNoteChange?.(card.id, text);
				}}
				onClose={() => {
					select(null);
				}}
				{...(props.onExpandDetail === undefined ? {} : { onExpand: props.onExpandDetail })}
			/>
		</aside>
	);

	/** 菜单还该不该画：打开时那张卡必须还是当前选中的卡（否则锚点已不在屏幕上）。 */
	const menuCardId =
		menu !== null && menu.cardId === (selectedCard?.id ?? '') ? menu.cardId : null;

	return (
		<div className="tb3w-root" data-view={view} data-detail={detailOpen ? 'open' : 'closed'}>
			<div className="tb3w-page">
				<div className="tb3w-chrome">
					<SpaceBar
						workspaces={props.workspaces}
						currentId={props.currentId}
						viewingId={props.viewingId}
						showArchived={props.showArchived}
						cardCount={props.cards.length}
						onView={props.onView}
						onActivate={props.onActivate}
						onToggleArchived={props.onToggleArchived}
						onToggleShowArchived={props.onToggleShowArchived}
						onCreate={props.onCreateWorkspace}
					/>

					<div className="tb3w-toolbar" data-toolbar>
						<span className="tb3w-toolbar__title">
							任务
							<span className="tb3w-toolbar__count">
								共 {String(props.cards.length)} 条
							</span>
						</span>

						<span className="tb3w-toolbar__legend" data-legend>
							<span className="tb3w-toolbar__legend-label">关系图例</span>
							{LEGEND.map((item) => (
								<span className="tb3w-legend__item" key={item.rel} title={item.title}>
									<i className="tb3w-legend__line" data-rel={item.rel} />
									<span>{item.label}</span>
								</span>
							))}
							<span className="tb3w-legend__hint tb3w-legend__hint--long">
								（只在科技树视图显示）
							</span>
							<span className="tb3w-legend__hint tb3w-legend__hint--short">
								（仅科技树）
							</span>
						</span>

						<span className="tb3w-toolbar__actions">
							{props.onOpenPermission === undefined ? null : (
								<button
									type="button"
									className="ghost-btn tb3w-toolbar__perm"
									onClick={props.onOpenPermission}
								>
									权限与约定
								</button>
							)}
							<span className="tb3w-seg" role="group" aria-label="视图切换">
								<button
									type="button"
									className={view === 'tree' ? 'tb3w-seg__btn is-on' : 'tb3w-seg__btn'}
									data-view-btn="tree"
									aria-pressed={view === 'tree'}
									onClick={() => {
										setView('tree');
									}}
								>
									科技树
								</button>
								<button
									type="button"
									className={view === 'list' ? 'tb3w-seg__btn is-on' : 'tb3w-seg__btn'}
									data-view-btn="list"
									aria-pressed={view === 'list'}
									onClick={() => {
										setView('list');
									}}
								>
									列表
								</button>
							</span>
							<button
								type="button"
								className="tb3w-btn-primary"
								data-create-card
								onClick={props.onCreateCard}
							>
								新建
							</button>
						</span>
					</div>

					<div className="tb3w-filters">
						<FilterRow
							filters={filters}
							onChange={changeFilter}
							trailing={
								<span className="tb3w-filters__tail">
									{props.aiUnreadCount !== undefined && props.aiUnreadCount > 0 ? (
										<span
											className="tb3w-ai-chip"
											data-ai-chip="unread"
											title="AI 改过、我还没读的卡（P4 的筛选还没接，这里只显示计数）"
										>
											AI未读 <b>{String(props.aiUnreadCount)}</b>
										</span>
									) : null}
									{props.aiUpdatedCount !== undefined && props.aiUpdatedCount > 0 ? (
										<span
											className="tb3w-ai-chip"
											data-ai-chip="updated"
											title="AI 更新过的卡（P4 的筛选还没接，这里只显示计数）"
										>
											AI 更新过 <b>{String(props.aiUpdatedCount)}</b>
										</span>
									) : null}
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
												props.onSearchChange?.(event.target.value);
											}}
										/>
									</label>
								</span>
							}
						/>
					</div>
				</div>

				<div className="tb3w-main" ref={mainRef} data-main>
					<section className="tb3w-list" ref={listRef} style={listStyle} data-list>
						<header className="tb3w-list__head">
							<span className="tb3w-list__title">
								列表 <em>· {String(props.cards.length)} 条</em>
							</span>
							<span className="tb3w-list__sort">
								{view === 'tree' ? '科技树' : '按更新时间'}
							</span>
						</header>

						<div className="tb3w-list__cols" aria-hidden="true">
							<span>编号 + 状态</span>
							<span>分类 · 领域 · 模板</span>
							<span>标题</span>
							<span>最后动过</span>
						</div>

						<div className="tb3w-list__body" data-list-body>
							{view === 'tree' ? (
								<div className="tb3w-list__empty" data-tree-placeholder>
									科技树视图还没做（V1）。
								</div>
							) : sortedCards.length === 0 ? (
								<div className="tb3w-list__empty">这个空间还没有卡。</div>
							) : (
								sortedCards.map((card) => (
									<CardRow
										key={card.id}
										card={card}
										selected={card.id === props.selectedId}
										kindLabel={kindLabel(card.template.kind)}
										templateLabel={templateLabel(card.template.ref)}
										onSelect={select}
									/>
								))
							)}
						</div>
					</section>

					{detailOpen ? (
						<div
							className="tb3w-split"
							ref={splitRef}
							role="separator"
							data-split
							onMouseDown={onSplitMouseDown}
						>
							<span className="tb3w-split__line" />
							<span className="tb3w-split__grip" aria-hidden="true">
								⇄
							</span>
						</div>
					) : null}

					{selectedCard === null ? null : renderDetail(selectedCard)}

					{detailOpen ? null : (
						<aside className="tb3w-detail" data-detail-empty>
							<div className="tb3w-detail__empty">点左边一张卡看详情。</div>
						</aside>
					)}
				</div>
			</div>

			{/*
			 * 状态菜单：portal 到 body 的 fixed 浮层。
			 * 只在「打开时那张卡还是当前选中的卡」时才画 —— 否则锚点已经不在屏幕上了。
			 */}
			{menuCardId === null || menu === null ? null : (
				<StatusMenu
					actions={actions}
					anchor={menu.anchor}
					onPick={(action) => {
						const cardId = menuCardId;
						if (cardId !== null) props.onAction?.(cardId, action);
					}}
					onClose={() => {
						setMenu(null);
					}}
				/>
			)}
		</div>
	);
}
