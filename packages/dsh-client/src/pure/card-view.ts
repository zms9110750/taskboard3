/**
 * 卡片**显示用**的派生值 —— 零 React、零 DOM。
 *
 * ## 为什么单独一个文件
 *
 * 旧版把这些散在 `lib/card-style.js`（78 行）+ `lib/card-state-style.js`（71 行）
 * + `views/card-detail/times.js`（28 行）三处，然后在 **4 个 view 里各写一遍**。
 * 同一份知识写四遍的代价不是行数，是**改一处会漏三处**，而编译器不会告诉你哪一处漏了。
 *
 * ## ⚠ 这里**没有**分类的中文名
 *
 * 旧版 `KIND_LABEL` 是硬编码的（`goal: '目标'`…），注释里写「后端没有这个词表 —— 核过三层」。
 * **v3 不一样**：`core` 的模板 YAML 里 `kind` 是英文 id，但**每个模板有 `displayName`**。
 * 分类的中文名应该由**模板清单**推出来，或者在 `protocol` 补一张词表 ——
 * 不该在 UI 里再抄一份。
 *
 * ⇒ 本文件只导出 `KIND_ORDER`（四个已知 kind 的**顺序**），
 *   中文名由调用方从模板清单取；取不到就显示英文 id（不编中文）。
 */

import {
	STATUS_GROUP_OF,
	STATE_LABELS,
	TaskState,
	isTaskState,
} from '@taskboard/protocol';

/* ══════════════════════════════════════════════════════════
   状态
   ══════════════════════════════════════════════════════════ */

/**
 * 状态的**视觉档位** —— 现在是 **9 个状态 = 9 档**，一个状态一个色。
 *
 * | 档 | 状态 | 色相 |
 * |---|---|---|
 * | `unspecified` | 未指定 | 灰 |
 * | `submitted` | 提交 | 黑 |
 * | `working` | 处理中 | 青 |
 * | `inputRequired` | 需要信息 | 黄 |
 * | `authRequired` | 需要授权 | 紫 |
 * | `completed` | 成功 | 绿 |
 * | `failed` | 失败 | 红 |
 * | `canceled` | 取消 | 褐 |
 * | `rejected` | 拒绝 | 橙 |
 *
 * ## 用户原话（`2026-11-18`）
 *
 * > 「颜色语义，我希望需要授权是紫色的。这个表示神秘的东西。绿色的成功，红色的失败，
 * >  黄色的需要信息。橙色的拒绝，褐色（棕色）的取消。青色的处理中，黑色的提交。
 * >  灰色的草稿。」
 *
 * ## ⚠ 这个函数现在**几乎是恒等映射**
 *
 * 旧版是 9 状态 → 6 档（按组归并：提交和处理中同蓝、需要信息和需要授权同橙、
 * 失败和拒绝同红）。用户要求一状态一色之后，归并这件事**没有了**。
 *
 * ⇒ 它现在唯一的职责是「未知状态 → `unspecified`」。
 *   **不要装作它还在做映射。** 留成函数是因为调用方需要「未知值有确定的回落」，
 *   而不是因为这里有映射逻辑。
 *
 * ⚠ **组语义完全没变**：`STATUS_GROUP_OF` 照旧，`isDraftStatus` / `isEndedStatus` / 筛选
 *   全按组判。变的只是视觉档位。
 */
export type StateTone =
	| 'unspecified'
	| 'submitted'
	| 'working'
	| 'inputRequired'
	| 'authRequired'
	| 'completed'
	| 'failed'
	| 'canceled'
	| 'rejected';

/** 状态 → 视觉档位的唯一真值表（9 条，一个状态一条）。 */
const TONE_OF_STATE: Readonly<Record<TaskState, StateTone>> = Object.freeze({
	[TaskState.UNSPECIFIED]: 'unspecified',
	[TaskState.SUBMITTED]: 'submitted',
	[TaskState.WORKING]: 'working',
	[TaskState.INPUT_REQUIRED]: 'inputRequired',
	[TaskState.AUTH_REQUIRED]: 'authRequired',
	[TaskState.COMPLETED]: 'completed',
	[TaskState.FAILED]: 'failed',
	[TaskState.CANCELED]: 'canceled',
	[TaskState.REJECTED]: 'rejected',
});

/**
 * 状态 → 视觉档位。
 *
 * 就是查表；未知值回落 `unspecified`（最淡、最不引人注意）。
 *
 * @param status A2A 状态全名
 */
export function stateTone(status: string): StateTone {
	if (!isTaskState(status)) return 'unspecified';
	return TONE_OF_STATE[status];
}

/**
 * 状态 → 中文名。未知状态回落协议名去掉前缀（**不编中文**）。
 *
 * @param status A2A 状态全名
 */
export function stateLabel(status: string): string {
	if (isTaskState(status)) return STATE_LABELS[status];
	return status.replace(/^TASK_STATE_/, '');
}

