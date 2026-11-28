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
 *    · `section-kinds`  **三种 payload**：text 保留换行 / markdown 有排版 / ask
 *                       只读展示（选项是 div，不假装能点）+ 未知动作降级 JSON
 *
 * 为什么要 ② 而不能只靠 ①：断言需要**每格都能直接读到初始态**，
 * 而 ① 里想凑出「0 条历史」得先把数据清掉。
 *
 * ⚠ 2026-11-20：章节的 `SectionStub` 占位已换成定稿 `Section` ⇒ 本页
 *   现在渲染的是**三份真 payload**（text / markdown / ask），不是纯文本兜底。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

/* 注册表初始化 —— Section 的内容分发查的是运行时注册表（2026-11-22）。 */
import { initRenderers } from '../../../src/init-renderers.ts';

import { relationsOf, statusGroupOf } from '../../../src/pure/relations-block.ts';
import type { CreateDraft } from '../../../src/pure/create-types.ts';
import { CardDetail } from '../../../src/renderers/CardDetail.tsx';
import { CardCreate } from '../../../src/renderers/create/CardCreate.tsx';
import { injectStyles } from '../../../src/styles.ts';
import type { Card, CardSection, HistoryEntry } from '../../../src/types.ts';

/* ── 夹具 ── */

const S = {
	draft: 'TASK_STATE_UNSPECIFIED',
	submitted: 'TASK_STATE_SUBMITTED',
	working: 'TASK_STATE_WORKING',
	completed: 'TASK_STATE_COMPLETED',
} as const;

/**
 * 章节夹具 —— **三种 payload 各一份**（+ 空 text + 未注册动作）。
 *
 * 形状照 `core/template/actions.ts` 的 zod schema（见 `pure/section.ts` 文件头）：
 *   text     `{ $type:'text', value?, placeholder? }`
 *   markdown `{ $type:'markdown', value?, placeholder? }`
 *   ask      `{ $type:'ask', items:[{ header?, question?, options:[{label, description?}], multi_select?, picked? }] }`
 */
