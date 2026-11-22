/**
 * 空间 chip 行的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * 语义来源：旧版 `taskboard2/packages/browser/public/views/card-list/board-row.js`
 * （251 行，逐行读过；下面每条规则都标了它对应旧文件的哪一段）。
 *
 * ## ① chip 点击 = **查看**，不是激活
 *
 * 用户 `2026-11-09`：
 * > 「我要的切换。是对我展示啊。不是自动切换激活空间啊。那个激活按钮还是要的。
 * >  查看和激活是要分离的。」
 *
 * ⇒ 点 chip 只改「正在查看哪个空间」。**改当前激活空间是另一件事**（左侧那个按钮）。
 *   本文件里这条规则是**类型级**保证：`ChipIntent` 只有 `'view'` 一个成员
 *   —— 组件拿不到「chip ⇒ activate」这个意图，写不出来。
 *
 * ## ② 激活靠左侧那**一个**按钮
 *
 * 用户 `2026-11-09`：
 * > 「不是下拉框，不是菜单。是一个按钮。」
 * > 「我要的不是两个独立按钮，是一个独立按钮。」
 *
 * ⇒ `actionButtonOf()` 返回的是**一个**对象（不是数组、不是两张表），
 *   它的 `kind` 只有两种可能，互斥：
 *
 * | 显示已归档 | 选中空间 | 按钮文案 | 禁用 | kind | emphasis |
 * |---|---|---|---|---|---|
 * | 关 | 不是当前 | `当前空间` | 否 | `activate` | `action` |
 * | 关 | 就是当前 | `当前空间` | **是** | `activate` | `current` |
 * | 开 | 不是当前（未归档）| `已归档` | 否 | `toggle-archived` | `action` |
 * | 开 | 不是当前（已归档）| `已归档`（选中态）| 否 | `toggle-archived` | `action` |
 * | 开 | 就是当前（未归档）| `当前空间` | **是** | `toggle-archived` | `current` |
 * | 开 | 就是当前（已归档，异常态）| `已归档`（选中态）| **否** | `toggle-archived` | `current` |
 *
 * ## ②b 文案合并（用户 `2026-11-18`）
 *
 * > 「把『激活当前空间』和『当前空间』，改为『当前空间』，然后通过着色来表示
 * >  现在就是『当前空间』。那个 6 个字的占用文档流太宽了。」
 *
 * ⇒ 原来 `激活此为当前空间`（6 字）与 `当前空间`（4 字）两套文案合并成**一套** `当前空间`，
 *   靠 `emphasis` 区分「你在这里」和「可以切过去」：
 *
 * | emphasis | 语义 | 视觉（组件负责）|
 * |---|---|---|
 * | `current` | **已经是**当前空间 | 实心强调（像状态徽章），**不可点** |
 * | `action` | 可以切过去 | 描边（像按钮），可点 |
 * | `plain` | 没有可作用的空间 | 普通 |
 *
 * ⚠ **合并文案带来的语义风险**：两个按钮都写「当前空间」，用户可以会问
 *   「点了会发生什么？」⇒ 补两件事：
 *   ① `emphasis` 让两者**看起来就不是一类东西**（徽章 vs 按钮）；
 *   ② `title` 说清后果（「这就是当前空间」/「点一下把『代码』设为当前空间」）。
 *   这两条都有单测钉住，不是靠注释约定。
 *
 * ## ③ 归档的 chip 只选中、不激活
 *
 * 归档空间出现在列表里是为了「取消归档」；点它直接激活一个已归档空间没有意义。
 * ⚠ 旧代码里这一条**没有专门分支** —— 因为 ① 已经把「激活」从 chip 上拿走了，
 *   所有 chip 都只做 view，规则自动成立。这里保留 `intent: 'view'` 字段是为了
 *   让单测能把这条规则**逐个 chip 断言**，而不是依赖「没有别的分支」这种隐含论证。
 *
 * ## ④ 当前空间不能归档，但异常态允许点
 *
 * `currentId` 是 AI 工具的默认空间 ⇒ 归档正在用的空间会把默认值指向不该存在的东西。
 * 但激活是**会话级**的 —— 别的会话可能把它归档了，于是「**当前 + 已归档**」
 * 是**数据上可能出现**的异常态 ⇒ 那一格**必须可点**（点了取消归档，把状态修回正常），
 * 否则用户死锁。正常态的当前空间则**禁用**，且文案必须显示 `当前空间`
 * 而不是禁用的 `已归档`（用户 `2026-11-09 09:07`：
 * 「按钮禁用但是没有说明信息很奇怪」）。
 */

