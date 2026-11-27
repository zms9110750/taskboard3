/**
 * 权限面板 —— **两条正交轴的档位选择器**（V2）。
 *
 * ## 它是什么 / 不是什么
 *
 * - **两条轴**，各 3 档：UI 轴 `cardActionLevel`（no-claim / claim / adopt）、
 *   宿主轴 `toolGuardLevel`（off / manage / manage-edit）。依据是
 *   `docs/权限两轴.md`（用户 `2026-11-19` 定稿）。
 * - ⚠ **不是**设计图 `X:\temp\view-2-permission.png` 里的「权限模式 4 选 1」——
 *   那张图画的是被用户否掉的旧模型。旧模型里的「工作空间页」「模板策略页」
 *   本次也不做。图和文档冲突时以文档为准，见预览页 ⑤ 的清单。
 * - **受控**：数据全部从 `state` prop 来，点击只上报 `onSelect(axis, value)`；
 *   组件不 `useState`、不 `fetch`、不认识 URL。
 * - **零依赖**：图标 / 转圈都是 inline SVG，不引图标库。
 * - **文案不硬编码**：每个档位的 `label` / `description` 都来自 `state.snapshot`
 *   里的 options 数组（服务端从 core 的选项表带来）。
 *
 * ## 布局（从上到下）
 *
 * ```
 * ┌ 任务板权限 ─────────────────────────────────────────┐
 * │ 一句话说明（两条轴、即时保存）                        │
 * │                                                     │
 * │ [保存失败横幅]（可选，role=alert）                    │
 * │                                                     │
 * │ ┌ ① 卡片动作档位              当前：允许领卡 ┐        │
 * │ │  AI 能不能领卡 / 采纳草稿…                  │        │
 * │ │  ○ 不允许领卡                               │        │
 * │ │    AI 不能领取工作卡，也不能采纳草稿。        │        │
 * │ │  ● 允许领卡                    [当前]       │        │
 * │ │    AI 可以领取工作卡；草稿仍由用户自己点采纳。 │        │
 * │ │  ○ 允许采纳草稿                             │        │
 * │ └────────────────────────────────────────────┘        │
 * │ ┌ ② 工具管控档位              当前：任务板不管理 ┐     │
 * │ │  …（同样三档）                               │        │
 * │ └────────────────────────────────────────────┘        │
 * │ 正交说明（两条轴互不覆盖，3 × 3 种结果）              │
 * └─────────────────────────────────────────────────────┘
 * ```
 *
 * ## 三个交互判决在 `pure/permission-view.ts`，组件只做渲染
 *
 * | 问题 | 组件怎么用 |
 * |---|---|
 * | 某档是「当前 / 保存中 / 不可点」 | `optionViewOf()` 返回三个布尔，直接挂 class / attr |
 * | 点了要不要发请求 | `shouldSaveOnSelect()` —— 只由它决定要不要调 `onSelect` |
 * | 保存中 / 失败怎么画 | `state.phase` + `state.pending` + `state.saveError` |
 *
 * ⇒ 组件里没有「同一档别再发一次」「保存中锁哪条轴」这类判断（都在纯函数里，
 *   有 `test/permission-view.test.ts` 钉住）。
 *
 * ## 为什么用原生 `radio` 而不是按钮
 *
 * 原生 radio 自带键盘（Tab + 方向键）、读屏语义和「组内只能选一个」的约束，
 * 零 JS。视觉上的圆点在 CSS 里画（`.tb3perm__mark`），input 本身透明覆盖整行 ——
 * 点击热区 = 整行（`label` 包裹），而不是那个 14px 的小圆。
 */

import type { ReactNode } from 'react';

import {
	axisLevelOf,
	axisOptionsOf,
	axisPendingOf,
	levelLabelOf,
	optionViewOf,
	shouldSaveOnSelect,
} from '../pure/permission-view.ts';
import type {
	AxisKey,
	PanelState,
	PermissionOption,
	ReadyState,
	SaveFailure,
} from '../pure/permission-view.ts';

/* ────────────────────────── 两条轴的静态描述 ────────────────────────── */

