/**
 * 模板**三级联选弹层** —— 变体 ④。**独立组件**（用户 `2026-11-19` 明确要求）。
 *
 * ## 用户原话（`2026-11-19`）
 *
 * > 「和你说的模板选择是分 3 列递进选择还是怎么样。
 * >  **你应该把这些东西的组件演示给我看啊。**
 * >  而且**这个模板选择的点开窗口就应该另外做一个组件了**。」
 *
 * ⇒ 本文件是**弹层本身**：触发器 + 三列 + 底部说明。它不知道「选完模板要刷章节」，
 *   只调 `onPick`（事件）。这和老版 `taskboard2/.../template-picker.ts` 的边界一样。
 *
 * ## 为什么和「普通下拉」是两个组件而不是一个带 `mode` 的
 *
 * 用户要对比的就是**两种控件**。塞进一个组件用 `mode` 分支的话：
 * - 两边的 props 不一样（弹层要 `templates` 清单 + 浏览状态，下拉只要 3 条假模板）
 * - 展厅里并排展示时，得写 `mode="a"` / `mode="b"`，读起来像是同一个东西的两个姿势
 *
 * 分开之后展厅里就是两个**真组件**并排 —— 用户点哪个都行，互不影响。
 *
 * ## 布局（旧版 `template-picker.js` 242 行的做法）
 *
 * ```
 * 触发器 [核心 · 用户任务 ▾]
 *   ↓ 点开
 * ┌─────────┬─────────┬──────────────┐
 * │ 领域    │ 类别    │ 模板          │
 * │ ● 核心  │ G 目标  │ U 用户任务    │
 * │ ○ 代码  │ D 设计  │ F 新增功能    │
 * └─────────┴─────────┴──────────────┘
 * [说明块：一句话 + 编号前缀 + 段数]
 * ```
 *
 * ## 三处照抄旧版的细节（每处都有原因）
 *
 * | # | 细节 | 原因 |
 * |---|---|---|
 * | 1 | 弹层自己 `stopPropagation()` | 否则点领域列时 document 监听立刻关掉弹层 —— 根本点不到第二列 |
 * | 2 | 关闭用 `composedPath()` 不用 `contains()` | 选中后弹层会重画，被点的按钮脱离文档 ⇒ `contains()` 误判成「点外面」|
 * | 3 | 选模板**不**关弹层 | 用户 `2026-11-09`：「点击以后也不会关。需要点这个面板外面才关掉它」|
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
	KIND_META,
	TEMPLATE_CATALOG,
	type CatalogTemplate,
	type TemplateKind,
} from './data.ts';
import {
	EMPTY_BROWSE,
	browseAfterClick,
	buildPickerGroups,
	columnsOf,
	resolveBrowse,
	type BrowseState,
} from '../../pure/template-picker.ts';

/** 组件属性。 */
export interface TemplatePickerPopoverProps {
	/** 已选模板的 `name`（`''` = 还没选）。 */
	readonly pickedRef: string;
	/** 「有人选了一个模板」—— **事件**，不是命令。 */
	readonly onPick: (picked: CatalogTemplate) => void;
	/** 模板清单（展厅用 `TEMPLATE_CATALOG`；接真 API 后传 `state.templates`）。 */
	readonly templates?: readonly CatalogTemplate[];
	/** 初始就展开（截图用；展厅里默认展开，不然截不到三列）。 */
	readonly defaultOpen?: boolean;
}

/** 类别中文名查表。 */
function kindLabelOf(kind: TemplateKind): string {
	return KIND_META[kind].label;
}

/** 类别字母查表。 */
function kindLetterOf(kind: TemplateKind): string {
	return KIND_META[kind].letter;
}

/**
 * 三级联选弹层。
 *
 * @param props 见 `TemplatePickerPopoverProps`
 */
