/**
 * 「AI 更新过 / AI未读」的**淡化判定** —— 零 React、零 DOM、零网络。
 *
 * 只回答一个问题：**这一行该不该淡化，以及为什么。**
 *
 * ## 「淡化」到底是什么（旧版原文，不是我的推断）
 *
 * 用户 `2026-11-09`（转引旧版 `styles.css:3425-3428`）：
 * > 「是一个筛选。但是这个筛选的效果是淡化所有不是的卡。不会像筛选一样直接重新列图。
 * >  也就是跟鼠标悬浮在一个卡上面，其他卡颜色变淡那一样的效果。未读的，就不变。」
 *
 * 用户 `2026-11-10` 晚（转引旧版 `store.ts:237-239`）：
 * > 「我说了更新，是不会隐藏卡片的，只是把未命中的给淡化。」
 *
 * 旧版把它拆在四处，本文件把这几处**合成一个纯函数**（只读旧版，未改）：
 *
 * | 旧版位置（`taskboard2/packages/browser/`）| 内容 |
 * |---|---|
 * | `src/lib/store.ts:241` | 焦点模式 `updateFocus: 'ai' \| 'user' \| ''`（`''` = 没开）|
 * | `src/lib/store.ts:230-234` | 两个集合：`aiUpdatedIds` / `userUpdatedIds`（后端算）|
 * | `src/views/card-list/index.ts:162-171` | 命中的卡加 `is-update-hit`；`body` 加 `is-update-focus` |
 * | `public/styles.css:3442-3445` | `body.is-update-focus .task-card:not(.is-update-hit){ opacity: .22 }` |
 *
 * ⇒ 语义一句话：**模式开着时，不在焦点集合里的卡压到 0.22 透明度；命中的保持原样；
 *   没开模式谁都不压。不隐藏、不重排。**
 *
 * ## 两个模式 = 旧版两个按钮（名字容易混，按表看）
 *
 * | 模式 | 按钮文案（旧版 `filter-row.ts:203-204`）| 用户看到的意思 | 命中条件（v3 字段）|
 * |---|---|---|---|
 * | `'ai'` | 「AI 更新过」| AI 改过、**我**还没读 | `card.unread.ai === true` |
 * | `'user'` | 「AI未读」 | **我**改过、AI 还没读 | `card.unread.user === true` |
 * | `'none'` | （没点按钮）| 不淡化 | —— |
 *
 * ⚠ 旧版用 `''` 表示「没开」。这里用 `'none'` —— `''` 是**假空值**
 *   （与 core 把 `parent: ''` 改成 `parent: null` 同一个理由）。为兼容旧调用，
 *   本函数**也接受 `''`**，效果同 `'none'`。
 *
 * ## ⚠ 和 `unreadSide()` 不是一件事
 *
 * `card-view.ts:216-223` 的 `unreadSide()` 判的是「**亮哪一边边框**」：
 * 每张卡自己决定，和当前开没开焦点模式**无关**。
 *
 * 本文件判的是「**这一行淡不淡**」：只取决于「开没开模式 + 在不在集合里」。
 * 两者输入都是 `card.unread`，但**输出用途不同，不要合并、不要互相调用**。
 *
 * ## ⚠ v3 当前没有这个模式（`2026-11-19` 核过）
 *
 * 在 `taskboard3-wt-storage/packages/` 下 grep `updateFocus` / `is-update-hit` /
 * `is-update-focus` / `淡化` —— **零命中**（`opacity` 的命中都是无关的按钮/预览态）。
 * `unreadSide` 只做边框判定。
 * ⇒ 本文件是把旧版**留在组件里的这条判定**收成纯函数，不是发明新行为；
 *   按钮 / 模式状态（UI 接线）仍未做，也不在本文件范围内。
 */

/**
 * 焦点模式。
 *
 * - `'none'` —— 没开（谁都不淡化）
 * - `'ai'`   —— 「AI 更新过」：只看 `unread.ai`
 * - `'user'` —— 「AI未读」：只看 `unread.user`
 *
 * ⚠ 运行时可能收到 `''`（旧版没开的写法）或别的脏字符串 ⇒ `focusOf` 自己兜底，
 *   所以参数类型是 `string` 而不是本类型（与 `card-view.ts` 的 `stateTone(status: string)`
 *   同一个理由：**判决点不能因为脏输入就抛**）。
 */
export type UpdateFocusMode = 'none' | 'ai' | 'user';

/** 一行的视觉结论。 */
export type CardFocus = 'normal' | 'dimmed';

