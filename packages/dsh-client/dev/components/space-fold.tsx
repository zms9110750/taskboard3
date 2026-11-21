/**
 * 空间选择器的**折叠隐藏栏**候选 —— 用户 2026-11-21：
 *
 * > 「工作空间点开以后应该是打开折叠的隐藏栏，而不是悬浮窗。」
 *
 * 现状（`src/renderers/workspace/SpacePicker.tsx`）点开是一个
 * `position:absolute` 的**悬浮窗**（`.tb3w-space-pop`，`right:0`，`min-width:560px`）。
 *
 * ⇒ 这里做三个**独立候选**，都是「展开一块区域、推挤下面的内容」，
 *   区别只在**展开区放在哪、长什么样**。
 *
 * 三个候选共用同一份数据形状（`SpaceFoldProps`），只差渲染位置。
 * 选完之后把中选的那个 `mv` 回 `src/renderers/workspace/` 替换 `SpacePicker`。
 *
 * ```
 * node dev/preview/build.mjs space-fold
 * ```
 */

import { useState } from 'react';

import { SpaceBar, type SpaceBarProps } from '../../src/renderers/SpaceBar.tsx';

/** 三个候选共用的 props —— 就是 `SpaceBar` 那份，等于「空间 chips 数据 + 回调」。 */
export type SpaceFoldProps = SpaceBarProps;

/* ══════════════════════════════════════════════════════════
   共用：开关按钮
   ══════════════════════════════════════════════════════════ */

/**
 * 「工作空间 ▾ / ▴」按钮。
 *
 * @param props open / count / currentName / onToggle
 */
function FoldToggle(props: {
	readonly open: boolean;
	readonly currentName: string;
	readonly onToggle: () => void;
}): React.ReactNode {
	return (
		<button
			type="button"
			className={props.open ? 'ghost-btn tb3w-space-toggle is-open' : 'ghost-btn tb3w-space-toggle'}
			data-fold-toggle
			aria-expanded={props.open}
			onClick={props.onToggle}
		>
			工作空间 · {props.currentName}
			<span className="tb3w-space-toggle__caret">{props.open ? '▴' : '▾'}</span>
		</button>
	);
}

/** 模拟工具栏 —— 让候选在预览里长得像真实上下文。 */
function FakeToolbar(props: { readonly children?: React.ReactNode }): React.ReactNode {
	return (
		<div className="sf-toolbar">
			<span className="sf-toolbar__title">
				任务 <span className="sf-toolbar__count">共 12 条</span>
			</span>
			<span className="sf-toolbar__actions">
				{props.children}
				<span className="sf-seg">
					<button type="button" className="sf-seg__btn is-on">
						科技树
					</button>
					<button type="button" className="sf-seg__btn">列表</button>
				</span>
				<button type="button" className="sf-btn-primary">新建</button>
			</span>
		</div>
	);
}

/** 模拟筛选行 —— 证明「展开后下面的内容被推下去」。 */
function FakeFilters(): React.ReactNode {
	return (
		<div className="sf-filters">
			<button type="button" className="sf-pill">状态</button>
			<button type="button" className="sf-pill">类别：设计</button>
			<button type="button" className="sf-pill">领域</button>
			<button type="button" className="sf-pill">用户未读 1</button>
			<button type="button" className="sf-pill">AI 未读 1</button>
		</div>
	);
}

