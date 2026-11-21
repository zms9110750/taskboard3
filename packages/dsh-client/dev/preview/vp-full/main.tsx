/**
 * 工作区预览 —— **完整产品页面的样子**（不是组件陈列）。
 *
 * ## 这个预览里什么是真的
 *
 * - **组件是真的**：`SpaceBar` / `FilterRow`+`FilterBox` / `SearchBox` / `CardRow` /
 *   `CardDetail` / `StatusMenu` / `TechTree` 全部来自 `src/renderers/`，一个替身都没有。
 * - **样式是真的**：`injectStyles()` 注入 `src/styles.ts` 的 `WORKSPACE_CSS`
 *   —— 预览和产品是同一份 CSS。`style.css` 里只有预览外壳 + mock tab 头。
 * - **布局是真的**：舞台尺寸 = 用户给的真实尺寸（1600×1000 / 570×920），
 *   不缩放、不近似；窄版靠 `@container tb3w` 切到上下堆叠。
 *
 * ## 这个预览里什么是假的
 *
 * - **数据**：没有服务端。12 张卡 / 6 个空间 / 18 个模板抄自设计图与
 *   `packages/core/templates/*.yaml`（模板名、类别、领域、编号前缀都是真值）。
 * - **筛选 / 搜索是真的**：`Workspace` 本地调 `applyCardQuery()`（判决在
 *   `src/pure/card-filter.ts`）—— 不匹配的卡**隐藏**。`onFilterChange` /
 *   `onSearchChange` 仍然上报（外面若有数据层要同步，照旧能接）。
 * - **科技树是真的**：`Workspace` 的视图切换渲染定稿的 `TechTree`
 *   （筛/搜判决在 `src/pure/tree-filter.ts`，hover 淡化边在组件里）。
 * - **状态转移**：菜单能开、能选，选了只弹一条预览回执，不发请求。
 *
 * ## 初始状态 = 设计图那个状态
 *
 * 设计图（`X:\temp\view-3-workspace*.svg`）画的是：
 * 选中 C-03、领域筛选展开到「核心 › 设计」、状态：提交、类别：设计。
 * 前两条由本文件 seed（`selectedId` / `defaultPicked`），最后一条用一次
 * 程序化点击把「领域」方框打开 —— `FilterRow` 的 `openId` 是它自己的
 * UI 状态，没有「默认打开」这个 prop（也不该有：那是受控组件的边界）。
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { TaskState } from '@taskboard/protocol';
import type { ButtonAction } from '@taskboard/protocol';

import type { Picked } from '../../../src/pure/filter-box.ts';
import { Workspace } from '../../../src/renderers/Workspace.tsx';
import { injectStyles } from '../../../src/styles.ts';
import type { Card, TemplateSummary, Workspace as SpaceEntity } from '../../../src/types.ts';

/* ══════════════════════════════════════════════════════════
   模板清单（ref / 显示名 / 类别 / 领域）—— 抄自 core 的 YAML
   ══════════════════════════════════════════════════════════ */

/** 18 个模板（和 `dev/preview/cardcreate/main.tsx` 的 CATALOG 同源，这里只要摘要四字段）。 */
const TEMPLATES: readonly TemplateSummary[] = Object.freeze([
	{ ref: 'userNeed', displayName: '用户任务', kind: 'goal', domain: '核心' },
	{ ref: 'decision', displayName: '决策', kind: 'design', domain: '核心' },
	{ ref: 'question', displayName: '提问', kind: 'design', domain: '核心' },
	{ ref: 'research', displayName: '调研', kind: 'work', domain: '核心' },
	{ ref: 'demo', displayName: '演示', kind: 'work', domain: '核心' },
	{ ref: 'verify', displayName: '校验', kind: 'work', domain: '核心' },
	{ ref: 'delivery', displayName: '交付', kind: 'record', domain: '核心' },
	{ ref: 'archive', displayName: '留档', kind: 'record', domain: '核心' },
	{ ref: 'blocker', displayName: '阻碍', kind: 'record', domain: '核心' },
	{ ref: 'retro', displayName: '复盘', kind: 'record', domain: '核心' },
	{ ref: 'expectedMismatch', displayName: '预期不符', kind: 'goal', domain: '代码' },
	{ ref: 'newFeature', displayName: '新增功能', kind: 'goal', domain: '代码' },
	{ ref: 'optimize', displayName: '项目优化', kind: 'goal', domain: '代码' },
	{ ref: 'writeTests', displayName: '编写测试', kind: 'goal', domain: '代码' },
	{ ref: 'architecture', displayName: '技术架构', kind: 'design', domain: '代码' },
	{ ref: 'interfaceUi', displayName: '接口界面', kind: 'design', domain: '代码' },
	{ ref: 'lowLevel', displayName: '底层实现', kind: 'design', domain: '代码' },
	{ ref: 'writeCode', displayName: '编写代码', kind: 'work', domain: '代码' },
]);

