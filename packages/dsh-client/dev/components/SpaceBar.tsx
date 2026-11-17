/**
 * 空间 chip 行 —— **chip 列表 + 左侧单个操作按钮 + 「显示已归档」开关 + 「+」新建**。
 *
 * ## 这个组件只做「渲染决定」
 *
 * 全部判决在 `dev/pure/space-bar.ts`（有 50 条单测，其中那张四行表逐行断言）。
 * 这里只把 `pure` 给出的字段**原样画出来**，外加一个**机械映射**：
 *
 * ```ts
 * const hit = dispatchOf(action);           // pure 已经判完「禁用 / 做哪件事」
 * if (hit === undefined) return;            // 禁用 ⇒ 什么都不做
 * hit.kind === 'activate' ? onActivate(hit.id) : onToggleArchived(hit.id);
 * ```
 *
 * ⇒ 组件里没有 `if (showArchived) … else …`，也没有 `if (isCurrent) …` ——
 *   那些都是语义判决，改一处就得改两遍。
 *
 * ## 三条它必须守住的用户指令
 *
 * ① 点 chip **只**调 `onView`（查看），永远不调 `onActivate`。
 *    类型级保证：`chip.intent` 恒为 `'view'`，没有别的分支可写。
 * ② 左侧**只有一个** `<button class="space-action">` —— 不是两个、不是下拉、不是菜单。
 * ③ 归档 chip 也只 `onView`（点它要的是「取消归档」，不是激活）。
 */

import type { ReactNode } from 'react';
import { useRef, useState } from 'react';

import {
	actionButtonOf,
	archivedToggleOf,
	chipsOf,
	dispatchOf,
} from '../pure/space-bar.ts';
import type { SpaceChip } from '../pure/space-bar.ts';
import type { Workspace } from '../../src/types.ts';

/**
 * 空间条**布局变体** —— 用户 `2026-11-18` 要求重新设计视觉，这是四个候选。
 *
 * > 「这个组件后续还要换。因为如果只有一行，那么在拖动的时候，
 * >  是无法精确的点到横向滚动条的。这个视觉效果需要重新设计。」
 *
 * | 变体 | 做法 | 精确点击的要求 |
 * |---|---|---|
 * | `wrap` | chip **换行**，完全不横向滚动 | **无** —— 没有滚动条 |
 * | `scroll` | 单行 + 加粗滚动条 + 上下留白 | 要拖得到那 10px 轨道 |
 * | `arrows` | 单行 + 左右翻页按钮 | 点按钮（大目标），不用拖 |
 * | `compact` | 只显示当前 + 正在查看，其余收进「全部 N」 | 点一次展开 |
 *
 * 默认 `wrap` —— 理由见 `dev/preview/spacebar/main.tsx` 的推荐说明。
 */
export type SpaceBarLayout = 'wrap' | 'scroll' | 'arrows' | 'compact';

/** 布局变体的中文名（预览页的切换按钮用）。 */
export const LAYOUT_LABELS: Readonly<Record<SpaceBarLayout, string>> = {
	wrap: 'A 换行（推荐）',
	scroll: 'B 单行 + 粗滚动条',
	arrows: 'D 单行 + 左右翻页',
	compact: 'C 折叠（当前+查看）',
};

/** 组件属性。 */
export interface SpaceBarProps {
	/** 全部空间（含 `archived` 标记）。 */
	readonly workspaces: readonly Workspace[];
	/** 当前**激活**空间（写操作 / AI 默认空间看它）。 */
	readonly currentId: string;
	/** 正在**查看**的空间（点 chip 改它，不改 `currentId`）。 */
	readonly viewingId: string;
	/** 「显示已归档」开关。 */
	readonly showArchived: boolean;
	/** 正在查看的空间里的卡数（显示在选中 chip 上）。 */
	readonly cardCount: number;
	/** 点 chip：**只**切换正在查看的空间。 */
	readonly onView: (id: string) => void;
	/** 点左侧按钮（激活态）：把正在查看的空间变成当前空间。 */
	readonly onActivate: (id: string) => void;
	/** 点左侧按钮（归档态）：切换该空间的归档状态。 */
	readonly onToggleArchived: (id: string) => void;
	/** 点「显示已归档 / 隐藏已归档」。 */
	readonly onToggleShowArchived: () => void;
	/** 点「+」。 */
	readonly onCreate: () => void;
	/**
	 * 布局变体（用户 `2026-11-18` 要求重做视觉）。默认 `wrap`。
	 *
	 * ⚠ 这个参数**只影响渲染**，不参与任何语义判决 ——
	 *   四种变体下按钮文案 / `disabled` / 派发回调必须完全一致（有单测）。
	 */
	readonly layout?: SpaceBarLayout;
}

