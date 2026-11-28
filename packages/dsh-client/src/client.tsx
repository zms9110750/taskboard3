/*
 * TODO(审查): 包级遗留（非本文件代码，均为审查发现，未改行为）——
 * 1) tsconfig 的 emitDeclarationOnly 不拷贝 src/host-types.d.ts，而 lib/index.d.ts / lib/client.d.ts 依赖 @deepseek-ai/cordis ⇒ 消费者 TS2307；需把垫片纳入 files 或声明 peerDependency（发布方式需用户定）。详见 host-types.d.ts 顶部。
 * 2) locale/*.json 只在 Plugin Manager meta 层被读，运行时未 inject 'locale'；是否接运行时 i18n 需用户决定。
 */

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

import { getApi } from './api-client.ts';
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

/**
 * 左侧栏入口的**两个槽条目**（一次生成，id / order / label 只有一个来源）。
 *
 * `sidebar.panellist` 与 `main` 是一对：前者的 `id` 必须等于后者的 `key`，
 * 两处 `label` 也必须一致，否则图标和页面对不上（或页签文字漂移）。
 * 依赖手抄两份常量时，改一处漏一处**不会报错**，只会静默错位 ——
 * 所以由这个工厂同时产出两份描述，调用处只负责 `register`。
 */
interface PanelEntry<Icon, Body> {
	readonly panellist: {
		readonly name: 'sidebar.panellist';
		readonly id: string;
		readonly order: number;
		readonly label: string;
	};
	readonly main: {
		readonly name: 'main';
		readonly key: string;
		readonly label: string;
	};
	readonly Icon: Icon;
	readonly Body: Body;
}

/**
 * 造左侧栏入口的两个槽条目。
 *
 * @param id 面板 id（panellist 的 `id` = main 的 `key`）
 * @param order panellist 内的排序
 * @param label 两侧共用的显示名
 * @param Icon 左侧栏图标组件
 * @param Body 主区域页面组件
 * @returns 两个槽描述 + 各自组件
 */
function panelEntry<Icon, Body>(
	id: string,
	order: number,
	label: string,
	Icon: Icon,
	Body: Body,
): PanelEntry<Icon, Body> {
	return {
		panellist: { name: 'sidebar.panellist', id, order, label },
		main: { name: 'main', key: id, label },
		Icon,
		Body,
	};
}

/** 左侧栏入口（标签页 / 主区域共用同一份 id + label）。 */
const PANEL_ENTRY = panelEntry(PANEL_ID, PANEL_ORDER, '任务板', TaskboardIcon, WorkspaceBody);

/**
 * tab 类型判别符（`ctx.sidebarRight.openTab('taskboard')` 用它）。
 */
export const TAB_KIND = 'taskboard';

/*
 * ⚠ 「工具权限」入口（`TOOLS_PANEL_ID`）与 composer 权限框已随 #4 分包裁定
 *   （2026-11-27）搬去 `@taskboard/dsh-permissions` 独立一行 —— 本行不再注册它们。
 *   那一行的激活闸门是 `inject: ['taskboard3AgentGuard']`：守卫行不在 ⇒ 权限入口
 *   整个不出现，本行照常工作。
 */

/* ══════════════════════════════════════════════════════════
   三处入口：同一套 DOM，只有视口不同
   ══════════════════════════════════════════════════════════

   用户 `2026-11-23`：

   > 「用同一套dom。让他们的视口不一样。但是视口内用同一个组件。」
   > 「视口组件以工作区的那个为准。」

   ⇒ 删掉 `density` 这个参数。三处入口**直接注册 `WorkspaceBody`**，
     不再有自己的 wrapper、不再传密度。

   能不能放下（工具栏换行、切线横/竖）由**容器宽度**自己决定
   —— 那是 `@container tb3w` 的职责，不该再由一个手传的参数二次判断。

   ⚠ 曾经三处传了不同密度（全屏 `full`、抽屉/右栏 `compact`）⇒ 三个入口
     长成三种样子。用户否掉：「为什么三个入口的样子不一样。为什么不统一一样」。
*/

/** 权限框入口的常量已随权限面一起搬到 `@taskboard/dsh-permissions`。 */

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
	void getApi()
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
				ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, WorkspaceBody),
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
				ctx.slots.register(PANEL_ENTRY.panellist, PANEL_ENTRY.Icon),
			),
		'taskboard3: register sidebar panellist entry',
	);

	ctx.effect(
		() =>
			ctx.slots.inject('main', () => ctx.slots.register(PANEL_ENTRY.main, PANEL_ENTRY.Body)),
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
	 *   两个槽各做了一次 `inject`。再包一层**不是泄漏**（裸调本身不泄漏，见
	 *   `register-drawer.tsx` 的说明），而是**行为耦合**：那两个槽的注册会被额外绑到
	 *   第三个无关 owner 声明上 —— 那个 owner 坍缩时两条一起消失、恢复时一起重装。
	 */
	registerDrawerSlots(ctx, { content: createElement(WorkspaceBody) });

	/*
	 * ④ 权限框入口（composer 工具行内）已随 #4 分包裁定（2026-11-27）搬到
	 *    `@taskboard/dsh-permissions` 独立一行 —— 本行不再注册它。
	 */
}
