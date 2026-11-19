/**
 * 权限面板的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * ## 语义来源（按优先级）
 *
 * 1. **用户 `2026-11-19` 定稿的 `docs/权限两轴.md`** —— 两条**正交轴**：
 *    UI 轴 `cardActionLevel` / 宿主轴 `toolGuardLevel`，各自 3 档。
 * 2. HTTP 契约（已实现并测过）：
 *
 * ```
 * GET  /taskboard3/api/permission
 *   → { ok:true, data:{ cardActionLevel, toolGuardLevel,
 *                       cardActionOptions, toolGuardOptions } }
 * POST /taskboard3/api/permission
 *   body { cardActionLevel?, toolGuardLevel? }   // PATCH 语义，只改传了的
 *   → { ok:true, data:{ cardActionLevel, toolGuardLevel } }
 * ```
 *
 * ## 为什么「选项文案」不在这里
 *
 * `label` / `description` 的**唯一来源是接口返回的 options 数组**（服务端来自
 * core 的 `CARD_ACTION_OPTIONS` / `TOOL_GUARD_OPTIONS`）。本文件只做
 * 「拿到什么画什么」的判决，**不硬编码任何文案** —— 第二份文案漂移时不会报错，
 * 只会静默显示一个存不进去的档位。
 *
 * ## 这个文件负责的三个判决
 *
 * | 问题 | 函数 |
 * |---|---|
 * | 哪个档位是「当前」/「保存中」/「不可点」 | `optionViewOf()` |
 * | 点下去要不要发请求（同值不重发、保存中不重发、非法值不发） | `shouldSaveOnSelect()` |
 * | 保存中 / 保存成功 / 保存失败分别把状态变成什么 | `beginSave()` / `commitSave()` / `failSave()` |
 *
 * ## 设计选择：**乐观更新 + 失败回滚**
 *
 * 点一档 ⇒ 立刻把那一档显示成选中（`beginSave`，记下 `previousLevel`）⇒
 * 成功用服务端回声覆盖（`commitSave`）⇒ 失败回滚到 `previousLevel`（`failSave`）。
 *
 * 为什么不「等服务端返回再改选中」：请求要几百毫秒，选中态不动会让人以为没点上，
 * 于是再点一次 —— 那正好制造并发写同一条轴。
 *
 * ## 设计选择：两条轴的 pending **各自独立**
 *
 * 「改一条不影响另一条」不只是视觉要求，也是网络要求：
 *
 * · `requestBodyOf()` 只带**一个**字段（PATCH 语义，不把另一条轴的旧值一起发）；
 * · `pending` 是**按轴分开的两个槽**（`PendingMap`），一条轴在保存时
 *   另一条轴照常可点、可以同时发起保存；
 * · `failSave()` 必须带 `axis` —— 只回滚**失败的那一条轴**，另一条轴的
 *   pending / 值一律不动。两个响应乱序回来也不会互相回滚。
 *
 * ⚠ 反过来，用**一个** `pending` 字段会把正交模型退化成串行表单：
 *   改 B 轴会覆盖 A 轴的 pending，A 轴的失败响应到达时就不知道该回滚谁了。
 */

/** 一个档位的渲染素材 —— **形状与接口的 options 元素一致**。 */
export interface PermissionOption {
	/** 档位值（写进 POST body 的那个字符串）。 */
	readonly value: string;
	/** 档位名（例：`允许领卡`）。 */
	readonly label: string;
	/** 一句人话解释（这一档意味着什么）。 */
	readonly description: string;
}

/**
 * 两条轴的标识。
 *
 * ⚠ 这里刻意用 `'card' | 'tool'` 这种**轴名**而不是 `'cardActionLevel'`：
 *   组件要把轴名画进 `data-axis` 属性、拼进 radio 的 `name`，
 *   而字段名只在发请求那一刻用 `requestFieldOf()` 换出来。
 */
export type AxisKey = 'card' | 'tool';

/** 一次 GET 拿到的完整数据（也是保存的基底）。 */
export interface PermissionSnapshot {
	readonly cardActionLevel: string;
	readonly toolGuardLevel: string;
	readonly cardActionOptions: readonly PermissionOption[];
	readonly toolGuardOptions: readonly PermissionOption[];
}