const SECTIONS: Readonly<Record<string, CardSection>> = {
	goal: {
		label: '目标',
		payload: {
			$type: 'text',
			value: '详情面板的语义要能读、能测，不散在 JSX 里。\n这第二行用来验 text 保留换行（pre-wrap）。',
		},
	},
	design: {
		label: '设计',
		payload: {
			$type: 'markdown',
			value: [
				'### 三个决定',
				'',
				'1. **pure 出表**，组件只 `map`',
				'2. `Section` 按 payload 的 `$type` **自己分派**',
				'3. 未知动作降级成可展开的原始 JSON',
				'',
				'```ts',
				'const view = sectionViewOf(payload);',
				'```',
				'',
				'- 列表项 A',
				'- 列表项 B',
			].join('\n'),
		},
	},
	questions: {
		label: '需要回答的问题',
		payload: {
			$type: 'ask',
			items: [
				{
					header: '详情页',
					question: '详情页的章节用哪个组件渲染？',
					multi_select: false,
					options: [
						{ label: '定稿 Section', description: 'text / markdown / ask 都走它' },
						{ label: '继续用 SectionStub' },
						{ label: '自己再写一个' },
					],
					picked: ['定稿 Section'],
				},
				{
					header: '多选示例',
					question: '哪些 payload 已经验过？',
					multi_select: true,
					options: [{ label: 'text' }, { label: 'markdown' }, { label: 'ask' }],
				},
			],
		},
	},
	record: { label: '记录', payload: { $type: 'text', value: '' } },
	unregistered: { label: '未注册的动作', payload: { $type: 'kanban-board', columns: 3 } },
};

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
		sections: SECTIONS,
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
		/*
		 * 关系目标必须真的在 `cards` 里 —— `relationsOf()` 会剔除指向不存在卡的边
		 * （草稿目标也剔除）。少了这两张，详情里的关系面板就是 0 条。
		 */
		card({ id: 'DE-01', title: '父任务：详情面板重做', status: S.submitted, template: { ref: 'design.feature', kind: 'design', domain: '核心' }, relations: { parent: null, links: [] } }),
		card({ id: 'DE-05', title: '相关：状态点样式', status: S.completed, template: { ref: 'design.feature', kind: 'design', domain: '核心' }, relations: { parent: null, links: [] } }),
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

			<div className="pv-detail-stage tb3w-root" data-live>
				{shown === null || closed ? (
					<div className="pv-detail-stage__empty" data-live-closed>
						（详情已关闭，点上面的编号重开）
					</div>
				) : (
					<CardDetail
						card={shown}
						templateLabel="功能设计"
						kindLabel="设计"
						relations={relationsOf(shown, cards, statusGroupOf)}
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
		key: 'section-kinds',
		note:
			'三种 payload 都由定稿 Section 渲染：text（换行保留）/ markdown（标题+列表+代码块）/ ' +
			'ask（只读：选项是 div，不假装能点）；record 是空 text ⇒「（空）」；未注册 $type ⇒ 降级 JSON',
		card: card(),
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
			<h2>② 固定场景（逐个断言）</h2>
			{SCENARIOS.map((s) => (
				<div className="pv-case" key={s.key} data-scenario={s.key}>
					<div className="pv-case__note">{s.note}</div>
					<div className="pv-detail-stage tb3w-root">
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

/* ── ②b 三处同源对比（issue #59 / #60） ── */

/**
 * 同一章节类型（ask）在**三处**各渲染一次，供 CDP 逐项读 `getComputedStyle`：
 *
 * | 上下文 | 组件 | shell mode | 是否在 .tb3w-root 里 |
 * |---|---|---|---|
 * | 建卡 | `CardCreate`（真组件） | `edit` | **不在**（故意）|
 * | 草稿 | `CardDetail`（draft 状态） | `interactive` | 在 |
 * | 终结 | `CardDetail`（completed 状态） | `readonly` | 在 |
 *
 * ⚠ 建卡那份**故意不套 `.tb3w-root`**：建卡页在预览里就是脱离工作区根节点渲染的，
 *   如果样式依赖 `.tb3w-root` 的变量，这里会立刻长出不同的 padding / 字号。
 */
const PARITY_ASK = {
	$type: 'ask',
	items: [
		{
			header: '样式来源',
			question: '这一章用哪套样式？',
			multi_select: false,
			options: [
				{ label: '同一套 SectionShell', description: '建卡 / 草稿 / 终结共用一个外壳' },
				{ label: '两套各写一份', description: '会漂成截图 10 那样' },
				{ label: '没有样式', description: '裸 input 堆叠' },
			],
			placeholder: '其它（自己填）…',
		},
	],
};

/** 建卡草稿：一章 ask。 */
const PARITY_DRAFT: CreateDraft = {
	title: '三处同源对比',
	templateRef: 'question',
	parentId: '',
	relations: [],
	note: '',
	sections: [
		{
			sectionId: 'question',
			label: '需要回答的问题',
			hint: '这一章在建卡页是可编辑的',
			kind: 'ask',
			payload: PARITY_ASK,
		},
	],
};

/** 详情用的章节表（和建卡草稿的 payload 是同一份）。 */
const PARITY_SECTIONS: Readonly<Record<string, CardSection>> = {
	question: { label: '需要回答的问题', payload: PARITY_ASK },
};

const noopVoid = (): void => {};

function Parity(): React.ReactNode {
	const draftCard = card({ status: S.draft, sections: PARITY_SECTIONS, note: '' });
	const endedCard = card({ status: S.completed, sections: PARITY_SECTIONS, note: '' });

	return (
		<section className="pv-block" data-shell-parity>
			<h2>②b 三处同源：建卡 / 草稿 / 终结（同一章节类型 = ask）</h2>
			<p className="pv-note" style={{ marginTop: 0 }}>
				issue #59 / #60：这三个 `.tb3-sec` 必须由**同一份 CSS** 给出同样的
				padding / border-radius / font-size / margin。断言在 <code>verify.mjs</code>。
			</p>
			<div className="pv-parity">
				<div className="pv-parity__col" data-shell-context="create">
					<div className="pv-parity__label">建卡（mode=edit，**不在** .tb3w-root 里）</div>
					<div className="pv-parity__stage pv-parity__stage--create">
						<CardCreate
							draft={PARITY_DRAFT}
							onChange={noopVoid}
							errors={[]}
							leftPane={<div />}
							onSubmit={noopVoid}
							onCancel={noopVoid}
						/>
					</div>
				</div>

				<div className="pv-parity__col" data-shell-context="draft">
					<div className="pv-parity__label">草稿（mode=interactive）</div>
					<div className="pv-parity__stage pv-parity__stage--detail tb3w-root pv-shell">
						<CardDetail
							card={draftCard}
							templateLabel="提问"
							kindLabel="设计"
							onTransition={noopVoid}
							onAddRelation={noopVoid}
							onDerive={noopVoid}
							onNoteChange={noopVoid}
							onSectionChange={noopVoid}
							onClose={noopVoid}
							onExpand={noopVoid}
						/>
					</div>
				</div>

				<div className="pv-parity__col" data-shell-context="ended">
					<div className="pv-parity__label">终结（mode=readonly）</div>
					<div className="pv-parity__stage pv-parity__stage--detail tb3w-root pv-shell">
						<CardDetail
							card={endedCard}
							templateLabel="提问"
							kindLabel="设计"
							onTransition={noopVoid}
							onAddRelation={noopVoid}
							onDerive={noopVoid}
							onNoteChange={noopVoid}
							onClose={noopVoid}
							onExpand={noopVoid}
						/>
					</div>
				</div>
			</div>
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
					<b>历史不折叠</b> · 章节 = 定稿 <code>Section</code>（text / markdown / ask 三种 payload）
				</p>
			</header>

			<Live onEvent={push} />
			<Matrix onEvent={push} />
			<Parity />

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

/* 产品样式由 injectStyles() 在运行时注入 —— 不调用就是裸 HTML（这次的 bug）。 */
injectStyles();

initRenderers();
const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
