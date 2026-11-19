/**
 * RelationPanel（关系折叠面板）预览入口 —— 用户要「给我看给我选」的那一页。
 *
 * ## 三块
 *
 * ① **三个形态并排**（同一份数据）：A 原版三列表 / B 平铺列表 / C 折叠 + 计数条。
 *    它们都是**非受控**的 ⇒ 可以直接点折叠头看展开/收起。
 * ② **展开态对照**：三个变体都强制展开同一份数据，方便一眼比正文差异。
 * ③ **固定场景矩阵**（用变体 A）：6 条关系 / 只有父任务 / 0 关系 / 关系里全是草稿。
 *
 * ## ⚠ 假数据里的两条「必须被剔除」
 *
 * - `CH-10` 是 `ME-06` 的子任务，但状态是草稿 ⇒ **不能出现在关系里**（总数 6 不是 7）。
 * - `DR-04` 的父任务 `DE-DRAFT` 和关系目标 `WI-DRAFT` 都是草稿 ⇒ 父任务 chip 不显示、总数 0。
 *
 * 每块下面都有 `data-rel-facts` 把「算出来的数字」打出来 —— 截图就能看出规则生效了，
 * 不用点开 DevTools。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { relationsOf, statusGroupOf, type RelationsView } from '../../../src/pure/relations-block.ts';
import { RelationPanel, type RelationPanelVariant } from '../../../src/renderers/RelationPanel.tsx';
import type { Card } from '../../../src/types.ts';

/* ══════════════════════════════════════════════════════════
   夹具
   ══════════════════════════════════════════════════════════ */

const S = {
	draft: 'TASK_STATE_UNSPECIFIED',
	submitted: 'TASK_STATE_SUBMITTED',
	working: 'TASK_STATE_WORKING',
	inputRequired: 'TASK_STATE_INPUT_REQUIRED',
	authRequired: 'TASK_STATE_AUTH_REQUIRED',
	completed: 'TASK_STATE_COMPLETED',
	failed: 'TASK_STATE_FAILED',
} as const;

/**
 * 一张假卡。
 *
 * @param id 编号
 * @param title 标题
 * @param status A2A 状态
 * @param kind 分类（决定编号颜色）
 * @param over 覆盖字段（parent / links …）
 */
