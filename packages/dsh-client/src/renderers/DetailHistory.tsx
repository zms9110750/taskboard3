/**
 * 详情**历史** —— 竖直列表，**不折叠**。
 *
 * ## 为什么没有折叠（用户 `2026-11-18` 的判断，不是我们省事）
 *
 * > 「历史不需要折叠。没有折叠的含义。他是一个竖直显示。但是历史自己就是最后了。
 * >  他的折叠并不影响看他后面的内容。他没有更后面了。」
 *
 * 折行的意义是「省空间，给后面的内容让位」。历史在**最后面**，后面没有了
 * ⇒ 折它换不回任何东西，只多一次点击。
 *
 * ## ⚠ 上一版有折叠，被用户否掉了
 *
 * 上一版（`2026-11-18` 之前）是「≥2 条初始折叠」—— 那是成员的**推断**，
 * 用户当时的原话只有「历史可以折叠」。这次用户给了判据把它否掉：
 * **判据是「后面还有没有内容」，不是条数。**
 *
 * ⇒ 本组件**没有 `useState`**、没有折叠按钮、没有 `aria-expanded`。
 *   加回来之前先读上面那段话。
 *
 * ## 空历史仍然不画
 *
 * `visible: false` 时返回 `null`（旧版 `history-block.js:96-97`）。
 * 这和折叠是两件事：空的时候没有内容可展开，画个空框只会让人以为加载失败。
 */

import type { ReactNode } from 'react';

import type { DetailHistoryItem, DetailHistoryView } from '../pure/card-detail.ts';

/** 组件属性。 */
export interface DetailHistoryProps {
	/** `historyTableOf()` 的产物。 */
	readonly history: DetailHistoryView;
}

/**
 * 历史区块。
 *
 * @param props 见 `DetailHistoryProps`
 */
export function DetailHistory(props: DetailHistoryProps): ReactNode {
	const view = props.history;

	/* 空历史不画 —— 这是「有没有内容」，不是「折不折叠」。 */
	if (!view.visible) return null;

	return (
		<div className="detail-history" data-detail-history data-history-count={view.count}>
			<div className="detail-history__head" data-history-head>
				<span className="detail-history__label">{view.label}</span>
			</div>

			{/*
			 * ⚠ 这里**没有** `collapsed ? null : …` —— 全部条目永远画出来。
			 *   `data-history-list` 是 CDP 断言「3 条都在」的钩子。
			 */}
			<ul className="detail-history__list" data-history-list>
				{view.items.map((item) => (
					<HistoryRow key={item.key} item={item} />
				))}
			</ul>
		</div>
	);
}

/**
 * 一条历史（像物流轨迹：点 + 文字 + 时间）。
 *
 * @param props 一条
 */
function HistoryRow(props: { readonly item: DetailHistoryItem }): ReactNode {
	const item = props.item;
	return (
		<li className={`detail-history__item is-${item.actor}`} data-history-action={item.action}>
			<span className="detail-history__dot" />
			<span className="detail-history__text">{item.text}</span>
			<span className="detail-history__time">{item.time}</span>
		</li>
	);
}
