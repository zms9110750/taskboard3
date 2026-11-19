/**
 * 关系折叠面板的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * ## 它回答「哪些卡、分在哪些组、落在哪一列」
 *
 * 旧版 `taskboard2/packages/browser/public/lib/relations.js`（236 行）把
 * 「建索引 + 组装视图」两件事写在一个函数里，且草稿过滤藏在渲染层。
 * 这里只保留**视图需要的那个结果**：
 *
 * ```
 * relationsOf(card, allCards, groupOf)
 *   ├ total        关系总数（**已剔除草稿**）
 *   ├ parentCard   父任务卡（**单独一个字段**，不在 groups 里）
 *   └ groups       按关系类型分组，每组带 byColumn（三列）
 * ```
 *
 * ## ⚠ 三条用户裁定（都来自原版注释，不是我们加的）
 *
 * 1. **草稿不能成为关系对象**（`【用户指令，2026-11-09 08:45】`）：
 *    > 「展开关系的列是不包含草稿的。草稿是不能成为关系的连接对象的。」
 *    ⇒ 在**本函数的组装层**剔除；`total` 跟着重算，否则按钮写 3、面板显示 2
 *      （原版 `relations.js:152-157` 明确说过这是「数字撒谎」）。
 * 2. **列 = status 的 `group`**（`active` / `shelved` / `ended`），不硬编码状态名。
 *    ⇒ 列名从 `@taskboard/protocol` 的 `GROUP_LABELS` 读，「进行/搁置/完成」只有一份真值。
 * 3. **父任务单独列出**，不进 `groups`、不占 `total` 的分子
 *    （原版 `relations-block.js:66-74`：卡头那一行显示「关系 N + 父任务卡」）。
 *
 * ## 为什么 `groupOf` 由调用方给
 *
 * 本文件**不 import 状态词表之外的任何东西**（尤其不 import store）。
 * 草稿判据在词表里，但「这张卡的 status 算哪个组」需要把卡上那个 `string`
 * 窄化成 `TaskState` —— 那个窄化在调用方（`statusGroupOf`，本文件也导出了）。
 * 测试可以传一个假的 `groupOf` 直接驱动三种落列，不需要构造真的协议状态。
 *
 * ## 关系类型的中文名 / 顺序从哪来
 *
 * `src/pure/card-view.ts` **没有**关系类型的词表（它只负责状态与分类）。
 * ⇒ 照原版 `taskboard2/packages/browser/public/lib/relations.js:118-125`
 *   的 `RELATION_GROUPS`（顺序 + label + 线色/底色），一格不改。见
 *   `RELATION_GROUP_DEFS` 的注释。
 */

import {
	GROUP_LABELS,
	groupOf,
	isTaskState,
	type LinkKindId,
	type StatusGroup,
} from '@taskboard/protocol';

import type { Card } from '../types.ts';

/* ══════════════════════════════════════════════════════════
   词表
   ══════════════════════════════════════════════════════════ */

/**
 * 关系类型 —— 父子这条边（`'parent'`）+ 五种 link。
 *
 * ⚠ `'parent'` 指的是**卡上 `relations.parent` 这条边**，组里装的是
 *   「谁把我当 parent」= **子任务**（原版 `RELATION_GROUPS[0]` 的 `children`）。
 *   名字叫 `parent` 是为了对齐 `Card.relations` 的字段（不另造一个词）。
 */
export type RelationKind = 'parent' | LinkKindId;

/**
 * 卡上的状态字段 —— 就是 A2A 状态全名（`TASK_STATE_*`）。
 *
 * 类型是 `string` 而不是 `TaskState`：服务端可能给脏数据，UI 不能因为
 * 一个不认识的状态就崩（原版 `store.stateOf()` 也是「查不到就回落」）。
 */
export type CardStatus = string;

/** 三列的 key —— **没有 `draft` 列**（草稿到不了渲染，第四列永空）。 */
export type RelationColumnKey = 'active' | 'shelved' | 'ended';

/** 一列的展示定义。 */
export interface RelationColumn {
	readonly group: RelationColumnKey;
	/** 中文名 —— 从 `GROUP_LABELS` 读，不硬编码。 */
	readonly label: string;
	/** 表头那个小圆点的颜色（原版 `relations-block.js:38-42`）。 */
	readonly color: string;
}

