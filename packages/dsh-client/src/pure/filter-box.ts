/**
 * 筛选方框的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * ## 这个文件解决什么
 *
 * 旧的 `filter-box.ts` 把「选项怎么分组 / 选了什么 / 收起该显示什么 / 点一下变成什么」
 * 全混在渲染函数里（400 行，其中一半是 DOM 操作）。这里把**判决**抽出来：
 * 同一个输入永远得到同一个输出，可以用 `node --test` 直接断言。
 *
 * React 组件只负责「把这里算出来的东西画出去 + 把点击翻译成一次 `onChange`」。
 *
 * ## 语义（全部来自旧版用户逐版确认的行为，一条不许少）
 *
 * | # | 行为 |
 * |---|---|
 * | 1 | 单选：选一项 = **替换**；再点同一项 = **取消** |
 * | 2 | 点一级的「组」= **选中整组**（组里每个值都进去）|
 * | 3 | 组被整组选中时，**二级展开**显示组内各项 |
 * | 4 | 选中**单项**时，二级也展开（回到它的组）|
 * | 5 | 收起态：没选 = 只剩标题；整组 = 组名；单项 = `组/项`；多项 = `a/b` |
 * | 6 | 一级之间用 `|` 分隔，二级之间用 `/` 分隔（分隔符由组件画，逻辑只给数组）|
 * | 7 | 没有组的方框（类别 / 领域）不出二级 |
 *
 * ⚠ **单选是 UI 语义，数组是数据契约。**
 * 旧版注释：`SearchCondition` 五个字段全是数组，但用户明确要单选
 * （「筛选应该是单选而不是复选。他是用来快速查找的」）。
 * ⇒ 本模块的出参永远是 `readonly string[]`，长度 0 或 1
 *   **除了「点整组」** —— 那时是「一个选择」展开成的多个值。
 *
 * ## 为什么 `group` 是 option 的字段而不是外部函数
 *
 * 旧版传的是 `(option) => option.group ?? ''`，即**回调只是把字段取出来**。
 * 那种写法让每个调用点都必须传同一个函数，且容易传错。
 * 这里直接把 `group` 挂在 option 上，少一层可以传错的东西。
 */

/** 一个可选项。`group` 为空 / 缺省 = 这个方框没有分组。 */
export interface FilterOption {
	readonly value: string;
	readonly label: string;
	/** 所属组名。缺省或空串 = 不参与分组（类别 / 领域方框）。 */
	readonly group?: string;
}

/**
 * 已选值。永远是数组（数据契约），但 UI 上只体现单选语义。
 *
 * ⚠ 空数组 = 没选。**不要用 `undefined` 表示没选** —— 调用方要因此多一支分支。
 */
export type Picked = readonly string[];

/** 一个组：组名 + 组里的选项。 */
export interface FilterGroup {
	readonly key: string;
	readonly options: readonly FilterOption[];
}

/** 取选项的组名；缺省 / 空串 → `''`（表示「不属于任何组」）。 */
export function groupKeyOf(option: FilterOption): string {
	return option.group ?? '';
}

/**
 * 按组分组，**保持 options 的原始顺序**。
 *
 * 组第一次出现的顺序 = 组在结果里的顺序（旧版行为：不排序）。
 *
 * @param options 全部选项
 * @returns 每项一个 `{ key, options }`；没分组的项 `key === ''`
 */
export function groupOf(options: readonly FilterOption[]): readonly FilterGroup[] {
	const map = new Map<string, FilterOption[]>();
	for (const option of options) {
		const key = groupKeyOf(option);
		const list = map.get(key);
		if (list === undefined) map.set(key, [option]);
		else list.push(option);
	}
	return [...map].map(([key, list]) => ({ key, options: list }));
}

/** 这个方框有没有真分组（至少一个 `key !== ''` 的组）。 */
export function hasGroups(options: readonly FilterOption[]): boolean {
	return groupOf(options).some((one) => one.key !== '');
}

/**
 * 这一组是否**整组**被选中。
 *
 * ⚠ 空组返回 `false` —— 否则空组会被当成「全选中」，二级无端展开。
 *
 * @param group 一个组
 * @param picked 已选值
 */
export function isGroupPicked(group: FilterGroup, picked: Picked): boolean {
	if (group.options.length === 0) return false;
	return group.options.every((one) => picked.includes(one.value));
}

/**
 * 当前该展开哪个组的二级。
 *
 * 规则（顺序即优先级）：
 * 1. 什么都没选 → `undefined`（不展开）
 * 2. 某组被**整组**选中 → 那个组
 * 3. 恰好选中**一项**且它属于某个组 → 那个组
 * 4. 其它（多值但不构成整组）→ `undefined`
 *
 * @param options 全部选项
 * @param picked 已选值
 * @returns 组名；`undefined` = 不展开二级
 */
export function activeGroup(options: readonly FilterOption[], picked: Picked): string | undefined {
	if (picked.length === 0) return undefined;

	for (const group of groupOf(options)) {
		if (group.key !== '' && isGroupPicked(group, picked)) return group.key;
	}

	if (picked.length === 1) {
		const only = picked[0];
		const hit = options.find((one) => one.value === only);
		if (hit !== undefined) {
			const key = groupKeyOf(hit);
			if (key !== '') return key;
		}
	}

	return undefined;
}

