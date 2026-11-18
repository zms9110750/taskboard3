/**
 * CardDetail 预览入口 —— **只在 `dev/preview/carddetail/` 里，不碰根 `main.tsx`**。
 *
 * 两段：
 *
 * ① **活的一面板** —— 受控 note、可点关闭/放大、可切卡。
 * ② **固定场景** —— 每格直接可断言：
 *    · `empty-history`  0 条历史 + 0 章节 + 空备注 ⇒ 备注**仍然在**
 *    · `one-history`    1 条历史 ⇒ 全画出来
 *    · `many-history`   3 条历史 ⇒ **全部可见，没有折叠按钮**（用户 `2026-11-18`）
 *    · `long-label`     超长 label ⇒ 状态列 left **不变**（用户 `2026-11-18` 的根因）
 *    · `deleted`        墓碑 ⇒ 备注/章节都显示，动作禁用，横幅在
 *    · `no-sections`    没有章节 ⇒ 「模板没有章节」占位，但**没有「正文」二字**
 *
 * 为什么要 ② 而不能只靠 ①：断言需要**每格都能直接读到初始态**，
 * 而 ① 里想凑出「0 条历史」得先把数据清掉。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { CardDetail } from '../../../src/renderers/CardDetail.tsx';
import type { Card, HistoryEntry } from '../../../src/types.ts';

/* ── 夹具 ── */

const S = {
	draft: 'TASK_STATE_UNSPECIFIED',
	submitted: 'TASK_STATE_SUBMITTED',
	working: 'TASK_STATE_WORKING',
	completed: 'TASK_STATE_COMPLETED',
} as const;

/** ⚠ `HistoryEntry` 类型里没 `actor`（v3 早期），但运行时 core 会带 —— 用宽类型造夹具。 */
type WideHistory = HistoryEntry & { readonly actor?: 'ai' | 'user' };

function history(...items: readonly WideHistory[]): readonly HistoryEntry[] {
	return items;
}

const T0 = 1_762_000_000_000; /* 固定时间，截图可复现 */
const MIN = 60_000;

/**
 * 一张内容齐全的卡。
 *
 * @param over 覆盖字段
 */
function card(over: Partial<Card> = {}): Card {
	return {
		id: 'DE-03',
		title: '把详情面板重做成「标题独占一行、备注常驻」',
		status: S.working,
		template: { ref: 'design.feature', kind: 'design', domain: '核心' },
		relations: {
			parent: 'DE-01',
			links: [
				{ label: 'blocks', to: 'DE-04' },
				{ label: 'relates', to: 'DE-05' },
			],
		},
		sections: {
			goal: { label: '目标', payload: { $type: 'text', value: '详情面板的语义要能读、能测，不散在 JSX 里。' } },
			design: {
				label: '设计',
				payload: { $type: 'text', value: '1) 一个 pure 函数产出整张表；2) 组件只 map；3) CDP 量标题的矩形。' },
			},
			record: { label: '记录', payload: { $type: 'text', value: '' } },
		},
		note: '历史不折叠了，三条全画出来。',
		createdAt: T0,
		adoptedAt: null,
		history: history(
			{ at: T0, action: 'create', actor: 'user' },
			{ at: T0 + MIN, action: 'transition', actor: 'ai', detail: { from: S.submitted, to: S.working } },
			{ at: T0 + 2 * MIN, action: 'update', actor: 'user' },
		),
		deleted: false,
		holders: [],
		unread: { ai: true, user: false },
		...over,
	};
}

/* ── ① 活的一面板 ── */

interface LiveProps {
	readonly onEvent: (what: string) => void;
}

function Live(props: LiveProps): React.ReactNode {
	const [note, setNote] = useState('历史不折叠了，三条全画出来。');
	const [cardId, setCardId] = useState('DE-03');
	const [closed, setClosed] = useState(false);

	const cards: readonly Card[] = [
		card(),
		/* 第二张卡：短历史 + 不同状态，用来验「切卡后折叠态/备注都重置」 */
		card({
			id: 'DE-04',
			title: '第二张卡（历史只有一条）',
			status: S.submitted,
			note: '',
			sections: { goal: { label: '目标', payload: { value: '验切卡' } } },
			history: history({ at: T0 + 10 * MIN, action: 'create', actor: 'user' }),
		}),
	];

	const current = cards.find((one) => one.id === cardId) ?? cards[0];
	const shown = current === undefined ? null : { ...current, note };

	return (
		<section className="pv-block">
			<h2>① 活的一面板（可切卡 / 可改备注）</h2>
			<div className="pv-row" data-live-bar>
				{cards.map((one) => (
					<button
						key={one.id}
						type="button"
						className={`ghost-btn${one.id === cardId ? ' is-active' : ''}`}
						data-pick-card={one.id}
						onClick={() => {
							props.onEvent(`pick-card:${one.id}`);
							setNote(one.note);
							setCardId(one.id);
							setClosed(false);
						}}
					>
						{one.id}
					</button>
				))}
				<span className="pv-state" style={{ margin: 0, padding: 0, border: 0 }}>
					<div>
						<span className="pv-k">note</span>
						<code data-live-note>{note}</code>
					</div>
				</span>
			</div>

			<div className="pv-detail-stage" data-live>
				{shown === null || closed ? (
					<div className="pv-detail-stage__empty" data-live-closed>
						（详情已关闭，点上面的编号重开）
					</div>
				) : (
					<CardDetail
						card={shown}
						templateLabel="功能设计"
						kindLabel="设计"
						onTransition={(to) => props.onEvent(`transition:${to}`)}
						onAddRelation={() => props.onEvent('add-relation')}
						onDerive={() => props.onEvent('derive')}
						onNoteChange={(text) => {
							props.onEvent(`note:${text}`);
							setNote(text);
						}}
						onClose={() => {
							props.onEvent('close');
							setClosed(true);
						}}
						onExpand={() => props.onEvent('expand')}
					/>
				)}
			</div>
		</section>
	);
}

