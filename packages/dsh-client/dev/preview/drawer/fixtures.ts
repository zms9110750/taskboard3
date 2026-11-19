/**
 * 抽屉预览的**共享夹具** —— `main.tsx`（浏览器）和 `ssr-entry.tsx`（SSR 断言）
 * 用**同一份**数据。
 *
 * ⚠ 为什么抽出来：两份各抄一遍数据的话，SSR 断言证明的结构和预览里看到的东西
 *   可能不是同一份（改了一边忘了另一边），而那种不一致**不报错**。
 *
 * 数据来自设计图 `view-4-drawer*.svg`：4 个工作区（默认工作区 / petSystem2 /
 * petSystem / dsh）、5 张卡（GU-01…05）。GU-02 的章节 / 历史照设计图右栏写。
 * 模板清单 18 条照 `packages/core/templates/*.yaml`（和 workspace 预览同源）。
 */

import { TaskState } from '@taskboard/protocol';

import type { Card, TemplateSummary, Workspace as SpaceEntity } from '../../../src/types.ts';

/* ══════════════════════════════════════════════════════════
   模板 / 类别
   ══════════════════════════════════════════════════════════ */

/** 18 个模板摘要（和 `dev/preview/workspace/main.tsx` 的清单同源）。 */
export const TEMPLATES: readonly TemplateSummary[] = Object.freeze([
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

/** 类别中文名（产品里由 `/api/kinds` 注入；预览写死设计图上那四个词）。 */
export const KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
	goal: '目标',
	design: '设计',
	work: '工作',
	record: '记录',
});

/* ══════════════════════════════════════════════════════════
   时间 / 造卡
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

/**
 * 造一条历史。
 *
 * @param timestamp 时间
 * @param action 机器标识
 * @param actor 谁做的
 * @param detail 可选细节
 */
function hist(timestamp: number, action: string, actor: 'ai' | 'user', detail?: unknown): PreviewHistory {
	return detail === undefined
		? { at: timestamp, action, actor }
		: { at: timestamp, action, actor, detail };
}

/** 造卡的简写。 */
interface CardSpec {
	readonly id: string;
	readonly title: string;
	readonly status: string;
	readonly ref: string;
	readonly kind: string;
	readonly domain: string;
	readonly last: number;
	readonly note?: string;
	readonly parent?: string;
	readonly links?: readonly { readonly label: string; readonly to: string }[];
	readonly unread?: { readonly ai: boolean; readonly user: boolean };
}

/**
 * 造一张卡。
 *
 * ⚠ `history` 的**最后一条 = 「最后动过」**（`cardTimes()` 读数组末位）。
 *
 * @param spec 简写
 * @param sections 章节（按模板顺序，只给形状）
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
		createdAt: spec.last - 3 * 3_600_000,
		adoptedAt: null,
		history: [
			hist(spec.last - 3 * 3_600_000, 'create', 'user'),
			hist(spec.last - 2 * 3_600_000, 'adopt', 'user'),
			hist(spec.last, 'transition', 'ai', {
				from: TaskState.SUBMITTED,
				to: spec.status,
			}),
		],
		deleted: false,
		holders: [],
		unread: spec.unread ?? { ai: false, user: false },
	};
}

/* ══════════════════════════════════════════════════════════
   5 张卡 —— 编号 / 状态 / 类别 / 领域 / 标题 / 时间照设计图
   ══════════════════════════════════════════════════════════ */

/** 一段两行以内的通用正文。 */
function textOf(value: string): Readonly<Record<string, { label: string; payload: unknown }>> {
	return {
		goal: { label: '我想要什么', payload: { $type: 'text', value } },
	};
}

