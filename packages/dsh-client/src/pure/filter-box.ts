/**
 * 筛选方框的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * ## 语义（用户 `2026-11-16` 重新定义，推翻了旧版「再点一次取消」）
 *
 * > 在有东西选中时，点击那个选中的状态：展开到选中他（例如以后如果有4级，5级，
 * > 在点击第3级的时候，就展开3的子，并选中3）。点击最左边的组名时，展开并取消所有
 * > 选择（换句话说，组等于第0级，语义和点击第x级时选择第x级并展开第x的子是一样的逻辑）
 *
 * ⇒ **统一规则**：点第 N 级的节点 = 选中它 + 展开它的子（第 N+1 级）。
 *   第 0 级是**组**，点组 = 「选中第 0 级」= 没有筛选值 = 取消所有选择。
 *
 * | 点哪里 | 结果 |
 * |---|---|
 * | 组（第 0 级） | **清空选择**，展开这个组（它的子成为第 1 级）|
 * | 第 1 级节点 | 选中它；有子就展开第 2 级 |
 * | 第 N 级节点 | 选中它；有子就展开第 N+1 级 |
 * | 已选中的节点 | **再点不变**（幂等）—— 只是把它的子展开出来 |
 *
 * ⚠ **没有「再点一次取消」了。** 取消只有一个入口：点组名。
 *   旧版注释里的「再点同一项 = 取消」已被用户这条指令推翻。
 *
 * ## 为什么组不是筛选值
 *
 * 「组等于第0级」⇒ 第 0 级的语义是「层级起点」，不是「一个可筛的值」。
 * 所以 `picked` 为空时，这个方框**不产生任何筛选条件**。
 *
 * ## 层级是无限的
 *
 * 节点结构是递归的（`children`），`rowsOf()` 沿选中路径一路往下铺。
 * 现在只有两级（组 + 状态），但代码不假设级数 —— 加第三级只改数据，不改逻辑。
 *
 * ## 数据结构
 *
 * ```ts
 * 状态 ─┬─ 草稿   (grp) ── 未指定
 *       ├─ 进行   (grp) ── 提交 / 处理中
 *       ├─ 搁置   (grp) ── 需要信息 / 需要授权
 *       └─ 完成   (grp) ── 成功 / 失败 / 取消 / 拒绝
 * ```
 *
 * `group` 存「当前进入了哪个组」，`picked` 存「从组往下的选中路径」。
 * 二者合起来才能同时回答「展开哪几行」和「选中了什么」。
 */

/** 一个可选节点。有 `children` 的就是「组 / 中间层」，没有的是叶子。 */
export interface FilterNode {
	readonly value: string;
	readonly label: string;
	/** 子节点。缺省或空数组 = 叶子。 */
	readonly children?: readonly FilterNode[];
}

/**
 * 方框的完整状态。
 *
 * ⚠ **不要用单个 `picked` 数组兼任「展开哪个组」** —— 组不算筛选值，
 *   混在一起就分不清「点了组」和「选了叶子」。
 */
export interface FilterState {
	/** 已进入的组（第 0 级）。空串 = 没进入任何组（方框只显示标题）。 */
	readonly group: string;
	/** 从组往下的选中路径（第 1 级起）。空数组 = 没有任何筛选值。 */
	readonly picked: readonly string[];
}

/** 空状态：没进入组、没选任何值。 */
export const EMPTY_FILTER: FilterState = Object.freeze({
	group: '',
	picked: Object.freeze([]) as readonly string[],
});

/** 一个节点是否还有下一级。 */
export function hasChildren(node: FilterNode): boolean {
	return node.children !== undefined && node.children.length > 0;
}

/** 第 0 级：所有带子节点的节点（= 组）。保持原顺序。 */
export function groupsOf(nodes: readonly FilterNode[]): readonly FilterNode[] {
	return nodes.filter(hasChildren);
}

