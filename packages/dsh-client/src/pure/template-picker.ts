/**
 * 模板**三级联选**的纯逻辑（领域 → 类别 → 模板）—— 零 React、零 DOM。
 *
 * ## 从哪来
 *
 * 展厅阶段的 `dev/pure/template-picker.ts`（用户 `2026-11-19` 从 6 个变体里选了
 * **④ 三级联选弹层**，见 `docs/组件清单.md`）。本文件是它的产品化版本：
 *
 * | | 展厅版 | 本文件 |
 * |---|---|---|
 * | 模板形状 | `CatalogTemplate`（假目录，`name` 字段） | `PickerTemplate`（**`ref`**，和 `GET /api/templates` 对齐）|
 * | 类别 | `TemplateKind` 四值联合 | **`string`**（第三方可以注册类别，不能写死四个）|
 * | 中文名 / 字母 | 硬编码 `KIND_META` | **调用方传 `labelOf` / `letterOf`**（不编中文）|
 *
 * ## 为什么这一块必须是纯函数
 *
 * 它唯一难的地方是**「点了没反应」**，而那种错读代码看不出来：
 *
 * 三级联选重画时要用「当前浏览位置」（领域列高亮谁、类别列显示谁、模板列显示谁）。
 * 旧版把它放在**重画函数的局部变量**里 ⇒ 点一下重画就重新初始化成第一项 ——
 * 表现是「点『代码』，模板列还是核心那三个」。旧版 `taskboard2/.../template-picker.ts`
 * 的注释记了这个症状，解决办法是**把浏览位置写回状态**。
 *
 * ⇒ 本文件把「点一下之后，新的浏览位置是什么」变成**纯函数**：
 *   组件状态只有 `BrowseState` 一个，改它的路径只有 `resolveBrowse` /
 *   `browseAfterClick` 两个 —— 没有第三条路，也就不会漏写回。
 *
 * ## ⚠ 一个刻意的设计：`resolveBrowse` 的优先级
 *
 * 1. 用户上次浏览的位置（再打开弹层时别跳回第一个）
 * 2. 已选模板所在的领域 / 类别（回看已选项时定位回去）
 * 3. 第一项（首次打开）
 *
 * **顺序不能反**：把 ② 放在 ① 前面，「已选模板」会盖掉用户刚点的浏览位置 ⇒
 * 点了没反应。这一条有单测钉住（`test/template-picker.test.ts`）。
 */

import { KIND_ORDER } from './card-view.ts';

/* ══════════════════════════════════════════════════════════
   模板的形状
   ══════════════════════════════════════════════════════════ */

/**
 * 选择器要的一条模板 —— **`GET /api/templates` 的窄投影**（core 的 `TemplateSummary`）
 * 加上两个**可选**的详情字段。
 *
 * ⚠ `codePrefix` / `usage` / `sectionCount` 是**可选的**：
 * - `codePrefix` 在 `TemplateSummary` 里有（core 的 `summarize` 带它）；
 * - `usage` / `sectionCount` **摘要里没有** —— 它们来自 `GET /api/templates?ref=`
 *   （core 的 `TemplateMeta`）。本组件**不自己发请求**：接上真实接口时由调用方
 *   把详情合进来，没合进来就不显示，**不编**。
 *
 * ⚠ 字段名用 `ref` 不用 `name`：core 的模板标识叫 `ref`（`TemplateSummary.ref`、
 *   `Card.template.ref`）。展厅版的 `CatalogTemplate.name` 是假数据自己的叫法，
 *   产品里必须和协议对齐。
 */
export interface PickerTemplate {
	readonly ref: string;
	readonly displayName: string;
	/** 类别 id（`goal` / `design` / …）。**不窄化成四个字面量** —— 第三方可注册。 */
	readonly kind: string;
	/** 领域（`核心` / `代码` / …）。 */
	readonly domain: string;
	/** 编号字母段（`E` / `U` …）。空串 = 该模板不提供字母段（合法值）。 */
	readonly codePrefix?: string;
	/** 一句话说明（来自模板详情，摘要里没有）。 */
	readonly usage?: string;
	/** 段数（来自模板详情，摘要里没有）。 */
	readonly sectionCount?: number;
}

/* ══════════════════════════════════════════════════════════
   分组
   ══════════════════════════════════════════════════════════ */

/** 三级联选里的一个类别。 */
export interface PickerKind {
	readonly kind: string;
	/** 类别中文名。 */
	readonly label: string;
	/** 类别字母（编号的前半段）。 */
	readonly letter: string;
	readonly items: readonly PickerTemplate[];
}

/** 三级联选里的一个领域。 */
export interface PickerDomain {
	readonly domain: string;
	readonly kinds: readonly PickerKind[];
}

/**
 * 领域的展示顺序。
 *
 * 用户 `2026-11-09` 截图验收第 3 条：
 * > 「现在这个顺序不对。他怎么排序的。核心应该始终在顶端。
 * >  然后中间也是目标，分组，工作，记录的顺序。也就是一个工作流的顺序。」
 *
 * ⚠ 这是**纯展示顺序**（UX 规则），领域本身来自模板数据。没列到的领域排在最后，
 *   靠 `Array#sort` 的稳定性保持数据里的相对顺序。
 */