/* ── ② 固定场景 ── */

interface Scenario {
	readonly key: string;
	readonly note: string;
	readonly card: Card;
}

const SCENARIOS: readonly Scenario[] = [
	{
		key: 'empty-history',
		note: '0 条历史 + 空备注 ⇒ 备注仍在、历史整块不出现',
		card: card({
			history: [],
			note: '',
			sections: { goal: { label: '目标', payload: { value: '空备注也要有输入框' } } },
		}),
	},
	{
		key: 'one-history',
		note: '1 条历史 ⇒ 显示，全部画出来',
		card: card({ history: history({ at: T0, action: 'create', actor: 'user' }) }),
	},
	{
		key: 'many-history',
		note: '3 条历史 ⇒ 全部可见，**没有折叠按钮**（用户 2026-11-18：历史后面没有内容，折叠无意义）',
		card: card(),
	},
	{
		key: 'long-label',
		note: '超长 label ⇒ 状态列 left **不变**（用户 2026-11-18 的根因：label 太大会让状态漂移）',
		card: card({
			template: {
				ref: 'user-need',
				kind: 'design',
				/*
				 * 故意把 domain 弄成长串 —— 它会被画成 badge，是 meta 行里的一个 label。
				 * 断言会量 `[data-meta="status"]` 的 left，和 `DE-03` 那格对比。
				 */
				domain: '这是一个非常非常长的领域名称用来把标签撑开'.repeat(3),
			},
		}),
	},
	{
		key: 'deleted',
		note: '墓碑 ⇒ 备注/章节都在，备注只读 + 动作禁用 + 横幅',
		card: card({ deleted: true }),
	},
	{
		key: 'no-sections',
		note: '没有章节 ⇒ 显示占位文案（也没有任何包住章节的标题行）',
		card: card({ sections: {}, history: [] }),
	},
	{
		key: 'no-close',
		note: '不传 onClose/onExpand ⇒ 两个图标按钮都不显示',
		card: card({ id: 'DE-06', title: '这个面板没有关闭按钮' }),
	},
];

function Matrix(props: LiveProps): React.ReactNode {
	return (
		<section className="pv-block">
			<h2>② 六个固定场景（逐个断言）</h2>
			{SCENARIOS.map((s) => (
				<div className="pv-case" key={s.key} data-scenario={s.key}>
					<div className="pv-case__note">{s.note}</div>
					<div className="pv-detail-stage">
						<CardDetail
							card={s.card}
							templateLabel="功能设计"
							kindLabel="设计"
							onTransition={(to) => props.onEvent(`${s.key}/transition:${to}`)}
							onAddRelation={() => props.onEvent(`${s.key}/add-relation`)}
							onDerive={() => props.onEvent(`${s.key}/derive`)}
							onNoteChange={(text) => props.onEvent(`${s.key}/note:${text}`)}
							/*
							 * ⚠ `no-close` 场景**省略** onClose / onExpand（不给这两个 prop）。
							 *   `exactOptionalPropertyTypes: true` 下不能写 `onClose={undefined}`
							 *   —— 那正是 `StatusCell` 被抓住的那类错误。
							 */
							{...(s.key === 'no-close'
								? {}
								: {
										onClose: () => props.onEvent(`${s.key}/close`),
										onExpand: () => props.onEvent(`${s.key}/expand`),
									})}
						/>
					</div>
				</div>
			))}
		</section>
	);
}

/* ── ③ 事件日志 ── */

function App(): React.ReactNode {
	const [events, setEvents] = useState<readonly string[]>([]);
	const push = (what: string): void => {
		setEvents((one) => [...one, what]);
	};

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>CardDetail / 卡片详情面板</h1>
				<p>
					状态在最左（固定列，不随 label 漂移）· 标题独占一行 · 备注常驻 ·{' '}
					<b>历史不折叠</b> · 章节渲染等 C6 <code>Section</code> 合并后替换
				</p>
			</header>

			<Live onEvent={push} />
			<Matrix onEvent={push} />

			<section className="pv-block">
				<h2>③ 回调日志（点了什么就是什么）</h2>
				<ul className="pv-events" data-event-log>
					{events.length === 0 ? <li className="pv-events__empty">（还没有事件）</li> : null}
					{events.map((one, index) => (
						<li key={`${index}-${one}`} data-event={one}>
							{one}
						</li>
					))}
				</ul>
				<button type="button" className="ghost-btn" data-clear-log onClick={() => setEvents([])}>
					清空日志
				</button>
			</section>
		</div>
	);
}

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
