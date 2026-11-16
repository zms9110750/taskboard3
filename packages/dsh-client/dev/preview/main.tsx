/**
 * 组件预览入口 —— **只用于给用户看组件，不进产物、不进插件**。
 *
 * 由 `dev/preview/build.mjs` 用 rolldown 打成一个**自包含 HTML**，双击即可打开。
 *
 * ## 这一版加的是
 *
 * · `StatusDot` —— 7px 状态圆点（六档颜色）
 * · `StatusCell` —— 圆点 + 中文名，固定 96px
 * · `CardRow` —— 列表一行
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { CardRow } from '../components/CardRow.tsx';
import { StatusCell } from '../components/StatusCell.tsx';
import { StatusDot } from '../components/StatusDot.tsx';
import type { Card } from '../../src/types.ts';

/* ── 夹具：分类中文名（真实产品从模板清单查，这里写死） ── */

const KIND_LABEL: Readonly<Record<string, string>> = {
	goal: '目标',
	design: '设计',
	work: '工作',
	record: '记录',
};

/* ── 夹具：九个状态各一张卡 ── */

const mkCard = (o: Partial<Card> & { id: string; title: string }): Card => ({
	status: 'TASK_STATE_SUBMITTED',
	template: { ref: 'user-need', kind: 'goal', domain: '核心' },
	relations: { parent: null, links: [] },
	sections: {},
	note: '',
	history: [
		{ at: new Date(2026, 10, 17, 9, 12).getTime(), action: 'create' },
		{ at: new Date(2026, 10, 17, 14, 31).getTime(), action: 'transition' },
	],
	deleted: false,
	claimedBy: null,
	claimedAt: null,
	...o,
});

const CARDS: readonly Card[] = [
	mkCard({
		id: 'GU-01', title: '把任务板的语义定清楚',
		status: 'TASK_STATE_UNSPECIFIED',
		template: { ref: 'user-need', kind: 'goal', domain: '核心' },
	}),
	mkCard({
		id: 'DM-01', title: '卡片的编号前缀怎么拼',
		status: 'TASK_STATE_SUBMITTED',
		template: { ref: 'architecture', kind: 'design', domain: '代码' },
	}),
	mkCard({
		id: 'WW-01', title: '查一下分组为空的渲染路径',
		status: 'TASK_STATE_WORKING',
		template: { ref: 'write-code', kind: 'work', domain: '代码' },
	}),
	mkCard({
		id: 'WF-01', title: '【验证】编号应带模板前缀',
		status: 'TASK_STATE_INPUT_REQUIRED',
		template: { ref: 'write-code', kind: 'work', domain: '代码' },
	}),
	mkCard({
		id: 'WS-01', title: '现有任务板实现的调研',
		status: 'TASK_STATE_AUTH_REQUIRED',
		template: { ref: 'write-doc', kind: 'work', domain: '写作' },
	}),
	mkCard({
		id: 'RB-01', title: '查一下分组为空的渲染路径-记阻碍',
		status: 'TASK_STATE_COMPLETED',
		template: { ref: 'record', kind: 'record', domain: '核心' },
	}),
	mkCard({
		id: 'GT-01', title: '补一条空分组的用例',
		status: 'TASK_STATE_FAILED',
		template: { ref: 'user-need', kind: 'goal', domain: '代码' },
	}),
	mkCard({
		id: 'GT-02', title: 'ask 交互隔离验收',
		status: 'TASK_STATE_CANCELED',
		template: { ref: 'user-need', kind: 'goal', domain: '代码' },
	}),
	mkCard({
		id: 'GT-03', title: '未选择头部验收',
		status: 'TASK_STATE_REJECTED',
		template: { ref: 'user-need', kind: 'goal', domain: '代码' },
	}),
];

/** 九状态全览（圆点 + 名字）。 */
const ALL_STATUS = [
	'TASK_STATE_UNSPECIFIED',
	'TASK_STATE_SUBMITTED',
	'TASK_STATE_WORKING',
	'TASK_STATE_INPUT_REQUIRED',
	'TASK_STATE_AUTH_REQUIRED',
	'TASK_STATE_COMPLETED',
	'TASK_STATE_FAILED',
	'TASK_STATE_CANCELED',
	'TASK_STATE_REJECTED',
] as const;