import type { Workspace } from '../types.ts';

/**
 * 左侧那个按钮**做哪件事**。
 *
 * ⚠ 只有两个成员，且 `actionButtonOf()` 每次只返回一个 ——
 *   这就是「不是两个独立按钮，是一个独立按钮」的结构性保证。
 */
export type SpaceActionKind = 'toggle-archived';

/** 左侧单个按钮的完整渲染决定。 */
export interface SpaceAction {
	/** 文案。 */
	readonly label: string;
	/** 是否禁用（禁用的按钮**不**触发任何回调）。 */
	readonly disabled: boolean;
	/** 点它做哪件事。 */
	readonly kind: SpaceActionKind;
	/** 「开」态（= 这个空间确实已归档）。只有 `toggle-archived` 会真。 */
	readonly checked: boolean;
	/**
	 * 视觉强调档 —— **文案合并后，这是区分「已是当前」与「可切过去」的唯一手段**。
	 *
	 * - `current`：这已经是当前空间 ⇒ 实心、不可点（像「你在这里」的标记）
	 * - `action`：点了会改变当前空间 ⇒ 描边、可点（像按钮）
	 * - `plain`：没有可作用的空间 ⇒ 普通灰
	 */
	readonly emphasis: SpaceEmphasis;
	/** `title`（禁用时用户唯一的说明来源）。 */
	readonly title: string;
	/** 按钮作用于哪个空间；`undefined` = 没有可作用的空间。 */
	readonly workspaceId: string | undefined;
}

/**
 * 左侧按钮的视觉强调档。
 *
 * 用户 `2026-11-18` 要求两句话合并成一句、靠着色区分 ⇒ 这个字段就是那个「着色」。
 */
export type SpaceEmphasis = 'current' | 'action' | 'plain';

/**
 * 点 chip 的**唯一**意图。
 *
 * ⚠ 故意只有一个成员：旧版注释里曾出现「点 chip 直接激活为当前空间」的说法，
 *   那是 `2026-11-09` 前半段的口径，后半段被用户改掉了（见文件头 ①）。
 *   类型里不出现 `'activate'` ⇒ 组件不可能把 chip 接到激活上。
 */
export type ChipIntent = 'view';

/** 一个 chip 的渲染决定。 */
export interface SpaceChip {
	readonly id: string;
	readonly label: string;
	/** 是不是当前激活空间（黑底）。 */
	readonly isCurrent: boolean;
	/** 是不是已归档（虚线 + 降透明）。 */
	readonly isArchived: boolean;
	/** 是不是正在查看的那个（accent 描边 + 显示计数）。 */
	readonly isViewing: boolean;
	/** 计数；`null` = 这个 chip 不显示计数。 */
	readonly count: number | null;
	readonly title: string;
	/** 点它的意图。恒为 `'view'`。 */
	readonly intent: ChipIntent;
}

/** 「显示已归档」开关的渲染决定。 */
export interface ArchivedToggle {
	readonly label: string;
	readonly title: string;
	/** 开关是否打开（渲染成 `is-active`）。 */
	readonly active: boolean;
}

/**
 * 该显示哪些空间。
 *
 * ⚠ 旧版这一步在**服务端**做（`api.getState(showArchived)` 决定列表含不含归档）。
 *   v3 的 `/api/state` 一次给全量，所以过滤搬到了客户端 —— 但**判据不变**：
 *   关 ⇒ 归档的一个都不显示；开 ⇒ 全显示。
 *
 * @param workspaces 全部空间（含 `archived` 标记）
 * @param showArchived 「显示已归档」开关
 */
