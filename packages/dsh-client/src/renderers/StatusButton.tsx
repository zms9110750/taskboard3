/**
 * 状态按钮 —— **独立组件**（#62 / #63）。
 *
 * 用户 `2026-11-28`：
 * > 「表示状态的按钮，没有边框。没有表达出这是个按钮，可以点击和交互。」
 * > 「需要做成独立组件。」
 *
 * ## 它是什么
 *
 * `圆点（StatusDot 的颜色）+ 中文名（STATE_LABELS）+ 边框按钮形态`。
 * 三处调用点（`CardRow` / `DetailHead` / `TreeCard`）复用同一个组件，
 * **不再各自拼圆点和文案**。
 *
 * ## 它不是什么（边界）
 *
 * - **不认识 `kind` / 可转移目标** —— 那是 `buttonsOf(kind, from, 'user')` 的事；
 * - **不发请求、不画菜单** —— 点起来只上报 `onOpen()`，菜单归页面层（`Workspace`）；
 * - **不自己决定词表** —— 文案唯一来源是 `status-button-model.ts`（它读 protocol
 *   的 `STATE_LABELS`）。
 *
 * ## 两种 DOM 形态
 *
 * | `interactive` | 根元素 | 语义 |
 * |---|---|---|
 * | `true`（默认）| `button[type=button]` | 可点，后缀 `▾`，`aria-haspopup="menu"` |
 * | `false` | `span` | **不可点**，`title` + `aria-description` 说明原因 |
 *
 * ⚠ 只读态**不是** `button[disabled]`：`CardRow` / `TreeCard` 的根节点本身
 *   就是 `button`，里面再嵌一个 `button` 是非法 HTML（浏览器会拆标签）。
 *   所以「看起来像按钮 / 点击归外层卡」的场景必须渲染成 `span`。
 *
 * ## `interactive: false` 时 `disabledReason` 必填
 *
 * 用**可辨识联合**而不是可选字段，让「写成只读却忘了说原因」在 `tsc` 就红
 * （`exactOptionalPropertyTypes: true` 下也不能用 `undefined` 绕过去）。
 *
 * DOM 契约（样式 / SSR 断言依赖，别改）：
 *
 * ```text
 * button.status-button.status-button--{sm|md}.status-button--{tone}.is-interactive
 *  ├ span.dot.dot--{tone}
 *  ├ span.status-button__label
 *  └ span.status-button__caret
 *
 * span.status-button...is-static[aria-description]
 *  ├ span.dot.dot--{tone}
 *  └ span.status-button__label
 * ```
 */

import type { ReactNode } from 'react';

import type { TaskState } from '@taskboard/protocol';

import {
	statusButtonModelOf,
	type StatusButtonSize,
} from './status-button-model.ts';
import { StatusDot } from './StatusDot.tsx';

export type { StatusButtonSize } from './status-button-model.ts';

/** 两档尺寸共用的字段。 */
interface StatusButtonCommonProps {
	/** 协议状态全名（调用点用 `taskStateOf()` 从 `Card.status` 收窄）。 */
	readonly status: TaskState;
	/** `sm` = 列表行 / 树节点（默认）；`md` = 详情头。 */
	readonly size?: StatusButtonSize;
	/** 可点时是否画后缀 `▾`；默认 `true`（只读态永远不画）。 */
	readonly showChevron?: boolean;
}

/** 可点态（真按钮）。 */
export interface StatusButtonInteractiveProps extends StatusButtonCommonProps {
	/** 省略或 `true` = 可点。 */
	readonly interactive?: true;
	/** 可点态没有禁用原因（传了是编译错误）。 */
	readonly disabledReason?: never;
	/** 点按钮 —— 页面层负责开菜单 / 定位。 */
	readonly onOpen: () => void;
}

/** 只读态（span，但保留按钮外形）。 */
export interface StatusButtonStaticProps extends StatusButtonCommonProps {
	/** 显式 `false` ⇒ 渲染成 `span`。 */
	readonly interactive: false;
	/** **必填**：`title` + `aria-description` 用同一句话解释为什么不可点。 */
	readonly disabledReason: string;
	/** 只读态没有点击回调（传了是编译错误）。 */
	readonly onOpen?: never;
}

/**
 * 组件属性。
 *
 * 形态与任务书一致（`status` / `size` / `interactive` / `showChevron` /
 * `disabledReason` / `onOpen`），只是把「`interactive: false` 必须有原因」
 * 写进了类型。
 */
export type StatusButtonProps = StatusButtonInteractiveProps | StatusButtonStaticProps;

/**
 * 一个状态按钮。
 *
 * @param props 见 `StatusButtonProps`
 */
export function StatusButton(props: StatusButtonProps): ReactNode {
	const size: StatusButtonSize = props.size ?? 'sm';
	const interactive = props.interactive !== false;
	const model = statusButtonModelOf({
		status: props.status,
		size,
		interactive,
		showChevron: props.showChevron ?? true,
		disabledReason: interactive ? null : props.disabledReason,
	});

	/*
	 * 圆点尺寸：`sm` 沿用列表/树原来的 6px，`md` 用默认 7px。
	 * 颜色由 `StatusDot` 的 `.dot--{tone}` 决定 —— 和边框档位同源。
	 */
	const dot =
		size === 'sm'
			? <StatusDot status={props.status} size={6} label={model.label} />
			: <StatusDot status={props.status} label={model.label} />;

	const body = (
		<>
			{dot}
			<span className="status-button__label">{model.label}</span>
			{model.caret === null ? null : (
				<span className="status-button__caret" aria-hidden="true">
					{model.caret}
				</span>
			)}
		</>
	);

	const hooks = {
		className: model.className,
		'data-status-button': '',
		'data-status': props.status,
		'data-size': size,
		title: model.title,
	};

	if (props.interactive !== false) {
		return (
			<button
				type="button"
				{...hooks}
				data-interactive="true"
				aria-haspopup="menu"
				onClick={props.onOpen}
			>
				{body}
			</button>
		);
	}

	return (
		<span
			{...hooks}
			data-interactive="false"
			{...(model.ariaDescription === null
				? {}
				: { 'aria-description': model.ariaDescription })}
		>
			{body}
		</span>
	);
}
