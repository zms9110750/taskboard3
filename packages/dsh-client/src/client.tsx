/*
 * TODO(审查): 包级遗留（非本文件代码，均为审查发现，未改行为）——
 * 1) package.json:21-26 的 `files:["lib"]` 会把 lib 里源文件已删除的旧 .d.ts 发上 npm（BoardBody、views/、SectionFrame 等 11 个 + 2026-11-27 拆包后 PermissionBox 系 / tool-permission / permission 系列孤儿）；可直接 `rm -rf lib && tsc -b` 修。
 * 2) tsconfig 的 emitDeclarationOnly 不拷贝 src/host-types.d.ts，而 lib/index.d.ts:15 / lib/client.d.ts:23 依赖 @deepseek-ai/cordis ⇒ 消费者 TS2307；需把垫片纳入 files 或声明 peerDependency（发布方式需用户定）。
 * 3) README.md:72-84 仍写已删的 BoardBody/views，README.md:133-142 写「57 条/4 文件」（实测 46 文件、约 1100 条）；可直接改文档。
 * 4) tsdown.config.ts:66-68 硬编码 id '@taskboard/dsh-client'，与 TAB_ID 和 package.name 三份重复；可从 package.json 读入。
 * 5) locale/*.json 只在 Plugin Manager meta 层被读，运行时未 inject 'locale'；是否接运行时 i18n 需用户决定。
 * 6) dev/components/create/* 是 dev/README.md:67-74 明示的冻结展厅副本，不算死代码；但 18 个与 src/renderers/create/ 同名不同实现，建议加 `@deprecated 展厅副本` 标记防改错地方（可直接改）。
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
// TODO(审查): PANEL_ID 在 `sidebar.panellist.id` 与 `main.key` 出现两次、label 也写两遍，靠手抄常量对齐。可抽一个 `panelEntry(id, order, label, Icon, Body)` 工厂把注册表化，避免改一处漏一处。
export const PANEL_ID = 'taskboard3';

/** 左侧栏图标在 panellist 里的排序（taskboard2 用 30）。 */
export const PANEL_ORDER = 30;

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
	// TODO(审查): 这里又 new 一个 `createApi()`（权限面已拆走，包内剩 store.ts:110、WorkspaceBody.tsx:200、CreateFlow.tsx:170 三处同类；本文件拆分前共 5 处），建议收敛为 `src/api-client.ts` 的单例（测试显式传 fake）。另此检查每次 apply 都发一次 POST，可加一次性标记（是否值得取决于 Cordis 重装频率）。
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
				ctx.slots.register({ name: 'main', key: PANEL_ID, label: '任务板' }, WorkspaceBody),
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
	registerDrawerSlots(ctx, { content: createElement(WorkspaceBody) });

	/*
	 * ④ 权限框入口（composer 工具行内）已随 #4 分包裁定（2026-11-27）搬到
	 *    `@taskboard/dsh-permissions` 独立一行 —— 本行不再注册它。
	 */
}
