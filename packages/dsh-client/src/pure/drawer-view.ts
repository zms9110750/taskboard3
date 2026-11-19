/**
 * 抽屉（V4）的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * ## 这个文件管什么
 *
 * | 管 | 不管（在组件 / CSS 里）|
 * |---|---|
 * | 开合状态机（toggle / open / close / Esc / 点外部）| 监听器怎么挂、怎么卸（`Drawer.tsx` 的 effect）|
 * | 三个入口（Chevron / 工具栏 / 详情 ⧉）派发**同一个动作** | 按钮怎么画（`DrawerToggle` / `Workspace` 的 ⧉）|
 * | 400 高时的纵向间距档位（数值表）| 数值怎么落成 CSS（`styles.ts` 的 `DRAWER_CSS` 由本表插值生成）|
 * | 「点外部」的命中判决 | `element.closest()` 的 DOM 读取（组件把布尔值传进来）|
 *
 * ## ⚠ 挂载点 —— 查证结果，不是猜的（2026-11-20）
 *
 * 设计图（`X:\temp\view-4-drawer.svg`：257 行）自己写着「挂 **shell.overlay**（root scope）」。
 * 直接对**运行中的 DSH** 的 `app.asar` 做字节搜索
 * （`B:\DeepSeek Harness\0.2.2-rc2\resources\app.asar`，198.5 MB）——
 * 注意：DSH 的包大部分**打包在 asar 里**，只搜 `app.asar.unpacked` / node_modules
 * 会得出「不存在」的假结论（我第一版就差点这么写）。
 *
 * | 搜索串 | app.asar 命中 | 结论 |
 * |---|---|---|
 * | `shell.overlay` | 165 处 | **槽存在** |
 * | `sidebar.right.pane.tab` | 206 处 | 本包当前注册的右栏 tab 槽存在 |
 * | `sidebarRightTabs` | 88 处 | 服务存在 |
 * | `drawer` | 334 处 | 只出现在「<768px 左侧导航抽屉」文案里 ⇒ **没有底部抽屉组件** |
 *
 * 从 asar 里摘到的原文：
 *
 * - 槽目录 doc：「Frame-wide floating layer, above every column and outside their scroll
 *   containers. Deliberately generic and unowned by any feature… The layer itself is
 *   click-through — entries opt back into pointer events」。
 * - 层实现 CSS：`.mP3x-q_overlayLayer{z-index:20;pointer-events:none;position:absolute;inset:0}`
 *   —— **absolute，不是 fixed**；子元素才 `pointer-events:auto`。
 * - 官方指引：「Use `shell.overlay` only when the request needs an overlay and its placement
 *   is known.」
 * - 另有 `shell.bottom`（single / root）：它**占走底部并让三栏缩高**
 *   （原文「the columns shrink by that height」）⇒ 违反设计图 ①「浮层不压缩工作区宽度」
 *   ⇒ **不用它**，用 `shell.overlay`。
 *
 * ⇒ **方案 A 成立**：抽屉挂帧级 overlay、用 `position:absolute` 贴底，
 *   **不需要 `position:fixed`**（用户 `2026-11-19` 明确否掉 fixed：会逃出父容器）。
 *
 * ⚠ 但**本任务只交组件 + 预览**：产品里 `client.tsx` 往 `shell.overlay` 注册的那一步
 *   没做（它现在注册的是右栏 tab body，那是另一个挂载点）。组件是纯受控的 ——
 *   宿主把 `<Drawer>` 挂进 `shell.overlay` 即可，见 `Drawer.tsx` 文件头。
 *   `shell.overlay` 是一条 **list** 槽：官方示例是先 `ctx.slots.inject('shell.overlay', …)`
 *   再 `ctx.slots.register({ name: 'shell.overlay', id: 'taskboard3-drawer', … }, Drawer)`。
 *
 * ## 为什么开合状态机要「纯」
 *
 * 设计图 ② 要求：输入框 Chevron / 工具栏 / 右栏入口**共用同一个 open 状态**、
 * 派生**同一个动作** —— 不是三套各写一遍 `setOpen(!open)`。
 * 把判决钉在这里之后，`Drawer.tsx` 只做机械映射；单测能把「三个入口动作相等」
 * 这类规则**逐个断言**，而不是靠「组件里看起来是同一个函数」。
 */

