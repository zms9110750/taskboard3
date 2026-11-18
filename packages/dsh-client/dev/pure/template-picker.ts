/**
 * 模板**三级联选**的纯逻辑（领域 → 类别 → 模板）—— 零 React、零 DOM。
 *
 * ## 为什么单独一个文件
 *
 * 这一块唯一的难点是**「点了没反应」**那个失效方式，而它读代码看不出来：
 *
 * 三级联选重画时要用「当前浏览位置」（领域列高亮谁、类别列显示谁、模板列显示谁）。
 * 如果那个位置是**重画函数的局部变量**，点一下重画就把它重新初始化成第一项 ——
 * 表现是「点『代码』，模板列还是核心那三个」。
 *
 * 旧版 `taskboard2/.../template-picker.ts` 的注释记了这个症状
 * （「实测症状：点「核心」再点「目标」，模板列还是「代码 / 设计」那三个」），
 * 解决办法是**把浏览位置写回状态**。
 *
 * ⇒ 本文件把「点一下之后，新的浏览位置是什么」变成**纯函数**：
 *   组件的状态是 `BrowseState`，点事件只调 `clickDomain` / `clickKind`，
 *   没有别的路径能改它，`setState(纯函数(old, 参数))` 也就不会漏。
 *
 * ## 和旧版的一处有意差别
 *
 * 旧版 `browseDomain === ''` 时回落到「已选模板所在的领域」，再回落到第一项。
 * 这里保留同样的优先级，但**把它写成 `resolveBrowse()` 一个函数**，
 * 打开弹层时直接 `setBrowse(resolveBrowse(...))` —— 而不是在渲染里算。
 * （渲染里算 + 写回 = 每次渲染都 `setState`，React 会警告循环更新。）
 */

import type { CatalogTemplate, TemplateKind } from '../components/create/data.ts';

/* ══════════════════════════════════════════════════════════
   分组
   ══════════════════════════════════════════════════════════ */

/** 三级联选里的一个类别。 */
export interface PickerKind {
	readonly kind: TemplateKind;
	/** 类别中文名（`目标` / `设计` …）。 */
	readonly label: string;
	/** 类别字母（`G` / `D` / `W` / `R`）—— 来自 `KIND_META`，不在渲染里硬编码。 */
	readonly letter: string;
	readonly items: readonly CatalogTemplate[];
}

/** 三级联选里的一个领域。 */
export interface PickerDomain {
	readonly domain: string;
	readonly kinds: readonly PickerKind[];
}

/** 类别的展示顺序（`KIND_ORDER` 同序：goal → design → work → record）。 */
const KIND_ORDER: readonly TemplateKind[] = ['goal', 'design', 'work', 'record'];

/** 领域的展示顺序 —— **核心始终在顶端**（用户 `2026-11-09` 的验收第 3 条）。 */
const DOMAIN_ORDER: readonly string[] = ['核心', '代码'];

/** 领域排序权重（越小越靠前；没列到的排最后，靠 `sort` 的稳定性保持数据顺序）。 */
function domainRank(domain: string): number {
	const index = DOMAIN_ORDER.indexOf(domain);
	return index === -1 ? DOMAIN_ORDER.length : index;
}

/** 类别排序权重。 */
function kindRank(kind: TemplateKind): number {
	const index = KIND_ORDER.indexOf(kind);
	return index === -1 ? KIND_ORDER.length : index;
}

/**
 * 把模板清单分成「领域 → 类别 → 模板」三级。
 *
 * ⚠ **取不到的 `domain` 归「通用」** —— 宁可少一级分组，也不要让模板从选择器里消失
 *   （那会变成「某模板选不到」的静默故障）。
 *
 * @param templates 模板清单（来自 `data.ts` 的 `TEMPLATE_CATALOG`）
 * @param labelOf 类别中文名查表（`KIND_META`），**不在本文件硬编码中文**
 * @param letterOf 类别字母查表
 */
export function buildPickerGroups(
	templates: readonly CatalogTemplate[],
	labelOf: (kind: TemplateKind) => string,
	letterOf: (kind: TemplateKind) => string,
): readonly PickerDomain[] {
	const byDomain = new Map<string, Map<TemplateKind, CatalogTemplate[]>>();

	for (const template of templates) {
		const domain = template.domain === '' ? '通用' : template.domain;
		let kinds = byDomain.get(domain);
		if (kinds === undefined) {
			kinds = new Map();
			byDomain.set(domain, kinds);
		}
		const list = kinds.get(template.kind);
		if (list === undefined) kinds.set(template.kind, [template]);
		else list.push(template);
	}

	const entries = [...byDomain.entries()].sort(([a], [b]) => domainRank(a) - domainRank(b));

	return entries.map(([domain, kinds]) => ({
		domain,
		kinds: [...kinds.entries()]
			.sort(([a], [b]) => kindRank(a) - kindRank(b))
			.map(([kind, items]) => ({
				kind,
				label: labelOf(kind),
				letter: letterOf(kind),
				items,
			})),
	}));
}

