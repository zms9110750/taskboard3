// TODO(审查): 本文件 868 行 + TechTree.tsx 1244 行手写分层/行压缩/正交连线，可评估 d3-hierarchy / @dagrejs/dagre / elkjs 替代；但「父行=min(子行)、一层一列、孤儿/环兜底」是用户硬规则，未必能直接映射 ⇒ 按 AGENTS 3.9 先做探针量数字，再决定是否引库（需用户定）。
/**
 * 科技树布局 —— **纯逻辑**：零 React、零 DOM、零网络、零 import。
 *
 * ## 来源
 *
 * 逐行读过旧版 `taskboard2/packages/browser/public/lib/tech-tree.js`（500 行，
 * 含 `__selfTest()`）后重写。**规则不变，形状换成 v3 的纯函数接口**：
 *
 * ```text
 * 输入：TreeCard[]（只要 id + parent）
 * 输出：TreeLayout（坐标 + 警告 + 父子边）
 * ```
 *
 * 旧版把布局和「哪些边、什么颜色」混在一个 500 行文件里；这里只留**坐标**。
 * 渲染层（视图）拿 `nodes` 绝对定位卡片；连线可以用本文件第二节的
 * `parentEdgePaths()`，也可以自己画 —— 但方向自适应的规则必须在纯代码里被测到。
 *
 * ## ① 分层：一列 = 一层
 *
 * 按 `parent` 链的深度算**逻辑层号 `layer`**，第 0 层最左。
 * `links`（依赖/取代/…）不参与分层 —— 它们只画线，不决定位置。
 *
 * ## ② 排行：`row(父) = min(row(所有直接子卡))` —— **本文件的核心**
 *
 * 用户原话（转引自旧版文件头）：
 *
 * > 「第一列的卡，他连接的最下面拓扑序的最上面的是第 12 行。那么他自己也应该在第 12 行。」
 *
 * ⇒ 父子**横向齐平**（同一逻辑行），派生线才是一条**拱弧**而不是斜线。
 *
 * 两条实现要点，缺一条就会退化成斜线：
 *
 * 1. **从最深列往左逐列排**（不是从左往右）——
 *    父卡排行时必须已经知道子卡的行，否则 `min(row(子))` 根本无从谈起。
 * 2. **每列分两轮：有子卡的卡先排、叶子后排** ——
 *    有子卡的卡**有行约束**（要对齐子卡），叶子**无约束**（填剩下的空位）。
 *    单轮按 id 字典序会让「id 排在前面的叶子」先占掉父卡需要的行 ⇒ 父卡被迫下移 ⇒ 斜线。
 *    旧版实测过的反例：`AA01`（叶子，字典序前）占 row 0，`ZZ01`（有子卡）被挤到 row 1。
 *
 * 「两轮」是**递归正确**的：子卡所在列先排完，父卡拿到的是**已确定的**行。
 *
 * ## ③ 不折栏：**一个逻辑层 = 一个物理列**
 *
 * 用户 `2026-11-24`：
 * > 「取消那个自动换列的功能。有了组和折叠进行排版。应该就不需要那个东西了。」
 *
 * ⇒ 删掉旧的「同层超过 `maxRowsPerColumn`（默认 10）行 ⇒ 均分成多栏」。
 *   现在一层就是一列，`column === layer`，`lane` 字段保留但与 `column` 始终相等
 *   （列组件的分组键仍用它，语义没变：一个「物理列」）。
 *
 * **后果（用户接受，因为用组 / 折叠来收）**：第 0 层有很多根卡时，那一列就是很长，
 * 纵向滚动靠画布自己；要靠**组**把它们收成横幅，不再自动换列。
 * 好处是**位置稳定**：可见卡数变化不再改变栏数 ⇒ 不会整图重排。
 *
 * ## ④ 孤儿卡 / 环：落第 0 层 + 警告，**绝不死循环、绝不丢卡**
 *
 * - 孤儿（`parent` 指向不存在的卡）⇒ 第 0 层 + `warning.kind='orphan'`
 * - 环（含自环）⇒ 环上的卡落第 0 层 + `warning.kind='cycle'`；
 *   指向环但不在环上的卡仍按「距环几步」正常分层
 * - 遍历用**显式路径栈**，不用递归 —— 环会让递归爆栈，而且爆栈报错离根因很远
 *
 * ## 输出坐标有两套，别混
 *
 * | 字段 | 含义 | 谁用 |
 * |---|---|---|
 * | `column` / `row` | **物理**坐标，渲染直接乘以步长 | 视图 |
 * | `layer` / `logicalRow` | **逻辑**坐标，父子对齐看这个 | 测试 / 诊断 |
 *
 * 不折栏之后「物理列」= 「逻辑层」`column === layer`，但**两套字段都保留**：
 * `logicalRow` 仍是「父 = min(子)」那条不变量的载体，测试断言的是它。
 * （历史上折栏会让同一逻辑行落到不同栏；那段逻辑已在 `2026-11-24` 删除。）
 *
 * ## ⑤ 为什么连线路径也在这个文件
 *
 * 旧版 `parentPath()` / `linkPath()` 里有一条**实测修过的坑**：
 * `links` 的 `to` **完全可能在 `from` 左边**，写死「从左到右出线」会让控制点跑到
 * 画布外、曲线横穿全图。这种「方向自适应」是**纯几何**，放在视图里就只能靠肉眼看；
 * 放在这里可以断言「左边出、右边进、控制点不出两卡之间的走廊」。
 *
 * 但**卡片尺寸 / 间距是视图的事**（旧版 150×64 / 56 / 14 来自用户裁决的视觉规格），
 * 所以这里不写死常量：路径函数收一个 `TreeMetrics`，由视图传进来。
 * 输出是可序列化数据（`TreeCurve` 控制点，或 `toPathData()` 的 `d` 字符串），不是 DOM。
 */

