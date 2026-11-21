/**
 * 抽屉（1200×476，横）与工作区（570×920，竖）的**布局**候选。
 *
 * ```
 * node dev/preview/build.mjs drawer-layout
 * ```
 *
 * 用户 2026-11-22：
 * > 「抽屉和工作区一横一竖不一样。不是说图例这种元素就可以少了。」
 *
 * ⇒ 不是「删元素」，是**同一套内容在横/竖两个比例下的重排**。
 *
 * 这里用**骨架**画三种横向布局（抽屉），每种都保留：工具栏 / 筛选行 / 空间折叠栏 / 列表 / 详情。
 * 工作区（竖）沿用现有的上下结构，作为对照放在每栏右下角的小示意里。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

/* ══════════════════════════════════════════════════════════
   骨架件
   ══════════════════════════════════════════════════════════ */

/** 工具栏。 */
function SkelToolbar(): React.ReactNode {
	return (
		<div className="dl-toolbar">
			<span className="dl-toolbar__title">任务 共 12 条</span>
			<span className="dl-toolbar__actions">
				<span className="dl-chip">工作空间 ▾</span>
				<span className="dl-seg">
					<span className="dl-seg__on">科技树</span>
					<span>列表</span>
				</span>
				<span className="dl-primary">新建</span>
			</span>
		</div>
	);
}

/**
 * 关系图例 —— **用户 2026-11-22 专门骂过**：
 * 「不是说图例这种元素就可以少了。」
 *
 * 6 种关系：派生 / 依赖 / 取代 / 约束 / 相关 / 参考。
 */
const LEGEND: readonly { readonly rel: string; readonly label: string }[] = [
	{ rel: 'derives', label: '派生' },
	{ rel: 'depends', label: '依赖' },
	{ rel: 'supersedes', label: '取代' },
	{ rel: 'constrains', label: '约束' },
	{ rel: 'related', label: '相关' },
	{ rel: 'references', label: '参考' },
];

/** 关系图例行 —— 6 条彩色线段 + 说明「只在科技树视图显示」。 */
function SkelLegend(): React.ReactNode {
	return (
		<div className="dl-legend">
			<span className="dl-legend__label">关系图例</span>
			{LEGEND.map(function one(item) {
				return (
					<span className="dl-legend__item" key={item.rel}>
						<i className="dl-legend__line" data-rel={item.rel} />
						<span>{item.label}</span>
					</span>
				);
			})}
			<span className="dl-legend__hint">（只在科技树视图显示）</span>
		</div>
	);
}

/** 筛选行。 */
function SkelFilters(): React.ReactNode {
	return (
		<div className="dl-filters">
			<span className="dl-chip">状态</span>
			<span className="dl-chip">类别：设计</span>
			<span className="dl-chip">领域</span>
			<span className="dl-chip">用户未读 1</span>
			<span className="dl-chip">AI 未读 1</span>
			<span className="dl-search">搜索…</span>
		</div>
	);
}

/** 空间折叠栏（A 款，已定）。 */
function SkelFold(): React.ReactNode {
	return (
		<div className="dl-fold">
			<span className="dl-chip dl-chip--on">当前空间</span>
			<span className="dl-chip">隐藏已归档</span>
			<span className="dl-chip dl-chip--on">核心 12</span>
			<span className="dl-chip">代码</span>
			<span className="dl-chip">写作</span>
			<span className="dl-chip">调研</span>
			<span className="dl-chip">+</span>
		</div>
	);
}

/** 列表。 */
function SkelList(props: { readonly rows?: number }): React.ReactNode {
	const rows = props.rows ?? 3;
	return (
		<div className="dl-list">
			{Array.from({ length: rows }, function build(_, index) {
				return (
					<div className="dl-card" key={index}>
						<span className="dl-card__id">C-0{String(index + 3)}</span>
						<span className="dl-card__title">{index === 0 ? '详情面板：关系按钮要显眼' : index === 1 ? '窄 tab 里列表和详情怎么分？' : '窄版两栏比例要不要做成可拖的'}</span>
					</div>
				);
			})}
		</div>
	);
}

