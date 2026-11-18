/**
 * 左栏「关系 | 高级设置」的**判决**与关系行的纯操作 —— 零 React、零 DOM。
 *
 * ## 从哪来
 *
 * 用户 `2026-11-19` 从展厅的 6 个变体里选了 **⑤ 按钮 + 折叠区**：
 *
 * > 「用 245。也就是说跟旧版一样。」
 *
 * 对应的展厅实现是 `dev/pure/create-meta.ts` + `dev/components/create/MetaTabs.tsx`。
 * 本文件是它的产品化版本（类型对齐 `src/pure/create-types.ts` 的 `RelationDraft`）。
 *
 * ## 三值 `active` 而不是两个 boolean
 *
 * 用户原话（`2026-11-09`，旧版 `meta-panel.js`）：
 * > 「左边的元数据面板，在模板下面再加一个新的条『父任务』。然后再下面，放按钮
 * >  『关系』『高级设置』。这是标签按钮，点击以后在下面打开隐藏面板。」
 *
 * 两个 boolean 能表示「两个都开」—— **能表示非法状态的类型迟早会表示出非法状态**。
 * 三值之后，「互斥」和「再点已开的就收起」是同一个 `nextTab` 的必然结果，
 * 不需要额外代码，也不会漏。
 *
 * ## `supersedes` 不在这张表里（语义约束，不是「还没做」）
 *
 * 「取代」是 **fork 的产物**，不许手写进 `relations`（词法规则）。手写一条会让
 * 关系图出现两条互为取代的边，而 fork 产生的是单向的。
 *
 * ⚠ 这条**用差集断言钉住**（`test/create-meta.test.ts`）：协议新增一条边时测试变红，
 *   逼着人明确决定它能不能手写 —— 而不是悄悄出现在选择器里。
 */

import { LINK_KINDS, type LinkKindId } from '@taskboard/protocol';

import type { RelationDraft } from './create-types.ts';

/* ══════════════════════════════════════════════════════════
   关系类型词表
   ══════════════════════════════════════════════════════════ */

/**
 * **不许手写**的边 —— 目前只有「取代」。
 *
 * ⚠ 这是语义约束：取代由 fork 产生（单向、级联取消旧卡）。手写一条会让关系图
 *   出现两条互为取代的边。增加这个清单之前先问「它是不是只能由某个操作产生」。
 */
export const NOT_WRITEABLE_LINK_KINDS: readonly LinkKindId[] = Object.freeze([
	'supersedes' as LinkKindId,
]);

/** 关系选择器里的一项。 */
export interface WritableRelationKind {
	/** 协议名（`dependsOn` …）—— 提交时送的就是它。 */
	readonly id: string;
	/** 中文显示名（`依赖` …）。只给人看。 */
	readonly label: string;
}

/**
 * 关系选择器里能选的那几条 —— **从协议的 `LINK_KINDS` 派生**，不手抄。
 *
 * 手抄一份的代价是「协议加了边、UI 少了这个选项」，而那种漂移**不报错**。
 * 派生之后新增的边自动出现，再由测试提醒复核（见 `test/create-meta.test.ts`）。
 */
export const RELATION_KINDS: readonly WritableRelationKind[] = Object.freeze(
	LINK_KINDS.filter((one) => !NOT_WRITEABLE_LINK_KINDS.includes(one.id)).map((one) => ({
		id: one.id,
		label: one.displayName,
	})),
);

/** 默认选中的关系类型（第一项 = 依赖）。 */
export const DEFAULT_RELATION_KIND: string = RELATION_KINDS[0]?.id ?? 'dependsOn';

/* ══════════════════════════════════════════════════════════
   三值 active
   ══════════════════════════════════════════════════════════ */

/** 左栏折叠面板的标签。 */
export type MetaTab = 'rel' | 'adv';

/**
 * 点一下标签按钮之后应该变成什么。
 *
 * **再点已开的那个 = 收起**（返回 `null`）；点另一个 = 直接切过去。
 * 「互斥」和「可收起」都在这一个函数里，没有第二处状态。
 *
 * @param current 当前激活的标签（`null` = 都收起）
 * @param clicked 被点的标签
 */
export function nextTab(current: MetaTab | null, clicked: MetaTab): MetaTab | null {
	return current === clicked ? null : clicked;
}

/**
 * 关系面板是否展开。
 *
 * @param current 当前激活的标签
 */
export function isRelOpen(current: MetaTab | null): boolean {
	return current === 'rel';
}

/**
 * 高级设置面板是否展开。
 *
 * @param current 当前激活的标签
 */
export function isAdvOpen(current: MetaTab | null): boolean {
	return current === 'adv';
}

/* ══════════════════════════════════════════════════════════
   关系行操作 —— 全部返回新数组
   ══════════════════════════════════════════════════════════ */

/**
 * 加一行空关系（类型默认「依赖」，目标待选）。
 *
 * ⚠ 空行**不算一条关系**（`relationCountOf` 只数选了目标的）——
 *   所以点「添加」不会让「关系 N」的数字变。这是用户确认过的口径。
 *
 * @param rows 原关系行
 */
export function addRelation(rows: readonly RelationDraft[]): readonly RelationDraft[] {
	return [...rows, { label: DEFAULT_RELATION_KIND, to: '' }];
}

/**
 * 删掉一行。
 *
 * ⚠ 纯函数而不是 `splice` —— 「删了之后计数跟着变」变成**必然**（重新算），
 *   而不是靠调用方记得刷新。旧版是手动 `syncCount()`，漏一处数字就不对。
 *
 * @param rows 原关系草稿
 * @param index 要删的下标（越界时原样返回）
 */
export function removeRelationAt(
	rows: readonly RelationDraft[],
	index: number,
): readonly RelationDraft[] {
	if (index < 0 || index >= rows.length) return rows;
	return rows.filter((_one, i) => i !== index);
}

/**
 * 改某一行的目标卡。
 *
 * @param rows 原关系草稿
 * @param index 行下标（越界时原样返回）
 * @param to 新目标卡 id（空串 = 清空）
 */
export function setRelationTarget(
	rows: readonly RelationDraft[],
	index: number,
	to: string,
): readonly RelationDraft[] {
	if (index < 0 || index >= rows.length) return rows;
	return rows.map((one, i) => (i === index ? { ...one, to } : one));
}

/**
 * 改某一行的关系类型。
 *
 * @param rows 原关系草稿
 * @param index 行下标（越界时原样返回）
 * @param label 新的关系类型（协议名）
 */
export function setRelationKind(
	rows: readonly RelationDraft[],
	index: number,
	label: string,
): readonly RelationDraft[] {
	if (index < 0 || index >= rows.length) return rows;
	return rows.map((one, i) => (i === index ? { ...one, label } : one));
}