/** 模拟列表 —— 证明推挤。 */
function FakeList(): React.ReactNode {
	return (
		<div className="sf-list">
			<div className="sf-card">C-03 · 详情面板：关系按钮要显眼</div>
			<div className="sf-card">Q-07 · 窄 tab 里列表和详情怎么分？</div>
			<div className="sf-card">R-12 · 窄版两栏比例要不要做成可拖的</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   候选 A：工具栏下方 **整行** 展开
   ══════════════════════════════════════════════════════════ */

/**
 * 候选 A —— 展开区在工具栏**下一行**，占满宽度，推挤筛选行。
 *
 * 形态：
 * ```
 * [任务 12条] [工作空间 ▾] [科技树 列表] [新建]
 * [空间1] [空间2] [空间3] [+新建] [显示归档]
 * [状态] [类别] [领域] ...
 * ```
 */
export function SpaceFoldA(props: SpaceFoldProps): React.ReactNode {
	const [open, setOpen] = useState(true);
	const current = props.workspaces.find((one) => one.id === props.viewingId);

	return (
		<div className="sf-root" data-candidate="A">
			<FakeToolbar>
				<FoldToggle
					open={open}
					currentName={current?.displayName ?? '—'}
					onToggle={() => {
						setOpen((now) => !now);
					}}
				/>
			</FakeToolbar>

			{open ? (
				<div className="sf-fold sf-fold--row" data-fold-body>
					<SpaceBar {...props} />
				</div>
			) : null}

			<FakeFilters />
			<FakeList />
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   候选 B：工具栏**内联** 展开（工具栏变高）
   ══════════════════════════════════════════════════════════ */

/**
 * 候选 B —— 展开区**插进工具栏内部**，工具栏自然变高（wrap 换行）。
 *
 * 形态：
 * ```
 * [任务 12条] [空间1] [空间2] [空间3] [+新建] [显示归档]
 * [工作空间 ▴] [科技树 列表] [新建]
 * [状态] [类别] [领域] ...
 * ```
 */
export function SpaceFoldB(props: SpaceFoldProps): React.ReactNode {
	const [open, setOpen] = useState(true);
	const current = props.workspaces.find((one) => one.id === props.viewingId);

	return (
		<div className="sf-root" data-candidate="B">
			<div className="sf-toolbar sf-toolbar--wrap">
				{open ? (
					<div className="sf-fold sf-fold--inline" data-fold-body>
						<SpaceBar {...props} />
					</div>
				) : null}
				<span className="sf-toolbar__title">
					任务 <span className="sf-toolbar__count">共 12 条</span>
				</span>
				<span className="sf-toolbar__actions">
					<FoldToggle
						open={open}
						currentName={current?.displayName ?? '—'}
						onToggle={() => {
							setOpen((now) => !now);
						}}
					/>
					<span className="sf-seg">
						<button type="button" className="sf-seg__btn is-on">
							科技树
						</button>
						<button type="button" className="sf-seg__btn">列表</button>
					</span>
					<button type="button" className="sf-btn-primary">新建</button>
				</span>
			</div>

			<FakeFilters />
			<FakeList />
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   候选 C：全宽面板（带标题条 + 收起按钮）
   ══════════════════════════════════════════════════════════ */

/**
 * 候选 C —— 展开区是一个**带标题条的全宽面板**，推到工具栏下面；
 * 面板头上有「工作空间」标题 + 收起按钮，视觉上更像「展开了一层」。
 *
 * 形态：
 * ```
 * [任务 12条] [工作空间 ▾] [科技树 列表] [新建]
 * ┌ 工作空间 ──────────────────────── [收起 ▴] ┐
 * │ [空间1] [空间2] [空间3] [+新建] [显示归档] │
 * └─────────────────────────────────────────────┘
 * [状态] [类别] [领域] ...
 * ```
 */
export function SpaceFoldC(props: SpaceFoldProps): React.ReactNode {
	const [open, setOpen] = useState(true);
	const current = props.workspaces.find((one) => one.id === props.viewingId);

	return (
		<div className="sf-root" data-candidate="C">
			<FakeToolbar>
				<FoldToggle
					open={open}
					currentName={current?.displayName ?? '—'}
					onToggle={() => {
						setOpen((now) => !now);
					}}
				/>
			</FakeToolbar>

			{open ? (
				<div className="sf-fold sf-fold--panel" data-fold-body>
					<div className="sf-fold__head">
						<span className="sf-fold__label">工作空间</span>
						<button
							type="button"
							className="sf-fold__close"
							onClick={() => {
								setOpen(false);
							}}
						>
							收起 ▴
						</button>
					</div>
					<div className="sf-fold__body">
						<SpaceBar {...props} />
					</div>
				</div>
			) : null}

			<FakeFilters />
			<FakeList />
		</div>
	);
}
