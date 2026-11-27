/**
 * 状态菜单的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * 语义来源：旧版 `taskboard2/packages/browser/public/views/card-detail/status-menu.js`（125 行）
 * + `lib/actions.js` 的 `groupActions()` / `hintOf()`（161-175、104-116 行）
 * + `lib/menu.js`（247 行，定位 / 点外面收起）。每条判决下面都标了对应旧代码。
 *
 * ## ① 菜单内容只有一个来源：`protocol` 的按钮表
 *
 * 旧版文案来自 ⑧ 的 `GET /api/cards/:id/actions`；v3 同一条规矩，**只是来源换成
 * `@taskboard/protocol` 的 `BUTTON_ACTIONS`**：
 *
 * ```ts
 * buttonsOf(kind, from, 'user')   // ← 窗口里的唯一入口
 * ```
 *
 * ⇒ 这里**不写任何按钮文案**，也不改写 `action.label`。图标 / 灰字 / 危险色
 *   都是从 `action` 派生出来的**装饰**，派生错不影响行为。
 *
 * ## ② 分组：v3 没有 `group`，用**目标状态所属的组**自己算
 *
 * 旧版 `CardAction` 有服务端给的 `group: 'active' | 'shelved' | 'end'`，
 * v3 的 `ButtonAction` 只有 `{ kind, from, to, label, actors, method }`。
 * 旧字段的语义是「**这个按钮把卡带到哪一类状态**」——
 * 恰好就是 `groupOf(action.to)` 的语义，所以用 `to` 反推，不新增状态。
 *
 * ⚠ **与旧版 `templates/src/actions.ts` 的已知偏差**（照任务描述实现，
 *   但旧代码有 4 处手写例外，记录在此避免下次误判为 bug）：
 *
 * | 按钮 | 旧版手写的 group | `groupOf(to)` | 偏差 |
 * |---|---|---|---|
 * | `adopt`（design / record）| `active` | `shelved`（目标 `AUTH_REQUIRED`）| 有 |
 * | `confirm`（design / record）| `active` | `ended`（目标 `COMPLETED`）| 有 |
 * | `reopen`（design）| `active` | `shelved`（目标 `AUTH_REQUIRED`）| 有 |
 *
 * 旧版理由是「采纳 / 确认 / 重开都是**推进**，所以归 `active`」；
 * v3 的组是**状态组**（草稿 / 进行 / 搁置 / 完成），两者不是同一个概念。
 * 本文件按任务描述用状态组，**视觉上都是分隔线**，用户看不出差别；
 * 若将来要恢复旧口径，改的只有 `sectionsOf()` 一处。
 *
 * ## ③ 图标 / 灰字 / 危险色都是派生，查不到有默认值
 *
 * 旧版 `ICONS` 按 `action.id` 查表（`adopt` / `claim` / … / `reopen`）。
 * v3 没有 `id` ⇒ 按 `method` + `from` / `to` 派生，**查不到给 `·`** ——
 * 图标错了不影响行为（不像文案错了会误导），所以允许默认值。
 */

import {
	GROUP_LABELS,
	TaskState as S,
	groupOf,
	labelOf,
	type ButtonAction,
	type StatusGroup,
} from '@taskboard/protocol';

import { stateTone, type StateTone } from './card-view.ts';

/* ══════════════════════════════════════════════════════════
   词（全部照抄旧版，一个字不改）
   ══════════════════════════════════════════════════════════ */

/** 菜单标题（旧版 `status-menu.js:76`）。 */
export const MENU_TITLE = '变更状态';

/**
 * 页脚说明（旧版 `status-menu.js:83`）。
 *
 * ⚠ 这句解释「为什么状态按钮不放在正文旁边」—— 是**产品口径**，不是随便的提示语。
 */
export const MENU_FOOTER =
	'状态变更会影响 AI 能否继续这张单，所以都收在这里，不在正文旁边直接放按钮。';

/** 空菜单文案。旧版是 toast「这张卡现在没有可用的操作。」+ 不显示菜单。 */
export const MENU_EMPTY = '这张卡现在没有可用的操作。';

/** 状态胶囊的 caret（旧版 `header.js:42`）。 */
export const PILL_CARET = '⌄';

