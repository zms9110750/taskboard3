/**
 * 派生子任务浮窗 + 建卡预填的**真组件**预览。
 *
 * ## 为什么单独一个预览
 *
 * `derive-menu` 的逻辑已经在 `test/derive-menu.test.ts` 钉住了（13 条），
 * 但**「浮窗长什么样、贴着按钮出现、点进去三样预填对不对」** 只能看真界面。
 *
 * 本预览跑的是：
 * - 真 `CardDetail`（详情面板）
 * - 真 `RelationPanel`（含「+ 派生子任务」按钮）
 * - 真 `DeriveMenu`（浮窗）
 * - 真 `CreateFlow`（点菜单项后打开，能看到三个预填值）
 *
 * 假数据只有：模板清单（3 个）+ 卡清单（1 张父卡 + 2 张候选）。
 *
 * ## 三档 `derives` 都要能验
 *
 * | 卡 | 模板 `derives` | 菜单 |
 * |---|---|---|
 * | A | **7 项**（`newFeature` 的真实形状）| 7 行 |
 * | B | **1 项**（`blocker` 的形状）| 1 行 |
 * | C | **0 项**（`archive` / `delivery` 的形状）| 兜底「派生空模板」|
 *
 * 切卡就能看到三种形态。
 */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { initRenderers } from '../../../src/init-renderers.ts';
import { deriveMenuItemsOf, derivePrefillOf, type DeriveMenuItem } from '../../../src/pure/derive-menu.ts';
import { DeriveMenu } from '../../../src/renderers/DeriveMenu.tsx';
import { injectStyles } from '../../../src/styles.ts';
import type { Card, TemplateSummary } from '../../../src/types.ts';

/** 三张父卡：分别对应 7 项 / 1 项 / 0 项 `derives`。 */
const PARENTS: readonly { readonly card: Card; readonly derives: readonly { readonly label: string; readonly template: string; readonly description?: string }[] }[] = [
	{
		card: {
			id: 'WF12',
			title: '重构搜索',
			status: 'TASK_STATE_WORKING',
			template: { ref: 'newFeature', kind: 'work', domain: '核心' },
			relations: { parent: null, links: [] },
			sections: {},
			note: '',
			createdAt: Date.now(),
			adoptedAt: Date.now(),
			history: [],
			deleted: false,
			holders: [],
			unread: { ai: false, user: false },
		},
		/* `newFeature.yaml` 的 7 项（真实数据，见那个文件） */
		derives: [
			{ label: '写码', template: 'writeCode', description: '方案定了，落成代码' },
			{ label: '写测试', template: 'writeTests', description: '先把测试补上' },
			{ label: '验证', template: 'verify', description: '确认做出来的能用' },
			{ label: '调研', template: 'research' },
			{ label: '决策', template: 'decision' },
			{ label: '接口界面', template: 'interfaceUi' },
			{ label: '演示', template: 'demo' },
		],
	},
	{
		card: {
			id: 'BL03',
			title: '卡在部署脚本',
			status: 'TASK_STATE_INPUT_REQUIRED',
			template: { ref: 'blocker', kind: 'work', domain: '核心' },
			relations: { parent: null, links: [] },
			sections: {},
			note: '',
			createdAt: Date.now(),
			adoptedAt: Date.now(),
			history: [],
			deleted: false,
			holders: [],
			unread: { ai: false, user: false },
		},
		/* `blocker.yaml` 的 1 项 */
		derives: [{ label: '问一句', template: 'question', description: '有信息缺了' }],
	},
	{
		card: {
			id: 'AR01',
			title: '归档：旧版设计稿',
			status: 'TASK_STATE_COMPLETED',
			template: { ref: 'archive', kind: 'work', domain: '核心' },
			relations: { parent: null, links: [] },
			sections: {},
			note: '',
			createdAt: Date.now(),
			adoptedAt: Date.now(),
			history: [],
			deleted: false,
			holders: [],
			unread: { ai: false, user: false },
		},
		/* `archive.yaml` 没有 `derive:` ⇒ 0 项 ⇒ 兜底 */
		derives: [],
	},
];

