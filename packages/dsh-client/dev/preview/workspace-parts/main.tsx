/**
 * workspace-parts 预览 —— 五个从 `Workspace.tsx` 拆出来的组件，各自一块。
 *
 * 用户 `2026-11-20`：「一个视图那么多能拆的。做了组件吗」
 * ⇒ 拆出来的五个组件必须能**独立渲染**（props 进 / 回调出，不依赖 `Workspace`
 * 内部 state）—— 这个预览就是那条要求的证据：它不挂 `Workspace`。
 *
 * ## 覆盖的形态
 *
 * | 组件 | 形态 |
 * |---|---|
 * | `WorkspaceToolbar` | 列表视图 / 科技树视图 / 无权限按钮 / compact + 空间选择器 |
 * | `SpacePicker` | 收起 / 展开 8 个空间 / 展开 40 个空间（面板内滚动）/ 无空间 |
 * | `ListHeader` | 正常（12 条）/ 0 条 |
 * | `SplitHandle` | 水平（宽版两栏）/ 垂直（窄版上下堆叠）—— 都能真拖 |
 * | `ListEmpty` | 无卡 / 筛掉了 / 搜索无结果 / 两个都有 |
 *
 * ## 样式是真的
 *
 * `injectStyles()` 注入产品 CSS（`WORKSPACE_CSS` + 定稿组件样式），
 * 预览和产品**同一份**。`style.css` 只有页面骨架 + 几条预览专属覆盖
 *（`.tb3w-root` 产品里撑满 tab，预览里要按内容撑开）。
 *
 * ## 数据是假的
 *
 * 空间清单 / 条数是编的（没有服务端）；回调只往页面上记一行日志，
 * 用来证明「组件真的把事件抛出来了」。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { EmptyReason } from '../../../src/pure/card-filter.ts';
import { ListEmpty } from '../../../src/renderers/workspace/ListEmpty.tsx';
import { ListHeader } from '../../../src/renderers/workspace/ListHeader.tsx';
import { SpacePicker } from '../../../src/renderers/workspace/SpacePicker.tsx';
import type { SpacePickerProps } from '../../../src/renderers/workspace/SpacePicker.tsx';
import { SplitHandle } from '../../../src/renderers/workspace/SplitHandle.tsx';
import type { WorkspaceView } from '../../../src/renderers/workspace/WorkspaceToolbar.tsx';
import { WorkspaceToolbar } from '../../../src/renderers/workspace/WorkspaceToolbar.tsx';
import { injectStyles } from '../../../src/styles.ts';
import type { Workspace as SpaceEntity } from '../../../src/types.ts';

/* ══════════════════════════════════════════════════════════
   假数据
   ══════════════════════════════════════════════════════════ */

const T0 = new Date(2026, 10, 20, 9, 0, 0, 0).getTime();

/**
 * 造一个空间。
 *
 * @param id id
 * @param displayName 显示名
 * @param archived 是否归档
 */
function space(id: string, displayName: string, archived = false): SpaceEntity {
	return { id, displayName, archived, createdAt: T0 };
}

/** 8 个空间（含一个归档 —— 验证「显示已归档」开着时 chip 的虚线态）。 */
const SPACES_8: readonly SpaceEntity[] = Object.freeze([
	space('core', '核心'),
	space('code', '代码'),
	space('writing', '写作'),
	space('research', '调研'),
	space('design', '设计稿'),
	space('legacy', '旧项目'),
	space('tidy', '待整理'),
	space('archive', '归档区', true),
]);

/** 40 个空间 —— 用来验证「面板内滚动」：chip 换行成很多行，溢出面板。 */
const SPACES_40: readonly SpaceEntity[] = Object.freeze(
	Array.from({ length: 40 }, (_unused, index) =>
		space(
			`ws-${String(index + 1).padStart(2, '0')}`,
			`空间 ${String(index + 1).padStart(2, '0')}`,
			index === 39,
		),
	),
);