/** 类别中文名 —— 客户端没有 `/api/kinds`，产品里由调用方注入（设计图上的那四个词）。 */
const KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
	goal: '目标',
	design: '设计',
	work: '工作',
	record: '记录',
});

/* ══════════════════════════════════════════════════════════
   时间
   ══════════════════════════════════════════════════════════ */

/**
 * 造一个 2026 年的时间戳。
 *
 * @param month 月（1–12）
 * @param day 日
 * @param hour 时
 * @param minute 分
 */
function at(month: number, day: number, hour: number, minute: number): number {
	return new Date(2026, month - 1, day, hour, minute, 0, 0).getTime();
}

/** 一条历史（多带一个 `actor` —— `types.ts` 的 `HistoryEntry` 没声明它，但 core 会写）。 */
interface PreviewHistory {
	readonly at: number;
	readonly action: string;
	readonly actor: 'ai' | 'user';
	readonly detail?: unknown;
}

/** 造一条历史。 */
function hist(
	timestamp: number,
	action: string,
	actor: 'ai' | 'user',
	detail?: unknown,
): PreviewHistory {
	return detail === undefined ? { at: timestamp, action, actor } : { at: timestamp, action, actor, detail };
}

/* ══════════════════════════════════════════════════════════
   卡 —— 12 张（前 7 张照设计图，后 5 张补满「还有 5 条」）
   ══════════════════════════════════════════════════════════ */

/** 一张卡的简写。 */
interface CardSpec {
	readonly id: string;
	readonly title: string;
	readonly status: string;
	readonly ref: string;
	readonly kind: string;
	readonly domain: string;
	readonly last: number;
	readonly note?: string;
	readonly unread?: { readonly ai: boolean; readonly user: boolean };
	readonly parent?: string;
	readonly links?: readonly { readonly label: string; readonly to: string }[];
}

/**
 * 造卡。
 *
 * ⚠ `history` 的**最后一条 = 「最后动过」**（`cardTimes()` 读数组末位），
 *   所以 `spec.last` 既是列表上的时间，也是历史里最后一条的时间。
 *
 * @param spec 简写
 * @param sections 章节（按模板顺序；这里只给形状，不给真模板的全文）
 */
function card(
	spec: CardSpec,
	sections: Readonly<Record<string, { readonly label: string; readonly payload: unknown }>>,
): Card {
	return {
		id: spec.id,
		title: spec.title,
		status: spec.status,
		template: { ref: spec.ref, kind: spec.kind, domain: spec.domain },
		relations: { parent: spec.parent ?? null, links: spec.links ?? [] },
		sections,
		note: spec.note ?? '',
		createdAt: spec.last - 3_600_000,
		adoptedAt: null,
		history: [
			hist(spec.last - 3_600_000, 'create', 'user'),
			hist(spec.last, 'transition', 'ai', {
				from: TaskState.UNSPECIFIED,
				to: spec.status,
			}),
		],
		deleted: false,
		holders: [],
		unread: spec.unread ?? { ai: false, user: false },
	};
}

/** 两个章节的通用正文（非 C-03 的卡用）。 */
function genericSections(title: string): Readonly<Record<string, { label: string; payload: unknown }>> {
	return {
		goal: { label: '我想要什么', payload: { $type: 'text', value: title } },
		limit: { label: '边界 / 不做什么', payload: { $type: 'text', value: '' } },
	};
}

