/**
 * 抽屉（V5 重做）的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * ## 为什么整个重做
 *
 * V4 交的是「1200 × 400、居中于工作区、挂 `shell.overlay` 的浮层」。
 * 用户 `2026-11-20` 否了：**方向全错**。真实设计是：
 *
 * ```
 *    ┌──────────────────────────────┐
 *    │  抽屉面板（从输入框上方向外展开）│  ← 宽度 = 输入框宽，高度 ≈ 屏幕一半
 *    └──────────────────────────────┘
 *            ↑ 面板底边贴输入框上边缘
 *  ┌─┐ ┌────────────────────────┬───┐
 *  │▣│ │ 发消息或创建任务…        │ ➤ │  ← 正方形入口在输入框左外侧、和 + 同一行
 *  └─┘ └────────────────────────┴───┘
 * ```
 *
 * ## ⚠ 挂载点证据（对运行中的 DSH `app.asar` 复核过，`2026-11-20`）
 *
 * 不是猜的 —— 下面每条都能在 `B:\DeepSeek Harness\0.2.2-rc2\resources\app.asar`
 * 里按原文搜到（本文件只引原文，不引行号：asar 里没有行号）：
 *
 * | 搜索串 | 原文 | 结论 |
 * |---|---|---|
 * | `conversation.input.left` | "Compact controls at the left of the composer tool row; fixed overlays must portal to the document body…" | **入口按钮**挂这里（list / session）|
 * | `conversation.input.overlay` | "Floating entries rendered inside the resident composer card…" | **抽屉面板**挂这里（list / session）|
 * | `conversation.input.overlay` 的实例 | `scope.slots.inject('conversation.input.overlay', () => scope.slots.register({name, id:'command-popup', order:1, locale:NS, inject:sessionId => …}, PopupSelectView))` | 斜杠命令菜单的写法 —— 本包照抄 |
 * | `overlayAnchor` | `.GRgSLq_overlayAnchor{height:0;position:absolute;inset:0 0 auto}` + 注释 "entries position themselves against the card (bottom: 100% + gap)" | 面板底边 = 卡片上边 + gap，**宽度 = 卡片宽** |
 * | `.GRgSLq_card` | `…display:flex;position:relative` | 卡片是 `position:relative` ⇒ 入口按钮可以 absolute 贴到卡片左外侧 |
 * | `.GRgSLq_row` | `…padding:2px 8px 6px;…display:flex` | composer 工具行（`+` / 权限 / 左槽 / 右槽 / 发送）|
 * | `.GRgSLq_tools` | `…gap:12px`；`.GRgSLq_add{width:28px;height:28px}` | `+` 是 28px 圆钮 ⇒ 入口正方形与它对中心 |
 *
 * ⇒ **不用 `shell.overlay`**（那是整帧浮层，会横跨窗口；V4 就是这么错的）。
 *
 * ## 这个文件管什么 / 不管什么
 *
 * | 管 | 不管（在组件 / CSS 里）|
 * |---|---|
 * | 3 个候选形态的**数值表**（图标 / 间距 / 圆角 / 高度 / 遮罩 / 动画）| 怎么画 SVG、怎么排 DOM（`Drawer.tsx`）|
 * | 「高度 ≈ 屏幕一半」的**具体公式**（`min(50vh, 480px)` 或 `50vh`）| CSS 字符串（`styles.ts` 由本文件插值生成）|
 * | 开合状态机 + 共享 store（两个槽必须看同一个 `open`）| `useSyncExternalStore` 怎么接（组件里一行）|
 * | Esc / 点外部的**判决** | DOM 事件监听怎么挂（组件的 effect）|
 * | 面板内容的压缩间距表（数值单一来源）| 具体覆盖哪些类（`DRAWER_CSS` 里插值）|
 *
 * ## 为什么 3 个形态都留在产品代码里
 *
 * 用户原话：「组件要把所有候选形态给我过目」「我没有授权你选哪一个实现」。
 * ⇒ **不能替用户选**。三个形态各是一份完整的数值配置，组件按 `variant` prop 渲染；
 * 预览页三列并排给他看，他挑了之后只改 `DRAWER_DEFAULT_VARIANT_ID`。
 */