export const DOMAIN_ORDER: readonly string[] = Object.freeze(['核心', '代码']);

/**
 * 类别中文名的**默认实现**：直接用 id。
 *
 * ⚠ **不编中文**（与 `src/pure/card-view.ts` 同一条判据）：类别中文名来自 core 的
 *   类别注册表，而客户端拿不到它（没有 `/api/kinds` 路由，`src/types.ts` 的
 *   `TemplateSummary` 也不带）。⇒ 默认显示英文 id，由调用方注入真正的中文名。
 */
export function defaultKindLabel(kind: string): string {
	return kind;
}

/**
 * 类别字母的**默认实现**：id 首字母大写。
 *
 * ⚠ 这是**降级**，不是权威：真正的字母在 core 的 `KindRegistry`（`goal → G`）。
 *   降级规则和 core 的注释一致（「取不到用 kind 首字母大写兜底，**不猜中文**」）。
 *   注意这只影响**显示**，不影响发号（发号在 core）。
 */
export function defaultKindLetter(kind: string): string {
	return kind === '' ? '?' : kind.slice(0, 1).toUpperCase();
}

/** 领域排序权重（越小越靠前；没列到的排最后）。 */
function domainRank(domain: string): number {
	const index = DOMAIN_ORDER.indexOf(domain);
	return index === -1 ? DOMAIN_ORDER.length : index;
}

/** 类别排序权重（`KIND_ORDER` 之外的一律排最后，保持数据顺序）。 */
function kindRank(kind: string): number {
	const index = (KIND_ORDER as readonly string[]).indexOf(kind);
	return index === -1 ? KIND_ORDER.length : index;
}

/**
 * 把模板清单分成「领域 → 类别 → 模板」三级。
 *
 * ⚠ **`domain` 为空 ⇒ 归「通用」，不是丢弃** —— 宁可少一级分组，也不要让某个模板
 *   从选择器里消失（那会变成「某模板选不到」的静默故障）。
 *
 * ⚠ 中文名 / 字母**不在这里写死**，走 `labelOf` / `letterOf` 回调 ——
 *   本文件不认识任何具体类别，第三方注册的类别也能显示。
 *
 * @param templates 模板清单（`GET /api/state` 的 `templates`，或预览里的假数据）
 * @param labelOf 类别 id → 中文名
 * @param letterOf 类别 id → 字母
 */
export function buildPickerGroups(
	templates: readonly PickerTemplate[],
	labelOf: (kind: string) => string,
	letterOf: (kind: string) => string,
): readonly PickerDomain[] {
	const byDomain = new Map<string, Map<string, PickerTemplate[]>>();

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
 * ⚠ 它**不是**「已选模板」—— 已选的是 `pickedRef`（在草稿里，父层持有）。
 *   领域 / 类别只决定另外两列显示什么。
 */
export interface BrowseState {
	/** 当前高亮的领域；空串 = 还没定位。 */
	readonly domain: string;
	/** 当前高亮的类别；空串 = 还没定位。 */
	readonly kind: string;
}

/** 初始浏览位置（打开弹层之前）。 */
export const EMPTY_BROWSE: BrowseState = Object.freeze({ domain: '', kind: '' });

/**
 * 打开弹层时该定位到哪里（优先级见文件头）。
 *
 * @param current 当前浏览位置
 * @param pickedRef 已选模板的 `ref`（空串 = 还没选）
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
				if (one.items.some((item) => item.ref === pickedRef)) {
					domain = group.domain;
					kind = one.kind;
				}
			}
		}
	}

	/* ③ 第一项 */
	if (domain === '') domain = groups[0]?.domain ?? '';
	if (kind === '') kind = groups.find((one) => one.domain === domain)?.kinds[0]?.kind ?? '';

	/*
	 * 位置可能已经失效（模板清单变了 / 模板被卸载）⇒ 回落。
	 * 不回落的话领域列会全暗、另外两列全空 —— 又是「点了没反应」的样子。
	 */
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
 * @param target 点的是哪一列：`'domain'` = 领域列，`'kind'` = 类别列
 * @param value 点中的领域名 / 类别 id
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
		return { domain: value, kind: group?.kinds[0]?.kind ?? '' };
	}

	/* 点类别 ⇒ 只改类别；领域保持当前值（不回落、不动）。 */
	return { domain: current.domain, kind: value };
}

/* ══════════════════════════════════════════════════════════
   查表
   ══════════════════════════════════════════════════════════ */

/** 当前浏览位置对应的三列内容。 */
export interface PickerColumns {
	readonly domains: readonly PickerDomain[];
	readonly kinds: readonly PickerKind[];
	readonly templates: readonly PickerTemplate[];
}

/**
 * 当前浏览位置对应的三列。
 *
 * 空串位置 ⇒ 领域列有内容、另外两列空，**不抛**（弹层没打开时的初始态）。
 *
 * @param groups 三级分组
 * @param browse 浏览位置
 */
export function columnsOf(groups: readonly PickerDomain[], browse: BrowseState): PickerColumns {
	const group = groups.find((one) => one.domain === browse.domain);
	const kinds = group?.kinds ?? [];
	const kindGroup = kinds.find((one) => one.kind === browse.kind);
	return { domains: groups, kinds, templates: kindGroup?.items ?? [] };
}
