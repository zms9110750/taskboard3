/**
 * 组件预览入口 —— **只用于给用户看组件，不进产物、不进插件**。
 *
 * 由 `scripts/build-preview.mjs` 用 rolldown 打成一个**自包含 HTML**，双击即可打开。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { FilterBox } from '../components/FilterBox.tsx';
import { FilterRow } from '../components/FilterRow.tsx';
import type { FilterSpec } from '../components/FilterRow.tsx';
import { segmentsOf } from '../pure/filter-box.ts';
import type { FilterNode, Picked } from '../pure/filter-box.ts';

/* ── 夹具 ── */

const STATUS: readonly FilterNode[] = [
	{ value: 'draft', label: '草稿', children: [{ value: 'unspecified', label: '未指定' }] },
	{
		value: 'active',
		label: '进行',
		children: [
			{ value: 'submitted', label: '提交' },
			{ value: 'working', label: '处理中' },
		],
	},
	{
		value: 'shelved',
		label: '搁置',
		children: [
			{ value: 'input-required', label: '需要信息' },
			{ value: 'auth-required', label: '需要授权' },
		],
	},
	{
		value: 'ended',
		label: '完成',
		children: [
			{ value: 'completed', label: '成功' },
			{ value: 'failed', label: '失败' },
			{ value: 'canceled', label: '取消' },
			{ value: 'rejected', label: '拒绝' },
		],
	},
];

const KINDS: readonly FilterNode[] = [
	{ value: 'goal', label: '目标' },
	{ value: 'design', label: '设计' },
	{ value: 'work', label: '工作' },
	{ value: 'record', label: '记录' },
];

const DOMAINS: readonly FilterNode[] = [
	{ value: '核心', label: '核心' },
	{ value: '代码', label: '代码' },
	{ value: '写作', label: '写作' },
	{ value: '绘画', label: '绘画' },
];

const n = (v: string, kids?: readonly FilterNode[]): FilterNode =>
	kids === undefined ? { value: v, label: v } : { value: v, label: v, children: kids };

const DEEP: readonly FilterNode[] = [
	n('1', [n('2', [n('3', [n('2', [n('4'), n('5')]), n('6')]), n('7')]), n('8')]),
	n('9'),
];

/** 受控单盒子。 */
function SoloBox(props: {
	readonly title: string;
	readonly nodes: readonly FilterNode[];
	readonly initial?: Picked;
}): React.ReactNode {
	const [picked, setPicked] = useState<Picked>(props.initial ?? []);
	const [open, setOpen] = useState(true);
	return (
		<div className="filter-row" style={{ gap: 10 }}>
			<FilterBox
				boxId="solo"
				title={props.title}
				nodes={props.nodes}
				picked={picked}
				open={open}
				onChange={setPicked}
				onOpenChange={setOpen}
			/>
			<code style={{ fontSize: 10.5, color: '#9aa1ad', fontFamily: 'var(--mono)' }}>
				{JSON.stringify(picked)}
			</code>
		</div>
	);
}

