/**
 * 工作区（V3）—— 把**已定稿**的组件拼成一个完整页面。
 *
 * ## 它只做「拼装 + 布局」
 *
 * 用户 `2026-11-20`：「一个视图那么多能拆的。做了组件吗」
 * ⇒ 四块内联部件已经搬进 `src/renderers/workspace/`，本文件只留「谁放哪」：
 *
 * | 块 | 谁画 | 本文件的责任 |
 * |---|---|---|
 * | 空间折叠栏 | `SpaceFoldToggle` + `SpaceFoldBody` | 传 workspaces / current / viewing / 归档开关 |
 * | 工具栏 | `WorkspaceToolbar` | 传计数 / 视图 / 回调；空间选择器由 `SpaceFoldToggle` 提供 |
 * | 筛选行 | `FilterRow` + `FilterBox` | 建三棵树（状态 / 类别 / 领域）+ 尾部搜索框（定稿的 `SearchBox`）|
 * | 列表头 | `ListHeader` | 传「显示中条数」 |
 * | 空态 | `ListEmpty` | 传「为什么空」的判决（`emptyReasonOf()`）|
 * | 列表 | `CardRow` × N | 排序（按最后动过）+ 筛选/搜索（**隐藏**不匹配的卡）|
 * | 科技树 | `TechTree` | `view=tree` 时占满列表栏；原样传 cards / 选中 / 筛选（判决在 `pure/tree-filter.ts`）|
 * | 分隔条 | `SplitHandle` | 收它上报的列表比例、写成 `flex-basis` |
 * | 详情 | `CardDetail` | 传 labels / 回调；**不碰**它的显示判决 |
 * | 状态菜单 | `StatusMenu` | 锚点是详情里那个状态格（`[data-meta="status"]`）|
 *
 * ## 受控 vs 自持
 *
 * - **受控**（数据在外面）：workspaces / cards / templates / selectedId / 回调。
 *   和六个组件一样 —— 这个组件不拉数据、不发请求。
 * - **自持**（纯 UI 状态）：筛选的 picked、搜索框文字、科技树/列表切换、
 *   科技树 hover（`TechTree` 的 hover 是受控的）、分隔条比例。
 *   ⚠ 筛选/搜索的**判决**不在这里，在 `pure/card-filter.ts`；本文件只调
 *     `applyCardQuery()` 把结果喂给列表 —— 不匹配的卡**根本不渲染**。
 *     用户 `2026-11-19`：「筛选/搜索后，不匹配的卡要**隐藏**（不是变淡）。」
 *   `onFilterChange` / `onSearchChange` 仍然上报（外面若有数据层要同步，照旧能接），
 *   但**本地已经生效**，不再依赖外部过滤 —— 之前的「受控但不生效」到此结束。
 *
 * ## 布局（两个维度，不是两个宽度档）
 *
 * ```
 * 宽（> 700px）                    窄（≤ 700px，570×920 的真实 tab）
 * ┌───────────────────────────┐    ┌───────────────────────────┐
 * │ 工具栏（含空间开关）        │    │ 工具栏（含空间开关，折行）  │
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
 * - **空详情 / 空列表**：设计图没画空态，但页面必须有。
 *
 * ## 相对导入带后缀
 *
 * 全仓规则：`./x.ts` / `./x.tsx`（见 AGENTS.md 规则 1）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';

import { GROUP_LABELS, TASK_STATES, buttonsOf, isTaskState, statesInGroup } from '@taskboard/protocol';
import type { StatusGroup } from '@taskboard/protocol';
import type { ButtonAction } from '@taskboard/protocol';

import { KIND_ORDER, cardTimes, stateLabel } from '../pure/card-view.ts';
import { SiblingRelationPanel } from './SiblingRelationPanel.tsx';
import { uiStateStore } from '../ui-state-store.ts';
import {
	applyCardQuery,
	emptyReasonOf,
	filterOfPicked,
	findCardByQuery,
	isFilterActive,
	isQueryActive,
} from '../pure/card-filter.ts';
import type { CardFilter } from '../pure/card-filter.ts';
import type { FilterNode, Picked } from '../pure/filter-box.ts';
import { relationsOf, statusGroupOf } from '../pure/relations-block.ts';
import { visibleCardIds } from '../pure/tree-filter.ts';
import type { TreeFilterCriteria } from '../pure/tree-filter.ts';
import type { Card, TemplateSummary, Workspace as SpaceEntity } from '../types.ts';
import { CardDetail } from './CardDetail.tsx';
import { CardRow } from './CardRow.tsx';
import type { FilterSpec } from './FilterRow.tsx';
import { FilterRow } from './FilterRow.tsx';
import { SearchBox } from './SearchBox.tsx';
import { StatusMenu } from './StatusMenu.tsx';
import { TechTree } from './TechTree.tsx';
import { ListEmpty } from './workspace/ListEmpty.tsx';
import { ListHeader } from './workspace/ListHeader.tsx';
import { SplitHandle } from './workspace/SplitHandle.tsx';
import { WorkspaceToolbar } from './workspace/WorkspaceToolbar.tsx';
import { CardActionControl } from './workspace/CardActionControl.tsx';
import { SpaceFoldBody, SpaceFoldToggle } from './workspace/SpaceFold.tsx';

/* ══════════════════════════════════════════════════════════
   状态筛选的分组顺序
   ══════════════════════════════════════════════════════════ */

