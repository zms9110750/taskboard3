/**
 * 折叠组件的**对外入口**（`@taskboard/dsh-client/fold-pill`）。
 *
 * ## 为什么需要这个文件
 *
 * `FoldPill` / `FoldRect` 原来只在 `dsh-client` 内部使用（科技树 / 关系区）。
 * 权限链拆成独立包之后（`@taskboard/dsh-permissions`），授权页也要用同一套折叠
 * 组件 —— 而**不许复制一份**（issue #56：「复用，不新写」）。
 *
 * ## 为什么是「子路径导出 + 单独产物」而不是让权限包 import `lib/client.js`
 *
 * `dsh-client` 的浏览器半是 tsdown 打出的**单个 IIFE**（`lib/client.js`，注册进
 * `window.__ModuleLoader__`）。那是宿主的加载协议，不是可被别的包 import 的 ESM 模块。
 * ⇒ 这里另出一个**纯 ESM** 产物 `lib/fold-pill.js`（react 仍 external），
 *   权限包的 tsdown 把它 bundle 进自己的 `lib/client.js`。
 *
 * 类型来自 `tsc -b` 产出的 `lib/renderers/fold-pill-public.d.ts`（见 package.json exports）。
 *
 * ⚠ 这个入口只导出折叠组件，**不导出任何业务**（组件本身也不认识业务）。
 */

export { FoldPill, FoldRect } from './FoldPill.tsx';
export type { FoldPillProps, FoldRectProps, FoldTone } from './FoldPill.tsx';
export { FOLD_PILL_CSS } from './fold-pill-css.ts';
