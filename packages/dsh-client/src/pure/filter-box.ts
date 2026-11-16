/**
 * 筛选方框的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * ## 这是一个**面包屑导航**
 *
 * 用户 `2026-11-16`：
 * > 「你不知道面包屑导航吗？我说的是点到谁就选中谁。点到完成，就选中完成。
 * >  那么完成的子级的选中就要取消掉。列出『完成』的子项。」
 * > 「除此以外，只展示两个层级。」
 * > 「比如选中了 1/2/3/2/4，那么就要这样列出 1/2/3/2 | 1 / 2 / 3 / 4 | 1 / 2 / 3」
 *
 * ⇒ 一个方框里永远是**三段**：
 *
 * ```
 *   ①面包屑（祖先）   ②当前层的兄弟（含选中）   ③选中项的children
 *   1/2/3/2      |    1 / 2 / 3 / 4       |    1 / 2 / 3
 *   紧斜杠               空格斜杠                空格斜杠
 * ```
 *
 * · ① 是 `path` 去掉最后一项的祖先链（紧斜杠 `/`，**每一段可点**，点了就跳回那层）；
 * · ② 是**当前选中项所在层的全部兄弟**（空格斜杠 ` / `，选中的那个高亮）；
 * · ③ 是**当前选中项的子节点**（空格斜杠 ` / `，一个都没选 —— 选了就下探）；
 * · **只画这两个可点层**（②③）。爷爷辈不再展开成选项，只以面包屑形式存在。
 *
 * ## 选中 = 一条路径
 *
 * `picked` 是**从根往下的完整路径**（不是「组 + 叶子」两段）。
 *
 * | 操作 | 结果 |
 * |---|---|
 * | 点②里某个兄弟 | `picked` = 它的祖先 + 它自己（**兄弟下面那层全丢掉**）|
 * | 点③里某个子 | `picked` = 当前路径 + 它（下探一层）|
 * | 点①里某个面包屑段 | `picked` 截断到那一段（跳回上层）|
 * | 点标题 | `picked` = 空（全部清空）|
 *
 * ⇒ **统一规则：点谁 = 选中谁，并把比它深的全丢掉。** 没有第二种语义。
 *
 * ## 为什么「点组也要选中」
 *
 * 上一版把第 0 级当成「不是一个值」，点它只清空选择。
 * 用户明确否定了：
 * > 「点到完成，就选中完成。那么完成的子级的选中就要取消掉。列出『完成』的子项。」
 *
 * ⇒ 组就是一个普通节点。点它就是选中它（于是它的子级被丢掉、它的子级被列出来）。
 */

/** 一个可选节点。有 `children` 的就是能下探的节点。 */
export interface FilterNode {
	readonly value: string;
	readonly label: string;
	/** 子节点。缺省或空数组 = 叶子。 */
	readonly children?: readonly FilterNode[];
}

/**
 * 选中路径 —— 从根往下的 value 序列。
 *
 * ⚠ 空数组 = 什么都没选。**不要用 `undefined` 表示没选**（调用方要多一支分支）。
 */
export type Picked = readonly string[];

/** 一条面包屑：祖先链上的一段。 */
export interface Crumb {
	readonly value: string;
	readonly label: string;
	/** 点它之后应该变成的路径（= 截断到这里的路径）。 */
	readonly next: Picked;
}

/** 一个可点的选项。 */
export interface OptionView {
	readonly value: string;
	readonly label: string;
	/** 是不是当前选中的那个。 */
	readonly picked: boolean;
	/** 还有子节点（能继续下探）。 */
	readonly hasChildren: boolean;
	/** 点它之后的路径。 */
	readonly next: Picked;
}

/**
 * 一个方框要画的东西。
 *
 * 永远是这三段 —— 但 `crumbs` / `childLevel` 可能是空的。
 */
export interface FilterView {
	/** ① 祖先面包屑（不含当前选中项本身）。 */
	readonly crumbs: readonly Crumb[];
	/** ② 当前层的全部兄弟（含选中的那个）。 */
	readonly currentLevel: readonly OptionView[];
	/** ③ 当前选中项的 children（一个都没选）。 */
	readonly childLevel: readonly OptionView[];
}

/** 有没有子节点。 */
export function hasChildren(node: FilterNode): boolean {
	return node.children !== undefined && node.children.length > 0;
}

/**
 * 沿路径把节点找出来。
 *
 * @param nodes 根
 * @param picked 路径
 * @returns 路径上的每个节点（顺序同路径）；路径断了返回 `undefined`
 */
export function resolvePath(
	nodes: readonly FilterNode[],
	picked: Picked,
): readonly FilterNode[] | undefined {
	const out: FilterNode[] = [];
	let level: readonly FilterNode[] = nodes;

	for (const value of picked) {
		const hit = level.find((one) => one.value === value);
		if (hit === undefined) return undefined;
		out.push(hit);
		level = hit.children ?? [];
	}

	return out;
}

/**
 * 算出这三段。
 *
 * @param nodes 根
 * @param picked 当前路径
 */