/** 两条轴的当前档位 —— POST 成功后的回声就是这个形状（选项表不回声）。 */
export interface PermissionLevels {
	readonly cardActionLevel: string;
	readonly toolGuardLevel: string;
}

/** 一次正在进行的保存（记在它所属轴的那个槽里）。 */
export interface PendingSave {
	/** 正在保存哪条轴。 */
	readonly axis: AxisKey;
	/** 想改成哪一档。 */
	readonly value: string;
	/** 改之前是哪一档（失败时回滚到它）。 */
	readonly previousLevel: string;
}

/**
 * **按轴分开的 pending 槽**。
 *
 * 两条轴可以同时在保存 —— 这是「正交」在网络层的落点，也是 B 轴响应
 * 不会误回滚 A 轴的结构性保证。
 */
export interface PendingMap {
	readonly card: PendingSave | null;
	readonly tool: PendingSave | null;
}

/** 两条轴都没有保存。 */
export const NO_PENDING: PendingMap = Object.freeze({ card: null, tool: null });

/** 一次保存失败（回滚已经由 `failSave()` 做完）。 */
export interface SaveFailure {
	/** 哪条轴保存失败。 */
	readonly axis: AxisKey;
	/** 给人看的整句（含「已回滚到……」）。 */
	readonly message: string;
	/** 回滚到了哪一档（值）。 */
	readonly rolledBackTo: string;
}

/** 数据已加载（唯一的「可交互」相位）。 */
export interface ReadyState {
	readonly phase: 'ready';
	readonly snapshot: PermissionSnapshot;
	/** 两条轴各自的保存槽。 */
	readonly pending: PendingMap;
	/** 最近一次保存失败的提示；`null` = 没有错误。 */
	readonly saveError: SaveFailure | null;
}

/** 正在 GET。 */
export interface LoadingState {
	readonly phase: 'loading';
}

/** GET 失败 —— 需要「重试」按钮。 */
export interface LoadErrorState {
	readonly phase: 'load-error';
	readonly message: string;
}

/** 面板的完整状态（受控组件唯一的数据入口）。 */
export type PanelState = LoadingState | LoadErrorState | ReadyState;

/** 一个档位现在该怎么画。 */
export interface OptionView {
	/** 是不是当前选中的那一档（保存中时是**乐观选中**）。 */
	readonly selected: boolean;
	/** 是不是「正在保存的就是这一档」（只有它显示转圈）。 */
	readonly saving: boolean;
	/** 这一档能不能点（同一条轴有保存在飞时整条轴禁用）。 */
	readonly disabled: boolean;
}

/** POST body 里的字段名。 */
export type RequestField = 'cardActionLevel' | 'toolGuardLevel';

/* ────────────────────────── 取值 ────────────────────────── */

/** 某条轴的选项数组。 */
export function axisOptionsOf(
	snapshot: PermissionSnapshot,
	axis: AxisKey,
): readonly PermissionOption[] {
	return axis === 'card' ? snapshot.cardActionOptions : snapshot.toolGuardOptions;
}

/** 某条轴的当前档位值。 */
export function axisLevelOf(snapshot: PermissionSnapshot, axis: AxisKey): string {
	return axis === 'card' ? snapshot.cardActionLevel : snapshot.toolGuardLevel;
}

/**
 * 把某条轴的档位换掉，**另一条轴原样保留**（不可变拷贝）。
 *
 * @param snapshot 原快照
 * @param axis 改哪条轴
 * @param level 新档位值
 */
export function withLevel(
	snapshot: PermissionSnapshot,
	axis: AxisKey,
	level: string,
): PermissionSnapshot {
	return axis === 'card' ? { ...snapshot, cardActionLevel: level } : { ...snapshot, toolGuardLevel: level };
}

/**
 * 某条轴某个档位的**显示名**。
 *
 * @param snapshot 快照（文案来源是它的 options）
 * @param axis 哪条轴
 * @param level 档位值（省略 = 当前档位）
 * @returns 选项里的 `label`；**找不到时回落到原始值**（不编造文案）
 */