/** 12 张卡 —— 前 7 张的编号 / 状态 / 类别 / 领域 / 标题 / 时间全部照设计图。 */
const CARDS: readonly Card[] = Object.freeze([
	card(
		{
			id: 'U-01',
			title: '把任务板的语义定清楚',
			status: TaskState.SUBMITTED,
			ref: 'userNeed',
			kind: 'goal',
			domain: '核心',
			last: at(11, 18, 20, 14),
		},
		genericSections('用户向 ai 发布任务，把需求一股脑写下来。'),
	),
	card(
		{
			id: 'F-02',
			title: '列表行改成「编号 + 状态」正方形',
			status: TaskState.WORKING,
			ref: 'newFeature',
			kind: 'goal',
			domain: '代码',
			last: at(11, 18, 19, 2),
			unread: { ai: true, user: false },
		},
		genericSections('把右边的当前状态挪到左边，放在编号下面。'),
	),
	card(
		{
			id: 'C-03',
			title: '详情面板：关系按钮要显眼',
			status: TaskState.AUTH_REQUIRED,
			ref: 'decision',
			kind: 'design',
			domain: '核心',
			last: at(11, 18, 18, 3),
			note: '先按 ① 做，等用户看完截图再定。',
			parent: 'SY-09',
			links: [
				{ label: '依赖', to: 'F-02' },
				{ label: '相关', to: 'W-04' },
			],
		},
		{
			directions: {
				label: '可能的方向',
				payload: {
					$type: 'text',
					value:
						'① 关系按钮留在动作行最左，accent 实底；\n② 折进标题右边的小按钮（旧版做法，用户说太隐蔽）。',
				},
			},
			helpful: {
				label: '知道什么信息后对决策有帮助',
				payload: { $type: 'text', value: '旧版详情面板的真实截图 —— 关系按钮究竟藏在哪一层。' },
			},
			lookAt: { label: '我可以看什么来得到方向', payload: { $type: 'text', value: '' } },
		},
	),
	card(
		{
			id: 'W-04',
			title: '未读用加粗边框表达，不画额外线条',
			status: TaskState.COMPLETED,
			ref: 'writeCode',
			kind: 'work',
			domain: '代码',
			last: at(11, 18, 16, 30),
			unread: { ai: false, user: true },
		},
		genericSections('AI 改过 ⇒ 左边框；我改过 ⇒ 右边框。'),
	),
	card(
		{
			id: 'S-05',
			title: '旧版工作区那 4 块是怎么拼起来的',
			status: TaskState.INPUT_REQUIRED,
			ref: 'research',
			kind: 'work',
			domain: '核心',
			last: at(11, 18, 15, 12),
		},
		genericSections('不知道该怎么做之前，先查清楚。'),
	),
	card(
		{
			id: 'T-06',
			title: 'SpaceBar 六行表逐行断言',
			status: TaskState.FAILED,
			ref: 'writeTests',
			kind: 'goal',
			domain: '代码',
			last: at(11, 18, 11, 40),
		},
		genericSections('测「点 chip 只查看、不激活」这条语义。'),
	),
	card(
		{
			id: 'Q-07',
			title: '窄 tab 里列表和详情怎么分？',
			status: TaskState.UNSPECIFIED,
			ref: 'question',
			kind: 'design',
			domain: '核心',
			last: at(11, 17, 22, 8),
		},
		genericSections('窄容器里两栏竖着放不下，横向又挤 —— 到底怎么分？'),
	),
	card(
		{
			id: 'E-08',
			title: '列表行在 570 宽里 label 会不会挤爆',
			status: TaskState.SUBMITTED,
			ref: 'expectedMismatch',
			kind: 'goal',
			domain: '代码',
			last: at(11, 17, 20, 41),
		},
		genericSections('三个 label 横排，最长 120px，挤不下省略。'),
	),
	card(
		{
			id: 'D-09',
			title: '详情面板的章节直接平铺，不套「正文」',
			status: TaskState.WORKING,
			ref: 'demo',
			kind: 'work',
			domain: '核心',
			last: at(11, 17, 18, 20),
		},
		genericSections('为设计的方向提供极小实现以验证想法。'),
	),
	card(
		{
			id: 'L-10',
			title: '把组件清单里的进度改成「定稿」',
			status: TaskState.COMPLETED,
			ref: 'delivery',
			kind: 'record',
			domain: '核心',
			last: at(11, 17, 15, 6),
		},
		genericSections('工作结果需要一个交付子任务汇报。'),
	),
	card(
		{
			id: 'A-11',
			title: '旧版 views/workspace.js 的 78 行都做了什么',
			status: TaskState.CANCELED,
			ref: 'archive',
			kind: 'record',
			domain: '核心',
			last: at(11, 16, 21, 30),
		},
		genericSections('有东西要留着，记下来。'),
	),
	card(
		{
			id: 'R-12',
			title: '窄版两栏比例要不要做成可拖的',
			status: TaskState.REJECTED,
			ref: 'architecture',
			kind: 'design',
			domain: '代码',
			last: at(11, 16, 17, 45),
		},
		genericSections('放什么、不放什么，先摆出来。'),
	),
]);