/** 这个方框有没有分组（没有的话就是「一层平铺」，跟旧版类别/领域一样）。 */
export function hasGroups(nodes: readonly FilterNode[]): boolean {
	return groupsOf(nodes).length > 0;
}

/**
 * 按路径找节点。
 *
 * @param nodes 根节点
 * @param path 从根往下的 value 序列
 * @returns 节点；路径断了返回 `undefined`
 */
export function findNode(
	nodes: readonly FilterNode[],
	path: readonly string[],
): FilterNode | undefined {
	let level: readonly FilterNode[] = nodes;
	let hit: FilterNode | undefined;
	for (const value of path) {
		hit = level.find((one) => one.value === value);
		if (hit === undefined) return undefined;
		level = hit.children ?? [];
	}
	return hit;
}

/** 一级要画的一项（**已算好「点它会变成什么」**）。 */
export interface FilterItemView {
	readonly value: string;
	readonly label: string;
	/** 它是不是当前选中的那个（叶子 / 路径上的某一项）。 */
	readonly picked: boolean;
	/**
	 * 它是不是**当前所在的分支**（组，或选中路径上的祖先）。
	 *
	 * 只用于视觉上标出「子节点属于谁」—— 不等于「选中」。
	 */
	readonly branch: boolean;
	/** 还有下一级。 */
	readonly hasChildren: boolean;
	/** 点它之后的完整状态。组件把整个对象交给 `onChange`。 */
	readonly next: FilterState;
}

/** 一行（一个层级）。 */
export interface FilterRow {
	/** 0 = 组行；1.. = 子级行。 */
	readonly level: number;
	readonly items: readonly FilterItemView[];
}

/**
 * 把状态铺成要画的行。
 *
 * · 第 0 行永远画（全部组；无分组时画全部节点）；
 * · 未进入组 ⇒ 只有第 0 行；
 * · 进入组后，沿 `picked` 一路往下，**每一层只要还有子节点就再画一行**。
 *
 * @param nodes 根节点
 * @param state 当前状态
 */
export function rowsOf(
	nodes: readonly FilterNode[],
	state: FilterState,
): readonly FilterRow[] {
	const groups = groupsOf(nodes);

	/* 没有分组：一层平铺，点一项就是选中它，没有下一级。 */
	if (groups.length === 0) {
		return [
			{
				level: 0,
				items: nodes.map((node) => ({
					value: node.value,
					label: node.label,
					picked: state.picked.length === 1 && state.picked[0] === node.value,
					branch: false,
					hasChildren: false,
					next: { group: '', picked: [node.value] },
				})),
			},
		];
	}

	const rows: FilterRow[] = [
		{
			level: 0,
			items: groups.map((node) => ({
				value: node.value,
				label: node.label,
				/* 组本身不是筛选值 ⇒ 永远不算 picked；只标「当前在这个组里」。 */
				picked: false,
				branch: state.group === node.value,
				hasChildren: true,
				/* 点组 = 清空选择 + 进入这个组。 */
				next: { group: node.value, picked: [] },
			})),
		},
	];

	const group = groups.find((one) => one.value === state.group);
	if (group === undefined) return rows;

	let node: FilterNode = group;
	for (let depth = 0; depth <= state.picked.length; depth += 1) {
		const children = node.children ?? [];
		if (children.length === 0) break;

		const pickedHere = state.picked[depth];
		const prefix = state.picked.slice(0, depth);

		rows.push({
			level: depth + 1,
			items: children.map((child) => ({
				value: child.value,
				label: child.label,
				picked: pickedHere === child.value,
				branch: pickedHere === child.value && hasChildren(child),
				hasChildren: hasChildren(child),
				next: { group: state.group, picked: [...prefix, child.value] },
			})),
		});

		const next = children.find((one) => one.value === pickedHere);
		if (next === undefined) break;
		node = next;
	}

	return rows;
}

