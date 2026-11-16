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
import type { FilterNode, Picked } from '../pure/filter-box.ts';

/* ── 夹具：状态（两级） ── */

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

/* ── 夹具：四级树（用户举的 1/2/3/2/4 例子） ── */

const n = (v: string, kids?: readonly FilterNode[]): FilterNode =>
	kids === undefined ? { value: v, label: v } : { value: v, label: v, children: kids };

const DEEP: readonly FilterNode[] = [
	n('1', [n('2', [n('3', [n('2', [n('4'), n('5')]), n('6')]), n('7')]), n('8')]),
	n('9'),
];

/** 一个方框的受控演示（自己管 open）。 */
function SoloBox(props: {
	readonly title: string;
	readonly nodes: readonly FilterNode[];
	readonly initial?: Picked;
	readonly width?: number;
}): React.ReactNode {
	const [picked, setPicked] = useState<Picked>(props.initial ?? []);
	const [open, setOpen] = useState(true);
	return (
		<div className="filter-row" style={{ width: props.width ?? 420 }}>
			<FilterBox
				boxId="solo"
				title={props.title}
				nodes={props.nodes}
				picked={picked}
				open={open}
				onChange={setPicked}
				onOpenChange={setOpen}
			/>
			<div style={{ marginTop: 8, fontSize: 10.5, color: '#9aa1ad', fontFamily: 'var(--mono)' }}>
				picked = {JSON.stringify(picked)}
			</div>
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
				<p>面包屑导航 · 点到谁就选中谁 · 只展示两个可点层</p>
			</header>

			<section className="pv-block">
				<h2>① 真实用法：一排三个（互斥在这一层保证）</h2>
				<FilterRow
					filters={specs}
					onChange={(id, next) => setValues((prev) => ({ ...prev, [id]: next }))}
					trailing={
						<span style={{ fontSize: 11, color: '#9aa1ad' }}>← 右边这里以后放搜索框</span>
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
				<h2>② 结构：一个方框永远是三段</h2>
				<div className="pv-anatomy">
					<span className="a1">
						<span className="pv-tag">①</span>1/2/3/2
					</span>
					<span className="av" />
					<span className="a3">
						<span className="pv-tag">②</span>1<span className="as"> / </span>2
						<span className="as"> / </span>3<span className="as"> / </span>
						<span className="a2">4</span>
					</span>
					<span className="av" />
					<span className="a3">
						<span className="pv-tag">③</span>1<span className="as"> / </span>2
						<span className="as"> / </span>3
					</span>
				</div>
				<p className="pv-note" style={{ marginTop: 12, marginBottom: 0 }}>
					<b>①面包屑</b>= 路径上除自己外的祖先，紧斜杠 <code>/</code>，<b>可点跳回</b>；
					<b>②当前层</b>= 同层的全部兄弟（选中的蓝字加粗），空格斜杠 <code> / </code>；
					<b>③子层</b>= 选中项的子，空格斜杠 <code> / </code>。
					竖线把 ① 和 ②③ 分开 —— 这就是「怎么区分点到了谁身上」的答案。
				</p>
			</section>

			<section className="pv-block">
				<h2>③ 四级实例（用户举的 1/2/3/2/4）</h2>
				<p className="pv-note">
					点「1」→ 列出 2/8；点「2」→ 面包屑 1，列出 3/7 和子 2/8；
					点「3」→ 面包屑 1/2，列出 2/6 和子 3/7 ……
					<b>每一层都能看到「同层兄弟」和「下一步该往哪下探」</b>，不会越点越长。
				</p>
				<SoloBox title="编号" nodes={DEEP} width={460} />
			</section>

			<section className="pv-block">
				<h2>④ 各层选中态（看收起态显示对不对）</h2>
				<div className="filter-row">
					<FilterBox
						boxId="s0"
						title="状态"
						nodes={STATUS}
						picked={[]}
						open={false}
						onChange={() => undefined}
						onOpenChange={() => undefined}
					/>
					<FilterBox
						boxId="s1"
						title="状态"
						nodes={STATUS}
						picked={['ended']}
						open={false}
						onChange={() => undefined}
						onOpenChange={() => undefined}
					/>
					<FilterBox
						boxId="s2"
						title="状态"
						nodes={STATUS}
						picked={['ended', 'failed']}
						open={false}
						onChange={() => undefined}
						onOpenChange={() => undefined}
					/>
					<FilterBox
						boxId="s3"
						title="类别"
						nodes={KINDS}
						picked={['work']}
						open={false}
						onChange={() => undefined}
						onOpenChange={() => undefined}
					/>
				</div>
				<p className="pv-note" style={{ marginTop: 12, marginBottom: 0 }}>
					期望：<code>状态</code>（无值，点它展开）· <code>状态：完成</code> ·
					<code>状态：完成 / 失败</code> · <code>类别：工作</code>
					<br />
					<b>没有 ▾、没有 ✕</b> —— 全清靠点标题（标题 = 第 0 级）。
				</p>
			</section>

			<section className="pv-block">
				<h2>⑤ 规则清单</h2>
				<ol className="pv-list">
					<li>
						<b>点到谁就选中谁</b> —— 点「完成」就是选中「完成」，不是「清空选择」
					</li>
					<li>
						选中某个节点 ⇒ <b>它下面那层的选中被丢掉</b>（子级的选中取消掉）
					</li>
					<li>
						选中之后 <b>列出它的子项</b>（③ 段）
					</li>
					<li>
						<b>只展示两个可点层</b>：②当前层兄弟 + ③选中项的子。爷爷辈只在面包屑里
					</li>
					<li>
						<b>点标题 = 清空</b>（标题本身就是第 0 级；选中第 0 级 = 展开第 1 级）
					</li>
					<li>
						<b>点面包屑里某一段</b> ⇒ 选中那一段，取消比它深的
					</li>
					<li>
						<b>点开一个方框，另一个自动收起</b>（一个按钮为单位）
					</li>
					<li>点按钮之外任何地方（含同一行空白）⇒ 收起</li>
					<li>没有 ▾、没有 ✕ —— 这两个符号都没有独立语义，删掉</li>
				</ol>
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