/** 一条轴的标题 / 说明（只是面板上的标签；档位文案不在这里）。 */
interface AxisMeta {
	readonly key: AxisKey;
	/** 轴编号（视觉决策：① / ②）。 */
	readonly no: string;
	readonly title: string;
	readonly hint: string;
}

/**
 * 两条轴。用 `satisfies` 而不是类型标注 —— 少一个 `key` / 拼错 `AxisKey`
 * 会直接编译失败（AGENTS 3.7：类型标注会把字面量 widen，检查静默失效）。
 *
 * ⚠ 这里**不写**任何档位文案（那是接口的 options 的职责）。
 */
const AXES = [
	{
		key: 'card',
		no: '①',
		title: '卡片动作档位',
		hint: 'AI 能不能领取工作卡、能不能自己采纳草稿。这一轴任何宿主都生效（MCP 也管它）。',
	},
	{
		key: 'tool',
		no: '②',
		title: '工具管控档位',
		hint: '任务板要不要按档位拦工具调用。只有能拦工具的宿主（如 DSH）才有这一轴。',
	},
] as const satisfies readonly AxisMeta[];

/* ────────────────────────── 小图标 ────────────────────────── */

/** 警示三角（保存失败 / 加载失败共用）。inline SVG，颜色跟随文字色。 */
function WarningIcon(): ReactNode {
	return (
		<svg
			className="tb3perm__alert-icon"
			data-alert-icon="1"
			width="13"
			height="13"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M12 3 2.5 20h19L12 3z" />
			<path d="M12 9v5" strokeLinecap="round" />
			<circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
		</svg>
	);
}

/** 保存中的转圈。旋转动画在 CSS（`.tb3perm__spinner`）。 */
function Spinner(): ReactNode {
	return (
		<svg
			className="tb3perm__spinner"
			data-spinner="1"
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={3} />
			<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
		</svg>
	);
}

/* ────────────────────────── 子视图 ────────────────────────── */

/** 加载中：两条轴的骨架（每条 1 行标题 + 3 行选项）。 */
function LoadingView(props: { readonly axes: readonly AxisMeta[] }): ReactNode {
	return (
		<div className="tb3perm__loading" data-loading="1" aria-busy="true" aria-label="正在加载权限设置">
			{props.axes.map((meta) => (
				<div className="tb3perm__skeleton" key={meta.key} data-skeleton={meta.key}>
					<div className="tb3perm__sk-line tb3perm__sk-line--title" />
					<div className="tb3perm__sk-line" data-skeleton-row="1" />
					<div className="tb3perm__sk-line" data-skeleton-row="1" />
					<div className="tb3perm__sk-line" data-skeleton-row="1" />
				</div>
			))}
		</div>
	);
}

/** 加载失败：说清哪一步失败 + 重试按钮。 */
function LoadErrorView(props: {
	readonly message: string;
	readonly onRetry: () => void;
}): ReactNode {
	return (
		<div className="tb3perm__load-error" data-load-error="1" role="alert">
			<div className="tb3perm__load-error-head">
				<WarningIcon />
				<span className="tb3perm__load-error-title">权限设置加载失败</span>
			</div>
			<p className="tb3perm__load-error-msg" data-load-error-message="1">
				{props.message}
			</p>
			<button type="button" className="tb3perm__retry" data-retry="1" onClick={props.onRetry}>
				重试
			</button>
		</div>
	);
}

/** 保存失败横幅（回滚已经由 pure 的 `failSave()` 做完，这里只显示）。 */
function SaveErrorView(props: {
	readonly failure: SaveFailure;
	readonly onDismiss: (() => void) | undefined;
}): ReactNode {
	return (
		<div
			className="tb3perm__alert"
			data-save-error="1"
			data-save-error-axis={props.failure.axis}
			data-rolled-back={props.failure.rolledBackTo}
			role="alert"
		>
			<WarningIcon />
			<span className="tb3perm__alert-msg" data-save-error-message="1">
				{props.failure.message}
			</span>
			{props.onDismiss === undefined ? null : (
				<button
					type="button"
					className="tb3perm__alert-close"
					data-dismiss-error="1"
					title="关闭提示"
					aria-label="关闭提示"
					onClick={props.onDismiss}
				>
					×
				</button>
			)}
		</div>
	);
}

