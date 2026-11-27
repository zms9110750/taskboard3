/**
 * 包内**唯一的 API 客户端实例** —— 模块级、惰性、可注入。
 *
 * ## 为什么需要它
 *
 * `createApi()` 之前被四处各调一次（`client.tsx` 的渲染检查、`store.ts`、
 * `WorkspaceBody.tsx`、`CreateFlow.tsx`）。虽然 `TaskboardApi` 目前无状态
 * （每次调用只是闭包 + 一个 `fetch` 包装），多实例**不会**造成数据错乱；
 * 但这意味着「换通道 / 加 base / 加默认 header / 加请求拦截」要改四处，
 * 而漏改一处不会报错 —— 只会静默地走另一条路。
 *
 * ⇒ 产品代码一律 `getApi()`；测试 / 预览仍走各自已有的显式注入口
 * （`useBoardState(apiImpl)` / `WorkspaceBody.api` / `CreateFlow.api`），
 * 那几条路径**不经过本模块**，行为不变。
 *
 * ## 为什么惰性
 *
 * 模块求值时不建实例（`createApi()` 只包一个 `fetch` 引用，开销可忽略，
 * 但「模块加载即创建」会让将来的有状态实现（如带 token 缓存）在 import
 * 那一刻就要求运行环境就绪）。首次 `getApi()` 时才构造并缓存。
 *
 * ## 为什么在模块级而不是 hook 里
 *
 * `useRef(createApi())` 的实参每次渲染都会执行（只采用首值）——
 * 纯浪费。单例既不需要 ref，也不会在 React 严格模式双调用下建两份。
 */

import { createApi, type TaskboardApi } from './api.ts';

/** 缓存的单例；`undefined` = 还没构造过。 */
let cached: TaskboardApi | undefined;

/**
 * 取包内唯一的 API 客户端（首次调用时构造）。
 *
 * @returns 单例；同一进程内每次返回**同一个对象**
 */
export function getApi(): TaskboardApi {
	cached ??= createApi();
	return cached;
}
