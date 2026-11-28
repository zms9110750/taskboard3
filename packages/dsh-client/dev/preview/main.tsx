/**
 * 组件预览入口 —— **只用于给用户看组件，不进产物、不进插件**。
 *
 * 由 `dev/preview/build.mjs` 用 rolldown 打成一个**自包含 HTML**，双击即可打开。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { CardRow } from '../../src/renderers/CardRow.tsx';
import { StatusButton } from '../../src/renderers/StatusButton.tsx';
import { StatusDot } from '../../src/renderers/StatusDot.tsx';
import type { Card } from '../../src/types.ts';

/* ── 夹具：分类 / 模板中文名（真实产品从模板清单查） ── */

const KIND_LABEL: Readonly<Record<string, string>> = {
	goal: '目标',
	design: '设计',
	work: '工作',
	record: '记录',
};

const TEMPLATE_LABEL: Readonly<Record<string, string>> = {
	'user-need': '用户任务',
	architecture: '技术架构',
	'write-code': '写代码',
	'write-doc': '写文档',
	record: '记录',
};

/* ── 夹具 ── */

const at = (d: number, h: number) => new Date(2026, 10, d, h, 12).getTime();

const mkCard = (o: Partial<Card> & { id: string; title: string }): Card => ({
	status: 'TASK_STATE_SUBMITTED',
	template: { ref: 'user-need', kind: 'goal', domain: '核心' },
	relations: { parent: null, links: [] },
	sections: {},
	note: '',
	createdAt: at(17, 9),
	adoptedAt: null,
	history: [
		{ at: at(17, 9), action: 'create' },
		{ at: at(17, 14), action: 'transition' },
	],
	deleted: false,
	holders: [],
	unread: { ai: false, user: false },
	...o,
});

const CARDS: readonly Card[] = [
	mkCard({
		id: 'GU-01', title: '把任务板的语义定清楚',
		status: 'TASK_STATE_UNSPECIFIED',
		template: { ref: 'user-need', kind: 'goal', domain: '核心' },
		unread: { ai: true, user: false },
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
		unread: { ai: false, user: true },
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
		unread: { ai: true, user: true },
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

function Preview(props: {
	readonly title: string;
	readonly card: Card;
	readonly selected?: boolean;
}): React.ReactNode {
	return (
		<div style={{ width: '100%' }}>
			<div style={{ fontSize: 11, color: '#9aa1ad', margin: '10px 0 4px' }}>
				{props.title}
			</div>
			<CardRow
				card={props.card}
				selected={props.selected === true}
				kindLabel={KIND_LABEL[props.card.template.kind] ?? props.card.template.kind}
				templateLabel={TEMPLATE_LABEL[props.card.template.ref] ?? props.card.template.ref}
				onSelect={() => undefined}
			/>
		</div>
	);
}

/** 预览页。 */
function App(): React.ReactNode {
	const [selected, setSelected] = useState<string | null>('WW-01');

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>CardRow / StatusButton / StatusDot</h1>
				<p>左侧正方形（编号 / 状态）+ 右侧三个 label 横排 + 标题 + 最后动过</p>
			</header>

			<section className="pv-block">
				<h2>① 列表（点一行选中）</h2>
				<div>
					{CARDS.map((card) => (
						<CardRow
							key={card.id}
							card={card}
							selected={selected === card.id}
							kindLabel={KIND_LABEL[card.template.kind] ?? card.template.kind}
							templateLabel={TEMPLATE_LABEL[card.template.ref] ?? card.template.ref}
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
				<h2>② 未读两种方向（边框加厚上色）</h2>
				<div className="filter-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
					<Preview title="AI 改过、我没读 ⇒ 左边框加厚变蓝" card={CARDS[0] as Card} />
					<Preview title="我改过、AI 没读 ⇒ 右边框加厚变橙" card={CARDS[2] as Card} />
					<Preview title="两边都改过 ⇒ 两边都亮" card={CARDS[4] as Card} />
					<Preview title="没改过 ⇒ 普通 2px 灰边框" card={CARDS[1] as Card} />
				</div>
			</section>

			<section className="pv-block">
				<h2>③ 选中 / 草稿</h2>
				<Preview title="选中（蓝框）" card={CARDS[1] as Card} selected />
				<Preview title="草稿（无边框，但占 2px 不跳）" card={CARDS[0] as Card} />
			</section>

			<section className="pv-block">
				<h2>④ 九个状态的圆点（六档颜色）</h2>
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
					{ALL_STATUS.map((status) => (
						<div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<StatusDot status={status} />
							<code style={{ fontSize: 10, color: '#9aa1ad' }}>
								{status.replace('TASK_STATE_', '')}
							</code>
							<StatusButton status={status} size="sm" onOpen={() => undefined} />
						</div>
					))}
				</div>
			</section>

			<section className="pv-block">
				<h2>⑤ 布局与规则</h2>
				<table className="pv-table">
					<thead>
						<tr><th>部分</th><th>内容</th><th>规则</th></tr>
					</thead>
					<tbody>
						<tr>
							<td>左侧正方形</td>
							<td>编号（上行）<br />状态（下行）</td>
							<td>固定 76px，上下两行</td>
						</tr>
						<tr>
							<td>右侧第一行</td>
							<td>分类 / 领域 / 模板名 + 标题 + 最后动过</td>
							<td>三个 label <b>横排不换行</b>，挤不下就省略（最长 120px）</td>
						</tr>
						<tr>
							<td>边框</td>
							<td>未读信号</td>
							<td>AI 改过 ⇒ 左 4px 蓝；我改过 ⇒ 右 4px 橙；都真 ⇒ 两边</td>
						</tr>
						<tr>
							<td>草稿</td>
							<td>透明边框</td>
							<td>保留 2px 占位，切换时不跳</td>
						</tr>
					</tbody>
				</table>
				<p className="pv-note" style={{ marginTop: 12, marginBottom: 0 }}>
					⚠ <b>未读从 `card.unread` 读</b>（卡的字段，core 唯一维护点），
					不是外部传参 —— 两个来源迟早不一致。
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
