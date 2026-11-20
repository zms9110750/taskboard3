/**
 * RelationPanel 的**内部部件**预览 —— 用户 2026-11-20：
 *
 * > 「relation-panel 这个取 A。里面的东西我还要过目。」
 *
 * 所以这一页不是「再看一遍面板」，是把面板里的 7 个部件**拆开**各摆一块：
 *
 * | 部件 | 是什么 |
 * |---|---|
 * | `ParentChip` | 父任务 chip（`↑ 父任务 编号 标题`）|
 * | `DeriveButton` | 派生子任务按钮 |
 * | `RelationChip` | 一张关系小卡（`↗ 编号 标题`）|
 * | `GroupHead` | 关系组头（类型名 + 计数条）|
 * | `TableBody` | 变体 A 的三列表正文 |
 * | `FlatBody` | 变体 B/C 的平铺正文 |
 * | `EmptyBody` | 无关系时的空态 |
 *
 * 数据是预览自己的精简夹具（和 `relation-panel` 那个页面数值不同，只求覆盖形态）。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { relationsOf, statusGroupOf, type RelationsView } from '../../../src/pure/relations-block.ts';
import {
	DeriveButton,
	EmptyBody,
	FlatBody,
	GroupHead,
	ParentChip,
	RelationChip,
	TableBody,
} from '../../../src/renderers/RelationPanel.tsx';
import { injectStyles } from '../../../src/styles.ts';
import type { Card } from '../../../src/types.ts';

/* ══════════════════════════════════════════════════════════
   夹具
   ══════════════════════════════════════════════════════════ */

const S = {
	draft: 'TASK_STATE_UNSPECIFIED',
	submitted: 'TASK_STATE_SUBMITTED',
	working: 'TASK_STATE_WORKING',
	inputRequired: 'TASK_STATE_INPUT_REQUIRED',
	authRequired: 'TASK_STATE_AUTH_REQUIRED',
	completed: 'TASK_STATE_COMPLETED',
	failed: 'TASK_STATE_FAILED',
	canceled: 'TASK_STATE_CANCELED',
} as const;

/**
 * 一张假卡。
 *
 * @param id 编号
 * @param title 标题
 * @param status A2A 状态
 * @param kind 分类（决定编号颜色）
 * @param over 覆盖字段
 */