/**
 * 四个状态组的展示顺序（草稿 / 进行 / 搁置 / 完成）。
 *
 * ⚠ 顺序跟着 `GROUP_LABELS` 的定义顺序（原版 `relations-block.js` 的注释：
 *   「组顺序按用户原话，别按字典排」）。组名和归属都来自 protocol，UI 不造词。
 *
 * `satisfies` 保证每个值都是合法组（但**不**保证「protocol 里的组都在这里」—— 见下）。
 */
const STATUS_GROUP_ORDER = [
	'draft',
	'active',
	'shelved',
	'ended',
] as const satisfies readonly StatusGroup[];

/*
 * ⚠ 这里**没有** `const _COUNT: 4 = STATUS_GROUP_ORDER.length` 那种断言。
 *
 * 它想抓的是「StatusGroup 加了第 5 个组但这里没加」，但 `satisfies`
 * 已经抓不住了 —— `satisfies` 只保证「这里的每一项都合法」，
 * **不保证「protocol 里的每一项都在这里」**。真要抓那个方向，得写：
 *
 * ```ts
 * type _Missing = Exclude<StatusGroup, (typeof STATUS_GROUP_ORDER)[number]>;
 * const _check: _Missing extends never ? true : false = true;
 * ```
 *
 * 但那是个**编译期断言**，运行时没有意义 —— 而 `_GROUP_ORDER_COUNT` 那个
 * `const _X: 4 = …length` 只检查「长度等于 4」，既不指向缺失的组名，
 * 也不检查「是否漏了 protocol 新加的组」。**它看着像守护，实际什么都没挡。**
 */


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
	/**
	 * 科技树 / 列表的**初始**视图（`defaultValue` 语义，**默认 `'tree'`**）。
	 *
	 * 用户 `2026-11-20`：「所有视图的进入默认视图要是科技树的。现在是列表。」
	 *
	 * ⚠ 和 `defaultPicked` 同一套理由：挂载后由本组件自持、按用户点击变。
	 *   存在的目的是让**静态渲染**（SSR 断言 / 预览）能直接画出指定视图 ——
	 *   `view` 是内部状态，静态渲染点不了按钮。
	 */
	readonly defaultView?: 'list' | 'tree';
	/** 分类中文名。不传就显示英文 id（`card-view.ts` 的口径：不编中文）。 */
	readonly kindLabelOf?: (kind: string) => string;
	// TODO(审查): aiUnreadCount/aiUpdatedCount 两个 prop 声明后从不读取（下面 :352-353 用同名局部常量覆盖）；dev 预览仍在传它们，等于没测到。可直接删 prop，或改成用传入值（是否让外部控制计数需用户决定）。
	/** AI 未读条数（P4 未接，只显示计数）。`0` / 不传 = 不显示这颗 chip。 */
	readonly aiUnreadCount?: number;
	/** AI 更新过的条数（同上）。 */
	readonly aiUpdatedCount?: number;

	/* ── 回调 ── */
	readonly onView: (id: string) => void;
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
	/**
	 * 点「+ 派生子任务」。
	 *
	 * ⚠ 第二个参数是**那个按钮的 DOM 元素** —— 浮窗要贴着它出现。
	 *   回调链中间那几层（`CardDetail → DetailHead → RelationPanel → DeriveButton`）
	 *   只上报「被点了」、不带事件对象，所以这里按 `[data-action-kind="derive"]`
	 *   查一次（详情区一次只画一张卡 ⇒ 全屏唯一）。
	 */
	readonly onDerive?: (cardId: string, anchor: HTMLElement) => void;
	readonly onNoteChange?: (cardId: string, text: string) => void;
	/**
	 * 章节内联编辑（ask 作答 / text 失焦）。
	 *
	 * ⚠ 本组件**不组装 content、不发请求**（它不持有 api）—— 只把
	 * `cardId + sectionId + patch` 交给数据层（`WorkspaceBody` → store），
	 * 由那边用「当前全部章节」组装整份 `content` 再 `PATCH /cards/:id`。
	 * 省略 ⇒ `CardDetail` 的章节全部只读（没接线时不假装能改）。
	 */
	readonly onSectionChange?: (
		cardId: string,
		sectionId: string,
		patch: Readonly<Record<string, unknown>>,
	) => void;
	// TODO(审查): 这个 prop 声明后在本组件从不使用（也没传给 WorkspaceToolbar），而 WorkspaceToolbar.tsx:81,155-163 的「权限与约定」按钮依赖它 ⇒ 按钮在产品里不可达。要么接上（setCreating/openPermission 由 WorkspaceBody 传），要么删 prop+按钮；需用户决定。
	/** 工具栏「权限与约定」。不传 = 不显示这个按钮（V2 还没做）。 */
	readonly onOpenPermission?: () => void;
	/** 详情右上角 ⧉（放大成抽屉，V4）。不传 = 不画这个按钮。 */
	readonly onExpandDetail?: () => void;
	/**
	 * 数据在飞（切空间时会短暂为真）。
	 *
	 * 用户 `2026-11-23`：
	 * 「切换工作空间的时候整个视口都跳变。给他加一点过度时间。或者跳变也不要全变了。
	 *   显示"正在加载"不应该包含视口上面的菜单部分。应该只有里面的列表或者科技树的视口显示正在加载。」
	 *
	 * ⇒ **加载态只盖 `.tb3w-main`（列表 / 科技树 / 详情那一块）**，
	 *   chrome（空间 chips + 工具栏 + 筛选行）照常画 —— 否则整块视口会跳变。
	 *
	 * ⚠ 和 `WorkspaceBody` 的整页加载区分：那是**首次加载**（还没有任何空间可画），
	 *   连 chips 都没有数据，只能整页提示。这里是**已有数据时换空间**。
	 */
	readonly loading?: boolean;
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
	/*
	 * 三入口共享的 UI 状态（组 / 折叠态）按**空间**分——用户 `2026-11-24`
	 * 「状态属于容器，不属于文件」。这里负责把它指到正在看的那个空间；
	 * 没这一步，store 的 workspaceId 永远是空串，折叠态读写全是空。
	 */
	// TODO(审查): 三个入口（右栏 tab / main / 抽屉）各是独立 WorkspaceBody，各自把模块级单例 store 指到自己的 viewingId；两个入口同时看不同空间时会互相覆盖折叠/组数据。可把快照改成按空间分片（store 已有 cache Map），或让读取方带 workspaceId；属可直接改，但会动 store 接口。
	/*
	 * 与本仓库「加载失败写回空态」缺陷的关系（2026-11-28 核实，**放大器不是根因**）：
	 * 单例的 cache / 快照是三个入口共享的 ⇒ 旧行为下一次 GET 失败会往共享 cache 写空态并
	 * 标记已加载，于是**从未失败的那个入口**也会读到「已加载的空态」，它的一次折叠/组操作
	 * 就把空数据 PUT 回去。修复（`ui-state-store.ts` 的「加载失败 ≠ 空状态」裁定）已把写回
	 * 门禁改成按空间的 `loadedWorkspaces`、失败不写 cache ⇒ 失败不再污染共享状态。
	 * 本条 TODO 本身（不同空间互相覆盖）仍**未修**，留待按空间分片。
	 */
	useEffect(() => {
		if (props.viewingId !== '') uiStateStore.setWorkspace(props.viewingId);
	}, [props.viewingId]);

	/* ── 纯 UI 状态 ── */
	const [view, setView] = useState<'list' | 'tree'>(() => props.defaultView ?? 'tree');

	/*
	 * 未读筛选 —— 用户 2026-11-21：
	 * 「UI上面要有两个筛选按钮，AI未读，用户未读。」
	 *
	 * ⚠ 是**筛选**（不匹配的卡根本不渲染），不是淡化。
	 *   卡上的左右边框是另一件事（`unreadSides`），两者共存。
	 */
	const [unreadMode, setUnreadMode] = useState<'none' | 'ai' | 'user'>('none');

	/* 空间折叠栏是否展开（A 款：展开区在工具栏下一行）。 */
	const [spaceOpen, setSpaceOpen] = useState(false);
	/* 三处入口共用同一套 DOM（用户 2026-11-23）⇒ 没有「布局密度」这一档。 */
	const [search, setSearch] = useState<string>('');
	/** 科技树里正 hover 的卡（`TechTree` 的 hover 是受控 prop，见组件文件头）。 */
	const [treeHoverId, setTreeHoverId] = useState<string | null>(null);
	const [picked, setPicked] = useState<Readonly<Record<string, Picked>>>(
		() => props.defaultPicked ?? {},
	);
	const [menu, setMenu] = useState<{ readonly cardId: string; readonly anchor: HTMLElement } | null>(
		null,
	);
	/** 分隔条拖过之后的列表占比；`null` = 用 CSS 默认（宽 2:1.2 / 窄 52%）。 */
	const [splitRatio, setSplitRatio] = useState<number | null>(null);
	/**
	 * 根卡关系视图开着吗（科技树最左窄列点开的那个）。
	 *
	 * 用户 2026-11-24：「加一个列头吧。一个很窄的一个列。可以点击。进去以后只有一个关系区作为详情。」
	 * ⇒ 它和「选中一张卡」共用详情位，互斥：开它就把卡选中清掉。
	 */
	const [rootsOpen, setRootsOpen] = useState(false);

	/**
	 * 本实例的根 DOM —— 派生按钮的锚点查询**限定在这里**。
	 *
	 * `WorkspaceBody` 会被注册到 tab / main / 抽屉三处、可能同时挂载；
	 * 用 `document.querySelector('[data-action-kind="derive"]')` 会拿到**别的实例**
	 * 的按钮（浮窗锚错位置）。ref 把查询作用域收回到本组件自己的树。
	 */
	const rootRef = useRef<HTMLDivElement>(null);

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

	/** 三个筛选框的选中路径 → 筛选条件（形状见 `pure/card-filter.ts` 文件头）。 */
	const filter = useMemo<CardFilter>(() => filterOfPicked(picked), [picked]);

	/**
	 * 科技树的筛选条件 —— **和列表同一套 `picked` + `search`**。
	 *
	 * `CardFilter` 的三个 `Picked` 和 `TreeFilterCriteria` 同形状（见
	 * `pure/tree-filter.ts` 文件头的路径表），直接搬；「隐藏不匹配的卡」的判决
	 * 在 `visibleCardIds()`，本组件不判第二遍。
	 */
	const treeFilter = useMemo<TreeFilterCriteria>(
		() => ({
			status: filter.status,
			kind: filter.kind,
			domain: filter.domain,
			search,
			...(unreadMode === 'none' ? {} : { unread: unreadMode }),
		}),
		[filter, search, unreadMode],
	);

	/**
	 * 科技树视图下「筛出多少条」—— **按科技树自己的判决算**。
	 *
	 * 工具栏计数必须跟当前视图一致（列表视图用 `visibleCards`，科技树视图用这个）。
	 * 搜索语义已统一（标题子串 + 编号子串，见 `card-filter.ts` / `tree-filter.ts`
	 * 文件头），两份判决现在等价；仍按视图取数，是为了「计数永远等于当前视图
	 * 真正显示的东西」，而不是依赖两个模块长期保持一致。
	 */
	const treeVisibleCount = useMemo(
		() => (view === 'tree' ? visibleCardIds(props.cards, treeFilter).size : 0),
		[view, props.cards, treeFilter],
	);

	/**
	 * ⚠ **列表真正渲染的那一份**：先排序，再筛选 + 搜索。
	 *
	 * 不匹配的卡在 `applyCardQuery()` 里就被去掉了 ⇒ 渲染时**根本不存在**
	 * （用户 `2026-11-19` 要的「隐藏」，不是 CSS 变淡）。计数 / 空态都跟着它走。
	 */
	const visibleCards = useMemo<readonly Card[]>(() => {
		const matched = applyCardQuery(sortedCards, filter, search);
		if (unreadMode === 'none') return matched;
		return matched.filter((one) => (unreadMode === 'ai' ? one.unread.ai === true : one.unread.user === true));
	}, [sortedCards, filter, search, unreadMode]);

	/* 两个未读按钮上的数字 —— 用**当前列表**算，跟左侧边框同一份数据。 */
	const userUnreadCount = sortedCards.filter((one) => one.unread.user === true).length;
	const aiUnreadCount = sortedCards.filter((one) => one.unread.ai === true).length;

	/** 有没有在筛 / 在搜 —— 只影响文案（计数、空态），判决不在这里。 */
	const filtering = isFilterActive(filter);
	const queryActive = filtering || isQueryActive(search);

	/** 列表空了的原因（只在 `visibleCards.length === 0` 时才用得上）。 */
	const emptyReason = emptyReasonOf(props.cards.length, filter, search);

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

	/*
	 * 状态筛选：**两级**（用户 2026-11-20：「我授权的状态筛选，是展示4个组，
	 * 以及选择组以后展示二级子项的版本」）。
	 *
	 * 一级 = 4 个组（草稿 / 进行 / 搁置 / 完成），二级 = 组下的具体状态。
	 * 组的名字和归属都来自 `@taskboard/protocol`，**UI 不造词**：
	 *   `GROUP_LABELS` / `STATUS_GROUP_OF` / `statesInGroup()`
	 *
	 * ⚠ 组本身也是一个有效筛选依据 —— 选组 = 该组下所有状态都匹配，
	 *   由 `card-filter.ts` 的路径前缀判决实现（卡的状态路径是
	 *   `[组, 状态]`，选 `[组]` 时它正是前缀）。
	 *
	 * 参照原版 `taskboard2/packages/browser/src/views/card-list/filter-row.ts:7-9`：
	 *   点开 → 草稿 | 进行 | 搁置 | 完成
	 *   点组 → 组高亮 + 该组子项
	 */
	const statusNodes = useMemo<readonly FilterNode[]>(
		() =>
			STATUS_GROUP_ORDER.map((group) => ({
				value: group,
				label: GROUP_LABELS[group],
				children: statesInGroup(group).map((state) => ({ value: state, label: stateLabel(state) })),
			})),
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
	// TODO(审查): 领域树的 kind 层用写死的 KIND_ORDER（card-view.ts:137 四个内置 kind），自定义 kind 的模板不会出现（见 card-view.ts 的 TODO）。可改为从 props.templates / state.kinds 派生，KIND_ORDER 只做已知四类排序。
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
		if (cardId !== null) setRootsOpen(false);
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

	/*
	 * 拖过之后才写内联 style；没拖过让 CSS 说话（宽 2:1.2、窄 52%）。
	 *
	 * ⚠ 拖动本身在 `SplitHandle` 里（它自己按 DOM 找 main / list、自己夹边界）；
	 *   本组件只收它上报的**比例**，写成 `flex-basis` 百分比 —— 写 px 的话
	 *   换个舞台尺寸就会溢出。
	 */
	const listStyle =
		splitRatio === null ? undefined : { flex: `0 0 ${String(splitRatio * 100)}%` };
	const detailStyle =
		splitRatio === null ? undefined : { flex: '1 1 0', maxWidth: 'none' };

	/* ── 渲染 ── */

	/** 工具栏计数用哪一份：列表视图用列表的判决，科技树视图用科技树的判决。 */
	const shownCount = view === 'tree' ? treeVisibleCount : visibleCards.length;

	/*
	 * 根卡关系视图（用户 2026-11-24：科技树最左窄列点开，详情位只放关系区）。
	 * 和「选中一张卡」互斥：开根卡关系就清掉卡选中，反之亦然。
	 */
	const detailOpen = selectedCard !== null || rootsOpen;

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
					/*
					 * 「+ 派生子任务」的锚点（浮窗要贴着它出现）。
					 *
					 * 回调链是 `DeriveButton → RelationPanel → DetailHead →
					 * CardDetail → 这里`，中间全不带事件对象（那些组件只上报
					 * 「被点了」）。
					 *
					 * ⇒ 照 `onDetailClick` 查 `[data-meta="status"]` 的同一套路：
					 *   详情区一次只画一张卡 ⇒ `[data-action-kind="derive"]`
					 *   在本实例内唯一 ⇒ 查它拿锚点（**限定在 rootRef 内**，见上）。
					 */
					const anchor =
						rootRef.current?.querySelector<HTMLElement>('[data-action-kind="derive"]') ??
						null;
					if (anchor !== null) props.onDerive?.(card.id, anchor);
				}}
				/*
				 * 关系面板：入边（谁把我当 parent / 谁指向我）要扫全量卡
				 * ⇒ 在**这里**算，`CardDetail` 只有一张卡。
				 * 草稿剔除、三列落位都在 `relationsOf` 里（用户 `2026-11-09 08:45`）。
				 */
				relations={relationsOf(card, props.cards, statusGroupOf)}
				onJumpRelation={(cardId) => {
					select(cardId);
				}}
				onNoteChange={(text) => {
					props.onNoteChange?.(card.id, text);
				}}
				{...(props.onSectionChange === undefined
					? {}
					: {
							onSectionChange: (
								sectionId: string,
								patch: Readonly<Record<string, unknown>>,
							) => {
								props.onSectionChange?.(card.id, sectionId, patch);
							},
						})}
				onClose={() => {
					select(null);
				}}
				{...(props.onExpandDetail === undefined ? {} : { onExpand: props.onExpandDetail })}
				/*
				 * 「子卡归组」进关系折叠区（用户 2026-11-24：「放在卡的关系的那个折叠组件里面」）。
				 * 和根卡视图是同一个组件，只是父是这张卡。
				 */
				siblingGroups={
					<SiblingRelationPanel
						cards={props.cards}
						parentId={card.id}
						title="子卡关系"
					/>
				}
			/>
		</aside>
	);

	/** 菜单还该不该画：打开时那张卡必须还是当前选中的卡（否则锚点已不在屏幕上）。 */
	const menuCardId =
		menu !== null && menu.cardId === (selectedCard?.id ?? '') ? menu.cardId : null;

	return (
		<div
			ref={rootRef}
			className="tb3w-root"
			data-view={view}
			data-detail={detailOpen ? 'open' : 'closed'}
		>
			<div className="tb3w-page">
				<div className="tb3w-chrome">

					{/* 行 1：工具栏 + 空间开关（空间开关见下面 `WorkspaceToolbar` 的 `space`）。 */}
					<div className="tb3w-chrome__bar">
						<WorkspaceToolbar
							shownCount={shownCount}
							totalCount={props.cards.length}
							queryActive={queryActive}
							view={view}
							onViewChange={setView}
							onCreateCard={props.onCreateCard}
							cardAction={<CardActionControl />}
							space={
								<SpaceFoldToggle
									open={spaceOpen}
									onToggle={() => {
										setSpaceOpen((now) => !now);
									}}
								/>
							}
						/>
					</div>

					{/*
					 * 空间折叠栏 —— **用户 2026-11-22 选定的 A 款**：
					 * 「点开以后是打开折叠的隐藏栏，不是悬浮窗」。
					 *
					 * 展开区在工具栏**下一行**、占满宽度、**推挤**筛选行。
					 * 状态由本组件持有（展开区在工具栏外面，组件内部管不了）。
					 */}
					<div className="tb3w-filters">
						<FilterRow
							filters={filters}
							onChange={changeFilter}
							trailing={
								<span className="tb3w-filters__tail">
									{/*
									 * 两个未读筛选按钮 —— 用户 2026-11-21：
									 * 「UI上面要有两个筛选按钮，AI未读，用户未读。」
									 *
									 * ⚠ 这里**不受视图密度限制**（旧实现按密度收起，用户现在要它常驻）。
									 *   计数用**当前列表**算（`sortedCards`），不是 props 里的旧口径。
									 */}
									<button
										type="button"
										className={unreadMode === 'user' ? 'tb3w-ai-chip is-on' : 'tb3w-ai-chip'}
										data-unread-btn="user"
										aria-pressed={unreadMode === 'user'}
										title="用户改过、AI 还没读的卡（点一下筛选）"
										onClick={() => {
											setUnreadMode((now) => (now === 'user' ? 'none' : 'user'));
										}}
									>
										用户未读 <b>{String(userUnreadCount)}</b>
									</button>
									<button
										type="button"
										className={unreadMode === 'ai' ? 'tb3w-ai-chip is-on' : 'tb3w-ai-chip'}
										data-unread-btn="ai"
										aria-pressed={unreadMode === 'ai'}
										title="AI 改过、用户还没读的卡（点一下筛选）"
										onClick={() => {
											setUnreadMode((now) => (now === 'ai' ? 'none' : 'ai'));
										}}
									>
										AI 未读 <b>{String(aiUnreadCount)}</b>
									</button>
									<SearchBox
										value={search}
										onChange={(next) => {
											setSearch(next);
											props.onSearchChange?.(next);
										}}
										/*
										 * 回车 / 点「前往」⇒ **打开完整编号对应的详情**。
										 *
										 * 用户 `2026-11-19`：「输入完整编号后回车 ⇒ 打开那张卡的详情」。
										 * “空 / 纯空格算不算提交” 的判决在 `pure/search-box.ts`
										 * （`canSubmitOf` / `submitQueryOf`），进来的一定是 trim 过的值。
										 * 编号必须**完整**匹配（`findCardByQuery()`，大小写不敏感）；
										 * 找不到就**什么都不做** —— 搜索词留着，列表的筛选结果照旧显示，
										 * 不能把用户刚打的字吞掉（他会以为没生效）。
										 *
										 * ⚠ 列表是**实时**过滤的（上面 `visibleCards`），不靠回车；
										 *   回车只多一件事：打开详情。
										 */
										onSubmit={(query) => {
											const hit = findCardByQuery(props.cards, query);
											if (hit !== null) select(hit.id);
										}}
									/>
								</span>
							}
						/>
					</div>
				</div>

					{spaceOpen ? (
						<SpaceFoldBody
							workspaces={props.workspaces}
							currentId={props.currentId}
							viewingId={props.viewingId}
							showArchived={props.showArchived}
							cardCount={props.cards.length}
							onView={props.onView}
							onToggleArchived={props.onToggleArchived}
							onToggleShowArchived={props.onToggleShowArchived}
							onCreate={props.onCreateWorkspace}
						/>
					) : null}

				<div className="tb3w-main" data-main data-loading={props.loading === true ? '1' : '0'}>
					{/*
					 * 加载态**只盖内容区**（用户 2026-11-23：见 `loading` prop 的注释）。
					 *
					 * 做法是「盖一层 + 把兄弟节点 CSS 隐藏」，不是条件替换：
					 *   旧内容保持挂载 ⇒ 加载前后**没有重排**，chrome 完全不动 ⇒ 视口不跳。
					 */}
					{props.loading === true ? (
						<div className="tb3w-main__loading" data-main-loading>
							<span>正在加载…</span>
						</div>
					) : null}

					<section className="tb3w-list" style={listStyle} data-list>
						{view === 'tree' ? (
							/*
							 * 科技树视图：整栏交给定稿的 `TechTree`（它自带画布滚动 + 页脚图例）。
							 *
							 * ⚠ cards 传**全量**、筛选条件用 `treeFilter` —— 「不匹配的卡隐藏」
							 *   的判决在 `TechTree` 内部（`pure/tree-filter.ts`），本组件不先筛一遍。
							 *   hover 是 `TechTree` 的**受控** prop ⇒ 由本组件持状态。
							 */
							<div className="tb3w-tree" data-tree-body>
								<TechTree
									cards={props.cards}
									selectedId={props.selectedId}
									hoverId={treeHoverId}
									filter={treeFilter}
									kindLabelOf={kindLabel}
									onSelect={select}
									onHoverChange={setTreeHoverId}
									onRootColumnClick={() => {
										setRootsOpen((open) => !open);
										props.onSelect(null);
									}}
									rootColumnOpen={rootsOpen}
								/>
							</div>
						) : (
							<>
								<ListHeader count={visibleCards.length} />

								<div className="tb3w-list__body" data-list-body>
									{visibleCards.length === 0 ? (
										/*
										 * 有卡但被筛/搜掉了 ⇒ 画空态。⚠ 文案按**原因**选，
										 * 不能一律写「这个空间还没有卡」。
										 */
										<ListEmpty reason={emptyReason} query={search} />
									) : (
										visibleCards.map((card) => (
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
							</>
						)}
					</section>

					{detailOpen ? <SplitHandle onResize={setSplitRatio} /> : null}

					{selectedCard === null ? null : renderDetail(selectedCard)}

					{/*
					 * 根卡关系视图：和最左窄列配合（用户 2026-11-24）。
					 * 只放关系区 —— 没有卡详情，因为它代表的是「所有根卡的兄弟集合」。
					 */}
					{rootsOpen ? (
						<aside
							className="tb3w-detail"
							style={detailStyle}
							data-detail-pane
							data-roots-pane
						>
							<SiblingRelationPanel
								cards={props.cards}
								parentId={null}
								onClose={() => {
									setRootsOpen(false);
								}}
							/>
						</aside>
					) : null}

					{/*
					 * ⚠ **不点卡时列表/科技树占满整个视口**（用户 2026-11-23）。
					 *   旧实现会画一个「点左边一张卡看详情」的占位 aside，占掉右半屏 —— 删掉。
					 *   `detailOpen` 为假时这里什么都不渲染，`.tb3w-list` 自然占满。
					 */}
				</div>
			</div>

			{/*
			 * 状态菜单：portal 到 body 的 fixed 浮层。			 * 只在「打开时那张卡还是当前选中的卡」时才画 —— 否则锚点已经不在屏幕上了。
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
