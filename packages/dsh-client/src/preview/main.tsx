/**
 * 组件预览入口 —— **只用于给用户看组件，不进产物、不进插件**。
 *
 * 由 `scripts/build-preview.mjs` 用 rolldown 打成一个**自包含 HTML**
 * （React 和自己写的组件全打进去），双击即可打开。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { FilterBox } from '../components/FilterBox.tsx';
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

/* ── 夹具：类别（一层平铺，无组）── */

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
	{
		value: 'g2',
		label: '组二',
		children: [{ value: 'c', label: '丙' }],
	},
];

/** 预览页。 */
function App(): React.ReactNode {
	const [status, setStatus] = useState<FilterState>(EMPTY_FILTER);
	const [kind, setKind] = useState<FilterState>(EMPTY_FILTER);
	const [domain, setDomain] = useState<FilterState>(EMPTY_FILTER);
	const [deep, setDeep] = useState<FilterState>(EMPTY_FILTER);

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>FilterBox</h1>
				<p>筛选方框 · 内联展开 · 层级不限 · 宽度动画</p>
			</header>

			<section className="pv-block">
				<h2>三个筛选按钮（点开一个，另一个自动收起）</h2>
				<div className="pv-row">
					<FilterBox title="状态" nodes={STATUS} value={status} onChange={setStatus} />
					<FilterBox title="类别" nodes={KINDS} value={kind} onChange={setKind} />
					<FilterBox title="领域" nodes={DOMAINS} value={domain} onChange={setDomain} />
				</div>
				<div className="pv-state">
					<div>
						<span className="pv-k">status</span>
						<code>{JSON.stringify(status)}</code>
					</div>
					<div>
						<span className="pv-k">kind</span>
						<code>{JSON.stringify(kind)}</code>
					</div>
					<div>
						<span className="pv-k">domain</span>
						<code>{JSON.stringify(domain)}</code>
					</div>
				</div>
			</section>

			<section className="pv-block">
				<h2>规则（按这个核对）</h2>
				<ol className="pv-list">
					<li>
						点「状态」→ 方框变宽，出现 <code>草稿 | 进行 | 搁置 | 完成</code>
						（<b>这些是组，不是筛选值</b>）
					</li>
					<li>
						点组「完成」→ <b>清空选择</b>，并展开它的子：
						<code>│ 成功 / 失败 / 取消 / 拒绝</code>
					</li>
					<li>
						再点「失败」→ 选中失败，收起态显示 <code>状态：完成/失败</code>
					</li>
					<li>
						<b>再点「失败」不会取消</b> —— 它仍然是选中态（只保证子级展开着）
					</li>
					<li>
						点最左边的组名（如「进行」）→ <b>清空所有选择</b>，展开「进行」的子
					</li>
					<li>已选中时收起态拆两个区：左边「清空并展开」，右边 ▾「只展开」</li>
					<li>点<b>这个按钮之外</b>任何地方（含同一行的空白、别的按钮）→ 收起</li>
					<li>类别 / 领域没有组 → 只有一行</li>
				</ol>
			</section>

			<section className="pv-block">
				<h2>三级（层级不写死）</h2>
				<p className="pv-note">
					点「组一」→ 出「甲 / 乙」；点「甲」→ 它既是选中、又展开「甲一 / 甲二」。
					用户的规则：「点第3级时，就展开3的子，并选中3」。
				</p>
				<div className="pv-row">
					<FilterBox title="深层" nodes={DEEP} value={deep} onChange={setDeep} />
				</div>
				<div className="pv-state">
					<div>
						<span className="pv-k">deep</span>
						<code>{JSON.stringify(deep)}</code>
					</div>
				</div>
			</section>

			<section className="pv-block">
				<h2>已选态（看收起态显示对不对，不用点开）</h2>
				<div className="pv-row">
					<FilterBox
						title="状态"
						nodes={STATUS}
						value={{ group: 'ended', picked: ['failed'] }}
						onChange={() => undefined}
					/>
					<FilterBox
						title="类别"
						nodes={KINDS}
						value={{ group: '', picked: ['work'] }}
						onChange={() => undefined}
					/>
					<FilterBox
						title="深层"
						nodes={DEEP}
						value={{ group: 'g1', picked: ['a', 'a2'] }}
						onChange={() => undefined}
					/>
					<FilterBox
						title="状态"
						nodes={STATUS}
						value={{ group: 'ended', picked: [] }}
						onChange={() => undefined}
					/>
				</div>
				<p className="pv-note">
					期望：<code>状态：完成/失败</code> · <code>类别：工作</code> ·
					<code>深层：组一/甲/甲二</code> · <code>状态</code>（只进组没选值 = 只画标题）
				</p>
			</section>

			<section className="pv-block">
				<h2>平铺行（就是真实放进工具栏的样子）</h2>
				<div className="filter-row">
					<FilterBox title="状态" nodes={STATUS} value={status} onChange={setStatus} />
					<FilterBox title="类别" nodes={KINDS} value={kind} onChange={setKind} />
					<FilterBox title="领域" nodes={DOMAINS} value={domain} onChange={setDomain} />
					<span style={{ flex: 1 }} />
					<span style={{ fontSize: 11, color: '#9aa1ad' }}>← 右边这里以后放搜索框</span>
				</div>
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