/**
 * 空间 chip 行。
 *
 * @param props 见 `SpaceBarProps`
 */
export function SpaceBar(props: SpaceBarProps): ReactNode {
	const action = actionButtonOf(
		props.workspaces,
		props.currentId,
		props.viewingId,
		props.showArchived,
	);
	const toggle = archivedToggleOf(props.showArchived);
	const chips = chipsOf(
		props.workspaces,
		props.currentId,
		props.viewingId,
		props.showArchived,
		props.cardCount,
	);

	/** 左侧那个按钮被点了：`dispatchOf` 已经判完该不该做事、做哪件事。 */
	const runAction = (): void => {
		const hit = dispatchOf(action);
		if (hit === undefined) return;
		if (hit.kind === 'activate') {
			props.onActivate(hit.id);
			return;
		}
		props.onToggleArchived(hit.id);
	};

	const actionCls = ['ghost-btn', 'space-action', `is-emphasis-${action.emphasis}`];
	if (action.checked) actionCls.push('is-on');

	const layout = props.layout ?? 'wrap';

	/* chip 按钮 —— 四种布局共用同一段渲染，只有外层容器不同。 */
	const chipNodes = chips.map((chip) => {
		const cls = ['space-chip'];
		if (chip.isCurrent) cls.push('is-current');
		if (chip.isArchived) cls.push('is-archived');
		if (chip.isViewing) cls.push('is-viewing');

		return (
			<button
				key={chip.id}
				type="button"
				className={cls.join(' ')}
				data-chip-id={chip.id}
				data-chip-intent={chip.intent}
				data-chip-current={String(chip.isCurrent)}
				data-chip-archived={String(chip.isArchived)}
				data-chip-viewing={String(chip.isViewing)}
				title={chip.title}
				/*
				 * ② 点 chip **只**查看（用户：「查看和激活是要分离的」）。
				 *   这里没有第二个分支 —— `intent` 只有 `'view'`。
				 */
				onClick={() => props.onView(chip.id)}
			>
				<span className="space-chip__name">{chip.label}</span>
				{chip.count === null ? null : (
					<span className="space-chip__count">{chip.count}</span>
				)}
			</button>
		);
	});

	const addNode = (
		<button
			type="button"
			className="space-chip space-chip--add"
			data-create="1"
			title="新建任务板"
			onClick={props.onCreate}
		>
			+
		</button>
	);

	return (
		<div
			className={`space-bar space-bar--${layout}`}
			data-layout={layout}
			data-current={props.currentId}
			data-viewing={props.viewingId}
			data-show-archived={String(props.showArchived)}
		>
			{/* 左侧固定，不随 chip 滚动 */}
			<div className="space-bar__actions">
				{/*
				 * ① 只有一个按钮（用户：「不是两个独立按钮，是一个独立按钮」）。
				 *   它今天做激活、明天做归档 —— 由 `showArchived` 决定，组件不判。
				 */}
				<button
					type="button"
					className={actionCls.join(' ')}
					data-space-action="1"
					data-action-kind={action.kind}
					data-checked={String(action.checked)}
					data-emphasis={action.emphasis}
					disabled={action.disabled}
					title={action.title}
					onClick={runAction}
				>
					{action.label}
				</button>

				<button
					type="button"
					className={`ghost-btn space-toggle${toggle.active ? ' is-active' : ''}`}
					data-archived-toggle="1"
					aria-pressed={toggle.active}
					title={toggle.title}
					onClick={props.onToggleShowArchived}
				>
					{toggle.label}
				</button>
			</div>

			{layout === 'wrap' ? (
				/* A · 换行：chip 自然折行，**没有滚动条** ⇒ 不存在「拖不到」 */
				<div className="space-bar__wrap" data-chip-scope="wrap">
					{chipNodes}
					{addNode}
				</div>
			) : null}

			{layout === 'scroll' ? (
				/* B · 单行 + 加粗滚动条（留出上下 padding，轨道才够厚） */
				<div className="space-bar__scroll" data-chip-scope="scroll">
					{chipNodes}
					{addNode}
				</div>
			) : null}

			{layout === 'arrows' ? (
				/* D · 单行 + 左右翻页按钮（点大目标，不用拖） */
				<ScrollWithArrows>{chipNodes}{addNode}</ScrollWithArrows>
			) : null}

			{layout === 'compact' ? (
				/* C · 折叠：只显示当前 + 正在查看，其余收进「全部 N」 */
				<CompactChips chips={chips} addNode={addNode} onView={props.onView} />
			) : null}
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   下面三个是**布局外壳**，只影响渲染，不含语义判决。
   ══════════════════════════════════════════════════════════ */

/**
 * D · 单行 + 左右翻页按钮。
 *
 * 为什么不用滚动条：用户 `2026-11-18`
 * > 「如果只有一行，那么在拖动的时候，是无法精确的点到横向滚动条的。」
 *
 * ⇒ 把「拖动」换成「点按钮」—— 一个 28×28 的按钮比 6px 高的滚动条好点得多。
 */
function ScrollWithArrows(props: { readonly children: ReactNode }): ReactNode {
	const box = useRef<HTMLDivElement | null>(null);

	const page = (dir: -1 | 1): void => {
		const el = box.current;
		if (el === null) return;
		/* 翻一屏的 3/4，留一点上下文，用户不会失去位置感。 */
		el.scrollBy({ left: dir * Math.max(80, Math.round(el.clientWidth * 0.75)), behavior: 'smooth' });
	};

	return (
		<div className="space-bar__peruse">
			<button
				type="button"
				className="space-bar__arrow"
				data-arrow="prev"
				aria-label="向前翻"
				onClick={() => page(-1)}
			>
				‹
			</button>
			<div className="space-bar__scroll space-bar__scroll--nobar" ref={box} data-chip-scope="arrows">
				{props.children}
			</div>
			<button
				type="button"
				className="space-bar__arrow"
				data-arrow="next"
				aria-label="向后翻"
				onClick={() => page(1)}
			>
				›
			</button>
		</div>
	);
}

/**
 * C · 折叠布局：只显示「当前」和「正在查看」两个 chip，其余收进「全部 N」。
 *
 * ⚠ 展开后仍然是 wrap 布局（不引入滚动条）—— 折叠只是把「默认可见的数量」降下来。
 */
function CompactChips(props: {
	readonly chips: readonly SpaceChip[];
	readonly addNode: ReactNode;
	readonly onView: (id: string) => void;
}): ReactNode {
	const [expanded, setExpanded] = useState(false);

	const visible = expanded
		? props.chips
		: props.chips.filter((one) => one.isCurrent || one.isViewing);

	const hidden = props.chips.length - visible.length;

	return (
		<div className="space-bar__wrap" data-chip-scope="compact" data-expanded={String(expanded)}>
			{visible.map((chip) => {
				const cls = ['space-chip'];
				if (chip.isCurrent) cls.push('is-current');
				if (chip.isArchived) cls.push('is-archived');
				if (chip.isViewing) cls.push('is-viewing');
				return (
					<button
						key={chip.id}
						type="button"
						className={cls.join(' ')}
						data-chip-id={chip.id}
						data-chip-intent={chip.intent}
						data-chip-current={String(chip.isCurrent)}
						data-chip-archived={String(chip.isArchived)}
						data-chip-viewing={String(chip.isViewing)}
						title={chip.title}
						onClick={() => props.onView(chip.id)}
					>
						<span className="space-chip__name">{chip.label}</span>
						{chip.count === null ? null : <span className="space-chip__count">{chip.count}</span>}
					</button>
				);
			})}
			{hidden > 0 ? (
				<button
					type="button"
					className="space-chip space-chip--more"
					data-expand="1"
					onClick={() => setExpanded(true)}
				>
					全部 {props.chips.length}
				</button>
			) : null}
			{expanded ? (
				<button
					type="button"
					className="space-chip space-chip--more"
					data-collapse="1"
					onClick={() => setExpanded(false)}
				>
					收起
				</button>
			) : null}
			{props.addNode}
		</div>
	);
}
