/**
 * 外部宿主的**类型桩** —— 与 `@taskboard/dsh-client` 的 `src/host-types.d.ts`
 * 同一形态，只声明**本包用到的成员**（本包不用 `sidebarRightTabs`，删掉那一块）。
 *
 * ⚠ 本文件不能有顶层 import / export（否则 declare module 退化成模块增强 ⇒ TS2307）。
 */

declare module '@deepseek-ai/cordis' {
	export interface Context {
		/** 注册一个随插件卸载而清理的 effect。 */
		effect(fn: () => (() => void) | void, label?: string): void;
		readonly slots: SlotsRegistry;
	}

	export interface SlotsRegistry {
		/** 注册一个 slot 条目，返回 disposer。 */
		register(options: SlotRegistration, component: unknown): () => void;
		/**
		 * 随 owner 声明坍缩/恢复而移除/重装 `factory` 内的注册。
		 * 依据：`dsh-client-ui-sidebar-files/src/client/index.ts:174`。
		 */
		inject(ownerKey: string, factory: () => () => void): () => void;
	}

	export interface SlotRegistration {
		/** 槽名（被注册进哪个槽）。 */
		readonly name: string;
		/** keyed 槽（如 `main`）用的键 = 实现身份。 */
		readonly key?: string;
		/** list 槽里这一条的 id（全局唯一）。 */
		readonly id?: string;
		/** list 槽内的排序（越小越靠前）。 */
		readonly order?: number;
		/** 这条的显示名。 */
		readonly label?: string;
		readonly locale?: string;
		readonly inject?: (sessionId: string) => unknown;
	}
}