/**
 * 是不是草稿（`draft` 组）。
 *
 * 列表/科技树用它决定**边框**：草稿不加边框（用户 `2026-11-10`：
 * 「草稿无边框、选中用强调色」），其它状态有实线边框。
 *
 * @param status A2A 状态全名
 */
export function isDraftStatus(status: string): boolean {
	return isTaskState(status) && STATUS_GROUP_OF[status] === 'draft';
}

/**
 * 是不是已收尾（`ended` 组）。
 *
 * @param status A2A 状态全名
 */
export function isEndedStatus(status: string): boolean {
	return isTaskState(status) && STATUS_GROUP_OF[status] === 'ended';
}

/* ══════════════════════════════════════════════════════════
   分类
   ══════════════════════════════════════════════════════════ */

/** 四个已知分类，顺序固定（目标 → 设计 → 工作 → 记录）。 */
export const KIND_ORDER = ['goal', 'design', 'work', 'record'] as const;

/** 已知分类之一。 */
export type KnownKind = (typeof KIND_ORDER)[number];

/** 是不是四个已知分类之一。 */
export function isKnownKind(kind: string): kind is KnownKind {
	return (KIND_ORDER as readonly string[]).includes(kind);
}

/**
 * 分类 → 编号/徽章的色系 key。
 *
 * ⚠ 未知分类回落 `'record'`（灰）—— 与旧版一致：
 *   编号只是几个字符没颜色不碍事，但**徽章是色块**，没有底色会像渲染坏了一半。
 *   给它一个中性灰，让「这是个我不认识的分类」**看得见**。
 *
 * @param kind 分类 id
 */
export function kindTone(kind: string): KnownKind {
	return isKnownKind(kind) ? kind : 'record';
}

/* ══════════════════════════════════════════════════════════
   时间
   ══════════════════════════════════════════════════════════ */

/** 时间戳 → `MM-DD`。`<= 0` 或无效值返回空串（**不编默认值**）。 */
export function fmtDate(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return '';
	const date = new Date(ms);
	return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 时间戳 → `MM-DD HH:mm`。 */
export function fmtDateTime(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return '';
	const date = new Date(ms);
	return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** 创建时间与最后一次动作时间。 */
export interface CardTimes {
	/** `history` 里第一条 `create` 的时间；找不到是 `undefined`。 */
	readonly created: number | undefined;
	/** `history` 最后一条的时间；空历史是 `undefined`。 */
	readonly last: number | undefined;
}

/**
 * 未读该亮哪一边。
 *
 * ## 用户 `2026-11-17`：两边同时为真在现实中不可能
 *
 * > 「然后你这个两边都改过是不可能的。这个东西是，一边改了而且另一边没读。
 * >  他要改肯定会读啊。不点开读怎么改？」
 *
 * 对 —— 改之前必须点开，点开就 `markSeen` 了，所以「AI 改过我没读」和
 * 「我改过 AI 没读」**不会同时成立**。
 *
 * ## 但数据层允许它是坏的
 *
 * core 的 `unreadAfter` 只置位不清位，`clearedUnread` 由 `markSeen` 触发。
 * 如果**客户端没调 `markSeen` 就写**（程序化写、SSE 竞态、别处直接改库），
 * 两个 can 同时为 `true`（`core/test/updates.test.ts:130` 就构造出了这个状态）。
 *
 * ⇒ **这里是唯一的判决点**：两个都为真时，只亮**左边（AI 改过）**。
 *
 * 为什么偏向左边：用户正在看这个界面，「我有一条没读的更新」是他能行动的信息；
 * 「我改了 AI 还没读」是 AI 的事，不该占用视觉主位。
 * 而且两个都亮会让人以为「选中了」。
 *
 * @param unread 卡的未读字段
 * @returns `'left'` = AI 改过（左）、`'right'` = 我改过（右）、`'none'` = 两边都不亮
 */
export function unreadSide(unread: {
	readonly ai: boolean;
	readonly user: boolean;
}): 'left' | 'right' | 'none' {
	if (unread.ai) return 'left';
	if (unread.user) return 'right';
	return 'none';
}

/**
 * 从 `history` 取创建时间与最后动作时间。
 *
 * ⚠ **空历史时两个都 `undefined`** —— 调用方自己跳过空值，这里不编默认值。
 *
 * ⚠ **不统计「最后动过」时排除 `recompute`**：那是机器推导（父卡随子任务变化），
 *   不是人动过。用户看「最后动过」是想知道**谁最后一次真的碰了这张卡**。
 *
 * @param history 历史数组（可能是脏数据）
 */
export function cardTimes(history: readonly { readonly at: number; readonly action: string }[]): CardTimes {
	const created = history.find((one) => one.action === 'create');
	const last = history.length > 0 ? history[history.length - 1] : undefined;

	return {
		created: typeof created?.at === 'number' ? created.at : undefined,
		last: typeof last?.at === 'number' ? last.at : undefined,
	};
}
