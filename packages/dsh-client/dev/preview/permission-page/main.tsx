/**
 * 权限选择 —— **全屏页面** 候选。
 *
 * 用户 2026-11-22：
 * > 「权限选择只能在全屏下开一个页面。而且 mcp 方式接入的还不支持显示
 * >  （mcp 的 UI 本来和 dsh 做的 UI 入口就不一样）。」
 *
 * ⇒ 三个候选都是**整页**（不是模态/侧滑/页签），区别只在页面怎么组织：
 *   A · 单列居中（内容居中，最大宽 760）
 *   B · 左说明 / 右选择（双栏）
 *   C · 3×3 矩阵（两轴交叉，直接点格子）
 *
 * ```
 * node dev/preview/build.mjs permission-page
 * ```
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { PermissionPanel } from '../../../src/renderers/PermissionPanel.tsx';
import type { PanelState } from '../../../src/pure/permission-view.ts';
import { injectStyles } from '../../../src/styles.ts';

/* ══════════════════════════════════════════════════════════
   夹具
   ══════════════════════════════════════════════════════════ */

const CARD_OPTIONS = [
	{ value: 'no-claim', label: '不允许领取', description: 'AI 只能建卡、改草稿；不能领工作卡，也不能采纳。' },
	{ value: 'claim', label: '允许领取', description: 'AI 可以领工作卡；采纳仍需另开。' },
	{ value: 'adopt', label: '允许采纳草稿', description: 'AI 可以采纳草稿（未指定 → 提交）。' },
] as const;

const TOOL_OPTIONS = [
	{ value: 'off', label: '只读', description: 'AI 只能用只读工具。' },
	{ value: 'write', label: '可写', description: 'AI 可以建卡、改卡、转移。' },
	{ value: 'manage-edit', label: '允许编辑档位权限', description: 'AI 可以改工具权限档位（最高档）。' },
] as const;

function readyState(card: string, tool: string): PanelState {
	return {
		phase: 'ready',
		snapshot: {
			cardActionLevel: card,
			toolGuardLevel: tool,
			cardActionOptions: CARD_OPTIONS,
			toolGuardOptions: TOOL_OPTIONS,
		},
		pending: { card: null, tool: null },
		saveError: null,
	} as unknown as PanelState;
}

/* ══════════════════════════════════════════════════════════
   候选 A · 单列居中
   ══════════════════════════════════════════════════════════ */

/**
 * 候选 A —— 整页、内容**居中单列**（最大宽 760）。
 *
 * 最省事：把现有 `PermissionPanel` 原样放进全屏页，上下留白。
 */
