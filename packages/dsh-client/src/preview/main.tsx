/**
 * 组件预览入口 —— **只用于给用户看组件，不进产物、不进插件**。
 *
 * 它把 `src/components/**` 里的组件用假数据渲染出来，
 * 由 `scripts/build-preview.mjs` 用 rolldown 打成一个**自包含 HTML**
 * （React 和自己写的组件全打进去），双击即可打开。
 *
 * ⚠ 这个目录**不参与 `tsc -b`**（见 tsconfig.json 的 `exclude`）——
 *   它有 `react-dom/client`，而宿主环境里那个东西不走这条路径。
 *   打预览时用 `rolldown` 自己的 TS 支持，和构建产品的链路完全分开。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { FilterBox } from '../components/FilterBox.tsx';
import type { FilterOption, Picked } from '../pure/filter-box.ts';

/* ── 假数据：状态（有组）/ 类别（无组）/ 领域（无组） ── */

const STATUS: readonly FilterOption[] = [
	{ value: 'unspecified', label: '未指定', group: '草稿' },
	{ value: 'submitted', label: '提交', group: '进行' },
	{ value: 'working', label: '处理中', group: '进行' },
	{ value: 'input-required', label: '需要信息', group: '搁置' },
	{ value: 'auth-required', label: '需要授权', group: '搁置' },
	{ value: 'completed', label: '成功', group: '完成' },
	{ value: 'failed', label: '失败', group: '完成' },
	{ value: 'canceled', label: '取消', group: '完成' },
	{ value: 'rejected', label: '拒绝', group: '完成' },
];

const KINDS: readonly FilterOption[] = [
	{ value: 'goal', label: '目标' },
	{ value: 'design', label: '设计' },
	{ value: 'work', label: '工作' },
	{ value: 'record', label: '记录' },
];

const DOMAINS: readonly FilterOption[] = [
	{ value: '核心', label: '核心' },
	{ value: '代码', label: '代码' },
	{ value: '写作', label: '写作' },
	{ value: '绘画', label: '绘画' },
];

/** 当前这一屏要演示的组件。 */
function App(): React.ReactNode {
	/* 三组各自独立的已选值 */
	const [status, setStatus] = useState<Picked>([]);
	const [kind, setKind] = useState<Picked>([]);
	const [domain, setDomain] = useState<Picked>([]);

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>FilterBox</h1>
				<p>
					筛选方框 · 内联展开 · 两级（组/子项）· 宽度动画
				</p>
			</header>

			<section className="pv-block">
				<h2>状态方框（有分组，会出二级）</h2>
				<div className="pv-row">
					<FilterBox title="状态" options={STATUS} picked={status} onChange={setStatus} />
					<FilterBox title="类别" options={KINDS} picked={kind} onChange={setKind} />
					<FilterBox title="领域" options={DOMAINS} picked={domain} onChange={setDomain} />
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
				<h2>行为清单（可以按这个核对）</h2>
				<ol className="pv-list">
					<li>点方框 → 同一个方框变宽，露出 <code>状态：草稿 | 进行 | 搁置 | 完成</code></li>
					<li>点组名（如「完成」）→ 一级该组高亮，右侧出现贯通上下的竖线 + <code>成功 / 失败 / 取消 / 拒绝</code></li>
					<li>整组选中后，收起态显示 <code>状态：完成</code>（组名）</li>
					<li>在一级点组后再点组内一项 → 收窄成 <code>状态：完成/失败</code></li>
					<li>再点同一个已选项 → 取消筛选</li>
					<li>已选中时收起态拆两个区：左边「取消并展开」、右边 ▾「只展开」</li>
					<li>一次只能展开一个方框</li>
					<li>点方框**外面**才收起（不是鼠标移开）</li>
					<li>类别 / 领域没有分组 → <b>不出现二级</b></li>
				</ol>
			</section>

			<section className="pv-block">
				<h2>边界用例</h2>
				<p className="pv-note">
					下面是三种已选态，直接看收起态显示对不对（不用点开）：
				</p>
				<div className="pv-row">
					<FilterBox
						title="状态"
						options={STATUS}
						picked={['completed', 'failed', 'canceled', 'rejected']}
						onChange={() => undefined}
					/>
					<FilterBox
						title="状态"
						options={STATUS}
						picked={['failed']}
						onChange={() => undefined}
					/>
					<FilterBox
						title="状态"
						options={STATUS}
						picked={['failed', 'completed']}
						onChange={() => undefined}
					/>
					<FilterBox title="类别" options={KINDS} picked={['work']} onChange={() => undefined} />
				</div>
				<p className="pv-note">
					期望：<code>状态：完成</code> · <code>状态：完成/失败</code> ·
					<code>状态：失败/成功</code> · <code>类别：工作</code>
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
