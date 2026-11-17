/**
 * 状态胶囊 —— **圆点 + 状态中文名 + caret，可点**。
 *
 * 旧版 `views/card-detail/header.js:32-49`：一个 `<button class="status-pill">`，
 * 里面三段 `dot` / 状态名 / `status-pill__caret`（`⌄`）。
 *
 * ## 这个组件很薄，是**故意的**
 *
 * 它只画三样东西，判决全在别处：
 *
 * | 哪来的 | 谁判的 |
 * |---|---|
 * | 状态中文名 | `pure/card-view.ts` 的 `stateLabel()`（未知状态回落协议名，不编中文）|
 * | 圆点颜色 | `pure/card-view.ts` 的 `stateTone()` → `.dot--*` 类（组件不写颜色值）|
 * | caret 字符 | `pure/status-menu.ts` 的 `PILL_CARET`（与菜单同一处词表）|
 *
 * ## ⚠ 它**不**判断「能不能点」
 *
 * 旧版这里有个 `disabled`（已删除的卡）和 `event.stopPropagation()`。
 * v3 的 `disabled` 不是状态胶囊的语义 —— 卡能不能改状态由 core / 按钮表决定，
 * 组件不该再看 `card.deleted` 判一次（AGENTS.md 规则 3：UI 不判 status）。
 * ⇒ 调用方要么不给 `onClick`（渲染成不可点的 `<span>`），要么给一个能处理拒绝的回调。
 *   把「能不能点」写进类型：**没有 `onClick` 就没有 `button`**。
 */

import type { ReactNode } from 'react';

import { stateLabel, stateTone } from '../pure/card-view.ts';
import { PILL_CARET } from '../pure/status-menu.ts';

/** 组件属性。 */
export interface StatusPillProps {
	/** A2A 状态全名。 */
	readonly status: string;
	/** 点它。**不给就不渲染成按钮**（不可点）。 */
	readonly onClick?: () => void;
	/** 菜单是不是开着（画 caret 的方向 + `aria-expanded`）。 */
	readonly open?: boolean;
}

/**
 * 状态胶囊。
 *
 * @param props 见 `StatusPillProps`
 */
export function StatusPill(props: StatusPillProps): ReactNode {
	const label = stateLabel(props.status);
	const tone = stateTone(props.status);
	const open = props.open === true;

	/* caret 方向：关着 `⌄`、开着 `⌃`（同一个字符表，只换方向）。 */
	const caret = open ? '⌃' : PILL_CARET;

	const body = (
		<>
			<span className={`dot dot--${tone}`} />
			<span className="status-pill__label">{label}</span>
			<span className="status-pill__caret" aria-hidden="true">
				{caret}
			</span>
		</>
	);

	/*
	 * ⚠ 两个分支必须分开写：`exactOptionalPropertyTypes: true` 下
	 *   `onClick={props.onClick}` 里可能是 `undefined`，而 `button` 的
	 *   `onClick` 不接受 `undefined` 作为「有值但为空」。
	 *   更重要的是语义：**没有回调 = 不可点**，那不是「空回调」。
	 */
	if (props.onClick === undefined) {
		return (
			<span className="status-pill is-static" data-status={props.status} data-pill-open="false">
				{body}
			</span>
		);
	}

	return (
		<button
			type="button"
			className="status-pill"
			data-status={props.status}
			data-pill-open={String(open)}
			aria-haspopup="menu"
			aria-expanded={open}
			title={`变更状态（当前：${label}）`}
			onClick={props.onClick}
		>
			{body}
		</button>
	);
}