function card(
	id: string,
	title: string,
	status: string,
	kind: string,
	over: Partial<Card> = {},
): Card {
	return {
		id,
		title,
		status,
		template: { ref: `${kind}.demo`, kind, domain: '演示' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		createdAt: 1_762_000_000_000,
		adoptedAt: null,
		history: [],
		deleted: false,
		holders: [],
		unread: { ai: false, user: false },
		...over,
	};
}

/** 本空间的全量卡（含草稿 —— 草稿过滤是被验证的规则，不能在夹具里预先滤掉）。 */
const ALL: readonly Card[] = [
	/* ── ① 6 条关系的卡（ME-06）：3 个子任务 + 3 条出边 ── */
	card('DE-01', '详情面板重做', S.working, 'design'),
	card('ME-06', '关系折叠面板接入详情', S.working, 'design', {
		relations: {
			parent: 'DE-01',
			links: [
				{ label: 'dependsOn', to: 'WI-02' },
				{ label: 'related', to: 'DE-03' },
				{ label: 'references', to: 'RE-04' },
			],
		},
	}),
	/* 三个子任务：覆盖 active / shelved / ended 三列 */
	card('CH-07', '子任务：表头三列', S.submitted, 'work', { relations: { parent: 'ME-06', links: [] } }),
	card('CH-08', '子任务：组横条', S.completed, 'work', { relations: { parent: 'ME-06', links: [] } }),
	card('CH-09', '子任务：落列规则', S.authRequired, 'work', { relations: { parent: 'ME-06', links: [] } }),
	/*
	 * ⚠ 这一个是**草稿** ⇒ 必须从关系里剔除（用户 2026-11-09 08:45）。
	 *   夹具故意造出来：原版实测过「草稿卡是自己父卡的子卡」这种脏数据。
	 */
	card('CH-10', '草稿子任务（必须被剔除）', S.draft, 'work', {
		relations: { parent: 'ME-06', links: [] },
	}),
	/* 出边目标：分别落 active / shelved / ended */
	card('WI-02', '依赖：状态落进行列', S.working, 'work'),
	card('DE-03', '相关：状态落搁置列', S.inputRequired, 'design'),
	card('RE-04', '参考：状态落完成列', S.completed, 'record'),

	/* ── ② 只有父任务（PA-02） ── */
	card('PA-02', '只有父任务，没有任何子任务', S.submitted, 'design', {
		relations: { parent: 'DE-01', links: [] },
	}),

	/* ── ③ 0 关系（EM-03） ── */
	card('EM-03', '一张没有任何关系的卡', S.working, 'record'),

	/* ── ④ 关系里全是草稿（DR-04） ── */
	card('DR-04', '关系里全是草稿的卡', S.working, 'design', {
		relations: {
			parent: 'DE-DRAFT',
			links: [{ label: 'dependsOn', to: 'WI-DRAFT' }],
		},
	}),
	card('DE-DRAFT', '草稿父任务（必须被剔除）', S.draft, 'design'),
	card('WI-DRAFT', '草稿依赖目标（必须被剔除）', S.draft, 'work'),
	card('CH-DRAFT', '草稿子任务（必须被剔除）', S.draft, 'work', {
		relations: { parent: 'DR-04', links: [] },
	}),
];

/** 按 id 取卡（夹具里写死，取不到直接抛 —— 假数据写错要立刻炸，不要静默空白）。 */
function pick(id: string): Card {
	const found = ALL.find((one) => one.id === id);
	if (found === undefined) throw new Error(`夹具缺卡: ${id}`);
	return found;
}

/** 算一张卡的关系视图。 */
function viewOf(id: string): RelationsView {
	return relationsOf(pick(id), ALL, statusGroupOf);
}

/** 稳定的一份视图（模块级算一次，三个变体共用同一份数据）。 */
const FULL = viewOf('ME-06');
const PARENT_ONLY = viewOf('PA-02');
const EMPTY = viewOf('EM-03');
const DRAFT_ONLY = viewOf('DR-04');

/* ══════════════════════════════════════════════════════════
   小零件
   ══════════════════════════════════════════════════════════ */

/**
 * 把视图的关键数字打出来（截图就能验证规则）。
 *
 * @param props 视图 + 说明
 */
function Facts(props: { readonly relations: RelationsView }): React.ReactNode {
	const relations = props.relations;
	const ids = relations.groups.flatMap((group) => group.cards.map((one) => one.id));
	return (
		<div className="rp-facts" data-rel-facts>
			<code data-fact="total">total={relations.total}</code>
			<code data-fact="parent">{relations.parentCard?.id ?? '(无父任务)'}</code>
			<code data-fact="groups">
				{relations.groups.map((one) => `${one.label}${String(one.count)}`).join(' / ')}
			</code>
			<code data-fact="cards">{ids.join(',')}</code>
			<code
				data-fact="drafts"
				className={ids.some((one) => one.includes('DRAFT') || one === 'CH-10') ? 'is-bad' : ''}
			>
				{ids.some((one) => one.includes('DRAFT') || one === 'CH-10') ? '⚠ 草稿泄漏' : '草稿已剔除'}
			</code>
		</div>
	);
}

/**
 * 一块舞台（面板 + 数字）。
 *
 * @param props 变体 / 视图 / 说明 / 是否强制展开
 */
function Stage(props: {
	readonly variant: RelationPanelVariant;
	readonly relations: RelationsView;
	readonly expanded: boolean | undefined;
	readonly onEvent: (what: string) => void;
}): React.ReactNode {
	return (
		<div className="rp-stage" data-preview-variant={props.variant}>
			<RelationPanel
				variant={props.variant}
				relations={props.relations}
				onJump={(cardId) => props.onEvent(`jump:${cardId}`)}
				onAddRelation={() => props.onEvent('add-relation')}
				onDerive={() => props.onEvent('derive')}
				{...(props.expanded === undefined ? {} : { expanded: props.expanded })}
			/>
			<Facts relations={props.relations} />
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

const VARIANTS: readonly {
	readonly variant: RelationPanelVariant;
	readonly title: string;
	readonly note: string;
}[] = [
	{
		variant: 'a',
		title: 'A · 原版三列表（接入 CardDetail 的就是这个）',
		note: '折叠；展开后三列表头 + 关系类型组横条，卡按 status 落列',
	},
	{
		variant: 'b',
		title: 'B · 平铺列表',
		note: '不折叠；每组一条组横条 + 卡片横向平铺（不分列）',
	},
	{
		variant: 'c',
		title: 'C · 折叠 + 计数条',
		note: '折叠时显示「关系 N（子任务 2 / 本项依赖 1 …）」；展开后同 B',
	},
];

const SCENARIOS: readonly {
	readonly key: string;
	readonly note: string;
	readonly relations: RelationsView;
}[] = [
	{ key: 'full', note: '6 条关系（3 子任务 + 依赖 / 相关 / 参考各 1）+ 父任务 DE-01；CH-10 是草稿必须被剔除', relations: FULL },
	{ key: 'parent-only', note: '只有父任务 ⇒ total=0，但卡头行仍显示父任务 chip（规则 3：父任务在卡头）', relations: PARENT_ONLY },
	{ key: 'empty', note: '0 关系 ⇒ 空态文案；卡头行仍有「关系 0」和「+ 派生子任务」', relations: EMPTY },
	{ key: 'draft-only', note: '关系对象全是草稿 ⇒ total=0、父任务 chip 不显示（草稿不能成为关系连接对象）', relations: DRAFT_ONLY },
];

/**
 * 页面。
 */
function App(): React.ReactNode {
	const [events, setEvents] = useState<readonly string[]>([]);
	const push = (what: string): void => {
		setEvents((one) => [...one, what]);
	};

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>RelationPanel / 关系折叠面板</h1>
				<p>
					同一份假数据上的三个候选形态 · 关系类型顺序与中文名照原版 · 草稿一律剔除 ·
					卡头行 = 关系 N + 父任务 + 派生子任务
				</p>
			</header>

			<section className="pv-block">
				<h2>① 三个形态并排（可点折叠头；同一份数据）</h2>
				<div className="rp-grid">
					{VARIANTS.map((one) => (
						<div className="rp-col" key={one.variant} data-variant-col={one.variant}>
							<h3 className="rp-col__title">{one.title}</h3>
							<p className="rp-col__note">{one.note}</p>
							<Stage
								variant={one.variant}
								relations={FULL}
								expanded={undefined}
								onEvent={push}
							/>
						</div>
					))}
				</div>
			</section>

			<section className="pv-block">
				<h2>② 展开态对照（三个变体都强制展开，比正文差异）</h2>
				<div className="rp-grid">
					{VARIANTS.map((one) => (
						<div className="rp-col" key={one.variant}>
							<h3 className="rp-col__title">{one.title}</h3>
							<p className="rp-col__note">{one.note}</p>
							<Stage
								variant={one.variant}
								relations={FULL}
								expanded
								onEvent={push}
							/>
						</div>
					))}
				</div>
			</section>

			<section className="pv-block">
				<h2>③ 固定场景矩阵（变体 A 强制展开）</h2>
				{SCENARIOS.map((one) => (
					<div className="rp-case" key={one.key} data-scenario={one.key}>
						<div className="rp-case__note">{one.note}</div>
						<Stage variant="a" relations={one.relations} expanded onEvent={push} />
					</div>
				))}
			</section>

			<section className="pv-block">
				<h2>④ 回调日志（点了什么就是什么）</h2>
				<ul className="rp-events" data-event-log>
					{events.length === 0 ? <li className="rp-events__empty">（还没有事件）</li> : null}
					{events.map((one, index) => (
						<li key={`${String(index)}-${one}`} data-event={one}>
							{one}
						</li>
					))}
				</ul>
				<button type="button" className="ghost-btn" onClick={() => setEvents([])}>
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