/* ══════════════════════════════════════════════════════════
   空间 —— 6 个（含一个归档，演示「显示已归档」开着时 chip 的虚线态）
   ══════════════════════════════════════════════════════════ */

const WORKSPACES: readonly SpaceEntity[] = Object.freeze([
	{ id: 'core', displayName: '核心', archived: false, createdAt: at(11, 1, 9, 0) },
	{ id: 'code', displayName: '代码', archived: false, createdAt: at(11, 2, 9, 0) },
	{ id: 'writing', displayName: '写作', archived: false, createdAt: at(11, 3, 9, 0) },
	{ id: 'research', displayName: '调研', archived: false, createdAt: at(11, 4, 9, 0) },
	{ id: 'design', displayName: '设计稿', archived: false, createdAt: at(11, 5, 9, 0) },
	{ id: 'archive', displayName: '归档区', archived: true, createdAt: at(10, 20, 9, 0) },
]);

/**
 * 筛选初始态 —— **只 seed 一条**（类别：设计）。
 *
 * ## 为什么不照设计图把三个框都 seed 上
 *
 * 设计图（`view-3-workspace*.svg`）画的是「状态：提交 + 类别：设计 +
 * 领域：核心›设计」同时生效的样子。但筛选是 **AND 语义**（判决在
 * `src/pure/card-filter.ts`，本预览不改它）：每条选中路径都必须是卡在对应
 * 树里的位置路径的前缀。三条各自命中：
 *
 * | 条件 | 命中 |
 * |---|---|
 * | 状态 = 提交 | U-01 / E-08（都是 goal）|
 * | 类别 = 设计 | C-03 / Q-07 / R-12 |
 * | 领域 = 核心›设计 | C-03 / Q-07 |
 *
 * 三条的交集是**空集** ⇒ 预览一打开就是空态（看起来像数据丢了）。
 * 所以只 seed「类别」，其余留给用户点 —— 初始列表有 3 张卡。
 *
 * ⚠ **不要**为了让初始态「好看」去改 AND 语义：过滤逻辑是对的，错的是 seed。
 */
const DEFAULT_PICKED: Readonly<Record<string, Picked>> = Object.freeze({
	kind: ['design'],
});

/* ══════════════════════════════════════════════════════════
   两种真实尺寸的舞台
   ══════════════════════════════════════════════════════════ */

/** 一个舞台。 */
interface Stage {
	readonly id: 'full' | 'narrow';
	readonly label: string;
	readonly note: string;
	readonly width: number;
	readonly height: number;
	/** tab 头右侧那句提示（设计图上的标注；只有窄版照抄）。 */
	readonly tabHint: string | undefined;
}

const STAGES: readonly Stage[] = Object.freeze([
	{
		id: 'full',
		label: '全屏',
		note: '',
		width: 1600,
		height: 1000,
		tabHint: undefined,
	},
]);

/* ══════════════════════════════════════════════════════════
   页面
   ══════════════════════════════════════════════════════════ */

