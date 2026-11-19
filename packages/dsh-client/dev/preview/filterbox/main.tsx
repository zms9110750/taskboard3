/**
 * FilterBox 预览 —— 状态框**两级**（组 › 状态）。
 *
 * ## 为什么单独做这个预览
 *
 * 用户 2026-11-20：
 * > 「我让你查的那个文件的点开是我要的结果。文件位置是那个。只是不是那次提交的版本。
 * >   你看看这个文件挪哪去了。这里面当初写的就是组和状态的二级菜单」
 *
 * 那份两级演示原本在 `dev/preview/main.tsx`（产物 `dev/preview/index.html`，
 * 由 `5196765` 从 `src/preview/filter-box.html` 挪过来）。
 * 后来 `8d9e554`（CardRow 重做）重写那个文件时把它删了。
 * 原始数据可以用 `git show 5196765:packages/dsh-client/dev/preview/main.tsx` 查到。
 *
 * 这里用**产品真值**重建同一个形态：
 *   · 组名 / 归属来自 `@taskboard/protocol`（`GROUP_LABELS` / `statesInGroup`）
 *   · 不做本地词表（UI 不造词）
 *
 * ⚠ 组件本身是定稿的 `src/renderers/FilterBox.tsx`，一行没改。
 *   那套「面包屑每段单独可点」的逻辑从 `a1f1cc2` 起就在，`beee046` 还重构过。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { GROUP_LABELS, statesInGroup } from '@taskboard/protocol';
import type { StatusGroup } from '@taskboard/protocol';

import { FilterBox } from '../../../src/renderers/FilterBox.tsx';
import type { FilterNode, Picked } from '../../../src/pure/filter-box.ts';
import { injectStyles } from '../../../src/styles.ts';
import { stateLabel } from '../../../src/pure/card-view.ts';

/* ── 三个框的节点（状态是两级，另两个只作为对照） ── */

const STATUS_GROUP_ORDER: readonly StatusGroup[] = ['draft', 'active', 'shelved', 'ended'];

const STATUS_NODES: readonly FilterNode[] = STATUS_GROUP_ORDER.map((group) => ({
	value: group,
	label: GROUP_LABELS[group],
	children: statesInGroup(group).map((state) => ({ value: state, label: stateLabel(state) })),
}));

const KIND_NODES: readonly FilterNode[] = [
	{ value: 'goal', label: '目标' },
	{ value: 'design', label: '设计' },
	{ value: 'work', label: '工作' },
	{ value: 'record', label: '记录' },
];

const DOMAIN_NODES: readonly FilterNode[] = [
	{
		value: '核心',
		label: '核心',
		children: [
			{
				value: 'design',
				label: '设计',
				children: [
					{ value: 'decision', label: '决策' },
					{ value: 'question', label: '提问' },
				],
			},
		],
	},
];

/* ── 页面 ── */

interface BoxState {
	readonly open: boolean;
	readonly picked: Picked;
}

function App(): React.ReactNode {
	const [status, setStatus] = useState<BoxState>({ open: true, picked: [] });
	const [kind, setKind] = useState<BoxState>({ open: false, picked: [] });
	const [domain, setDomain] = useState<BoxState>({ open: false, picked: [] });

	return (
		<div className="page">
			<header className="page__head">
				<h1>FilterBox · 状态框两级</h1>
				<p>
					一级 = 4 个组（草稿 / 进行 / 搁置 / 完成），点组 → 展开该组的二级状态。
					组名与归属来自 <code>@taskboard/protocol</code>，不是本地词表。
				</p>
				<p className="page__hint">
					点面包屑任意一段 = 选中它并展开（不是整体展开）；点「状态」= 清空。
				</p>
			</header>

			<section className="demo">
				<h2>
					① 状态（两级）<span className="demo__now">当前：{status.picked.join(' › ') || '（未选）'}</span>
				</h2>
				<FilterBox
					boxId="status"
					title="状态"
					nodes={STATUS_NODES}
					picked={status.picked}
					open={status.open}
					onChange={(next) => {
						setStatus((prev) => ({ ...prev, picked: next }));
					}}
					onOpenChange={(next) => {
						setStatus((prev) => ({ ...prev, open: next }));
					}}
				/>
			</section>

			<section className="demo">
				<h2>
					② 类别（一级，对照）<span className="demo__now">当前：{kind.picked.join(' › ') || '（未选）'}</span>
				</h2>
				<FilterBox
					boxId="kind"
					title="类别"
					nodes={KIND_NODES}
					picked={kind.picked}
					open={kind.open}
					onChange={(next) => {
						setKind((prev) => ({ ...prev, picked: next }));
					}}
					onOpenChange={(next) => {
						setKind((prev) => ({ ...prev, open: next }));
					}}
				/>
			</section>

			<section className="demo">
				<h2>
					③ 领域（三级，对照）<span className="demo__now">当前：{domain.picked.join(' › ') || '（未选）'}</span>
				</h2>
				<FilterBox
					boxId="domain"
					title="领域"
					nodes={DOMAIN_NODES}
					picked={domain.picked}
					open={domain.open}
					onChange={(next) => {
						setDomain((prev) => ({ ...prev, picked: next }));
					}}
					onOpenChange={(next) => {
						setDomain((prev) => ({ ...prev, open: next }));
					}}
				/>
			</section>

			<footer className="page__foot">
				<p>
					四个组：{STATUS_GROUP_ORDER.map((one) => `${GROUP_LABELS[one]}(${String(statesInGroup(one).length)})`).join(' / ')}
				</p>
			</footer>
		</div>
	);
}

injectStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