/**
 * 三列 —— 顺序就是「进行 / 搁置 / 完成」。
 *
 * - **组名**来自 `@taskboard/protocol` 的 `GROUP_LABELS`（词表唯一真值）。
 * - **颜色**照原版 `relations-block.js:38-42` 的 `RELATION_COLUMNS`。
 */
export const RELATION_COLUMNS: readonly RelationColumn[] = Object.freeze([
	{ group: 'active', label: GROUP_LABELS.active, color: '#2563eb' },
	{ group: 'shelved', label: GROUP_LABELS.shelved, color: '#f59e0b' },
	{ group: 'ended', label: GROUP_LABELS.ended, color: '#10b981' },
] as const satisfies readonly RelationColumn[]);

/**
 * 五种 link 的**中文名** —— 照原版 `relations.js:118-125` 的 label。
 *
 * ⚠ 用 `satisfies Record<LinkKindId, string>` 而不是类型标注：
 *   协议新增一种边时，这里**少一个键就编译失败**（AGENTS 3.7）。
 *   中文名**不是**从协议的 `LINK_KINDS[].displayName` 抄的 —— 那边是
 *   「依赖」，原版 UI 写的是「本项依赖」（用户看过的措辞），两个用途不同。
 */
const LINK_GROUP_LABELS = {
	dependsOn: '本项依赖',
	related: '相关',
	references: '参考',
	supersedes: '取代',
	constrains: '约束',
} as const satisfies Record<LinkKindId, string>;

/** 五种 link 的线色 / 底色 —— 同样照原版 `relations.js:118-125`。 */
const LINK_GROUP_COLORS = {
	dependsOn: { line: '#a16207', bg: '#fff7ed' },
	related: { line: '#15803d', bg: '#f0fdf4' },
	references: { line: '#6b7280', bg: '#f9fafb' },
	supersedes: { line: '#6d28d9', bg: '#faf5ff' },
	constrains: { line: '#b91c1c', bg: '#fef2f2' },
} as const satisfies Record<LinkKindId, { readonly line: string; readonly bg: string }>;

/**
 * link 组的**视觉语义顺序** —— 原版 `relations.js:106-119` 的注释：
 *
 * > `【Lead 决定，2026-11-09 00:35】`
 * > 组顺序按用户原话：「子任务/本项依赖/相关/参考」+ 后补「取代/约束」。
 * > **⇒ 这个顺序 = 视觉语义顺序，别按字典排。**
 *
 * ⚠ 协议 `LINK_KINDS` 的数组顺序是 `dependsOn / supersedes / constrains /
 *   related / references` —— **那是文档/遍历顺序，不是 UI 顺序**，
 *   所以这里必须手写一份顺序，不能 `.map(LINK_KINDS)`。
 */
const LINK_GROUP_ORDER = [
	'dependsOn',
	'related',
	'references',
	'supersedes',
	'constrains',
] as const satisfies readonly LinkKindId[];

/** 一个关系组的展示定义。 */
export interface RelationGroupDef {
	readonly rel: RelationKind;
	/** 中文名：子任务 / 本项依赖 / 相关 / 参考 / 取代 / 约束。 */
	readonly label: string;
	/** 组横条的线色。 */
	readonly line: string;
	/** 组横条的底色。 */
	readonly bg: string;
}

/**
 * 六个关系组 —— **顺序 + 中文名 + 颜色**照原版 `relations.js:118-125`。
 *
 * 第一组是父子边（组里是「子任务」），后面五组按 `LINK_GROUP_ORDER`。
 * 渲染层只遍历这张表，**不自己再排一次**：顺序只有这一份真值。
 */
export const RELATION_GROUP_DEFS: readonly RelationGroupDef[] = Object.freeze([
	{ rel: 'parent', label: '子任务', line: '#5b6472', bg: '#f9fafb' },
	...LINK_GROUP_ORDER.map((rel) => ({
		rel,
		label: LINK_GROUP_LABELS[rel],
		line: LINK_GROUP_COLORS[rel].line,
		bg: LINK_GROUP_COLORS[rel].bg,
	})),
]);