/* ══════════════════════════════════════════════════════════
   0. 尺寸常量
   ══════════════════════════════════════════════════════════ */

/**
 * 面板高度 = 屏幕高 × 这个比例（用户原话「高度 ≈ 屏幕一半」）。
 *
 * ⚠ 这是**用户给的规格**，不是我们量出来的（CDP 不可用，量不了）。
 *   它的可信度来自「用户原话」这一层，不来自测量 —— 报告里会写明。
 */
export const DRAWER_HEIGHT_RATIO = 0.5;

/**
 * 面板高度上限（px）—— 候选维度里的 `min(50vh, 480px)`。
 *
 * 为什么是 480：任务书把 `min(50vh, 480px)` 列为候选值之一；
 * 它要解决的问题是「屏幕很高时别让面板吃掉整段对话」。
 * **480 本身没有测量依据**（沙箱里起不来浏览器），如实标注。
 */
export const DRAWER_HEIGHT_CAP_PX = 480;

/** 入口正方形边长（px）。和 composer 工具行里 `+` 的 28px 同量级。 */
export const DRAWER_ENTRY_SIZE_PX = 32;

/**
 * 入口按钮相对 composer 卡片左边线的横向偏移（px）。
 *
 * `0` = 正方形**右边缘贴输入框左边缘**（用户画图那一条）。
 * 正值 = 留缝；组件用 `left:-边长` 实现，所以这里是「额外缝宽」。
 */
export const DRAWER_ENTRY_GAP_PX = 0;

/**
 * 入口正方形的**顶边**距 composer 卡片顶边的距离（px）。
 *
 * 用户 `2026-11-20`：「正方形，右边缘贴输入框卡片的左边缘。**顶边对齐输入框顶边**」。
 *
 * 输入框（textarea）的顶边不是卡片顶边 —— asar 原文
 * `.GRgSLq_placeholder{inset:4px 8px auto 14px}`：占位文字距卡片顶边 4px，
 * 而占位层与 textarea 同顶 ⇒ **textarea 顶边 = 卡片顶边 + 4px**。
 *
 * ⚠ 旧版做的是 `bottom:4px`（垂直居中于工具行的 `+`）—— 那是「和 + 同一行」，
 *   不是用户要的「顶边对齐输入框顶边」。这次按后者改。
 */
export const DRAWER_ENTRY_TOP_PX = 4;

/* ══════════════════════════════════════════════════════════
   1. 三个候选形态（用户要「全部过目」的那三份）
   ══════════════════════════════════════════════════════════ */

/** 候选形态 id。`a` / `b` / `c` 对应预览页三列。 */
export const DRAWER_VARIANT_IDS = ['a', 'b', 'c'] as const;

/** 候选形态 id 的类型。 */
export type DrawerVariantId = (typeof DRAWER_VARIANT_IDS)[number];

/** 入口图标候选。 */
export type DrawerIconId = 'square' | 'arrow-up' | 'dots';

/** 高度候选：`capped-half` = `min(50vh, 480px)`；`half` = `50vh`。 */
export type DrawerHeightMode = 'capped-half' | 'half';

/** 面板阴影档。 */
export type DrawerShadow = 'none' | 'soft' | 'strong';

