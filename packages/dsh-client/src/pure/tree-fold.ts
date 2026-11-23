/**
 * 科技树的「子树折叠」—— **纯函数**。
 *
 * ## 用户规则（`2026-11-24` 原话）
 *
 * > 「添加一个折叠和展开的功能。然后如果一个目标是终结态。那么打开这个面板的时候就折叠这个目标。」
 * > 「然后折叠是一整个子树。但是子树可能还有这样的折叠节点。他们还可以继续折叠
 * >  （就是打开了根树以后还得点这个节点进行打开）。就像vs开东西一样。」
 * > 「用你说的那三个条件。」
 *
 * 三个条件（同时成立才**默认**折叠）：
 *
 * 1. 节点自己是终结态（成功 / 失败 / 取消 / 拒绝）
 * 2. 它**所有后代**都是终结态
 * 3. 子树内**没有用户未读**的卡
 *
 * 另外两条必要限定：
 *
 * 4. 没有子卡的节点不折叠 —— 没有可折的东西
 * 5. 在「强制展开」集合里的节点不折叠 —— 用户手动展开过，压过默认判据
 *
 * ## 三态优先级
 *
 * ```
 * ① 在 expanded 里  ⇒ 强制展开（压过默认判据）
 * ② 在 folded 里    ⇒ 折叠
 * ③ 都不在          ⇒ 按上面 1~4 的默认判据算
 * ```
 *
 * ## 折叠是整棵子树，且逐层
 *
 * 折叠一个节点 ⇒ 它的所有后代都不参与布局（`hidden`）；
 * 展开它 ⇒ **只展开这一层**：直接子卡出现，子卡自己若仍是折叠的就继续保持折叠。
 * 这就是 VS 那样「命名空间 → 类 → 区域 → 方法」一层层点开。
 */

/** 折叠判据需要的最小节点信息。 */
export interface FoldableNode {
	readonly id: string;
	/** 父卡 id；`null` = 根卡。 */
	readonly parent: string | null;
	/** 是不是终结态（成功 / 失败 / 取消 / 拒绝）。 */
	readonly ended: boolean;
	/** 这张卡上的「用户未读」标记。 */
	readonly userUnread: boolean;
}

/** 算出来的折叠状态。 */
export interface TreeFoldState {
	/** 有子卡、因此**可以**折叠的节点。 */
	readonly foldable: ReadonlySet<string>;
	/** **当前生效**的折叠节点（用户折叠 + 默认判据，减去强制展开）。 */
	readonly folded: ReadonlySet<string>;
	/** 后代数量（不含自己）；「N 张」徽标用它。 */
	readonly descendantCount: ReadonlyMap<string, number>;
	/** 被某个折叠祖先盖住、因此**不参与布局**的卡。 */
	readonly hidden: ReadonlySet<string>;
	/** 参与布局的卡（含折叠节点自己）。 */
	readonly visible: ReadonlySet<string>;
}

/** 空状态（没有卡时用）。 */
export const EMPTY_TREE_FOLD: TreeFoldState = Object.freeze({
	foldable: new Set<string>(),
	folded: new Set<string>(),
	descendantCount: new Map<string, number>(),
	hidden: new Set<string>(),
	visible: new Set<string>(),
});

/**
 * 算一棵树的折叠状态。
 *
 * @param nodes 全部节点（父不存在的按根卡处理，不制造假孤儿）
 * @param foldedIds 用户**显式折叠**的 id
 * @param expandedIds 用户**显式展开**的 id（压过默认判据）
 */
export function treeFoldOf(
	nodes: readonly FoldableNode[],
	foldedIds: readonly string[],
	expandedIds: readonly string[],
): TreeFoldState {
	if (nodes.length === 0) return EMPTY_TREE_FOLD;

	const byId = new Map<string, FoldableNode>();
	for (const node of nodes) byId.set(node.id, node);

	/* 父不存在的别当孤儿：`parentEdge(子) = min(父)`，假的父会让整棵树漂。 */
	const childrenOf = new Map<string, string[]>();
	const roots: string[] = [];
	for (const node of nodes) {
		const parent = node.parent === null ? undefined : byId.get(node.parent);
		if (parent === undefined) {
			roots.push(node.id);
			continue;
		}
		const list = childrenOf.get(parent.id);
		if (list === undefined) childrenOf.set(parent.id, [node.id]);
		else list.push(node.id);
	}

	const foldedUser = new Set(foldedIds);
	const expanded = new Set(expandedIds);

	/* ── ① 后序：后代数 / 是否全终结 / 子树内有未读 ── */
	const descendantCount = new Map<string, number>();
	const allEnded = new Map<string, boolean>();
	const anyUnread = new Map<string, boolean>();
	/** 已访问集合：脏数据里若有环，不要死循环（卡关系理论上无环，但不假设）。 */
	const state = new Map<string, 0 | 1 | 2>();

	const visit = (id: string): { count: number; ended: boolean; unread: boolean } => {
		const cached = state.get(id);
		if (cached === 2) {
			return { count: descendantCount.get(id) ?? 0, ended: allEnded.get(id) ?? false, unread: anyUnread.get(id) ?? false };
		}
		if (cached === 1) {
			/* 环：把这条边当断开的，避免无限递归。 */
			return { count: 0, ended: byId.get(id)?.ended ?? false, unread: byId.get(id)?.userUnread ?? false };
		}
		state.set(id, 1);
		let count = 0;
		let ended = byId.get(id)?.ended ?? false;
		let unread = byId.get(id)?.userUnread ?? false;
		for (const childId of childrenOf.get(id) ?? []) {
			const sub = visit(childId);
			count += 1 + sub.count;
			ended = ended && sub.ended;
			unread = unread || sub.unread;
		}
		descendantCount.set(id, count);
		allEnded.set(id, ended);
		anyUnread.set(id, unread);
		state.set(id, 2);
		return { count, ended, unread };
	};
	for (const id of roots) visit(id);
	/* 环上的节点不会被 root 遍历到 ⇒ 补一次，保证每个节点都有数。 */
	for (const node of nodes) if (!state.has(node.id)) visit(node.id);

	/* ── ② 默认判据 + 三态优先级 ── */
	const foldable = new Set<string>();
	const folded = new Set<string>();
	for (const node of nodes) {
		const hasChildren = (childrenOf.get(node.id)?.length ?? 0) > 0;
		if (!hasChildren) continue;
		foldable.add(node.id);

		/* expanded 压过一切。 */
		if (expanded.has(node.id)) continue;
		if (foldedUser.has(node.id)) {
			folded.add(node.id);
			continue;
		}
		/* 默认判据：全终结 + 无未读（自己已经含在 allEnded / anyUnread 里）。 */
		if ((allEnded.get(node.id) ?? false) && !(anyUnread.get(node.id) ?? false)) {
			folded.add(node.id);
		}
	}

	/* ── ③ 被折叠盖住的卡 ── */
	const hidden = new Set<string>();
	const hideDescendants = (id: string): void => {
		for (const childId of childrenOf.get(id) ?? []) {
			if (hidden.has(childId)) continue;
			hidden.add(childId);
			hideDescendants(childId);
		}
	};
	for (const id of folded) hideDescendants(id);

	const visible = new Set<string>();
	for (const node of nodes) if (!hidden.has(node.id)) visible.add(node.id);

	return { foldable, folded, descendantCount, hidden, visible };
}

/** 折叠节点上「N 张」的 N（后代数量，不含自己）。 */
export function badgeCountOf(state: TreeFoldState, id: string): number {
	return state.descendantCount.get(id) ?? 0;
}