/** 值 → 显示名（找不到回落 value 本身，不抛 —— 脏数据也要能显示）。 */
export function labelOf(options: readonly FilterOption[], value: string): string {
	return options.find((one) => one.value === value)?.label ?? value;
}

/**
 * 收起态显示什么。
 *
 * | 已选 | 显示 |
 * |---|---|
 * | 无 | `''`（组件只画标题）|
 * | 整组 | 组名（`完成`）|
 * | 单项 | `组/项`（`完成/成功`），无组时只有项名 |
 * | 多项不构成整组 | 各项名用 `/` 连（`成功/失败`）|
 *
 * @param options 全部选项
 * @param picked 已选值
 */
export function selectionText(options: readonly FilterOption[], picked: Picked): string {
	if (picked.length === 0) return '';

	for (const group of groupOf(options)) {
		if (group.key !== '' && isGroupPicked(group, picked)) return group.key;
	}

	if (picked.length === 1) {
		const only = picked[0] as string;
		const hit = options.find((one) => one.value === only);
		if (hit === undefined) return only;
		const key = groupKeyOf(hit);
		return key === '' ? hit.label : `${key}/${hit.label}`;
	}

	return picked.map((one) => labelOf(options, one)).join('/');
}

/**
 * 点一个**项**（一级的无组方框 / 二级的子项）之后的已选值。
 *
 * 单选语义：
 * · 已是「唯一选中项」→ **取消**（返回 `[]`）
 * · 否则 → **替换**成它
 *
 * ⚠ **不能用 `picked.includes(value)` 判。**
 * 点整组后 `picked` 里包含组内每个值，此时再点其中一项，
 * 若用 `includes` 会判成「已选 ⇒ 取消 ⇒ 全清」，而不是「收窄到这一项」。
 * 旧版注释明确写了这个坑。
 *
 * @param picked 当前已选
 * @param value 被点的值
 */
export function pickOption(picked: Picked, value: string): Picked {
	const alreadyOnly = picked.length === 1 && picked[0] === value;
	return alreadyOnly ? [] : [value];
}

/**
 * 点一个**组**（一级的组项）之后的已选值。
 *
 * · 该组已整组选中 → **取消**（返回 `[]`）
 * · 否则 → **选中整组**（组内全部值）
 *
 * @param group 被点的组
 * @param picked 当前已选
 */
export function pickGroup(group: FilterGroup, picked: Picked): Picked {
	return isGroupPicked(group, picked) ? [] : group.options.map((one) => one.value);
}

/** 一级要画的一项：要么是个组，要么是个独立项。 */
export interface LevelOneEntry {
	/** `group` = 有分组的组项；`option` = 无分组的独立项。 */
	readonly kind: 'group' | 'option';
	readonly label: string;
	readonly picked: boolean;
	/** 点它之后的已选值。 */
	readonly next: Picked;
}

/**
 * 一级要画什么（**已算好「点它会变成什么」**）。
 *
 * 组件拿到这个数组后只做两件事：画分隔符 `|`、把 `next` 交给 `onChange`。
 * —— 任何「点一下会怎样」的判断都不该在组件里。
 *
 * @param options 全部选项
 * @param picked 已选值
 */
export function levelOne(options: readonly FilterOption[], picked: Picked): readonly LevelOneEntry[] {
	if (!hasGroups(options)) {
		return options.map((option) => ({
			kind: 'option',
			label: option.label,
			picked: picked.length === 1 && picked[0] === option.value,
			next: pickOption(picked, option.value),
		}));
	}

	return groupOf(options).map((group) => ({
		kind: 'group',
		label: group.key,
		picked: isGroupPicked(group, picked),
		next: pickGroup(group, picked),
	}));
}

/**
 * 二级要画什么；不该展开时返回 `undefined`。
 *
 * @param options 全部选项
 * @param picked 已选值
 */
export function levelTwo(
	options: readonly FilterOption[],
	picked: Picked,
): readonly LevelOneEntry[] | undefined {
	const key = activeGroup(options, picked);
	if (key === undefined) return undefined;

	const group = groupOf(options).find((one) => one.key === key);
	if (group === undefined) return undefined;

	return group.options.map((option) => ({
		kind: 'option',
		label: option.label,
		picked: picked.includes(option.value),
		next: pickOption(picked, option.value),
	}));
}

/**
 * 收起态该拆成几个可点区。
 *
 * 旧版用户指令：
 * > 「筛选选中以后，左边和右边至少要有一个是点击取消并展开，一个是单纯展开。
 * >  现在两边都是点开展开，再点取消。不方便。取消筛选是很常规的用法。」
 *
 * ⇒ 已选中时：**左**（标题＋已选值）＝ 取消筛选并展开；**右 ▾** ＝ 只展开。
 *   没选中时：整个方框就是「展开」，不拆。
 *
 * @param picked 已选值
 * @returns `split = true` 时组件要画左右两个可点区
 */
export function collapsedSplit(picked: Picked): boolean {
	return picked.length > 0;
}