/** 一个完整候选形态。 */
export interface DrawerVariant {
	/** 形态 id（和表里的键必须一致，单测会查）。 */
	readonly id: DrawerVariantId;
	/** 预览页列头的中文名。 */
	readonly label: string;
	/** 一句话差异说明（预览页列头第二行）。 */
	readonly summary: string;
	/** 入口图标。 */
	readonly icon: DrawerIconId;
	/** 面板底边与输入框上边缘的间距（px）。 */
	readonly gapPx: number;
	/** 面板圆角（px）。 */
	readonly radiusPx: number;
	/** 面板高度规则。 */
	readonly heightMode: DrawerHeightMode;
	/** 面板阴影档。 */
	readonly shadow: DrawerShadow;
	/** 是否画半透明遮罩（点击遮罩 = 点外部 = 关）。 */
	readonly mask: boolean;
	/** 是否有 180ms 上滑动画。 */
	readonly animated: boolean;
}

/**
 * 三个候选形态 —— **每组是一个完整组合**，不是在一个基线上换一个数。
 *
 * | 形态 | 图标 | 间距 | 圆角 | 高度 | 阴影 | 遮罩 | 动画 |
 * |---|---|---|---|---|---|---|---|
 * | A `a` | ▣ 方块 | 0（紧贴）| 0（贴边）| `min(50vh, 480px)` | 无 | 无 | 无 |
 * | B `b` | ▲ 上箭头 | 6px | 12px | `min(50vh, 480px)` | 轻 | 无 | 180ms 上滑 |
 * | C `c` | ⋯ 三点 | 12px | 16px | `50vh` | 强 | 半透明 | 180ms 上滑 |
 *
 * ⚠ 用 `satisfies` 而不是类型标注：少一个形态 / 多一个形态都让 `tsc` 红
 *   （AGENTS 3.7；`Object.freeze` 当实参会关掉多余属性检查）。
 *   深冻结由 `freezeVariants` 做（`Object.freeze` 是浅的）。
 */
export const DRAWER_VARIANTS = freezeVariants({
	a: {
		id: 'a',
		label: 'A · 贴边',
		summary: '▣ 方块 · 间距 0 · 无圆角 · min(50vh,480px) · 无遮罩 · 无动画',
		icon: 'square',
		gapPx: 0,
		radiusPx: 0,
		heightMode: 'capped-half',
		shadow: 'none',
		mask: false,
		animated: false,
	},
	b: {
		id: 'b',
		label: 'B · 圆角',
		summary: '▲ 上箭头 · 间距 6px · 圆角 12px · min(50vh,480px) · 轻阴影 · 180ms 上滑',
		icon: 'arrow-up',
		gapPx: 6,
		radiusPx: 12,
		heightMode: 'capped-half',
		shadow: 'soft',
		mask: false,
		animated: true,
	},
	c: {
		id: 'c',
		label: 'C · 重阴影 + 遮罩',
		summary: '⋯ 三点 · 间距 12px · 圆角 16px · 50vh · 强阴影 · 半透明遮罩 · 180ms 上滑',
		icon: 'dots',
		gapPx: 12,
		radiusPx: 16,
		heightMode: 'half',
		shadow: 'strong',
		mask: true,
		animated: true,
	},
} satisfies Record<DrawerVariantId, DrawerVariant>);

/**
 * 深冻结一张「形态表」：外层 + 每个形态都钉住（`Object.freeze` 是浅的）。
 *
 * @param table 形态表
 */
function freezeVariants<T extends object>(table: T): Readonly<T> {
	for (const value of Object.values(table)) {
		if (typeof value === 'object' && value !== null) Object.freeze(value);
	}
	return Object.freeze(table);
}

/**
 * 默认形态 —— **占位，不是裁定**。
 *
 * 用户明确说「我没有授权你选哪一个实现」⇒ 产品接线前必须由用户定。
 * 预览页三列并排给他选；这里先写 `a` 只为让组件有可运行的默认值。
 */
export const DRAWER_DEFAULT_VARIANT_ID: DrawerVariantId = 'a';

/**
 * 取一个形态。
 *
 * @param id 形态 id
 */
export function drawerVariantOf(id: DrawerVariantId): DrawerVariant {
	return DRAWER_VARIANTS[id];
}