/** 预览页。 */
function App(): React.ReactNode {
	const [workspaces, setWorkspaces] = useState<readonly SpaceEntity[]>(WORKSPACES);
	const [currentId, setCurrentId] = useState('core');
	const [viewingId, setViewingId] = useState('core');
	const [showArchived, setShowArchived] = useState(true);
	const [selectedId, setSelectedId] = useState<string | null>('C-03');
	const [notice, setNotice] = useState<string | undefined>(undefined);

	const stage = STAGES[0] as Stage;

	/** 假回执（没有服务端）。 */
	const say = (message: string): void => {
		setNotice(message);
	};

	/*
	 * 把「领域」筛选框打开 —— 设计图的展开态画的就是它。
	 *
	 * ⚠ 这是**预览 seed**，不是产品行为：`FilterRow` 的 `openId` 是它自己的
	 *   UI 状态（受控组件的边界），没有「默认打开某个框」的 prop。
	 *   用一次真实点击（不是改 class）⇒ 走的是和用户点击完全相同的代码路径。
	 */
	useEffect(() => {
		const timer = globalThis.setTimeout(() => {
			const box = document.querySelector('[data-box-id="domain"]');
			if (box instanceof HTMLElement) box.click();
		}, 80);
		return () => {
			globalThis.clearTimeout(timer);
		};
	}, []);

	/** 状态菜单选了某一项。 */
	const onAction = (cardId: string, action: ButtonAction): void => {
		say(`状态转移：${cardId} →「${action.label}」（预览：不发请求、不落库）`);
	};

	return (
		<div className="pv">
			<div className="pv-scroll">
				{/*
				 * 舞台 —— 尺寸就是**真实尺寸**（不是缩放、不是近似）。
				 * 外层页面在舞台比视口大时自己滚；截图脚本会把视口改成舞台尺寸。
				 */}
				<div
					className="pv-stage"
					data-stage={stage.id}
					style={{ width: `${String(stage.width)}px`, height: `${String(stage.height)}px` }}
				>
					<div className="pv-ws">
						<Workspace
							workspaces={workspaces}
							currentId={currentId}
							viewingId={viewingId}
							showArchived={showArchived}
							cards={CARDS}
							templates={TEMPLATES}
							selectedId={selectedId}
							density="compact"
			defaultPicked={DEFAULT_PICKED}
							kindLabelOf={(kind) => KIND_LABELS[kind] ?? kind}
							aiUnreadCount={1}
							aiUpdatedCount={2}
							onView={(id) => {
								setViewingId(id);
							}}
							onToggleArchived={(id) => {
								setWorkspaces((prev) =>
									prev.map((one) => (one.id === id ? { ...one, archived: !one.archived } : one)),
								);
							}}
							onToggleShowArchived={() => {
								setShowArchived((prev) => !prev);
							}}
							onCreateWorkspace={() => {
								say('新建任务板（预览：没有服务端）');
							}}
							onSelect={(cardId) => {
								setSelectedId(cardId);
							}}
							onCreateCard={() => {
								say('打开建卡页（预览：入口没接）');
							}}
							onFilterChange={(id, next) => {
								say(`筛选 ${id} → ${next.length === 0 ? '（清空）' : next.join(' / ')}（预览：本地实时过滤已生效，这里只是回执）`);
							}}
							onSearchChange={() => {
								say('搜索（预览：本地实时过滤已生效，这里只是回执）');
							}}
							onAction={onAction}
							onAddRelation={(cardId) => {
								say(`打开 ${cardId} 的关系浮层（关系区还没做）`);
							}}
							onDerive={(cardId) => {
								say(`从 ${cardId} 派生子任务（预览：入口没接）`);
							}}
							onNoteChange={(cardId) => {
								say(`备注已提交 ${cardId}（预览：不落库）`);
							}}
							onOpenPermission={() => {
								say('权限与约定面板（V2 还没做）');
							}}
							onExpandDetail={() => {
								say('放大成 1200 × 400 抽屉（V4 还没做）');
							}}
						/>
					</div>
				</div>
			</div>

			{notice === undefined ? null : (
				<div className="pv-toast" data-pv-toast>
					<span>{notice}</span>
					<button
						type="button"
						onClick={() => {
							setNotice(undefined);
						}}
					>
						知道了
					</button>
				</div>
			)}
		</div>
	);
}

/* 产品样式和预览是同一份 —— 不在预览的 style.css 里抄一份。 */
injectStyles();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