/* ══════════════════════════════════════════════════════════════
 * 一、类型
 * ══════════════════════════════════════════════════════════════ */

/**
 * 布局的输入：一张卡只需 `id` + `parent`（`title` 保留是为了和任务书接口一致，
 * 布局算法本身不读它 —— 渲染层自己拿卡上的标题）。
 *
 * `parent` 三种空值都当「无父」：`undefined` / `null` / `''`。
 * v3 的 `Card.relations.parent` 是 `string | null`，可以直接搬过来。
 */
export interface TreeCard {
	readonly id: string;
	/** 父卡 id；`undefined` / `null` / `''` 都表示「无父」。 */
	readonly parent?: string | null | undefined;
	readonly title: string;
}

/** 布局警告：孤儿 / 环。 */
export interface TreeLayoutWarning {
	readonly kind: 'orphan' | 'cycle';
	readonly cardId: string;
	/** 人话，渲染层可以放 `title` 上。 */
	readonly detail: string;
}

/**
 * 一张卡算出来的位置。
 *
 * ⚠ `column` / `row` 是**物理**坐标；`layer` / `logicalRow` 是**逻辑**坐标（二者现在同值）。
 * 见文件头「输出坐标有两套」。
 */
export interface TreeLayoutNode {
	readonly id: string;
	/** 物理列号（= layer；渲染直接用作 x 序号）。 */
	readonly column: number;
	/** 物理行号（**列内**，从 0 起，渲染直接用作 y 序号）。 */
	readonly row: number;
	/** 逻辑层号（拓扑深度，第 0 层最左）。 */
	readonly layer: number;
	/** 逻辑行号。**「父=min(子)」对齐看这个。** */
	readonly logicalRow: number;
	/** 这张卡自己的布局警告；没有就是 `undefined`（渲染层据此画 ▲）。 */
	readonly warning?: TreeLayoutWarning;
}

/**
 * 一个**物理栏**。
 *
 * 不折栏之后「逻辑层」和「物理栏」是一对一：column === layer。
 * 按 `column` 升序即渲染的自左向右顺序。
 */
export interface TreeBand {
	/** 物理栏号（= 该栏第一张卡的 `column`）。 */
	readonly column: number;
	/** 这一栏占多少视觉行（取栏内最大 `row` + 1，**不是卡数** —— 见下）。 */
	readonly rowCount: number;
	/** 这一栏有几张卡。 */
	readonly cardCount: number;
	/** 这一栏属于哪个逻辑层。 */
	readonly layer: number;
}

/**
 * 一条父子边（父 → 子）。
 *
 * ⚠ 只包含**两端都存在**的边：孤儿卡的 parent 不存在 ⇒ 不成边（但卡本身在 `nodes` 里）。
 * 自环（`parent === id`）也不成边 —— 它在 `warnings` 里，不在图里。
 */
export interface TreeEdge {
	readonly from: string;
	readonly to: string;
}

/** `layoutTree()` 的结果。 */
export interface TreeLayout {
	/** 每张卡的位置；顺序 = 输入里去重后的顺序（确定性）。**不丢卡**。 */
	readonly nodes: readonly TreeLayoutNode[];
	/** 每个物理栏；按 `column` 升序，首尾相接覆盖 `0 .. columnCount-1`。 */
	readonly bands: readonly TreeBand[];
	/** 孤儿 / 环 警告；顺序 = 输入顺序。 */
	readonly warnings: readonly TreeLayoutWarning[];
	/** 有效父子边（两端都在本布局里）。 */
	readonly edges: readonly TreeEdge[];
	/** 物理栏总数（= `bands.length`）。 */
	readonly columnCount: number;
	/** 最大栏高（= `max(band.rowCount)`），画布高度用它。 */
	readonly rowCount: number;
}