/* ══════════════════════════════════════════════════════════
   小部件：日志 / 区块
   ══════════════════════════════════════════════════════════ */

/**
 * 回调日志 —— 证明组件真的把事件抛出来了（预览没有服务端）。
 *
 * @param props 事件列表
 */
function EventLog(props: { readonly events: readonly string[] }): React.ReactNode {
	return (
		<ul className="wsp-log" aria-live="polite">
			{props.events.length === 0 ? (
				<li className="wsp-log__empty">（点上面的东西，回调记在这里）</li>
			) : (
				props.events.map((one) => <li key={one}>{one}</li>)
			)}
		</ul>
	);
}

/**
 * 一个样例块：说明 + 样例。
 *
 * @param props 说明行、样例
 */
function Case(props: { readonly note: string; readonly children: React.ReactNode }): React.ReactNode {
	return (
		<div className="wsp-case">
			<div className="wsp-case__note">{props.note}</div>
			{props.children}
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   ① WorkspaceToolbar
   ══════════════════════════════════════════════════════════ */

/**
 * 工具栏样例。
 *
 * 视图切换 / 新建 / 权限按钮 / 空间选择器都接真回调（记日志），
 * 所以能点出来；`view` 是本样例的 state —— 产品里它在 `Workspace` 里。
 *
 * @param props 变体
 */
function ToolbarCase(props: {
	readonly note: string;
	readonly initialView: WorkspaceView;
	readonly permission: boolean;
	readonly spacePicker: boolean;
}): React.ReactNode {
	const [view, setView] = useState<WorkspaceView>(props.initialView);
	const [events, setEvents] = useState<readonly string[]>([]);
	const record = (message: string): void => {
		setEvents((prev) => [message, ...prev].slice(0, 8));
	};

	const picker: SpacePickerProps | undefined = !props.spacePicker
		? undefined
		: {
				workspaces: SPACES_8,
				currentId: 'core',
				viewingId: 'core',
				showArchived: true,
				cardCount: 12,
				onView: (id) => {
					record(`view: ${id}`);
				},
				onActivate: (id) => {
					record(`activate: ${id}`);
				},
				onToggleArchived: (id) => {
					record(`toggle-archived: ${id}`);
				},
				onToggleShowArchived: () => {
					record('toggle-show-archived');
				},
				onCreate: () => {
					record('create-workspace');
				},
			};

	return (
		<Case note={props.note}>
			<div className="wsp-demo tb3w-root">
				<WorkspaceToolbar
					shownCount={9}
					totalCount={12}
					queryActive
					view={view}
					onViewChange={(next) => {
						setView(next);
						record(`view-change: ${next}`);
					}}
					onCreateCard={() => {
						record('create-card');
					}}
					{...(props.permission
						? {
								onOpenPermission: () => {
									record('open-permission');
								},
							}
						: {})}
					{...(picker === undefined ? {} : { spacePicker: picker })}
				/>
			</div>
			<EventLog events={events} />
		</Case>
	);
}

/* ══════════════════════════════════════════════════════════
   ② SpacePicker
   ══════════════════════════════════════════════════════════ */

/**
 * 空间选择器样例。
 *
 * ⚠ 「点外面收起」要**点样例外面**才看得出来（它是组件自己挂的监听，
 *   不靠父容器）—— 点页面空白处即可。
 *
 * @param props 变体
 */
function PickerCase(props: {
	readonly note: string;
	readonly workspaces: readonly SpaceEntity[];
	readonly defaultOpen: boolean;
	readonly tall?: boolean;
}): React.ReactNode {
	const [events, setEvents] = useState<readonly string[]>([]);
	const record = (message: string): void => {
		setEvents((prev) => [message, ...prev].slice(0, 8));
	};

	return (
		<Case note={props.note}>
			<div
				className={`wsp-demo tb3w-root${props.tall === true ? ' wsp-demo--picker40' : ''}${
					props.defaultOpen ? ' wsp-demo--picker' : ''
				}`}
			>
				<SpacePicker
					workspaces={props.workspaces}
					currentId="core"
					viewingId="core"
					showArchived
					cardCount={12}
					defaultOpen={props.defaultOpen}
					onView={(id) => {
						record(`view: ${id}`);
					}}
					onActivate={(id) => {
						record(`activate: ${id}`);
					}}
					onToggleArchived={(id) => {
						record(`toggle-archived: ${id}`);
					}}
					onToggleShowArchived={() => {
						record('toggle-show-archived');
					}}
					onCreate={() => {
						record('create-workspace');
					}}
				/>
			</div>
			<EventLog events={events} />
		</Case>
	);
}

/* ══════════════════════════════════════════════════════════
   ③ ListHeader / ④ ListEmpty
   ══════════════════════════════════════════════════════════ */

/** 列表头样例。 */
function ListHeaderCase(props: { readonly count: number }): React.ReactNode {
	return (
		<Case note={`count = ${String(props.count)}`}>
			<div className="wsp-demo tb3w-root">
				<ListHeader count={props.count} />
			</div>
		</Case>
	);
}

/** 空态样例（四种原因都画一遍 —— 判决 `emptyReasonOf()` 在 pure 里）。 */
function ListEmptyCase(props: { readonly reason: EmptyReason; readonly query: string }): React.ReactNode {
	return (
		<Case note={`reason = ${props.reason}${props.query === '' ? '' : ` · query = 「${props.query}」`}`}>
			<div className="wsp-demo tb3w-root">
				<ListEmpty reason={props.reason} query={props.query} />
			</div>
		</Case>
	);
}

/* ══════════════════════════════════════════════════════════
   ⑤ SplitHandle
   ══════════════════════════════════════════════════════════ */

/**
 * 分隔条样例：一个**真的**两栏盒子 + 可拖的把手。
 *
 * 组件自己按 DOM 找 `.tb3w-main` / `[data-list]`、自己判方向
 *（`getComputedStyle(main).flexDirection`）⇒ 下面两个样例除了
 * 「main 是 row 还是 column」之外没有别的差别。
 *
 * @param props `column = true` 演示窄版竖直拖动
 */
function SplitCase(props: { readonly column: boolean }): React.ReactNode {
	/* 初始比例照产品：宽版 62%（flex 2 : 1.2）；窄版 52%。 */
	const [ratio, setRatio] = useState<number>(props.column ? 0.52 : 0.62);

	return (
		<Case
			note={`${props.column ? 'column（窄版：列表 52% 起）' : 'row（宽版：列表 62% 起）'} · 列表占 ${(ratio * 100).toFixed(1)}% —— 拖中间那根`}
		>
			<div className={`wsp-split-demo${props.column ? ' wsp-split-demo--column' : ''} tb3w-root`}>
				<div className="tb3w-main">
					<section className="tb3w-list" data-list style={{ flex: `0 0 ${String(ratio * 100)}%` }}>
						<div className="wsp-pane-body">
							<b>列表</b>（data-list）
							<br />
							把手量这一栏的 {props.column ? '高' : '宽'}
						</div>
					</section>
					<SplitHandle onResize={setRatio} />
					<aside
						className="tb3w-detail"
						style={{ flex: '1 1 0', minWidth: 0, maxWidth: 'none' }}
					>
						<div className="wsp-pane-body">
							<b>详情</b>
							<br />
							吃剩下的 {props.column ? '高' : '宽'}
						</div>
					</aside>
				</div>
			</div>
		</Case>
	);
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

/** 预览页。 */
function App(): React.ReactNode {
	return (
		<div className="wsp">
			<div className="wsp-wrap">
				<div className="wsp-head">
					<h1>Workspace 拆出来的五个组件</h1>
					<p>
						从 <code>src/renderers/Workspace.tsx</code> 拆到{' '}
						<code>src/renderers/workspace/</code>：工具栏 / 空间选择器 / 列表头 / 分隔条 / 空态。
						每个组件都能**独立渲染**（props 进、回调出），本页不挂 <code>Workspace</code>。
						样式和产品同一份（<code>injectStyles()</code>）。
					</p>
				</div>

				<section className="wsp-block">
					<h2>
						① WorkspaceToolbar <code>WorkspaceToolbar.tsx</code>
					</h2>
					<p>
						计数 / 关系图例 / 权限 / 科技树⇄列表 / 新建。**不含空间选择器** —— 选工作区是独立组件，见 ②。
						⚠ 分段按钮是**临时内联实现**（用户还没选定候选组件），这里不是新实现，是原样搬家。
					</p>
					<ToolbarCase note="列表视图 · 有权限按钮 · 无空间选择器（full 密度）" initialView="list" permission spacePicker={false} />
					<ToolbarCase note="科技树视图 · 有权限按钮" initialView="tree" permission spacePicker={false} />
					<ToolbarCase note="无权限按钮（onOpenPermission 省略 = 不画）" initialView="list" permission={false} spacePicker={false} />

				</section>

				<section className="wsp-block">
					<h2>
						② SpacePicker <code>SpacePicker.tsx</code>
					</h2>
					<p>
						「工作空间 ▾」按钮 + 下拉面板（面板里是定稿的 <code>SpaceBar</code>）。
						<b>开合由它自己管</b>：点自己身外就收起 —— 试试点页面空白处。
						40 个空间那一档演示的是**面板内溢出滚动**（面板 <code>max-height:min(320px,60vh)</code> + <code>overflow:auto</code>）。
					</p>
					<PickerCase note="收起态 · 8 个空间" workspaces={SPACES_8} defaultOpen={false} />
					<PickerCase note="展开态 · 8 个空间（defaultOpen —— 只为静态预览/SSR 能画出来）" workspaces={SPACES_8} defaultOpen />
					<PickerCase note="展开态 · 40 个空间（chip 换行 → 面板内滚动，按钮行不动）" workspaces={SPACES_40} defaultOpen tall />
					<PickerCase note="展开态 · 0 个空间（SpaceBar 自己画禁用态 + 「+」）" workspaces={[]} defaultOpen />
				</section>

				<section className="wsp-block">
					<h2>
						③ ListHeader <code>ListHeader.tsx</code>
					</h2>
					<p>「列表 · N 条」+「按更新时间」+ 四列列名行。科技树视图下整块不渲染（那边有自己的画布）。</p>
					<ListHeaderCase count={12} />
					<ListHeaderCase count={0} />
				</section>

				<section className="wsp-block">
					<h2>
						④ SplitHandle <code>SplitHandle.tsx</code>
					</h2>
					<p>
						列表 / 详情之间那根把手。方向从 <code>.tb3w-main</code> 的 <code>flex-direction</code> 读，
						结果以**比例**上报（调用方写成 <code>flex-basis</code>）。
					</p>
					<SplitCase column={false} />
					<SplitCase column />
				</section>

				<section className="wsp-block">
					<h2>
						⑤ ListEmpty <code>ListEmpty.tsx</code>
					</h2>
					<p>
						列表 0 行时那一句。**空的原因不同，话不能一样** ——
						判决在 <code>pure/card-filter.ts</code> 的 <code>emptyReasonOf()</code>，这里只挑句子。
					</p>
					<ListEmptyCase reason="space-empty" query="" />
					<ListEmptyCase reason="filter" query="" />
					<ListEmptyCase reason="search" query="关系" />
					<ListEmptyCase reason="both" query="关系" />
				</section>
			</div>
		</div>
	);
}

/* 产品样式和预览是同一份 —— 不在预览的 style.css 里抄一份。 */
injectStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
