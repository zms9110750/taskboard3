/**
 * 空间选择器 —— compact 密度下的「工作空间 ▾」按钮 + 下拉面板。
 *
 * ## 它是什么
 *
 * `density="compact"` 时，SpaceBar 那一整行 chip 被折叠成一个按钮；点开按钮，
 * 面板在**按钮下方**弹出（覆盖在内容上，不推挤布局）。用户 `2026-11-20`：
 * > 「是菜单往下打开区域的，不是在菜单身上就展开的」。
 *
 * 面板里装的就是**定稿的 `SpaceBar`**（一行 chip + 「显示已归档」+「+」），
 * 只是换了容器 —— 本组件不复制它的判决，也不改它的行为。
 *
 * ## 开合由**本组件自己管**（用户 `2026-11-20` 的规则）
 *
 * > 「哪怕是同一行的别的这个筛选框。只要不是点他自己身上，他就要收起。
 * >   他管焦点在不在他自己身上难道都管不到嘛？还要父容器去监听？」
 *
 * ⇒ 和刚改好的 `FilterBox` 同一个手法：**自己的 `useEffect` 盯自己的 DOM 边界**
 *   （`pointerdown` 捕获阶段 + `wrap.contains(target)`），点到自己身外就收起。
 *   **父容器不挂任何 document 监听** —— 组件挂在哪儿都成立。
 *
 * ## 为什么不用 `onBlur` / 焦点
 *
 * 面板是 `div`（不是原生 select），焦点本来就不在它身上；而且点一下 chip
 * 会让按钮失焦。用 DOM 边界判定才是「点自己身外」的字面意思（FilterBox 同）。
 *
 * ## DOM 与类名
 *
 * 和拆之前 `Workspace.tsx` 里那段**逐字一致**：
 * `tb3w-space-wrap` / `ghost-btn tb3w-space-toggle` / `tb3w-space-pop`，
 * `data-space-toggle`、`aria-expanded` / `aria-haspopup` / `role="dialog"` /
 * `aria-label` 一个不改 —— 抽屉的 CSS（`.tb3d-panel .tb3w-*`）和预览验证脚本
 * 都按这些钩子取元素。
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { Workspace as SpaceEntity } from '../../types.ts';
import { SpaceBar } from '../SpaceBar.tsx';

/** 组件属性。 */
export interface SpacePickerProps {
	/** 全部空间（含归档）—— 原样转给 `SpaceBar`。 */
	readonly workspaces: readonly SpaceEntity[];
	/** 当前**激活**空间。 */
	readonly currentId: string;
	/** 正在**查看**的空间。 */
	readonly viewingId: string;
	/** 「显示已归档」开关（受控）。 */
	readonly showArchived: boolean;
	/** 正在查看的空间里的卡数（显示在选中 chip 上）。 */
	readonly cardCount: number;
	/**
	 * 初始就展开（`defaultValue` 语义）。
	 *
	 * ⚠ 只给**静态渲染**用：预览要画「展开态」、SSR / 测试要断言面板内容，
	 *   而 `open` 是本组件的内部状态、静态渲染点不了按钮。
	 *   产品里不传 = 收起。
	 */
	readonly defaultOpen?: boolean;

	/* ── 原样转给 SpaceBar 的回调 ── */
	readonly onView: (id: string) => void;
	readonly onActivate: (id: string) => void;
	readonly onToggleArchived: (id: string) => void;
	readonly onToggleShowArchived: () => void;
	readonly onCreate: () => void;
}

/**
 * 「工作空间 ▾」按钮 + 下拉面板。
 *
 * @param props 见 `SpacePickerProps`
 */
export function SpacePicker(props: SpacePickerProps): ReactNode {
	const [open, setOpen] = useState<boolean>(() => props.defaultOpen === true);
	const wrapRef = useRef<HTMLSpanElement>(null);

	/*
	 * 「点自己身外 ⇒ 收起」。
	 *
	 * - `pointerdown` + **capture**：抢在别处的 click 之前收起，视觉上不会
	 *   「先展开另一个再收自己」（FilterBox 踩过同一个顺序问题）。
	 * - `wrap.contains(target)`：点在按钮 / 面板内部（含 SpaceBar 的 chip）⇒ 不算外面。
	 * - 只在自己开着时挂监听（关着挂没有意义，也省一次全局监听）。
	 */
	useEffect(() => {
		if (!open) return;
		const onDocPointerDown = (event: PointerEvent): void => {
			const root = wrapRef.current;
			if (root === null) return;
			if (event.target instanceof Node && root.contains(event.target)) return;
			setOpen(false);
		};
		document.addEventListener('pointerdown', onDocPointerDown, true);
		return () => {
			document.removeEventListener('pointerdown', onDocPointerDown, true);
		};
	}, [open]);

	return (
		<span className="tb3w-space-wrap" ref={wrapRef}>
			<button
				type="button"
				className="ghost-btn tb3w-space-toggle"
				data-space-toggle
				aria-expanded={open}
				aria-haspopup="true"
				onClick={() => {
					setOpen((prev) => !prev);
				}}
			>
				{open ? '工作空间 ▴' : '工作空间 ▾'}
			</button>
			{open ? (
				<div className="tb3w-space-pop" role="dialog" aria-label="切换工作空间">
					<SpaceBar
						workspaces={props.workspaces}
						currentId={props.currentId}
						viewingId={props.viewingId}
						showArchived={props.showArchived}
						cardCount={props.cardCount}
						onView={props.onView}
						onActivate={props.onActivate}
						onToggleArchived={props.onToggleArchived}
						onToggleShowArchived={props.onToggleShowArchived}
						onCreate={props.onCreate}
					/>
				</div>
			) : null}
		</span>
	);
}
