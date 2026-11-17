/**
 * SpaceBar 预览入口 —— **只在 `dev/preview/spacebar/` 里，不碰根 `main.tsx`**。
 *
 * ## 五段
 *
 * ① **布局变体对比**（用户 `2026-11-18` 要求重新设计视觉）——
 *    四个方案并排 + 一个切换按钮组，直接看哪个可用。
 * ② **活的一行**（受控状态）—— 验「点 chip 只改 viewing，不改 current」。
 * ③ **静态矩阵** —— 六个场景，固定状态，验那张表的文案 / `disabled` / 派发回调。
 * ④ **回调日志**。
 * ⑤ **规则表**。
 *
 * 之所以要 ③ 而不能只靠 ②：② 里想凑出「显示已归档=开 + 当前空间=已归档」
 * 这种异常态，得先在界面上点好几步；而断言需要**每格都能直接读到**。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { LAYOUT_LABELS, SpaceBar } from '../../components/SpaceBar.tsx';
import type { SpaceBarLayout } from '../../components/SpaceBar.tsx';
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

/** 多空间夹具 —— 专门用来把单行撑爆，暴露「拖不到滚动条」。 */
const MANY: readonly Workspace[] = [
	CORE,
	CODE,
	WRITE,
	ws('ws-a', '调研', false),
	ws('ws-b', '归档区', false),
	ws('ws-c', '设计稿', false),
	ws('ws-d', '外部协作', false),
	ws('ws-e', '历史遗留', false),
	ws('ws-f', '实验', false),
	ws('ws-g', '文档', false),
	ws('ws-h', '测试', false),
	ws('ws-i', '发布', false),
	OLD,
];

const LAYOUTS: readonly SpaceBarLayout[] = ['wrap', 'scroll', 'arrows', 'compact'];

/* ── ① 布局变体对比 ── */

interface LayoutSectionProps {
	readonly layout: SpaceBarLayout;
	readonly onChange: (one: SpaceBarLayout) => void;
	readonly onEvent: (what: string) => void;
}

function LayoutSection(props: LayoutSectionProps): React.ReactNode {
	const [currentId, setCurrentId] = useState('ws-core');
	const [viewingId, setViewingId] = useState('ws-code');
	const [showArchived, setShowArchived] = useState(false);

	const bar = (one: SpaceBarLayout): React.ReactNode => (
		<SpaceBar
			workspaces={MANY}
			currentId={currentId}
			viewingId={viewingId}
			showArchived={showArchived}
			cardCount={7}
			layout={one}
			onView={(id) => {
				props.onEvent(`layout/${one}/view:${id}`);
				setViewingId(id);
			}}
			onActivate={(id) => {
				props.onEvent(`layout/${one}/activate:${id}`);
				setCurrentId(id);
				setViewingId(id);
			}}
			onToggleArchived={(id) => props.onEvent(`layout/${one}/toggle-archived:${id}`)}
			onToggleShowArchived={() => {
				props.onEvent(`layout/${one}/toggle-show`);
				setShowArchived((one2) => !one2);
			}}
			onCreate={() => props.onEvent(`layout/${one}/create`)}
		/>
	);

	return (
		<section className="pv-block">
			<h2>① 布局变体对比（13 个空间，故意撑爆单行）</h2>
			<p className="pv-note" style={{ marginTop: 0 }}>
				用户原话：「如果只有一行，那么在拖动的时候，是无法精确的点到横向滚动条的。」
				⇒ 这不是审美问题，是**够不到**。四个方案都做出来了，切换看。
			</p>

			<div className="pv-layouts" data-layout-switch>
				{LAYOUTS.map((one) => (
					<button
						key={one}
						type="button"
						className={props.layout === one ? 'is-on' : ''}
						data-layout-option={one}
						onClick={() => props.onChange(one)}
					>
						{LAYOUT_LABELS[one]}
					</button>
				))}
			</div>

			<div data-layout-live>
				<div className="pv-case">
					<div className="pv-case__note">
						当前变体：{props.layout} —— 拖动 / 滚动 / 换行行为直接看这里
					</div>
					{bar(props.layout)}
				</div>
			</div>

			<div className="pv-state">
				<div>
					<span className="pv-k">current</span>
					<code data-layout-current>{currentId}</code>
				</div>
				<div>
					<span className="pv-k">viewing</span>
					<code data-layout-viewing>{viewingId}</code>
				</div>
				<div>
					<span className="pv-k">showArchived</span>
					<code data-layout-show>{String(showArchived)}</code>
				</div>
			</div>
		</section>
	);
}

