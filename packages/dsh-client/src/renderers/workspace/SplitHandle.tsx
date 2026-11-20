/**
 * 分隔条 —— 列表 / 详情之间那根可拖的把手。
 *
 * 拆自 `Workspace.tsx`（用户 `2026-11-20`：「一个视图那么多能拆的。做了组件吗」）。
 *
 * ## 它自己找「拖的是哪两个盒子」
 *
 * 把手不改列表 / 详情的尺寸 —— 它只把**列表占比**（0–1）上报，调用方决定怎么写样式。
 * 判据全部从 DOM 读，不接 ref、不猜方向：
 *
 * ```ts
 * const main = handle.parentElement;                  // .tb3w-main（flex 容器）
 * const list = main.querySelector('[data-list]');     // 列表那栏（width/height 要变的那侧）
 * const column = getComputedStyle(main).flexDirection === 'column';
 * ```
 *
 * ⇒ `@container tb3w` 把 `.tb3w-main` 切成 `column` 时，同一份代码自动变成
 *   **竖直拖动**（量 `clientY` / `height`）；宽版是 `row` ⇒ 横向拖动。没有第二套分支。
 *
 * ## 结果写成**比例**，不是像素
 *
 * 拖动中上报 `nextSize / mainSize`，调用方把它写成 `flex-basis: X%`。
 * 写死 px 的话换个舞台尺寸（1600↔570）就会溢出或者挤死 —— 比例天然跟随容器。
 *
 * ## 两头留最小值
 *
 * 不夹的话可以把一栏拖成 0，然后**拖不回来**（把手和可抓区域都跟着没了）。
 * 最小列表 160px / 最小详情 180px（这两个数是旧的实现里就有的，随组件搬过来）。
 */

import { useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';

/**
 * 列表最小尺寸（px）。
 *
 * ⚠ 这两个数是**旧实现里就有的**（拆组件时原样搬），不是这里重新定的：
 * 它们是「拖到底不给拖成 0」的保护。
 */
const MIN_LIST_SIZE = 160;

/** 详情最小尺寸（px），同上。 */
const MIN_DETAIL_SIZE = 180;

/** 组件属性。 */
export interface SplitHandleProps {
	/**
	 * 拖动中上报**列表占比**（0–1）。
	 *
	 * 只上报，不落地：调用方决定写成 `flex-basis` 还是别的（本组件不碰别的 DOM）。
	 */
	readonly onResize: (listRatio: number) => void;
}

/**
 * 分隔条。
 *
 * @param props 见 `SplitHandleProps`
 */
export function SplitHandle(props: SplitHandleProps): ReactNode {
	const handleRef = useRef<HTMLDivElement>(null);

	/**
	 * 按下：量一次两端盒子，然后挂 window 上的 move/up（**只在拖动期间**）。
	 *
	 * 为什么挂 `window` 不挂 element：鼠标拖出把手范围后事件还在 window 上，
	 * 挂 element 会「拖一快就断」。抬起时一定解绑。
	 *
	 * @param event React 的 mousedown
	 */
	const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
		const handle = handleRef.current;
		const main = handle === null ? null : handle.parentElement;
		if (main === null) return;
		const list = main.querySelector<HTMLElement>('[data-list]');
		if (list === null) return;

		event.preventDefault();

		const column = getComputedStyle(main).flexDirection === 'column';
		const startPos = column ? event.clientY : event.clientX;
		const mainBox = main.getBoundingClientRect();
		const listBox = list.getBoundingClientRect();
		const mainSize = column ? mainBox.height : mainBox.width;
		const startSize = column ? listBox.height : listBox.width;
		if (mainSize <= 0) return;

		const onMove = (moveEvent: globalThis.MouseEvent): void => {
			const delta = (column ? moveEvent.clientY : moveEvent.clientX) - startPos;
			const next = Math.min(
				Math.max(startSize + delta, MIN_LIST_SIZE),
				mainSize - MIN_DETAIL_SIZE,
			);
			props.onResize(next / mainSize);
		};
		const onUp = (): void => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	};

	return (
		<div
			className="tb3w-split"
			ref={handleRef}
			role="separator"
			data-split
			onMouseDown={onMouseDown}
		>
			<span className="tb3w-split__line" />
			<span className="tb3w-split__grip" aria-hidden="true">
				⇄
			</span>
		</div>
	);
}