/*
 * ⚠ **已删除**：`TreeLayoutOptions` / `maxRowsPerColumn` / `DEFAULT_MAX_ROWS_PER_COLUMN`。
 *
 * 折栏（同层超过 N 行就均分成多栏）在 `2026-11-24` 被用户取消：
 * > 「取消那个自动换列的功能。有了组和折叠进行排版。应该就不需要那个东西了。」
 *
 * 现在一个逻辑层就是一列。`layoutTree()` 不再接受任何选项。
 */

/* ══════════════════════════════════════════════════════════════
 * 三、布局
 * ══════════════════════════════════════════════════════════════ */

/** 父卡 id 归一化：`undefined` / `null` / `''` ⇒ `undefined`（无父）。 */
function normalizeParent(parent: TreeCard['parent']): string | undefined {
	return typeof parent === 'string' && parent !== '' ? parent : undefined;
}

/** id 字典序（稳定、可复现，不随刷新变 —— 旧版同款判据）。 */
function compareIds(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

/**
 * 算科技树布局。
 *
 * @param cards 本空间要显示的全部卡（孤儿 / 环也在里面，不会丢）
 */
export function layoutTree(cards: readonly TreeCard[]): TreeLayout {
	/* ── ⓪ 去重：一个 id 只认第一张（同 id 不可能有两个位置） ── */
	const byId = new Map<string, TreeCard>();
	for (const card of cards) {
		if (!byId.has(card.id)) byId.set(card.id, card);
	}
	const unique = [...byId.values()];

	/* ────────────────────────────────────────────────────────
	 * ① 分层：到根的深度，带环检测
	 * ──────────────────────────────────────────────────────── */
	const layerOf = new Map<string, number>();
	const warningOf = new Map<string, TreeLayoutWarning>();

	/** 把 `path[from] .. path[0]` 依次设成 `base+1`, `base+2`, …。 */
	const fillAncestors = (path: readonly string[], from: number, base: number): void => {
		let depth = base;
		for (let i = from; i >= 0; i -= 1) {
			const id = path[i];
			if (id === undefined) continue;
			depth += 1;
			layerOf.set(id, depth);
		}
	};

	/**
	 * 算一张卡的层。
	 *
	 * ⚠ 用**显式路径栈**而不是递归 —— 环会让递归爆栈，而且爆栈时的错误信息
	 *   离根因很远（"Maximum call stack" 看不出是哪个环）。
	 */
	const resolveLayer = (startId: string): void => {
		const path: string[] = [];
		const onPath = new Set<string>();
		let current = startId;
		for (;;) {
			const cached = layerOf.get(current);
			if (cached !== undefined) {
				/* 命中缓存：路径上的都补上（深度 = 缓存深度 + 距终点的步数）。 */
				fillAncestors(path, path.length - 1, cached);
				return;
			}
			if (onPath.has(current)) {
				/*
				 * 环：`current` 已在路径上 ⇒ 环上的卡落第 0 层 + 标 cycle。
				 * ⚠ 只标环上的，不标「指向环」的那些（它们有合法深度）。
				 */
				const cycleStart = path.indexOf(current);
				for (let i = cycleStart; i < path.length; i += 1) {
					const id = path[i];
					if (id === undefined) continue;
					layerOf.set(id, 0);
					warningOf.set(id, {
						kind: 'cycle',
						cardId: id,
						detail: 'parent 链成环（这张卡在环上），按第 0 层摆放',
					});
				}
				/* 环之前的那些（指向环的卡）：从环出发往上数。 */
				fillAncestors(path, cycleStart - 1, 0);
				return;
			}
			onPath.add(current);
			path.push(current);
			const card = byId.get(current);
			if (card === undefined) {
				/* 调用方只会传已存在的 id；保留一条不抛的兜底。 */
				layerOf.set(current, 0);
				return;
			}
			const parentId = normalizeParent(card.parent);
			/*
			 * 无父 ⇒ 根，第 0 层。
			 * 有父但父卡不在本空间 ⇒ **孤儿**：第 0 层 + 警告。
			 * ⇒ 两种情况都是「到此为止」，只是后者留痕。
			 */
			if (parentId === undefined || !byId.has(parentId)) {
				layerOf.set(current, 0);
				if (parentId !== undefined) {
					warningOf.set(current, {
						kind: 'orphan',
						cardId: current,
						detail: `parent 指向的卡不存在：${parentId}，按第 0 层摆放`,
					});
				}
				fillAncestors(path, path.length - 2, 0);
				return;
			}
			current = parentId;
		}
	};

	for (const card of unique) {
		/* 命中缓存的会立刻返回；环里的卡在这里不会重复算。 */
		if (!layerOf.has(card.id)) resolveLayer(card.id);
	}

	let layerCount = 0;
	for (const layer of layerOf.values()) {
		if (layer + 1 > layerCount) layerCount = layer + 1;
	}

	/* ── 建列（逻辑层 → 该层的卡 id），每列按 **id 字典序** ── */
	const columns = new Map<number, string[]>();
	for (const card of unique) {
		const layer = layerOf.get(card.id) ?? 0;
		const list = columns.get(layer);
		if (list === undefined) columns.set(layer, [card.id]);
		else list.push(card.id);
	}
	for (const list of columns.values()) {
		list.sort(compareIds);
	}

	/* ── 父子关系（只认两端都存在的边；自环不成边） ── */
	const childrenOf = new Map<string, string[]>();
	const edges: TreeEdge[] = [];
	for (const card of unique) {
		const parentId = normalizeParent(card.parent);
		if (parentId === undefined) continue;
		if (parentId === card.id) continue; /* 自环：交给 ① 的 cycle 警告，不进图 */
		if (!byId.has(parentId)) continue; /* 孤儿：parent 不存在，不成边 */
		const list = childrenOf.get(parentId);
		if (list === undefined) childrenOf.set(parentId, [card.id]);
		else list.push(card.id);
		edges.push({ from: parentId, to: card.id });
	}

	/* ────────────────────────────────────────────────────────
	 * ② 排行：从最深列往左，每列**两轮**
	 * ──────────────────────────────────────────────────────── */

	/** 已排好的逻辑行（`layer` 作用域内唯一）。 */
	const rankedOf = new Map<string, number>();
	/** 每层已占的行。 */
	const occupied = new Map<number, Set<number>>();

	/** 找该层第一个 ≥ `start` 的空行；找不到就取更大行（**不会失败**）。 */
	const findRow = (layer: number, start: number): number => {
		let used = occupied.get(layer);
		if (used === undefined) {
			used = new Set<number>();
			occupied.set(layer, used);
		}
		let row = start;
		while (used.has(row)) row += 1;
		used.add(row);
		return row;
	};

	/** 排一张卡：有已确定的子卡行 ⇒ 对齐到 `min`；否则从 0 找空行。 */
	const rankCard = (id: string, layer: number): void => {
		let target: number | undefined;
		for (const childId of childrenOf.get(id) ?? []) {
			const childRow = rankedOf.get(childId);
			if (childRow === undefined) continue; /* 只有环这种异常才会出现 */
			if (target === undefined || childRow < target) target = childRow;
		}
		rankedOf.set(id, findRow(layer, target ?? 0));
	};

	/*
	 * ⚠ **必须从最深列往最左列**：父卡排行时子卡的行必须已经确定。
	 * ⚠ **每列必须两轮**：有子卡的先排（有行约束），叶子后排（无约束，填剩下的）。
	 *   判据：**无约束的不该抢有约束的位置。**
	 *   反例见本文件头 ② —— 单轮字典序会让叶子把父卡挤成斜线。
	 */
	for (let layer = layerCount - 1; layer >= 0; layer -= 1) {
		const ids = columns.get(layer) ?? [];
		const constrained: string[] = [];
		const leaves: string[] = [];
		for (const id of ids) {
			if ((childrenOf.get(id)?.length ?? 0) > 0) constrained.push(id);
			else leaves.push(id);
		}
		for (const id of constrained) rankCard(id, layer);
		for (const id of leaves) rankCard(id, layer);
	}

	/* ────────────────────────────────────────────────────────
	 * ③ 一个逻辑层 = 一个物理列（不折栏）
	 *
	 * 用户 `2026-11-24`：
	 * > 「取消那个自动换列的功能。有了组和折叠进行排版。应该就不需要那个东西了。」
	 *
	 * ⇒ `column === layer`，`lane === column`（字段保留给列组件分组）。
	 *   一层不再均分成多栏 ⇒ 可见卡数变化不再改变栏数 ⇒ **不会整图重排**。
	 * ──────────────────────────────────────────────────────── */
	interface Placed {
		readonly column: number;
		readonly row: number;
		readonly layer: number;
		readonly logicalRow: number;
	}
	const placedOf = new Map<string, Placed>();
	const bands: TreeBand[] = [];
	let rowCount = 0;

	for (let layer = 0; layer < layerCount; layer += 1) {
		const ids = [...(columns.get(layer) ?? [])].sort((a, b) => {
			const rowA = rankedOf.get(a) ?? 0;
			const rowB = rankedOf.get(b) ?? 0;
			if (rowA !== rowB) return rowA - rowB;
			return compareIds(a, b);
		});
		/*
		 * 列内视觉行从 0 重新计数 ⇒ 减去**列内最小逻辑行**。
		 * ⚠ 逻辑行可能有空洞（父卡为了对齐高行的子卡可以排到很下面，而本层卡少）
		 *   ⇒ `rowCount` 取**最大视觉行 + 1**，不是卡数 —— 否则画布会裁掉卡。
		 */
		const firstId = ids[0];
		const minRow = firstId === undefined ? 0 : (rankedOf.get(firstId) ?? 0);
		let bandRows = 0;
		for (const id of ids) {
			const logicalRow = rankedOf.get(id);
			if (logicalRow === undefined) continue;
			const row = logicalRow - minRow;
			placedOf.set(id, { column: layer, row, layer, logicalRow });
			if (row + 1 > bandRows) bandRows = row + 1;
		}
		bands.push({ column: layer, rowCount: bandRows, cardCount: ids.length, layer });
		if (bandRows > rowCount) rowCount = bandRows;
	}

	/* ── 汇总（顺序 = 输入顺序，确定性；一张都不丢） ── */
	const nodes: TreeLayoutNode[] = [];
	for (const card of unique) {
		const placed = placedOf.get(card.id);
		if (placed === undefined) continue;
		const warning = warningOf.get(card.id);
		nodes.push({
			id: card.id,
			...placed,
			...(warning === undefined ? {} : { warning }),
		});
	}

	const warnings: TreeLayoutWarning[] = [];
	for (const card of unique) {
		const warning = warningOf.get(card.id);
		if (warning !== undefined) warnings.push(warning);
	}

	/* 不折栏 ⇒ 列数就是逻辑层里「有卡」的层数（`bands` 每层恰好一项）。 */
	const columnCount = bands.length;

	return { nodes, bands, warnings, edges, columnCount, rowCount };
}

/* ══════════════════════════════════════════════════════════════
 * 四、连线路径（纯几何，输出可序列化数据）
 * ══════════════════════════════════════════════════════════════ */

/**
 * 渲染尺寸 —— **由视图传进来，布局算法不写死**。
 *
 * 旧版的 150×64 / 列间距 56 / 行间距 14 / 留白 24 来自用户 `2026-11-10` 的
 * 视觉裁决，属于「画」的事；本文件只负责「给定尺寸，曲线控制点在哪」。
 */
export interface TreeMetrics {
	readonly cardWidth: number;
	readonly cardHeight: number;
	readonly columnGap: number;
	readonly rowGap: number;
	readonly padding: number;
}

/** 一个点。 */
export interface TreePoint {
	readonly x: number;
	readonly y: number;
}

/** 一张卡的矩形（可视化坐标，含中心点）。 */
export interface TreeBox {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly midX: number;
	readonly midY: number;
}

/** 三次贝塞尔：`start → (c1, c2) → end`。**可序列化**，不含 DOM。 */
export interface TreeCurve {
	readonly start: TreePoint;
	readonly c1: TreePoint;
	readonly c2: TreePoint;
	readonly end: TreePoint;
}

/** 一条父子边的路径（`d` 可直接塞进 `<path d>`）。 */
export interface TreeEdgePath {
	readonly from: string;
	readonly to: string;
	readonly d: string;
}

/** 数字保留 2 位小数（避免浮点噪声进 `d`，测试也好断言）。 */
function round(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * 一张卡在画布上的矩形。
 *
 * @param node 只需要 `column` / `row`（`TreeLayoutNode` 可以直接传）
 * @param metrics 渲染尺寸
 * @param rowTops 可选的**每行顶边**（`rowMetricsOf()` 算出来的 `tops`）。
 *
 * ⚠ 不传 = 旧行为（每行等高 `cardHeight + rowGap`）。
 *   传了 = 行高可以不等（收起的分组横幅只占 18px，见 `rowMetricsOf()` 注释）。
 *   用户 `2026-11-24`：「组收起的时候只有组的高度，而不是组内容的大小还占在那里」。
 */
export function boxOf(
	node: Pick<TreeLayoutNode, 'column' | 'row'>,
	metrics: TreeMetrics,
	rowTops?: readonly number[],
): TreeBox {
	const left = node.column * (metrics.cardWidth + metrics.columnGap) + metrics.padding;
	const top =
		rowTops?.[node.row] ?? node.row * (metrics.cardHeight + metrics.rowGap) + metrics.padding;
	return {
		left,
		top,
		right: left + metrics.cardWidth,
		bottom: top + metrics.cardHeight,
		midX: left + metrics.cardWidth / 2,
		midY: top + metrics.cardHeight / 2,
	};
}

/**
 * 每行的顶边 / 行高 / 画布高度 —— **行高可以不等于卡高**。
 *
 * 用户 `2026-11-24`：
 * > 「组收起的时候只有组的高度。而不是组内容的大小还占在那里并且组在居中位置。
 * >   组收起了就如果那些组内卡不存在一样。」
 *
 * 科技树的物理行本来是等高的（`cardHeight + rowGap`）。但「收起的分组」在那一行里
 * 只画一条 18px 的横幅 —— 如果行高还是 78px，横幅下面就会空出 60px，看起来像
 * 组里还有一张看不见的卡在占位。
 *
 * ⇒ 由渲染层给「这一行里最矮/最高的实际内容高」：某行只有横幅 ⇒ 该行 18px；
 *   某行还有真卡 ⇒ 取该行最大值（真卡 78）。行顶边因此要用**前缀和**算。
 *
 * @param layout `layoutTree()` 的结果
 * @param metrics 渲染尺寸（`rowGap` / `padding` / 默认 `cardHeight`）
 * @param heightOf 某个节点在这一行里实际占多高；返回 `undefined` = 按 `cardHeight`
 * @returns `tops[r]` 是第 r 行顶边；`heights[r]` 是第 r 行行高；`stageHeight` 含上下留白
 */
export function rowMetricsOf(
	layout: TreeLayout,
	metrics: TreeMetrics,
	heightOf: (id: string) => number | undefined = () => undefined,
): { readonly tops: readonly number[]; readonly heights: readonly number[]; readonly stageHeight: number } {
	const rowCount = layout.rowCount;
	if (rowCount === 0) return { tops: [], heights: [], stageHeight: metrics.padding * 2 };

	/* 每行取「该行所有节点里最高的」；空行（理论上不会有）回落卡高。 */
	const raw: number[] = Array.from({ length: rowCount }, () => 0);
	for (const node of layout.nodes) {
		if (node.row < 0 || node.row >= rowCount) continue;
		const h = heightOf(node.id) ?? metrics.cardHeight;
		if (h > (raw[node.row] ?? 0)) raw[node.row] = h;
	}
	const heights: number[] = raw.map((h) => (h > 0 ? h : metrics.cardHeight));

	const tops: number[] = [];
	let y = metrics.padding;
	for (let row = 0; row < rowCount; row += 1) {
		tops.push(y);
		y += (heights[row] ?? metrics.cardHeight) + metrics.rowGap;
	}
	const last = rowCount - 1;
	const stageHeight = (tops[last] ?? metrics.padding) + (heights[last] ?? metrics.cardHeight) + metrics.padding;
	return { tops, heights, stageHeight };
}

/**
 * 父 → 子的**小弧度拱形**贝塞尔。
 *
 * 父子被 ② 对齐到同一逻辑行 ⇒ 正常情况两端 `y` 相同，控制点**各自向上抬起**
 * 形成「拱」（用户 `2026-11-09`：「有没有办法画弧线。就是 md 的甘特图里面的箭头」）。
 *
 * ⚠ **不能假设「子卡一定在父卡右边」**：正常树里层号递增 ⇒ 物理栏也递增，
 *   但**环**里的父子同在第 0 层、可能同栏（此时左右关系不成立）。
 *   ⇒ 三个分支：右向（正常）、左向（镜像）、纵向（同栏/重叠）。
 */
export function parentCurve(from: TreeBox, to: TreeBox): TreeCurve {
	const gapRight = to.left - from.right;
	if (gapRight >= 0) {
		/* 正常情况：子卡在父卡右边。 */
		const reach = Math.max(20, gapRight * 0.4);
		/* 抬起量：跨度小就抬少一点，避免贴在一起的两列画出一个大拱。 */
		const lift = Math.min(14, Math.max(6, gapRight / 8));
		return {
			start: { x: from.right, y: from.midY },
			c1: { x: from.right + reach, y: from.midY - lift },
			c2: { x: to.left - reach, y: to.midY - lift },
			end: { x: to.left, y: to.midY },
		};
	}
	const gapLeft = from.left - to.right;
	if (gapLeft >= 0) {
		/* 子卡在父卡左边（异常数据 / 环）⇒ 镜像，控制点仍落在两卡之间的走廊。 */
		const reach = Math.max(20, gapLeft * 0.4);
		const lift = Math.min(14, Math.max(6, gapLeft / 8));
		return {
			start: { x: from.left, y: from.midY },
			c1: { x: from.left - reach, y: from.midY - lift },
			c2: { x: to.right + reach, y: to.midY - lift },
			end: { x: to.right, y: to.midY },
		};
	}
	/* 同栏 / 水平重叠（环）：改走纵向，绝不画出一条横穿两张卡的线。 */
	const downward = to.midY >= from.midY;
	const dir = downward ? 1 : -1;
	const startY = downward ? from.bottom : from.top;
	const endY = downward ? to.top : to.bottom;
	const reach = Math.max(8, Math.abs(endY - startY) * 0.4);
	return {
		start: { x: from.midX, y: startY },
		c1: { x: from.midX, y: startY + dir * reach },
		c2: { x: to.midX, y: endY - dir * reach },
		end: { x: to.midX, y: endY },
	};
}

/**
 * 任意两卡之间的连线（`links`：依赖 / 取代 / 约束 / 相关 / 参考 ……）。
 *
 * ## ⚠ 方向必须按两端中心距自适应（旧版实测修过一次）
 *
 * 原实现写死「a 在左、b 在右」，但 `to` 完全可能在 `from` **左边**
 * （旧版实测 `GU04 -[dependsOn]-> GU01`）⇒ 控制点跑到两端之外，
 * 曲线从源卡右侧甩出去、横穿整个画布再兜回来。
 *
 * 现在：
 * - 横向为主（`|dx| >= |dy|`）：从源卡**朝向目标那一侧**出线，进目标卡朝向源的那一侧；
 * - 纵向为主（同栏不同行）：从源卡的**下 / 上边**出线，进目标卡的**上 / 下边**。
 *
 * @param bend 弧度偏移（同对节点多条边时错开，避免完全重合）
 */
export function linkCurve(from: TreeBox, to: TreeBox, bend = 0): TreeCurve {
	const dx = to.midX - from.midX;
	const dy = to.midY - from.midY;

	/* 横向为主：左右出线。 */
	if (Math.abs(dx) >= Math.abs(dy)) {
		const rightward = dx >= 0;
		const startX = rightward ? from.right : from.left;
		const endX = rightward ? to.left : to.right;
		const dir = rightward ? 1 : -1;
		/* 控制点伸出量：跨度小就收一点，避免相邻两栏画出一大圈。 */
		const reach = Math.max(24, Math.abs(endX - startX) * 0.5);
		return {
			start: { x: startX, y: from.midY },
			c1: { x: startX + dir * reach, y: from.midY + bend },
			c2: { x: endX - dir * reach, y: to.midY + bend },
			end: { x: endX, y: to.midY },
		};
	}

	/* 纵向为主：同栏不同行 ⇒ 上下出线。 */
	const downward = dy >= 0;
	const startY = downward ? from.bottom : from.top;
	const endY = downward ? to.top : to.bottom;
	const dir = downward ? 1 : -1;
	const reach = Math.max(20, Math.abs(endY - startY) * 0.5);
	return {
		start: { x: from.midX, y: startY },
		c1: { x: from.midX + bend, y: startY + dir * reach },
		c2: { x: to.midX + bend, y: endY - dir * reach },
		end: { x: to.midX, y: endY },
	};
}

/** 把曲线变成 SVG `d` 字符串（`M … C …`）。**可序列化**，渲染层直接用。 */
export function toPathData(curve: TreeCurve): string {
	const { start, c1, c2, end } = curve;
	return `M ${round(start.x)} ${round(start.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(end.x)} ${round(end.y)}`;
}

/**
 * 一次性算出全部父子边的 `d`（渲染层最常用）。
 *
 * @param layout `layoutTree()` 的结果
 * @param metrics 渲染尺寸
 */
export function parentEdgePaths(
	layout: TreeLayout,
	metrics: TreeMetrics,
	rowTops?: readonly number[],
): readonly TreeEdgePath[] {
	const byId = new Map(layout.nodes.map((node) => [node.id, node]));
	const out: TreeEdgePath[] = [];
	for (const edge of layout.edges) {
		const from = byId.get(edge.from);
		const to = byId.get(edge.to);
		if (from === undefined || to === undefined) continue;
		out.push({
			from: edge.from,
			to: edge.to,
			d: toPathData(
				parentCurve(boxOf(from, metrics, rowTops), boxOf(to, metrics, rowTops)),
			),
		});
	}
	return out;
}

/**
 * 画布尺寸（含四周留白）。
 *
 * 空布局也返回 `padding*2`（渲染层据此挂空状态，不会算出一个负尺寸）。
 */
export function canvasSizeOf(
	layout: TreeLayout,
	metrics: TreeMetrics,
): { readonly width: number; readonly height: number } {
	const width =
		layout.columnCount === 0
			? metrics.padding * 2
			: (layout.columnCount - 1) * (metrics.cardWidth + metrics.columnGap) +
				metrics.cardWidth +
				metrics.padding * 2;
	const height =
		layout.rowCount === 0
			? metrics.padding * 2
			: (layout.rowCount - 1) * (metrics.cardHeight + metrics.rowGap) +
				metrics.cardHeight +
				metrics.padding * 2;
	return { width, height };
}

/* ══════════════════════════════════════════════════════════════
 * 列内独立排版（用户 `2026-11-24`：「让列成为一个组件。内部管理」）
 * ══════════════════════════════════════════════════════════════ */

/**
 * 一个槽位的纵向尺寸。
 *
 * - `height` = 这一项自己画多高（卡 78 / 收起的分组横幅 18）
 * - `pitch`  = 它到下一项的步进（**已含与下一项的间距**）；卡 = 78 + 14 = 92，
 *              横幅 = 92 / 2 = 46 ⇒ **两个横幅正好等于一个卡槽**（用户 `2026-11-24`：
 *              「一个横幅的占位（包括间距），让他变成0.5卡高。也就是说两个横幅=1卡（包括间距）」）。
 */
export interface TreeSlot {
	readonly height: number;
	readonly pitch: number;
}

/** 列里的一项：节点 + 它的纵向位置。 */
export interface TreeLaneItem {
	readonly node: TreeLayoutNode;
	readonly top: number;
	readonly height: number;
}

/** 一个物理列（= 一个逻辑层）的排版结果。**列内独立，不与其他列共享行坐标。** */
export interface TreeLane {
	/** 列号（= `layoutTree` 里的 `column` = `layer`，决定 x）。 */
	readonly lane: number;
	readonly x: number;
	readonly width: number;
	readonly items: readonly TreeLaneItem[];
	/** 内容底边（最后一个 item 的 bottom）；空列 = `padding`。 */
	readonly bottom: number;
}

/**
 * 按**物理栏**独立排版：每一列自己累加步进，列与列之间不再共享行坐标。
 *
 * ## 为什么要拆
 *
 * 旧实现是「全局行表」(`rowMetricsOf`)：所有列共用 `tops[row]`。
 * 好处是父子跨列时天然同行、连线水平；坏处是**一列里的组收起后，只要别列同一行还有卡，
 * 这一行就压不下去** —— 用户 `2026-11-24` 实测到的「多栏收不干净」。
 *
 * 现在每列只对自己的 item 序列累加 ⇒ 某一列收起一个组，**只有该列后面的 item 上移**，
 * 别的列纹丝不动。代价：父子卡不再保证同行，`parentCurve` 会画出斜/弧线（这是接受的）。
 *
 * @param layout `layoutTree()` 的结果
 * @param metrics 渲染尺寸
 * @param slotOf 某个节点的槽位；返回 `undefined` = 按卡槽（78 / 92）
 * @returns `lanes` 每列一项（按 lane 升序）；`boxes` 节点 id → 矩形（画边用）；
 *          `stageHeight` = 最高列的底边 + 下留白
 */
export function lanePlansOf(
	layout: TreeLayout,
	metrics: TreeMetrics,
	slotOf?: (id: string) => TreeSlot | undefined,
): {
	readonly lanes: readonly TreeLane[];
	readonly boxes: ReadonlyMap<string, TreeBox>;
	readonly stageHeight: number;
} {
	const cardSlot: TreeSlot = {
		height: metrics.cardHeight,
		pitch: metrics.cardHeight + metrics.rowGap,
	};

	const byLane = new Map<number, TreeLayoutNode[]>();
	for (const node of layout.nodes) {
		const list = byLane.get(node.column);
		if (list === undefined) byLane.set(node.column, [node]);
		else list.push(node);
	}

	const lanes: TreeLane[] = [];
	const boxes = new Map<string, TreeBox>();
	let maxBottom = metrics.padding;

	for (const lane of [...byLane.keys()].sort((a, b) => a - b)) {
		const nodes = byLane.get(lane) ?? [];
		/* 列内顺序 = 逻辑行号升序（`layoutTree` 已经排好行，这里只按行稳定排序）。 */
		nodes.sort((a, b) => a.row - b.row);

		const x = lane * (metrics.cardWidth + metrics.columnGap) + metrics.padding;
		const items: TreeLaneItem[] = [];
		let y = metrics.padding;
		for (const node of nodes) {
			const slot = slotOf?.(node.id) ?? cardSlot;
			const top = y;
			items.push({ node, top, height: slot.height });
			boxes.set(node.id, {
				left: x,
				top,
				right: x + metrics.cardWidth,
				bottom: top + slot.height,
				midX: x + metrics.cardWidth / 2,
				midY: top + slot.height / 2,
			});
			y += slot.pitch;
		}
		const last = items[items.length - 1];
		const bottom = last === undefined ? metrics.padding : last.top + last.height;
		if (bottom > maxBottom) maxBottom = bottom;
		lanes.push({ lane, x, width: metrics.cardWidth, items, bottom });
	}

	return { lanes, boxes, stageHeight: maxBottom + metrics.padding };
}

/**
 * 父子边：用**给定的矩形表**画（列内独立排版时用这个，不用 `rowTops`）。
 *
 * @param layout `layoutTree()` 的结果
 * @param boxes 节点 id → 矩形（`lanePlansOf().boxes`）
 */
export function parentEdgePathsOf(
	layout: TreeLayout,
	boxes: ReadonlyMap<string, TreeBox>,
): readonly TreeEdgePath[] {
	const out: TreeEdgePath[] = [];
	for (const edge of layout.edges) {
		const from = boxes.get(edge.from);
		const to = boxes.get(edge.to);
		if (from === undefined || to === undefined) continue;
		out.push({ from: edge.from, to: edge.to, d: toPathData(parentCurve(from, to)) });
	}
	return out;
}
