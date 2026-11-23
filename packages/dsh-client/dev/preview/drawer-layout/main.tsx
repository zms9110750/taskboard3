/**
 * 抽屉布局 · 3 个候选 —— **用真 `Workspace` 组件**，不画骨架。
 *
 * 用户 2026-11-22 要求：「预览组件对部分组件的引用，如果已经写了独立组件，
 * 引用真实的独立组件而不是用假的。」
 *
 * ⇒ 本页不再用假的 `SkelToolbar` / `SkelLegend` / `SkelList` / `SkelDetail`，
 *   直接渲染产品里的 `Workspace`（工具栏 / 图例 / 筛选行 / 空间折叠栏 / 列表 /
 *   详情 / 卡片行 / 科技树 全是真组件），只把**布局关系**用 CSS 覆盖改掉。
 *
 * 三种横向布局（抽屉 1200×476）：
 *   A · 双栏并排 —— 详情占右栏 38%，挤压列表（不是浮层）
 *   B · 上下分栏 —— 列表上、详情下
 *   C · 三栏 —— 空间 chips 竖排成左侧窄栏
 *
 * ```
 * node dev/preview/build.mjs drawer-layout
 * ```
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

/* 注册表初始化 —— Section 的内容分发查的是运行时注册表（2026-11-22）。 */
import { initRenderers } from '../../../src/init-renderers.ts';

import { injectStyles } from '../../../src/styles.ts';
import { Workspace } from '../../../src/renderers/Workspace.tsx';
import type { Card, Workspace as SpaceEntity } from '../../../src/types.ts';
import type { Picked } from '../../../src/pure/filter-box.ts';
import {
	CARDS,
	DEFAULT_PICKED,
	KIND_LABELS,
	TEMPLATES,
	WORKSPACES,
} from '../vp-drawer/main.tsx';

/* ══════════════════════════════════════════════════════════
   一个可复用的舞台（真实尺寸 + 真组件）
   ══════════════════════════════════════════════════════════ */

/** 舞台属性。 */
interface StageProps {
	/** 布局 id（A / B / C），决定 CSS 覆盖类。 */
	readonly layout: 'A' | 'B' | 'C';
	/** 宽（真实尺寸）。 */
	readonly width: number;
	/** 高（真实尺寸）。 */
	readonly height: number;
	/** 是否自动打开空间折叠栏（C 款要它当左侧栏）。 */
	readonly seedOpen?: boolean;
}

/**
 * 一个舞台 —— 里面是**真 `Workspace`**，只是外层加了布局覆盖类。
 *
 * @param props 见 `StageProps`
 */
