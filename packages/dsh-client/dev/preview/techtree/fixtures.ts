/**
 * 科技树预览的**夹具** —— 纯数据，零 JSX（所以是 `.ts` 不是 `.tsx`）。
 *
 * ## 为什么单独一个文件
 *
 * `main.tsx`（浏览器预览）和 `ssr.tsx`（SSR 断言）必须用**同一批卡**：
 * 否则「预览里看到 9 张」和「断言里数到 9 张」是两套事实，绿了也不说明问题。
 *
 * ## 数据照设计图
 *
 * `X:\temp\view-1-tech-tree.svg` 画的就是这 9 张：
 *
 * ```
 * 第 0 层：GU01(根)  RB01(根)  X01(孤儿)
 * 第 1 层：WR01 ← GU01
 * 第 2 层：DC01 / DC02 / WR02 / RL01 ← WR01
 * 第 3 层：WT01 ← WR02
 * 链接：DC01 -依赖-> RB01 ；DC01 -相关-> DC02 ；WR02 -约束-> DC01（入边）
 * ```
 *
 * 派生 6 条 + 依赖 / 相关 / 约束 各 1 条 = 9 条线，和设计图底部那句
 * 「本图：派生 6 条（实线弧）+ 依赖 / 相关 / 约束 各 1 条」一致。
 *
 * 另外两组小夹具：
 * - `SHOWCASE_CARDS`：**六种关系各一条**（看颜色 / 线型 / 箭头全不全）；
 * - `CYCLE_CARDS`：parent 成环（看 ▲ 警告，且**不死循环、不丢卡**）。
 */

import { TaskState } from '@taskboard/protocol';

import type { Card, TemplateSummary } from '../../../src/types.ts';

/* ══════════════════════════════════════════════════════════════
 * 模板清单（ref / 显示名 / 类别 / 领域）—— 抄自 core 的 YAML
 * ══════════════════════════════════════════════════════════════ */

/** 预览里用到的模板摘要。 */
export const TEMPLATES: readonly TemplateSummary[] = Object.freeze([
	{ ref: 'userNeed', displayName: '用户任务', kind: 'goal', domain: '核心' },
	{ ref: 'decision', displayName: '决策', kind: 'design', domain: '核心' },
	{ ref: 'architecture', displayName: '技术架构', kind: 'design', domain: '代码' },
	{ ref: 'interfaceUi', displayName: '接口界面', kind: 'design', domain: '代码' },
	{ ref: 'research', displayName: '调研', kind: 'work', domain: '核心' },
	{ ref: 'demo', displayName: '演示', kind: 'work', domain: '核心' },
	{ ref: 'verify', displayName: '校验', kind: 'work', domain: '核心' },
	{ ref: 'writeCode', displayName: '编写代码', kind: 'work', domain: '代码' },
	{ ref: 'writeTests', displayName: '编写测试', kind: 'goal', domain: '代码' },
	{ ref: 'delivery', displayName: '交付', kind: 'record', domain: '核心' },
	{ ref: 'blocker', displayName: '阻碍', kind: 'record', domain: '核心' },
]);

/** 类别中文名 —— 客户端没有 `/api/kinds`，产品里由调用方注入（设计图上的那四个词）。 */
export const KIND_LABELS: Readonly<Record<string, string>> = Object.freeze({
	goal: '目标',
	design: '设计',
	work: '工作',
	record: '记录',
});

/** 类别中文名查表（取不到就显示英文 id —— 不编中文）。 */
export function kindLabelOf(kind: string): string {
	return KIND_LABELS[kind] ?? kind;
}

/** 模板 displayName 查表。 */
export function templateLabelOf(ref: string): string {
	return TEMPLATES.find((one) => one.ref === ref)?.displayName ?? ref;
}

/* ══════════════════════════════════════════════════════════════
 * 时间
 * ══════════════════════════════════════════════════════════════ */

/**
 * 造一个 2026 年的时间戳（固定值 ⇒ SSR 输出可复现）。
 *
 * @param month 月（1–12）
 * @param day 日
 * @param hour 时
 * @param minute 分
 */