/* ══════════════════════════════════════════════════════════
   浏览位置
   ══════════════════════════════════════════════════════════ */

/**
 * 弹层里的**当前浏览位置**。
 *
 * ⚠ 它不是「已选模板」——已选的是 `pickedRef`（父层持有）。
 *   领域/类别只是**浏览**用：决定另外两列显示什么。
 */
export interface BrowseState {
	/** 当前高亮的领域；空串 = 还没定位。 */
	readonly domain: string;
	/** 当前高亮的类别；空串 = 还没定位。 */
	readonly kind: TemplateKind | '';
}

/** 初始浏览位置（打开弹层前）。 */
export const EMPTY_BROWSE: BrowseState = Object.freeze({ domain: '', kind: '' });

/**
 * 打开弹层时该定位到哪里。
 *
 * 优先级（从高到低）：
 *
 * 1. 用户上次浏览的位置（`state` 里已有值）—— 再打开时别跳回第一个
 * 2. 已选模板所在的领域 / 类别 —— 回看已选项时定位回去
 * 3. 第一项 —— 首次打开
 *
 * ⚠ 顺序不能反：若把 ② 放在 ① 前面，「已选模板」会盖掉用户刚点的浏览位置，
 *   表现就是「点了没反应」。
 *
 * @param current 当前浏览位置
 * @param pickedRef 已选模板的 `name`（空串 = 还没选）
 * @param groups 三级分组
 */
export function resolveBrowse(
	current: BrowseState,
	pickedRef: string,
	groups: readonly PickerDomain[],
): BrowseState {
	let domain = current.domain;
	let kind = current.kind;

	/* ② 已选模板所在的分组 */
	if (domain === '' && pickedRef !== '') {
		for (const group of groups) {
			for (const one of group.kinds) {
				if (one.items.some((item) => item.name === pickedRef)) {
					domain = group.domain;
					kind = one.kind;
				}
			}
		}
	}

	/* ③ 第一项 */
	if (domain === '') domain = groups[0]?.domain ?? '';
	if (kind === '') kind = groups.find((one) => one.domain === domain)?.kinds[0]?.kind ?? '';

	/* 位置可能已经失效（模板清单换了）：回落，别留一个指向不存在的领域。 */
	const group = groups.find((one) => one.domain === domain);
	if (group === undefined) {
		const first = groups[0];
		return first === undefined
			? EMPTY_BROWSE
			: { domain: first.domain, kind: first.kinds[0]?.kind ?? '' };
	}
	const kindExists = group.kinds.some((one) => one.kind === kind);
	return { domain, kind: kindExists ? kind : (group.kinds[0]?.kind ?? '') };
}

/**
 * 点了某一列的某一项之后，新的浏览位置。
 *
 * @param groups 三级分组
 * @param current 当前浏览位置
 * @param target 点的是什么：`'domain'` = 领域列，`'kind'` = 类别列
 * @param value 点中的领域名 / 类别名
 */
export function browseAfterClick(
	groups: readonly PickerDomain[],
	current: BrowseState,
	target: 'domain' | 'kind',
	value: string,
): BrowseState {
	if (target === 'domain') {
		/*
		 * 换领域 ⇒ **类别必须重置**成新领域的第一项。
		 * 旧类别在新领域里可能不存在（`research` 在核心、`writeCode` 在代码），
		 * 不重置的话类别列会空 —— 看起来又像「点了没反应」。
		 */
		const group = groups.find((one) => one.domain === value);
		return {
			domain: value,
			kind: group?.kinds[0]?.kind ?? '',
		};
	}

	const kind = value as TemplateKind;
	/* 点类别 ⇒ 只改类别；领域保持当前值（不回落、不动）。 */
	return { domain: current.domain, kind };
}

/* ══════════════════════════════════════════════════════════
   查表
   ══════════════════════════════════════════════════════════ */

/**
 * 当前浏览位置对应的三个列表。
 *
 * @param groups 三级分组
 * @param browse 浏览位置
 */
export function columnsOf(
	groups: readonly PickerDomain[],
	browse: BrowseState,
): {
	readonly domains: readonly PickerDomain[];
	readonly kinds: readonly PickerKind[];
	readonly templates: readonly CatalogTemplate[];
} {
	const group = groups.find((one) => one.domain === browse.domain);
	const kinds = group?.kinds ?? [];
	const kindGroup = kinds.find((one) => one.kind === browse.kind);
	return {
		domains: groups,
		kinds,
		templates: kindGroup?.items ?? [],
	};
}