/** 一个档位行。 */
function OptionRow(props: {
	readonly axis: AxisKey;
	readonly option: PermissionOption;
	readonly state: ReadyState;
	readonly onSelect: (axis: AxisKey, value: string) => void;
}): ReactNode {
	const { axis, option, state } = props;
	const view = optionViewOf(state, axis, option.value);

	const cls = ['tb3perm__opt'];
	if (view.selected) cls.push('is-selected');
	if (view.saving) cls.push('is-busy');
	/* 「不可点」和「正在保存」在视觉上是两件事：前者要淡，后者要显眼。 */
	if (view.disabled && !view.saving) cls.push('is-disabled');

	return (
		<label
			className={cls.join(' ')}
			data-option-axis={axis}
			data-option-value={option.value}
			data-selected={String(view.selected)}
			data-saving={String(view.saving)}
			data-disabled={String(view.disabled)}
		>
			{/*
			 * 原生 radio 只提供语义 / 键盘，透明覆盖整行 ⇒ 点击热区是整行。
			 * 视觉圆点在后面的 `.tb3perm__mark`（CSS 画）。
			 */}
			<input
				className="tb3perm__opt-input"
				data-option-radio="1"
				type="radio"
				name={`tb3perm-${axis}`}
				value={option.value}
				checked={view.selected}
				disabled={view.disabled}
				onChange={() => {
					/*
					 * 唯一的「要不要发请求」判据在 pure 里：同值不重发、本轴保存中不重发、
					 * 非法值不发。组件不判第二次。
					 */
					if (!shouldSaveOnSelect(state, axis, option.value)) return;
					props.onSelect(axis, option.value);
				}}
			/>

			<span className="tb3perm__mark" aria-hidden="true" />

			<span className="tb3perm__body">
				<span className="tb3perm__label-row">
					<span className="tb3perm__label">{option.label}</span>
					{view.selected && !view.saving ? (
						<span className="tb3perm__badge-current" data-current-badge="1">
							当前
						</span>
					) : null}
				</span>
				<span className="tb3perm__desc" data-option-desc="1">
					{option.description}
				</span>
			</span>

			{view.saving ? (
				<span className="tb3perm__pending" data-saving-label="1">
					<Spinner />
					保存中…
				</span>
			) : null}
		</label>
	);
}

/** 一条轴：标题 + 当前档位 + 三个单选行。 */
function AxisBlock(props: {
	readonly meta: AxisMeta;
	readonly state: ReadyState;
	readonly onSelect: (axis: AxisKey, value: string) => void;
}): ReactNode {
	const { meta, state } = props;
	const options = axisOptionsOf(state.snapshot, meta.key);
	const pending = axisPendingOf(state, meta.key);

	return (
		<div
			className="tb3perm__axis"
			data-axis={meta.key}
			data-axis-current={axisLevelOf(state.snapshot, meta.key)}
			data-axis-pending={String(pending)}
			aria-busy={pending}
		>
			<div className="tb3perm__axis-head">
				<span className="tb3perm__axis-title">
					<span className="tb3perm__axis-no" aria-hidden="true">
						{meta.no}
					</span>
					{meta.title}
				</span>
				<span className="tb3perm__axis-current" data-axis-current-label="1">
					当前：<b>{levelLabelOf(state.snapshot, meta.key)}</b>
				</span>
			</div>

			<p className="tb3perm__axis-hint">{meta.hint}</p>

			<div className="tb3perm__opts" role="radiogroup" aria-label={meta.title}>
				{options.map((option) => (
					<OptionRow
						key={option.value}
						axis={meta.key}
						option={option}
						state={state}
						onSelect={props.onSelect}
					/>
				))}
			</div>
		</div>
	);
}

/* ────────────────────────── 组件 ────────────────────────── */