export function levelLabelOf(
	snapshot: PermissionSnapshot,
	axis: AxisKey,
	level?: string,
): string {
	const value = level ?? axisLevelOf(snapshot, axis);
	const option = axisOptionsOf(snapshot, axis).find((one) => one.value === value);
	return option?.label ?? value;
}

/** 某条轴在 POST body 里用的字段名。 */
export function requestFieldOf(axis: AxisKey): RequestField {
	return axis === 'card' ? 'cardActionLevel' : 'toolGuardLevel';
}

/**
 * 造 POST body —— **只带被改的那条轴**（PATCH 语义）。
 *
 * ⚠ 不要图省事把两条轴都传：传了就等于「用 UI 里的旧值覆盖另一条轴」，
 *   两个人同时改不同轴时会互相回滚。契约是 PATCH，这里就只发一个字段。
 *
 * @param axis 改哪条轴
 * @param value 新档位
 */
export function requestBodyOf(
	axis: AxisKey,
	value: string,
): Readonly<Partial<Record<RequestField, string>>> {
	return { [requestFieldOf(axis)]: value };
}

/** 某条轴在飞的那个保存；`null` = 这条轴没在保存。 */
export function pendingOf(state: PanelState, axis: AxisKey): PendingSave | null {
	return state.phase === 'ready' ? state.pending[axis] : null;
}

/** 这条轴是不是正在保存（组件用来挂 `aria-busy`）。 */
export function axisPendingOf(state: PanelState, axis: AxisKey): boolean {
	return pendingOf(state, axis) !== null;
}

/* ────────────────────────── 渲染判决 ────────────────────────── */

/**
 * 一个档位现在的渲染决定。
 *
 * 加载中 / 加载失败时，所有档位都是 `disabled`（组件那时画的是骨架 / 错误态，
 * 走不到这里；这个返回值是为了让函数**全定义**，不留「调用方自己判相位」的缝）。
 *
 * @param state 面板状态
 * @param axis 哪条轴
 * @param value 哪个档位
 */
export function optionViewOf(state: PanelState, axis: AxisKey, value: string): OptionView {
	if (state.phase !== 'ready') return { selected: false, saving: false, disabled: true };

	const selected = axisLevelOf(state.snapshot, axis) === value;
	const inFlight = state.pending[axis];

	return {
		selected,
		/* 乐观更新 ⇒ 正在保存的那个值此刻**已经是选中态**。 */
		saving: inFlight !== null && inFlight.value === value,
		/*
		 * 只锁**有保存在飞的那条轴**。另一条轴照常可点 —— 「两条轴独立」的落点。
		 */
		disabled: inFlight !== null,
	};
}

/**
 * 点了某一档**要不要发请求**。
 *
 * 四个「不发」：
 *
 * 1. 数据还没加载好（`loading` / `load-error`）；
 * 2. **点的就是当前档位** —— 同值不发，否则每次点当前档都在写库；
 * 3. 这条轴已经有保存在飞 —— 防止并发写同一条轴；
 * 4. 传进来的值不在选项表里 —— 契约会 400，没必要发。
 *
 * ⚠ 另一条轴有保存在飞**不影响**这条轴 —— 正交。
 *
 * @param state 面板状态
 * @param axis 哪条轴
 * @param value 点的是哪一档
 */
export function shouldSaveOnSelect(state: PanelState, axis: AxisKey, value: string): boolean {
	if (state.phase !== 'ready') return false;
	if (state.pending[axis] !== null) return false;
	if (axisLevelOf(state.snapshot, axis) === value) return false;
	return axisOptionsOf(state.snapshot, axis).some((one) => one.value === value);
}

/* ────────────────────────── 状态迁移 ────────────────────────── */