/* ══════════════════════════════════════════════════════════
   0. 尺寸常量 —— 设计图 1:1 标注
   ══════════════════════════════════════════════════════════ */

/** 抽屉设计宽（`view-4-drawer-only.svg` 顶部标注「1:1 · 1200 × 400」）。 */
export const DRAWER_WIDTH = 1200;

/** 抽屉设计高。 */
export const DRAWER_HEIGHT = 400;

/**
 * 「矮容器」档位的上限 —— 设计图注：「高 400 ⇒ 只收紧纵向间距（`@container max-height:560`）」。
 *
 * ⚠ 抽屉固定 400 高 ⇒ **永远落在 compact 档**；560 这个数留着是因为设计图把它
 *   写成了一条容器查询的边界，将来宿主给更高抽屉时行为仍然一致。
 */
export const DRAWER_COMPACT_MAX_HEIGHT = 560;

/* ══════════════════════════════════════════════════════════
   1. 开合状态机
   ══════════════════════════════════════════════════════════ */

/** 抽屉状态。只有一个比特 —— 它没有「半开」「加载中」这种中间态。 */
export interface DrawerState {
	/** 是否打开。 */
	readonly open: boolean;
}

/** 关闭态（冻结，避免被误改）。 */
export const DRAWER_CLOSED: DrawerState = Object.freeze({ open: false });

/** 打开态。 */
export const DRAWER_OPEN: DrawerState = Object.freeze({ open: true });

/**
 * 开合状态机的事件。
 *
 * | type | 来自 |
 * |---|---|
 * | `toggle` | Chevron 按钮 / 工具栏入口 / 详情 ⧉（三处**同一个**动作）|
 * | `open` | 宿主主动打开（例如恢复上次状态）|
 * | `close` | 宿主主动关（例如切换会话）|
 * | `escape` | Esc 键 |
 * | `outside` | 点抽屉外部 |
 */
export type DrawerEventType = 'toggle' | 'open' | 'close' | 'escape' | 'outside';

/** 一条事件（只有类型，没有 payload）。 */
export interface DrawerEvent {
	readonly type: DrawerEventType;
}

/** 共享的「开」事件。 */
export const DRAWER_OPEN_EVENT: DrawerEvent = Object.freeze({ type: 'open' });

/** 共享的「关」事件。 */
export const DRAWER_CLOSE_EVENT: DrawerEvent = Object.freeze({ type: 'close' });

/**
 * **三个入口派发的同一个动作** —— 就是这一个对象。
 *
 * ⚠ 这是「共用同一个 open 状态」的结构性保证：`triggerEventOf()` 的返回值
 *   只有这一个，写不出第二个开合逻辑。
 */
export const DRAWER_TOGGLE_EVENT: DrawerEvent = Object.freeze({ type: 'toggle' });

/**
 * 初始状态。
 *
 * @param open 初始是否打开（默认关）
 */
export function initialDrawerState(open = false): DrawerState {
	return open ? DRAWER_OPEN : DRAWER_CLOSED;
}

/**
 * 状态转移 —— **唯一的开合判决**。
 *
 * `toggle` 翻面；`open` / `close` / `escape` / `outside` 是幂等的（已经那样就不动）。
 * 无变化时**返回原对象**（不是新对象）⇒ React 的 `setState` 会按引用相同直接跳过重渲染。
 *
 * @param state 当前状态
 * @param event 事件
 */
export function reduceDrawer(state: DrawerState, event: DrawerEvent): DrawerState {
	switch (event.type) {
		case 'open':
			return state.open ? state : DRAWER_OPEN;
		case 'toggle':
			return state.open ? DRAWER_CLOSED : DRAWER_OPEN;
		case 'close':
		case 'escape':
		case 'outside':
			return state.open ? DRAWER_CLOSED : state;
	}
}