export function visibleWorkspaces(
	workspaces: readonly Workspace[],
	showArchived: boolean,
): readonly Workspace[] {
	if (showArchived) return workspaces;
	return workspaces.filter((one) => one.archived !== true);
}

/**
 * 「正在查看」到底落在哪个空间上。
 *
 * 旧版 `board-row.js:55-57` 的回落链，原样保留：
 *
 * 1. 显式 `viewingId` 在可见列表里 ⇒ 就是它；
 * 2. 否则回落到 `currentId`（前提是它可见）；
 * 3. 都不在 ⇒ `undefined`（按钮禁用，标题「还没有任务空间」）。
 *
 * 第 2 步是必须的：刚归档了正在查看的空间、或把「显示已归档」关掉，
 * 都会让 `viewingId` 指向一个看不见的空间 —— 那时 UI 要回落到当前空间，
 * 而不是显示「一个都没选中」。
 *
 * @param workspaces 全部空间
 * @param currentId 当前激活空间
 * @param viewingId 正在查看的空间（UI 状态）
 * @param showArchived 「显示已归档」开关
 */
export function resolveViewingId(
	workspaces: readonly Workspace[],
	currentId: string,
	viewingId: string,
	showArchived: boolean,
): string | undefined {
	const list = visibleWorkspaces(workspaces, showArchived);
	if (list.some((one) => one.id === viewingId)) return viewingId;
	if (list.some((one) => one.id === currentId)) return currentId;
	return undefined;
}

/**
 * 左侧那个**单个**按钮的判决 —— 本组件的语义核心。
 *
 * 表见文件头 ②。四种组合（显示已归档 × 选中是否当前）逐个断言在
 * `dev/test/space-bar.test.ts`。
 *
 * @param workspaces 全部空间（含归档标记）
 * @param currentId 当前激活空间
 * @param viewingId 正在查看的空间
 * @param showArchived 「显示已归档」开关
 */
export function actionButtonOf(
	workspaces: readonly Workspace[],
	currentId: string,
	viewingId: string,
	showArchived: boolean,
): SpaceAction | undefined {
	const list = visibleWorkspaces(workspaces, showArchived);
	const id = resolveViewingId(workspaces, currentId, viewingId, showArchived);
	const selected = id === undefined ? undefined : list.find((one) => one.id === id);
	const isCurrent = selected !== undefined && selected.id === currentId;

	/*
	 * 「显示已归档」关 ⇒ **没有操作按钮**（用户 2026-11-22 取消「激活空间」设定）。
	 */
	if (!showArchived) return undefined;

	/* ── 「显示已归档」开：同一个按钮做**归档状态切换** ── */
	const isArchived = selected?.archived === true;

	/*
	 * ## ⚠ 曾经有一条「当前空间不能归档」的规则，已删除（用户 2026-11-22）
	 *
	 * 旧规则：
	 *
	 * ```
	 * const currentCannotArchive = isCurrent && !isArchived;
	 * ```
	 *
	 * 理由是「`currentId` 是 AI 工具的默认空间，归档它会让默认值指向不该存在的东西」。
	 *
	 * **这个理由已经不成立了** —— 用户 2026-11-22 取消了「激活空间」设定：
	 * 工具层的 `workspaceId` 必须显式给，**没有默认空间**（见 `tools/src/context.ts`
	 * 的 `resolveWorkspace`）。既然没有默认值，就没有「指向不该存在的东西」。
	 *
	 * ## 为什么必须删（不是可选的清理）
	 *
	 * 产品里 `currentId` 和 `viewingId` 是**同一个值**（`WorkspaceBody.tsx`：
	 * 两个 prop 都传 `state.workspaceId`）。而操作按钮只作用于「正在查看的空间」
	 * ⇒ `isCurrent` **恒为 true** ⇒ `currentCannotArchive` **恒为 true**
	 * ⇒ 按钮永远禁用 ⇒ **任何空间都归档不了**，功能形同虚设。
	 *
	 * （CDP 实测：打开「显示已归档」后按钮 `disabled: true`、
	 *   `label: '当前空间'`、`emphasis: 'current'`，点不动。）
	 */
	const currentCannotArchive = false;

	return {
		kind: 'toggle-archived',
		/*
		 * 文案保持「已归档」不变 —— 它读起来像**一个勾选框的标签**，
		 * 勾没勾由 `checked` 表达。不要改成「已归档 / 未归档」两个词：
		 * 那样 `checked` 就没意义了，而且按钮宽度会在两个状态间跳。
		 */
		label: '已归档',
		disabled: selected === undefined,
		checked: isArchived,
		/*
		 * 判据是**「能不能点」**：只要有一个选中的空间就能点
		 * （点了翻面：未归档 ⇒ 归档，已归档 ⇒ 取消归档）。
		 */
		emphasis: selected === undefined ? 'plain' : 'action',
		title:
			selected === undefined
				? '还没有任务空间'
				: isArchived
					? '点一下取消归档'
					: '点一下归档',
		workspaceId: selected?.id,
	};
}

