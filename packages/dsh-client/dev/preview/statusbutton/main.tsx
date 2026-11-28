/**
 * `StatusButton` 形态预览（#62 / #63）—— 一个组件一个目录，不碰根 `main.tsx`。
 *
 * 四块：
 *
 * ① **组件矩阵**：两档尺寸 × 可点 / 只读 × 九个状态（看边框颜色是否跟着状态走）；
 * ② **CardRow**（列表行）：正方形里的只读形态；
 * ③ **DetailHead**（详情头）：`md` 可点形态（点一下只记事件；真菜单见 statusmenu 预览）；
 * ④ **TreeCard**（科技树节点）：小卡里的只读形态，收尾状态给不同的 `disabledReason`。
 *
 * ⚠ 样式走产品注入（`injectStyles()`），所以最外层必须是 `.tb3w-root` ——
 *   和 `dev/preview/treecard/` 同一个约定。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { TASK_STATES, TaskState } from '@taskboard/protocol';

import { CardRow } from '../../../src/renderers/CardRow.tsx';
import { DetailHead } from '../../../src/renderers/DetailHead.tsx';
import { StatusButton } from '../../../src/renderers/StatusButton.tsx';
import { TreeCard } from '../../../src/renderers/TreeCard.tsx';
import { detailTableOf } from '../../../src/pure/card-detail.ts';
import { injectStyles } from '../../../src/styles.ts';
import type { Card } from '../../../src/types.ts';

/* 产品样式（StatusButton / CardRow / DetailHead / 科技树通用）只注入一次。 */
injectStyles();

/* ══════════════════════════════════════════════════════════════
 * 夹具
 * ══════════════════════════════════════════════════════════════ */

const T0 = 1_762_000_000_000;

/**
 * 造一张卡。
 *
 * @param over 覆盖字段
 */
function card(over: Partial<Card> = {}): Card {
	return {
		id: 'DQ01',
		title: '卡头状态按钮',
		status: TaskState.AUTH_REQUIRED,
		template: { ref: 'decision', kind: 'design', domain: '核心' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		createdAt: T0,
		adoptedAt: null,
		history: [{ at: T0, action: 'create' }],
		deleted: false,
		holders: [],
		unread: { ai: false, user: false },
		...over,
	};
}

/** 什么也不做。 */
function noop(): void {
	/* 故意为空。 */
}

/* ══════════════════════════════════════════════════════════════
 * ① 组件矩阵
 * ══════════════════════════════════════════════════════════════ */

function Matrix(): React.ReactNode {
	return (
		<section className="pv-block">
			<h2>① StatusButton：两档尺寸 × 可点 / 只读</h2>
			<div className="pv-status-grid">
				<StatusButton status={TaskState.AUTH_REQUIRED} size="sm" onOpen={noop} />
				<StatusButton
					status={TaskState.AUTH_REQUIRED}
					size="sm"
					interactive={false}
					disabledReason="列表行里的只读形态"
				/>
				<StatusButton status={TaskState.AUTH_REQUIRED} size="md" onOpen={noop} />
				<StatusButton
					status={TaskState.AUTH_REQUIRED}
					size="md"
					interactive={false}
					disabledReason="详情头没接菜单时的只读形态"
				/>
			</div>

			<h2 style={{ marginTop: 18 }}>九个状态（边框 = 状态色）</h2>
			<div className="pv-status-grid">
				{TASK_STATES.map((state) => (
					<StatusButton key={state} status={state} size="sm" onOpen={noop} />
				))}
			</div>
		</section>
	);
}

/* ══════════════════════════════════════════════════════════════
 * ② / ③ / ④ 三处调用点
 * ══════════════════════════════════════════════════════════════ */

function CallSites(props: { readonly onOpen: () => void }): React.ReactNode {
	const sample = card();
	const head = detailTableOf(sample, { kindLabel: '设计', templateLabel: '决策' }).head;

	return (
		<>
			<section className="pv-block">
				<h2>② CardRow（列表行，sm，只读 —— 整行是选卡按钮）</h2>
				<CardRow
					card={sample}
					selected={false}
					kindLabel="设计"
					templateLabel="决策"
					onSelect={noop}
				/>
			</section>

			<section className="pv-block">
				<h2>③ DetailHead（详情头，md，可点 —— 点它记录事件）</h2>
				<div className="pv-detail-frame">
					<DetailHead
						head={head}
						onAddRelation={noop}
						onDerive={noop}
						relations={undefined}
						onJumpRelation={undefined}
						onClose={undefined}
						onExpand={undefined}
						siblingGroups={undefined}
						onStatusOpen={props.onOpen}
					/>
				</div>
			</section>

			<section className="pv-block">
				<h2>④ TreeCard（科技树节点，sm，只读；收尾状态给不同原因）</h2>
				<div className="pv-tc-stage">
					<div className="pv-tc-cell" style={{ left: 16, top: 16 }}>
						<TreeCard
							card={sample}
							kindLabel="设计"
							templateLabel=""
							selected={false}
							onSelect={noop}
							style={{ position: 'relative', width: 190, height: 78 }}
							layer={1}
						/>
					</div>
					<div className="pv-tc-cell" style={{ left: 240, top: 16 }}>
						<TreeCard
							card={card({ status: TaskState.COMPLETED })}
							kindLabel="设计"
							templateLabel=""
							selected={false}
							onSelect={noop}
							style={{ position: 'relative', width: 190, height: 78 }}
							layer={1}
						/>
					</div>
				</div>
				<p className="pv-note">
					左边是需要授权（未收尾）⇒「在详情里改状态」；右边是成功（冻结）⇒「卡已收尾（冻结），状态不能再改」。
				</p>
			</section>
		</>
	);
}

/* ══════════════════════════════════════════════════════════════
 * ⑤ App
 * ══════════════════════════════════════════════════════════════ */

function App(): React.ReactNode {
	const [events, setEvents] = useState<readonly string[]>([]);
	const push = (what: string): void => setEvents((one) => [...one, what]);

	return (
		<div className="preview">
			<header className="pv-head">
				<h1>StatusButton（#62 / #63）</h1>
				<p>
					圆点 + 文案（<code>STATE_LABELS</code>）+ 状态色边框 · 三处调用点复用同一个组件 ·
					可点态后缀 ▾，只读态带 <code>aria-description</code>
				</p>
			</header>

			<div className="tb3w-root pv-shell">
				<Matrix />
				<CallSites onOpen={() => push('detail-status-open')} />

				<section className="pv-block">
					<h2>⑤ 回调日志</h2>
					<ul className="pv-events" data-event-log>
						{events.length === 0 ? <li className="pv-events__empty">（还没有事件）</li> : null}
						{events.map((one, index) => (
							<li key={`${String(index)}-${one}`} data-event={one}>
								{one}
							</li>
						))}
					</ul>
					<button type="button" className="ghost-btn" onClick={() => setEvents([])}>
						清空日志
					</button>
				</section>
			</div>
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