/**
 * 抽屉现在是不是开的。
 *
 * @param state 状态
 */
export function isDrawerOpen(state: DrawerState): boolean {
	return state.open;
}

/* ══════════════════════════════════════════════════════════
   2. 三个入口 = 同一个动作
   ══════════════════════════════════════════════════════════ */

/**
 * 抽屉的入口（设计图 ②：「输入框左侧 Chevron；工具栏 / 右栏入口派发同一个动作」）。
 *
 * | 值 | 位置 | 谁画 |
 * |---|---|---|
 * | `chevron` | 输入框左侧的 Chevron | `DrawerToggle`（宿主挂进 composer 附近的槽）|
 * | `toolbar` | 工作区工具栏 | 宿主 / `Workspace` 的工具栏扩展位 |
 * | `detail-expand` | 详情右上角 ⧉ | `Workspace` 已有的 `onExpandDetail`（V4 预留）|
 */
export type DrawerTriggerSource = 'chevron' | 'toolbar' | 'detail-expand';

/** 全部入口（顺序 = 设计图 ② 的列举顺序）。 */
export const DRAWER_TRIGGER_SOURCES: readonly DrawerTriggerSource[] = Object.freeze([
	'chevron',
	'toolbar',
	'detail-expand',
]);

/**
 * 某个入口按下时该发什么事件。
 *
 * ⚠ 入参不参与判决 —— 三个入口**恒**返回同一个 `DRAWER_TOGGLE_EVENT`。
 *   参数留着是为了调用点自己说明「我是哪个入口」，也让单测能逐个入口断言。
 *
 * @param _source 入口（不参与判决）
 */
export function triggerEventOf(_source: DrawerTriggerSource): DrawerEvent {
	return DRAWER_TOGGLE_EVENT;
}

/**
 * 某个入口按下后的新状态。
 *
 * @param source 入口
 * @param state 当前状态
 */
export function triggeredDrawerState(source: DrawerTriggerSource, state: DrawerState): DrawerState {
	return reduceDrawer(state, triggerEventOf(source));
}

/* ══════════════════════════════════════════════════════════
   3. 关闭条件（Esc / 点外部）
   ══════════════════════════════════════════════════════════ */

/**
 * 这个按键是不是「关抽屉」。
 *
 * - 只认 `Escape`（设计图 ②：「Esc ⇒ 关」）。
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
 * | `inTrigger` | 点在「触发器」上（它自己会 toggle，不能再抢先关一次）|
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
 * ⚠ **不渲染遮罩层**：设计图里抽屉下方的输入框「仍可用」（`view-4-drawer.svg:126`），
 *   而遮罩会拦掉滚轮 / 点击 ⇒ 违反 ② 的「不抢焦点、不锁页面滚动」。
 *   所以「点外部关」靠 document 上的 pointerdown 判决，**不拦事件**（点了就点了）。
 *
 * @param hit 命中位置
 */
export function closesDrawerOn(hit: DrawerHitTarget): boolean {
	return !hit.inPanel && !hit.inTrigger && !hit.inStatusMenu;
}

/* ══════════════════════════════════════════════════════════
   4. 纵向间距档位（400 高怎么压）
   ══════════════════════════════════════════════════════════ */

/**
 * 抽屉里的纵向间距表（px）—— **CSS 由这张表插值生成**（`styles.ts` 的 `DRAWER_CSS`）。
 *
 * ⚠ 只收**纵向**，横向一列都不动（设计图 ③：「宽 1200 ⇒ 横向分栏不变形」）。
 *   数值来源见 `DRAWER_COMPACT_SPACING` 每条注释，都是「为了 400 高里多露一行」
 *   量出来的（400 高里 list 只有 ~316px，一行卡 56px ⇒ 收 2px 就多露半行）。
 */