/* ══════════════════════════════════════════════════════════
   装饰：图标
   ══════════════════════════════════════════════════════════ */

/**
 * 图标表 —— 视觉装饰，**不是文案**。
 *
 * 旧版 `status-menu.js:114-124` 的表按 `action.id` 查；v3 没有 `id`，
 * 按 `method` + 目标状态派生。查不到 → `ICON_UNKNOWN`（`·`）。
 */
export const ICON_ADOPT = '✓';
export const ICON_CLAIM = '▶';
export const ICON_RELEASE = '‖';
export const ICON_COMPLETE = '✓';
export const ICON_FAIL = '✕';
export const ICON_CANCEL = '⊘';
export const ICON_REJECT = '✕';
export const ICON_REOPEN = '↺';
export const ICON_UNKNOWN = '·';

/**
 * 一个按钮左侧的图标。
 *
 * ⚠ 优先级链与旧实现严格一致：`method`（adopt/claim/release 全集先命中）→
 * `from === CANCELED`（重开）→ `to` 查表 → `ICON_UNKNOWN` 兜底。
 * 设计的「重开」目标是 `AUTH_REQUIRED`（不是 `SUBMITTED`），只按 `to` 查会漏成 `·`。
 *
 * @param action 一个按钮
 */
/* 方法 → 图标。`transition` 故意不在表里（走 from/to 派生）。
 * ⚠ 这里用「Partial 标注」而不是 AGENTS 3.7 的 satisfies：表**故意缺键**，
 *   需要用 ButtonMethod 整体索引（satisfies 会把对象类型收窄成自有的键集，索引报 TS7053）。
 *   新鲜字面量 + 标注仍保留**多余键检查**——3.7 真正要防的方向没丢。 */
const METHOD_ICONS: Readonly<Partial<Record<ButtonAction['method'], string>>> = {
	adopt: ICON_ADOPT,
	claim: ICON_CLAIM,
	release: ICON_RELEASE,
};

/* 目标状态 → 图标（只列有专属图标的四个；其余走 `ICON_UNKNOWN` 兜底）。 */
const TARGET_ICONS: Readonly<Partial<Record<S, string>>> = {
	[S.COMPLETED]: ICON_COMPLETE,
	[S.FAILED]: ICON_FAIL,
	[S.CANCELED]: ICON_CANCEL,
	[S.REJECTED]: ICON_REJECT,
};

export function iconOf(action: ButtonAction): string {
	return (
		METHOD_ICONS[action.method] ??
		(action.from === S.CANCELED ? ICON_REOPEN : (TARGET_ICONS[action.to] ?? ICON_UNKNOWN))
	);
}

/* ══════════════════════════════════════════════════════════
   装饰：右侧灰字
   ══════════════════════════════════════════════════════════ */

/**
 * 右侧灰色小字 —— 目标状态的中文名，**与按钮文案相同时留空**。
 *
 * 旧版 `lib/actions.js:104-116` 的三级优先：服务端 `hint` → 目标状态名 → 空。
 * v3 的 `ButtonAction` **没有 `hint` 字段** ⇒ 只剩第 ②③ 级。
 *
 * ⚠ 为什么同文要留空：状态名与动作名会撞 ——「取消」按钮的目标状态也叫「取消」，
 *   右写「取消」等于什么都没说，一行里还会出现两个「取消」（旧截图里已见）。
 *   灰字是附加信息，没有信息量就不放。
 *
 * @param action 一个按钮
 */
export function hintOf(action: ButtonAction): string {
	const target = labelOf(action.to);
	if (target === '' || target === action.label) return '';
	return target;
}

/* ══════════════════════════════════════════════════════════
   装饰：着色
   ══════════════════════════════════════════════════════════ */

