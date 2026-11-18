/**
 * 模板**三级联选弹层**（领域 → 类别 → 模板）—— 独立组件。
 *
 * ## 用户裁定（`2026-11-19`）
 *
 * > 「和你说的模板选择是分 3 列递进选择还是怎么样。
 * >  **你应该把这些东西的组件演示给我看啊。**
 * >  而且**这个模板选择的点开窗口就应该另外做一个组件了**。」
 *
 * 展厅里 6 个变体，用户选的是 **④ 三级联选弹层**（「用 245」）。
 * 本文件是它在 `src/` 里的产品化版本。
 *
 * ## ⚠ 选完模板**不关**弹层（照抄旧版，已实测源码）
 *
 * 旧版 `taskboard2/packages/browser/public/views/card-create/index.js` 的 `pickTemplate`：
 *
 * ```js
 * panelState.pickedRef = template.name;
 * picker.displayValue.textContent = template.displayName;
 * /* 重画弹层：模板列的 is-picked 高亮 + 底部说明（usage）都要跟着变。 *\/
 * picker.renderPicker();     // ← 重画，不是关闭
 * ```
 *
 * ⇒ **选完只重画**（更新高亮 + 底部说明），关闭只走「点面板外面」或再点触发器。
 *   理由：模板说明要常驻给人看。**别自己改成「选完就关」。**
 *
 * ## 布局
 *
 * ```
 * 触发器 [核心 · 用户任务 ▾]
 *   ↓ 点开
 * ┌─────────┬─────────┬──────────────┐
 * │ 领域    │ 类别    │ 模板          │
 * │ ● 核心  │ G 目标  │ U 用户任务    │
 * │ ○ 代码  │ D 设计  │ F 新增功能    │
 * └─────────┴─────────┴──────────────┘
 * [底部说明：一句话 + 编号前缀 + 段数]
 * ```
 *
 * ## 三处照抄旧版的细节（都是踩过的）
 *
 * | # | 细节 | 原因 |
 * |---|---|---|
 * | 1 | 弹层自己 `stopPropagation()` | 否则点领域列时 document 监听立刻关掉弹层 —— 根本点不到第二列 |
 * | 2 | 关闭用 `composedPath()` 不用 `contains()` | 选中后弹层会重画，被点的按钮脱离文档 ⇒ `contains()` 误判成「点外面」|
 * | 3 | 选模板**不**关弹层 | 见上 |
 *
 * ## ⚠ 弹层用 `position: fixed` + 量触发器坐标，**不是** `absolute`
 *
 * 左栏 `.tb3cc-page__left` 是 `overflow-y: auto` 的滚动容器 —— **滚动容器会裁掉**
 * 任何溢出的子元素。弹层 470px 宽、比 320px 左栏宽，用 `absolute` 的后果实测是：
 *
 * - 第三列被右边界切掉一半（模板名看不全）
 * - 左栏底部冒出一条横向滚动条
 *
 * ⇒ 弹层 `position: fixed` 并用触发器的 `getBoundingClientRect()` 定位：
 *   它脱离了滚动容器，不会被裁，也不产生横向滚动。
 *   代价是要在窗口 `resize` / 任何滚动时重新量（否则弹层会和触发器错位）。
 *
 * ## 组件不请求后端
 *
 * `templates` 由调用方给。`usage` / `sectionCount` 在 `TemplateSummary` 里**没有**
 * （那是 `TemplateMeta`，要 `GET /api/templates?ref=`）—— 调用方补齐就显示，
 * 没补就不显示，**不编**（与 `src/pure/card-view.ts` 同一条判据）。
 *
 * ## ⚠ `dev/components/create/TemplatePickerPopover.tsx` 是**冻结的展厅副本**
 *
 * 那个文件服务 `dev/preview/gallery/` 的变体展厅（历史快照，类名是 `tpick__*`），
 * 和本文件**不共享代码**、也不要同步。**改行为只改这里。**
 * 为什么没删它：gallery 还 import 它，删了 gallery 构建不了、`tsconfig.dev.json` 也红；
 * 而展厅要留着作历史（用户挑变体的记录）。
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
	EMPTY_BROWSE,
	browseAfterClick,
	buildPickerGroups,
	columnsOf,
	defaultKindLabel,
	defaultKindLetter,
	resolveBrowse,
	type BrowseState,
	type PickerTemplate,
} from '../../pure/template-picker.ts';

/** 弹层宽度（px）—— 三列要在 320px 左栏之外还能读。 */
const POP_WIDTH = 470;

