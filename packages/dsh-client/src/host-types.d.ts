/**
 * 外部宿主的**类型桩**（ambient declarations）。
 *
 * ## 为什么是 `declare module` 而不是真依赖
 *
 * 本包在浏览器里运行，`@deepseek-ai/cordis` 由宿主提供，不在我们自己的
 * `node_modules` 里。若写成真 `dependencies`：
 *   · 会把整个 DSH 包树拖进依赖（不可接受，且版本会漂）；
 *   · 开源贡献者装不上（这些包不在公共 registry）。
 *
 * ⇒ `declare module` 只声明**我们真的用到的那几个成员**。少声明一个会
 *   在 `tsc` 时报错，不会静默。
 *
 * ⚠ **本文件不能有顶层 import / export。**
 *   一旦有，它就变成"模块"，里面的 `declare module` 会从"环境声明"
 *   退化成"模块增强"—— 而增强要求目标模块已经存在，于是 TS2307。
 *   这就是第一版报 `Cannot find module '@deepseek-ai/cordis'` 的原因。
 *   ⇒ 形状类型放 `host-types.ts`，本文件只放模块声明。
 */

/**
 * Cordis 上下文（只声明本包用到的成员）。
 *
 * 依据：`dsh-client-ui-sidebar-files/src/client/index.ts:64` 的 inject 清单、
 * `:162-184` 的 effect / register 调用形状。
 */
declare module '@deepseek-ai/cordis' {
	export interface Context {
		/** 注册一个随插件卸载而清理的 effect。 */
		effect(fn: () => (() => void) | void, label?: string): void;
		readonly slots: SlotsRegistry;
		readonly sidebarRightTabs: SidebarRightTabsRegistry;
		readonly locale?: LocaleRegistry;
	}

	export interface SlotsRegistry {
		/** 注册一个 slot 条目，返回 disposer。 */
		register(options: SlotRegistration, component: unknown): () => void;
		/**
		 * 随 owner 声明坍缩/恢复而移除/重装 `factory` 内的注册。
		 *
		 * 依据：`dsh-client-ui-sidebar-files/src/client/index.ts:174`。
		 */
		inject(ownerKey: string, factory: () => () => void): () => void;
	}

	export interface SlotRegistration {
		/** 槽名（被注册进哪个槽）。 */
		readonly name: string;
		/** keyed 槽（如 `sidebar.right.pane.tab`）用的键 = 实现身份。 */
		readonly key?: string;
		/**
		 * list 槽里这一条的 id（全局唯一）。asar 原文（`2026-11-20` 复核）：
		 * `scope.slots.register({name, id:'command-popup', order:1, locale:NS, inject:…}, PopupSelectView)`。
		 */
		readonly id?: string;
		/** list 槽内的排序（越小越靠前）。 */
		readonly order?: number;
		/** 这条的显示名（可选；DSH 的坞槽示例用 `label`）。 */
		readonly label?: string;
		readonly locale?: string;
		/**
		 * 每个 session 解析一次注入值（组件 props 的一部分）。
		 * 原文：`inject: (sessionId) => ({…})`。
		 */
		readonly inject?: (sessionId: string) => unknown;
	}

	export interface SidebarRightTabsRegistry {
		/**
		 * 注册一个右侧栏 tab 类型，返回 disposer。
		 *
		 * 依据：`dsh-client-ui-sidebar-files/src/client/definition.tsx:25-39`。
		 */
		register(definition: SidebarRightTabDefinition): () => void;
	}

	export interface LocaleRegistry {
		register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void;
	}
}

/**
 * 右侧栏 tab 定义。
 *
 * 依据：`docs/通道方案.md` Q3（`tab-registry.ts:94-139` 的字段表）。
 */
declare module '@deepseek-ai/cordis' {
	export interface SidebarRightTabDefinition {
		/** 实现身份，全局唯一；也是 body / title 注册用的 key。 */
		readonly id: string;
		/** 类型判别符；`ctx.sidebarRight.openTab(kind)` 用它。 */
		readonly kind: string;
		/** `'extension'`（默认）/ `'builtin'` / `'fallback'`。 */
		readonly priority?: 'extension' | 'builtin' | 'fallback';
		/** 资源地址 glob；页面类型不写。 */
		readonly patterns?: readonly string[];
		/** 拒绝 glob 命中的地址。 */
		readonly canOpen?: (address: string) => boolean;
		/** tab 标题。 */
		readonly title: (address: string) => string;
		/** 指南页入口卡片。 */
		readonly guide?: readonly GuideEntry[];
	}

	/** 指南页的一张卡片。 */
	export interface GuideEntry {
		readonly id: string;
		readonly order?: number;
		readonly title: () => string;
		readonly description?: () => string;
		readonly commandId?: string;
		readonly icon?: unknown;
	}
}
