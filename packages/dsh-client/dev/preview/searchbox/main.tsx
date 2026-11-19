/**
 * SearchBox 预览入口 —— **只在 `dev/preview/searchbox/` 里，不碰根 `main.tsx`**。
 *
 * ## 三段
 *
 * ① **舞台**（受控真交互）—— 三个状态切换按钮（空 / 有内容 / 禁用），
 *    直接在输入框里打字、回车、点「前往」都能用；右侧状态行 + 回调日志
 *    让 CDP 断言能读到「发生了什么」。
 * ② **三个固定场景** —— `data-scenario` 挂在这里，几何断言（图标在框内、
 *    按钮同一行、贴边）全部量这三个，不依赖舞台当前处在哪个模式。
 * ③ **视觉细节表** —— 那些**没有**来自用户原话、是我自己定的数值，
 *    逐条列出来给用户审（用户只审这里）。
 *
 * 用户 `2026-11-19` 原话：
 * > 「加一个按钮。为搜索框加一个框内图标。别的组件框架都提供这种插槽的。
 * >  你应该知道框内图标长啥样。」
 */

import { StrictMode, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { SearchBox } from '../../../src/renderers/SearchBox.tsx';

/** 舞台的三个模式。 */
type Mode = 'empty' | 'typed' | 'disabled';

/** 每个模式对应的受控值。 */
const MODE_VALUE: Record<Mode, string> = {
	empty: '',
	typed: '框内图标',
	disabled: '框内图标',
};

/* ── ① 舞台 ── */

interface StageProps {
	readonly onEvent: (what: string) => void;
}

function Stage(props: StageProps): ReactNode {
	const [mode, setMode] = useState<Mode>('empty');
	const [value, setValue] = useState('');
	const [disabled, setDisabled] = useState(false);
	const [changes, setChanges] = useState(0);
	const [submits, setSubmits] = useState(0);
	const [lastSubmit, setLastSubmit] = useState('（还没提交过）');

	/** 切模式：只是把三个状态摆出来给截图，不是组件内部状态。 */
	const applyMode = (next: Mode): void => {
		setMode(next);
		setValue(MODE_VALUE[next]);
		setDisabled(next === 'disabled');
	};

	return (
		<section className="pv-block" data-stage-block="1" data-mode={mode}>
			<h2>① 舞台（受控 · 直接打字 / 回车 / 点「前往」都可以）</h2>

			<div className="sb-modes">
				{(['empty', 'typed', 'disabled'] as const).map((one) => (
					<button
						key={one}
						type="button"
						className={`sb-modes__btn${mode === one ? ' is-on' : ''}`}
						data-mode-btn={one}
						onClick={() => {
							applyMode(one);
						}}
					>
						{one === 'empty' ? '空' : one === 'typed' ? '有内容' : '禁用'}
					</button>
				))}
			</div>

			<div className="sb-stage" data-stage="1">
				<SearchBox
					value={value}
					disabled={disabled}
					onChange={(next) => {
						setValue(next);
						setChanges((n) => n + 1);
						props.onEvent(`change:${next}`);
					}}
					onSubmit={(query) => {
						setSubmits((n) => n + 1);
						setLastSubmit(query);
						props.onEvent(`submit:${query}`);
					}}
				/>
			</div>

			<div className="pv-state">
				<div>
					<span className="pv-k">value</span>
					<code data-value>{value === '' ? '（空）' : value}</code>
				</div>
				<div>
					<span className="pv-k">disabled</span>
					<code data-disabled>{String(disabled)}</code>
				</div>
				<div>
					<span className="pv-k">onChange 次数</span>
					<code data-changes>{changes}</code>
				</div>
				<div>
					<span className="pv-k">onSubmit 次数</span>
					<code data-submits>{submits}</code>
				</div>
				<div>
					<span className="pv-k">上次提交</span>
					<code data-last-submit>{lastSubmit}</code>
				</div>
			</div>

			<p className="pv-note" style={{ marginTop: 12, marginBottom: 0 }}>
				⚠ 舞台是<b>受控</b>的：`value` 在 React state 里，组件自己不持有。
				输入后**不清空**；回车和「前往」都走同一个 `onSubmit`（日志里只多一条，不是两条）。
			</p>
		</section>
	);
}

/* ── ② 三个固定场景 ── */

interface FixedProps {
	readonly scenario: string;
	readonly label: string;
	readonly initial: string;
	readonly disabledValue: boolean;
	readonly onEvent: (what: string) => void;
}

function Fixed(props: FixedProps): ReactNode {
	const [value, setValue] = useState(props.initial);

	return (
		<div className="sb-scenario" data-scenario={props.scenario}>
			<span className="sb-scenario__label">{props.label}</span>
			<div className="sb-scenario__box">
				<SearchBox
					value={value}
					disabled={props.disabledValue}
					onChange={(next) => {
						setValue(next);
						props.onEvent(`fixed/${props.scenario}/change:${next}`);
					}}
					onSubmit={(query) => {
						props.onEvent(`fixed/${props.scenario}/submit:${query}`);
					}}
				/>
			</div>
		</div>
	);
}

/* ── ③ 视觉细节表 ── */

interface Detail {
	readonly what: string;
	readonly value: string;
	readonly why: string;
	readonly source: '用户原话' | '我定的';
}

const DETAILS: readonly Detail[] = [
	{
		what: '图标形状',
		value: '放大镜 = 圆 + 斜柄（inline SVG，24 viewBox 缩到 14px）',
		why: '「框内图标长啥样」的默认答案；零依赖，不引图标库',
		source: '用户原话',
	},
	{
		what: '图标位置',
		value: '框内左侧，距边框 11px',
		why: '主流框架 start adornment 的默认位置',
		source: '用户原话',
	},
	{
		what: '「前往」位置',
		value: '贴在输入框右边（共用一条外边框，不是隔开的两个盒子）',
		why: '任务书那张 `┌────┬────┐` 的图就是这个形状',
		source: '用户原话',
	},
	{
		what: '高度',
		value: '36px（输入框与按钮等高）',
		why: '跟 `.ghost-btn` / 列表条同一档呼吸感；SpaceBar 定过 36px',
		source: '我定的',
	},
	{
		what: '圆角',
		value: '8px（只有整条两端圆，中间拼缝是直角）',
		why: '跟 `.tb3cc-input` / 新建页输入框一致',
		source: '我定的',
	},
	{
		what: '图标颜色',
		value: '`--text-weak`（#9aa1ad）',
		why: '图标是提示不是内容，不该抢文字的对比度',
		source: '我定的',
	},
	{
		what: '图标与文字间距',
		value: '左内边距 33px = 11px 边距 + 14px 图标 + 8px 间距',
		why: '文字不能压到图标；也不让图标离文字太远',
		source: '我定的',
	},
	{
		what: '「前往」配色',
		value: '可点 = 实心 accent 蓝底白字；不可点 = 灰底灰字灰边',
		why: '整页只有一个主操作，实心是「这是按钮」的最短路径；禁用靠真 `disabled` + 视觉弱化',
		source: '我定的',
	},
	{
		what: '按钮宽度',
		value: 'padding 0 20px（不定死，2 个字撑开约 64px）',
		why: '禁止硬编码宽度；将来文案变（如「搜索」）不挤破',
		source: '我定的',
	},
	{
		what: '焦点态',
		value: '只把边框换成 accent 蓝，不加外发光',
		why: '跟 `.tb3cc-input:focus` 一致；拼缝处画光环会溢到按钮上',
		source: '我定的',
	},
	{
		what: '占位文字',
		value: '「搜标题，或输入完整编号后回车…」（默认值，可被 `placeholder` 覆盖）',
		why: '任务书布局图里的那句',
		source: '用户原话',
	},
	{
		what: '按钮 title',
		value: '动态：禁用时「搜索不可用」/ 空时「先输入搜索词」/ 有值时「搜索「X」」',
		why: '说清点了会发生什么；trim 后的值进 title',
		source: '我定的',
	},
];

function Details(): ReactNode {
	return (
		<section className="pv-block">
			<h2>③ 视觉细节（哪些是「我定的」—— 用户只审这些）</h2>
			<table className="pv-table">
				<thead>
					<tr>
						<th>项</th>
						<th>值</th>
						<th>理由</th>
						<th>来源</th>
					</tr>
				</thead>
				<tbody>
					{DETAILS.map((one) => (
						<tr key={one.what}>
							<td>{one.what}</td>
							<td>{one.value}</td>
							<td>{one.why}</td>
							<td>
								<b>{one.source}</b>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="pv-note" style={{ marginTop: 12, marginBottom: 0 }}>
				⚠ 组件本体：<code>src/renderers/SearchBox.tsx</code>（受控、零依赖）；
				样式：<code>dev/preview/searchbox/style.css</code>（还没进 <code>src/styles.ts</code>，
				因为组件还没定稿）。行为断言在 <code>verify.mjs</code>。
			</p>
		</section>
	);
}

/* ── 页面 ── */

function App(): ReactNode {
	const [events, setEvents] = useState<readonly string[]>([]);
	const push = (what: string): void => {
		setEvents((one) => [...one, what]);
	};

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>SearchBox / 任务板搜索框</h1>
				<p>
					框内左侧放大镜（inline SVG）· 右边「前往」· 回车与按钮走同一个提交入口 ·
					空输入 / 纯空格不提交 · 组件受控、零依赖
				</p>
			</header>

			<Stage onEvent={push} />

			<section className="pv-block">
				<h2>② 三个固定状态（几何断言量这三行）</h2>
				<Fixed scenario="empty" label="空" initial="" disabledValue={false} onEvent={push} />
				<Fixed
					scenario="typed"
					label="有内容"
					initial="框内图标"
					disabledValue={false}
					onEvent={push}
				/>
				<Fixed
					scenario="disabled"
					label="禁用"
					initial="框内图标"
					disabledValue
					onEvent={push}
				/>
				<p className="pv-note" style={{ marginTop: 6, marginBottom: 0 }}>
					三行都是真的受控组件（可以点进去打字）；「禁用」那行的输入框与按钮都是真
					<code>disabled</code>。
				</p>
			</section>

			<Details />

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
				<button
					type="button"
					className="sb-modes__btn"
					data-clear-log
					onClick={() => {
						setEvents([]);
					}}
				>
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
