/**
 * 权限面板预览 —— **只在 `dev/preview/permission/` 里，不碰根 `main.tsx`**。
 *
 * 构建：`node packages/dsh-client/dev/preview/build.mjs permission`
 * 产物：`dev/preview/permission/index.html`（双击看，自包含、file:// 直开）
 *
 * ## 六段
 *
 * ① **活的**（真状态机 + 模拟网络）—— 点档位立刻「保存」，可勾选「下一次失败」验回滚。
 * ② **状态矩阵** —— 加载中 / 加载失败 / 已加载 / UI 轴保存中 / 宿主轴保存中 / 保存失败 / 文案来自接口。
 * ③ **回调日志**。
 * ④ **规则表**（两条轴 × 三档，文案直接取 core 的选项表）。
 * ⑤ **视觉决定清单**（哪些是我定的，用户只审这些）。
 * ⑥ **图和文档冲突的处理**。
 *
 * ## ⚠ 为什么文案 import 自 core 源码，而不是在预览里抄一份
 *
 * 任务书要求「选项文案从 API 的 options 数组来，不要硬编码第二份」。
 * 预览没有真服务端，所以夹具直接 import core 的 `CARD_ACTION_OPTIONS` /
 * `TOOL_GUARD_OPTIONS` —— 和 dsh 的 HTTP 路由返回的是**同一份常量**。
 * 另有一个静态场景把 label / description 加前缀，证明组件确实「传什么画什么」。
 */

import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { CARD_ACTION_OPTIONS } from '../../../../core/src/permission.ts';
/*
 * `TOOL_GUARD_OPTIONS` 已搬进 `@taskboard/dsh-tools`（用户 2026-11-23：agent 侧那套
 * 权限不归 core）。预览页是 dev 产物、不走包边界，所以直接相对路径取源码。
 */
import { TOOL_GUARD_OPTIONS } from '../../../../dsh-tools/src/tool-guard.ts';
import { PermissionPanel } from '../../../src/renderers/PermissionPanel.tsx';
import {
	NO_PENDING,
	beginSave,
	commitSave,
	dismissSaveError,
	failSave,
	requestBodyOf,
} from '../../../src/pure/permission-view.ts';
import type {
	AxisKey,
	PanelState,
	PermissionOption,
	PermissionSnapshot,
} from '../../../src/pure/permission-view.ts';

/* ══════════════════════════════════════════════════════════
   夹具：**和 HTTP 路由同一份**选项表（core 源码）
   ══════════════════════════════════════════════════════════ */

const CARD_OPTIONS: readonly PermissionOption[] = CARD_ACTION_OPTIONS;
const TOOL_OPTIONS: readonly PermissionOption[] = TOOL_GUARD_OPTIONS;

/** 产品默认值：`cardActionLevel='no-claim'`、`toolGuardLevel='off'`（docs/权限两轴.md §六）。 */
const DEMO_SNAPSHOT: PermissionSnapshot = {
	cardActionLevel: 'no-claim',
	toolGuardLevel: 'off',
	cardActionOptions: CARD_OPTIONS,
	toolGuardOptions: TOOL_OPTIONS,
};

const DEMO_READY: PanelState = {
	phase: 'ready',
	snapshot: DEMO_SNAPSHOT,
	pending: NO_PENDING,
	saveError: null,
};

/* ══════════════════════════════════════════════════════════
   ① 活的：真状态机 + 模拟网络（700ms GET / 900ms POST）
   ══════════════════════════════════════════════════════════ */

interface SectionProps {
	readonly onEvent: (what: string) => void;
}

