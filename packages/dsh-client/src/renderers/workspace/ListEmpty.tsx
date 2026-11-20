/**
 * 列表空态 —— 列表 0 行时那一句「为什么是空的」。
 *
 * 拆自 `Workspace.tsx`（用户 `2026-11-20`：「一个视图那么多能拆的。做了组件吗」）。
 *
 * ## 空的原因不同，话不能一样
 *
 * 用户看空列表时要知道**是数据没了、还是自己筛掉了**：
 * 筛出 0 条却写「这个空间还没有卡」，会让人以为数据丢了。
 * ⇒ 是哪种空由 `pure/card-filter.ts` 的 `emptyReasonOf()` 判（有单测），
 *   本组件只负责**挑句子**和画 —— 判决不在渲染层。
 *
 * | `EmptyReason` | 文案 |
 * |---|---|
 * | `space-empty` | 这个空间还没有卡。 |
 * | `filter` | 没有符合筛选条件的卡。 |
 * | `search` | 没有匹配「{query}」的卡。 |
 * | `both` | 没有同时符合筛选和「{query}」的卡。 |
 *
 * ## DOM 与类名
 *
 * `.tb3w-list__empty` + `data-list-empty={reason}` —— 和拆之前一致；
 * 后者让预览 / CDP 能直接断言「现在是哪种空」。
 */

import type { ReactNode } from 'react';

import type { EmptyReason } from '../../pure/card-filter.ts';

/** 组件属性。 */
export interface ListEmptyProps {
	/** 空的原因（`emptyReasonOf()` 的返回值）。 */
	readonly reason: EmptyReason;
	/** 搜索框的原始值（只用 `trim()` 后拼话；`search` / `both` 会用到）。 */
	readonly query: string;
}

/**
 * 按空的原因选一句文案。
 *
 * `switch` 是穷尽的：`EmptyReason` 加一个成员时 `tsc` 报返回类型不可赋值
 * （`noFallthroughCasesInSwitch` + 显式返回类型）。
 *
 * @param reason 空的原因
 * @param query 搜索框原始值
 */
export function emptyTextOf(reason: EmptyReason, query: string): string {
	switch (reason) {
		case 'space-empty':
			return '这个空间还没有卡。';
		case 'filter':
			return '没有符合筛选条件的卡。';
		case 'search':
			return `没有匹配「${query.trim()}」的卡。`;
		case 'both':
			return `没有同时符合筛选和「${query.trim()}」的卡。`;
	}
}

/**
 * 列表空态。
 *
 * @param props 见 `ListEmptyProps`
 */
export function ListEmpty(props: ListEmptyProps): ReactNode {
	return (
		<div className="tb3w-list__empty" data-list-empty={props.reason}>
			{emptyTextOf(props.reason, props.query)}
		</div>
	);
}
