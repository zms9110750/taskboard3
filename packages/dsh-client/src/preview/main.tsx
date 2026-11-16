/**
 * 组件预览入口 —— **只用于给用户看组件，不进产物、不进插件**。
 *
 * 由 `scripts/build-preview.mjs` 用 rolldown 打成一个**自包含 HTML**，双击即可打开。
 *
 * ⚠ 预览页**分别演示**两层：
 *   · `FilterBox` 单个组件（受控：`open` 从外面给）
 *   · `FilterRow` 一排（互斥在这里保证）
 *
 * 这样用户能看出「一个按钮为单位」是什么意思 —— 单个盒子自己不知道别的盒子存不存在。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { FilterBox } from '../components/FilterBox.tsx';
import { FilterRow } from '../components/FilterRow.tsx';
import type { FilterSpec } from '../components/FilterRow.tsx';
import { EMPTY_FILTER } from '../pure/filter-box.ts';
import type { FilterNode, FilterState } from '../pure/filter-box.ts';

/* ── 夹具：状态（两级，有组）── */

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

/* ── 夹具：类别（一层平铺）── */

const KINDS: readonly FilterNode[] = [
	{ value: 'goal', label: '目标' },
	{ value: 'design', label: '设计' },
	{ value: 'work', label: '工作' },
	{ value: 'record', label: '记录' },
];

/* ── 夹具：领域（一层平铺）── */

const DOMAINS: readonly FilterNode[] = [
	{ value: '核心', label: '核心' },
	{ value: '代码', label: '代码' },
	{ value: '写作', label: '写作' },
	{ value: '绘画', label: '绘画' },
];

/* ── 夹具：三级（验证「层级不是写死的」）── */

const DEEP: readonly FilterNode[] = [
	{
		value: 'g1',
		label: '组一',
		children: [
			{
				value: 'a',
				label: '甲',
				children: [
					{ value: 'a1', label: '甲一' },
					{ value: 'a2', label: '甲二' },
				],
			},
			{ value: 'b', label: '乙' },
		],
	},
	{ value: 'g2', label: '组二', children: [{ value: 'c', label: '丙' }] },
];

