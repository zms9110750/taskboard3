/**
 * 派生子任务浮窗的**渲染决定**（纯逻辑，可 `node --test`）。
 *
 * ## 用户裁决（`2026-11-22`）
 *
 * > 「派生子任务，这个按钮点了以后应该有一个浮窗菜单。这个菜单要是一个组件。要做。」
 * > 「你去看看模板定义。他有说自己快捷派生的内容。如果没有定义，就留一个保留的按钮，
 * >   派生空模板。」
 * > 「派生的模板定义是为 ui 服务的快捷入口。从这里点击的派生就是走新建。
 * >   自动设置父任务和标题和模板。只有这个效果。」
 * > 「也就是说点进去了以后模板可以换标题可以换父任务也可以换。
 * >   也就是说 aitool 用不到这个功能，他就是直接走新建。」
 *
 * ⇒ 这个文件只算**菜单项**和**预填值**，不碰 React、不碰 DOM。
 *   组件（`DeriveMenu.tsx`）只把结果画出来。
 *
 * ## 为什么是纯逻辑
 *
 * 三条判定都要能被单测钉住：
 *
 * 1. `derives` 为空要不要兜底（要 —— 否则菜单是空的，点不到任何东西）
 * 2. 兜底那一项指向什么模板（**空模板 ref**，不是「当前模板」）
 * 3. 预填标题怎么算（父卡标题 + 空格 + 子任务？还是空？）
 *
 * 写在组件里就只能靠 CDP 截图验证，改一次要开一次浏览器。
 */

import type { Card, TemplateSummary } from '../types.ts';
import type { TemplateDerive } from '../api.ts';

/**
 * 一个菜单项。
 *
 * ⚠ `template === null` = **空模板**（不是「没选模板」）——
 *   `null` 和 `''` 的差别在这里是有意义的：`''` 在 `CreateDraft.templateRef` 里
 *   表示「还没选」，而 `null` 表示「故意选空模板」。转成草稿时 `null → ''`
 *   会让 core 报「必须选择模板」。
 *
 * ⇒ 本类型**不带 ref 的空值**，由 `derivePickOf()` 负责换算。
 */
export interface DeriveMenuItem {
	/** 稳定的 key（React 列表用）。`'__empty__'` 是兜底项。 */
	readonly key: string;
	/** 按钮文字。 */
	readonly label: string;
	/** 悬浮说明；`undefined` = 不显示。 */
	readonly description?: string;
	/**
	 * 目标模板 ref。
	 *
	 * `null` = **空模板**（用户裁决：「派生空模板」）。
	 */
	readonly template: string | null;
}

/**
 * 兜底项的 key（`derives` 为空、或用户显式点「派生空模板」时用）。
 *
 * ⚠ 用前置双下划线，避免和任何真实模板 ref 撞 —— 模板 ref 来自文件名，
 *   文件系统允许下划线，但 `__empty__` 这种名字不会有人拿来当模板名。
 */
export const EMPTY_DERIVE_KEY = '__empty__';

/** 兜底项的文案（用户裁决：「留一个保留的按钮，派生空模板」）。 */
export const EMPTY_DERIVE_LABEL = '派生空模板';

/** 兜底项的说明。 */
export const EMPTY_DERIVE_DESCRIPTION = '模板没有声明快捷派生。用空模板新建，章节自己定。';

/**
 * 菜单标题。
 *
 * ⚠ 「子任务」而不是「派生」——用户说的是「派生子任务」，
 *   而「派生」是他的原话里唯一一个既是动词又是关系名的词（`derives` 关系）。
 */
export const DERIVE_MENU_TITLE = '派生子任务';

/** 菜单脚注（说清「进去还能改」这件事，用户裁决的第 5 条）。 */
export const DERIVE_MENU_FOOTER =
	'选一个只是预填父任务/标题/模板 —— 进去以后三样都能改。';

/**
 * 模板的 `derives` → 菜单项。
 *
 * ## `derives` 为空时的兜底（用户裁决：「留一个保留的按钮，派生空模板」）
 *
 * 返回**恰好一项**：`派生空模板`，`template: null`。
 *
 * ⚠ 不返回空数组。空数组会让菜单画成一个空框 —— 用户点了按钮看到空框
 *   会以为界面坏了。兜底项保证「菜单至少有一条能点」。
 *
 * ## 为什么不在末尾**额外**加「派生空模板」
 *
 * `derives` 非空说明模板作者明确给了快捷入口 ⇒ 那是他的设计。
 * 再塞一个「空模板」会稀释掉「快捷」的语义（用户要的是**快捷**入口，
 * 不是「顺便还能建个空卡」）。真要建空卡，走工具栏的「新建」。
 *
 * @param derives 模板的派生声明（来自 `TemplateDetail.derives`）
 * @returns 菜单项（**非空**）
 */