function card(
	id: string,
	title: string,
	status: string,
	kind: string,
	over: Partial<Card> = {},
): Card {
	return {
		id,
		title,
		status,
		template: { ref: `${kind}.demo`, kind, domain: '演示' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		createdAt: 1_762_000_000_000,
		adoptedAt: null,
		history: [],
		deleted: false,
		holders: [],
		unread: { ai: false, user: false },
		...over,
	};
}

const ALL: readonly Card[] = [
	card('PA-01', '父任务：详情面板重做', S.working, 'design'),
	card('ME-01', '中心卡：关系折叠面板接入详情', S.working, 'design', {
		relations: {
			parent: 'PA-01',
			links: [
				{ label: 'dependsOn', to: 'WI-01' },
				{ label: 'related', to: 'DE-01' },
				{ label: 'references', to: 'RE-01' },
			],
		},
	}),
	card('WI-01', '依赖：状态落进行列', S.working, 'work'),
	card('DE-01', '相关：状态落搁置列', S.inputRequired, 'design'),
	card('RE-01', '参考：状态落完成列', S.completed, 'record'),
	card('CH-01', '子任务：进行组', S.submitted, 'work', { relations: { parent: 'ME-01', links: [] } }),
	card('CH-02', '子任务：搁置组', S.authRequired, 'work', { relations: { parent: 'ME-01', links: [] } }),
	card('CH-03', '子任务：完成组', S.failed, 'work', { relations: { parent: 'ME-01', links: [] } }),
];

/**
 * 按 id 取卡（写死，取不到直接抛）。
 *
 * @param id 编号
 */
function pick(id: string): Card {
	const found = ALL.find((one) => one.id === id);
	if (found === undefined) throw new Error(`夹具缺卡: ${id}`);
	return found;
}

/**
 * 算一张卡的关系视图。
 *
 * @param id 编号
 */
function viewOf(id: string): RelationsView {
	return relationsOf(pick(id), ALL, statusGroupOf);
}

const FULL = viewOf('ME-01');

/* ══════════════════════════════════════════════════════════
   画一块的壳
   ══════════════════════════════════════════════════════════ */

/** 一块：标题 + 说明 + 内容。 */
function Part(props: {
	readonly name: string;
	readonly note: string;
	readonly children: React.ReactNode;
}): React.ReactNode {
	return (
		<section className="pp-part">
			<header className="pp-part__head">
				<span className="pp-part__name">{props.name}</span>
				<span className="pp-part__note">{props.note}</span>
			</header>
			<div className="pp-part__body">{props.children}</div>
		</section>
	);
}

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

function App(): React.ReactNode {
	const [log, setLog] = useState<string>('（还没点过）');
	const jump = (cardId: string): void => {
		setLog(`onJump: ${cardId}`);
	};

	return (
		<div className="pp">
			<h1 className="pp-title">RelationPanel 内部部件</h1>
			<div className="pp-sub">每个部件单独摆一块。点按钮/小卡会写回执到页面底部。</div>

			<Part name="ParentChip" note="父任务 chip：↑ 父任务 编号 标题">
				<ParentChip card={pick('PA-01')} onJump={jump} />
				<ParentChip
					card={card('PA-02', '父任务标题很长很长很长很长很长很长很长很长很长', S.submitted, 'work')}
					onJump={jump}
				/>
				<ParentChip card={card('PA-03', '父任务：失败态', S.failed, 'record')} onJump={jump} />
			</Part>

			<Part name="DeriveButton" note="派生子任务按钮 —— 默认 / 自定义 label / 禁用">
				<DeriveButton action={undefined} onDerive={() => setLog('onDerive: 默认')} />
				<DeriveButton
					action={{ label: '+ 派生：拆成三张', disabled: false, title: '自定义 label' }}
					onDerive={() => setLog('onDerive: 自定义')}
				/>
				<DeriveButton
					action={{ label: '+ 派生子任务', disabled: true, title: '当前不可用（禁用态）' }}
					onDerive={() => setLog('onDerive: 不该被调到')}
				/>
			</Part>

			<Part name="RelationChip" note="关系小卡 —— withStatus=false（三列表）/ true（平铺，带状态点）">
				<RelationChip card={pick('WI-01')} onJump={jump} withStatus={false} />
				<RelationChip card={pick('DE-01')} onJump={jump} withStatus />
				<RelationChip card={pick('RE-01')} onJump={jump} withStatus />
				<RelationChip
					card={card('LO-01', '一个特别长的关系卡标题，长到需要省略号才能放得下，再长一点再长一点', S.canceled, 'record')}
					onJump={jump}
					withStatus
				/>
			</Part>

			<Part name="GroupHead" note="关系组头：类型名 + 计数条">
				{FULL.groups.map((group) => (
					<GroupHead key={group.label} group={group} />
				))}
			</Part>

			<Part name="TableBody" note="变体 A 正文：三列表头 + 每组一行（组横条 + 三列）">
				<TableBody relations={FULL} onJump={jump} emptyText={undefined} />
			</Part>

			<Part name="FlatBody" note="变体 B / C 正文：不平铺列，每张卡带状态点">
				<FlatBody relations={FULL} onJump={jump} emptyText={undefined} />
			</Part>

			<Part name="EmptyBody" note="无关系时的空态 —— 无文案 / 有文案">
				<EmptyBody emptyText={undefined} />
				<EmptyBody emptyText="这张卡还没有任何关系" />
			</Part>

			<div className="pp-log" data-part-log>
				{log}
			</div>
		</div>
	);
}

initStyles();
const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}

/** 注入产品样式 + 本页骨架样式。 */
function initStyles(): void {
	injectStyles();
	const STYLE = `
.pp{padding:20px 24px 60px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#16181d;background:#fff;min-height:100%}
.pp-title{font-size:18px;margin:0 0 4px}
.pp-sub{color:#5f6673;font-size:12.5px;margin-bottom:22px}
.pp-part{border:1px solid #e7e9ee;border-radius:10px;margin-bottom:16px;overflow:hidden}
.pp-part__head{display:flex;align-items:baseline;gap:10px;padding:8px 12px;background:#f7f8fa;border-bottom:1px solid #e7e9ee}
.pp-part__name{font-weight:600;font-size:12.5px;font-family:ui-monospace,Consolas,monospace}
.pp-part__note{color:#5f6673;font-size:11.5px}
.pp-part__body{padding:12px;display:flex;flex-direction:column;gap:10px}
.pp-log{margin-top:20px;padding:10px 12px;border-radius:8px;background:#f7f8fa;color:#5f6673;font-size:12px;font-family:ui-monospace,Consolas,monospace}
`.trim();
	const style = document.createElement('style');
	style.id = 'pp-style';
	style.textContent = STYLE;
	document.head.appendChild(style);
}