function Live(props: SectionProps): React.ReactNode {
	const [state, setState] = useState<PanelState>({ phase: 'loading' });
	const [failNext, setFailNext] = useState(false);
	const failRef = useRef(false);
	failRef.current = failNext;
	/*
	 * ⚠ **每条轴一个计时器** —— 两条轴可以同时在保存（正交），
	 *   用一个计时器会在点第二条轴时把第一条的模拟响应取消掉，第一条轴永远 pending。
	 */
	const timersRef = useRef<{ card?: number; tool?: number }>({});

	const clearTimerOf = (axis: AxisKey): void => {
		const id = timersRef.current[axis];
		if (id !== undefined) {
			window.clearTimeout(id);
			delete timersRef.current[axis];
		}
	};
	const clearTimers = (): void => {
		clearTimerOf('card');
		clearTimerOf('tool');
	};

	/** 模拟一次 GET（700ms）。 */
	const load = (): void => {
		clearTimers();
		props.onEvent('GET /api/permission（模拟，700ms）');
		setState({ phase: 'loading' });
		timersRef.current.card = window.setTimeout(() => {
			delete timersRef.current.card;
			props.onEvent('GET /api/permission → 200（两条轴 + 两个 options 数组）');
			setState({ phase: 'ready', snapshot: DEMO_SNAPSHOT, pending: NO_PENDING, saveError: null });
		}, 700);
	};

	useEffect(() => {
		load();
		return clearTimers;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/** 模拟一次 POST（900ms，可注入失败）。 */
	const select = (axis: AxisKey, value: string): void => {
		const next = beginSave(state, axis, value);
		if (next === state) return;
		setState(next);
		props.onEvent(
			`POST /api/permission body=${JSON.stringify(requestBodyOf(axis, value))}（模拟，900ms，只带 ${axis} 轴）`,
		);
		clearTimerOf(axis);
		timersRef.current[axis] = window.setTimeout(() => {
			delete timersRef.current[axis];
			const willFail = failRef.current;
			props.onEvent(
				willFail
					? `POST /api/permission → 失败（${axis} 轴回滚）`
					: `POST /api/permission → 200（${axis} 轴已保存）`,
			);
			setState((current) => {
				if (current.phase !== 'ready') return current;
				if (willFail) return failSave(current, axis, '网络中断（预览里模拟的失败）');
				return commitSave(current, axis, {
					cardActionLevel: current.snapshot.cardActionLevel,
					toolGuardLevel: current.snapshot.toolGuardLevel,
				});
			});
		}, 900);
	};

	const levels =
		state.phase === 'ready'
			? { card: state.snapshot.cardActionLevel, tool: state.snapshot.toolGuardLevel }
			: { card: '—', tool: '—' };

	return (
		<section className="pv-block">
			<h2>① 活的（点一档立刻保存；勾上「下一次失败」看回滚）</h2>
			<p className="pv-note" style={{ marginTop: 0 }}>
				数据是 core 的<b>真实选项表</b>；GET 700ms、POST 900ms 是假延迟。
				默认值 = 产品默认（<code>no-claim</code> + <code>off</code>，即最严 + 不管工具）。
			</p>

			<div className="pv-row" style={{ marginBottom: 12 }}>
				<label className="pv-check">
					<input
						type="checkbox"
						data-demo-fail
						checked={failNext}
						onChange={(event) => {
							setFailNext(event.target.checked);
							props.onEvent(`下一次保存失败 = ${String(event.target.checked)}`);
						}}
					/>
					下一次保存失败（演示回滚）
				</label>
				<button
					type="button"
					className="ghost-btn"
					data-demo-load-error
					onClick={() => {
						clearTimers();
						props.onEvent('GET /api/permission → 失败（演示）');
						setState({ phase: 'load-error', message: '无法连接任务板服务：fetch failed（演示）' });
					}}
				>
					模拟加载失败
				</button>
				<button type="button" className="ghost-btn" data-demo-reload onClick={load}>
					重新加载
				</button>
			</div>

			<div className="perm-stage perm-stage--workspace">
				<PermissionPanel
					state={state}
					onSelect={select}
					onRetry={load}
					onDismissSaveError={() => {
						props.onEvent('点 × 关闭保存失败提示');
						setState((current) => dismissSaveError(current));
					}}
				/>
			</div>

			<div className="pv-state">
				<div>
					<span className="pv-k">phase</span>
					<code data-live-phase>{state.phase}</code>
				</div>
				<div>
					<span className="pv-k">cardActionLevel</span>
					<code data-live-card>{levels.card}</code>
				</div>
				<div>
					<span className="pv-k">toolGuardLevel</span>
					<code data-live-tool>{levels.tool}</code>
				</div>
				<div>
					<span className="pv-k">pending</span>
					<code data-live-pending>
						{state.phase === 'ready' ? JSON.stringify(state.pending) : '—'}
					</code>
				</div>
				<div>
					<span className="pv-k">saveError</span>
					<code data-live-error>
						{state.phase === 'ready' && state.saveError !== null
							? state.saveError.message
							: 'null'}
					</code>
				</div>
			</div>
		</section>
	);
}

/* ══════════════════════════════════════════════════════════
   ② 状态矩阵：每个状态固定一份，直接看
   ══════════════════════════════════════════════════════════ */

const MATRIX_SNAPSHOT: PermissionSnapshot = {
	cardActionLevel: 'claim',
	toolGuardLevel: 'manage',
	cardActionOptions: CARD_OPTIONS,
	toolGuardOptions: TOOL_OPTIONS,
};

const MATRIX_READY: PanelState = {
	phase: 'ready',
	snapshot: MATRIX_SNAPSHOT,
	pending: NO_PENDING,
	saveError: null,
};

/** 自定义文案：故意加前缀 —— 证明组件画的是 props 里的文案，不是内置的。 */
const CUSTOM_SNAPSHOT: PermissionSnapshot = {
	cardActionLevel: 'claim',
	toolGuardLevel: 'off',
	cardActionOptions: CARD_OPTIONS.map((one) => ({
		...one,
		label: `【接口】${one.label}`,
		description: `【接口】${one.description}`,
	})),
	toolGuardOptions: TOOL_GUARD_OPTIONS.map((one) => ({
		...one,
		label: `【接口】${one.label}`,
		description: `【接口】${one.description}`,
	})),
};

interface Scenario {
	readonly key: string;
	readonly note: string;
	readonly state: PanelState;
}

const SCENARIOS: readonly Scenario[] = [
	{
		key: 'loading',
		note: '加载中：两条轴的骨架（标题 + 3 行选项），没有可点的东西。',
		state: { phase: 'loading' },
	},
	{
		key: 'load-error',
		note: '加载失败：说清原因 + 「重试」按钮。重试只会重新 GET，不会拿旧数据硬画。',
		state: { phase: 'load-error', message: '无法连接任务板服务：fetch failed（演示）' },
	},
	{
		key: 'ready',
		note: '已加载：每条轴恰好一个「当前」圆点；每档都显示接口给的 description。',
		state: MATRIX_READY,
	},
	{
		key: 'pending-card',
		note: 'UI 轴保存中：这一档乐观选中 + 转圈；**整条 UI 轴**禁用，宿主轴照常可点。',
		state: beginSave(MATRIX_READY, 'card', 'adopt'),
	},
	{
		key: 'pending-tool',
		note: '宿主轴保存中：只有宿主轴禁用；UI 轴照常可点（两条轴各自独立）。',
		state: beginSave(MATRIX_READY, 'tool', 'manage-edit'),
	},
	{
		key: 'save-error',
		note: '保存失败：已回滚到「允许领卡」（不是刚才点的「允许采纳草稿」）+ 顶部错误横幅。',
		state: failSave(
			beginSave(MATRIX_READY, 'card', 'adopt'),
			'card',
			'任务板服务返回了非 JSON 内容（HTTP 502）',
		),
	},
	{
		key: 'custom-labels',
		note: '文案来自接口：label / description 全部加了「【接口】」前缀 —— 组件没有内置第二份文案。',
		state: {
			phase: 'ready',
			snapshot: CUSTOM_SNAPSHOT,
			pending: NO_PENDING,
			saveError: null,
		},
	},
];

function Matrix(props: SectionProps): React.ReactNode {
	return (
		<section className="pv-block">
			<h2>② 状态矩阵（每种状态一份固定数据，逐个看）</h2>
			{SCENARIOS.map((scenario) => (
				<div className="pv-case" key={scenario.key} data-scenario={scenario.key}>
					<div className="pv-case__note">
						<code>{scenario.key}</code> · {scenario.note}
					</div>
					<div className="perm-stage">
						<PermissionPanel
							state={scenario.state}
							onSelect={(axis, value) =>
								props.onEvent(
									`${scenario.key}/select:${axis}:${value}（静态矩阵只记日志）`,
								)
							}
							onRetry={() => props.onEvent(`${scenario.key}/retry`)}
							onDismissSaveError={() => props.onEvent(`${scenario.key}/dismiss-error`)}
						/>
					</div>
				</div>
			))}
		</section>
	);
}

/* ══════════════════════════════════════════════════════════
   ④ 规则表（直接读 core 的选项表）
   ══════════════════════════════════════════════════════════ */

function Rules(): React.ReactNode {
	const rows = [
		{ axis: 'UI 轴', field: 'cardActionLevel', note: '任何宿主都生效', options: CARD_OPTIONS },
		{ axis: '宿主轴', field: 'toolGuardLevel', note: '只有能拦工具的宿主才有', options: TOOL_OPTIONS },
	] as const satisfies readonly {
		readonly axis: string;
		readonly field: string;
		readonly note: string;
		readonly options: readonly PermissionOption[];
	}[];

	return (
		<section className="pv-block">
			<h2>④ 规则表（两条正交轴 × 三档，文案取自 core 的选项表）</h2>
			<table className="pv-table" data-rules>
				<thead>
					<tr>
						<th>轴</th>
						<th>POST 字段</th>
						<th>值</th>
						<th>label</th>
						<th>description（接口给的说明）</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) =>
						row.options.map((option, index) => (
							<tr key={`${row.field}-${option.value}`}>
								{index === 0 ? (
									<>
										<td rowSpan={row.options.length}>
											<b>{row.axis}</b>
											<br />
											<span className="pv-dim">{row.note}</span>
										</td>
										<td rowSpan={row.options.length}>
											<code>{row.field}</code>
										</td>
									</>
								) : null}
								<td>
									<code>{option.value}</code>
								</td>
								<td>{option.label}</td>
								<td>{option.description}</td>
							</tr>
						)),
					)}
				</tbody>
			</table>
			<p className="pv-note" style={{ marginTop: 10, marginBottom: 0 }}>
				点一档 ⇒ <code>POST /api/permission</code>，body 只带被改的那条轴（
				<code>cardActionLevel</code> 或 <code>toolGuardLevel</code>，PATCH 语义）。保存中该档显示转圈、
				本轴其余档禁用；失败回滚到点之前那一档并显示横幅。
			</p>
		</section>
	);
}

