/**
 * SpaceBar 预览入口 —— **只在 `dev/preview/spacebar/` 里，不碰根 `main.tsx`**。
 *
 * 两段：
 *
 * ① **活的一行**（受控状态）—— 用来验「点 chip 只改 viewing，不改 current」。
 * ② **静态矩阵** —— 五个场景，每个场景一套固定状态，用来验那张表的
 *    按钮文案 / `disabled` / 点下去派发哪个回调。
 *
 * 之所以要 ② 而不能只靠 ①：① 里想凑出「显示已归档=开 + 当前空间=已归档」
 * 这种异常态，得先在界面上点好几步；而断言需要**每格都能直接读到**。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { SpaceBar } from '../../components/SpaceBar.tsx';
import type { Workspace } from '../../../src/types.ts';

/* ── 夹具 ── */

const ws = (id: string, displayName: string, archived: boolean): Workspace => ({
	id,
	displayName,
	archived,
	createdAt: 0,
});

const CORE = ws('ws-core', '核心', false);
const CODE = ws('ws-code', '代码', false);
const WRITE = ws('ws-write', '写作', false);
const OLD = ws('ws-old', '旧空间', true);

const ALL: readonly Workspace[] = [CORE, CODE, WRITE, OLD];

/* ── ① 活的一行 ── */

interface LiveProps {
	readonly onEvent: (what: string) => void;
}

function Live(props: LiveProps): React.ReactNode {
	const [currentId, setCurrentId] = useState('ws-core');
	const [viewingId, setViewingId] = useState('ws-core');
	const [showArchived, setShowArchived] = useState(false);

	const cardCount = viewingId === 'ws-code' ? 7 : viewingId === 'ws-write' ? 3 : 12;

	return (
		<section className="pv-block">
			<h2>① 活的一行（点 chip 只改「正在查看」）</h2>
			<div data-live>
				<SpaceBar
					workspaces={ALL}
					currentId={currentId}
					viewingId={viewingId}
					showArchived={showArchived}
					cardCount={cardCount}
					onView={(id) => {
						props.onEvent(`view:${id}`);
						setViewingId(id);
					}}
					onActivate={(id) => {
						props.onEvent(`activate:${id}`);
						setCurrentId(id);
						/* 旧版行为：激活后显式选中清掉，回落新的当前空间。这里等价于 viewing 跟上。 */
						setViewingId(id);
					}}
					onToggleArchived={(id) => {
						props.onEvent(`toggle-archived:${id}`);
					}}
					onToggleShowArchived={() => {
						props.onEvent('toggle-show-archived');
						setShowArchived((one) => !one);
					}}
					onCreate={() => props.onEvent('create')}
				/>
			</div>
			<div className="pv-state">
				<div>
					<span className="pv-k">current</span>
					<code data-live-current>{currentId}</code>
				</div>
				<div>
					<span className="pv-k">viewing</span>
					<code data-live-viewing>{viewingId}</code>
				</div>
				<div>
					<span className="pv-k">showArchived</span>
					<code data-live-show>{String(showArchived)}</code>
				</div>
				<div>
					<span className="pv-k">cardCount</span>
					<code data-live-count>{cardCount}</code>
				</div>
			</div>
		</section>
	);
}

/* ── ② 静态矩阵 ── */

interface Scenario {
	readonly key: string;
	readonly note: string;
	readonly workspaces: readonly Workspace[];
	readonly currentId: string;
	readonly viewingId: string;
	readonly showArchived: boolean;
	readonly cardCount: number;
}