/** 预览页。 */
function App(): React.ReactNode {
	/* ── 一、单组件演示：开合状态自己管（因为只有一个盒子）── */
	const [solo, setSolo] = useState<FilterState>(EMPTY_FILTER);
	const [soloOpen, setSoloOpen] = useState(false);

	/* ── 二、一排：互斥由 FilterRow 的 openId 保证 ── */
	const [values, setValues] = useState<Record<string, FilterState>>({
		status: EMPTY_FILTER,
		kind: EMPTY_FILTER,
		domain: EMPTY_FILTER,
	});
	const [deep, setDeep] = useState<FilterState>(EMPTY_FILTER);

	const specs: readonly FilterSpec[] = [
		{ id: 'status', title: '状态', nodes: STATUS, value: values['status'] ?? EMPTY_FILTER },
		{ id: 'kind', title: '类别', nodes: KINDS, value: values['kind'] ?? EMPTY_FILTER },
		{ id: 'domain', title: '领域', nodes: DOMAINS, value: values['domain'] ?? EMPTY_FILTER },
	];

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>FilterBox / FilterRow</h1>
				<p>筛选方框 · 内联展开 · 层级不限 · 宽度动画 · 一个按钮为一个单位</p>
			</header>

			<section className="pv-block">
				<h2>① 真实用法：一排三个（互斥在这一层保证）</h2>
				<FilterRow
					filters={specs}
					onChange={(id, next) => {
						setValues((prev) => ({ ...prev, [id]: next }));
					}}
					trailing={
						<span style={{ fontSize: 11, color: '#9aa1ad' }}>
							← 右边这里以后放搜索框
						</span>
					}
				/>
				<div className="pv-state">
					{specs.map((spec) => (
						<div key={spec.id}>
							<span className="pv-k">{spec.id}</span>
							<code>{JSON.stringify(spec.value)}</code>
						</div>
					))}
				</div>
			</section>

			<section className="pv-block">
				<h2>② 单个组件（开合由外部灌入 —— 它不知道别的盒子存不存在）</h2>
				<div className="filter-row">
					<FilterBox
						boxId="solo"
						title="状态"
						nodes={STATUS}
						value={solo}
						open={soloOpen}
						onChange={setSolo}
						onOpenChange={setSoloOpen}
					/>
					<span style={{ fontSize: 11, color: '#9aa1ad', marginLeft: 6 }}>
						open = {String(soloOpen)}
					</span>
				</div>
			</section>

			<section className="pv-block">
				<h2>③ 三级（层级不写死）</h2>
				<p className="pv-note">
					点「组一」→ 出「甲 / 乙」；点「甲」→ 它既是选中、又展开「甲一 / 甲二」。
				</p>
				<FilterRow
					filters={[
						{ id: 'deep', title: '深层', nodes: DEEP, value: deep },
					]}
					onChange={(_id, next) => setDeep(next)}
				/>
				<div className="pv-state">
					<div>
						<span className="pv-k">deep</span>
						<code>{JSON.stringify(deep)}</code>
					</div>
				</div>
			</section>

			<section className="pv-block">
				<h2>④ 核对清单</h2>
				<ol className="pv-list">
					<li>
						点「状态」→ 变宽出现 <code>草稿 | 进行 | 搁置 | 完成</code>
						（这些是组，第 0 级）
					</li>
					<li>
						点组「完成」→ <b>清空选择</b>，展开它的子 <code>│ 成功 / 失败 / 取消 / 拒绝</code>
					</li>
					<li>
						<b>不选叶子直接点外面</b> → 收起态必须显示 <code>状态：完成</code>
						（组是第 0 级，也是选中的东西）
					</li>
					<li>
						再点「失败」→ 收起态 <code>状态：完成/失败</code>
					</li>
					<li>
						<b>再点「失败」不会取消</b> —— 它仍是选中（用户：点选中的就是展开到他）
					</li>
					<li>
						点最左边的组名（如「进行」）→ <b>清空所有选择</b>，展开「进行」的子
					</li>
					<li>
						<b>点开「类别」时「状态」必须自动收起</b>（一个按钮为单位）
					</li>
					<li>
						点<b>这个按钮之外</b>任何地方（含同一行的空白）→ 收起
					</li>
					<li>类别 / 领域没有组 → 只有一行</li>
				</ol>
			</section>

			<section className="pv-block">
				<h2>⑤ 已选态（看收起态显示对不对，不用点开）</h2>
				<div className="filter-row">
					<FilterBox
						boxId="a"
						title="状态"
						nodes={STATUS}
						value={{ group: 'ended', picked: [] }}
						open={false}
						onChange={() => undefined}
						onOpenChange={() => undefined}
					/>
					<FilterBox
						boxId="b"
						title="状态"
						nodes={STATUS}
						value={{ group: 'ended', picked: ['failed'] }}
						open={false}
						onChange={() => undefined}
						onOpenChange={() => undefined}
					/>
					<FilterBox
						boxId="c"
						title="类别"
						nodes={KINDS}
						value={{ group: '', picked: ['work'] }}
						open={false}
						onChange={() => undefined}
						onOpenChange={() => undefined}
					/>
					<FilterBox
						boxId="d"
						title="深层"
						nodes={DEEP}
						value={{ group: 'g1', picked: ['a', 'a2'] }}
						open={false}
						onChange={() => undefined}
						onOpenChange={() => undefined}
					/>
				</div>
				<p className="pv-note">
					期望：<code>状态：完成</code> · <code>状态：完成/失败</code> ·
					<code>类别：工作</code> · <code>深层：组一/甲/甲二</code>
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