/* ══════════════════════════════════════════════════════════
   ⑤ 视觉决定清单 + ⑥ 图/文档冲突
   ══════════════════════════════════════════════════════════ */

const VISUAL_DECISIONS: readonly { readonly what: string; readonly how: string }[] = [
	{
		what: '档位行形态',
		how: '整行是一个圆点 + 档位名 + 一句接口 description；悬停整行浅灰、选中整行浅蓝底 + 蓝色描边。不画成下拉、不画成按钮组。',
	},
	{
		what: '圆点尺寸 / 颜色',
		how: '14px 圆环、1.5px 描边；选中变成实心蓝圈 + 白色 6px 内点。原生 radio 透明覆盖整行（键盘 / 读屏用它）。',
	},
	{
		what: '「当前」标记',
		how: '选中档的行内右侧一个浅蓝小胶囊「当前」；保存中的那一档换成「转圈 + 保存中…」，不再显示「当前」。',
	},
	{
		what: '轴标题',
		how: '每条轴一张白卡片；标题左侧 19px 圆形编号 ① / ②；右侧「当前：<label>」灰字。卡片头浅灰底。',
	},
	{
		what: '保存失败横幅',
		how: '面板顶部红色浅底 + 警示三角 + 整句（含「已回滚到「…」」）+ 右侧 × 关闭。',
	},
	{
		what: '加载中',
		how: '两条轴各一块骨架卡（1 行标题 + 3 行选项），浅灰渐变呼吸动画。',
	},
	{
		what: '加载失败',
		how: '虚线边框块（提示这是「空态」不是错误卡片）：警示三角 + 标题 + 原因 + 「重试」按钮。',
	},
	{
		what: '底部正交说明',
		how: '虚线小字块：「两条轴互不覆盖……任意组合都有效（3 × 3 = 9 种结果）」+ 一句「宿主关掉工具管控时领卡仍受 UI 轴管」。',
	},
	{
		what: '面板宽度 / 字号',
		how: '流式宽度、max-width 760px；正文 13px、description 11.5px、编号 / 值用等宽字体。没有做断点，窄到 320px 时靠文字自然换行（570 宽的工区 tab 里是单列）。',
	},
];

