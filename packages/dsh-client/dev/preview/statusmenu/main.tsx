/**
 * StatusPill + StatusMenu 预览入口 —— 只在 `dev/preview/statusmenu/` 里，不碰根 `main.tsx`。
 *
 * 五块：
 *
 * ① **活的**：一个真胶囊 + 真菜单（受控状态），验「点开 / 点项 / 点外面收起」。
 * ② **静态按钮表矩阵**：四类 × 各状态，直接 `buttonsOf()` 渲染菜单（**常显**，不浮层），
 *    用来逐个断言「菜单项 = 按钮表」。
 * ③ **定位边界**：把胶囊贴在视口底部 / 右边，验「翻到上方」「不出左边界」。
 * ④ **空按钮表**：`actions: []`。
 * ⑤ **回调日志**：点了什么就是什么（`data-event`）。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { buttonsOf, type ButtonAction } from '@taskboard/protocol';

import { StatusPill } from '../../components/StatusPill.tsx';
import { StatusMenu } from '../../components/StatusMenu.tsx';
import { sectionsOf } from '../../pure/status-menu.ts';

/* ── ① 活的 ── */

interface LiveProps {
	readonly onEvent: (what: string) => void;
}

function Live(props: LiveProps): React.ReactNode {
	const [status, setStatus] = useState('TASK_STATE_SUBMITTED');
	const [open, setOpen] = useState(false);
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);

	const actions = buttonsOf('work', status as never, 'user');

	return (
		<section className="pv-block">
			<h2>① 活的：work / {status.replace('TASK_STATE_', '')}（点胶囊开菜单）</h2>
			<div className="pv-row" data-live-row>
				<span className="pv-k">状态</span>
				<span ref={setAnchor} data-live-anchor>
					<StatusPill
						status={status}
						open={open}
						onClick={() => {
							props.onEvent(`pill-toggle:${open ? 'close' : 'open'}`);
							setOpen((one) => !one);
						}}
					/>
				</span>
				{open ? (
					<StatusMenu
						actions={actions}
						anchor={anchor}
						onPick={(action) => {
							props.onEvent(`pick:${action.label}:${action.to}`);
							setStatus(action.to);
						}}
						onClose={() => {
							props.onEvent('close');
							setOpen(false);
						}}
					/>
				) : null}
			</div>
			<div className="pv-state">
				<div>
					<span className="pv-k">status</span>
					<code data-live-status>{status}</code>
				</div>
				<div>
					<span className="pv-k">open</span>
					<code data-live-open>{String(open)}</code>
				</div>
			</div>
		</section>
	);
}

/* ── ② 静态按钮表矩阵 ── */

interface Row {
	readonly key: string;
	readonly kind: string;
	readonly from: string;
}

const ROWS: readonly Row[] = [
	{ key: 'goal-draft', kind: 'goal', from: 'TASK_STATE_UNSPECIFIED' },
	{ key: 'work-submitted', kind: 'work', from: 'TASK_STATE_SUBMITTED' },
	{ key: 'work-working', kind: 'work', from: 'TASK_STATE_WORKING' },
	{ key: 'work-canceled', kind: 'work', from: 'TASK_STATE_CANCELED' },
	{ key: 'design-auth', kind: 'design', from: 'TASK_STATE_AUTH_REQUIRED' },
	{ key: 'record-auth', kind: 'record', from: 'TASK_STATE_AUTH_REQUIRED' },
	{ key: 'goal-canceled', kind: 'goal', from: 'TASK_STATE_CANCELED' },
];