/** 详情。 */
function SkelDetail(props: { readonly compact?: boolean }): React.ReactNode {
	return (
		<div className={props.compact === true ? 'dl-detail dl-detail--compact' : 'dl-detail'}>
			<div className="dl-detail__head">
				<span className="dl-detail__title">详情面板：关系按钮要显眼</span>
				<span className="dl-detail__close">×</span>
			</div>
			<div className="dl-detail__meta">
				<span className="dl-chip">需要授权</span>
				<span className="dl-chip">设计</span>
				<span className="dl-chip">核心</span>
			</div>
			<div className="dl-detail__row">
				<span className="dl-btn">关系 0</span>
				<span className="dl-btn">派生任务</span>
			</div>
			<div className="dl-detail__block">可能的方向</div>
			<div className="dl-detail__block">知道什么信息后对决策有帮助</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   三个候选
   ══════════════════════════════════════════════════════════ */

/**
 * 候选 A · **双栏并排**：详情占右栏 38%，**挤压**列表（不是浮层）。
 *
 * ```
 * ┌ 工具栏 ──────────────────────────────┐
 * ┌ 筛选行 ──────────────────────────────┐
 * ┌ 空间折叠栏 ──────────────────────────┐
 * ┌ 列表 62% ──────────┬ 详情 38% ────────┐
 * └────────────────────┴──────────────────┘
 * ```
 */
export function DrawerLayoutA(): React.ReactNode {
	return (
		<div className="dl-stage" data-layout="A">
			<SkelToolbar />
			<SkelLegend />
			<SkelFilters />
			<SkelFold />
			<div className="dl-split">
				<div className="dl-split__main">
					<SkelList />
				</div>
				<div className="dl-split__side">
					<SkelDetail compact />
				</div>
			</div>
		</div>
	);
}

/**
 * 候选 B · **上下分栏**：列表在上、详情在下（抽屉高度矮，横向留给列表）。
 *
 * ```
 * ┌ 工具栏 ──────────────────────────────┐
 * ┌ 筛选行 ──────────────────────────────┐
 * ┌ 空间折叠栏 ──────────────────────────┐
 * ┌ 列表 ────────────────────────────────┐
 * ├ 详情（下半）────────────────────────┤
 * └──────────────────────────────────────┘
 * ```
 */
export function DrawerLayoutB(): React.ReactNode {
	return (
		<div className="dl-stage" data-layout="B">
			<SkelToolbar />
			<SkelLegend />
			<SkelFilters />
			<SkelFold />
			<div className="dl-stack">
				<div className="dl-stack__list">
					<SkelList rows={2} />
				</div>
				<div className="dl-stack__detail">
					<SkelDetail compact />
				</div>
			</div>
		</div>
	);
}

/**
 * 候选 C · **三栏**：空间侧栏（折叠后的 chips 竖排）+ 列表 + 详情。
 *
 * ```
 * ┌ 工具栏 ───────────────────────────────────┐
 * ┌ 筛选行 ───────────────────────────────────┐
 * ┌ 空间 ┬ 列表 40% ──────┬ 详情 38% ────────┐
 * │ 12px │                │                  │
 * └──────┴────────────────┴──────────────────┘
 * ```
 */
export function DrawerLayoutC(): React.ReactNode {
	return (
		<div className="dl-stage" data-layout="C">
			<SkelToolbar />
			<SkelLegend />
			<SkelFilters />
			<div className="dl-three">
				<div className="dl-three__rail">
					<span className="dl-chip dl-chip--on">核心 12</span>
					<span className="dl-chip">代码</span>
					<span className="dl-chip">写作</span>
					<span className="dl-chip">调研</span>
					<span className="dl-chip">+</span>
				</div>
				<div className="dl-three__list">
					<SkelList rows={2} />
				</div>
				<div className="dl-three__detail">
					<SkelDetail compact />
				</div>
			</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

function Candidate(props: {
	readonly id: string;
	readonly title: string;
	readonly note: string;
	readonly children: React.ReactNode;
}): React.ReactNode {
	return (
		<section className="dl-cand" data-cand={props.id}>
			<header className="dl-cand__head">
				<span className="dl-cand__id">{props.id}</span>
				<div>
					<div className="dl-cand__title">{props.title}</div>
					<div className="dl-cand__note">{props.note}</div>
				</div>
			</header>
			<div className="dl-cand__stage">{props.children}</div>
		</section>
	);
}

function App(): React.ReactNode {
	const [tab, setTab] = useState<'drawer' | 'workspace'>('drawer');

	return (
		<div className="dl">
			<h1 className="dl-title">布局候选 · 抽屉（横 1200×476）vs 工作区（竖 570×920）</h1>
			<div className="dl-sub">
				用户 2026-11-22：「抽屉和工作区<b>一横一竖不一样</b>。不是说图例这种元素就可以少了。」
				⇒ 下面三种都是<b>横向</b>布局（抽屉）；工作区沿用现有<b>上下</b>结构。每种都保留全套元素。
			</div>

			<div className="dl-tabs">
				<button type="button" className={tab === 'drawer' ? 'dl-tabs__on' : ''} onClick={() => { setTab('drawer'); }}>
					抽屉（横）
				</button>
				<button type="button" className={tab === 'workspace' ? 'dl-tabs__on' : ''} onClick={() => { setTab('workspace'); }}>
					工作区（竖）
				</button>
			</div>

			{tab === 'drawer' ? (
				<div className="dl-grid">
					<Candidate id="A" title="双栏并排（详情挤压列表）" note="列表 62% / 详情 38%，详情不是浮层。最贴近常规 IDE 布局。">
						<DrawerLayoutA />
					</Candidate>
					<Candidate id="B" title="上下分栏（列表上、详情下）" note="横向全给列表；详情在下半。抽屉矮（476）时纵向很挤。">
						<DrawerLayoutB />
					</Candidate>
					<Candidate id="C" title="三栏（空间侧栏 + 列表 + 详情）" note="空间 chips 竖排成左侧窄栏，腾出横向给列表+详情。">
						<DrawerLayoutC />
					</Candidate>
				</div>
			) : (
				<div className="dl-grid dl-grid--one">
					<Candidate id="竖" title="工作区（竖 570×920）：上下结构" note="工具栏 / 筛选行 / 空间折叠栏竖排；列表与详情用分隔条可拖（现有实现）。">
						<div className="dl-ws">
							<SkelToolbar />
			<SkelLegend />
							<SkelFilters />
							<SkelFold />
							<div className="dl-ws__body">
								<div className="dl-ws__list">
									<SkelList rows={2} />
								</div>
								<div className="dl-ws__handle" />
								<div className="dl-ws__detail">
									<SkelDetail compact />
								</div>
							</div>
						</div>
					</Candidate>
				</div>
			)}
		</div>
	);
}

injectPageStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

function injectPageStyles(): void {
	if (document.getElementById('dl-style') !== null) return;
	const STYLE = [
		'.dl{padding:20px 24px 60px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#16181d;background:#fff;min-height:100%}',
		'.dl-title{font-size:19px;margin:0 0 4px}',
		'.dl-sub{color:#5f6673;font-size:12.5px;margin-bottom:14px;max-width:960px}',
		'.dl-tabs{display:flex;gap:6px;margin-bottom:14px}',
		'.dl-tabs button{padding:5px 14px;border:1px solid #d7dbe2;border-radius:6px;background:#fff;font:inherit;font-size:12px;cursor:pointer;color:#374151}',
		'.dl-tabs button.dl-tabs__on{border-color:#2563eb;background:#eff6ff;color:#2563eb;font-weight:600}',
		'.dl-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}',
		'.dl-grid--one{grid-template-columns:minmax(0,1fr)}',
		'.dl-cand{border:1px solid #e7e9ee;border-radius:10px;overflow:hidden;background:#fff;min-width:0}',
		'.dl-cand__head{display:flex;gap:9px;padding:9px 12px;background:#f7f8fa;border-bottom:1px solid #eef0f3}',
		'.dl-cand__id{flex:0 0 auto;width:20px;height:20px;border-radius:50%;background:#2563eb;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}',
		'.dl-cand__title{font-weight:700;font-size:12.5px}',
		'.dl-cand__note{color:#5f6673;font-size:10.5px;line-height:1.45}',
		'.dl-cand__stage{padding:10px;background:#fbfcfd}',
		/* 骨架阶段 */
		'.dl-stage{border:1px solid #eef0f3;border-radius:8px;background:#fff;overflow:hidden;display:flex;flex-direction:column;gap:6px;padding:8px}',
		'.dl-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
		'.dl-toolbar__title{font-weight:700;font-size:11.5px}',
		'.dl-toolbar__actions{display:flex;gap:6px;margin-left:auto;align-items:center}',
		'.dl-chip{padding:2px 8px;border:1px solid #d7dbe2;border-radius:5px;background:#fff;font-size:10px;color:#5f6673;white-space:nowrap}',
		'.dl-chip--on{border-color:#93c5fd;background:#eff6ff;color:#1e40af;font-weight:600}',
		'.dl-seg{display:inline-flex;border:1px solid #d7dbe2;border-radius:5px;overflow:hidden;font-size:10px}',
		'.dl-seg span{padding:2px 7px;color:#5f6673}',
		'.dl-seg__on{background:#16181d;color:#fff !important}',
		'.dl-primary{padding:3px 10px;border-radius:5px;background:#16181d;color:#fff;font-size:10px;font-weight:600}',
		'.dl-filters{display:flex;flex-wrap:wrap;gap:5px;align-items:center}',
		'.dl-legend{display:flex;flex-wrap:wrap;align-items:center;gap:4px 9px;font-size:10px;color:#5f6673}',
		'.dl-legend__label{font-weight:600;color:#374151}',
		'.dl-legend__item{display:inline-flex;align-items:center;gap:4px}',
		'.dl-legend__line{display:inline-block;width:16px;height:2px;border-radius:1px;background:#9aa1ad}',
		'.dl-legend__line[data-rel=derives]{background:#94a3b8}',
		'.dl-legend__line[data-rel=depends]{background:#d97706}',
		'.dl-legend__line[data-rel=supersedes]{background:#7c3aed}',
		'.dl-legend__line[data-rel=constrains]{background:#dc2626}',
		'.dl-legend__line[data-rel=related]{background:#16a34a}',
		'.dl-legend__line[data-rel=references]{background:transparent;border-top:1px dashed #9aa1ad;height:0}',
		'.dl-legend__hint{color:#9aa1ad}',
		'.dl-search{flex:1 1 100px;padding:3px 8px;border:1px solid #d7dbe2;border-radius:5px;font-size:10px;color:#9aa1ad}',
		'.dl-fold{display:flex;flex-wrap:wrap;gap:5px;padding:6px;border:1px solid #dbe5fb;border-radius:6px;background:#f8faff}',
		'.dl-list{display:flex;flex-direction:column;gap:5px;min-width:0}',
		'.dl-card{padding:6px 9px;border:2px solid #9aa1ad;border-radius:6px;font-size:10.5px;display:flex;gap:7px;align-items:baseline;min-width:0}',
		'.dl-card__id{color:#2563eb;font-weight:700;font-size:9.5px;flex:0 0 auto}',
		'.dl-card__title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
		'.dl-detail{border:1px solid #eef0f3;border-radius:7px;background:#fff;padding:8px;display:flex;flex-direction:column;gap:6px;min-width:0}',
		'.dl-detail--compact{padding:6px;gap:5px}',
		'.dl-detail__head{display:flex;align-items:baseline;gap:6px}',
		'.dl-detail__title{font-weight:700;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
		'.dl-detail__close{margin-left:auto;color:#9aa1ad;font-size:12px}',
		'.dl-detail__meta{display:flex;flex-wrap:wrap;gap:4px}',
		'.dl-detail__row{display:flex;gap:5px;flex-wrap:wrap}',
		'.dl-btn{padding:2px 8px;border:1px solid #d7dbe2;border-radius:5px;font-size:10px;color:#374151}',
		'.dl-detail__block{padding:6px 8px;border:1px solid #eef0f3;border-radius:5px;background:#fafbfc;font-size:10px;color:#5f6673}',
		/* A：双栏 */
		'.dl-split{display:flex;gap:6px;min-height:0;flex:1 1 auto}',
		'.dl-split__main{flex:1 1 62%;min-width:0}',
		'.dl-split__side{flex:0 0 38%;min-width:0}',
		/* B：上下 */
		'.dl-stack{display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-height:0}',
		'.dl-stack__list{flex:1 1 auto;min-height:0;overflow:hidden}',
		'.dl-stack__detail{flex:0 0 auto}',
		/* C：三栏 */
		'.dl-three{display:flex;gap:6px;flex:1 1 auto;min-height:0}',
		'.dl-three__rail{flex:0 0 78px;display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid #dbe5fb;border-radius:6px;background:#f8faff}',
		'.dl-three__rail .dl-chip{text-align:center}',
		'.dl-three__list{flex:1 1 40%;min-width:0}',
		'.dl-three__detail{flex:0 0 38%;min-width:0}',
		/* 竖：工作区 */
		'.dl-ws{border:1px solid #eef0f3;border-radius:8px;background:#fff;overflow:hidden;display:flex;flex-direction:column;gap:6px;padding:8px;max-width:570px;margin:0 auto}',
		'.dl-ws__body{display:flex;flex-direction:column;gap:6px;min-height:220px}',
		'.dl-ws__list{flex:1 1 auto;min-height:0}',
		'.dl-ws__handle{height:4px;border-radius:2px;background:#d7dbe2}',
		'.dl-ws__detail{flex:0 0 auto}',
	].join('\n');
	const style = document.createElement('style');
	style.id = 'dl-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}