/** 5 张卡（设计图 drawer 左列那 5 条）。 */
export const CARDS: readonly Card[] = Object.freeze([
	card(
		{
			id: 'GU-01',
			title: '岗位说明：后端接口',
			status: TaskState.WORKING,
			ref: 'userNeed',
			kind: 'goal',
			domain: '核心',
			last: at(11, 19, 4, 12),
			unread: { ai: true, user: false },
		},
		textOf('把后端接口的岗位职责、边界、交付物写清楚，给 AI 当任务上下文。'),
	),
	card(
		{
			id: 'GU-02',
			title: '建卡页左栏定稿',
			status: TaskState.WORKING,
			ref: 'decision',
			kind: 'design',
			domain: '核心',
			last: at(11, 19, 5, 41),
			note: '先按 ① 做，等用户看完截图再定。',
			parent: 'GU-01',
			links: [{ label: '相关', to: 'GU-03' }],
			unread: { ai: false, user: true },
		},
		{
			background: {
				label: '背景',
				payload: {
					$type: 'markdown',
					value:
						'旧版新建页左栏是「模板 + 父任务」同一行；用户 2026-11-18 明确要求改成分行，并给了三级联选弹层。\n\n' +
						'关系 / 高级设置两个按钮互斥、共用下面同一块折叠区 —— 用户 2026-11-19 选「用 245，跟旧版一样」。\n\n' +
						'窄容器（570）改上下堆叠；矮容器（400）只收紧纵向间距，结构不动。',
				},
			},
			expected: {
				label: '预期',
				payload: {
					$type: 'text',
					value:
						'标题 → 模板 → 父任务 → [关系 0] [高级设置]；模板点开是三级联选弹层（领域 → 类别 → 模板）。\n' +
						'选完不关弹层、模板说明块常驻 —— 旧版 pickTemplate 源码确认的行为。',
				},
			},
		},
	),
	card(
		{
			id: 'GU-03',
			title: '抽屉视图设计图',
			status: TaskState.INPUT_REQUIRED,
			ref: 'research',
			kind: 'work',
			domain: '核心',
			last: at(11, 19, 5, 58),
			links: [{ label: '派生', to: 'GU-02' }],
		},
		textOf('把抽屉的层次、触发、内部和工作区关系画清楚，供用户逐条确认。'),
	),
	card(
		{
			id: 'GU-04',
			title: '详情页历史折叠',
			status: TaskState.UNSPECIFIED,
			ref: 'expectedMismatch',
			kind: 'goal',
			domain: '代码',
			last: at(11, 18, 22, 7),
		},
		textOf('历史 ≥2 条时折叠成一行，点开再看 —— 详情页不能被历史挤爆。'),
	),
	card(
		{
			id: 'GU-05',
			title: '科技树分层坐标',
			status: TaskState.SUBMITTED,
			ref: 'architecture',
			kind: 'design',
			domain: '代码',
			last: at(11, 18, 20, 30),
		},
		textOf('科技树的分层坐标怎么算：关系深度 + 兄弟顺序，不要力导向。'),
	),
]);

/* ══════════════════════════════════════════════════════════
   工作区 —— 设计图上那四个名字 + 一个归档（演示「显示已归档」）
   ══════════════════════════════════════════════════════════ */

/** 工作区清单。 */
export const WORKSPACES: readonly SpaceEntity[] = Object.freeze([
	{ id: 'default', displayName: '默认工作区', archived: false, createdAt: at(11, 1, 9, 0) },
	{ id: 'petsystem2', displayName: 'petSystem2', archived: false, createdAt: at(11, 2, 9, 0) },
	{ id: 'petsystem', displayName: 'petSystem', archived: false, createdAt: at(11, 3, 9, 0) },
	{ id: 'dsh', displayName: 'dsh', archived: false, createdAt: at(11, 4, 9, 0) },
	{ id: 'archive', displayName: '归档区', archived: true, createdAt: at(10, 20, 9, 0) },
]);

/**
 * 页签实例的筛选初始态（设计图右侧那张列表的筛选条：状态 / 类别 / 领域都选了）。
 *
 * ⚠ 抽屉实例不传 `defaultPicked` —— 两个实例的筛选状态天然独立，
 *   这也是设计图 ④ 说的「状态独立」里的一项。
 */
export const PAGE_DEFAULT_PICKED: Readonly<Record<string, readonly string[]>> = Object.freeze({
	status: [TaskState.WORKING],
	kind: ['design'],
	domain: ['核心', 'decision'],
});
