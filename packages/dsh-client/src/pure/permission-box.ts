/**
 * 权限框的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * ## 用户裁决（`2026-11-23`）
 *
 * > 「这里要有一个权限框。任务板干涉工具。任务板限制工具。ai可改任务板工作权限。
 * >   之前说的权限正交问题。」
 *
 * 拆成四句：
 *
 * | 用户的话 | 落到哪条轴 |
 * |---|---|
 * | 「任务板干涉工具」 | 宿主轴 `toolGuardLevel` = `manage` |
 * | 「任务板限制工具」 | 宿主轴 `manage` 时按 BASE / 持有卡 / 四档策略拦 |
 * | 「ai 可改任务板工作权限」 | 宿主轴 `manage-edit`（第三档，允许 AI 读写档位工具）|
 * | 「权限正交」 | 另一条 UI 轴 `cardActionLevel` 独立存在，两轴各自判 |
 *
 * ⇒ 这个框要**同时显示两条轴**（正交的可见性），不是一个总开关。
 *
 * ## 这个文件管什么
 *
 * · 把「两条轴的当前值」压成按钮上的一句摘要（`summaryOf()`）
 * · 判断摘要该不该标「非默认」（`isNonDefault()`）—— 一眼看出有人动过
 *
 * ## 不管什么
 *
 * 文案的**唯一来源是接口返回的 options 数组**（服务端来自 core 的
 * `CARD_ACTION_OPTIONS` / `TOOL_GUARD_OPTIONS`）。本文件**不硬编码任何档位文案**，
 * 只拼「轴名 + 档位 label」。第二份文案漂移时不会报错，只会静默显示一个存不进去的档。
 */

/** 一个档位（形状与接口 options 元素一致）。 */
export interface BoxOption {
	readonly value: string;
	readonly label: string;
	readonly description: string;
}

/** 两轴快照（GET /permission 的 data）。 */
export interface BoxSnapshot {
	readonly cardActionLevel: string;
	readonly toolGuardLevel: string;
	readonly cardActionOptions: readonly BoxOption[];
	readonly toolGuardOptions: readonly BoxOption[];
}

/** 默认档位 —— 与人没动过时的初始值一致（core 的默认）。 */
export const DEFAULT_CARD_LEVEL = 'no-claim';
export const DEFAULT_TOOL_LEVEL = 'off';

/**
 * 某档位的显示名。
 *
 * @param options 该轴的选项表（文案唯一来源）
 * @param value 档位值
 * @returns label；找不到时**回落到原始值**（不编造文案）
 */
export function labelOf(options: readonly BoxOption[], value: string): string {
	return options.find((one) => one.value === value)?.label ?? value;
}

/**
 * 按钮上那句摘要。
 *
 * 两条轴都在 ⇒ 两个短语用 `·` 连起来。
 * 例：`不允许领卡 · 任务板不管理`
 *
 * ⚠ 不写「权限」二字 —— 按钮本身已经在 composer 里，上下文足够；
 *   写全会让按钮撑得比旁边的 `完全权限 ▾` 长太多。
 *
 * @param snapshot 两轴快照
 * @returns 一句话摘要
 */
export function summaryOf(snapshot: BoxSnapshot): string {
	const card = labelOf(snapshot.cardActionOptions, snapshot.cardActionLevel);
	const tool = labelOf(snapshot.toolGuardOptions, snapshot.toolGuardLevel);
	return `${card} · ${tool}`;
}

/**
 * 有人动过档位吗（任一条轴偏离默认值）。
 *
 * 用途：按钮未改动时用弱色，改动后加一点强调 —— 让「我是不是设过什么」
 * 一眼可见，不用点开。
 *
 * @param snapshot 两轴快照
 * @returns 任一轴非默认
 */
export function isNonDefault(snapshot: BoxSnapshot): boolean {
	return snapshot.cardActionLevel !== DEFAULT_CARD_LEVEL || snapshot.toolGuardLevel !== DEFAULT_TOOL_LEVEL;
}