export function at(month: number, day: number, hour: number, minute: number): number {
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

/* ══════════════════════════════════════════════════════════════
 * 造卡
 * ══════════════════════════════════════════════════════════════ */

/** 一张卡的简写。 */
interface CardSpec {
	readonly id: string;
	readonly title: string;
	readonly status: string;
	readonly ref: string;
	readonly kind: string;
	readonly domain: string;
	readonly created: number;
	readonly last: number;
	readonly parent?: string;
	readonly links?: readonly { readonly label: string; readonly to: string }[];
	readonly note?: string;
}

/**
 * 造一张卡。
 *
 * @param spec 简写
 * @param sections 章节（按模板顺序；这里只给形状，不给真模板全文）
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
		createdAt: spec.created,
		adoptedAt: null,
		history: [
			hist(spec.created, 'create', 'user'),
			hist(spec.last, 'transition', 'ai', {
				from: TaskState.UNSPECIFIED,
				to: spec.status,
			}),
		],
		deleted: false,
		holders: [],
		unread: { ai: false, user: false },
	};
}

/** 通用章节（非 DC01 的卡用）。 */
function genericSections(title: string): Readonly<
	Record<string, { readonly label: string; readonly payload: unknown }>
> {
	return {
		goal: { label: '目标', payload: { $type: 'text', value: title } },
		limit: { label: '边界 / 不做什么', payload: { $type: 'text', value: '' } },
	};
}

/* ══════════════════════════════════════════════════════════════
 * 主夹具：设计图那 9 张
 * ══════════════════════════════════════════════════════════════ */

/** 设计图上的 9 张卡（编号 / 状态 / 类别 / 领域 / 标题 / 父子关系照图）。 */
export const CARDS: readonly Card[] = Object.freeze([
	card(
		{
			id: 'GU01',
			title: '把任务板的语义定清楚',
			status: TaskState.SUBMITTED,
			ref: 'userNeed',
			kind: 'goal',
			domain: '核心',
			created: at(11, 9, 9, 10),
			last: at(11, 19, 21, 30),
		},
		genericSections('用户向 AI 发布任务，把需求一股脑写下来。'),
	),
	card(
		{
			id: 'RB01',
			title: '现有任务板实现的调研',
			status: TaskState.COMPLETED,
			ref: 'research',
			kind: 'work',
			domain: '核心',
			created: at(11, 9, 10, 0),
			last: at(11, 19, 18, 12),
		},
		genericSections('旧版 500 行 tech-tree.js 到底怎么排的。'),
	),
	card(
		{
			id: 'X01',
			title: '父卡不存在（孤儿）',
			status: TaskState.UNSPECIFIED,
			ref: 'blocker',
			kind: 'record',
			domain: '核心',
			created: at(11, 10, 11, 0),
			last: at(11, 10, 11, 30),
			parent: 'NOPE',
		},
		genericSections('parent 指向一张不存在的卡 ⇒ 第 0 层 + ▲ 警告。'),
	),
	card(
		{
			id: 'WR01',
			title: '派生规则：父卡与子卡横向齐平',
			status: TaskState.WORKING,
			ref: 'architecture',
			kind: 'design',
			domain: '代码',
			created: at(11, 11, 9, 0),
			last: at(11, 19, 20, 5),
			parent: 'GU01',
		},
		genericSections('row(父) = min(row(所有直接子卡)) —— 用户规则。'),
	),
	card(
		{
			id: 'DC01',
			title: '分层：拓扑排序 + 排行',
			status: TaskState.WORKING,
			ref: 'interfaceUi',
			kind: 'design',
			domain: '代码',
			created: at(11, 12, 9, 0),
			last: at(11, 19, 20, 40),
			parent: 'WR01',
			links: [
				{ label: 'dependsOn', to: 'RB01' },
				{ label: 'related', to: 'DC02' },
			],
			note: 'hover 时看它：三条相连边高亮，其它边淡到 25%。',
		},
		{
			goal: {
				label: '目标',
				payload: {
					$type: 'text',
					value: '按 parent 链算层号，同层按「父=min(子)」排行；一层一列（不折栏）。',
				},
			},
			design: {
				label: '设计',
				payload: {
					$type: 'text',
					value:
						'① 从最深列往左逐列排；② 每列两轮：有子卡的先排、叶子后排；③ 一层一列，不折栏。',
				},
			},
			record: {
				label: '记录',
				payload: { $type: 'text', value: '纯函数 726 行、29 条测试全绿（tree-layout.test.ts）。' },
			},
		},
	),
	card(
		{
			id: 'DC02',
			title: '同层分栏：超过 10 行',
			status: TaskState.UNSPECIFIED,
			ref: 'writeCode',
			kind: 'work',
			domain: '代码',
			created: at(11, 12, 10, 0),
			last: at(11, 19, 17, 20),
			parent: 'WR01',
		},
		genericSections('41 张无关系卡 ⇒ 5 栏 9/8/8/8/8，行数尽量平均。'),
	),
	card(
		{
			id: 'WR02',
			title: '贝塞尔连线与箭头方向',
			status: TaskState.WORKING,
			ref: 'writeCode',
			kind: 'work',
			domain: '代码',
			created: at(11, 13, 9, 0),
			last: at(11, 19, 19, 45),
			parent: 'WR01',
			links: [{ label: 'constrains', to: 'DC01' }],
		},
		genericSections('方向自适应：to 在 from 左边时控制点不许跑出两卡之间的走廊。'),
	),
	card(
		{
			id: 'RL01',
			title: '线色采样与对比度加深',
			status: TaskState.COMPLETED,
			ref: 'delivery',
			kind: 'record',
			domain: '核心',
			created: at(11, 14, 9, 0),
			last: at(11, 19, 16, 10),
			parent: 'WR01',
		},
		genericSections('派生灰弧、链接按关系上色，2px 线宽、箭头 8px 且同色。'),
	),
	card(
		{
			id: 'WT01',
			title: '箭头贴卡边 13 条回归',
			status: TaskState.INPUT_REQUIRED,
			ref: 'writeCode',
			kind: 'work',
			domain: '代码',
			created: at(11, 15, 9, 0),
			last: at(11, 19, 15, 30),
			parent: 'WR02',
		},
		genericSections('13 条边逐条量箭头尖到目标卡边的距离。'),
	),
]);

/* ══════════════════════════════════════════════════════════════
 * 小夹具：六种关系各一条
 * ══════════════════════════════════════════════════════════════ */

/** 六种关系全览：派生 + 五条链接各一条（看颜色 / 线型 / 箭头全不全）。 */
export const SHOWCASE_CARDS: readonly Card[] = Object.freeze([
	card(
		{
			id: 'A01',
			title: '根卡（看派生弧）',
			status: TaskState.WORKING,
			ref: 'userNeed',
			kind: 'goal',
			domain: '核心',
			created: at(11, 18, 9, 0),
			last: at(11, 18, 9, 30),
			links: [
				{ label: 'dependsOn', to: 'B01' },
				{ label: 'supersedes', to: 'C01' },
				{ label: 'constrains', to: 'D01' },
				{ label: 'related', to: 'C01' },
				{ label: 'references', to: 'D01' },
			],
		},
		genericSections('五条链接各一条。'),
	),
	card(
		{
			id: 'B01',
			title: '子卡 B01（派生）',
			status: TaskState.COMPLETED,
			ref: 'research',
			kind: 'work',
			domain: '核心',
			created: at(11, 18, 9, 5),
			last: at(11, 18, 9, 40),
			parent: 'A01',
		},
		genericSections('父卡 A01。'),
	),
	card(
		{
			id: 'C01',
			title: '子卡 C01（取代 / 相关）',
			status: TaskState.WORKING,
			ref: 'demo',
			kind: 'work',
			domain: '核心',
			created: at(11, 18, 9, 6),
			last: at(11, 18, 9, 41),
			parent: 'A01',
		},
		genericSections('被 A01 取代 + 与 A01 相关。'),
	),
	card(
		{
			id: 'D01',
			title: '根卡 D01（约束 / 参考）',
			status: TaskState.SUBMITTED,
			ref: 'delivery',
			kind: 'record',
			domain: '核心',
			created: at(11, 18, 9, 7),
			last: at(11, 18, 9, 42),
		},
		genericSections('被 A01 约束 + 被 A01 参考。'),
	),
]);

/* ══════════════════════════════════════════════════════════════
 * 小夹具：环
 * ══════════════════════════════════════════════════════════════ */

/** parent 成环：两张卡互相当父卡 ⇒ 落第 0 层 + 两条 ▲ 警告（不死循环、不丢卡）。 */
export const CYCLE_CARDS: readonly Card[] = Object.freeze([
	card(
		{
			id: 'CY01',
			title: '环上的卡 A',
			status: TaskState.WORKING,
			ref: 'decision',
			kind: 'design',
			domain: '核心',
			created: at(11, 18, 10, 0),
			last: at(11, 18, 10, 30),
			parent: 'CY02',
		},
		genericSections('parent = CY02。'),
	),
	card(
		{
			id: 'CY02',
			title: '环上的卡 B',
			status: TaskState.WORKING,
			ref: 'decision',
			kind: 'design',
			domain: '核心',
			created: at(11, 18, 10, 1),
			last: at(11, 18, 10, 31),
			parent: 'CY01',
		},
		genericSections('parent = CY01。'),
	),
	card(
		{
			id: 'CY03',
			title: '正常子卡（不被环连累）',
			status: TaskState.WORKING,
			ref: 'decision',
			kind: 'design',
			domain: '核心',
			created: at(11, 18, 10, 2),
			last: at(11, 18, 10, 32),
			parent: 'CY01',
		},
		genericSections('指向环但不在环上 ⇒ 按距环几步正常分层。'),
	),
]);
