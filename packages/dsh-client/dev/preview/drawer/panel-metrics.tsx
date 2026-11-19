/**
 * 面板**实测尺寸**读数 —— 给两个预览页共用。
 *
 * 为什么要有它：用户 `2026-11-20` 否了「窄高」预览，要求证明面板是**宽而扁**的
 * （真实 ≈ 1200 × 476，宽高比 2.5 : 1）。SSR 只能断言 CSS 规则，量不了像素；
 * 这个组件在**用户打开浏览器时**用 `getBoundingClientRect()` 读真实尺寸并显示 ——
 * 用户一眼能看到「宽 × 高 × 比例」。
 *
 * ⚠ 它不是产品代码：只在 `dev/preview/` 里用。产品面板没有这个读数。
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/** 一次实测结果。 */
export interface PanelMetrics {
	/** 宽（px，四舍五入）。 */
	readonly width: number;
	/** 高（px，四舍五入）。 */
	readonly height: number;
	/** 宽高比（保留两位小数）。 */
	readonly ratio: number;
}

/**
 * 实测一个选择器命中的元素尺寸（打开 / 切形态 / 窗口缩放时更新）。
 *
 * @param selector 选择器（面板 = `[data-drawer="1"]`）
 * @param deps 变化时重新量（开合、形态）
 */
export function usePanelMetrics(selector: string, deps: readonly unknown[]): PanelMetrics | null {
	const [metrics, setMetrics] = useState<PanelMetrics | null>(null);

	useEffect(() => {
		/** 量一次（元素不在 / 尺寸为 0 时清空）。 */
		const measure = (): void => {
			const element = document.querySelector(selector);
			if (!(element instanceof HTMLElement)) {
				setMetrics(null);
				return;
			}
			const rect = element.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) {
				setMetrics(null);
				return;
			}
			setMetrics({
				width: Math.round(rect.width),
				height: Math.round(rect.height),
				ratio: Math.round((rect.width / rect.height) * 100) / 100,
			});
		};

		measure();
		/* 下一帧再量一次：面板刚挂载 / 动画刚结束时尺寸才稳。 */
		const frame = requestAnimationFrame(measure);
		window.addEventListener('resize', measure);
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
		if (observer !== null) {
			const element = document.querySelector(selector);
			if (element !== null) observer.observe(element);
		}
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('resize', measure);
			observer?.disconnect();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- 调方给的 deps 就是重量的条件
	}, [selector, ...deps]);

	return metrics;
}

/**
 * 展示实测尺寸。
 *
 * @param props.metrics 实测结果（`null` = 面板没开 / 还没量到）
 */
export function PanelSizeBadge(props: { readonly metrics: PanelMetrics | null }): ReactNode {
	if (props.metrics === null) {
		return (
			<span className="pv-size" data-panel-size="unknown">
				面板实测：未展开
			</span>
		);
	}
	return (
		<span className="pv-size" data-panel-size={`${String(props.metrics.width)}x${String(props.metrics.height)}`}>
			面板实测 <b>{props.metrics.width}</b> × <b>{props.metrics.height}</b> px
			（宽高比 {props.metrics.ratio} : 1）
		</span>
	);
}