/** 组件属性。 */
export interface PermissionPanelProps {
	/** 面板状态（受控：加载中 / 加载失败 / 已加载 + pending + saveError）。 */
	readonly state: PanelState;
	/** 点某一档（**只有** `shouldSaveOnSelect()` 为真时组件才会调它）。 */
	readonly onSelect: (axis: AxisKey, value: string) => void;
	/** 加载失败时点「重试」。 */
	readonly onRetry: () => void;
	/** 点保存失败横幅的 ×。省略时横幅不画关闭按钮。 */
	readonly onDismissSaveError?: () => void;
	/**
	 * 要显示哪几条轴 —— **省略 = 两轴都显示**。
	 *
	 * 用户 2026-11-22：
	 * > 「工具管控档位是做在 dsh 里面的，做在 agent 里面。因为这个权限的用途是拦截 agent 的工具。
	 * >   他得在 agent 里面才能拦截和交互。所以 ui 不放这个。」
	 *
	 * ⇒ UI 面板传 `['card']`，agent 侧面板传 `['tool']`（或两轴都给）。
	 */
	readonly axes?: readonly AxisKey[];
}

/**
 * 任务板权限面板。
 *
 * @param props 见 `PermissionPanelProps`
 */
export function PermissionPanel(props: PermissionPanelProps): ReactNode {
	const state = props.state;
	/* 只画调用方要的那几条轴（省略 = 两轴都画）。 */
	const visibleAxes = props.axes === undefined ? AXES : AXES.filter((meta) => props.axes?.includes(meta.key));
	/*
	 * 单轴时的那一条轴 —— `noUncheckedIndexedAccess` 下 `visibleAxes[0]` 是
	 * `AxisMeta | undefined`，所以先收成显式的 `undefined`，不要在 JSX 里裸取下标。
	 */
	const onlyAxis: AxisMeta | undefined = visibleAxes.length === 1 ? visibleAxes[0] : undefined;

	return (
		<section className="tb3perm" data-panel="permission" data-phase={state.phase} aria-label="任务板权限">
			<header className="tb3perm__head">
				<h2 className="tb3perm__title">任务板权限</h2>
				<p className="tb3perm__intro">
					{onlyAxis === undefined
						? '两条互相独立的轴，各选一档。点哪一档就立刻保存，没有「保存」按钮。'
						: '选一档，点哪一档就立刻保存，没有「保存」按钮。'}
				</p>
			</header>

			{state.phase === 'loading' ? <LoadingView axes={visibleAxes} /> : null}

			{state.phase === 'load-error' ? (
				<LoadErrorView message={state.message} onRetry={props.onRetry} />
			) : null}

			{state.phase === 'ready' ? (
				<>
					{state.saveError === null ? null : (
						<SaveErrorView
							failure={state.saveError}
							onDismiss={props.onDismissSaveError}
						/>
					)}

					{visibleAxes.map((meta) => (
						<AxisBlock key={meta.key} meta={meta} state={state} onSelect={props.onSelect} />
					))}

					{/*
					 * 页脚**只在两轴同屏时需要**：它的内容是「两条轴互不覆盖」。
					 *
					 * ⚠ 单轴时**不渲染页脚**。这里曾经写死 card 轴的说明
					 *   （「这一档管 AI 能不能领工作卡 / 采纳草稿」）—— card 轴搬去任务板
					 *   工具栏之后，它变成「描述一个本页已经不管的东西」的残留
					 *   （用户 2026-11-23 截图里直接看到）。
					 *   改成读单轴 hint 也会**和轴头那句重复**（实测：同一句话出现两次）。
					 *   ⇒ 直接不画：轴头的 hint 已经说清这条轴是什么。
					 */}
					{onlyAxis === undefined ? (
						<footer className="tb3perm__foot" data-foot="1">
							<div>
								两条轴互不覆盖：<b>卡片动作档位</b>管「AI 能不能领卡 / 采纳草稿」，
								<b>工具管控档位</b>管「任务板要不要拦工具调用」。任意组合都有效（3 × 3 = 9 种结果）。
							</div>
							<div className="tb3perm__foot-sub">
								宿主把工具管控关掉时，领卡仍然受卡片动作档位管 —— 两条轴分开判定，谁都不替代谁。
							</div>
						</footer>
					) : null}
				</>
			) : null}
		</section>
	);
}