/** 预览页。 */
function App(): React.ReactNode {
	const [selected, setSelected] = useState<string | null>('WW-01');

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>CardRow / StatusCell / StatusDot</h1>
				<p>列表条目 · 列结构固定（编号 / 分类 / 领域 / 标题 / 最后动过 / 状态）</p>
			</header>

			<section className="pv-block">
				<h2>① 列表（点一行选中）</h2>
				<div>
					{CARDS.map((card) => (
						<CardRow
							key={card.id}
							card={card}
							selected={selected === card.id}
							unread={card.id === 'WW-01' || card.id === 'GU-01'}
							kindLabel={KIND_LABEL[card.template.kind] ?? card.template.kind}
							onSelect={setSelected}
						/>
					))}
				</div>
				<div className="pv-state">
					<div>
						<span className="pv-k">selected</span>
						<code>{JSON.stringify(selected)}</code>
					</div>
				</div>
			</section>

			<section className="pv-block">
				<h2>② 九个状态的圆点 + 名字（六档颜色）</h2>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
					{ALL_STATUS.map((status) => (
						<div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<StatusDot status={status} />
							<code style={{ fontSize: 10, color: '#9aa1ad' }}>
								{status.replace('TASK_STATE_', '')}
							</code>
							<StatusCell status={status} />
						</div>
					))}
				</div>
				<p className="pv-note" style={{ marginTop: 12, marginBottom: 0 }}>
					<b>六档</b>：草稿灰 / 进行蓝 / 搁置橙 / 成功绿 / 失败拒绝红 / 取消灰。
					<br />
					注意「成功」「失败」「取消」「拒绝」四个同属「完成」组，
					但颜色分三种 —— 组只到「完成」这一层，细分只能按协议名。
				</p>
			</section>

			<section className="pv-block">
				<h2>③ 列结构（固定宽度，长标题不挤走状态列）</h2>
				<table className="pv-table">
					<thead>
						<tr>
							<th>列</th>
							<th>宽度</th>
							<th>说明</th>
						</tr>
					</thead>
					<tbody>
						<tr><td>编号</td><td>自适应</td><td>等宽 + 分类色 + 粗体</td></tr>
						<tr><td>分类徽章</td><td>自适应</td><td>色块（四个分类四色）</td></tr>
						<tr><td>领域徽章</td><td>自适应</td><td>中性灰</td></tr>
						<tr><td>标题</td><td><code>flex:1</code></td><td>唯一弹性列，长了省略</td></tr>
						<tr><td>最后动过</td><td><code>90px</code></td><td>右对齐，列名常显</td></tr>
						<tr><td>状态</td><td><code>96px</code></td><td>点 + 中文名</td></tr>
					</tbody>
				</table>
			</section>

			<section className="pv-block">
				<h2>④ 三种视觉状态</h2>
				<div className="filter-row" style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
					<div style={{ fontSize: 11, color: '#9aa1ad' }}>正常</div>
					<div style={{ width: '100%' }}>
						<CardRow
							card={CARDS[1] as Card}
							selected={false}
							unread={false}
							kindLabel="设计"
							onSelect={() => undefined}
						/>
					</div>
					<div style={{ fontSize: 11, color: '#9aa1ad', marginTop: 8 }}>
						选中（蓝框）
					</div>
					<div style={{ width: '100%' }}>
						<CardRow
							card={CARDS[2] as Card}
							selected
							unread={false}
							kindLabel="工作"
							onSelect={() => undefined}
						/>
					</div>
					<div style={{ fontSize: 11, color: '#9aa1ad', marginTop: 8 }}>
						AI 改过未读（编号加粗到 800）
					</div>
					<div style={{ width: '100%' }}>
						<CardRow
							card={CARDS[3] as Card}
							selected={false}
							unread
							kindLabel="工作"
							onSelect={() => undefined}
						/>
					</div>
					<div style={{ fontSize: 11, color: '#9aa1ad', marginTop: 8 }}>
						草稿（无边框 —— 用透明边框占位，不会跳 2px）
					</div>
					<div style={{ width: '100%' }}>
						<CardRow
							card={CARDS[0] as Card}
							selected={false}
							unread={false}
							kindLabel="目标"
							onSelect={() => undefined}
						/>
					</div>
				</div>
			</section>

			<section className="pv-block">
				<h2>⑤ 规则</h2>
				<ol className="pv-list">
					<li>状态列<b>固定 96px</b>：扫视时不用横跨整行</li>
					<li>「最后动过」<b>固定 90px</b>，右对齐；列名常显（只有时间看不懂）</li>
					<li>草稿<b>无边框</b>，但用透明边框占 2px —— 切换时不跳</li>
					<li>AI 改过未读：<b>编号加粗到 800</b>（旧版原样，不是装饰、不是变色）</li>
					<li>组件<b>不判「能不能选中」</b>，只上报 onSelect</li>
					<li>分类中文名<b>不从组件拿</b>，由调用方传（真实产品从模板清单查）</li>
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

