/**
 * 兄弟归组 —— 纯逻辑。
 *
 * ## 组的作用域（用户 `2026-11-24` 裁定）
 *
 * > 「组的范围。是要求有同一个父节点（或者父节点都是null），才能归一个组。」
 *
 * ⇒ 组是**兄弟集合的再分组**：成员必须是同一父节点的子卡，或者全是根卡（父 = null）。
 *   这条约束推出两个必然结果：**组不能嵌套**、**一张卡最多在一个组里**。
 *
 * ## 组只影响布局
 *
 * 组不进卡数据、不进 `/api/state`、AI 与 MCP 拿不到（存储在 `ui.groups.<workspaceId>`，
 * 只有浏览器 UI 读写的 `ui-state` 端点）。所以这里**不碰 Card**，只吃 `parent` 一个字段。
 *
 * ## 为什么单独一个文件
 *
 * `TechTree` / `Workspace` / `SiblingRelationPanel` 三处都要用同一套判据；
 * 放组件里会让 Node 无法直接跑测试（`.tsx` 不被 `node --test` 认）。
 */

import type { TreeGroup } from './ui-state.ts';
import { shareSameParent } from './ui-state.ts';

/** 归组需要的最小卡信息（不依赖完整 `Card`，便于测试）。 */
export interface GroupableCard {
	readonly id: string;
	readonly title: string;
	/** 派生父卡 id；`null` = 根卡。 */
	readonly parent: string | null;
}

/** 校验结果。失败时带给人看的中文原因。 */
export type GroupCheck = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** 把卡列表变成「id → 父」。 */
export function parentLookupOf(
	cards: readonly GroupableCard[],
): (cardId: string) => string | null | undefined {
	const byId = new Map<string, string | null>();
	for (const card of cards) byId.set(card.id, card.parent);
	return (cardId) => byId.get(cardId);
}

/** 某父下的兄弟卡（`parentId = null` ⇒ 根卡）。顺序保持传入顺序。 */
export function siblingsOf(
	cards: readonly GroupableCard[],
	parentId: string | null,
): readonly GroupableCard[] {
	return cards.filter((card) => card.parent === parentId);
}

/** 一个组的成员卡；成员里混了别的父的（数据脏）⇒ 只保留同父的那些。 */
export function membersOf(
	cards: readonly GroupableCard[],
	group: TreeGroup,
	parentId: string | null,
): readonly GroupableCard[] {
	const byId = new Map(cards.map((card) => [card.id, card]));
	const out: GroupableCard[] = [];
	for (const id of group.memberIds) {
		const card = byId.get(id);
		if (card !== undefined && card.parent === parentId) out.push(card);
	}
	return out;
}

/**
 * 某个父下的组。
 *
 * ⚠ 判据是「成员实际都挂在这个父下」，不是「组里记的父」——
 *   卡的父可能被别处改掉，只认现在的数据。
 */
export function groupsOfParent(
	cards: readonly GroupableCard[],
	groups: readonly TreeGroup[],
	parentId: string | null,
): readonly TreeGroup[] {
	return groups.filter((group) => membersOf(cards, group, parentId).length > 0);
}

/** 某个父下**还没进组**的卡。 */
export function ungroupedSiblings(
	cards: readonly GroupableCard[],
	groups: readonly TreeGroup[],
	parentId: string | null,
): readonly GroupableCard[] {
	const taken = new Set<string>();
	for (const group of groups) for (const id of group.memberIds) taken.add(id);
	return siblingsOf(cards, parentId).filter((card) => !taken.has(card.id));
}

/**
 * 这些卡能不能归成一组。
 *
 * 三条：① 至少两张 ② 都存在 ③ 同一个父（或全是根卡）。
 */
export function checkGroupMembers(
	cards: readonly GroupableCard[],
	cardIds: readonly string[],
): GroupCheck {
	if (cardIds.length < 2) return { ok: false, message: '至少选两张卡才能成组。' };
	const parentOf = parentLookupOf(cards);
	for (const id of cardIds) {
		if (parentOf(id) === undefined) return { ok: false, message: `卡「${id}」不存在。` };
	}
	if (!shareSameParent(cardIds, parentOf)) {
		return { ok: false, message: '这些卡不在同一个父卡下（或不全是没有父卡的根卡），不能归成一组。' };
	}
	return { ok: true };
}

/** 组给人看的名字：有名字用名字，没名字用「组 N」（N 从 1 起）。 */
export function groupLabelOf(group: TreeGroup, index: number): string {
	const name = group.name ?? '';
	return name === '' ? `组 ${String(index + 1)}` : name;
}

/** 生成一个不会撞的组 id（纯函数，便于测试）。 */
export function nextGroupIdOf(groups: readonly TreeGroup[]): string {
	const used = new Set(groups.map((group) => group.id));
	let n = 1;
	while (used.has(`g${String(n)}`)) n += 1;
	return `g${String(n)}`;
}

/** 折叠中的组 ⇒ 需要藏起来的成员 id。 */
export function hiddenByFoldedGroups(
	groups: readonly TreeGroup[],
	folded: ReadonlySet<string>,
): ReadonlySet<string> {
	const hidden = new Set<string>();
	for (const group of groups) {
		if (!folded.has(group.id)) continue;
		for (const id of group.memberIds) hidden.add(id);
	}
	return hidden;
}

/** 树里该画成「组节点」的那些组：折叠中、且成员至少有一张在这个空间里。 */
export function collapsedGroupsOf(
	cards: readonly GroupableCard[],
	groups: readonly TreeGroup[],
	folded: ReadonlySet<string>,
): readonly TreeGroup[] {
	const present = new Set(cards.map((card) => card.id));
	return groups.filter(
		(group) =>
			folded.has(group.id) && group.memberIds.some((id) => present.has(id)),
	);
}