export function viewOf(nodes: readonly FilterNode[], picked: Picked): FilterView {
	/* 没选：当前层就是根，没有面包屑、没有子层。 */
	if (picked.length === 0) {
		return {
			crumbs: [],
			currentLevel: nodes.map((node) => ({
				value: node.value,
				label: node.label,
				picked: false,
				hasChildren: hasChildren(node),
				next: [node.value],
			})),
			childLevel: [],
		};
	}

	const resolved = resolvePath(nodes, picked);
	if (resolved === undefined) {
		/* 路径脏了（数据变了）：当成没选，别让界面炸。 */
		return { crumbs: [], currentLevel: [], childLevel: [] };
	}

	const lastIndex = picked.length - 1;

	/* ① 面包屑：路径上除最后一项外的每一段，`next` = 截断到它。 */
	const crumbs: Crumb[] = [];
	for (let index = 0; index < lastIndex; index += 1) {
		const node = resolved[index];
		const value = picked[index];
		if (node === undefined || value === undefined) continue;
		crumbs.push({
			value,
			label: node.label,
			next: picked.slice(0, index + 1),
		});
	}

	/* ② 当前层的兄弟：选中项的父节点的 children（选中项在根时就是根）。 */
	const parentNode = lastIndex === 0 ? undefined : resolved[lastIndex - 1];
	const siblings: readonly FilterNode[] =
		parentNode === undefined ? nodes : (parentNode.children ?? []);
	const prefix = picked.slice(0, lastIndex);

	const currentLevel = siblings.map((node) => ({
		value: node.value,
		label: node.label,
		picked: node.value === picked[lastIndex],
		hasChildren: hasChildren(node),
		next: [...prefix, node.value],
	}));

	/* ③ 选中项的子。 */
	const selected = resolved[lastIndex];
	const childLevel = (selected?.children ?? []).map((node) => ({
		value: node.value,
		label: node.label,
		picked: false,
		hasChildren: hasChildren(node),
		next: [...picked, node.value],
	}));

	return { crumbs, currentLevel, childLevel };
}

/**
 * 收起态显示什么 —— **完整路径，拆成一段一段可点**。
 *
 * ## 用户 `2026-11-16`（第四次纠正）
 *
 * > 「我要的是，『进行』，可以点。『提交』，可以点。
 * >  不是『进行/提交』这一个按钮。明白没。面包屑导航。
 * >  每一层，虽然他写的是文字。但是文字都是可以单独点击的。」
 * > 「『进行』点了，就会变成选中『进行』，取消选择『提交』，列出进行的子项目。
 * >  点了『提交』，就会变成选中『提交』，列出提交的子项目。」
 *
 * ⇒ **收起态不是一串字符串，是一条面包屑**：每一段都是独立可点的，
 *   点第 i 段 = 把路径截断到第 i 段（＝选中它，丢掉它下面的）。
 *
 * ## 与展开态 ① 段的关系
 *
 * 展开态的 ① 只放**祖先**（因为当前层在 ② 里已经画了）；
 * 收起态没有 ②③，所以**整条路径全都要可点** —— 包括最后一段。
 *
 * @param nodes 根
 * @param picked 路径
 * @returns 每段一个 `{ value, label, next }`；`next` = 截断到这里的路径
 */
export function collapsedCrumbs(nodes: readonly FilterNode[], picked: Picked): readonly Crumb[] {
	if (picked.length === 0) return [];

	const resolved = resolvePath(nodes, picked);

	/* 路径脏了：用 value 当标签，保证「至少还能点」而不是显示空白。 */
	if (resolved === undefined) {
		return picked.map((value, index) => ({
			value,
			label: value,
			next: picked.slice(0, index + 1),
		}));
	}

	return resolved.map((node, index) => ({
		value: picked[index] as string,
		label: node.label,
		next: picked.slice(0, index + 1),
	}));
}

/**
 * 没有「选中」时的收起态文字（空串）。
 *
 * @param nodes 根
 * @param picked 路径
 */
export function selectionText(nodes: readonly FilterNode[], picked: Picked): string {
	return collapsedCrumbs(nodes, picked)
		.map((one) => one.label)
		.join('/');
}

/** 有没有任何选中。 */
export function hasSelection(picked: Picked): boolean {
	return picked.length > 0;
}

/**
 * 点②里的某个兄弟 / ③里的某个子 —— 统一就是「用 option 算好的 next」。
 *
 * 这个函数存在的意义是**给调用点一个明确的入口**，
 * 以及提醒：选中永远是一条路径，不是单个值。
 *
 * @param view 当前视图
 * @param value 被点的值（在 currentLevel 或 childLevel 里）
 * @returns 新路径；找不到返回原路径
 */
export function pickOf(view: FilterView, value: string): Picked {
	const hit =
		view.currentLevel.find((one) => one.value === value) ??
		view.childLevel.find((one) => one.value === value);
	return hit === undefined ? [] : hit.next;
}
