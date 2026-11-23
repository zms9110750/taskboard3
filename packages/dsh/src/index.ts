/**
 * `@taskboard/dsh` —— DSH 的 Host 插件。
 *
 * ## 三件事，不多做
 *
 * 1. **HTTP 路由** —— 浏览器侧读写的唯一通道（`src/http.ts`）
 * 2. **AI 工具** —— 把 core 的能力包成模型可调用的工具（`src/tools.ts`）
 * 3. **斜杠命令** —— `/taskboard`（`src/commands.ts`）
 *
 * 业务规则一律在 `@taskboard/core`；本包只做「翻译」和「接线」。
 *
 * ## 依赖语义：**声明，不装配**
 *
 * 用户裁定：
 * > 无论他是不是默认挂你都不能自己声明。依赖就是依赖。
 * > 依赖不存在，这个包就不能用。用户就要找一个这个来。
 * > 这是插件的依赖语义。
 *
 * ⇒ 本包在 `inject` 里声明五个服务，但 **`cordis.patch.yml` 只插自己这一行**。
 *   存储的实现由 `@taskboard/store` 那一行提供（或用户自己的替换品）。
 *
 * | 服务 | 提供者 | 缺失时 |
 * |---|---|---|
 * | `webServer` / `connection` / `tools` / `commands` | DSH 自带 | 插件不激活 |
 * | `taskboard3Store` | `@taskboard/store` 或替换品 | **插件不激活** |
 *
 * ⚠ **搜索不在这个表里** —— 它已并入 core 并强耦合（用户裁定：
 *   「ui 和 tool 都强依赖搜索，替换了搜索，那接口也没法做啊……就强耦合吧」）。
 *
 * ⚠ `taskboard3Store` **没有兜底**。「不提供 ⇒ 不生效」是用户明确要的语义 ——
 *   留兜底会让「关掉那一行」看起来没效果，那是更坏的失败方式。
 *
 * ## 为什么 `defineTool` 只出现在 `tools.ts`
 *
 * 它不是 Cordis 服务，只能从 `@deepseek-ai/dsh-tools` 拿；
 * 而它在 npm 上没有与 DSH 同版本 ⇒ 编译期用 `src/dsh-tools.d.ts` 垫片。
 * `2026-11-22` 迁移到 tool contract v2 后，**整个 `src/` 只有 `tools.ts`
 * 适配层 import 它一次**（本文件不再直接依赖）。
 *
 * ## 默认空间是入口策略，不是 core 概念
 *
 * 用户裁定：「整个激活都只对 dsh 会话有效。mcp 是没法提供的。」
 *
 * 本入口的规则：
 * 1. HTTP 请求带 `?workspace=` 就用它（客户端知道自己在看哪个空间）
 * 2. AI 工具 / 命令带 `workspaceId` 就用它
 * 3. 都没带 ⇒ 取第一个空间；一个都没有就建「默认」
 *
 * ⚠ **没有全局默认值。** 用户明确否掉了「全局默认的垃圾堆」。
 */

import type { Bus, Taskboard } from '@taskboard/core';

import { registerCommands } from './commands.ts';
import { mountRoutes } from './http.ts';
import { createSseHub } from './sse.ts';
import type { CommandsLike, ConnectionLike, ToolsLike, WebServerLike } from './types.ts';

/** Cordis 插件名。 */
export const name = 'taskboard3';

/**
 * 前置服务。
 *
 * ⚠ **声明依赖，不替用户装配。** 五个服务缺任何一个 ⇒ 本插件不激活。
 *   用户会看到「任务板没出现」，然后去补那一行 —— 这是正确的失败方式。
 */
export const inject = [
	'webServer',
	'connection',
	'commands',
	'taskboard3Core',
	'taskboard3Bus',
	/* agent 侧档位的存储端口（那套权限不归 core，见 @taskboard/dsh-tools）。 */
	'taskboard3Store',
];

/**
 * 本插件的配置。
 *
 * ## ⚠ 没有 `templateDir`（`2026-11-23` 删）
 *
 * 用户：
 * > 「外来的包原则上不该挤进去这个放配置的地方。」
 *
 * 模板是 `@taskboard/core` 包**自带的配置**，由 core 用自己的包路径在启动时加载
 * （见 `core/src/template/builtin.ts`）。**本包不知道也不该知道模板放在哪。**
 *
 * 别人的模板要接入 ⇒ 以**包**的形式在自己 `apply` 里 `register`，
 * 不是往 core 的 templates 目录里塞文件。
 */
export interface Config {}

/**
 * `apply` 用到的最小上下文。
 *
 * ## 为什么不用 `import type { Context } from '@deepseek-ai/cordis'`
 *
 * 本包只在 `apply` 里碰六个服务 + `effect`。声明窄接口之后：
 *   · 测试可以直接造一个假 ctx，不需要起真 Cordis；
 *   · 编译期不需要 `@deepseek-ai/cordis` 的 `.d.ts`（它在 npm 上有版本，但没必要依赖）。
 *
 * Cordis 的 `Context` 结构上满足本接口 ⇒ 运行时能直接传进来。
 */
