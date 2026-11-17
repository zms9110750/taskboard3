/**
 * 详情**历史** —— 默认折叠，点表头展开。
 *
 * ## 折叠是**语义**，开合是**UI 临时态**
 *
 * | 谁是语义 | 在哪 |
 * |---|---|
 * | 显示不显示、能不能折、初始折不折、条数、顺序、每条的人话 | `pure/card-detail.ts` 的 `historyTableOf()`（单测钉住）|
 * | 用户此刻展开了没有 | **本组件的 `useState`**（不进 store、不落库）|
 *
 * 这跟旧版的分工一致：旧版 `index.js:99` 的 `expanded` 是「本视图实例的 UI 临时态」
 * （注释原话：「不能进 store」）。区别是旧版折的是关系区，这里折的是历史。
 *
 * ## 为什么组件持有状态而 pure 只给初值
 *
 * 「初始折叠」是设计决定，「现在展开着」是用户动作的结果。
 * 把后者也塞进 pure ⇒ 每次开合都要重建整张表，而且 pure 就不纯了。
 *
 * ## ⚠ 父组件要用 `key={card.id}` 挂它
 *
 * `useState` 的初值**只在挂载时读一次**。切卡时若不换 key，上一张卡的展开状态
 * 会带到下一张卡上。`CardDetail.tsx` 里已经这么做（那里的注释写了原因）。
 */

import { useState } from 'react';
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

	/*
	 * ⚠ 钩子必须在条件返回**之前**调用（React 规则）。
	 *   所以「不可见就不渲染」的判断放在 hooks 之后。
	 */
	const [open, setOpen] = useState<boolean>(!view.collapsed);

	if (!view.visible) return null;

	/*
	 * 不可折叠（0/1 条）⇒ 表头不是按钮，列表常开。
	 * 这里按 `view.collapsible` 分两支，而不是在 `<button disabled>` 上动手脚 ——
	 * 一个点了没反应的按钮比没有按钮更让人困惑。
	 */
	const collapsed = view.collapsible ? !open : false;

	return (
		<div className="detail-history" data-detail-history data-history-count={view.count}>
			{view.collapsible ? (
				<button
					type="button"
					className={`detail-history__toggle${collapsed ? '' : ' is-open'}`}
					data-history-toggle
					aria-expanded={!collapsed}
					title={collapsed ? '展开历史' : '收起历史'}
					onClick={() => setOpen((one) => !one)}
				>
					<span className="detail-history__caret">{collapsed ? '▸' : '▾'}</span>
					<span className="detail-history__label">{view.label}</span>
				</button>
			) : (
				<div className="detail-history__head">
					<span className="detail-history__label">{view.label}</span>
				</div>
			)}

			{collapsed ? null : (
				<ul className="detail-history__list" data-history-list>
					{view.items.map((item) => (
						<HistoryRow key={item.key} item={item} />
					))}
				</ul>
			)}
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