/** 常显菜单（不浮层）—— 只借用 `sectionsOf()` 的渲染决定，用来逐项断言。 */
function Matrix(): React.ReactNode {
	return (
		<section className="pv-block">
			<h2>② 静态按钮表矩阵（常显，逐项断言）</h2>
			{ROWS.map((row) => {
				const actions = buttonsOf(row.kind, row.from as never, 'user');
				const sections = sectionsOf(actions);
				return (
					<div className="pv-case" key={row.key} data-scenario={row.key}>
						<div className="pv-case__note">
							{row.kind} / {row.from.replace('TASK_STATE_', '')} · {actions.length} 个按钮 ·{' '}
							{sections.length} 段
						</div>
						<div className="menu menu--static">
							{sections.length === 0 ? (
								<div className="menu__empty">这张卡现在没有可用的操作。</div>
							) : (
								sections.map((section, index) => (
									<div key={section.group} data-menu-group={section.group}>
										{index > 0 ? <div className="menu__divider" /> : null}
										{section.items.map((item) => {
											const cls = ['menu__item'];
											if (item.danger) cls.push('is-danger');
											return (
												<button
													key={`${item.action.from}->${item.action.to}`}
													type="button"
													className={cls.join(' ')}
													data-menu-item="1"
													data-menu-to={item.action.to}
													data-menu-danger={String(item.danger)}
												>
													<span className="menu__icon">{item.icon}</span>
													<span className="menu__label">{item.action.label}</span>
													{item.hint === '' ? null : (
														<span className="menu__hint">{item.hint}</span>
													)}
												</button>
											);
										})}
									</div>
								))
							)}
						</div>
					</div>
				);
			})}
		</section>
	);
}

/* ── ③ 定位边界 ── */

interface EdgeProps extends LiveProps {
	readonly which: 'bottom' | 'right';
	readonly label: string;
}

function Edge(props: EdgeProps): React.ReactNode {
	const [open, setOpen] = useState(false);
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const actions = buttonsOf('work', 'TASK_STATE_SUBMITTED' as never, 'user');

	return (
		<div className={`pv-edge pv-edge--${props.which}`} data-edge={props.which}>
			<span className="pv-case__note">{props.label}</span>
			<span ref={setAnchor}>
				<StatusPill
					status="TASK_STATE_SUBMITTED"
					open={open}
					onClick={() => setOpen((one) => !one)}
				/>
			</span>
			{open ? (
				<StatusMenu
					actions={actions}
					anchor={anchor}
					onPick={() => setOpen(false)}
					onClose={() => {
						props.onEvent(`close:${props.which}`);
						setOpen(false);
					}}
				/>
			) : null}
		</div>
	);
}

/* ── ④ 空按钮表 ── */

function Empty(): React.ReactNode {
	const [open, setOpen] = useState(false);
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);

	return (
		<section className="pv-block" data-empty="1">
			<h2>④ 空按钮表（终结态，没有可点的项）</h2>
			<div className="pv-row">
				<span ref={setAnchor}>
					<StatusPill status="TASK_STATE_COMPLETED" open={open} onClick={() => setOpen((one) => !one)} />
				</span>
				<span className="pv-note">点开它 —— 菜单里应该只有一行「没有可用的操作」</span>
			</div>
			{open ? (
				<StatusMenu
					actions={[]}
					anchor={anchor}
					onPick={() => setOpen(false)}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</section>
	);
}

/* ── ⑤ App ── */

function App(): React.ReactNode {
	const [events, setEvents] = useState<readonly string[]>([]);
	const push = (what: string): void => setEvents((one) => [...one, what]);

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>StatusPill / StatusMenu</h1>
				<p>
					胶囊 = 圆点 + 状态名 + caret · 菜单项只有一个来源：<code>buttonsOf()</code> ·
					分组用 <code>groupOf(to)</code> 自己算（v3 没有 <code>group</code> 字段）
				</p>
			</header>

			<Live onEvent={push} />
			<Matrix />

			<section className="pv-block">
				<h2>③ 定位边界（翻到上方 / 不出左边界）</h2>
				<Edge which="bottom" label="胶囊贴在视口底部 ⇒ 菜单应翻到上方" onEvent={push} />
				<Edge which="right" label="胶囊贴在视口右侧 ⇒ 菜单应被窗口截、不甩到左边" onEvent={push} />
			</section>

			<Empty />

			<section className="pv-block">
				<h2>⑤ 回调日志</h2>
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
