/**
 * 列表头 —— 「列表 · N 条」+「按更新时间」+ 四列列名行。
 *
 * 拆自 `Workspace.tsx`（用户 `2026-11-20`：「一个视图那么多能拆的。做了组件吗」）。
 * **DOM / 类名与拆之前逐字一致**：`tb3w-list__head` / `tb3w-list__title` /
 * `tb3w-list__sort` / `tb3w-list__cols`，计数节点保留 `data-list-count`
 * （预览验证脚本按它取数）。
 *
 * ## 为什么只有「列表视图」才有它
 *
 * 列名行是给**行式列表**看的；科技树视图整栏交给 `TechTree`（它自带画布）。
 * ⇒ 调用方在 `view === 'tree'` 时**根本不渲染**本组件，而不是用 CSS 藏起来。
 *
 * ## 计数是「显示中」的条数，不是总条数
 *
 * `count` 由调用方给 —— 它是 `applyCardQuery()` 之后真正渲染的行数。
 * 工具栏上那句「筛出 X / 共 Y 条」里的 X 也是它（同一个判决来源）。
 */

import type { ReactNode } from 'react';

/** 组件属性。 */
export interface ListHeaderProps {
	/** 当前**显示中**的条数（过滤 / 搜索之后）。 */
	readonly count: number;
	/** 排序说明。默认「按更新时间」（设计图上的那一列）。 */
	readonly sortLabel?: string;
}

/**
 * 列表头 + 列名行。
 *
 * @param props 见 `ListHeaderProps`
 */
export function ListHeader(props: ListHeaderProps): ReactNode {
	return (
		<>
			<header className="tb3w-list__head">
				<span className="tb3w-list__title">
					列表 <em data-list-count>· {String(props.count)} 条</em>
				</span>
				<span className="tb3w-list__sort">{props.sortLabel ?? '按更新时间'}</span>
			</header>

			<div className="tb3w-list__cols" aria-hidden="true">
				<span>编号 + 状态</span>
				<span>分类 · 领域 · 模板</span>
				<span>标题</span>
				<span>最后动过</span>
			</div>
		</>
	);
}