/**
 * 菜单项的着色 —— **按目标状态的色相**，不是按「危险 / 不危险」二分。
 *
 * ## 为什么删掉 `isDangerAction()`
 *
 * 旧版 `danger: true` 标在 失败 / 取消 / 拒绝（否决、否认）/ 删除 上，
 * 用同一个红色。用户 `2026-11-18` 否了这个：
 *
 * > 「他们目前的红色看起来像个错误。可能有不正确的视觉引导」
 *
 * 他说得对：**取消是褐、拒绝是橙，本来就不该是红。红色只该给「失败」。**
 *
 * ## 为什么不保留 `danger: boolean` 再加一个 `tone`
 *
 * 两个字段回答同一个问题（「这项画什么颜色」）⇒ 两个真值来源 ⇒ 迟早不一致。
 * 而 `danger` 是 **9 状态塌缩成 2**（红 / 非红）的有损映射 ——
 * 有了 9 色之后，这个塌缩本身就是错的信息。
 *
 * ⇒ `isDangerAction()` / `DANGER_TARGETS` **整个删掉**，只留 `stateTone(action.to)`。
 *   「是不是红」变成 `tone === 'failed'`，是色相的一个特例，不是独立概念。
 *
 * @param action 一个按钮
 */
export function toneOf(action: ButtonAction): StateTone {
	return stateTone(action.to);
}

/* ══════════════════════════════════════════════════════════
   分组
   ══════════════════════════════════════════════════════════ */

/**
 * 组顺序 —— **状态枚举的自然顺序**：草稿 → 进行 → 搁置 → 完成。
 *
 * ⚠ 就是任务描述里的 `active → shelved → ended`：按钮永远不指向草稿
 *   （`BUTTON_ACTIONS` 里没有一条 `to === UNSPECIFIED`），所以草稿段恒为空、
 *   会被 `sectionsOf()` 过滤掉。保留它是为了「将来若有按钮指向草稿，它不会**被静默丢掉**」——
 *   丢掉一个按钮 = 用户点不到那个转移，比多一段更坏。
 */
export const GROUP_ORDER: readonly StatusGroup[] = Object.freeze([
	'draft',
	'active',
	'shelved',
	'ended',
] as const);

/** 菜单里的一项：按钮本体 + 三个装饰派生值。 */
export interface MenuItem {
	/** 原样来自 `buttonsOf()`，组件不改写。 */
	readonly action: ButtonAction;
	/** 左侧图标（装饰）。 */
	readonly icon: string;
	/** 右侧灰字（空串 = 不显示）。 */
	readonly hint: string;
	/** 视觉档位 —— 按**目标状态**取，决定文字色（见 `toneOf()` 的注释）。 */
	readonly tone: StateTone;
}

/** 菜单的一段（组）。 */
export interface MenuSection {
	readonly group: StatusGroup;
	/** 组的中文名（旧版**不显示**组名，只画分隔线；这里给 `aria-label`）。 */
	readonly label: string;
	readonly items: readonly MenuItem[];
}

/** 整个菜单的渲染决定。 */
export interface MenuModel {
	readonly title: string;
	readonly footer: string;
	readonly sections: readonly MenuSection[];
	/** `true` = 没有可用按钮（组件显示 `MENU_EMPTY`）。 */
	readonly empty: boolean;
}

/**
 * 把按钮按「目标状态所属的组」分段。
 *
 * 旧版 `lib/actions.js:170-175`：固定顺序、**空段不返回**（视图不用再判 `items.length === 0`）。
 *
 * @param actions `buttonsOf()` 的结果（顺序即组内顺序）
 */
export function sectionsOf(actions: readonly ButtonAction[]): readonly MenuSection[] {
	return GROUP_ORDER.map((group) => ({
		group,
		label: GROUP_LABELS[group],
		items: actions
			.filter((one) => groupOf(one.to) === group)
			.map((action) => ({
				action,
				icon: iconOf(action),
				hint: hintOf(action),
				tone: toneOf(action),
			})),
	})).filter((section) => section.items.length > 0);
}

/**
 * 菜单的完整渲染决定。
 *
 * @param actions `buttonsOf(kind, from, 'user')`
 */
export function menuModelOf(actions: readonly ButtonAction[]): MenuModel {
	const sections = sectionsOf(actions);
	return {
		title: MENU_TITLE,
		footer: MENU_FOOTER,
		sections,
		empty: sections.length === 0,
	};
}

/* ══════════════════════════════════════════════════════════
   定位（照抄旧版 `lib/menu.js:41-98` 的算法，纯函数化）
   ══════════════════════════════════════════════════════════ */

