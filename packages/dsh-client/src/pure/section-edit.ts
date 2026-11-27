/**
 * 章节「能不能编辑」与「整份 content 怎么组装」的**纯逻辑**。
 *
 * ## 设计依据
 *
 * issue #10「卡具有行为」的渲染约定把一节分成三个阶段：
 *
 * | 阶段 | 卡处在哪 | text | ask | markdown |
 * |---|---|---|---|---|
 * | 可编辑 | 草稿（未采纳）/ 建卡 | 正文 + 灰字可改 | 编辑题目 | 源码框 + 预览 |
 * | 交互 | 已采纳（提交 / 处理中 / 搁置）| 输入框可编辑 | 点选 / 自填 / 重置 | 只读渲染 |
 * | 冻结 | 终结态（完成组）| 只读 | 展示选择 | 只读渲染 |
 *
 * lead `2026-11-28` 的裁定（#9 动机 1.i 用户侧闭环）在此基础上收窄一格：
 * **详情页的 markdown 章节永远只读** —— 详情不是建卡页，没有「编辑源码 + 预览」
 * 那一套（建卡页仍按 #10 走 `CreateFlow`）。text / ask 只在草稿与交互期可改，
 * 终态一律冻结。
 *
 * ## 为什么状态分组不在这里自造
 *
 * 「已采纳 / 终态」不是新词表，而是 `@taskboard/protocol` 的 `STATUS_GROUP_OF`
 * 四个组（`draft` / `active` / `shelved` / `ended`）。本文件只做一件事：
 * `ended` ⇒ 冻结，其余已知组 ⇒ 可编辑。
 * **未知状态 ⇒ 冻结**（保守：拿不准就不写库，免得把脏状态当草稿）。
 *
 * ## content 为什么在客户端组装
 *
 * `PATCH /cards/:id` 的 `content` 是**整份覆盖**（服务端按模板章节整体替换，
 * 见 `src/api.ts` 的 `patchCard`）。只发改过的那一章会把别的章节抹掉
 * ⇒ 提交前必须用「当前全部章节 + 本次改动」组装。组装规则住在这里，
 * 组件层与 store 都不重复算。
 */

import { STATUS_GROUP_OF, isTaskState } from '@taskboard/protocol';

import type { CardSection } from '../types.ts';
import type { SectionKind } from './section.ts';

/* ══════════════════════════════════════════════════════════
   一、能不能编辑
   ══════════════════════════════════════════════════════════ */

/**
 * 这个状态下的章节区**整体**能不能编辑。
 *
 * `draft` / `active` / `shelved` ⇒ `true`；`ended` ⇒ `false`。
 * **墓碑（`deleted`）⇒ `false`**：卡已删除，服务端连 `update` 都会回
 * `CARD_NOT_FOUND`（core 的 `update` 先查 `existing.deleted`），
 * 界面上就不该还给用户一个能点却写不进去的控件。
 * 未知状态 ⇒ `false`（保守冻结；见文件头）。
 *
 * @param status A2A 状态全名（`TASK_STATE_*`）
 * @param deleted 卡是不是墓碑（`Card.deleted`）
 */
export function sectionsEditableOf(status: string, deleted = false): boolean {
	if (deleted) return false;
	if (!isTaskState(status)) return false;
	return STATUS_GROUP_OF[status] !== 'ended';
}

/**
 * 某一章**这种内容**在这个状态下能不能编辑。
 *
 * - `markdown`：永远 `false`（lead 2026-11-28 裁定；建卡页另有路径）
 * - `unknown`：永远 `false`（没有编辑控件，不能假装能改）
 * - `text` / `ask`：跟着 `sectionsEditableOf()` —— 草稿与交互期可改，终态 / 墓碑冻结
 *
 * @param kind `sectionViewOf()` 判出的内容形态
 * @param status A2A 状态全名
 * @param deleted 卡是不是墓碑
 */
export function sectionEditableOf(
	kind: SectionKind,
	status: string,
	deleted = false,
): boolean {
	if (kind === 'markdown' || kind === 'unknown') return false;
	return sectionsEditableOf(status, deleted);
}

/* ══════════════════════════════════════════════════════════
   二、content 组装
   ══════════════════════════════════════════════════════════ */

/** 普通对象（排除 null / 数组）—— 与 `section.ts` 的同名判断同义，本文件不跨模块复用私有函数。 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * `Card.sections` → `PATCH /cards/:id` 的 `content`。
 *
 * 形状来自 core 的 `contentOfCard()`：**key = sectionId，value = payload**，
 * 不带 `label`（label 是卡上的副本，服务端按模板重建）。
 *
 * @param sections 卡上的全部章节
 */
export function contentOfSections(
	sections: Readonly<Record<string, CardSection>>,
): Readonly<Record<string, unknown>> {
	const content: Record<string, unknown> = {};
	for (const [sectionId, section] of Object.entries(sections)) {
		content[sectionId] = section.payload;
	}
	return content;
}

/**
 * 把一次内联编辑的 `patch` 合并进**一章**，返回新的 `sections`。
 *
 * - 只动 `sections[sectionId]`；其它章节**原引用返回**（React 能跳过重渲染）
 * - `label` 原样保留（模板副本，不由编辑决定）
 * - `payload` 不是对象时**不改**（返回原 map）—— 脏数据没有可合并的字段，
 *   由调用方把它当「这一章改不了」处理，而不是静默造一个半截 payload
 *
 * @param sections 卡上的全部章节
 * @param sectionId 要改的章节 id
 * @param patch 要合并进 payload 的字段
 */
export function sectionsWithPatch(
	sections: Readonly<Record<string, CardSection>>,
	sectionId: string,
	patch: Readonly<Record<string, unknown>>,
): Readonly<Record<string, CardSection>> {
	const target = sections[sectionId];
	if (target === undefined) return sections;
	if (!isRecord(target.payload)) return sections;

	return {
		...sections,
		[sectionId]: { ...target, payload: { ...target.payload, ...patch } },
	};
}