/* ── ② 活的一行（默认布局） ── */

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
			<h2>② 活的一行（点 chip 只改「正在查看」）</h2>
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

/* ── ③ 静态矩阵 ── */

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
		note: '表第 1 行：关 + 查看的不是当前 ⇒ 「当前空间」可点（emphasis=action）',
		workspaces: ALL,
		currentId: 'ws-core',
		viewingId: 'ws-code',
		showArchived: false,
		cardCount: 7,
	},
	{
		key: 'off-current',
		note: '表第 1 行后半：关 + 查看的就是当前 ⇒ 「当前空间」禁用（emphasis=current）',
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
			<h2>③ 那张表的六个场景（固定状态，逐个断言）</h2>
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

/* ── ④ + ⑤ ── */

function App(): React.ReactNode {
	const [events, setEvents] = useState<readonly string[]>([]);
	const [layout, setLayout] = useState<SpaceBarLayout>('wrap');
	const push = (what: string): void => {
		setEvents((one) => [...one, what]);
	};

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>SpaceBar / 空间 chip 行</h1>
				<p>
					文案已合并成「当前空间」· 靠 emphasis 着色区分「你在这里 / 可以切过去」·
					chip 点击 = 查看（不改激活）· 左侧<b>一个</b>按钮随「显示已归档」换语义
				</p>
			</header>

			<LayoutSection layout={layout} onChange={setLayout} onEvent={push} />
			<Live onEvent={push} />
			<Matrix onEvent={push} />

			<section className="pv-block">
				<h2>④ 回调日志（点了什么就是什么）</h2>
				<ul className="pv-events" data-event-log>
					{events.length === 0 ? <li className="pv-events__empty">（还没有事件）</li> : null}
					{events.map((one, index) => (
						<li key={`${String(index)}-${one}`} data-event={one}>
							{one}
						</li>
					))}
				</ul>
				<button type="button" className="ghost-btn" data-clear-log onClick={() => setEvents([])}>
					清空日志
				</button>
			</section>

			<section className="pv-block">
				<h2>⑤ 规则（用户原话）</h2>
				<table className="pv-table">
					<thead>
						<tr>
							<th>显示已归档</th>
							<th>选中空间</th>
							<th>按钮</th>
							<th>emphasis</th>
							<th>行为</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>关</td>
							<td>不是当前</td>
							<td>
								<code>当前空间</code>
							</td>
							<td>
								<code>action</code>（描边，可点）
							</td>
							<td>把正在查看的变成激活</td>
						</tr>
						<tr>
							<td>关</td>
							<td>就是当前</td>
							<td>
								<code>当前空间</code>（禁用）
							</td>
							<td>
								<code>current</code>（实心）
							</td>
							<td>无</td>
						</tr>
						<tr>
							<td>开</td>
							<td>不是当前</td>
							<td>
								<code>已归档</code>
							</td>
							<td>
								<code>action</code>
							</td>
							<td>切换归档状态</td>
						</tr>
						<tr>
							<td>开</td>
							<td>就是当前（未归档）</td>
							<td>
								<code>当前空间</code>（禁用）
							</td>
							<td>
								<code>current</code>
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
								<code>action</code>
							</td>
							<td>
								<b>可点</b> ⇒ 取消归档，修回正常
							</td>
						</tr>
					</tbody>
				</table>
				<p className="pv-note" style={{ marginTop: 12, marginBottom: 0 }}>
					⚠ <b>文案合并的代价</b>：两个按钮都写「当前空间」，用户看不出区别。
					两道防线：① <code>emphasis</code> 让它们**看起来不是一类东西**（实心徽章 vs 描边按钮）；
					② <code>title</code> 说清后果（「这就是当前空间」/「点一下把『代码』设为当前空间」）。
					两道防线都有单测。
				</p>
				<p className="pv-note" style={{ marginTop: 8, marginBottom: 0 }}>
					⚠ 全部判决在 <code>dev/pure/space-bar.ts</code>，组件只做渲染 + 机械派发。
					表由 <code>dev/test/space-bar.test.ts</code> 逐行断言（54 条）。
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