/** 菜单固定宽度（旧版 `MENU_WIDTH = 280`）。 */
export const MENU_WIDTH = 280;

/** 距窗口边缘的最小留白（旧版 `MARGIN = 8`）。 */
export const MENU_MARGIN = 8;

/** 触发按钮下面留的间隙（旧版 `rect.bottom + 4`）。 */
export const MENU_GAP_BELOW = 4;

/** 翻到上方时留的间隙（旧版 `rect.top - height - 6`）。 */
export const MENU_GAP_ABOVE = 6;

/** 截断时允许的最小高度（旧版 `Math.max(140, sideSpace)`）。 */
export const MENU_MIN_HEIGHT = 140;

/** 一个矩形（只用左上右下，与 `getBoundingClientRect()` 同形）。 */
export interface Rect {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** 定位结果。 */
export interface Placement {
	/** 距视口左边缘（`position: fixed` 下直接写 `left`）。 */
	readonly left: number;
	/** 距视口上边缘（直接写 `top`）。 */
	readonly top: number;
	/** 高度上限；放得下时就等于自然高度。 */
	readonly maxHeight: number;
	/** `true` = 翻到了按钮上方。 */
	readonly above: boolean;
}

/**
 * 算菜单该放哪。
 *
 * ## 放置策略（旧版 `lib/menu.js:31-39` 的注释，逐条照做）
 *
 * · **水平：菜单左边缘对齐触发按钮左边缘** ——
 *   用户 `2026-11-09 18:25`：「点击状态按钮，他弹出的子菜单，应该在状态按钮的正下方的。
 *   他跑出去老远。」原来右对齐到详情面板右边缘，实测偏 158px。
 * · **垂直：优先向下**，间隙 4px；下方放不下 ⇒ 翻到上方（间隙 6px）；
 *   两侧都放不下 ⇒ 选空间大的一侧，并 `max-height` 截断（菜单内部滚动）。
 *
 * ## ⚠ 为什么高度是**入参**而不是自己量
 *
 * 旧版注释里是一个真 bug：元素在 `appendChild` 之前 `offsetHeight` 恒为 0
 * （实测同一份菜单脱离时 0、挂上后 71）⇒ 若在挂之前读，永远拿 0、回落硬编码 240，
 * 「上方放不放得下」用的是假高度。
 * ⇒ 顺序固定：**挂上去（先 hidden）→ 量真实高度 → 再写 left/top**。
 *   组件遵守这个顺序，把量到的高度传进来；这里不做「猜高度」。
 *
 * @param anchor 触发按钮的矩形
 * @param naturalHeight 菜单挂上后量到的真实高度
 * @param viewport 视口尺寸（`innerWidth` / `innerHeight`）
 */
// TODO(审查): 手写定位的边界数学（flip/clamp/最大高度）可直接换 @floating-ui/dom 的 computePosition+flip/shift/size；同类手写在 DeriveMenu.tsx:98、StatusMenu.tsx:101、TemplatePickerPopover.tsx:184、PermissionBoxPopover.tsx:72，Drawer.tsx:246-264 还靠 100ms 轮询补位。统一后可删本函数与相关常量，需用户决定是否加该依赖。
export function placeMenu(
	anchor: Rect,
	naturalHeight: number,
	viewport: { readonly width: number; readonly height: number },
): Placement {
	const minLeft = MENU_MARGIN;
	const maxLeft = viewport.width - MENU_WIDTH - MENU_MARGIN;
	const minTop = MENU_MARGIN;
	const maxBottom = viewport.height - MENU_MARGIN;

	const spaceBelow = maxBottom - anchor.bottom - MENU_MARGIN;
	const spaceAbove = anchor.top - minTop - MENU_MARGIN;

	const placeBelow = spaceBelow >= naturalHeight;
	const placeAbove = !placeBelow && spaceAbove >= naturalHeight;
	const sideSpace = placeBelow
		? spaceBelow
		: placeAbove
			? spaceAbove
			: Math.max(spaceAbove, spaceBelow);

	const above = !placeBelow && (placeAbove || spaceAbove > spaceBelow);
	const maxHeight = Math.max(MENU_MIN_HEIGHT, sideSpace);

	/* 水平：对齐按钮左边缘；`Math.max` 只兜「别出左边」，右边真放不下就交给窗口截。 */
	const left = Math.max(minLeft, Math.min(anchor.left, Math.max(minLeft, maxLeft)));
	const top = above
		? Math.max(minTop, anchor.top - naturalHeight - MENU_GAP_ABOVE)
		: Math.min(anchor.bottom + MENU_GAP_BELOW, Math.max(minTop, maxBottom - naturalHeight));

	return { left, top, maxHeight, above };
}

/* ══════════════════════════════════════════════════════════
   键盘
   ══════════════════════════════════════════════════════════ */

/**
 * 一个按键对菜单意味着什么。
 *
 * ⚠ **旧版 `lib/menu.js` 里没有键盘导航**（247 行只有定位 / 点外面 / 滚动关闭）。
 *   任务描述说「键盘导航在那里」—— 与源码不符，见交付说明里的「不一致」。
 *   这里是**新增**能力，规则取最常见的菜单惯例：上下移动、Home/End 跳首尾、
 *   Enter 选中、Escape 关闭；其余键返回 `'none'`（不拦截）。
 */
export type KeyIntent = 'next' | 'prev' | 'first' | 'last' | 'pick' | 'close' | 'none';

/**
 * 按键 → 意图。
 *
 * @param key `KeyboardEvent.key`
 */
export function keyIntentOf(key: string): KeyIntent {
	switch (key) {
		case 'ArrowDown':
			return 'next';
		case 'ArrowUp':
			return 'prev';
		case 'Home':
			return 'first';
		case 'End':
			return 'last';
		case 'Enter':
		case ' ':
			return 'pick';
		case 'Escape':
			return 'close';
		default:
			return 'none';
	}
}

/**
 * 按意图算下一个高亮项的下标（**循环**，空列表返回 -1）。
 *
 * @param current 当前高亮下标；`-1` = 还没有高亮
 * @param intent 键盘意图
 * @param count 菜单项总数
 * @returns 新高亮下标；`-1` = 没有可高亮的项
 */
export function nextIndex(current: number, intent: KeyIntent, count: number): number {
	if (count <= 0) return -1;

	switch (intent) {
		case 'next':
			return current < 0 ? 0 : (current + 1) % count;
		case 'prev':
			return current <= 0 ? count - 1 : current - 1;
		case 'first':
			return 0;
		case 'last':
			return count - 1;
		default:
			return current;
	}
}

/**
 * 「点在菜单/按钮外面」判定 —— **用 `composedPath()`，不用 `contains()`**。
 *
 * ## 为什么
 *
 * 旧版 `lib/menu.js:134-154` 用的是 `menu.contains(target)` / `anchor.contains(target)`，
 * 注释里解释过它为什么必须用 `contains`：`event.target` 往往是菜单项里的**文字元素**，
 * 不是 `<button>` 本身，所以不能拿 `target === menuItem` 比。
 *
 * 但在 **React** 里 `contains()` 还有第二个坑：点菜单项时 React 会**换节点**
 * （重渲染 / 状态切换），等到捕获阶段的监听跑起来，`event.target` 可能已经
 * 不在 `menu` 树里了 ⇒ `contains()` 判成「点在外面」⇒ 菜单先被关掉，
 * 菜单项自己的 onClick 再跑就晚了。
 *
 * ⇒ `composedPath()` 给出的是**事件发生那一刻的路径**（含 shadow DOM 的穿透路径），
 *   不受事后节点替换影响。三个条件都从路径里判：
 *   路径含菜单根 ⇒ 不是外面；路径含触发按钮 ⇒ 不是外面（交给按钮自己 toggle）。
 *
 * @param path `event.composedPath()`
 * @param menu 菜单根节点
 * @param anchor 触发按钮
 * @returns `true` = 该关掉
 */
export function isOutsideClick(
	path: readonly EventTarget[],
	menu: EventTarget | null,
	anchor: EventTarget | null,
): boolean {
	if (path.length === 0) return true;
	if (menu !== null && path.includes(menu)) return false;
	if (anchor !== null && path.includes(anchor)) return false;
	return true;
}