export function TemplatePickerPopover(props: TemplatePickerPopoverProps): ReactNode {
	const templates = props.templates ?? TEMPLATE_CATALOG;
	/*
	 * ⚠ `useMemo` 不是性能考虑，是**正确性**：`buildPickerGroups` 每次返回新数组，
	 *   它进了下面 `useEffect` 的依赖 ⇒ 不 memo 的话每次渲染都触发 effect，
	 *   effect 里 `setBrowse` ⇒ 再渲染 ⇒ 无限循环。
	 */
	const groups = useMemo(
		() => buildPickerGroups(templates, kindLabelOf, kindLetterOf),
		[templates],
	);

	const [open, setOpen] = useState(props.defaultOpen === true);
	const [browse, setBrowse] = useState<BrowseState>(EMPTY_BROWSE);
	const rootRef = useRef<HTMLDivElement | null>(null);

	const picked = templates.find((one) => one.name === props.pickedRef);
	const cols = columnsOf(groups, browse);

	/*
	 * 打开时**定位浏览位置**。
	 *
	 * ⚠ 这里是 `setBrowse(...)` 而**不是**在渲染里算 + 写回：后者每次渲染都 `setState`，
	 *   React 会报「渲染期间更新状态」的循环。
	 */
	useEffect(() => {
		if (!open) return;
		setBrowse((current) => resolveBrowse(current, props.pickedRef, groups));
	}, [open, props.pickedRef, groups]);

	/* 点外面关闭 —— 必须 `composedPath()`，见文件头第 2 条。 */
	useEffect(() => {
		if (!open) return;
		const onDocClick = (event: MouseEvent): void => {
			const root = rootRef.current;
			if (root === null) return;
			if (event.composedPath().includes(root)) return;
			setOpen(false);
		};
		document.addEventListener('click', onDocClick);
		return () => {
			document.removeEventListener('click', onDocClick);
		};
	}, [open]);

	const display = picked === undefined ? '选择一个模板' : `${picked.domain} · ${picked.displayName}`;

	return (
		<div className="tpick" ref={rootRef}>
			{/* 触发器 —— 和普通下拉长得像，但点开是弹层 */}
			<button
				type="button"
				className={`tpick__trigger${picked === undefined ? ' is-empty' : ''}${open ? ' is-open' : ''}`}
				data-picker-trigger=""
				aria-expanded={open}
				onClick={() => {
					setOpen((one) => !one);
				}}
			>
				<span className="tpick__value">{display}</span>
				<span className="tpick__caret">⌄</span>
			</button>

			{open ? (
				<div
					className="tpick__pop"
					data-picker-pop=""
					/* 第 1 条：吞掉冒泡，否则点第一列就把自己关了。 */
					onClick={(event) => {
						event.stopPropagation();
					}}
				>
					<div className="tpick__cols">
						{/* ── 第 1 列：领域 ── */}
						<div className="tpick__col" data-col="domain">
							<div className="tpick__col-head">领域</div>
							{cols.domains.map((group) => {
								const on = group.domain === browse.domain;
								return (
									<button
										type="button"
										key={group.domain}
										className={`tpick__opt${on ? ' is-picked' : ''}`}
										data-domain={group.domain}
										onClick={() => {
											setBrowse((current) => browseAfterClick(groups, current, 'domain', group.domain));
										}}
									>
										<span className="tpick__radio">{on ? '●' : '○'}</span>
										<span className="tpick__name">{group.domain}</span>
									</button>
								);
							})}
						</div>

						{/* ── 第 2 列：类别（前面是**字母**不是圆圈） ── */}
						<div className="tpick__col" data-col="kind">
							<div className="tpick__col-head">类别</div>
							{cols.kinds.map((one) => {
								const on = one.kind === browse.kind;
								return (
									<button
										type="button"
										key={one.kind}
										className={`tpick__opt${on ? ' is-picked' : ''}`}
										data-kind={one.kind}
										onClick={() => {
											setBrowse((current) => browseAfterClick(groups, current, 'kind', one.kind));
										}}
									>
										<span className="tpick__prefix">{one.letter}</span>
										<span className="tpick__name">{one.label}</span>
									</button>
								);
							})}
						</div>

						{/* ── 第 3 列：模板（编号前缀字母 + 名字） ── */}
						<div className="tpick__col tpick__col--wide" data-col="template">
							<div className="tpick__col-head">模板</div>
							{cols.templates.length === 0 ? (
								<div className="tpick__empty">这个类别还没有模板</div>
							) : (
								cols.templates.map((one) => {
									const on = one.name === props.pickedRef;
									return (
										<button
											type="button"
											key={one.name}
											className={`tpick__opt${on ? ' is-picked' : ''}`}
											data-template={one.name}
											onClick={() => {
												/*
												 * 第 3 条：**不关弹层** —— 用户要能继续看说明。
												 * 关闭只走「点面板外面」或再点触发器。
												 */
												props.onPick(one);
											}}
										>
											<span className="tpick__prefix">{one.codePrefix === '' ? '—' : one.codePrefix}</span>
											<span className="tpick__name">{one.displayName}</span>
										</button>
									);
								})
							)}
						</div>
					</div>

					{/* ── 底部说明（常驻在弹层里，因为弹层关掉之后左栏还有一块说明） ── */}
					<div className="tpick__foot" data-picker-foot="">
						{picked === undefined ? (
							<span className="tpick__foot-idle">选一个模板查看说明</span>
						) : (
							<>
								<div className="tpick__foot-title">
									{picked.displayName}
									<span className="tpick__foot-domain">{picked.domain}</span>
								</div>
								<div className="tpick__foot-usage">{picked.usage}</div>
								<div className="tpick__foot-meta">
									<span>
										编号前缀 <b>{picked.codePrefix === '' ? '—' : picked.codePrefix}</b> · 最终编号形如{' '}
										<code>
											{picked.codePrefix === '' ? '（由系统分配）' : `${picked.codePrefix}-01`}
										</code>
									</span>
									<span data-foot-segs={String(picked.sectionCount)}>共 {picked.sectionCount} 段</span>
								</div>
							</>
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}
