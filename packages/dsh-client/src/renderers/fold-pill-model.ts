/**
 * `FoldPill` / `FoldRect` 的**渲染模型** —— 纯函数，零 React。
 *
 * 为什么单独一层：
 * - `node --test` 不能 import `.tsx`（Node 的类型剥离不处理 JSX），
 *   但这两个组件的「两态 class 必须完全相同 / 收起时矩形必须返回 null」
 *   是需要被单测钉住的行为；
 * - 把「态 → class / caret / 是否渲染」收在这里，`.tsx` 只做 props → DOM 的映射，
 *   测试就能直接覆盖真正的判决，而不是只 grep 一段 CSS 字符串。
 *
 * ⚠ 这里**不认识任何业务**：没有「组 / 卡 / 子任务」，只有 open / tone。
 */

/** 胶囊的语义色档位（候选 / 选取 / 普通）。 */
export type FoldTone = 'plain' | 'candidate' | 'selected';

/** 胶囊的渲染模型。 */
export interface FoldPillModel {
	/** 两态恒为同一个 class —— 折叠/展开只换 caret，不换壳。 */
	readonly className: 'tb3-fold-pill';
	readonly tone: FoldTone;
	readonly caret: '▸' | '▾';
	readonly ariaExpanded: 'true' | 'false';
}

/**
 * 胶囊两态的渲染模型。
 *
 * @param open 是否展开
 * @param tone 语义色档位；省略 = `plain`
 */
export function foldPillModelOf(open: boolean, tone: FoldTone | undefined): FoldPillModel {
	return {
		className: 'tb3-fold-pill',
		tone: tone ?? 'plain',
		caret: open ? '▾' : '▸',
		ariaExpanded: open ? 'true' : 'false',
	};
}

/** 容器矩形的渲染模型（`null` = 不渲染）。 */
export interface FoldRectModel {
	readonly className: 'tb3-fold-rect';
}

/**
 * 容器矩形只有展开才存在 —— **返回 `null` 是「不渲染」，不是透明 / 高度 0**。
 *
 * @param open 是否展开
 */
export function foldRectModelOf(open: boolean): FoldRectModel | null {
	return open ? { className: 'tb3-fold-rect' } : null;
}