const SCENARIOS: readonly Scenario[] = [
	{
		key: 'off-other',
		note: '表第 1 行：关 + 查看的不是当前 ⇒ 激活此为当前空间（可点）',
		workspaces: ALL,
		currentId: 'ws-core',
		viewingId: 'ws-code',
		showArchived: false,
		cardCount: 7,
	},
	{
		key: 'off-current',
		note: '表第 1 行后半：关 + 查看的就是当前 ⇒ 当前空间（禁用）',
		workspaces: ALL,
		currentId: 'ws-core',
		viewingId: 'ws-core',
		showArchived: false,
		cardCount: 12,
	},
	{
		key: 'on-other',
		note: '表第 2 行：开 + 非当前（未归档）⇒ 已归档（可点，未选中）',
		workspaces: ALL,
		currentId: 'ws-core',
		viewingId: 'ws-code',
		showArchived: true,
		cardCount: 7,
	},
	{
		key: 'on-other-archived',
		note: '表第 2 行后半：开 + 非当前（已归档）⇒ 已归档（可点，选中）',
		workspaces: ALL,
		currentId: 'ws-core',
		viewingId: 'ws-old',
		showArchived: true,
		cardCount: 0,
	},
	{
		key: 'on-current',
		note: '表第 3 行：开 + 当前（未归档）⇒ 当前空间（禁用，**不是**已归档）',
		workspaces: ALL,
		currentId: 'ws-core',
		viewingId: 'ws-core',
		showArchived: true,
		cardCount: 12,
	},
	{
		key: 'on-current-archived',
		note: '表第 4 行：开 + 当前（已归档，异常态）⇒ 已归档（**可点**，取消归档）',
		workspaces: ALL,
		currentId: 'ws-old',
		viewingId: 'ws-old',
		showArchived: true,
		cardCount: 0,
	},
];

function Matrix(props: LiveProps): React.ReactNode {
	return (
		<section className="pv-block">
			<h2>② 那张表的五个场景（固定状态，逐个断言）</h2>
			{SCENARIOS.map((s) => (
				<div className="pv-case" key={s.key} data-scenario={s.key}>
					<div className="pv-case__note">{s.note}</div>
					<SpaceBar
						workspaces={s.workspaces}
						currentId={s.currentId}
						viewingId={s.viewingId}
						showArchived={s.showArchived}
						cardCount={s.cardCount}
						onView={(id) => props.onEvent(`${s.key}/view:${id}`)}
						onActivate={(id) => props.onEvent(`${s.key}/activate:${id}`)}
						onToggleArchived={(id) => props.onEvent(`${s.key}/toggle-archived:${id}`)}
						onToggleShowArchived={() => props.onEvent(`${s.key}/toggle-show`)}
						onCreate={() => props.onEvent(`${s.key}/create`)}
					/>
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
				<h1>SpaceBar / 空间 chip 行</h1>
				<p>
					chip 点击 = 查看（不改激活）· 左侧<b>一个</b>按钮随「显示已归档」换语义 · 「+」新建
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

			<section className="pv-block">
				<h2>④ 规则（用户原话）</h2>
				<table className="pv-table">
					<thead>
						<tr>
							<th>显示已归档</th>
							<th>选中空间</th>
							<th>按钮</th>
							<th>行为</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>关</td>
							<td>不是当前</td>
							<td>
								<code>激活此为当前空间</code>
							</td>
							<td>把正在查看的变成激活</td>
						</tr>
						<tr>
							<td>关</td>
							<td>就是当前</td>
							<td>
								<code>当前空间</code>（禁用）
							</td>
							<td>无</td>
						</tr>
						<tr>
							<td>开</td>
							<td>不是当前</td>
							<td>
								<code>已归档</code>
							</td>
							<td>切换归档状态</td>
						</tr>
						<tr>
							<td>开</td>
							<td>就是当前（未归档）</td>
							<td>
								<code>当前空间</code>（禁用）
							</td>
							<td>无；<b>不显示「已归档」</b>（防误导）</td>
						</tr>
						<tr>
							<td>开</td>
							<td>就是当前（已归档，异常态）</td>
							<td>
								<code>已归档</code>（选中）
							</td>
							<td>
								<b>可点</b> ⇒ 取消归档，修回正常
							</td>
						</tr>
					</tbody>
				</table>
				<p className="pv-note" style={{ marginTop: 12, marginBottom: 0 }}>
					⚠ 全部判决在 <code>dev/pure/space-bar.ts</code>，组件只做渲染 + 机械派发。
					四行表由 <code>dev/test/space-bar.test.ts</code> 逐行断言。
				</p>
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
