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
import { createElement } from 'react';
import type { ReactNode } from 'react';

import { createApi } from './api.ts';
import { registerDrawerSlots } from './register-drawer.tsx';
import { TaskboardIcon } from './renderers/TaskboardIcon.tsx';
import { WorkspaceBody } from './WorkspaceBody.tsx';
import { initRenderers } from './init-renderers.ts';
import { registeredTypes } from './render-registry.ts';
import { injectStyles } from './styles.ts';

/** 本实现的身份，也是 body 的 key。 */
export const TAB_ID = '@taskboard/dsh-client';

/**
 * 左侧栏面板 id —— `sidebar.panellist` 的条目 id，也是 `main` 槽的 key。
 *
 * ⚠ 两处必须**同一个值**：点左侧栏图标 → 主区域按这个 key 找页面。
 *   抄 `taskboard2` 的 `PANEL_ID = 'taskboard2'`（`packages/ui/client.js:16`）。
 */
export const PANEL_ID = 'taskboard3';

/** 左侧栏图标在 panellist 里的排序（taskboard2 用 30）。 */
export const PANEL_ORDER = 30;

/** tab 类型判别符（`ctx.sidebarRight.openTab('taskboard')` 用它）。 */
export const TAB_KIND = 'taskboard';

/* ══════════════════════════════════════════════════════════
   三处入口各自的布局密度
   ══════════════════════════════════════════════════════════

   用户 `2026-11-23`：

   > 「工作空间为什么是默认显示的。之前不是要按按钮才显示的吗。
   >   这个样子和我之前选的组件不一样啊。」

   ## 病根

   三处入口都直接把 `WorkspaceBody` 注册成组件，**谁都没传 `density`** ⇒
   全部落成 `Workspace` 的默认 `full` ⇒ 空间 chip 行常驻。而用户 `2026-11-22`
   选定的是 **A 款折叠栏**（`renderers/workspace/SpaceFold.tsx`：
   「工作空间 ▾」按钮 + 展开区），它**只在 `compact` 密度下渲染**。

   ⇒ 用户选的组件在产品里成了死代码，只有 `dev/preview/*` 看得见
     （那些预览页全都传了 `density="compact"`）。

   ## 三处各自的视口（决定密度）

   | 入口 | 真实视口 | 密度 | 理由 |
   |---|---|---|---|
   | 抽屉（composer 旁） | 约 1200×476 / 952×482 | `compact` | 宽但**矮**：chip 行要折两行，吃掉的正是最紧张的纵向空间 |
   | 右侧工作区页签 | 约 570×920 | `compact` | **窄**（`Workspace` 文件头：≤700px 走窄版堆叠）|
   | 左侧栏主面板（全屏） | 约 1616×988 | `full` | 宽且高：chip 行一行放得下（用户 2026-11-23 截图里就是一行）|

   ⚠ **不要用 `window.innerWidth` 自动判断**：三处入口共用一个浏览器窗口，
     窗口宽 ≠ 那一块视口的宽。宿主给多高就多高 —— 只有入口自己知道自己那块多大。
*/

/**
 * 右侧工作区页签的 body —— 窄视口（约 570×920）⇒ 紧凑密度。
 *
 * 紧凑密度下空间 chip 行折进工具栏的「工作空间 ▾」按钮（A 款折叠栏）。
 */
function RightPaneBody(): ReactNode {
	return createElement(WorkspaceBody, { density: 'compact' });
}

/**
 * 左侧栏主面板的 body —— 宽且高的全屏视口（约 1616×988）⇒ 完整密度。
 *
 * 完整密度下空间 chip 行常驻在页面最上面一行（放得下，不用点按钮）。
 */
