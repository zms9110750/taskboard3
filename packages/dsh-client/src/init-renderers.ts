/**
 * `initRenderers()` —— 注册内置渲染器并封盘。
 *
 * ## 为什么在 `src/render-registry.ts` 之外
 *
 * 注册表本身是**纯数据结构，零组件 import**（这样它能被 `node --test` 直接跑）。
 * 这个文件 import 了 `.tsx` → 不能在 Node 里跑（`node --test` 加载不了 JSX）。
 *
 * ## 它**遍历表**注册，不是手写三行
 *
 * `builtinRendererEntries()` 来自一张
 * `Record<BuiltinType, RendererComponent>` 表 —— 那张表的**键集在编译期锁死**，
 * 和 `BUILTIN_TYPES` 完全对齐（见 `builtin-types.ts` 文件头）。
 *
 * ⇒ 如果这里手写 `registerRenderer('text', …)` 三行，那「表里有第四个但没注册」
 *   又能发生了。遍历表就把「清单」和「注册」变成同一件事。
 *
 * ## 重复调用的行为：**幂等，什么都不做**
 *
 * `apply()` 可能被调多次（面板折叠/展开时 Cordis 重新 install）。
 * 三种处理方式：
 *
 * | 做法 | 后果 |
 * |---|---|
 * | 第二次抛错 | 面板一展开就崩 —— 用户看到的是「任务板打不开」 |
 * | 第二次重新注册 | `registerRenderer` 抛「重复注册」—— 同样崩 |
 * | **第二次直接返回**（选这个） | 面板反复开合没有副作用 |
 *
 * ⇒ 幂等。判据是 `isSealed()`：封盘就是「已经初始化过」的标记。
 *
 * ## 和 `sealRegistry()` 的关系
 *
 * 封盘在这里调（而不是让 `apply()` 各调一次）——
 * **「注册了什么」和「什么时候封盘」是同一件事**，分开会让
 * 「有人注册了却忘了封盘」变成一个可发生的状态。
 */

import { isSealed, registerRenderer, sealRegistry } from './render-registry.ts';
import { builtinRendererEntries } from './renderers/builtin-renderers.tsx';

/**
 * 注册内置渲染器并封盘。
 *
 * 幂等：已封盘时直接返回（见文件头）。
 */
export function initRenderers(): void {
	if (isSealed()) return;
	for (const [type, Comp] of builtinRendererEntries()) registerRenderer(type, Comp);
	sealRegistry();
}