/* ══════════════════════════════════════════════════════════
   视图
   ══════════════════════════════════════════════════════════ */

/** 三列里的卡 —— 组件按它画「进行 / 搁置 / 完成」三列。 */
export interface RelationColumnsView {
	readonly active: readonly Card[];
	readonly shelved: readonly Card[];
	readonly ended: readonly Card[];
}

/** 一个关系组（组横条 + 组内卡）。 */
export interface RelationGroupView {
	/** 关系类型（`'parent'` 或五种 link 之一）。 */
	readonly rel: RelationKind;
	/** 中文名（**唯一来源** `RELATION_GROUP_DEFS`）。 */
	readonly label: string;
	/** 组横条的线色。 */
	readonly line: string;
	/** 组横条的底色。 */
	readonly bg: string;
	/** 组内卡数（**已剔除草稿**）。 */
	readonly count: number;
	/** 组内全部卡（**已剔除草稿**，按「出边在前、入边在后」）。 */
	readonly cards: readonly Card[];
	/** 组内卡按 status 的组落列。 */
	readonly byColumn: RelationColumnsView;
}

/** 整块关系视图。 */
export interface RelationsView {
	/** 关系总数 —— 六个组的卡数之和（**父任务不算**，它单独一个字段）。 */
	readonly total: number;
	/** 父任务卡；`null` = 没父任务（或父卡是草稿/不在本空间）。 */
	readonly parentCard: Card | null;
	/** 非空的关系组，顺序 = `RELATION_GROUP_DEFS`；**空组不出现**。 */
	readonly groups: readonly RelationGroupView[];
}

/* ══════════════════════════════════════════════════════════
   实现
   ══════════════════════════════════════════════════════════ */

/**
 * 状态字符串 → status 组。
 *
 * 未知状态回落 `'active'`（**看得见**比悄悄消失好；原版
 * `relations-block.js:131-138` 的 `columnOf` 也是回落 `'active'`）。
 *
 * ⚠ 回落值选 `active` 而不是 `draft`：`draft` 会让这张卡被「草稿不能成为
 *   关系对象」的规则**过滤掉** —— 一个脏状态不应该让卡凭空消失。
 *
 * @param status 卡上的状态字符串
 */
export function statusGroupOf(status: CardStatus): StatusGroup {
	return isTaskState(status) ? groupOf(status) : 'active';
}

/**
 * 卡落哪一列（按 status 的组）。
 *
 * ⚠ 草稿**不会**走到这里（`relationsOf` 已剔除）⇒ 没有 `'draft'` 分支。
 *   兜底 `active` 只是为了让类型收敛，不是「草稿落进行列」的语义。
 *
 * @param card 卡
 * @param groupOfStatus 状态 → 组
 */
function columnOf(card: Card, groupOfStatus: (status: CardStatus) => StatusGroup): RelationColumnKey {
	const group = groupOfStatus(card.status);
	if (group === 'shelved') return 'shelved';
	if (group === 'ended') return 'ended';
	return 'active';
}

/** 往 `Map<string, T[]>` 里追加一项（没有就建数组）。 */
function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
	const list = map.get(key);
	if (list === undefined) map.set(key, [value]);
	else list.push(value);
}

/**
 * 去重 + 剔除 `undefined` + 剔除草稿。
 *
 * ⚠ 三种情况都会遇到：
 *   · `undefined` —— 目标卡不在本空间（已删除 / 关系指向别的空间）；
 *   · 重复 —— `related` 是双向边，出边和入边会撞同一张卡；
 *   · 草稿 —— 用户 `2026-11-09 08:45` 裁定不能成为关系对象。
 *
 * @param list 原始卡列表（可能含 `undefined` / 重复 / 草稿）
 * @param groupOfStatus 状态 → 组
 */
function visible(
	list: readonly (Card | undefined)[],
	groupOfStatus: (status: CardStatus) => StatusGroup,
): readonly Card[] {
	const seen = new Set<string>();
	const out: Card[] = [];
	for (const one of list) {
		if (one === undefined) continue;
		if (seen.has(one.id)) continue;
		seen.add(one.id);
		if (groupOfStatus(one.status) === 'draft') continue;
		out.push(one);
	}
	return out;
}