/**
 * 收起态显示什么。
 *
 * | 状态 | 显示 |
 * |---|---|
 * | 什么都没进、没选 | `''`（组件只画标题）|
 * | **只进了组、没选值** | **组名**（`完成`）|
 * | 选了 `[失败]`，组是 `完成` | `完成/失败` |
 * | 选了 `[成功, 变体]`，组是 `完成` | `完成/成功/变体` |
 *
 * ⚠ **只进组也要显示组名。** 用户 `2026-11-16`：
 * > 「这个状态收回去的时候，这个『完成』不会作为子显示。」
 *
 * 语义上「点组 = 选中第 0 级」，所以第 0 级也是一个「选中的东西」，
 * 收起态必须显示它 —— 否则用户不知道这个方框当前停在哪一支。
 *
 * @param nodes 根节点
 * @param state 当前状态
 */
export function selectionText(
	nodes: readonly FilterNode[],
	state: FilterState,
): string {
	/* 无组方框（类别 / 领域）：没有第 0 级，`picked` 直接从根开始。 */
	if (!hasGroups(nodes)) {
		if (state.picked.length === 0) return '';
		const labels: string[] = [];
		let level: readonly FilterNode[] = nodes;
		for (const value of state.picked) {
			const hit = level.find((one) => one.value === value);
			if (hit === undefined) {
				labels.push(value);
				break;
			}
			labels.push(hit.label);
			level = hit.children ?? [];
		}
		return labels.join('/');
	}

	/*
	 * 有组方框：路径从组开始。
	 * 组名本身就是第 0 级的选择 —— **没选叶子时也要显示**。
	 */
	const groupNode = nodes.find((one) => one.value === state.group);
	if (groupNode === undefined) {
		return state.picked.length === 0 ? '' : state.picked.join('/');
	}

	if (state.picked.length === 0) return groupNode.label;

	const labels: string[] = [groupNode.label];
	let level: readonly FilterNode[] = groupNode.children ?? [];

	for (const value of state.picked) {
		const hit = level.find((one) => one.value === value);
		if (hit === undefined) {
			labels.push(value);
			break;
		}
		labels.push(hit.label);
		level = hit.children ?? [];
	}

	return labels.join('/');
}

/**
 * 当前有没有任何选择（含第 0 级的组）。
 *
 * 用来决定收起态要不要显示值、要不要出现清空按钮。
 *
 * ⚠ **不要用它决定「点方框主体干什么」。** 那件事与有没有值无关：
 *   点方框主体永远是「展开并保持当前选择」。
 *   上一版把它错当成「有值 ⇒ 点主体 = 清空」，结果用户点开一个已筛选的方框
 *   时值被清掉了（用户 `2026-11-16` 报的 bug 就是这个的变体）。
 *
 * @param state 当前状态
 */
export function hasSelection(state: FilterState): boolean {
	return state.group !== '' || state.picked.length > 0;
}

/**
 * 清空**全部**选择（含组）。
 *
 * 只由收起态那个**独立的 ✕ 按钮**调用 —— 不是点方框主体。
 *
 * @param _state 当前状态（保留参数为了调用点对称）
 */
export function clearPicked(_state: FilterState): FilterState {
	return EMPTY_FILTER;
}

/**
 * 选中路径的**筛选值**（给 API 层用）。
 *
 * 取最深层那个节点的 value。组不算值；没选就是空数组。
 *
 * ⚠ 如果将来需要「选上层 = 筛整个子树」，在这里展开成子节点全集，
 *   而不是让组件或 API 各自去遍历。
 *
 * @param state 当前状态
 * @param nodes 根节点（展开子树时要用）
 */
export function filterValuesOf(
	nodes: readonly FilterNode[],
	state: FilterState,
): readonly string[] {
	if (state.picked.length === 0) return [];
	const leaf = state.picked[state.picked.length - 1];
	if (leaf === undefined) return [];
	return [leaf];
}
