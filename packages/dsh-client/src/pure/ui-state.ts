/**
 * UI 状态（科技树的「组」+「折叠态」）—— **纯函数**。
 *
 * ## 这里是什么
 *
 * 用户 `2026-11-24`：
 *
 * > 「组的范围。是要求有同一个父节点（或者父节点都是null），才能归一个组。」
 * > 「三出入口用同一的。内存都是一份数据。」
 * > 「组名可以不填。这样有了储存以后。一个卡是否折叠也存在后端。」
 *
 * ⇒ 「组」**不是卡**：AI 交互不了，也不进卡的数据模型。
 *   它只是浏览器 UI 的整理结构，存在 DSH 侧的 kv 里（`GET/PUT /api/ui-state`）。
 *
 * ## 为什么在 pure/
 *
 * 这份数据要经过网络边界（服务端回来的可能是旧版本 / 坏数据），
 * 解析必须能测。放 `.tsx` 里 Node 就加载不了 —— 那等于放弃测试。
 *
 * ## 不变量
 *
 * · 组 id 唯一
 * · **一张卡最多属于一个组**（位置唯一；否则同卡出现在两处）
 * · 组的成员必须是同一父节点的兄弟（或全是根卡）——
 *   ⚠ 这条由**调用方**用 `parentOf` 判，本文件不假设卡的结构
 */

/** 一个组。`name` 可省略（用户：「组名可以不填」）。 */
export interface TreeGroup {
	/** 稳定 id（前端生成）。 */
	readonly id: string;
	/** 组名；省略 = 没名字。 */
	readonly name?: string;
	/** 成员卡 id。 */
	readonly memberIds: readonly string[];
}

/** 一个工作空间的 UI 状态。 */
export interface UiStateData {
	readonly groups: readonly TreeGroup[];
	/** 折叠的卡 id + 组 id（两个集合共用；id 不会撞）。 */
	readonly folded: readonly string[];
	/**
	 * 用户**强制展开**的 id。
	 *
	 * ⚠ 默认折叠判据（全终结且无未读 ⇒ 自动折）是算出来的，光看 `folded`
	 *   分不出「用户没动过」和「用户手动展开了」。没有这个集合，
	 *   用户手动展开的节点会在下次打开面板时被默认判据又折回去。
	 */
	readonly expanded: readonly string[];
}

/** 空状态。 */
export const EMPTY_UI_STATE: UiStateData = Object.freeze({
	groups: Object.freeze([]),
	folded: Object.freeze([]),
	expanded: Object.freeze([]),
});

function isFilledString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

/** 从任意对象取字段。 */
function fieldOf(value: unknown, key: string): unknown {
	if (typeof value !== 'object' || value === null) return undefined;
	return (value as Record<string, unknown>)[key];
}

/**
 * 解析服务端 `data`（`{ groups, folded }`）。
 *
 * **任何不合形状的东西都当空 / 跳过**，绝不抛：这是 UI 状态，
 * 丢了顶多重新整理，抛出去会让整个面板打不开。
 */
export function parseUiState(data: unknown): UiStateData {
	if (typeof data !== 'object' || data === null) return EMPTY_UI_STATE;

	const rawGroups = fieldOf(data, 'groups');
	const rawFolded = fieldOf(data, 'folded');

	const groups: TreeGroup[] = [];
	const seenIds = new Set<string>();
	const seenMembers = new Set<string>();
	if (Array.isArray(rawGroups)) {
		for (const one of rawGroups) {
			const id = fieldOf(one, 'id');
			if (!isFilledString(id)) continue;
			if (seenIds.has(id.trim())) continue;
			const rawMembers = fieldOf(one, 'memberIds');
			if (!Array.isArray(rawMembers)) continue;

			const memberIds: string[] = [];
			for (const member of rawMembers) {
				if (!isFilledString(member)) continue;
				if (seenMembers.has(member.trim())) continue;
				seenMembers.add(member.trim());
				memberIds.push(member.trim());
			}

			const name = fieldOf(one, 'name');
			seenIds.add(id.trim());
			groups.push(
				isFilledString(name)
					? { id: id.trim(), name: name.trim(), memberIds }
					: { id: id.trim(), memberIds },
			);
		}
	}

	const folded: string[] = [];
	if (Array.isArray(rawFolded)) {
		for (const one of rawFolded) {
			if (!isFilledString(one)) continue;
			if (folded.includes(one.trim())) continue;
			folded.push(one.trim());
		}
	}

	const expanded: string[] = [];
	if (Array.isArray(fieldOf(data, 'expanded'))) {
		for (const one of fieldOf(data, 'expanded') as unknown[]) {
			if (!isFilledString(one)) continue;
			if (expanded.includes(one.trim())) continue;
			expanded.push(one.trim());
		}
	}

	return { groups, folded, expanded };
}

/** 折叠集合（查询用，O(1)）。 */
export function foldedSetOf(folded: readonly string[]): ReadonlySet<string> {
	return new Set(folded);
}

/** 这张卡属于哪个组（`undefined` = 未分组）。 */
export function groupOfCard(groups: readonly TreeGroup[], cardId: string): TreeGroup | undefined {
	return groups.find((one) => one.memberIds.includes(cardId));
}

/** 切换折叠态（加入 / 移出）。 */
export function withFoldedToggled(state: UiStateData, id: string): UiStateData {
	const folded = state.folded.includes(id)
		? state.folded.filter((one) => one !== id)
		: [...state.folded, id];
	return { groups: state.groups, folded, expanded: state.expanded };
}

