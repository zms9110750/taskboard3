/**
 * 左栏「元数据」块：**父任务 + 关系/高级设置 折叠面板** —— 纯逻辑。
 *
 * ## ⚠ 为什么单独一个纯逻辑文件
 *
 * 这一块的全部难点在**一个三值状态**和**计数规则**上，两者都会有「看着对其实错」的
 * 失效方式（见下）。它们在组件里就没法用 `node --test` 覆盖 —— 组件是 `.tsx`。
 *
 * ⇒ 判决放这里，组件只调它。
 *
 * ## 用户指令（`【用户指令，2026-11-09】`，旧版 `meta-panel.js` 逐字抄的）
 *
 * > 「左边的元数据面板，在模板下面再加一个新的条『父任务』。然后再下面，放按钮
 * >  『关系』『高级设置』。这是标签按钮，点击以后在下面打开隐藏面板。」
 *
 * ## 三值 `active` 而不是两个 boolean
 *
 * 旧版是 `let active = null | 'rel' | 'adv'`，两个 boolean 会允许「两个都开」——
 * 那不是 UI 问题，是**状态表达问题**：能表示出非法状态的类型，迟早会表示出非法状态。
 *
 * | 状态 | 关系面板 | 高级设置面板 | 按钮高亮 |
 * |---|---|---|---|
 * | `null` | 关 | 关 | 都暗 |
 * | `'rel'` | **开** | 关 | 关系亮 |
 * | `'adv'` | 关 | **开** | 高级亮 |
 *
 * 互斥和可收起是**同一个 `active` 的必然结果**，不需要额外代码：
 *
 * ```ts
 * nextTab(active, 'rel')  // 已经开着 ⇒ null（收起）；关着 ⇒ 'rel'
 * ```
 */

/** 左栏折叠面板的标签。 */
export type MetaTab = 'rel' | 'adv';

/**
 * 点一下标签按钮之后应该变成什么。
 *
 * **再点已开的那个 = 收起**（返回 `null`）；点另一个 = 直接切过去。
 *
 * @param current 当前激活的标签（`null` = 都收起）
 * @param clicked 被点的标签
 * @returns 新的激活标签
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

/** 一条关系草稿。 */
export interface RelationDraft {
	/** 关系类型（`dependsOn` / `constrains` / `related` / `references`）。 */
	readonly kind: string;
	/** 目标卡 id；空串 = 还没选。 */
	readonly to: string;
}

/**
 * 可选的关系类型 —— **`supersedes`（取代）不在列表里**。
 *
 * 依据（旧版 `meta-panel.ts:22-30` + `docs/04-relation.md` / `08-core.md`）：
 * 「取代不许手写进 relations（词法规则），fork 才产生取代」。
 *
 * ⚠ **这不是「暂时没做」的省略，是语义约束。** 手写一个「取代」会让关系图
 *   出现两条互为取代的边，而 fork 的产物是单向的。
 */
export const RELATION_KINDS: readonly { readonly value: string; readonly label: string }[] =
	Object.freeze([
		{ value: 'dependsOn', label: '依赖' },
		{ value: 'constrains', label: '约束' },
		{ value: 'related', label: '相关' },
		{ value: 'references', label: '参考' },
	]);

/**
 * 关系面板上的那个数字。
 *
 * ## 规则：**只算「已选目标」的行**（空行不算）
 *
 * 用户确认过（旧版 `meta-panel.ts:86`：「关系条数 = 已选目标的行数（空行不算『已添加』）」）。
 *
 * ⚠ 这条看着显然，但它是**两个容易搞混的东西**：
 * - 「加了几行」—— 点一次「+ 添加关联」就 +1，用户还没选卡
 * - 「加了几条关系」—— 只有真选了目标才算
 *
 * 差一的话表现是：点一下「添加」按钮，标签上的数字就变了，但什么都没加。
 *
 * @param rows 关系草稿行
 * @returns 已选目标的行数
 */
export function relationCountOf(rows: readonly RelationDraft[]): number {
	return rows.filter((one) => one.to !== '').length;
}

/**
 * 提交时要送出去的关联清单 —— **滤掉没选目标的行**。
 *
 * ⚠ 和 `relationCountOf` 用**同一个判断**（`to !== ''`）。
 *   如果这里用另一个条件（比如「kind 非空」），标签上的数字和实际提交的条数就会不一致，
 *   而那是最难发现的一类 bug：界面显示 3，后端收到 2。
 *
 * @param rows 关系草稿行
 */
export function linksOf(rows: readonly RelationDraft[]): readonly { readonly label: string; readonly to: string }[] {
	return rows
		.filter((one) => one.to !== '')
		.map((one) => {
			/* `kind` 存的是协议名（dependsOn），提交时也送协议名 —— label 只用于显示。 */
			return { label: one.kind, to: one.to };
		});
}

/**
 * 删掉一行。
 *
 * 纯函数而不是 `splice` —— 让「删了之后计数跟着变」变成**必然**（重新算，
 * 而不是靠调用方记得刷新）。旧版是靠手动 `syncCount()`，漏一处就数字不对。
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
 * @param to 新目标卡 id
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
 * @param kind 新关系类型
 */
export function setRelationKind(
	rows: readonly RelationDraft[],
	index: number,
	kind: string,
): readonly RelationDraft[] {
	if (index < 0 || index >= rows.length) return rows;
	return rows.map((one, i) => (i === index ? { ...one, kind } : one));
}