function MainPanelBody(): ReactNode {
	return createElement(WorkspaceBody, { density: 'full' });
}

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
	/*
	 * ⚠ **第一件事**：注册 action 渲染器。
	 *
	 * 必须在建 React 树之前 —— ① 的检查（接通时比对模板需要的 vs 已注册的）
	 * 要用 `registeredTypes()`，而它读的是此刻的注册表。
	 *
	 * **幂等**：`apply()` 可能被调多次（面板折叠/展开时 Cordis 重新 install），
	 * 封盘后再调直接返回。见 `init-renderers.ts` 文件头。
	 */
	initRenderers();

	/*
	 * ① 的**运行时检查** —— 把「UI 能画哪些 $type」报给 Host，让它比对模板需求。
	 *
	 * ## ⚠ 不 await
	 *
	 * `apply()` 是**同步**的（Cordis 的插件加载接口）。`await` 会阻塞插件加载 ——
	 * 面板要等一个 HTTP 往返才能出现，而**这个检查的结果不影响面板能不能用**
	 * （缺渲染器只让那几章降级，不是致命错误）。
	 *
	 * ⇒ `void … .then(…).catch(…)`。
	 *
	 * ## ⚠ catch 里必须打日志
	 *
	 * 网络失败时如果静默：① 的检查就**永远不生效**，而且没人知道。
	 * 那和「检查通过」看起来一模一样 —— 这是最坏的一类静默。
	 *
	 * ## 为什么是 `void` 而不是留着 promise
	 *
	 * 没有调用方会等这个检查。`void` 明说「我故意丢弃这个 promise」，
	 * 比留着未处理的 promise 更清楚（后者会被 lint 当成漏处理）。
	 */
	void createApi()
		.renderCheck(registeredTypes())
		.then((result) => {
			if (result.missing.length === 0) return;
			/*
			 * ① 的警告 —— **浏览器侧一份**（Host 那份在 `http.ts` 的 route 里打）。
			 *
			 * 两边看的是**同一次计算**的结果，不是两套逻辑。
			 * 插件开发者看 Host 日志；UI 开发者看 devtools。都该能看到。
			 */
			console.warn(
				`[taskboard3] 有 ${String(result.missing.length)} 个 action 没有注册渲染器，` +
					`相关章节会降级成 JSON：${result.missing.join('、')}`,
			);
		})
		.catch((cause: unknown) => {
			/*
			 * ⚠ 不吞。① 的检查失败是个**事实**，要留痕 ——
			 *   否则「没缺渲染器」和「检查没跑成」在日志里长得一样。
			 */
			console.warn(
				'[taskboard3] 渲染器检查没跑成（面板不受影响）：',
				cause instanceof Error ? cause.message : String(cause),
			);
		});

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
				ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, RightPaneBody),
			),
		'taskboard3: register right-sidebar tab body',
	);

	/*
	 * ══════════════════════════════════════════════════════════
	 * ② 左侧栏入口
	 * ══════════════════════════════════════════════════════════
	 *
	 * 用户 `2026-11-23`：「只有工作区有入口。没有抽屉入口。也没有左边的入口。」
	 *
	 * ## 两个槽是一对（缺一不可）
	 *
	 * | 槽 | 条目形状 | 作用 |
	 * |---|---|---|
	 * | `sidebar.panellist` | `{ name, id, order, label }` | 左侧栏那颗图标按钮 |
	 * | `main` | `{ name, key, label }` | 点图标后主区域显示的页面 |
	 *
	 * **`panellist` 的 `id` = `main` 的 `key` = `PANEL_ID`**，`label` 也必须是同一个
	 * —— 这是两个槽之间的绑定方式。抄 `taskboard2`（`packages/ui/client.js:216-224`），
	 * 那份代码在 desktop profile 里跑着，所以这两条槽名是**已验证的**，不是猜的。
	 *
	 * ## 为什么内容用 `WorkspaceBody` 而不是另写一份
	 *
	 * 它自己 `useBoardState()` ⇒ **不需要宿主喂数据**。
	 * 左侧栏 / 抽屉 / 右栏页签三处各是独立实例 ⇒ 各自一份 loading / 选中卡状态，
	 * 这是对的（用户在两处看不同空间不该互相干扰）。
	 */
	ctx.effect(
		() =>
			ctx.slots.inject('sidebar.panellist', () =>
				ctx.slots.register(
					{ name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: '任务板' },
					TaskboardIcon,
				),
			),
		'taskboard3: register sidebar panellist entry',
	);

	ctx.effect(
		() =>
			ctx.slots.inject('main', () =>
				ctx.slots.register({ name: 'main', key: PANEL_ID, label: '任务板' }, MainPanelBody),
			),
		'taskboard3: register main panel body',
	);

	/*
	 * ══════════════════════════════════════════════════════════
	 * ③ 抽屉入口（composer 输入框旁）
	 * ══════════════════════════════════════════════════════════
	 *
	 * 入口按钮 + 面板是**两个槽条目**，各自渲染在不同位置，**只能靠共享 store 同步
	 * `open`** —— 那个 store 是**模块级单例**（`pure/drawer-state.ts`），
	 * 两个槽各自 `useSyncExternalStore` 它。见 `register-drawer.tsx` 文件头的
	 * 「为什么不用 `inject(sessionId)`」（实测会崩）。
	 *
	 * 内容传 `createElement(WorkspaceBody)`：它自己拉数据，Drawer 只管外壳。
	 *
	 * ⚠ **不要再包一层 `ctx.slots.inject`** —— `registerDrawerSlots` 内部已经对
	 *   两个槽各做了一次 `inject`，disposer 由 Cordis 按 owner 管理。
	 *   再包一层会让「注册函数的执行时机」和「owner 坍缩」错位。
	 */
	registerDrawerSlots(ctx, { content: createElement(WorkspaceBody, { density: 'compact' }) });
}
