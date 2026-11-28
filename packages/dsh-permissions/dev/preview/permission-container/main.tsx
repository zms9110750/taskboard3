/**
 * 权限面板的**容器形态**候选 —— 用户 2026-11-22：
 *
 * > 「权限面板有两个。一个在 UI 里面入口，一个注入在 dsh 界面上。
 * >   UI 里面的权限面板需要做独立组件给我候选。」
 * > 「权限选择只能在全屏下开一个页面。」
 *
 * ⚠ 面板**内容**是定稿的 `PermissionPanel`（`src/renderers/PermissionPanel.tsx`），
 *   这里只换**容器**：模态 / 右侧滑出 / 页签内嵌。内容不复制、不改。
 *
 * 全屏页面候选在 `dev/preview/permission-page/`。
 *
 * ```
 * node packages/dsh-client/dev/preview/build.mjs ../../../dsh-permissions/dev/preview/permission-container
 * ```
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { PermissionPanel } from '../../../src/renderers/PermissionPanel.tsx';
import type { PanelState } from '../../../src/pure/permission-view.ts';
import { injectStyles } from '../../../src/styles.ts';

/* ══════════════════════════════════════════════════════════
   夹具：一个 ready 状态的快照
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

function readyState(): PanelState {
	return {
		phase: 'ready',
		snapshot: {
			cardActionLevel: 'no-claim',
			toolGuardLevel: 'write',
			cardActionOptions: CARD_OPTIONS,
			toolGuardOptions: TOOL_OPTIONS,
		},
		pending: { card: null, tool: null },
		saveError: null,
	} as unknown as PanelState;
}

/* ══════════════════════════════════════════════════════════
   共用：触发器 + 面板
   ══════════════════════════════════════════════════════════ */

/** 面板内容（受控 state，点选只改本地 —— 预览不连网）。 */
function PanelBody(props: { readonly onClose: () => void }): React.ReactNode {
	const [state, setState] = useState<PanelState>(readyState);

	return (
		<div className="pc-body">
			<button type="button" className="pc-close" onClick={props.onClose}>
				×
			</button>
			<PermissionPanel
				state={state}
				onSelect={(axis, value) => {
					/* 预览：只把选中的值写进快照，不模拟网络。 */
					setState(function patch(current) {
						if (current.phase !== 'ready') return current;
						const next = { ...current, snapshot: { ...current.snapshot } };
						if (axis === 'card') (next.snapshot as { cardActionLevel: string }).cardActionLevel = value;
						else (next.snapshot as { toolGuardLevel: string }).toolGuardLevel = value;
						return next;
					});
				}}
				onRetry={() => {
					setState(readyState());
				}}
			/>
		</div>
	);
}

/** 触发器 —— 每个候选一样的外观。 */
function Trigger(props: { readonly onClick: () => void }): React.ReactNode {
	return (
		<button type="button" className="pc-trigger" data-trigger onClick={props.onClick}>
			权限与约定
		</button>
	);
}

/* ══════════════════════════════════════════════════════════
   候选 A · 模态弹窗
   ══════════════════════════════════════════════════════════ */

/**
 * 候选 A —— 点「权限与约定」→ **居中模态弹窗 + 半透明遮罩**。
 *
 * 适合：面板内容不长（两轴各一档），看完就关。
 */
