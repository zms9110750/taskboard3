/**
 * 宿主 Cordis 的**类型桩** —— 与 `@taskboard/dsh-client` / `@taskboard/dsh-permissions`
 * 的 `src/host-types.d.ts` 同形态：只声明本包用到的成员。
 *
 * `@deepseek-ai/cordis` 由 DSH 宿主在运行时提供，**不是本包的 npm 依赖**
 * ⇒ 不 type-only import 真实包，避免把一个只跑在 DSH 里的类型依赖带进来。
 *
 * ⚠ 本文件不能有顶层 import / export（否则 `declare module` 退化成模块增强 ⇒ TS2307）。
 * ⚠ 真实 Cordis 4.1.0 的 `provide` 还收第三个参数并返回 disposer、`effect` 的
 *   disposer 可以返回 Promise 且 Cordis 卸载时会 await 它（`cordis/src/fiber.ts:720-730`）
 *   —— 这里只声明本包用到的窄面，`effect` 自己的返回值丢给 `void`。
 */

declare module '@deepseek-ai/cordis' {
	export interface Context {
		/** 注册/提供运行时服务。 */
		provide<T>(serviceName: string, api: T): void;
		/** 注册一个随插件卸载而执行的副作用；返回清理函数（可以返回 Promise）。 */
		effect(effect: () => (() => void | Promise<void>) | void, label?: string): void;
	}
}
