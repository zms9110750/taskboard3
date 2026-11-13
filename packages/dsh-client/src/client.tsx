/**
 * 客户端插件入口 —— 注册右侧工作区的一个标签类型。
 *
 * ## 两步注册（缺一不可）
 *
 * 1. `ctx.sidebarRightTabs.register(definition)` —— 声明「任务板」是第几种 tab
 * 2. `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID }, Body)` —— 挂 body
 *
 * **`key` 就是第 1 步的 `id`。** 这是两步之间的绑定方式；
 * 抄自 `dsh-client-ui-sidebar-files/src/client/index.ts:174-180`。
 *
 * ## 为什么 `id` 用包名
 *
 * tab 系统里 `kind` 可以被扩展类型顶替（`builtin` / `extension` band），
 * 但 `id` 是**实现身份**，全局唯一且不能被顶替 —— 用包名最不会撞。
 *
 * ## 为什么用 `ctx.slots.inject(...)` 包一层
 *
 * `slots.inject(ownerKey, factory)` 的注册随**拥有声明**的坍缩而移除、
 * 恢复时重新安装。直接 `ctx.slots.register` 只在插件卸载时移除，
 * 面板折叠/展开时会丢 body。抄自同一个文件。
 */

import type { Context } from '@deepseek-ai/cordis';

import { BoardBody } from './BoardBody.tsx';
import { injectStyles } from './styles.ts';

/** 本实现的身份，也是 body 的 key。 */
export const TAB_ID = '@taskboard/dsh-client';

/** tab 类型判别符（`ctx.sidebarRight.openTab('taskboard')` 用它）。 */
export const TAB_KIND = 'taskboard';

/** 插件名（Cordis 用）。 */
export const name = 'taskboard3-dsh-client';

/**
 * 依赖的客户端服务。
 *
 * ⚠ 这里只注入**真的会用到**的服务。`locale` 暂时不用 —— MVP 的文案
 * 直接写中文，等要做 i18n 再接（locale 文件已经备好）。
 */
export const inject = ['slots', 'sidebarRightTabs'];

/**
 * 注册 tab 类型 + body。
 *
 * @param ctx 客户端根上下文
 */
export function apply(ctx: Context): void {
	/* 样式只插一次（幂等）。见 `styles.ts` 的 `injectStyles`。 */
	injectStyles();

	ctx.effect(
		() =>
			ctx.sidebarRightTabs.register({
				id: TAB_ID,
				kind: TAB_KIND,
				/* `builtin` = 我们自带的一种页面类型，不是顶替别人的扩展。 */
				priority: 'builtin',
				title: () => '任务板',
				guide: [
					{
						id: 'taskboard',
						order: 10,
						title: () => '任务板',
						description: () => '任务卡：类型、状态机、关系。',
					},
				],
			}),
		'taskboard3: register right-sidebar tab type',
	);

	ctx.effect(
		() =>
			ctx.slots.inject('sidebar.right.pane.tab', () =>
				ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, BoardBody),
			),
		'taskboard3: register right-sidebar tab body',
	);
}
