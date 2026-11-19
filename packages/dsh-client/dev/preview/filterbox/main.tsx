/**
 * FilterRow 预览 —— 状态框**两级**（组 › 状态）+ 点外面收起。
 *
 * ## 为什么用 `FilterRow` 而不是三个 `FilterBox`
 *
 * 用户 2026-11-20：
 * > 「你这个不对。没有点外面收起。是不是用的那个组件啊」
 *
 * **「点外面收起」和「同一时刻只有一个框开着」都在 `FilterRow` 里**
 * （`FilterRow.tsx:72-83` 的 `onDocClick` + `openId` 互斥），不在 `FilterBox`。
 *
 * `FilterBox` 是**单个方框**（受控：自己不知道别的框存在）；
 * `FilterRow` 才是产品里用的那个「一行筛选器」。挂三个裸 `FilterBox`
 * 等于把定稿组件的收敛层绕过去了 —— 那是我上一版的错。
 *
 * 「外面」的定义见 `FilterRow.tsx:20-26`（用户原话）：
 *   「『外面』说的是按钮外面，不是放按钮的这一行。」点行内空白也收起。
 *
 * ## 数据
 *
 * 状态框**两级**：组名 / 归属来自 `@taskboard/protocol`
 * （`GROUP_LABELS` / `statesInGroup`），不做本地词表。
 * 对照：类别一级、领域三级。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { GROUP_LABELS, statesInGroup } from '@taskboard/protocol';
import type { StatusGroup } from '@taskboard/protocol';

import { FilterRow } from '../../../src/renderers/FilterRow.tsx';
import type { FilterSpec } from '../../../src/renderers/FilterRow.tsx';
import type { FilterNode, Picked } from '../../../src/pure/filter-box.ts';
import { stateLabel } from '../../../src/pure/card-view.ts';
import { injectStyles } from '../../../src/styles.ts';

/* ── 三个框的节点（状态两级，另两个作对照） ── */

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

function App(): React.ReactNode {
	const [picked, setPicked] = useState<Readonly<Record<string, Picked>>>({});

	const filters: readonly FilterSpec[] = [
		{ id: 'status', title: '状态', nodes: STATUS_NODES, picked: picked['status'] ?? [] },
		{ id: 'kind', title: '类别', nodes: KIND_NODES, picked: picked['kind'] ?? [] },
		{ id: 'domain', title: '领域', nodes: DOMAIN_NODES, picked: picked['domain'] ?? [] },
	];

	return (
		<div className="page">
			<header className="page__head">
				<h1>FilterRow · 状态框两级</h1>
				<p>
					一级 = 4 个组（草稿 / 进行 / 搁置 / 完成），点组 → 展开该组二级状态。
					组名与归属来自 <code>@taskboard/protocol</code>。
				</p>
				<p className="page__hint">
					组件是定稿的 <code>FilterRow</code>：同一时刻只有一个框开着，<b>点外面收起</b>
					（外面 = 按钮外面，点这一行的空白也算）。
				</p>
			</header>

			<section className="demo">
				<FilterRow
					filters={filters}
					onChange={(id, next) => {
						setPicked((prev) => ({ ...prev, [id]: next }));
					}}
				/>
			</section>

			<section className="state">
				<h2>当前选中</h2>
				<dl>
					<dt>状态</dt>
					<dd>{picked['status']?.join(' › ') || '（未选）'}</dd>
					<dt>类别</dt>
					<dd>{picked['kind']?.join(' › ') || '（未选）'}</dd>
					<dt>领域</dt>
					<dd>{picked['domain']?.join(' › ') || '（未选）'}</dd>
				</dl>
			</section>

			<footer className="page__foot">
				<p>
					四个组：
					{STATUS_GROUP_ORDER.map(
						(one) => `${GROUP_LABELS[one]}(${String(statesInGroup(one).length)})`,
					).join(' / ')}
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