function Decisions(): React.ReactNode {
	return (
		<section className="pv-block">
			<h2>⑤ 视觉决定（这些是我定的，用户只审这些）</h2>
			<table className="pv-table" data-decisions>
				<thead>
					<tr>
						<th style={{ width: 150 }}>细节</th>
						<th>我的决定</th>
					</tr>
				</thead>
				<tbody>
					{VISUAL_DECISIONS.map((one) => (
						<tr key={one.what}>
							<td>
								<b>{one.what}</b>
							</td>
							<td>{one.how}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
}

function Conflicts(): React.ReactNode {
	return (
		<section className="pv-block">
			<h2>⑥ 图和文档冲突：以文档为准（用户 2026-11-19 改的）</h2>
			<table className="pv-table" data-conflicts>
				<thead>
					<tr>
						<th>设计图 view-2-permission.png 画的（旧模型）</th>
						<th>本面板做的（docs/权限两轴.md）</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>「权限模式」4 选 1：taskboard-plan / taskboard-work / taskboard-auto / danger-full-access（DSH 预设名）</td>
						<td>
							<b>不做 4 选 1</b>。换成两条正交轴的各 3 档；不显示、也不注册任何 DSH 权限预设名。
						</td>
					</tr>
					<tr>
						<td>页面顶部三个标签：① 权限模式 / ② 工作空间 / ③ 模板工具策略</td>
						<td>
							<b>本次只做①</b>。工作空间页、模板工具策略页这次不做（V2 只做档位）。
						</td>
					</tr>
					<tr>
						<td>「保存」按钮 + 「恢复默认」按钮</td>
						<td>
							<b>没有保存按钮</b> —— 点一档立刻 POST。也没有「恢复默认」：默认值只是初始档，不是一键操作（用户没要求）。
						</td>
					</tr>
					<tr>
						<td>一条四档轴：不允许领卡 → 允许领卡 → 允许采纳草稿 → 允许编辑档位权限</td>
						<td>
							<b>拆成两条</b>：UI 轴 3 档（no-claim / claim / adopt）+ 宿主轴 3 档（off / manage / manage-edit）。
							「允许编辑档位权限」归宿主轴 —— 它是工具层能力，不是领卡业务规则。
						</td>
					</tr>
					<tr>
						<td>图里的 guard 判定顺序（① 不是任务板预设 ⇒ 放行 …）</td>
						<td>
							<b>不展示</b>。那是 dsh 侧实现的判定；面板只负责写两个档位值。
						</td>
					</tr>
				</tbody>
			</table>
		</section>
	);
}

/* ══════════════════════════════════════════════════════════
   ③ 回调日志 + App
   ══════════════════════════════════════════════════════════ */

function App(): React.ReactNode {
	const [events, setEvents] = useState<readonly string[]>([]);
	const push = (what: string): void => {
		setEvents((one) => [...one, what]);
	};

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>任务板权限面板 V2 · 两条正交轴</h1>
				<p>
					依据 <code>docs/权限两轴.md</code>（用户 2026-11-19 定稿）：
					UI 轴 <code>CardActionLevel</code>（no-claim / claim / adopt）与宿主轴{' '}
					<code>ToolGuardLevel</code>（off / manage / manage-edit）。⚠ 设计图画的是被否掉的
					「4 选 1 模式」，本面板按文档做两条轴 —— 冲突处理见 ⑥。
				</p>
			</header>

			<Live onEvent={push} />
			<Matrix onEvent={push} />

			<section className="pv-block">
				<h2>③ 回调日志（点了什么就是什么）</h2>
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

			<Rules />
			<Decisions />
			<Conflicts />
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