/**
 * 点了一档：**乐观**进入保存中。
 *
 * - 选中态立刻变成新值（用户马上看到回应）；
 * - 在这条轴的槽里记下「想改成什么 / 之前是什么」（失败回滚要用）；
 * - 顺手清掉旧的保存错误（开始新尝试，旧提示不再相关）。
 *
 * 不合法的点击（见 `shouldSaveOnSelect()`）**原样返回同一个对象**，
 * 调用方可以用 `next === state` 判断「什么都没发生」。
 *
 * @param state 当前状态
 * @param axis 哪条轴
 * @param value 新档位
 * @returns 新状态；不可点时是**同一个** `state`
 */
export function beginSave(state: PanelState, axis: AxisKey, value: string): PanelState {
	/*
	 * 先窄化到 ready 再调 `shouldSaveOnSelect()` —— 那个函数返回的是普通 boolean
	 * （不是类型谓词），光靠它 TS 不会把 `state` 收窄。
	 */
	if (state.phase !== 'ready') return state;
	if (!shouldSaveOnSelect(state, axis, value)) return state;

	const previousLevel = axisLevelOf(state.snapshot, axis);
	return {
		phase: 'ready',
		snapshot: withLevel(state.snapshot, axis, value),
		pending: { ...state.pending, [axis]: { axis, value, previousLevel } },
		saveError: null,
	};
}

/**
 * 保存成功：用服务端回声覆盖两条轴的档位，清掉**这条轴**的 pending。
 *
 * 为什么要 `axis`：回声到达时这条轴可能已经不在 pending 了（比如超时后
 * 用户又点了别的）—— 那就别回写、也别清别人的槽。
 *
 * ⚠ POST 的回声**两条轴都有**（契约如此），所以档位整对覆盖 ——
 *   服务端是唯一事实来源；另一条轴若被别处改了，跟着更新更诚实。
 *
 * @param state 当前状态
 * @param axis 这次保存属于哪条轴
 * @param levels POST 成功返回的两条轴档位
 * @returns 新状态；不在 ready 相位 / 这条轴没有保存在飞时返回同一个 `state`
 */
export function commitSave(
	state: PanelState,
	axis: AxisKey,
	levels: PermissionLevels,
): PanelState {
	if (state.phase !== 'ready' || state.pending[axis] === null) return state;
	return {
		phase: 'ready',
		snapshot: {
			...state.snapshot,
			cardActionLevel: levels.cardActionLevel,
			toolGuardLevel: levels.toolGuardLevel,
		},
		pending: { ...state.pending, [axis]: null },
		/* 刚保存成功 ⇒ 上一条失败提示已经过时。 */
		saveError: null,
	};
}

/**
 * 保存失败：**只回滚这条轴**到点之前那一档 + 显示错误。
 *
 * 另一条轴的 pending / 档位**一律不动** —— 两个保存并发时，
 * 这个函数收到的 `axis` 决定了它只能碰哪一边。
 *
 * 没有 pending 时（比如响应回来前又 reload 了）原样返回，不编造错误。
 *
 * @param state 当前状态
 * @param axis 哪条轴失败
 * @param reason 失败原因（页面给的文案，前后会拼上固定句）
 * @returns 新状态；没有 pending 时是**同一个** `state`
 */
export function failSave(state: PanelState, axis: AxisKey, reason: string): PanelState {
	if (state.phase !== 'ready') return state;
	const failed = state.pending[axis];
	if (failed === null) return state;

	const rolledBackTo = levelLabelOf(state.snapshot, axis, failed.previousLevel);
	return {
		phase: 'ready',
		snapshot: withLevel(state.snapshot, axis, failed.previousLevel),
		pending: { ...state.pending, [axis]: null },
		saveError: {
			axis,
			message: `保存失败：${reason}。已回滚到「${rolledBackTo}」。`,
			rolledBackTo: failed.previousLevel,
		},
	};
}

/**
 * 关掉保存失败提示（用户点了 ×）。
 *
 * 回滚**已经发生**，这里只清提示 —— 不要在这里「重试保存」：
 * 重试要靠用户重新点那一档，UI 不替他决定。
 *
 * @param state 当前状态
 */
export function dismissSaveError(state: PanelState): PanelState {
	if (state.phase !== 'ready' || state.saveError === null) return state;
	return { ...state, saveError: null };
}