/* ══════════════════════════════════════════════════════════
   2. 尺寸 → CSS（`styles.ts` 的 `DRAWER_CSS` 由这些函数插值生成）
   ══════════════════════════════════════════════════════════ */

/** 数值 → `Npx`。 */
function px(value: number): string {
	return `${String(value)}px`;
}

/**
 * 面板高度（CSS 表达式）—— **只用真实视口单位**。
 *
 * 用户 `2026-11-20` 明确否掉了预览里那种「模拟屏高」的变量：
 * 「莫写着模拟屏高。然后用高而窄的放抽屉面板做什么」。
 * ⇒ 这里只允许 `vh` / `min(…, 480px)`，**不允许任何自定义变量去替代视口单位**。
 */
export function drawerHeightCssOf(variant: DrawerVariant): string {
	const half = `${String(DRAWER_HEIGHT_RATIO * 100)}vh`;
	return variant.heightMode === 'capped-half'
		? `min(${half}, ${px(DRAWER_HEIGHT_CAP_PX)})`
		: half;
}

/**
 * 面板高度（px 数值）—— 给「给定屏幕高 → 实际多高」的换算和单测用。
 *
 * ⚠ 浏览器里**最终高度还是 CSS 算的**（`50vh` + `min()`）；
 *   这个函数只是同一公式的数值版，用来断言公式没漂。
 *
 * @param variant 形态
 * @param viewportHeightPx 屏幕高（px）
 */
export function drawerHeightPxOf(variant: DrawerVariant, viewportHeightPx: number): number {
	const half = viewportHeightPx * DRAWER_HEIGHT_RATIO;
	return Math.round(variant.heightMode === 'capped-half' ? Math.min(half, DRAWER_HEIGHT_CAP_PX) : half);
}

/** 阴影档 → CSS 值。 */
export function drawerShadowCssOf(shadow: DrawerShadow): string {
	switch (shadow) {
		case 'none':
			return 'none';
		case 'soft':
			return '0 10px 24px rgb(15 23 42 / 16%)';
		case 'strong':
			return '0 22px 48px rgb(15 23 42 / 32%)';
	}
}

/**
 * 面板的几何声明（CSS 声明串，落在 `.tb3d-panel[data-drawer-variant="…"]` 里）。
 *
 * 四件事：贴输入框上边缘（`bottom:calc(100% + gap)`）、圆角、高度、阴影；
 * 有动画的形态再追加 `animation`。
 *
 * @param variant 形态
 */
export function drawerPanelCssOf(variant: DrawerVariant): string {
	const parts = [
		`bottom:calc(100% + ${px(variant.gapPx)})`,
		`border-radius:${px(variant.radiusPx)}`,
		`height:${drawerHeightCssOf(variant)}`,
		`box-shadow:${drawerShadowCssOf(variant.shadow)}`,
	];
	if (variant.animated) parts.push('animation:tb3d-rise .18s ease-out');
	return parts.join(';');
}

/**
 * 入口正方形的定位声明。
 *
 * - `left = -(边长 + 缝)`：正方形**右边缘**正好落在卡片左边线上
 *   （`position:absolute` 的包含块是 composer 卡片 —— asar 原文
 *   `.GRgSLq_card{…position:relative}`；本组件由 `conversation.input.left`
 *   槽渲染在工具行里，所以卡片就是最近的定位祖先）。
 * - `top`：**顶边对齐输入框顶边**（用户 `2026-11-20`）。不是 `bottom`
 *   —— 旧版的「和 `+` 垂直居中」已被否掉。
 */
export function drawerEntryCssOf(): string {
	return [
		`left:${px(-DRAWER_ENTRY_SIZE_PX - DRAWER_ENTRY_GAP_PX)}`,
		`top:${px(DRAWER_ENTRY_TOP_PX)}`,
		`width:${px(DRAWER_ENTRY_SIZE_PX)}`,
		`height:${px(DRAWER_ENTRY_SIZE_PX)}`,
	].join(';');
}

