/**
 * 内置 action 的 **type 清单** —— 纯数据，**零 JSX、零组件 import**。
 *
 * ## 为什么单独一个文件（而不是写在 `builtin-renderers.tsx` 里）
 *
 * 差集断言测试需要知道「UI 到底注册了哪几个 type」。
 * 但 `node --test` **不能转译 JSX** ⇒ 测试无法 import `builtin-renderers.tsx`，
 * 因此**不能调** `initRenderers()`。
 *
 * ⇒ 把「注册了哪几个 type」抽成纯数据放这里，测试只 import 这个文件 + `render-registry.ts`。
 *   两个文件都是纯 `.ts`，Node 直接跑。
 *
 * ## ⚠ 清单和组件实现是**编译期锁死**的
 *
 * `builtin-renderers.tsx` 里有一张 `Record<BuiltinType, RendererComponent>`：
 *
 * - 这边**加了第四个 type** ⇒ 那张表缺一个键 ⇒ **`tsc` 报错**
 * - 那边**加了第四个组件** ⇒ 键不在 `BuiltinType` 里 ⇒ **`tsc` 报错**
 *
 * ⇒ 不存在「清单加了但没注册」这种漂移。这是**编译期**保证，不是靠测试。
 *
 * ## 这和文档 8.2 节说的「不要用共享常量消掉两条清单」不矛盾
 *
 * 那条说的是 **`core` 和 `dsh-client` 之间**不要共享常量 —— 因为
 * 「模板需要什么」和「UI 能画什么」本来就该是**两份独立真值**，共享就把 ① 的检查
 * 变成了恒真。
 *
 * 本文件是 **`dsh-client` 内部**的：把「注册清单」和「组件实现」对齐，
 * 不是把 UI 清单和 core 清单对齐。**两份真值仍然独立。**
 */

/**
 * 内置 action 的 `$type` 清单。
 *
 * ⚠ 顺序无关（`registeredTypes()` 返回字母序），但**这里按人类直觉排**：
 * 用得最多的在前的。
 */
export const BUILTIN_TYPES = ['text', 'markdown', 'ask'] as const;

/** 内置 action 的 `$type` 之一。 */
export type BuiltinType = (typeof BUILTIN_TYPES)[number];

/**
 * 这个 type 是不是内置的。
 *
 * @param type 任意 `$type`
 */
export function isBuiltinType(type: string): type is BuiltinType {
	return (BUILTIN_TYPES as readonly string[]).includes(type);
}