export type ApplyContext = {
	readonly webServer: WebServerLike;
	readonly connection: ConnectionLike;
	readonly commands: CommandsLike;
	/** 任务板实例。由 `@taskboard/dsh-core` 提供（**全仓唯一建实例的地方**）。 */
	readonly taskboard3Core: Taskboard;
	/** 广播总线（SSE 用）。同由 `@taskboard/dsh-core` 提供。⚠ 原型期脚手架。 */
	readonly taskboard3Bus: Bus;
	/**
	 * 存储端口。由 `@taskboard/store` 提供。
	 *
	 * ⚠ 本包只用它的 kv 两方法 —— 存 **agent 侧档位**。
	 *   那套权限不归 core（用户 `2026-11-23`），归 `@taskboard/dsh-tools`；
	 *   本包只是替 UI 读写它。
	 */
	readonly taskboard3Store: {
		kvGet(key: string): string | undefined;
		kvSet(key: string, value: string | undefined): Promise<void>;
	};
	effect?(dispose: () => void, label?: string): void;
};

/**
 * 插件入口。
 *
 * 所有注册都用 `ctx.effect` 包住，返回清理函数 —— 插件卸载时路由/工具/命令
 * 一并消失。这是 DSH 的资源所有权约定。
 */
export function apply(ctx: ApplyContext, config: Config = {}): void {
	/*
	 * ⚠ **原型期脚手架**：广播总线 + SSE。
	 *
	 * 与 `core/src/bus.ts` 同生共死 —— 那个文件是临时的，原型完成后要整个拆掉。
	 * 拆的时候一起删：
	 *
	 * ```
	 * · 本段的 `createBus()` 与 `bus`
	 * · `createTaskboard({ ..., bus })` 里的 `bus`
	 * · `createSseHub(bus)` 与 `disposeRoutes` 的 `events: hub`
	 * · `disposeAll` 里的 `hub.closeAll()`
	 * · `src/sse.ts` 整个文件
	 * · `http.ts` 的 `GET /api/events` 与 `RouteDeps.events`
	 * ```
	 *
	 * 依据：`core/src/bus.ts` 文件头的拆解步骤 **第 4 条**（「dsh：删 SSE 端点」）。
	 */
	const bus = ctx.taskboard3Bus;
	const hub = createSseHub(bus);

	/*
	 * ⚠ 存储**必须**来自注入。这里不做「缺失就兜底」——
	 *   用户裁定「如果不提供，那自然是不生效」。兜底会让关掉那一行看起来没效果。
	 *
	 * ⚠ **搜索不在这里** —— 它已并入 core 并强耦合（用户裁定）。
	 *   `createTaskboard` 内部固定调 `createSearch()`，不接受外部注入。
	 */
	const taskboard: Taskboard = ctx.taskboard3Core;
	/*
	 * 模板**不在这里加载**（`2026-11-23` 搬家）。
	 *
	 * 用户：
	 * > 「模板的读取不是 io。而是配置。跟随包的。只在包里面。」
	 * > 「外来的包原则上不该挤进去这个放配置的地方。」
	 *
	 * ⇒ `createTaskboard()` 内部已经注册好包内自带的 18 个模板
	 *   （见 `core/src/template/builtin.ts` + `TaskboardOptions.builtinTemplates`）。
	 *   本包**不传目录、不扫文件、不认路径**。
	 */

	/**
	 * 入口的默认空间策略。
	 *
	 * 用户否掉了全局默认值 ⇒ 只做「第一个；没有就建一个」。
	 */
	const defaultWorkspaceId = async (): Promise<string> => {
		const list = taskboard.listWorkspaces(false);
		const first = list[0];
		if (first !== undefined) return first.id;
		const created = await taskboard.ensureAnyWorkspace();
		return created.id;
	};

	const disposeRoutes = mountRoutes(ctx.webServer, {
		taskboard,
		/* agent 侧档位的存储端口（那套权限不归 core）。 */
		kv: ctx.taskboard3Store,
		connection: ctx.connection,
		defaultWorkspaceId,
		/* ⚠ 原型期脚手架：与 `core/src/bus.ts` 同生共死。见 `src/sse.ts` 文件头。 */
		events: hub,
	});

	registerCommands(ctx.commands, { taskboard, defaultWorkspaceId });

	const disposeAll = (): void => {
		disposeRoutes();
		/*
		 * ⚠ **先关 SSE 再清工具**：SSE 连接持有 bus 订阅，
		 *   而 `taskboard.close()` 之后不该还有人能写帧。
		 *   `closeAll()` 会 `res.end()` 所有连接 + 退订 ⇒ `bus.size()` 归零。
		 *
		 *   顺序也在防一个泄漏：若先清路由再关连接，那段时间里
		 *   连接还挂着但路由已经不接受新连接 —— 不是致命，但没必要。
		 */
		hub.closeAll();
		/*
		 * ⚠ **不关 store**。它属于提供它的那一行（`@taskboard/store`）——
		 *   本包只是使用者。关别人的资源是所有权越界。
		 */
	};

	if (typeof ctx.effect === 'function') {
		ctx.effect(() => disposeAll, 'taskboard3: routes / tools / commands');
	}
}

export { createHandler, mountRoutes, ROUTE_PREFIX } from './http.ts';
export type { RouteDeps } from './http.ts';
export { adoptTargetOf, isAdoptTransition } from '@taskboard/core';
/* ⚠ 原型期脚手架导出 —— 与 `core/src/bus.ts` 同生共死。 */
export {
	createSseHub,
	encodeFrame,
	type SseBusFrame,
	type SseHello,
	type SseHub,
	type SsePayload,
	type SseResponseLike,
} from './sse.ts';
export { registerCommands } from './commands.ts';
export type { CommandDeps } from './commands.ts';
export type {
	CommandsLike,
	ConnectionLike,
	IncomingLike,
	OutgoingLike,
	ReadableIncoming,
	WebServerLike,
} from './types.ts';