/** 预览页。 */
function App(): React.ReactNode {
	const [values, setValues] = useState<Record<string, Picked>>({
		status: [],
		kind: [],
		domain: [],
	});

	const specs: readonly FilterSpec[] = [
		{ id: 'status', title: '状态', nodes: STATUS, picked: values['status'] ?? [] },
		{ id: 'kind', title: '类别', nodes: KINDS, picked: values['kind'] ?? [] },
		{ id: 'domain', title: '领域', nodes: DOMAINS, picked: values['domain'] ?? [] },
	];

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>FilterBox</h1>
				<p>面包屑筛选 · 一个操作 · 一个按钮为单位</p>
			</header>

			<section className="pv-block">
				<h2>① 真实用法：一排三个（互斥在这一层保证）</h2>
				<FilterRow
					filters={specs}
					onChange={(id, next) => setValues((prev) => ({ ...prev, [id]: next }))}
					trailing={
						<span style={{ fontSize: 11, color: '#9aa1ad' }}>← 右边以后放搜索框</span>
					}
				/>
				<div className="pv-state">
					{specs.map((spec) => (
						<div key={spec.id}>
							<span className="pv-k">{spec.id}</span>
							<code>{JSON.stringify(spec.picked)}</code>
						</div>
					))}
				</div>
			</section>

			<section className="pv-block">
				<h2>② 只有一个操作</h2>
				<table className="pv-table">
					<thead>
						<tr>
							<th>点哪里</th>
							<th>next</th>
							<th>之后</th>
						</tr>
					</thead>
					<tbody>
						<tr>
							<td>标题「状态」（第 0 级）</td>
							<td><code>[]</code></td>
							<td>清空 + 展开</td>
						</tr>
						<tr>
							<td>面包屑第 i 段</td>
							<td><code>picked.slice(0, i+1)</code></td>
							<td>选中它 + 展开</td>
						</tr>
						<tr>
							<td>当前层 / 子层任一项</td>
							<td>它的路径</td>
							<td>选中它 + 展开</td>
						</tr>
					</tbody>
				</table>
				<p className="pv-note" style={{ marginTop: 12, marginBottom: 0 }}>
					组件里**只有一个函数**：
					<code>select(next) {'=> {'} onChange(next); onOpenChange(true) {'}'}</code>
					<br />
					没有任何 <code>if (点的是标题) … else if (点的是面包屑) …</code>。
					区别只在 <code>next</code>，而 <code>next</code> 是纯函数算好的。
				</p>
			</section>

			<section className="pv-block">
				<h2>③ 四级实例（1/2/3/2/4）</h2>
				<p className="pv-note">
					点「1」→ 选中 1 并展开 2/8；点「2」→ 选中 2 并展开 3/7；
					面包屑里每段都能点，点了就跳回那一层。
				</p>
				<SoloBox title="编号" nodes={DEEP} />
				<div style={{ marginTop: 14 }}>
					<SoloBox title="编号" nodes={DEEP} initial={['1', '2', '3', '2']} />
				</div>
			</section>

			<section className="pv-block">
				<h2>④ 各层收起态（看面包屑）</h2>
				<div className="filter-row">
					<FilterBox boxId="s0" title="状态" nodes={STATUS} picked={[]} open={false}
						onChange={() => undefined} onOpenChange={() => undefined} />
					<FilterBox boxId="s1" title="状态" nodes={STATUS} picked={['ended']} open={false}
						onChange={() => undefined} onOpenChange={() => undefined} />
					<FilterBox boxId="s2" title="状态" nodes={STATUS} picked={['ended', 'failed']} open={false}
						onChange={() => undefined} onOpenChange={() => undefined} />
					<FilterBox boxId="s3" title="类别" nodes={KINDS} picked={['work']} open={false}
						onChange={() => undefined} onOpenChange={() => undefined} />
				</div>
				<p className="pv-note" style={{ marginTop: 12, marginBottom: 0 }}>
					<code>状态</code> · <code>状态：完成</code> ·
					<code>状态：完成 / 失败</code> · <code>类别：工作</code>
					<br />
					标题是第 0 级（点了清空）；面包屑每段都能点；<b>没有 ▾、没有 ✕</b>。
				</p>
			</section>

			<section className="pv-block">
				<h2>⑤ 展开态结构（点开①的第一个方框看）</h2>
				<p className="pv-note" style={{ marginBottom: 0 }}>
					永远是若干段，段间一条竖线：<br />
					<b>①面包屑</b>（祖先，紧斜杠 <code>/</code>，可点跳回）│
					<b>②当前层兄弟</b>（空格斜杠 <code> / </code>，选中的蓝字加粗）│
					<b>③选中项的子</b>（空格斜杠 <code> / </code>）
					<br />
					① 只在选中项不是第 1 级时出现；③ 只在选中项有子时出现；<b>②永远有</b>。
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

