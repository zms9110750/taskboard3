/**
 * `initRenderers()` —— 注册三个内置渲染器并封盘。
 *
 * ## 为什么在 `src/render-registry.ts` 之外
 *
 * 注册表本身是**纯数据结构，零组件 import**（这样它能被 `node --test` 直接跑）。
 * 这个文件 import 了 `.tsx` → 不能在 Node 里跑（`node --test` 加载不了 JSX）。
 *
 * ⇒ 拆成两个文件，测试只测注册表那一半。
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
 * ⚠ **但封盘后 `initRenderers()` 也不该静默成功** —— 如果用户在封盘后
 *   手动注册了别的东西再调 init，那是错的。这里的选择是：
 *   已封盘 ⇒ 直接返回（不抛）。理由：正常路径下封盘只由本函数造成，
 *   而本函数的调用方是 `apply()`，它对「调了几次」没有控制权。
 *
 * ## 和 `sealRegistry()` 的关系
 *
 * 封盘在这里调（而不是让 `apply()` 各调一次）——
 * **「注册了什么」和「什么时候封盘」是同一件事**，分开会让
 * 「有人注册了却忘了封盘」变成一个可发生的状态。
 */

import { isSealed, registerRenderer, sealRegistry } from './render-registry.ts';
import { AskRenderer, MarkdownRenderer, TextRenderer } from './renderers/builtin-renderers.tsx';

/**
 * 注册三个内置渲染器。
 *
 * 幂等：已封盘时直接返回（见文件头）。
 */
export function initRenderers(): void {
	if (isSealed()) return;
	registerRenderer('text', TextRenderer);
	registerRenderer('markdown', MarkdownRenderer);
	registerRenderer('ask', AskRenderer);
	sealRegistry();
}