/**
 * 为什么是这个结论 —— 测试与调试用，**不参与渲染**。
 *
 * | reason | focus | 含义 |
 * |---|---|---|
 * | `'focus-off'`     | `normal` | 没开模式（`'none'` / 旧版 `''`）|
 * | `'unknown-focus'` | `normal` | 模式值不认识 ⇒ 当没开（**推断**，见 `focusOf`）|
 * | `'ai-hit'`        | `normal` | 命中「AI 更新过」：`unread.ai` 明确为 `true` |
 * | `'ai-miss'`       | `dimmed` | 未命中「AI 更新过」（含字段缺失/类型不对）|
 * | `'user-hit'`      | `normal` | 命中「AI未读」：`unread.user` 明确为 `true` |
 * | `'user-miss'`     | `dimmed` | 未命中「AI未读」（含字段缺失/类型不对）|
 */
export type FocusReason =
	| 'focus-off'
	| 'unknown-focus'
	| 'ai-hit'
	| 'ai-miss'
	| 'user-hit'
	| 'user-miss';

/** 淡化判定的结果：**结论 + 原因**。 */
export interface CardFocusVerdict {
	readonly focus: CardFocus;
	readonly reason: FocusReason;
}

/**
 * 未读字段的**宽松形状**。
 *
 * 正常情况是 `Card['unread']`（`{ ai: boolean; user: boolean }`，见
 * `dsh-client/src/types.ts:72-77` 的 `CardUnread` = core `card.ts:192-197` 的结构子集）。
 *
 * 但这里是**判决点**：HTTP JSON 少字段、或别处写进库的形状不对，
 * 都不该让界面炸 ⇒ 收 `unknown`，**只认 `=== true`**，其它一律当「未命中」。
 * 宽松类型让「字段缺失」这种边界**能被测试直接构造**，不需要 `as` 断言。
 */
export interface UnreadFlagsLike {
	readonly ai?: unknown;
	readonly user?: unknown;
}

/**
 * 这个值是不是一个**被明确置位**的未读标记。
 *
 * ⚠ 只认布尔 `true`：`'true'` / `1` / `{}` 都不算 —— 猜「像真的」比当作没读更坏，
 *   那会让一张其实没更新的卡看起来需要处理。
 */
function isFlagged(value: unknown): boolean {
	return value === true;
}

/**
 * 这一行该不该淡化。
 *
 * 纯函数：不读时钟、不读全局、不改入参。
 *
 * ## 判定顺序（顺序就是语义）
 *
 * 1. **没开模式** ⇒ `normal` / `focus-off`
 *    （旧版 `updateFocus === ''` 时 `body` 上没有 `is-update-focus`，
 *     `styles.css:3442` 的淡化为 0 条 ⇒ 谁都不压。）
 * 2. **模式值不认识** ⇒ `normal` / `unknown-focus`（推断，见下）
 * 3. **模式 = `'ai'`** ⇒ `unread.ai === true` ? `normal` `ai-hit` : `dimmed` `ai-miss`
 * 4. **模式 = `'user'`** ⇒ `unread.user === true` ? `normal` `user-hit` : `dimmed` `user-miss`
 *
 * ## ⚠ 两条兜底都是「宁可淡化」
 *
 * - **未读字段缺失 / 类型不对** ⇒ 当「未命中」。
 *   依据：旧版拿不到更新清单时会**清空两个集合**（`store.ts:261-265`
 *   「拿不到就保守清空（不假装有更新）」），效果就是全部淡化。
 * - **模式值不认识** ⇒ 当「没开」，**不淡化**。
 *   ⚠ 这是**我的推断**：旧版该分支不可达（类型只有 `'ai' | 'user' | ''`）；
 *   字面照搬旧代码会变成「全部淡化」—— 但那是「两个集合都空」的副作用，
 *   不是「未知模式 = 全淡化」的语义。不知道该淡哪一类时，不施加视觉变化更安全。
 *
 * @param unread 卡的未读字段（`card.unread`；缺失/脏值按「没读」处理）
 * @param mode 焦点模式；`''` 视同 `'none'`，其它未知值见上
 */
export function focusOf(
	unread: UnreadFlagsLike | null | undefined,
	mode: string,
): CardFocusVerdict {
	/* ① 没开模式 —— 旧版的默认值就是 `''`。 */
	if (mode === 'none' || mode === '') {
		return { focus: 'normal', reason: 'focus-off' };
	}

	/* ② 模式值不认识 —— 当没开（推断，理由见函数头）。 */
	if (mode !== 'ai' && mode !== 'user') {
		return { focus: 'normal', reason: 'unknown-focus' };
	}

	/*
	 * ③④ 从这里开始**只认 `=== true`**。
	 * 字段缺失 / null / 非布尔 ⇒ 一律算「未命中」⇒ 淡化。
	 */
	const flags: UnreadFlagsLike = unread ?? {};

	if (mode === 'ai') {
		return isFlagged(flags.ai)
			? { focus: 'normal', reason: 'ai-hit' }
			: { focus: 'dimmed', reason: 'ai-miss' };
	}

	return isFlagged(flags.user)
		? { focus: 'normal', reason: 'user-hit' }
		: { focus: 'dimmed', reason: 'user-miss' };
}