export interface DrawerSpacing {
	/** 抽屉顶栏高度（标题 / 刷新 / 关闭）。 */
	readonly headerHeight: number;
	/** Workspace 页面纵向内边距。 */
	readonly pagePadY: number;
	/** Workspace 页面横向内边距。 */
	readonly pagePadX: number;
	/** 工具栏（若与 chip 行并排则用 0；这里指 `margin-top`）。 */
	readonly toolbarGap: number;
	/** 筛选行 margin-top（抽屉里整行隐藏，值留档）。 */
	readonly filtersGap: number;
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
	/** 抽屉宽版下左列固定宽（设计图：列表 316px）。 */
	readonly listWidth: number;
}

/**
 * 400 高（compact 档）的间距表。
 *
 * | 位置 | 工作区（regular，`WORKSPACE_CSS`）| 抽屉（compact）| 省 |
 * |---|---|---|---|
 * | 页面纵向 padding | 16 | 6 | 20 |
 * | 主区 margin-top | 12 | 6 | 6 |
 * | 列表头 padding | 11 / 7 | 6 / 4 | 8 |
 * | 列表滚动区 padding | 8 / 12 | 4 / 8 | 8 |
 * | 卡间距 / 卡 padding | 6 / 8 | 4 / 6 | 4 |
 * | 详情 padding / gap | 16 / 14 | 8 / 7 | 15 |
 * | 章节 gap | 12 | 8 | 4 |
 * | **合计** | — | — | **约 65px**（≈ 多露 1.2 张卡）|
 */
export const DRAWER_COMPACT_SPACING: DrawerSpacing = Object.freeze({
	headerHeight: 36,
	pagePadY: 6,
	pagePadX: 12,
	toolbarGap: 0,
	filtersGap: 4,
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

/**
 * 这个高度该走哪一档。
 *
 * @param height 抽屉内容高（px）
 */
export function drawerTierOf(height: number): 'compact' | 'regular' {
	return height <= DRAWER_COMPACT_MAX_HEIGHT ? 'compact' : 'regular';
}

/**
 * 这个高度该用哪张间距表。
 *
 * @param height 抽屉内容高（px）
 * @returns compact 档的间距表；`null` = 不覆盖，用 `Workspace` 自己的 CSS
 *   （regular 档的数值**只在 `WORKSPACE_CSS` 里有一份**，这里不抄第二份）
 */
export function drawerSpacingOf(height: number): DrawerSpacing | null {
	return drawerTierOf(height) === 'compact' ? DRAWER_COMPACT_SPACING : null;
}

/**
 * 抽屉里有哪几块 chrome 要收掉（compact 档）。
 *
 * 依据是设计图 `view-4-drawer-only.svg`：1200×400 的抽屉里**没有**筛选行、
 * 没有图例、列表也没有列名行 —— 这三块在 400 高里只吃纵向/横向空间。
 */
export interface DrawerChrome {
	/** 筛选行（状态 / 类别 / 领域 + 搜索）。 */
	readonly showFilters: boolean;
	/** 工具栏里那条关系图例。 */
	readonly showLegend: boolean;
	/** 列表列名行（编号 + 状态 / 分类 · 领域 · 模板 / 标题 / 最后动过）。 */
	readonly showListCols: boolean;
}

/** 工作区（regular）的 chrome —— 三块都在。 */
export const DRAWER_CHROME_FULL: DrawerChrome = Object.freeze({
	showFilters: true,
	showLegend: true,
	showListCols: true,
});

/** 抽屉（compact）的 chrome —— 三块都收掉。 */
export const DRAWER_CHROME_COMPACT: DrawerChrome = Object.freeze({
	showFilters: false,
	showLegend: false,
	showListCols: false,
});

/**
 * 这个高度该露哪几块 chrome。
 *
 * @param height 抽屉内容高（px）
 */
export function drawerChromeOf(height: number): DrawerChrome {
	return drawerTierOf(height) === 'compact' ? DRAWER_CHROME_COMPACT : DRAWER_CHROME_FULL;
}
