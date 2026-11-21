/**
 * 空间选择器「折叠隐藏栏」的三个候选 —— 并排看。
 *
 * ```
 * node dev/preview/build.mjs space-fold
 * ```
 *
 * 用户 2026-11-21：
 * > 「工作空间点开以后应该是打开折叠的隐藏栏，而不是悬浮窗。」
 *
 * 三个候选都是「展开一块区域、推挤下面内容」，区别只在展开区的位置与外观：
 *   A · 工具栏**下一行**整行展开
 *   B · 工具栏**内联**展开（工具栏变高）
 *   C · **全宽面板**（带标题条 + 收起按钮）
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { SpaceFoldA, SpaceFoldB, SpaceFoldC } from '../../components/space-fold.tsx';
import { injectStyles } from '../../../src/styles.ts';
import type { Workspace } from '../../../src/types.ts';

/* ══════════════════════════════════════════════════════════
   夹具
   ══════════════════════════════════════════════════════════ */

/**
 * 造 N 个空间 —— 用户 2026-11-22：
 * 「这个给我看工作空间多到溢出的时候是什么样子的」
 *
 * 前 6 个是真实名字（好看清选中态），后面按序号生成。
 */
function makeWorkspaces(count: number): readonly Workspace[] {
	const REAL = ['开发任务板', '设计稿', '运维值班', '旧项目归档', '重构计划', '线上问题'];
	return Array.from({ length: count }, function build(_, index) {
		return {
			id: `W${String(index + 1)}`,
			displayName: REAL[index] ?? `空间 ${String(index + 1)}`,
			createdAt: index + 1,
			archived: index === 3,
		} as Workspace;
	});
}

/** 一份 state 喂三个候选 —— 点哪个都会同步。 */
function useSpaceState(count: number): {
	readonly workspaces: readonly Workspace[];
	readonly currentId: string;
	readonly viewingId: string;
	readonly showArchived: boolean;
	readonly cardCount: number;
	readonly onView: (id: string) => void;
	readonly onToggleArchived: (id: string) => void;
	readonly onToggleShowArchived: () => void;
	readonly onCreate: () => void;
} {
	const [viewingId, setViewingId] = useState('W1');
	const [currentId, setCurrentId] = useState('W1');
	const [showArchived, setShowArchived] = useState(false);
	const [created, setCreated] = useState<readonly Workspace[]>([]);

	const workspaces = [...makeWorkspaces(count), ...created];

	return {
		workspaces,
		currentId,
		viewingId,
		showArchived,
		cardCount: 12,
		onView: setViewingId,
		onToggleArchived: (id) => {
			/* 预览里不真改 workspace 的 archived（它是 readonly 夹具）。 */
			void id;
		},
		onToggleShowArchived: () => {
			setShowArchived((now) => !now);
		},
		onCreate: () => {
			setCreated((now) => [...now, { id: `W${String(10 + now.length)}`, displayName: `新空间 ${String(now.length + 1)}`, archived: false } as Workspace]);
		},
	};
}

/* ══════════════════════════════════════════════════════════
   一栏
   ══════════════════════════════════════════════════════════ */

function Candidate(props: {
	readonly id: 'A' | 'B' | 'C';
	readonly title: string;
	readonly note: string;
	readonly children: React.ReactNode;
}): React.ReactNode {
	return (
		<section className="sfc" data-cand={props.id}>
			<header className="sfc__head">
				<span className="sfc__id">{props.id}</span>
				<div className="sfc__text">
					<div className="sfc__title">{props.title}</div>
					<div className="sfc__note">{props.note}</div>
				</div>
			</header>
			<div className="sfc__stage">{props.children}</div>
		</section>
	);
}

function App(): React.ReactNode {
	const [count, setCount] = useState(6);
	const state = useSpaceState(count);

	return (
		<div className="sf tb3w-root">
			<h1 className="sf-title">空间选择器 · 折叠隐藏栏 · 3 个候选</h1>
			<div className="sf-sub">
				现状是<b>悬浮窗</b>（<code>.tb3w-space-pop</code>，绝对定位、盖住内容）。
				下面三个都是<b>展开、推挤下面内容</b>。点「工作空间 ▾」开关各栏，三个候选共享同一份空间 state。
			</div>

			{/*
			 * 空间数量开关 —— 用户 2026-11-22：
			 * 「给我看工作空间多到溢出的时候是什么样子的」
			 */}
			<div className="sf-counts">
				<span className="sf-counts__label">空间数量：</span>
				{[3, 6, 12, 24].map(function one(n) {
					return (
						<button
							key={n}
							type="button"
							className={count === n ? 'sf-counts__btn is-on' : 'sf-counts__btn'}
							data-count-btn={n}
							onClick={() => {
								setCount(n);
							}}
						>
							{String(n)} 个
						</button>
					);
				})}
				<span className="sf-counts__note">（点「工作空间 ▾」开合；看溢出时三个候选各自怎么换行/滚动）</span>
			</div>

			<div className="sf-grid">
				<Candidate
					id="A"
					title="工具栏下一行整行展开"
					note="展开区占满宽度、在工具栏下面；筛选行被推下去。最接近「折叠栏」。"
				>
					<SpaceFoldA {...state} />
				</Candidate>
				<Candidate
					id="B"
					title="工具栏内联展开"
					note="空间 chips 插进工具栏内部，工具栏自然变高。省垂直空间，但工具栏会变高。"
				>
					<SpaceFoldB {...state} />
				</Candidate>
				<Candidate
					id="C"
					title="全宽面板（带标题条 + 收起）"
					note="展开区有「工作空间」标题条和「收起」按钮，像个独立一层，最多余但最清晰。"
				>
					<SpaceFoldC {...state} />
				</Candidate>
			</div>
		</div>
	);
}