/**
 * 显式折叠 / 展开一个节点。
 *
 * ⚠ 两个集合必须**互斥维护**：折叠 ⇒ 进 `folded`、出 `expanded`；
 *   展开 ⇒ 出 `folded`、进 `expanded`。只改一个会让三态优先级打架。
 *
 * @param folded 目标状态（`true` = 折叠，`false` = 展开）
 */
export function withFoldSetToggled(state: UiStateData, id: string, folded: boolean): UiStateData {
	const foldedIds = new Set(state.folded);
	const expandedIds = new Set(state.expanded);
	if (folded) {
		foldedIds.add(id);
		expandedIds.delete(id);
	} else {
		foldedIds.delete(id);
		expandedIds.add(id);
	}
	return { groups: state.groups, folded: [...foldedIds], expanded: [...expandedIds] };
}

/** 加一个组；id 撞了 ⇒ **原样返回**（幂等，不覆盖已有的）。 */
export function withGroupAdded(state: UiStateData, group: TreeGroup): UiStateData {
	if (state.groups.some((one) => one.id === group.id)) return state;
	/* 一张卡最多一个组 ⇒ 先把这些成员从别的组里摘掉。 */
	const members = new Set(group.memberIds);
	const groups = state.groups
		.map((one) => {
			const kept = one.memberIds.filter((id) => !members.has(id));
			return kept.length === one.memberIds.length ? one : { ...one, memberIds: kept };
		})
		.filter((one) => one.memberIds.length > 0 || one.id === group.id);
	return { groups: [...groups, group], folded: state.folded, expanded: state.expanded };
}

/** 删组；成员回到「未分组」。 */
export function withGroupRemoved(state: UiStateData, groupId: string): UiStateData {
	return {
		groups: state.groups.filter((one) => one.id !== groupId),
		/* 折叠集合里同 id 的也一并清掉，避免留垃圾。 */
		folded: state.folded.filter((one) => one !== groupId),
		expanded: state.expanded.filter((one) => one !== groupId),
	};
}

/** 改名 / 清空名字（`undefined` = 没名字，不是空串）。 */
export function withGroupRenamed(state: UiStateData, groupId: string, name: string | undefined): UiStateData {
	const next = name === undefined || name.trim() === '' ? undefined : name.trim();
	return {
		groups: state.groups.map((one) => {
			if (one.id !== groupId) return one;
			return next === undefined ? { id: one.id, memberIds: one.memberIds } : { id: one.id, name: next, memberIds: one.memberIds };
		}),
		folded: state.folded,
		expanded: state.expanded,
	};
}

/** 加成员（从别的组摘走；已在同组 ⇒ 原样）。 */
export function withMemberAdded(state: UiStateData, groupId: string, cardId: string): UiStateData {
	const target = state.groups.find((one) => one.id === groupId);
	if (target === undefined) return state;
	if (target.memberIds.includes(cardId)) return state;
	const groups = state.groups.map((one) => {
		if (one.id === groupId) return { ...one, memberIds: [...one.memberIds, cardId] };
		const kept = one.memberIds.filter((id) => id !== cardId);
		return kept.length === one.memberIds.length ? one : { ...one, memberIds: kept };
	});
	return { groups, folded: state.folded, expanded: state.expanded };
}

/** 移出成员；组空了 ⇒ 连同组一起删（否则会留一个空壳）。 */
export function withMemberRemoved(state: UiStateData, groupId: string, cardId: string): UiStateData {
	const groups: TreeGroup[] = [];
	for (const one of state.groups) {
		if (one.id !== groupId) {
			groups.push(one);
			continue;
		}
		const memberIds = one.memberIds.filter((id) => id !== cardId);
		if (memberIds.length === 0) continue;
		groups.push({ ...one, memberIds });
	}
	return { groups, folded: state.folded, expanded: state.expanded };
}

/**
 * 按现有卡清理：成员卡不在了 ⇒ 剔除；组空了 ⇒ 删组。
 *
 * ⚠ **不动的**：`folded`。折叠的是卡 id，卡暂时被筛掉不该丢折叠意愿
 * （用户切筛选来回切一次，折叠态不该全丢）。
 */
export function withMissingCardsPruned(state: UiStateData, existingCardIds: ReadonlySet<string>): UiStateData {
	const groups: TreeGroup[] = [];
	for (const one of state.groups) {
		const memberIds = one.memberIds.filter((id) => existingCardIds.has(id));
		if (memberIds.length === 0) continue;
		groups.push(memberIds.length === one.memberIds.length ? one : { ...one, memberIds });
	}
	if (groups.length === state.groups.length && groups.every((one, index) => one === state.groups[index])) return state;
	return { groups, folded: state.folded, expanded: state.expanded };
}

/**
 * 这些卡能不能归成一组：**同一个父节点，或全是根卡**。
 *
 * @param parentOf 卡 id → 父卡 id（`null` = 根卡，`undefined` = 这张卡不存在）
 *
 * 用户 `2026-11-24`：「组的范围。是要求有同一个父节点（或者父节点都是null），才能归一个组。」
 */
export function shareSameParent(
	cardIds: readonly string[],
	parentOf: (cardId: string) => string | null | undefined,
): boolean {
	if (cardIds.length === 0) return false;
	const first = parentOf(cardIds[0]!);
	if (first === undefined) return false;
	return cardIds.every((id) => parentOf(id) === first);
}

/** 给服务端 PUT 的 body（纯函数，便于断言「name 缺省时不写这个键」）。 */
export function toSaveBody(workspaceId: string, state: UiStateData): {
	readonly workspace: string;
	readonly groups: readonly TreeGroup[];
	readonly folded: readonly string[];
	readonly expanded: readonly string[];
} {
	return { workspace: workspaceId, groups: state.groups, folded: state.folded, expanded: state.expanded };
}