export function deriveMenuItemsOf(derives: readonly TemplateDerive[]): readonly DeriveMenuItem[] {
	if (derives.length === 0) {
		return [
			{
				key: EMPTY_DERIVE_KEY,
				label: EMPTY_DERIVE_LABEL,
				description: EMPTY_DERIVE_DESCRIPTION,
				template: null,
			},
		];
	}

	return derives.map((one, index) => ({
		/*
		 * key 带下标：`derives` 里可能出现两条指向同一模板的项（不同文案），
		 * 只用 `one.template` 会让 React 报警告。
		 */
		key: `${String(index)}:${one.template}`,
		label: one.label,
		...(one.description === undefined ? {} : { description: one.description }),
		template: one.template,
	}));
}

/**
 * 一个菜单项被点了 ⇒ 建卡页的三样预填值。
 *
 * ## 用户裁决：预填**三样**（父任务、标题、模板）
 *
 * | 字段 | 值 | 为什么 |
 * |---|---|---|
 * | `parentId` | **父卡的 id** | 用户：「自动设置父任务」 |
 * | `templateRef` | 菜单项的模板；空模板项 ⇒ `''` | 用户：「自动设置……模板」 |
 * | `title` | 父卡标题 + 「 的子任务」 | 用户：「自动设置……标题」 —— 但**要能一眼看出是新卡** |
 *
 * ## ⚠ 标题为什么不是空的
 *
 * 空标题会让建卡页一打开就是「必填项标红」的状态（`validateCreate` 会报
 * `FIELD_REQUIRED`），用户第一眼看到的是错误。预填一个**能被改**的初值
 * 比「让他自己从零写」好 —— 而且他本来就要改（用户的第 5 条。
 *
 * ## ⚠ 空模板项的 `templateRef` 是 `''` 吗
 *
 * 是。`CreateDraft.templateRef === ''` 表示「还没选模板」，建卡页会让用户选。
 * **这不是「选了空模板」** —— 当前 core 里没有「空模板」这个具体 ref
 * （18 个模板都有 sections；空模板是「模板自身没写 kind/domain」那种，
 * 用户裁决「空模板允许建卡」说的是**建卡校验**放行，不是有个叫空的模板文件）。
 *
 * ⇒ 所以「派生空模板」的**真实效果** = 打开建卡页 + 父任务和标题已填 + 模板待选。
 *   这正好符合用户说的「进去以后模板可以换」。
 *
 * @param parent 父卡
 * @param item 被点的菜单项
 */
export function derivePrefillOf(
	parent: Card,
	item: DeriveMenuItem,
): {
	readonly parentId: string;
	readonly title: string;
	readonly templateRef: string;
} {
	return {
		parentId: parent.id,
		title: `${parent.title} 的子任务`,
		templateRef: item.template ?? '',
	};
}

/**
 * 父卡的模板 ref → 「该读哪个模板的 `derives`」。
 *
 * ## ⚠ 为什么不是 `parent.template.ref` 直接读
 *
 * 是直接读。这个函数存在的理由是**把「可能为空」写成一个地方** ——
 * `Card.template.ref` 可能是空串（卡的数据被改坏 / 旧数据），
 * 那时读不到模板，调用方要当 `derives: []` 处理（⇒ 兜底项）。
 *
 * @param parent 父卡
 * @returns 要查的模板 ref；`undefined` = 没有可用模板
 */
export function deriveSourceOf(parent: Card): string | undefined {
	const ref = parent.template.ref;
	return ref === '' ? undefined : ref;
}

/**
 * 模板清单里找某个 ref 的显示名（给菜单项做「目标模板：xxx」的副标题）。
 *
 * @param templates 模板摘要清单
 * @param ref 模板 ref
 * @returns 显示名；找不到返回 `undefined`
 */
export function templateLabelOf(
	templates: readonly TemplateSummary[],
	ref: string,
): string | undefined {
	return templates.find((one) => one.ref === ref)?.displayName;
}