/** 遮罩的声明（CSS 声明串；只有 `mask: true` 的形态才渲染遮罩）。 */
export function drawerMaskCssOf(): string {
	return 'position:fixed;inset:0;background:rgb(15 23 42 / 28%)';
}

/* ══════════════════════════════════════════════════════════
   3. 开合状态机 + 共享 store
   ══════════════════════════════════════════════════════════ */

/** 抽屉状态。只有一个比特 —— 没有「半开」「加载中」。 */
export interface DrawerState {
	/** 是否打开。 */
	readonly open: boolean;
}

/** 关闭态（冻结，避免被误改）。 */
export const DRAWER_CLOSED: DrawerState = Object.freeze({ open: false });

/** 打开态。 */
export const DRAWER_OPEN: DrawerState = Object.freeze({ open: true });

/**
 * 两个槽共用的**可订阅 store**。
 *
 * 为什么需要它：入口按钮注册在 `conversation.input.left`、面板注册在
 * `conversation.input.overlay`，**是两个独立的 slot 条目**（可能渲染在不同位置），
 * 不能靠 React props 共享状态。宿主也没有义务给我们一个 pinia。
 *
 * ⇒ 注册代码按 session 各造一个 store，两个槽的 `inject(sessionId)` 拿**同一个对象**
 *   （`register-drawer.tsx` 里用 Map 绑）。组件用 `useSyncExternalStore` 订阅。
 */
export interface DrawerStore {
	/** 这个 session 的形态（形态是配置，运行期不变）。 */
	readonly variant: DrawerVariantId;
	/** 当前快照。同一状态返回同一对象 ⇒ `useSyncExternalStore` 不会空转。 */
	getSnapshot(): DrawerState;
	/** 订阅；返回取消订阅。 */
	subscribe(listener: () => void): () => void;
	/** 开合翻面。 */
	toggle(): void;
	/** 只开（幂等，无变化不通知）。 */
	open(): void;
	/** 只关（幂等，无变化不通知）。 */
	close(): void;
}

/**
 * 造一个抽屉 store。
 *
 * @param variant 形态（默认 `a` 占位，等用户选）
 * @param initialOpen 初始是否打开（预览用；产品里默认关）
 */
export function createDrawerStore(
	variant: DrawerVariantId = DRAWER_DEFAULT_VARIANT_ID,
	initialOpen = false,
): DrawerStore {
	let state: DrawerState = initialOpen ? DRAWER_OPEN : DRAWER_CLOSED;
	const listeners = new Set<() => void>();

	/** 改状态 + 通知；引用没变直接返回（不空转）。 */
	const setOpen = (open: boolean): void => {
		if (state.open === open) return;
		state = open ? DRAWER_OPEN : DRAWER_CLOSED;
		for (const listener of [...listeners]) listener();
	};

	return Object.freeze({
		variant,
		getSnapshot: (): DrawerState => state,
		subscribe: (listener: () => void): (() => void) => {
			listeners.add(listener);
			return (): void => {
				listeners.delete(listener);
			};
		},
		toggle: (): void => {
			setOpen(!state.open);
		},
		open: (): void => {
			setOpen(true);
		},
		close: (): void => {
			setOpen(false);
		},
	});
}

/* ══════════════════════════════════════════════════════════
   4. 关闭条件（Esc / 点外部）
   ══════════════════════════════════════════════════════════ */

/**
 * 这个按键是不是「关抽屉」。
 *
 * - 只认 `Escape`。
 * - **输入法组字中不关**（中文输入法按 Esc 是取消候选词，不是关抽屉）。
 *
 * @param key `KeyboardEvent.key`
 * @param composing `KeyboardEvent.isComposing`（省略 = 不在组字）
 */
export function isDrawerCloseKey(key: string, composing = false): boolean {
	return !composing && key === 'Escape';
}