export function ContainerA(): React.ReactNode {
	const [open, setOpen] = useState(true);

	return (
		<div className="pc-root" data-cand="A">
			<Trigger
				onClick={() => {
					setOpen(true);
				}}
			/>
			{open ? (
				<div className="pc-overlay" data-overlay>
					<div className="pc-modal" data-modal>
						<PanelBody
							onClose={() => {
								setOpen(false);
							}}
						/>
					</div>
				</div>
			) : null}
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   候选 B · 右侧滑出面板
   ══════════════════════════════════════════════════════════ */

/**
 * 候选 B —— 点「权限与约定」→ **从右侧滑出一块 420px 面板**，遮罩压暗其余部分。
 *
 * 适合：和右侧工作区的空间关系一致（都在右边）。
 */
export function ContainerB(): React.ReactNode {
	const [open, setOpen] = useState(true);

	return (
		<div className="pc-root" data-cand="B">
			<Trigger
				onClick={() => {
					setOpen(true);
				}}
			/>
			{open ? (
				<div className="pc-overlay pc-overlay--right" data-overlay>
					<div className="pc-drawer" data-modal>
						<PanelBody
							onClose={() => {
								setOpen(false);
							}}
						/>
					</div>
				</div>
			) : null}
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   候选 C · 页签内嵌
   ══════════════════════════════════════════════════════════ */

/**
 * 候选 C —— **不开浮层**：右侧页签多一个「权限」页签，内容和「任务板」并列。
 *
 * 适合：用户想边看卡边改权限，不想被遮罩挡住。
 */
export function ContainerC(): React.ReactNode {
	const [tab, setTab] = useState<'board' | 'permission'>('permission');

	return (
		<div className="pc-root pc-root--tabs" data-cand="C">
			<div className="pc-tabs">
				<button
					type="button"
					className={tab === 'board' ? 'pc-tabs__btn is-on' : 'pc-tabs__btn'}
					onClick={() => {
						setTab('board');
					}}
				>
					任务板
				</button>
				<button
					type="button"
					className={tab === 'permission' ? 'pc-tabs__btn is-on' : 'pc-tabs__btn'}
					data-perm-tab
					onClick={() => {
						setTab('permission');
					}}
				>
					权限与约定
				</button>
			</div>
			<div className="pc-tabbody">
				{tab === 'permission' ? (
					<PanelBody
						onClose={() => {
							setTab('board');
						}}
					/>
				) : (
					<div className="pc-placeholder">（任务板内容 — 略）</div>
				)}
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
		<section className="pc-cand" data-cand-box={props.id}>
			<header className="pc-cand__head">
				<span className="pc-cand__id">{props.id}</span>
				<div>
					<div className="pc-cand__title">{props.title}</div>
					<div className="pc-cand__note">{props.note}</div>
				</div>
			</header>
			<div className="pc-cand__stage">{props.children}</div>
		</section>
	);
}

function App(): React.ReactNode {
	return (
		<div className="pc tb3w-root">
			<h1 className="pc-title">权限面板 · 容器形态 · 3 个候选</h1>
			<div className="pc-sub">
				内容都是定稿的 <code>PermissionPanel</code>（两条正交轴，点哪档立刻保存）。
				这里只换<b>容器</b>：A 模态 / B 右侧滑出 / C 页签内嵌。全屏页面候选另见
				<code>permission-page</code>。
			</div>

			<div className="pc-grid">
				<Candidate id="A" title="模态弹窗" note="居中 + 遮罩。最简单，看完就关。">
					<ContainerA />
				</Candidate>
				<Candidate id="B" title="右侧滑出面板" note="从右边滑出 420px。和工作区在同一侧。">
					<ContainerB />
				</Candidate>
				<Candidate id="C" title="页签内嵌" note="不开浮层，右侧页签多一页。边看卡边改。">
					<ContainerC />
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
	if (document.getElementById('pc-style') !== null) return;
	const STYLE = [
		'.pc{padding:20px 24px 60px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#16181d;background:#fff;min-height:100%}',
		'.pc-title{font-size:19px;margin:0 0 4px}',
		'.pc-sub{color:#5f6673;font-size:12.5px;margin-bottom:16px;max-width:900px}',
		'.pc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:start}',
		'.pc-cand{border:1px solid #e7e9ee;border-radius:10px;overflow:hidden;background:#fff;min-width:0}',
		'.pc-cand__head{display:flex;gap:9px;padding:9px 12px;background:#f7f8fa;border-bottom:1px solid #eef0f3}',
		'.pc-cand__id{flex:0 0 auto;width:20px;height:20px;border-radius:50%;background:#2563eb;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}',
		'.pc-cand__title{font-weight:700;font-size:12.5px}',
		'.pc-cand__note{color:#5f6673;font-size:10.5px;line-height:1.45}',
		'.pc-cand__stage{position:relative;padding:10px;background:#fbfcfd;min-height:300px}',
		/* 触发器 */
		'.pc-trigger{padding:5px 12px;border:1px solid #d7dbe2;border-radius:6px;background:#fff;font:inherit;font-size:11.5px;cursor:pointer;color:#374151}',
		'.pc-trigger:hover{border-color:#2563eb;color:#2563eb}',
		/* 遮罩 + 容器 */
		'.pc-overlay{position:absolute;inset:0;background:rgb(15 23 42 / 32%);display:flex;align-items:center;justify-content:center;padding:14px;z-index:10}',
		'.pc-overlay--right{justify-content:flex-end;padding:0}',
		'.pc-modal{position:relative;max-width:100%;max-height:100%;overflow:auto;background:#fff;border-radius:10px;box-shadow:0 10px 30px rgb(15 23 42 / 22%);padding:12px}',
		'.pc-drawer{position:relative;height:100%;width:420px;max-width:100%;overflow:auto;background:#fff;box-shadow:-8px 0 24px rgb(15 23 42 / 18%);padding:12px}',
		'.pc-body{position:relative}',
		'.pc-close{position:absolute;top:-4px;right:-4px;z-index:2;width:22px;height:22px;border:0;border-radius:50%;background:#eef0f3;color:#5f6673;font-size:13px;cursor:pointer}',
		/* 页签 */
		'.pc-root--tabs{border:1px solid #eef0f3;border-radius:8px;background:#fff;overflow:hidden}',
		'.pc-tabs{display:flex;border-bottom:1px solid #eef0f3;background:#f7f8fa}',
		'.pc-tabs__btn{padding:6px 14px;border:0;background:transparent;font:inherit;font-size:11.5px;color:#5f6673;cursor:pointer}',
		'.pc-tabs__btn.is-on{color:#16181d;font-weight:700;box-shadow:inset 0 -2px 0 #2563eb}',
		'.pc-tabbody{padding:12px}',
		'.pc-placeholder{padding:30px;text-align:center;color:#9aa1ad;font-size:11.5px}',
	].join('\n');
	const style = document.createElement('style');
	style.id = 'pc-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}
