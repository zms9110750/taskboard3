/**
 * 抽屉预览 —— 三个舞台，全部用**真实组件 + 真实尺寸**。
 *
 * | 舞台 | 尺寸 | 看什么 |
 * |---|---|---|
 * | 远景 `full` | 1600 × 1000 | 抽屉盖在 DSH 窗口上：左栏 / 对话区 / 右栏工作区都在，抽屉横在对话+工作区上方 |
 * | 抽屉本体 `panel` | 1200 × 400 | 1:1 看抽屉本身（顶栏 / 左列表 / 右详情 / 两栏各自滚）|
 * | 工作区 `narrow` | 570 × 920 | 真实 tab 尺寸的 Workspace（**没有抽屉** —— 它是帧级浮层，不属于这个 tab）|
 *
 * ## 真 / 假
 *
 * - **真**：`Drawer` / `DrawerToggle` / `Workspace` 以及里面全部定稿组件都是 `src/` 的同一份；
 *   样式来自 `injectStyles()`（产品和预览同一份 CSS）。
 * - **假**：没有服务端（回调只弹一条回执）；左侧栏 / 对话 / 输入框是**预览壳**，
 *   产品里由宿主渲染，这里画出来只为展示抽屉和它们的位置关系。
 * - **数据**：`fixtures.ts`（和 SSR 断言同一份）。
 *
 * ## 两个入口共用同一个 open 状态（设计图 ②）
 *
 * 输入框左侧的 `<DrawerToggle>` 和右栏详情的 ⧉（`Workspace` 的 `onExpandDetail`）
 * 都拿**同一个** `drawer.toggle` —— 不是各写一套。顶部还有一颗预览按钮，
 * 同样调它（第三个入口，演示「派生同一个动作」）。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { ButtonAction } from '@taskboard/protocol';

import { initRenderers } from '../../../src/init-renderers.ts';
import type { Picked } from '../../../src/pure/filter-box.ts';
import { Drawer, DrawerToggle, useDrawerState } from '../../../src/renderers/Drawer.tsx';
import type { WorkspaceProps } from '../../../src/renderers/Workspace.tsx';
import { Workspace } from '../../../src/renderers/Workspace.tsx';
import { injectStyles } from '../../../src/styles.ts';
import { CARDS, KIND_LABELS, PAGE_DEFAULT_PICKED, TEMPLATES, WORKSPACES } from './fixtures.ts';

/* ══════════════════════════════════════════════════════════
   舞台
   ══════════════════════════════════════════════════════════ */

/** 舞台 id。 */
type StageId = 'full' | 'panel' | 'narrow';

/** 一个舞台。 */
interface Stage {
	readonly id: StageId;
	readonly label: string;
	readonly note: string;
	readonly width: number;
	readonly height: number;
}

const STAGES: readonly Stage[] = Object.freeze([
	{
		id: 'full',
		label: '远景 1600 × 1000',
		note: '抽屉盖在 DSH 窗口上；底边在输入框上方 8px（设计图对齐），水平居中于「对话 + 工作区」',
		width: 1600,
		height: 1000,
	},
	{
		id: 'panel',
		label: '抽屉本体 1200 × 400',
		note: '1:1；两栏各自滚（面板自己不滚）',
		width: 1200,
		height: 400,
	},
	{
		id: 'narrow',
		label: '工作区 570 × 920',
		note: '真实 tab 尺寸 —— 抽屉是帧级浮层，在这个 tab 里不会出现',
		width: 570,
		height: 920,
	},
]);

/** 抽屉底边距（远景舞台）：设计图里抽屉下缘比输入框上缘高 8px。 */
const FULL_BOTTOM_OFFSET = 136;

/** 侧栏宽（设计图 280）。 */
const SIDEBAR_WIDTH = 280;

/** 右栏工作区宽（设计图 570）。 */
const PANE_WIDTH = 570;

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

