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

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { createBus, createTaskboard, type CardStore, type Taskboard } from '@taskboard/core';

import { registerCommands } from './commands.ts';
import { mountRoutes } from './http.ts';
import { createPermissionGuard } from './permission.ts';
import { createSseHub } from './sse.ts';
import { createTools } from './tools.ts';
import type { CommandsLike, ConnectionLike, ToolsLike, WebServerLike } from './types.ts';

/** Cordis 插件名。 */
export const name = 'taskboard3';

/**
 * 前置服务。
 *
 * ⚠ **声明依赖，不替用户装配。** 五个服务缺任何一个 ⇒ 本插件不激活。
 *   用户会看到「任务板没出现」，然后去补那一行 —— 这是正确的失败方式。
 */
export const inject = ['webServer', 'connection', 'tools', 'commands', 'taskboard3Store'];

/** 插件配置。 */
export interface Config {
	/**
	 * 模板目录。
	 *
	 * 省略 = `@taskboard/core` 包内的 `templates/` —— 模板是 core 的资产，
	 * 本包不自带副本（否则同一份 YAML 有两处，改了不会同步）。
	 */
	readonly templateDir?: string;
}

/**
 * 解析 core 包内 `templates/` 的绝对路径。
 *
 * ## 为什么从 core 的 `package.json` 反推
 *
 * 模板 YAML 属于 `@taskboard/core`（它 `files` 里就带 `templates`）。
 * 本包**不复制一份** —— 否则模板改一处不同步另一处。
 *
 * `@taskboard/core` 的 `exports` 开放了 `./package.json` ⇒ 用它做锚点，
 * 这是 Node 里拿「某个包的安装目录」的标准做法（不依赖 cwd、不依赖软链形态）。
 */