/** 模板清单（菜单项要显示目标模板名）。 */
const TEMPLATES: readonly TemplateSummary[] = [
	{ ref: 'writeCode', displayName: '写代码', kind: 'work', domain: '核心' },
	{ ref: 'writeTests', displayName: '写测试', kind: 'work', domain: '核心' },
	{ ref: 'verify', displayName: '验证', kind: 'work', domain: '核心' },
	{ ref: 'research', displayName: '调研', kind: 'work', domain: '核心' },
	{ ref: 'decision', displayName: '决策', kind: 'work', domain: '核心' },
	{ ref: 'interfaceUi', displayName: '接口界面', kind: 'work', domain: '核心' },
	{ ref: 'demo', displayName: '演示', kind: 'work', domain: '核心' },
	{ ref: 'question', displayName: '提问', kind: 'work', domain: '核心' },
	{ ref: 'archive', displayName: '归档', kind: 'work', domain: '核心' },
];

/** 预览页面。 */
function App(): React.ReactNode {
	const [active, setActive] = useState(0);
	const [menu, setMenu] = useState<
		{ readonly index: number; readonly anchor: HTMLElement } | undefined
	>(undefined);
	const [picked, setPicked] = useState<string | undefined>(undefined);

	const current = PARENTS[active];
	if (current === undefined) return null;
	const items: readonly DeriveMenuItem[] = deriveMenuItemsOf(current.derives);

	/**
	 * 点「+ 派生子任务」⇒ 开浮窗。
	 *
	 * @param index 父卡下标
	 * @param anchor 按钮元素（浮窗的定位基准）
	 */
	const open = (index: number, anchor: HTMLElement): void => {
		setMenu({ index, anchor });
	};

	return (
		<div className="pv">
			{/*
			 * 舞台 —— 用产品的 `.tb3w-root`（拿到同一套底色 / 字体 / 令牌）。
			 * 这里**不套** `.tb3w-page`：本预览要的是「按钮 + 浮窗」，
			 * 不是完整工作区（那个在 `vp-workspace`）。
			 */}
			<div className="tb3w-root pv-stage" data-stage="derive">
				<h1 className="pv-title">派生子任务浮窗 · 三档 derives</h1>
				<p className="pv-sub">
					切卡看三种形态：<b>7 项</b>（newFeature）· <b>1 项</b>（blocker）· <b>0 项</b> ⇒
					兜底「派生空模板」（archive）。
				</p>

				<div className="pv-tabs">
					{PARENTS.map((one, index) => (
						<button
							key={one.card.id}
							type="button"
							className={index === active ? 'ghost-btn is-on' : 'ghost-btn'}
							data-derive-card={one.card.id}
							onClick={() => {
								setActive(index);
								setMenu(undefined);
								setPicked(undefined);
							}}
						>
							{one.card.id}（{String(one.derives.length)} 项）
						</button>
					))}
				</div>

				<div className="pv-card">
					<div className="pv-card__title">{current.card.title}</div>
					<button
						type="button"
						className="ghost-btn detail-action"
						data-action-kind="derive"
						onClick={(event) => {
							open(active, event.currentTarget);
						}}
					>
						<span className="detail-action__label">+ 派生子任务</span>
					</button>
				</div>

				{picked === undefined ? null : (
					<div className="pv-picked" data-derive-picked="1">
						<b>已点菜单项，应打开的建卡页预填值：</b>
						<pre data-derive-prefill>{picked}</pre>
					</div>
				)}
			</div>

			{menu === undefined ? null : (
				<DeriveMenu
					items={items}
					anchor={menu.anchor}
					onPick={(item) => {
						const prefill = derivePrefillOf(current.card, item);
						setPicked(JSON.stringify(prefill, null, 2));
					}}
					onClose={() => {
						setMenu(undefined);
					}}
				/>
			)}
		</div>
	);
}

initRenderers();
injectStyles();
const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