function Stage(props: StageProps): React.ReactNode {
	const [workspaces, setWorkspaces] = useState<readonly SpaceEntity[]>(WORKSPACES);
	const [currentId, setCurrentId] = useState('core');
	const [viewingId, setViewingId] = useState('core');
	const [showArchived, setShowArchived] = useState(true);
	const [selectedId, setSelectedId] = useState<string | null>('C-03');

	/* C 款：自动打开空间折叠栏（它要当左侧栏）。 */
	useEffect(() => {
		if (props.seedOpen !== true) return;
		const timer = globalThis.setTimeout(() => {
			const toggle = document.querySelector(`.dl-stage--${props.layout} [data-space-toggle]`);
			if (toggle instanceof HTMLElement && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
		}, 120);
		return () => {
			globalThis.clearTimeout(timer);
		};
	}, [props.layout, props.seedOpen]);

	return (
		<div
			className={`dl-stage dl-stage--${props.layout}`}
			data-layout={props.layout}
			style={{ width: `${String(props.width)}px`, height: `${String(props.height)}px` }}
		>
			<div className="dl-stage__inner">
				<Workspace
					workspaces={workspaces}
					currentId={currentId}
					viewingId={viewingId}
					showArchived={showArchived}
					cards={CARDS}
					templates={TEMPLATES}
					selectedId={selectedId}
					defaultPicked={DEFAULT_PICKED}
					kindLabelOf={(kind) => KIND_LABELS[kind] ?? kind}
					aiUnreadCount={1}
					aiUpdatedCount={2}
					onView={(id) => {
						setViewingId(id);
					}}
					onToggleArchived={(id) => {
						setWorkspaces((prev) =>
							prev.map((one) => (one.id === id ? { ...one, archived: !one.archived } : one)),
						);
					}}
					onToggleShowArchived={() => {
						setShowArchived((prev) => !prev);
					}}
					onCreateWorkspace={() => {
						/* 预览：无服务端 */
					}}
					onSelect={(cardId) => {
						setSelectedId(cardId);
					}}
					onCreateCard={() => {
						/* 预览 */
					}}
					onFilterChange={() => {
						/* 预览：本地实时过滤已生效 */
					}}
					onSearchChange={() => {
						/* 预览 */
					}}
					onAction={() => {
						/* 预览 */
					}}
					onAddRelation={() => {
						/* 预览 */
					}}
					onDerive={() => {
						/* 预览 */
					}}
					onNoteChange={() => {
						/* 预览 */
					}}
					onOpenPermission={() => {
						/* 预览 */
					}}
					onExpandDetail={() => {
						/* 预览 */
					}}
				/>
			</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

/** 候选说明。 */
const NOTES: Readonly<Record<'A' | 'B' | 'C', string>> = {
	A: '双栏并排：详情占右栏 38%，挤压列表（不是浮层）。最贴近常规 IDE。',
	B: '上下分栏：列表上、详情下。抽屉只有 476 高，纵向会很挤。',
	C: '三栏：空间 chips 竖排成 78px 左侧窄栏，腾出横向给列表 + 详情。',
};

/** 候选标题。 */
const TITLES: Readonly<Record<'A' | 'B' | 'C', string>> = {
	A: '双栏并排（详情挤压列表）',
	B: '上下分栏（列表上、详情下）',
	C: '三栏（空间侧栏 + 列表 + 详情）',
};

function App(): React.ReactNode {

	return (
		<div className="dl">
			<h1 className="dl-title">抽屉布局 · 3 个候选（真组件，1200×476）</h1>
			<div className="dl-sub">
				用户 2026-11-22：「抽屉和工作区一横一竖不一样。不是说图例这种元素就可以少了。」
				⇒ 下面是<b>真 `Workspace`</b> 组件（工具栏 / 关系图例 / 筛选行 / 空间折叠栏 / 列表 / 详情全是真的），
				只把<b>布局关系</b>用 CSS 改掉。
			</div>

			<div className="dl-grid">
				{(['A', 'B', 'C'] as const).map((id) => (
					<section className="dl-cand" key={id} data-cand={id}>
						<header className="dl-cand__head">
							<span className="dl-cand__id">{id}</span>
							<div>
								<div className="dl-cand__title">{TITLES[id]}</div>
								<div className="dl-cand__note">{NOTES[id]}</div>
							</div>
						</header>
						<div className="dl-cand__stage">
							<Stage layout={id} width={1200} height={476} seedOpen={id === "C"} />
						</div>
					</section>
				))}
			</div>
		</div>
	);
}

injectStyles();
injectPageStyles();

initRenderers();
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
		'.dl-sub{color:#5f6673;font-size:12.5px;margin-bottom:16px;max-width:980px}',
		'.dl-grid{display:flex;flex-direction:column;gap:16px;align-items:stretch}',
		'.dl-cand{border:1px solid #e7e9ee;border-radius:10px;overflow:hidden;background:#fff;min-width:0}',
		'.dl-cand__head{display:flex;gap:9px;padding:9px 12px;background:#f7f8fa;border-bottom:1px solid #eef0f3}',
		'.dl-cand__id{flex:0 0 auto;width:20px;height:20px;border-radius:50%;background:#2563eb;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}',
		'.dl-cand__title{font-weight:700;font-size:12.5px}',
		'.dl-cand__note{color:#5f6673;font-size:10.5px;line-height:1.45}',
		'.dl-cand__stage{padding:10px;background:#fbfcfd;overflow:auto}',
		/* 舞台：真组件装进 340 宽的容器（原设计是 1200，这里等比缩到 340 以便三个并排看） */
		'.dl-stage{border:1px solid #eef0f3;border-radius:8px;overflow:hidden;background:#fff}',
		'.dl-stage__inner{width:100%;height:100%;overflow:hidden}',
		'.dl-stage .tb3w-page{padding:6px 8px}',
		/* 覆盖：让三种布局在同一个 1200 宽下都看得到 */
		'.dl-stage--B .tb3w-main{flex-direction:column}',
		'.dl-stage--B .tb3w-list{flex:0 0 52%}',
		'.dl-stage--B .tb3w-split{cursor:row-resize}',
		'.dl-stage--B .tb3w-detail{flex:1 1 0;min-width:0;max-width:none}',
		/* C 款：真三栏 —— 空间折叠栏挪到左侧当竖栏，chrome 和 main 在右列 */
		'.dl-stage--C .tb3w-page{display:grid;grid-template-columns:140px minmax(0,1fr);grid-template-rows:auto 1fr;column-gap:8px}',
		'.dl-stage--C .tb3w-chrome{grid-column:2;grid-row:1;min-width:0}',
		'.dl-stage--C .tb3w-space-fold{grid-column:1;grid-row:1 / 3;margin-top:0;overflow-y:auto;max-height:100%}',
		'.dl-stage--C .tb3w-space-fold .space-bar{flex-direction:column;align-items:stretch;gap:4px}',
		'.dl-stage--C .tb3w-space-fold .space-bar > *{width:100%;justify-content:center}',
		'.dl-stage--C .tb3w-main{grid-column:2;grid-row:2;margin-top:0;min-width:0}',
	].join('\n');
	const style = document.createElement('style');
	style.id = 'dl-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}
