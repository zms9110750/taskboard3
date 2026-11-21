/**
 * 工作区工具栏 —— 计数 / 关系图例 / 权限 / 视图切换 / 新建。
 *
 * 拆自 `Workspace.tsx`（用户 `2026-11-20`：「一个视图那么多能拆的。做了组件吗」）。
 * **行为、DOM、类名、可访问性属性全部与拆之前逐字一致** —— 这不是重设计，是搬家。
 *
 * ## ⚠ 不含空间选择器（用户 2026-11-20）
 *
 * > 「工作区组件只要一个工作区组件，不包括折叠工作区用的按钮。」
 *
 * 所以「工作空间 ▾」按钮**不在这个组件里** —— 由 `Workspace` 在外面拼
 * （`density=compact` 时）。这个组件只做「任务条 + 图例 + 视图切换 + 新建」。
 *
 * ## 它只做「画」
 *
 * 计数文案（`筛出 X / 共 Y 条`）由这里按 `shownCount / totalCount / queryActive`
 * 拼出来，但**哪些卡算「显示中」的判决不在这里**：调用方把当前视图的计数算好传进来
 * （列表视图用 `applyCardQuery()` 的结果，科技树视图用 `visibleCardIds()`）。
 * 为什么按视图取数而不复用同一个数：计数必须永远等于**当前视图真正画出来的东西**，
 * 不能依赖两个过滤模块长期保持一致。
 *
 * ## ⚠ 分段按钮是**临时内联实现**，不要换掉
 *
 * 用户 `2026-11-20` 看过 `dev/components/buttons.tsx` 的 `SegmentedControl` 候选后说：
 * 「这不是我当初选定的定稿组件」⇒ 没有定稿之前，产品里就是下面两行
 * `<button className="tb3w-seg__btn …">`。**拆组件时原样搬过来，不要接候选实现。**
 *
 * ## 关系图例的颜色不走状态色
 *
 * 六种关系各一个色相/线型（旧版一致）。数值抄设计图
 * `X:\temp\view-3-workspace.svg` 的图例段，颜色在 `WORKSPACE_CSS` 里按 `data-rel` 选。
 * 图例是**纯装饰**（不可交互），所以 `density=compact` 里也常驻 ——
 * 用户原话：「不能交互只能看的东西就当装饰品常驻」。
 */

import type { ReactNode } from 'react';

/** 图例一项。`rel` 只用于 CSS 选择颜色/线型（`data-rel`）。 */
interface LegendItem {
	readonly rel: string;
	readonly label: string;
	readonly title: string;
}

/** 六种关系（顺序 = 设计图图例顺序）。 */
const LEGEND: readonly LegendItem[] = Object.freeze([
	{ rel: 'derives', label: '派生', title: '父任务 → 子任务' },
	{ rel: 'depends', label: '依赖', title: '必须先完成' },
	{ rel: 'supersedes', label: '取代', title: '这张卡取代了旧卡' },
	{ rel: 'constrains', label: '约束', title: '限制了另一张卡' },
	{ rel: 'related', label: '相关', title: '同一条线的工作' },
	{ rel: 'references', label: '参考', title: '只是引用，不是依赖' },
]);

/** 视图档。`Workspace` 里是内部 state，这里只收现值 + 变化回调。 */
export type WorkspaceView = 'list' | 'tree';

/** 组件属性。 */
export interface WorkspaceToolbarProps {
	/** 当前视图**真正显示**的条数（列表 = 过滤后；科技树 = 科技树的判决）。 */
	readonly shownCount: number;
	/** 这个空间的总条数（`共 N 条` 里的 N）。 */
	readonly totalCount: number;
	/** 有没有在筛 / 在搜 —— 只决定计数文案写成「共 N 条」还是「筛出 X / 共 N 条」。 */
	readonly queryActive: boolean;
	readonly view: WorkspaceView;
	readonly onViewChange: (next: WorkspaceView) => void;
	readonly onCreateCard: () => void;
	/**
	 * 「权限与约定」。**省略 = 不画这个按钮**（V2 还没做；compact 密度也折叠它）。
	 */
	readonly onOpenPermission?: () => void;
	/**
	 * 空间选择器（`SpacePicker`）。**放在视图切换左边** ——
	 * 用户 2026-11-21：「工作空间放在科技树的左边」。
	 *
	 * ⚠ 这推翻 2026-11-20 的「工具栏不含空间选择器」—— 那时是拆组件，现在是重排布局。
	 */
	readonly space?: ReactNode;
}

/**
 * 工作区工具栏。
 *
 * @param props 见 `WorkspaceToolbarProps`
 */
export function WorkspaceToolbar(props: WorkspaceToolbarProps): ReactNode {
	return (
		<div className="tb3w-toolbar" data-toolbar>
			<span className="tb3w-toolbar__title">
				任务
				<span className="tb3w-toolbar__count" data-count>
					{props.queryActive
						? `筛出 ${String(props.shownCount)} / 共 ${String(props.totalCount)} 条`
						: `共 ${String(props.totalCount)} 条`}
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
				<span className="tb3w-legend__hint tb3w-legend__hint--short">（仅科技树）</span>
			</span>

			<span className="tb3w-toolbar__actions">
				{/* 紧凑：权限与约定收起来（低频、用不上 —— 用户 2026-11-20「要折叠」） */}
				{props.space ?? null}
				{props.onOpenPermission === undefined ? null : (
					<button
						type="button"
						className="ghost-btn tb3w-toolbar__perm"
						onClick={props.onOpenPermission}
					>
						权限与约定
					</button>
				)}
				{/*

				 * ⚠ 分段按钮**没有定稿组件**。这里是临时内联实现，
				 *   候选在 `dev/components/buttons.tsx` 的 `SegmentedControl`
				 *   —— 用户还没选，所以不接进产品（用户 2026-11-20：
				 *   「这不是我当初选定的定稿组件」）。
				 */}
				<span className="tb3w-seg" role="group" aria-label="视图切换">
					<button
						type="button"
						className={props.view === 'tree' ? 'tb3w-seg__btn is-on' : 'tb3w-seg__btn'}
						data-view-btn="tree"
						aria-pressed={props.view === 'tree'}
						onClick={() => {
							props.onViewChange('tree');
						}}
					>
						科技树
					</button>
					<button
						type="button"
						className={props.view === 'list' ? 'tb3w-seg__btn is-on' : 'tb3w-seg__btn'}
						data-view-btn="list"
						aria-pressed={props.view === 'list'}
						onClick={() => {
							props.onViewChange('list');
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
	);
}
