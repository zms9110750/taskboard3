/**
 * 「是否允许领卡」轴（`cardActionLevel`）的**纯逻辑** —— 零 React、零 DOM、零网络。
 *
 * ## 为什么从 `pure/permission-box.ts` 里分出来（2026-11-27，#4 分包裁定）
 *
 * 用户 `2026-11-23`：
 * > 「是否允许领卡的那个权限。放在工作空间这个按钮的左边。
 * >   他是一般ui提供的权限。影响的工具是通用tool的。所以放在一般ui里面。」
 *
 * 权限框（composer 侧的 tool 轴）已搬去 `@taskboard/dsh-permissions`；
 * card 轴归**一般 UI** ⇒ 它的文案函数与默认值留在本包，不再共享
 * dsh-permissions 的模块（两个包零共享组件，只共享 wire 契约）。
 *
 * ⚠ `labelOf` 与 dsh-permissions 里的同名函数是**同一条规则的两份实现**
 *   （都是 3 行的「从选项表找 label，找不到回落原值」）。合并它们需要一个
 *   共享包 —— 为 3 行不值得；漂移的后果也只是显示原始值，不编造文案。
 */

/** 一个档位（形状与接口 `cardActionOptions` 元素一致）。 */
export interface CardActionOption {
	readonly value: string;
	readonly label: string;
	readonly description: string;
}

/** card 轴的默认档位 —— 与人没动过时的初始值一致（core 的默认）。 */
export const DEFAULT_CARD_LEVEL = 'no-claim';

/**
 * 某档位的显示名。
 *
 * @param options card 轴的选项表（文案唯一来源，服务端来自 core 的 `CARD_ACTION_OPTIONS`）
 * @param value 档位值
 * @returns label；找不到时**回落到原始值**（不编造文案）
 */
export function labelOf(options: readonly CardActionOption[], value: string): string {
	return options.find((one) => one.value === value)?.label ?? value;
}