/**
 * 点左侧按钮**该调哪个回调**。
 *
 * 组件拿到的就是这个 —— 它不再自己判「禁用了吗 / 是哪个 kind」，
 * 只把 `kind` 映射到对应的回调（机械映射，没有第二个判据）。
 *
 * @param action `actionButtonOf()` 的返回值
 * @returns 要调的回调；`undefined` = 什么都不做（禁用 / 没有空间）
 */
export function dispatchOf(
	action: SpaceAction,
): { readonly kind: SpaceActionKind; readonly id: string } | undefined {
	if (action.disabled || action.workspaceId === undefined) return undefined;
	return { kind: action.kind, id: action.workspaceId };
}

/**
 * 「显示已归档」开关的渲染决定。
 *
 * ⚠ 旧版文案是**翻面**的：关着显示「显示已归档」，开着显示「隐藏已归档」
 *   （`board-row.js:100-105`）。这里保留翻面 —— 它表达的是「点一下会发生什么」。
 *
 * @param showArchived 当前开关值
 */
export function archivedToggleOf(showArchived: boolean): ArchivedToggle {
	return {
		label: showArchived ? '隐藏已归档' : '显示已归档',
		title: '显示 / 隐藏已归档的任务板',
		active: showArchived,
	};
}

/**
 * chip 列表。
 *
 * 计数**只显示在正在查看的那个 chip 上**（旧版 `board-row.js:92-93`）：
 * 「当前激活」和「正在查看」是两件事，计数是「我看的这个空间有多少卡」。
 *
 * @param workspaces 全部空间
 * @param currentId 当前激活空间
 * @param viewingId 正在查看的空间
 * @param showArchived 「显示已归档」开关
 * @param cardCount 正在查看的空间里的卡数
 */
export function chipsOf(
	workspaces: readonly Workspace[],
	currentId: string,
	viewingId: string,
	showArchived: boolean,
	cardCount: number,
): readonly SpaceChip[] {
	const viewing = resolveViewingId(workspaces, currentId, viewingId, showArchived);

	return visibleWorkspaces(workspaces, showArchived).map((ws) => {
		const isCurrent = ws.id === currentId;
		const isArchived = ws.archived === true;
		const isViewing = ws.id === viewing;

		return {
			id: ws.id,
			label: ws.displayName,
			isCurrent,
			isArchived,
			isViewing,
			count: isViewing ? cardCount : null,
			/*
			 * 旧版 title 里写死了 markdown 的 `**`（`board-row.js:76`），
			 * 那是笔误 —— title 不渲染 markdown，用户会看到星号。这里去掉。
			 */
			title: isArchived
				? '已归档：点一下查看它的卡；用左侧「已归档」按钮取消归档'
				: isCurrent
					? '当前激活空间；点一下查看它'
					: '点一下查看这个空间的卡（不会激活它）',
			intent: 'view',
		};
	});
}
