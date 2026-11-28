// TODO(审查): 本文件仍是按产品包用法手写的垫片，但**owner 清理语义已核实（2026-11-28，源码级）**：
//   `ctx.slots.inject` 内部第一句就是 `ctx.effect`（`dsh-client-ui-renderer/lib/client.js:1368-1370`；
//   该包随 asar 只发 `lib/`、不发 `src/`，所以这里引 lib 行号），factory 返回的 disposer 挂在该槽
//   「声明寿命」的 effect 上：owner 坍缩时拆、恢复时重装（`:1394` 的 `ctx.effect(callback, …)`）、
//   插件卸载时随外层 controller 一起清（`:1424-1426`）。⇒ **裸调丢返回值不会泄漏**，丢的只是
//   「提前手动停」的能力。官方文档同一句（`dsh/docs/subsystems/slots.md:27`，lead `2026-11-28`
//   源码级核实）："the callback runs for each declaration lifetime, its effects are removed when
//   the owner collapses, and it runs again if the owner is mounted again."
//
//   ⇒ 保留下来的是**类型漂移清单**（升级到真 cordis 类型时会红的点，逐条带出处）：
//   ① `ctx.effect` 的返回值：真实是 `Disposable<Promise<void>>` / `AsyncDisposable<Promise<void>>`
//      （`cordis/src/fiber.ts:421-423`；`Disposable<T> = () => T` 见 `:74`），本文件写成 `void`。
//   ② `slots` / `sidebarRightTabs` / `locale` 在真实 `Context` 上**不是** readonly，`locale` 也**不是**
//      可选（据 DSH 源码核实；该处不发 .d.ts，只能源码级核对）。
//   ③ `SlotRegistration` 缺 `children` / `store` / `select` / `priority` / `registrant`；真实 `inject`
//      返回 `Record<string, unknown>` 且 `sessionId` **非必填**
//      （`dsh-client-ui-renderer/src/client/registry.ts:209-271`）。
//   ④ `SidebarRightTabDefinition` 缺 `multiple?` / `keepMounted?`，且 `guide[].order` 真实是**必填**。
//   ⑤ 真实 `provide(name, value?, check?)` **没有** `<T>` 泛型（`cordis/src/reflect.ts:46`、`:291`）
//      ⇒ `@taskboard/store` 的 `ctx.provide<CardStore>(…)` 会报错。
//   ⑥ 真实 `Inject = (keyof M)[] | { [K in keyof M]?: M[K] }` 是**可变**数组（`cordis/src/registry.ts:19`）
//      ⇒ 本仓 5 处 `as const` 的 `inject`（外加 store 的 `readonly string[]`）将来 `satisfies Plugin`
//      会全部报错。
//
//   ⚠ 本文件不随 lib 发布（见 client.tsx 顶部 TODO 第 1 条）—— 发布方式仍待用户裁定。

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
 * 核对：2026-11-28 —— 成员面与 DSH 0.2.2-rc.2 的实际用法一致；类型差见文件头清单 ①②。
 */
declare module '@deepseek-ai/cordis' {
	export interface Context {
		/** 注册一个随插件卸载而清理的 effect。 */
		effect(fn: () => (() => void) | void, label?: string): void;
		readonly slots: SlotsRegistry;
		readonly sidebarRightTabs: SidebarRightTabsRegistry;
		readonly locale?: LocaleRegistry;
	}

	// 核对：2026-11-28 —— inject 的清理语义成立（见文件头）；register 形状未变。
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

	// 核对：2026-11-28 —— id/key/order 的形状对；真实选项还多 5 个键、inject 更宽（见文件头 ③）。
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
		 * 核对：2026-11-28 —— register 的形状对；definition 的字段差见文件头 ④。
		 */
		register(definition: SidebarRightTabDefinition): () => void;
	}

	// 核对：2026-11-28 —— 本包运行时**没有** inject 'locale'（client.tsx 的 inject 只有 slots /
	// sidebarRightTabs），此块只是给将来接线留的形状；未与真实 LocaleRegistry 逐项核对。
	export interface LocaleRegistry {
		register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void;
	}
}

/**
 * 右侧栏 tab 定义。
 *
 * 依据：`docs/通道方案.md` Q3（`tab-registry.ts:94-139` 的字段表）。
 * 核对：2026-11-28 —— 字段差见文件头 ④（缺两个可选字段；`guide[].order` 真实必填）。
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
	// 核对：2026-11-28 —— `order` 真实必填（见文件头 ④）。
	export interface GuideEntry {
		readonly id: string;
		readonly order?: number;
		readonly title: () => string;
		readonly description?: () => string;
		readonly commandId?: string;
		readonly icon?: unknown;
	}
}