/**
 * 一次 pointerdown 落在了哪 —— 由组件读 DOM 得出，本函数只判判决。
 *
 * | 字段 | 含义 |
 * |---|---|
 * | `inPanel` | 点在抽屉面板里 |
 * | `inTrigger` | 点在入口按钮上（它自己 toggle，不能再抢先关一次）|
 * | `inStatusMenu` | 点在工作区的状态菜单里（菜单 portal 到 body，在面板外，但它属于抽屉）|
 */
export interface DrawerHitTarget {
	readonly inPanel: boolean;
	readonly inTrigger: boolean;
	readonly inStatusMenu: boolean;
}

/**
 * 这一下点击要不要关抽屉。
 *
 * ⚠ 三种「不关」例外都是**功能必需**，不是心软：
 *   · 面板内 —— 不然点一下列表就没了；
 *   · 入口按钮 —— 它自己 `toggle`，document 捕获阶段再关一次会「关了又开」；
 *   · 状态菜单 —— 它 portal 到 body，DOM 上在面板外，但语义上属于抽屉。
 *
 * @param hit 命中位置
 */
export function closesDrawerOn(hit: DrawerHitTarget): boolean {
	return !hit.inPanel && !hit.inTrigger && !hit.inStatusMenu;
}

/* ══════════════════════════════════════════════════════════
   5. 面板内容的压缩间距（高度 ≈ 屏幕一半 ⇒ 内容区仍要压）
   ══════════════════════════════════════════════════════════ */

/**
 * 抽屉里的纵向间距表（px）—— **CSS 由这张表插值生成**（`styles.ts` 的 `DRAWER_CSS`）。
 *
 * 数值沿用 V4 定稿表（那张表是照 400px 高量的：400 高里列表内容区只有 ~316px、
 * 一张卡 56px ⇒ 每收 1px 都多露一点）。现在面板高 ~430–480px，比 400 略高，
 * **只会更宽松，不会放不下**；等用户选定形态后再按真实高度复量一次。
 */
export interface DrawerSpacing {
	/** 抽屉顶栏高度（标题 / 刷新 / 关闭）。 */
	readonly headerHeight: number;
	/** Workspace 页面纵向内边距。 */
	readonly pagePadY: number;
	/** Workspace 页面横向内边距。 */
	readonly pagePadX: number;
	/** 工具栏与上面一行的纵向间距。 */
	readonly toolbarGap: number;
	/** 两栏主区 `margin-top`。 */
	readonly mainGap: number;
	/** 列表头 padding-top / bottom。 */
	readonly listHeadPadTop: number;
	readonly listHeadPadBottom: number;
	/** 列表滚动区纵向 padding。 */
	readonly listBodyPadTop: number;
	readonly listBodyPadBottom: number;
	/** 列表滚动区横向 padding。 */
	readonly listBodyPadX: number;
	/** 卡与卡之间的纵向间距。 */
	readonly cardGap: number;
	/** 卡自身纵向 padding。 */
	readonly cardPadY: number;
	/** 详情面板纵向 padding / 横向 padding。 */
	readonly detailPadY: number;
	readonly detailPadX: number;
	/** 详情内块与块之间 gap。 */
	readonly detailGap: number;
	/** 详情里章节与章节之间 gap。 */
	readonly sectionGap: number;
	/** 抽屉宽版下左列固定宽。 */
	readonly listWidth: number;
}

/** 抽屉内容的压缩间距表（单一来源；CSS 插值读这里）。 */
export const DRAWER_COMPACT_SPACING: DrawerSpacing = Object.freeze({
	headerHeight: 36,
	pagePadY: 6,
	pagePadX: 12,
	toolbarGap: 0,
	mainGap: 6,
	listHeadPadTop: 6,
	listHeadPadBottom: 4,
	listBodyPadTop: 4,
	listBodyPadBottom: 8,
	listBodyPadX: 12,
	cardGap: 4,
	cardPadY: 6,
	detailPadY: 8,
	detailPadX: 12,
	detailGap: 7,
	sectionGap: 8,
	listWidth: 320,
});