injectStyles();
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
	if (document.getElementById('sf-style') !== null) return;
	const STYLE = [
		'.sf{padding:20px 24px 60px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#16181d;background:#fff;min-height:100%}',
		'.sf-title{font-size:19px;margin:0 0 4px}',
		'.sf-sub{color:#5f6673;font-size:12.5px;margin-bottom:18px;max-width:900px}',
		'.sf-counts{display:flex;align-items:center;gap:6px;margin:0 0 14px;flex-wrap:wrap}',
		'.sf-counts__label{font-size:12px;color:#5f6673}',
		'.sf-counts__btn{padding:4px 12px;border:1px solid #d7dbe2;border-radius:6px;background:#fff;font:inherit;font-size:11.5px;cursor:pointer;color:#374151}',
		'.sf-counts__btn.is-on{border-color:#2563eb;background:#eff6ff;color:#2563eb;font-weight:600}',
		'.sf-counts__note{font-size:11px;color:#9aa1ad}',
		'.sf-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}',
		'.sfc{border:1px solid #e7e9ee;border-radius:10px;overflow:hidden;min-width:0;background:#fff}',
		'.sfc__head{display:flex;gap:9px;padding:9px 12px;background:#f7f8fa;border-bottom:1px solid #eef0f3}',
		'.sfc__id{flex:0 0 auto;width:20px;height:20px;border-radius:50%;background:#2563eb;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}',
		'.sfc__text{min-width:0}',
		'.sfc__title{font-weight:700;font-size:12.5px}',
		'.sfc__note{color:#5f6673;font-size:10.5px;line-height:1.45}',
		'.sfc__stage{padding:10px 10px 14px;background:#fbfcfd}',
		/* 模拟工具栏 */
		'.sf-root{border:1px solid #eef0f3;border-radius:8px;background:#fff;overflow:hidden}',
		'.sf-toolbar{display:flex;align-items:center;gap:8px;padding:8px 10px;flex-wrap:wrap}',
		'.sf-toolbar--wrap{row-gap:6px}',
		'.sf-toolbar__title{font-weight:700;font-size:11.5px;white-space:nowrap}',
		'.sf-toolbar__count{font-weight:400;color:#5f6673;font-size:10.5px}',
		'.sf-toolbar__actions{display:flex;align-items:center;gap:7px;margin-left:auto;flex-wrap:wrap}',
		'.sf-seg{display:inline-flex;border:1px solid #d7dbe2;border-radius:6px;overflow:hidden}',
		'.sf-seg__btn{padding:3px 10px;border:0;background:#fff;font:inherit;font-size:10.5px;cursor:pointer;color:#5f6673}',
		'.sf-seg__btn.is-on{background:#16181d;color:#fff}',
		'.sf-btn-primary{padding:4px 12px;border:0;border-radius:6px;background:#16181d;color:#fff;font:inherit;font-size:10.5px;font-weight:600;cursor:pointer}',
		'.sf-pill{padding:3px 10px;border:1px solid #d7dbe2;border-radius:6px;background:#fff;font:inherit;font-size:10.5px;color:#5f6673;cursor:pointer}',
		'.sf-filters{display:flex;flex-wrap:wrap;gap:6px;padding:0 10px 8px}',
		'.sf-list{display:flex;flex-direction:column;gap:6px;padding:0 10px 10px}',
		'.sf-card{padding:7px 10px;border:2px solid #9aa1ad;border-radius:7px;font-size:11px}',
		/* 折叠区三种形态 */
		'.sf-fold{background:#f8faff;border-top:1px solid #dbe5fb;border-bottom:1px solid #dbe5fb}',
		'.sf-fold--row{padding:8px 10px}',
		'.sf-fold--inline{flex:1 0 100%;padding:6px 0 2px;background:transparent;border:0;order:-1}',
		'.sf-fold--panel{margin:0 0 8px}',
		'.sf-fold__head{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #dbe5fb;background:#eff4fe}',
		'.sf-fold__label{font-weight:700;font-size:11px;color:#1e40af}',
		'.sf-fold__close{margin-left:auto;padding:2px 8px;border:1px solid #c7d7f5;border-radius:5px;background:#fff;font:inherit;font-size:10.5px;color:#1e40af;cursor:pointer}',
		'.sf-fold__body{padding:8px 10px}',
		/* 开关按钮 */
		'.tb3w-root .tb3w-space-toggle.is-open{color:#2563eb;border-color:#93c5fd;background:#eff6ff}',
		'.tb3w-space-toggle__caret{margin-left:5px;font-size:9px}',
	].join('\n');
	const style = document.createElement('style');
	style.id = 'sf-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}