/** 弹层相对视口的位置。 */
interface PopSpot {
	readonly left: number;
	readonly top: number;
	/** 向上翻（下方放不下时）。 */
	readonly flipped: boolean;
}

/** 组件属性。 */
export interface TemplatePickerPopoverProps {
	/** 已选模板的 `ref`（`''` = 还没选）。 */
	readonly pickedRef: string;
	/** 「有人选了一个模板」—— **事件**，不是命令。 */
	readonly onPick: (template: PickerTemplate) => void;
	/** 模板清单（调用方给；`GET /api/state` 的 `templates` 可直接用）。 */
	readonly templates: readonly PickerTemplate[];
	/** 类别 id → 中文名（省略 ⇒ 显示英文 id，**不编中文**）。 */
	readonly kindLabelOf?: (kind: string) => string;
	/** 类别 id → 字母（省略 ⇒ id 首字母大写兜底）。 */
	readonly kindLetterOf?: (kind: string) => string;
}

/**
 * 三级联选弹层。
 *
 * @param props 见 `TemplatePickerPopoverProps`
 */
export function TemplatePickerPopover(props: TemplatePickerPopoverProps): ReactNode {
	const { templates } = props;
	const labelOf = props.kindLabelOf ?? defaultKindLabel;
	const letterOf = props.kindLetterOf ?? defaultKindLetter;

	/*
	 * ⚠ `useMemo` 不是性能考虑，是**正确性**：`buildPickerGroups` 每次返回新数组，
	 *   它进了下面 `useEffect` 的依赖 ⇒ 不 memo 的话每次渲染都触发 effect，
	 *   effect 里 `setBrowse` ⇒ 再渲染 ⇒ 无限循环。
	 */
	const groups = useMemo(
		() => buildPickerGroups(templates, labelOf, letterOf),
		[templates, labelOf, letterOf],
	);

	const [open, setOpen] = useState(false);
	const [browse, setBrowse] = useState<BrowseState>(EMPTY_BROWSE);
	const [spot, setSpot] = useState<PopSpot | undefined>(undefined);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const popRef = useRef<HTMLDivElement | null>(null);

	const picked = templates.find((one) => one.ref === props.pickedRef);
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

	/*
	 * 量位置。`useLayoutEffect` 而不是 `useEffect`：要在**绘制之前**定好坐标，
	 * 否则弹层会先出现在 (0,0) 再跳过去（肉眼可见的一帧闪烁）。
	 *
	 * ⚠ 弹层 `position: fixed` ⇒ 任何滚动 / 尺寸变化都要重新量，否则会和触发器错位。
	 */
	useLayoutEffect(() => {
		if (!open) {
			setSpot(undefined);
			return;
		}
		const measure = (): void => {
			const trigger = triggerRef.current;
			if (trigger === null) return;
			const rect = trigger.getBoundingClientRect();
			const popH = popRef.current?.offsetHeight ?? 260;
			const below = rect.bottom + 4;
			const flipped = below + popH > window.innerHeight - 8 && rect.top - popH - 4 > 8;
			/* 左边对齐触发器；右边超出视口时往左推回来。 */
			const left = Math.max(8, Math.min(rect.left, window.innerWidth - POP_WIDTH - 8));
			setSpot({ left, top: flipped ? rect.top - popH - 4 : below, flipped });
		};
		measure();
		window.addEventListener('resize', measure);
		window.addEventListener('scroll', measure, true);
		return () => {
			window.removeEventListener('resize', measure);
			window.removeEventListener('scroll', measure, true);
		};
	}, [open]);

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

	const display =
		picked === undefined ? '选择一个模板' : `${picked.domain} · ${picked.displayName}`;

	return (
		<div className="tb3cc-tpick" ref={rootRef}>
			{/* 触发器 —— 和普通下拉长得像，但点开是弹层 */}
			<button
				ref={triggerRef}
				type="button"
				className={`tb3cc-tpick__trigger${picked === undefined ? ' is-empty' : ''}${open ? ' is-open' : ''}`}
				data-picker-trigger=""
				aria-expanded={open}
				onClick={() => {
					setOpen((one) => !one);
				}}
			>
				<span className="tb3cc-tpick__value">{display}</span>
				<span className="tb3cc-tpick__caret">⌄</span>
			</button>

			{open ? (
				<div
					ref={popRef}
					className={`tb3cc-tpick__pop${spot?.flipped === true ? ' is-flipped' : ''}`}
					data-picker-pop=""
					style={{
						left: spot === undefined ? 0 : spot.left,
						top: spot === undefined ? 0 : spot.top,
						/* 第一帧还没量完 ⇒ 先藏起来，避免从 (0,0) 跳过去。 */
						visibility: spot === undefined ? 'hidden' : 'visible',
					}}
					/* 第 1 条：吞掉冒泡，否则点第一列就把自己关了。 */
					onClick={(event) => {
						event.stopPropagation();
					}}
				>
					<div className="tb3cc-tpick__cols">
						{/* ── 第 1 列：领域 ── */}
						<div className="tb3cc-tpick__col" data-col="domain">
							<div className="tb3cc-tpick__col-head">领域</div>
							{cols.domains.map((group) => {
								const on = group.domain === browse.domain;
								return (
									<button
										type="button"
										key={group.domain}
										className={`tb3cc-tpick__opt${on ? ' is-picked' : ''}`}
										data-domain={group.domain}
										onClick={() => {
											setBrowse((current) =>
												browseAfterClick(groups, current, 'domain', group.domain),
											);
										}}
									>
										<span className="tb3cc-tpick__radio">{on ? '●' : '○'}</span>
										<span className="tb3cc-tpick__name">{group.domain}</span>
									</button>
								);
							})}
						</div>

						{/* ── 第 2 列：类别（前面是**字母**不是圆圈） ── */}
						<div className="tb3cc-tpick__col" data-col="kind">
							<div className="tb3cc-tpick__col-head">类别</div>
							{cols.kinds.map((one) => {
								const on = one.kind === browse.kind;
								return (
									<button
										type="button"
										key={one.kind}
										className={`tb3cc-tpick__opt${on ? ' is-picked' : ''}`}
										data-kind={one.kind}
										onClick={() => {
											setBrowse((current) =>
												browseAfterClick(groups, current, 'kind', one.kind),
											);
										}}
									>
										<span className="tb3cc-tpick__prefix">{one.letter}</span>
										<span className="tb3cc-tpick__name">{one.label}</span>
									</button>
								);
							})}
						</div>

						{/* ── 第 3 列：模板（编号前缀字母 + 名字） ── */}
						<div className="tb3cc-tpick__col tb3cc-tpick__col--wide" data-col="template">
							<div className="tb3cc-tpick__col-head">模板</div>
							{cols.templates.length === 0 ? (
								<div className="tb3cc-tpick__empty">这个类别还没有模板</div>
							) : (
								cols.templates.map((one) => {
									const on = one.ref === props.pickedRef;
									return (
										<button
											type="button"
											key={one.ref}
											className={`tb3cc-tpick__opt${on ? ' is-picked' : ''}`}
											data-template={one.ref}
											onClick={() => {
												/*
												 * 第 3 条：**不关弹层** —— 用户要能继续看说明。
												 * 关闭只走「点面板外面」或再点触发器。
												 */
												props.onPick(one);
											}}
										>
											<span className="tb3cc-tpick__prefix">
												{one.codePrefix === undefined || one.codePrefix === '' ? '—' : one.codePrefix}
											</span>
											<span className="tb3cc-tpick__name">{one.displayName}</span>
										</button>
									);
								})
							)}
						</div>
					</div>

					{/* ── 底部说明（弹层里常驻；左栏那块说明是另一个组件） ── */}
					<div className="tb3cc-tpick__foot" data-picker-foot="">
						{picked === undefined ? (
							<span className="tb3cc-tpick__foot-idle">选一个模板查看说明</span>
						) : (
							<>
								<div className="tb3cc-tpick__foot-title">
									{picked.displayName}
									<span className="tb3cc-tpick__foot-domain">{picked.domain}</span>
								</div>
								{picked.usage === undefined ? null : (
									<div className="tb3cc-tpick__foot-usage">{picked.usage}</div>
								)}
								<div className="tb3cc-tpick__foot-meta">
									<span>
										编号前缀{' '}
										<b>
											{picked.codePrefix === undefined || picked.codePrefix === ''
												? '—'
												: picked.codePrefix}
										</b>
										{picked.codePrefix === undefined || picked.codePrefix === '' ? (
											' · 由系统分配'
										) : (
											<>
												{' · 最终编号形如 '}
												<code>{`${picked.codePrefix}-01`}</code>
											</>
										)}
									</span>
									{picked.sectionCount === undefined ? null : (
										<span data-foot-segs={String(picked.sectionCount)}>
											共 {picked.sectionCount} 段
										</span>
									)}
								</div>
							</>
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}