/**
 * 算一张卡的「关系」视图 —— 关系面板唯一的入口。
 *
 * ## 关系方向（照原版 `relations.js:190-212`）
 *
 * | 组 | 方向 |
 * |---|---|
 * | `parent`（子任务）| **只有入边**：谁 `relations.parent === card.id` |
 * | `related` | 出边 + 入边**算同一批**（`direction: 'both'`，只出现一次） |
 * | 其余 link | 出边（我指向谁）+ 入边（谁指向我）都算 |
 *
 * 去重之后「related 出现两次」自然消掉，所以不需要单独特判 `related`。
 *
 * @param card 当前卡
 * @param allCards 当前空间的**全部**卡（含草稿、不含墓碑）
 * @param groupOfStatus 状态 → 组（见 `statusGroupOf`）
 */
export function relationsOf(
	card: Card,
	allCards: readonly Card[],
	groupOfStatus: (status: CardStatus) => StatusGroup,
): RelationsView {
	/** id → 卡（目标解析用；不在本空间就是 `undefined`）。 */
	const byId = new Map<string, Card>();
	for (const one of allCards) byId.set(one.id, one);

	/* ── 反查索引：入边（谁指向我）/ 出边（我指向谁）/ 子任务（谁把我当 parent） ── */

	/** 出边：本卡某个 label 指向的目标卡（可能 `undefined`）。 */
	const outByLabel = new Map<string, (Card | undefined)[]>();
	/** 入边：某个 label 指向本卡的来源卡。 */
	const inByLabel = new Map<string, Card[]>();
	/** 子任务：`relations.parent === card.id` 的卡。 */
	const children: Card[] = [];

	for (const one of allCards) {
		if (one.relations.parent === card.id) children.push(one);
		for (const link of one.relations.links) {
			if (typeof link.to !== 'string' || link.to === '') continue;
			if (typeof link.label !== 'string' || link.label === '') continue;
			if (one.id === card.id) pushTo(outByLabel, link.label, byId.get(link.to));
			if (link.to === card.id) pushTo(inByLabel, link.label, one);
		}
	}

	/* ── 按组装卡 ── */

	const groups: RelationGroupView[] = [];

	for (const def of RELATION_GROUP_DEFS) {
		let members: readonly Card[];
		if (def.rel === 'parent') {
			/* 子任务 = 入边：谁把我当 parent。**只有入边**，不出现在别的组。 */
			members = visible(children, groupOfStatus);
		} else {
			/*
			 * 其余 link：出边 + 入边都算。
			 * `related` 的 `direction` 是 `both` ⇒ 两边算同一批，
			 * 去重（`visible` 里）之后只出现一次。
			 */
			members = visible(
				[...(outByLabel.get(def.rel) ?? []), ...(inByLabel.get(def.rel) ?? [])],
				groupOfStatus,
			);
		}

		/* 空组不渲染（原版 `relations.js:213-214`）。 */
		if (members.length === 0) continue;

		const byColumn: Record<RelationColumnKey, Card[]> = { active: [], shelved: [], ended: [] };
		for (const member of members) byColumn[columnOf(member, groupOfStatus)].push(member);

		groups.push({
			rel: def.rel,
			label: def.label,
			line: def.line,
			bg: def.bg,
			count: members.length,
			cards: members,
			byColumn: { active: byColumn.active, shelved: byColumn.shelved, ended: byColumn.ended },
		});
	}

	const total = groups.reduce((sum, one) => sum + one.count, 0);

	/*
	 * 父任务 chip 也是「关系的连接对象」⇒ 同样过滤草稿。
	 *
	 * ⚠ 正常不会有草稿父卡（core 的关系目标校验挡着），但**历史遗留 / 外部写入**
	 *   可能造出来（原版 `relations.js:218-232` 实测过）。按用户规则隐藏，
	 *   不声称这张卡「没有父任务」以外的东西 —— 也不给它设计标红 UI。
	 */
	const parentId = typeof card.relations.parent === 'string' ? card.relations.parent : '';
	const rawParent = parentId === '' ? undefined : byId.get(parentId);
	const parentCard = rawParent === undefined || groupOfStatus(rawParent.status) === 'draft'
		? null
		: rawParent;

	return { total, parentCard, groups };
}
