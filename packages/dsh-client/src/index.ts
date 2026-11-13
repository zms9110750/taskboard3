/**
 * Node 侧的插件入口（Cordis 会加载这个）。
 *
 * ## 为什么存在
 *
 * `dsh.bundle.patch` 的每一行都要指向一个**能在 Host 侧被 import 的模块**。
 * 即使这个包只提供浏览器半，Host 半也必须存在 —— 否则 Loader 加载那行时会
 * 找不到入口而报错。
 *
 * ## 它什么都不做
 *
 * 浏览器半（`./client`）由 `dsh.client` 声明单独加载，
 * Host 半不注册任何东西 —— 路由和 core 在 `@taskboard/dsh` 那边。
 */

import type { Context } from '@deepseek-ai/cordis';

/** 插件名。 */
export const name = 'taskboard3-dsh-client-host';

/**
 * Host 半：无副作用。
 *
 * @param _ctx 宿主上下文（不用）
 */
export function apply(_ctx: Context): void {
	/* 故意为空：本包只有浏览器半。 */
}