function coreTemplateDir(): string {
	const require = createRequire(import.meta.url);
	const manifest = require.resolve('@taskboard/core/package.json');
	return join(dirname(manifest), 'templates');
}

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
	readonly tools: ToolsLike;
	readonly commands: CommandsLike;
	/** 存储实现。由 `@taskboard/store` 或替换品提供。**唯一可替换的依赖。** */
	readonly taskboard3Store: CardStore;
	/**
	 * `ctx.subagents`（可选）—— 用来把「当前 agent 的名字」当作 claim 的 holder。
	 *
	 * ⚠ **不是硬依赖**：没有 subagent 环境的 profile 也该能用任务板。
	 *   缺席时 holder 回落 `agent.id`（UUID）。见 `src/holder.ts`。
	 */
	readonly subagents?: unknown;
	/**
	 * Cordis 的 `ctx.get(name)` —— **可选**访问服务，不触发 inject 检查。
	 *
	 * ⚠ 和 `readonly subagents` 的差别：读 `ctx.subagents` 会走 Cordis 的
	 *   属性拦截器，服务不在 `inject` 里就抛
	 *   `cannot get property "subagents" without inject`。
	 */
	get?(name: string): unknown;
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
	 * `ctx.subagents` 是**可选**服务 —— 用可选访问读它，**不能**写进 `inject`。
	 *
	 * ⚠ 写进 `inject` 的后果（2026-11-22 在隔离 profile 里实测到的）：
	 *   没有 subagents 服务的 profile（比如只装 base + web-app 的隔离环境）
	 *   会让整个插件**不激活**：
	 *
	 *     taskboard3 (@taskboard/dsh): Error: cannot get property "subagents" without inject
	 *
	 *   而任务板本该在没有 subagent 的环境里也能用（holder 回落 `agent.id`）。
	 *   ⇒ 用 `ctx.get?.()` 探测，拿不到就是 undefined。
	 */
	const subagents = typeof ctx.get === 'function' ? (ctx.get('subagents') as ApplyContext['subagents']) : ctx.subagents;

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
	const bus = createBus();
	const hub = createSseHub(bus);

	/*
	 * ⚠ 存储**必须**来自注入。这里不做「缺失就兜底」——
	 *   用户裁定「如果不提供，那自然是不生效」。兜底会让关掉那一行看起来没效果。
	 *
	 * ⚠ **搜索不在这里** —— 它已并入 core 并强耦合（用户裁定）。
	 *   `createTaskboard` 内部固定调 `createSearch()`，不接受外部注入。
	 */
	const taskboard: Taskboard = createTaskboard({ store: ctx.taskboard3Store, bus });

	/* 模板：默认从 `@taskboard/core` 包内的 `templates/` 加载。失败不阻断 —— core 记进 `templateErrors()`。 */
	taskboard.templates().loadDirectory(config.templateDir ?? coreTemplateDir());

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
		connection: ctx.connection,
		defaultWorkspaceId,
		/* ⚠ 原型期脚手架：与 `core/src/bus.ts` 同生共死。见 `src/sse.ts` 文件头。 */
		events: hub,
	});

	/*
	 * 权限 guard —— **加装**在 dsh 的工具管线上。
	 *
	 * ⚠ 档位不在 dsh 侧：两条正交轴（`CardActionLevel` / `ToolGuardLevel`）
	 *   是任务板的全局状态，`taskboard.judgeToolCall` 自己从 core 缓存读。
	 *   guard 只提供「这个 agent 持有哪些工作卡」这一个事实。
	 *
	 * ⚠ **不再往 DSH 的权限预设表注册任何东西**（`2026-11-19`）。
	 *   上一版的三个任务板预设 + `permissionPresets` 读取整个删掉 ——
	 *   用户：「因为细节问题没必要给 dsh 开一堆权限」。
	 */
	const permissionGuard = createPermissionGuard({ taskboard, subagents });
	const disposeGuard = ctx.tools.guard(permissionGuard);

	/* 工具：v2 工具定义在 `@taskboard/tools`，本文件只负责接线（见 `tools.ts` 文件头）。 */
	const tools = createTools({
		taskboard,
		defaultWorkspaceId,
		subagents,
	});
	const disposeTools = tools.map((tool) => ctx.tools.register(tool));

	registerCommands(ctx.commands, { taskboard, defaultWorkspaceId });

	const disposeAll = (): void => {
		disposeRoutes();
		/* 先摘 guard，再清工具：卸载过程中不该再有机会按旧档位判定。 */
		disposeGuard();
		/*
		 * ⚠ **先关 SSE 再清工具**：SSE 连接持有 bus 订阅，
		 *   而 `taskboard.close()` 之后不该还有人能写帧。
		 *   `closeAll()` 会 `res.end()` 所有连接 + 退订 ⇒ `bus.size()` 归零。
		 *
		 *   顺序也在防一个泄漏：若先清路由再关连接，那段时间里
		 *   连接还挂着但路由已经不接受新连接 —— 不是致命，但没必要。
		 */
		hub.closeAll();
		for (const dispose of disposeTools) {
			if (typeof dispose === 'function') (dispose as () => void)();
		}
		/*
		 * ⚠ **不关 store**。它属于提供它的那一行（`@taskboard/store`）——
		 *   本包只是使用者。关别人的资源是所有权越界。
		 */
	};

	if (typeof ctx.effect === 'function') {
		ctx.effect(disposeAll, 'taskboard3: routes / tools / commands');
	}
}

export { createHandler, mountRoutes, ROUTE_PREFIX } from './http.ts';
export type { RouteDeps } from './http.ts';
export { createTools, describeFailure, describeUnread } from './tools.ts';
export type { ToolDeps, ToolLike, DefineTool } from './tools.ts';
export { holderOf, type ExecLike, type SubagentsLike } from './holder.ts';
export {
	createPermissionGuard,
	heldWorkCardsOf,
	type GuardDeps,
	type GuardVerdict,
} from './permission.ts';
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
