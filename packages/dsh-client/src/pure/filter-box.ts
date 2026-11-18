/**
 * 筛选方框的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * ## 只有一个操作
 *
 * 用户 `2026-11-16`：
 * > 「点他的效果是选中他。既然选中了他，那他就应该展开。」
 * > 「我要的逻辑是完全具有一致性的。你套了多少if」
 *
 * ⇒ **选中 = 改路径 + 展开。两者不是两件事。**
 *
 * | 点哪里 | next | 之后 |
 * |---|---|---|
 * | 标题（第 0 级）| `[]` | 清空并展开 |
 * | 面包屑第 i 段 | `picked.slice(0, i+1)` | 选中它并展开 |
 * | 当前层 / 子层的项 | 它的路径 | 选中它并展开 |
 *
 * **它们全是同一个操作**：给出新路径。组件对所有点击都做同一件事
 * （`onChange(next)` + `onOpenChange(true)`），没有分支。
 *
 * ## 三层渲染结构
 *
 * 展开态永远是**若干段**（0–3 个），段之间一条结构竖线：
 *
 * ```
 *   ①面包屑          ②当前层兄弟         ③选中项的子
 *   1/2/3/2     |    1 / 2 / 3 / 4   |   1 / 2 / 3
 *   紧斜杠             空格斜杠             空格斜杠
 * ```
 *
 * · ① 只有「选中项不是第 1 级」时才有；
 * · ③ 只有「选中项有子」时才有；
 * · **②永远有**（没选时它就是根）。
 *
 * 组件不在 JSX 里判断这些 —— `segmentsOf()` 直接返回该画几段，
 * 组件只 `map` 一遍，竖线规则写一次。
 */

/** 一个可选节点。有 `children` 的就是能下探的节点。 */
export interface FilterNode {
	readonly value: string;
	readonly label: string;
	/** 子节点。缺省或空数组 = 叶子。 */
	readonly children?: readonly FilterNode[];
}

/** 选中路径 —— 从根往下的 value 序列。空数组 = 什么都没选。 */
export type Picked = readonly string[];

/** 一个可点的项（面包屑段和选项形状相同：都是「点了就去某条路径」）。 */
export interface PickItem {
	readonly value: string;
	readonly label: string;
	/** 是不是当前选中的那个。 */
	readonly picked: boolean;
	/** 还有子节点（能继续下探）。 */
	readonly hasChildren: boolean;
	/** 点它之后的路径。 */
	readonly next: Picked;
}

/** 一段。 */
export interface Segment {
	/** `crumbs` = ①祖先，`level` = ②当前层 / ③子层。 */
	readonly kind: 'crumbs' | 'level';
	/** 段内各项之间的分隔符：①用紧斜杠，②③用空格斜杠。 */
	readonly sep: string;
	/** 段内各项。 */
	readonly items: readonly PickItem[];
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

/** 一组兄弟 → 可点项。`prefix` 是它们共同的祖先路径。 */
function optionsOf(
	siblings: readonly FilterNode[],
	prefix: Picked,
	selected: string | undefined,
): readonly PickItem[] {
	return siblings.map((node) => ({
		value: node.value,
		label: node.label,
		picked: node.value === selected,
		hasChildren: hasChildren(node),
		next: [...prefix, node.value],
	}));
}

/**
 * 展开态该画哪几段。
 *
 * @param nodes 根
 * @param picked 当前路径
 */
export function segmentsOf(nodes: readonly FilterNode[], picked: Picked): readonly Segment[] {
	/* 第 0 级：没有面包屑，只有根这一层。 */
	if (picked.length === 0) {
		return [{ kind: 'level', sep: ' / ', items: optionsOf(nodes, [], undefined) }];
	}

	const resolved = resolvePath(nodes, picked);
	/* 路径脏了（数据变了）：什么都不画，别让界面炸。 */
	if (resolved === undefined) return [];

	const last = picked.length - 1;
	const segments: Segment[] = [];

	/* ① 祖先（不含选中项自己）。 */
	if (last > 0) {
		segments.push({
			kind: 'crumbs',
			sep: '/',
			items: resolved.slice(0, last).map((node, index) => ({
				value: picked[index] as string,
				label: node.label,
				/* 祖先不是「选中」，只是路径上的一段。 */
				picked: false,
				hasChildren: true,
				next: picked.slice(0, index + 1),
			})),
		});
	}

	/* ② 选中项所在层的全部兄弟。 */
	const parent = last === 0 ? undefined : resolved[last - 1];
	const siblings = parent === undefined ? nodes : (parent.children ?? []);
	segments.push({
		kind: 'level',
		sep: ' / ',
		items: optionsOf(siblings, picked.slice(0, last), picked[last]),
	});

	/* ③ 选中项的子。 */
	const selected = resolved[last];
	const children = selected?.children ?? [];
	if (children.length > 0) {
		segments.push({
			kind: 'level',
			sep: ' / ',
			items: optionsOf(children, picked, undefined),
		});
	}

	return segments;
}

/**
 * 收起态是一条**可点的面包屑** —— 整条路径，每段独立。
 *
 * 用户 `2026-11-16`：
 * > 「我要的是，『进行』，可以点。『提交』，可以点。
 * >  不是『进行/提交』这一个按钮。……每一层，虽然他写的是文字。
 * >  但是文字都是可以单独点击的。」
 *
 * 注意：这里**包含最后一段**（它才是当前选中项）。
 * 展开态的 ① 不含它 —— 因为 ② 里已经画了。
 *
 * @param nodes 根
 * @param picked 路径
 */
export function collapsedCrumbs(nodes: readonly FilterNode[], picked: Picked): readonly PickItem[] {
	if (picked.length === 0) return [];

	const resolved = resolvePath(nodes, picked);

	return picked.map((value, index) => {
		const node = resolved?.[index];
		return {
			value,
			label: node?.label ?? value,
			picked: index === picked.length - 1,
			hasChildren: node === undefined ? false : hasChildren(node),
			next: picked.slice(0, index + 1),
		};
	});
}

/**
 * 收起态的一行纯文字（用于 `title` / 无障碍）。
 *
 * @param nodes 根
 * @param picked 路径
 */
export function selectionText(nodes: readonly FilterNode[], picked: Picked): string {
	return collapsedCrumbs(nodes, picked)
		.map((one) => one.label)
		.join('/');
}
