/**
 * `StatusButton` 的**渲染模型** —— 纯函数，零 React、零 DOM。
 *
 * ## 为什么单独一层（和 `fold-pill-model.ts` 同一个理由）
 *
 * `node --test` 不能 import `.tsx`（Node 的类型剥离不处理 JSX），但
 * 「两档尺寸的 class 必须稳定」「`interactive: false` 必须是 span 且带
 * `aria-description`」这些是**要单测钉住的行为**。
 * ⇒ 判决收在这里，`.tsx` 只做「模型 → DOM 元素」的机械映射。
 *
 * ## 文案的唯一来源
 *
 * `statusButtonLabel()` 直接读 `@taskboard/protocol` 的 `STATE_LABELS`，
 * **不复制词表**（`stateLabel()` 是同一个表的兜底包装，见 `pure/card-view.ts`）。
 * 改 protocol 的中文名，按钮跟着变 —— `test/status-button.test.ts` 用
 * 「等于 `STATE_LABELS[state]`」而不是字面量来钉这一条。
 *
 * ## 为什么 `status` 是 `TaskState` 而不是 `string`
 *
 * `STATE_LABELS` 是 `Record<TaskState, string>`，只有收窄成协议状态才能
 * 直接索引、且**加一个新状态时 `STATE_LABELS` 会逼着补词**。
 * 卡上的 `Card.status` 类型是 `string`（容忍脏数据），所以调用点用
 * `taskStateOf()` 收窄（未知值回落 `UNSPECIFIED`，见该函数注释）。
 */

import { STATE_LABELS, TaskState, isTaskState } from '@taskboard/protocol';

import { stateTone, type StateTone } from '../pure/card-view.ts';

/** 两档尺寸：列表行 / 树节点（`sm`）、详情头（`md`）。 */
export type StatusButtonSize = 'sm' | 'md';

/** 可点按钮后缀的三角（用户 2026-11-28：「要表达出这是个按钮」）。 */
export const STATUS_BUTTON_CARET = '▾';

/** 模型输入。 */
export interface StatusButtonModelInput {
	/** 协议状态全名。 */
	readonly status: TaskState;
	/** 尺寸档。 */
	readonly size: StatusButtonSize;
	/** `true` ⇒ 可点的 button；`false` ⇒ 只读的 span。 */
	readonly interactive: boolean;
	/** 可点时是否画后缀三角（只读态永远不画）。 */
	readonly showChevron: boolean;
	/** 只读态的原因（`title` + `aria-description`）；可点态传 `null`。 */
	readonly disabledReason: string | null;
}

/** 模型输出 —— `.tsx` 只按这些字段产 DOM。 */
export interface StatusButtonModel {
	/** `button` = 可点；`span` = 不可点（**不是** disabled button）。 */
	readonly tag: 'button' | 'span';
	/** 完整 class（基类 + 尺寸 + 状态档 + 交互态）。 */
	readonly className: string;
	/** 文案（来自 `STATE_LABELS`）。 */
	readonly label: string;
	/** 状态视觉档位（颜色写在同一档位的 CSS 类里）。 */
	readonly tone: StateTone;
	/** 后缀三角；`null` = 不画。 */
	readonly caret: string | null;
	/** `title`。 */
	readonly title: string;
	/** `aria-description`；`null` = 不写这个属性。 */
	readonly ariaDescription: string | null;
}

/**
 * 状态 → 中文名 —— **唯一来源是 protocol 的 `STATE_LABELS`**。
 *
 * @param status 协议状态全名
 */
export function statusButtonLabel(status: TaskState): string {
	return STATE_LABELS[status];
}

/**
 * 卡上的状态串 → 协议状态。
 *
 * `Card.status` 的类型是 `string`（A2A 全名，容忍历史脏数据），
 * `StatusButton` 只接受 `TaskState`（见文件头）。**未知值回落 `UNSPECIFIED`**：
 * 按钮至少要有一个确定的颜色，不能因为一条脏数据画出「没有档位」的壳。
 *
 * ⚠ 这里**不改文案函数的兜底**：`pure/card-view.ts` 的 `stateLabel()` 对未知值
 *   仍然返回去掉前缀的原文（那是给「只显示文字」的场景用的）。本函数只服务
 *   按钮 —— 按钮的形状依赖一个确定的档位。
 *
 * @param status 卡上的状态串（可能是脏数据）
 */
export function taskStateOf(status: string): TaskState {
	return isTaskState(status) ? status : TaskState.UNSPECIFIED;
}

/**
 * class 的唯一生成点。
 *
 * 顺序是契约：`status-button` → `status-button--{size}` →
 * `status-button--{tone}` → `is-{interactive|static}`。
 *
 * @param input 尺寸 / 档位 / 是否可点
 */
export function statusButtonClassName(input: {
	readonly size: StatusButtonSize;
	readonly tone: StateTone;
	readonly interactive: boolean;
}): string {
	return [
		'status-button',
		`status-button--${input.size}`,
		`status-button--${input.tone}`,
		input.interactive ? 'is-interactive' : 'is-static',
	].join(' ');
}

/**
 * 把 props 翻成渲染模型。
 *
 * @param input 见 `StatusButtonModelInput`
 */
export function statusButtonModelOf(input: StatusButtonModelInput): StatusButtonModel {
	const label = statusButtonLabel(input.status);
	const tone = stateTone(input.status);
	const className = statusButtonClassName({
		size: input.size,
		tone,
		interactive: input.interactive,
	});

	if (input.interactive) {
		return {
			tag: 'button',
			className,
			label,
			tone,
			caret: input.showChevron ? STATUS_BUTTON_CARET : null,
			title: `变更状态：${label}`,
			ariaDescription: null,
		};
	}

	/*
	 * 只读态：`title` 和 `aria-description` **是同一个原因**。
	 * 前者给鼠标，后者给读屏（`aria-description` 不会被视觉样式隐藏）。
	 */
	return {
		tag: 'span',
		className,
		label,
		tone,
		caret: null,
		title: input.disabledReason ?? label,
		ariaDescription: input.disabledReason,
	};
}