export function PageA(): React.ReactNode {
	const [state, setState] = useState<PanelState>(readyState('no-claim', 'write'));

	return (
		<div className="pp-page pp-page--full" data-cand="A">
			<header className="pp-page__head">
				<h1 className="pp-page__title">任务板权限</h1>
				<button type="button" className="pp-page__back">
					← 返回任务板
				</button>
			</header>
			{/*
			 * 用户 2026-11-22 定稿：
			 * 「工具管控档位是做在 dsh 里面的，做在 agent 里面……所以 ui 不放这个。」
			 * 「按 A 做就行了。但是这个模态框小一点，让一个屏幕内就能显示全部内容。
			 *  并且不要用模态框，让他占满整个视图。」
			 *
			 * ⇒ 只有一条轴（card）+ 占满视图（不是模态）+ 一屏放下。
			 */}
			<div className="pp-page__center">
				<PermissionPanel
					axes={['card']}
					state={state}
					onSelect={(axis, value) => {
						setState(function patch(current) {
							if (current.phase !== 'ready') return current;
							const next = { ...current, snapshot: { ...current.snapshot } };
							if (axis === 'card') (next.snapshot as { cardActionLevel: string }).cardActionLevel = value;
							else (next.snapshot as { toolGuardLevel: string }).toolGuardLevel = value;
							return next;
						});
					}}
					onRetry={() => {
						setState(readyState('no-claim', 'write'));
					}}
				/>
			</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   候选 B · 左说明 / 右选择
   ══════════════════════════════════════════════════════════ */

/**
 * 候选 B —— 整页**双栏**：左栏放解释（这两条轴是什么、影响谁），右栏放选择。
 */
export function PageB(): React.ReactNode {
	const [state, setState] = useState<PanelState>(readyState('no-claim', 'write'));

	return (
		<div className="pp-page pp-page--split" data-cand="B">
			<aside className="pp-side">
				<h1 className="pp-side__title">任务板权限</h1>
				<p className="pp-side__text">
					AI 能做什么、任务板管不管工具 —— 两条互相独立的轴，各选一档。
				</p>
				<div className="pp-side__card">
					<div className="pp-side__card-title">① 卡片动作档位</div>
					<div className="pp-side__card-text">
						AI 能不能领取工作卡、能不能自己采纳草稿。这一轴任何宿主都生效（MCP 也管它）。
					</div>
				</div>
				<div className="pp-side__card">
					<div className="pp-side__card-title">② 工具管控档位</div>
					<div className="pp-side__card-text">
						任务板要不要按档位拦工具调用。只有能拦工具的宿主（如 DSH）才有这一轴。
					</div>
				</div>
				<p className="pp-side__note">两轴互不覆盖：任意组合都有效（3 × 3 = 9 种结果）。</p>
			</aside>
			<main className="pp-main">
				<PermissionPanel
					state={state}
					onSelect={(axis, value) => {
						setState(function patch(current) {
							if (current.phase !== 'ready') return current;
							const next = { ...current, snapshot: { ...current.snapshot } };
							if (axis === 'card') (next.snapshot as { cardActionLevel: string }).cardActionLevel = value;
							else (next.snapshot as { toolGuardLevel: string }).toolGuardLevel = value;
							return next;
						});
					}}
					onRetry={() => {
						setState(readyState('no-claim', 'write'));
					}}
				/>
			</main>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   候选 C · 3×3 矩阵
   ══════════════════════════════════════════════════════════ */

/**
 * 候选 C —— 整页**矩阵**：行 = 卡片动作档位、列 = 工具管控档位，点格子直接选组合。
 *
 * 好处：一眼看完 9 种组合、当前在哪一格；坏处：每格的解释塞不进格子。
 */
export function PageC(): React.ReactNode {
	const [card, setCard] = useState('no-claim');
	const [tool, setTool] = useState('write');

	return (
		<div className="pp-page" data-cand="C">
			<header className="pp-page__head">
				<h1 className="pp-page__title">任务板权限 · 矩阵</h1>
				<button type="button" className="pp-page__back">
					← 返回任务板
				</button>
			</header>

			<div className="pp-matrix-wrap">
				<table className="pp-matrix">
					<thead>
						<tr>
							<th />
							{TOOL_OPTIONS.map(function head(option) {
								return (
									<th key={option.value} className={tool === option.value ? 'is-col' : ''}>
										{option.label}
									</th>
								);
							})}
						</tr>
					</thead>
					<tbody>
						{CARD_OPTIONS.map(function row(cardOption) {
							return (
								<tr key={cardOption.value}>
									<th className={card === cardOption.value ? 'is-row' : ''}>{cardOption.label}</th>
									{TOOL_OPTIONS.map(function cell(toolOption) {
										const on = card === cardOption.value && tool === toolOption.value;
										return (
											<td key={toolOption.value}>
												<button
													type="button"
													className={on ? 'pp-cell is-on' : 'pp-cell'}
													data-combo={`${cardOption.value}|${toolOption.value}`}
													onClick={() => {
														setCard(cardOption.value);
														setTool(toolOption.value);
													}}
												>
													{on ? '● 当前' : '○'}
												</button>
											</td>
										);
									})}
								</tr>
							);
						})}
					</tbody>
				</table>
				<div className="pp-matrix-note">
					当前：卡片动作 = <b>{CARD_OPTIONS.find((one) => one.value === card)?.label}</b> ／ 工具管控 ={' '}
					<b>{TOOL_OPTIONS.find((one) => one.value === tool)?.label}</b>
				</div>
			</div>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

function App(): React.ReactNode {
	return (
		<div className="pp tb3w-root">
			<h1 className="pp-title">权限选择 · 全屏页面 · 3 个候选</h1>
			<div className="pp-sub">
				用户 2026-11-22：「权限选择只能在全屏下开一个页面。而且 mcp 方式接入的还不支持显示。」
				⇒ 三个都是<b>整页</b>（不是模态/侧滑/页签），区别在页面组织方式。
			</div>

			<div className="pp-tabs">
				<span className="pp-tabs__on">A 单列居中</span>
				<span>B 左说明 / 右选择</span>
				<span>C 3×3 矩阵</span>
			</div>

			<div className="pp-stack">
				<section className="pp-cand" data-cand-box="A">
					<header className="pp-cand__head">A · 单列居中（复用 PermissionPanel，上下留白）</header>
					<PageA />
				</section>
				<section className="pp-cand" data-cand-box="B">
					<header className="pp-cand__head">B · 左说明 / 右选择（双栏）</header>
					<PageB />
				</section>
				<section className="pp-cand" data-cand-box="C">
					<header className="pp-cand__head">C · 3×3 矩阵（点格子选组合）</header>
					<PageC />
				</section>
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
	if (document.getElementById('pp-style') !== null) return;
	const STYLE = [
		'.pp{padding:20px 24px 60px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#16181d;background:#fff;min-height:100%}',
		'.pp-title{font-size:19px;margin:0 0 4px}',
		'.pp-sub{color:#5f6673;font-size:12.5px;margin-bottom:14px;max-width:960px}',
		'.pp-tabs{display:flex;gap:8px;margin-bottom:14px;font-size:12px;color:#5f6673}',
		'.pp-tabs__on{color:#2563eb;font-weight:700}',
		'.pp-stack{display:flex;flex-direction:column;gap:18px}',
		'.pp-cand{border:1px solid #e7e9ee;border-radius:10px;overflow:hidden;background:#fbfcfd}',
		'.pp-cand__head{padding:8px 12px;background:#f7f8fa;border-bottom:1px solid #eef0f3;font-weight:700;font-size:12px}',
		/* 全屏页面骨架 */
		'.pp-page{background:#fff;min-height:420px;display:flex;flex-direction:column}',
		'.pp-page--full{min-height:100vh;max-width:860px;margin:0 auto}',
		'.pp-page--full .pp-page__center{padding:28px 20px}',
		'.pp-page__head{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid #eef0f3}',
		'.pp-page__title{font-size:16px;margin:0}',
		'.pp-page__back{margin-left:auto;padding:4px 12px;border:1px solid #d7dbe2;border-radius:6px;background:#fff;font:inherit;font-size:11.5px;color:#374151;cursor:pointer}',
		'.pp-page__center{padding:22px 20px;display:flex;justify-content:center}',
		'.pp-page__center > *{max-width:760px;width:100%}',
		/* B：双栏 */
		'.pp-page--split{flex-direction:row;align-items:stretch}',
		'.pp-side{flex:0 0 38%;padding:20px;border-right:1px solid #eef0f3;background:#fbfcfd}',
		'.pp-side__title{font-size:16px;margin:0 0 8px}',
		'.pp-side__text{font-size:12px;color:#5f6673;margin:0 0 14px}',
		'.pp-side__card{padding:10px 12px;border:1px solid #e7e9ee;border-radius:8px;background:#fff;margin-bottom:10px}',
		'.pp-side__card-title{font-weight:700;font-size:12px;margin-bottom:4px}',
		'.pp-side__card-text{font-size:11.5px;color:#5f6673;line-height:1.5}',
		'.pp-side__note{font-size:11px;color:#9aa1ad;margin:14px 0 0}',
		'.pp-main{flex:1 1 auto;padding:20px;min-width:0}',
		/* C：矩阵 */
		'.pp-matrix-wrap{padding:20px}',
		'.pp-matrix{border-collapse:separate;border-spacing:6px}',
		'.pp-matrix th{font-size:11.5px;color:#5f6673;font-weight:600;padding:4px 8px;text-align:center}',
		'.pp-matrix th.is-col,.pp-matrix th.is-row{color:#2563eb}',
		'.pp-cell{width:100%;min-width:96px;padding:10px 8px;border:1px solid #d7dbe2;border-radius:8px;background:#fff;font:inherit;font-size:11px;color:#9aa1ad;cursor:pointer}',
		'.pp-cell:hover{border-color:#93c5fd;background:#f8faff}',
		'.pp-cell.is-on{border-color:#2563eb;background:#eff6ff;color:#2563eb;font-weight:700}',
		'.pp-matrix-note{margin-top:12px;font-size:12px;color:#374151}',
	].join('\n');
	const style = document.createElement('style');
	style.id = 'pp-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}