/** 预览页。 */
function App(): React.ReactNode {
	const [stageId, setStageId] = useState<StageId>('full');
	/** 远景舞台的抽屉对齐：设计图 = 居中于「对话 + 工作区」；另一档 = 居中于整帧。 */
	const [align, setAlign] = useState<'pane' | 'frame'>('pane');
	const [notice, setNotice] = useState<string | undefined>(undefined);

	/* ── 两个 Workspace 实例的状态**各一份**（设计图 ④：状态独立） ── */

	/* 页签实例（远景里右栏那个） */
	const [pageCurrent, setPageCurrent] = useState('default');
	const [pageViewing, setPageViewing] = useState('default');
	const [pageShowArchived, setPageShowArchived] = useState(false);
	const [pageSelected, setPageSelected] = useState<string | null>('GU-01');

	/* 抽屉实例（第二个实例） */
	const [drawerCurrent, setDrawerCurrent] = useState('default');
	const [drawerViewing, setDrawerViewing] = useState('default');
	const [drawerShowArchived, setDrawerShowArchived] = useState(false);
	const [drawerSelected, setDrawerSelected] = useState<string | null>('GU-02');

	/* 开合状态：输入框 Chevron / 右栏 ⧉ / 顶部预览按钮 **共用这一个** */
	const drawer = useDrawerState(true);

	const stage = STAGES.find((one) => one.id === stageId) ?? (STAGES[0] as Stage);

	/** 假回执（预览没有服务端）。 */
	const say = (message: string): void => {
		setNotice(message);
	};

	/** 状态菜单选了某项。 */
	const onAction = (kind: '页签' | '抽屉') => (cardId: string, action: ButtonAction): void => {
		say(`${kind}：状态转移 ${cardId} →「${action.label}」（预览：不发请求、不落库）`);
	};

	/** 空间操作。 */
	const spaceCallbacks = (
		which: '页签' | '抽屉',
	): Pick<
		WorkspaceProps,
		| 'onView'
		| 'onActivate'
		| 'onToggleArchived'
		| 'onToggleShowArchived'
		| 'onCreateWorkspace'
	> => ({
		onView: which === '页签' ? setPageViewing : setDrawerViewing,
		onActivate: (id) => {
			(which === '页签' ? setPageCurrent : setDrawerCurrent)(id);
			say(`${which}：「${id}」现在是当前空间（预览：不落库）`);
		},
		onToggleArchived: (id) => {
			say(`${which}：切换「${id}」归档态（预览：不落库）`);
		},
		onToggleShowArchived: () => {
			(which === '页签' ? setPageShowArchived : setDrawerShowArchived)((prev) => !prev);
		},
		onCreateWorkspace: () => {
			say(`${which}：新建任务板（预览：没有服务端）`);
		},
	});

	const commonCallbacks = (
		which: '页签' | '抽屉',
	): Pick<
		WorkspaceProps,
		| 'onSelect'
		| 'onCreateCard'
		| 'onFilterChange'
		| 'onSearchChange'
		| 'onAction'
		| 'onAddRelation'
		| 'onDerive'
		| 'onNoteChange'
		| 'onOpenPermission'
	> => ({
		onSelect: (cardId) => {
			(which === '页签' ? setPageSelected : setDrawerSelected)(cardId);
		},
		onCreateCard: () => {
			say(`${which}：打开建卡页（预览：入口没接）`);
		},
		onFilterChange: (id: string, next: Picked) => {
			say(`${which}：筛选 ${id} → ${next.length === 0 ? '（清空）' : next.join(' / ')}`);
		},
		onSearchChange: () => {
			say(`${which}：搜索（预览：过滤在本组件内已生效）`);
		},
		onAction: onAction(which),
		onAddRelation: (cardId) => {
			say(`${which}：打开 ${cardId} 的关系浮层（关系区还没做）`);
		},
		onDerive: (cardId) => {
			say(`${which}：从 ${cardId} 派生子任务（预览：入口没接）`);
		},
		onNoteChange: (cardId) => {
			say(`${which}：备注已提交 ${cardId}（预览：不落库）`);
		},
		onOpenPermission: () => {
			say(`${which}：权限与约定面板（V2 在别的任务里做）`);
		},
	});

	/** 页签实例的 props。 */
	const pageProps: WorkspaceProps = {
		workspaces: WORKSPACES,
		currentId: pageCurrent,
		viewingId: pageViewing,
		showArchived: pageShowArchived,
		cards: CARDS,
		templates: TEMPLATES,
		selectedId: pageSelected,
		defaultPicked: PAGE_DEFAULT_PICKED,
		kindLabelOf: (kind) => KIND_LABELS[kind] ?? kind,
		aiUnreadCount: 1,
		aiUpdatedCount: 2,
		...spaceCallbacks('页签'),
		...commonCallbacks('页签'),
		/* 右栏详情的 ⧉ ⇒ 用**同一个** toggle 打开抽屉（设计图 ② 的「右栏入口」） */
		onExpandDetail: drawer.toggle,
	};

	/** 抽屉实例的 props（**第二个实例**，状态独立）。 */
	const drawerProps: WorkspaceProps = {
		workspaces: WORKSPACES,
		currentId: drawerCurrent,
		viewingId: drawerViewing,
		showArchived: drawerShowArchived,
		cards: CARDS,
		templates: TEMPLATES,
		selectedId: drawerSelected,
		kindLabelOf: (kind) => KIND_LABELS[kind] ?? kind,
		aiUnreadCount: 1,
		aiUpdatedCount: 2,
		...spaceCallbacks('抽屉'),
		...commonCallbacks('抽屉'),
	};

	/** 顶栏预览控制条。 */
	const bar = (
		<header className="pv-bar">
			<span className="pv-bar__tag">V4 Drawer · 抽屉视图</span>
			{STAGES.map((one) => (
				<button
					key={one.id}
					type="button"
					className={`pv-bar__btn${one.id === stage.id ? ' is-on' : ''}`}
					data-stage-btn={one.id}
					onClick={() => {
						setStageId(one.id);
					}}
				>
					{one.label}
				</button>
			))}
			<span className="pv-bar__sep" />
			<button
				type="button"
				className={`pv-bar__btn${drawer.open ? ' is-on' : ''}`}
				data-drawer-toggle="1"
				onClick={drawer.toggle}
			>
				{drawer.open ? '抽屉：开' : '抽屉：关'}
			</button>
			{stage.id === 'full' ? (
				<>
					<span className="pv-bar__sep" />
					<button
						type="button"
						className={`pv-bar__btn${align === 'pane' ? ' is-on' : ''}`}
						data-align-btn="pane"
						onClick={() => {
							setAlign('pane');
						}}
					>
						对齐：对话 + 工作区（设计图）
					</button>
					<button
						type="button"
						className={`pv-bar__btn${align === 'frame' ? ' is-on' : ''}`}
						data-align-btn="frame"
						onClick={() => {
							setAlign('frame');
						}}
					>
						对齐：整帧
					</button>
				</>
			) : null}
			<span className="pv-bar__note">{stage.note}</span>
		</header>
	);

	return (
		<div className="pv">
			{bar}

			<div className="pv-scroll">
				<div
					className={`pv-stage${stage.id === 'panel' ? ' pv-stage--panel' : ''}`}
					data-stage={stage.id}
					style={{ width: `${String(stage.width)}px`, height: `${String(stage.height)}px` }}
				>
					{stage.id === 'narrow' ? (
						/* ── 570×920：真实 tab 尺寸的 Workspace（没有抽屉） ── */
						<>
							<div className="pv-tabbar">
								<span>▦ 任务板 · 工作区</span>
								<span className="pv-tabbar__hint">570 × 920 · 真实 tab 尺寸</span>
							</div>
							<div className="pv-pane__body">
								<Workspace {...pageProps} />
							</div>
						</>
					) : stage.id === 'panel' ? (
						/* ── 1200×400：抽屉本体 1:1 ── */
						<>
							{drawer.open ? (
								<div className="pv-overlay pv-overlay--solo">
									<Drawer
										open
										onClose={drawer.close}
										workspace={drawerProps}
										bottomOffset={0}
										onRefresh={() => {
											say('抽屉：刷新（预览：没有服务端）');
										}}
									/>
								</div>
							) : (
								<div className="pv-panel-hint" data-panel-hint="1">
									抽屉关着 —— 点顶部「抽屉：关」打开
								</div>
							)}
						</>
					) : (
						/* ── 1600×1000：远景（DSH 窗口 + 帧级抽屉） ── */
						<>
							<div className="pv-shell">
								{/* 左侧栏（mock：产品里是宿主画的） */}
								<aside className="pv-sidebar" style={{ width: `${String(SIDEBAR_WIDTH)}px` }}>
									<div className="pv-sidebar__brand">
										deepseek <b>HARNESS</b>
									</div>
									<div className="pv-sidebar__newchat">＋ 新会话</div>
									<div className="pv-sidebar__row">◇　插件</div>
									<div className="pv-sidebar__row">◷　自动化任务</div>
									<div className="pv-sidebar__row">▦　更多</div>
									<div className="pv-sidebar__label">工作区</div>
									<div className="pv-sidebar__row">▤　petSystem2</div>
									<div className="pv-sidebar__row">▤　petSystem</div>
									<div className="pv-sidebar__row is-active">▤　dsh</div>
									<div className="pv-sidebar__label">默认工作区</div>
									<div className="pv-sidebar__hint">使用任务板查看当前卡片</div>
									<div className="pv-sidebar__hint">查看任务板2 并阅读提示</div>
									<div className="pv-sidebar__hint">用工具查看自身插件</div>
									<div className="pv-sidebar__foot">⚙　设置</div>
								</aside>

								{/* 对话区（mock：抽屉的触发点在它的输入框左侧） */}
								<main className="pv-conv">
									<div className="pv-conv__head">
										<span className="pv-conv__title">重构 taskboard2 项目代码</span>
										<span className="pv-conv__chip">标准模式</span>
										<span className="pv-conv__muted">28 个子智能体</span>
									</div>
									<div className="pv-conv__body">
										<div className="pv-conv__tag">自动化任务 · 06:00</div>
										<div className="pv-conv__line">已完成，用时 40 秒 ▾</div>
										<div className="pv-conv__line">
											我上一份汇报里说 src/create/ 12 个文件可能重复，这个判断是错的，抱歉。
										</div>
										<div className="pv-conv__line is-strong">精确统计结果：</div>
										<div className="pv-conv__code">
											<div>src/           12 个 + 顶栏（入口、store、api、styles、注册表）</div>
											<div>src/renderers/ 20 个 + 组件      src/views/ 5 个 + MVP 半成品</div>
										</div>
									</div>

									{/* 输入框（mock；左侧 Chevron 是**真组件** DrawerToggle） */}
									<div className="pv-composer">
										<div className="pv-composer__toggle">
											<DrawerToggle open={drawer.open} onToggle={drawer.toggle} />
										</div>
										<div className="pv-composer__card">
											<div className="pv-composer__placeholder">
												发消息或创建任务 / 调用指令，@ 文件或对话
											</div>
											<div className="pv-composer__row">
												<span className="pv-composer__pill">＋</span>
												<span className="pv-composer__muted">完全权限 ▾</span>
												<span className="pv-composer__model">DeepSeek V4.1 Flash Default ▾</span>
												<span className="pv-composer__send">↑</span>
											</div>
										</div>
									</div>
								</main>

								{/* 右栏工作区（mock tab 头 + **真 Workspace**，570 宽） */}
								<aside className="pv-pane" style={{ width: `${String(PANE_WIDTH)}px` }}>
									<div className="pv-tabbar">
										<span className="pv-tabbar__active">任务板</span>
										<span className="pv-tabbar__tab">文件</span>
										<span className="pv-tabbar__hint">570 × 920 · 真实 tab 宽</span>
									</div>
									<div className="pv-pane__body">
										<Workspace {...pageProps} />
									</div>
								</aside>
							</div>

							{/*
							 * 帧级 overlay 的**模拟**：真实产品里这一层由 DSH 的 AppFrame 提供
							 * （`shell.overlay`：absolute、inset:0、pointer-events:none）。
							 * 这里的 `.pv-overlay--pane` 只是把「设计图居中于对话+工作区」演出来；
							 * 「整帧」那档就是真实 overlay 的 0 偏移。
							 */}
							<div
								className={`pv-overlay${align === 'pane' ? ' pv-overlay--pane' : ''}`}
								data-overlay={align}
								style={
									align === 'pane'
										? { left: `${String(SIDEBAR_WIDTH)}px` }
										: undefined
								}
							>
								<Drawer
									open={drawer.open}
									onClose={drawer.close}
									workspace={drawerProps}
									bottomOffset={FULL_BOTTOM_OFFSET}
									onRefresh={() => {
										say('抽屉：刷新（预览：没有服务端）');
									}}
								/>
							</div>
						</>
					)}
				</div>
			</div>

			{notice === undefined ? null : (
				<div className="pv-toast" data-pv-toast>
					<span>{notice}</span>
					<button
						type="button"
						onClick={() => {
							setNotice(undefined);
						}}
					>
						知道了
					</button>
				</div>
			)}
		</div>
	);
}

/* 产品样式和预览是同一份 —— 不在预览的 style.css 里抄一份。 */
initRenderers();
injectStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
