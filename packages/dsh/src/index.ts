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
 * ## 为什么 `defineTool` 走静态 import
 *
 * 它不是 Cordis 服务，只能从 `@deepseek-ai/dsh-tools` 拿。
 * 而它在 npm 上没有与 DSH 同版本 ⇒ 编译期用 `src/dsh-tools.d.ts` 垫片，
 * 详见该文件头。
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

import { defineTool } from '@deepseek-ai/dsh-tools';
import { createTaskboard, type CardStore, type Taskboard } from '@taskboard/core';
import type { Failure, TaskState } from '@taskboard/protocol';

import { registerCommands } from './commands.ts';
import { mountRoutes } from './http.ts';
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
	effect?(dispose: () => void, label?: string): void;
};

/**
 * 把 core 的状态转移接到路由上。
 *
 * ## 为什么要「方法存在才接」
 *
 * `core` 的 `transition` 由 `task-9` 实现。在本包合并之前，
 * `Taskboard` 接口上没有它 —— 直接调会 `TypeError`。
 *
 * ⇒ 探查一次：有就接，没有就返回 `undefined`（路由据此答 501）。
 *   **core 合并后这段自动生效，不需要改本包。**
 *
 * ## ⚠ 为什么这里不能写成「不管有没有，都答成功」
 *
 * 状态转移是这个任务板的核心操作。假装成功会让调用方以为卡变了，
 * 而实际没变 —— 那比报错坏得多（判据：宁可炸得响）。
 */
function coreTransitionOf(
	taskboard: Taskboard,
):
	| ((workspaceId: string, cardId: string, to: TaskState) => Promise<
			| { readonly ok: true; readonly card: unknown }
			| Failure
	  >)
	| undefined {
	type Pending = {
		transition?(
			workspaceId: string,
			cardId: string,
			to: TaskState,
			trigger: 'ai' | 'button',
		): Promise<{ readonly ok: true; readonly card: unknown } | Failure>;
	};
	const pending = taskboard as unknown as Pending;
	const fn = pending.transition;
	if (typeof fn !== 'function') return undefined;

	return async (workspaceId, cardId, to) => {
		/* `trigger` 写死 `'button'` —— 这是「人点界面按钮」的语义。 */
		return fn.call(taskboard, workspaceId, cardId, to, 'button');
	};
}

/**
 * 插件入口。
 *
 * 所有注册都用 `ctx.effect` 包住，返回清理函数 —— 插件卸载时路由/工具/命令
 * 一并消失。这是 DSH 的资源所有权约定。
 */
export function apply(ctx: ApplyContext, config: Config = {}): void {
	/*
	 * ⚠ 存储**必须**来自注入。这里不做「缺失就兜底」——
	 *   用户裁定「如果不提供，那自然是不生效」。兜底会让关掉那一行看起来没效果。
	 *
	 * ⚠ **搜索不在这里** —— 它已并入 core 并强耦合（用户裁定）。
	 *   `createTaskboard` 内部固定调 `createSearch()`，不接受外部注入。
	 */
	const taskboard: Taskboard = createTaskboard({ store: ctx.taskboard3Store });

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

	const transition = coreTransitionOf(taskboard);
	const disposeRoutes = mountRoutes(ctx.webServer, {
		taskboard,
		connection: ctx.connection,
		defaultWorkspaceId,
		/*
		 * 状态转移的写入口。
		 *
		 * ⚠ `trigger` **由服务端写死 `'button'`** —— 前端不能自称是 `ai`，
		 *   否则能绕过「AI 不能进终结态」的规则（`judgeTransition` 的规则 3）。
		 *
		 * ⚠ `core` 的 `transition` 正在由 `task-9` 实现。这里用「方法存在才接」的方式：
		 *   不存在时 `applyTransition` 缺席，路由答 501 而不是假装成功。
		 *   core 合并后这段会自动生效，**不需要改这里**。
		 */
		...(transition === undefined ? {} : { applyTransition: transition }),
	});

	/* 工具：`defineTool` 来自 DSH 的 `@deepseek-ai/dsh-tools`。 */
	const tools = createTools({ taskboard, defineTool, defaultWorkspaceId, subagents: ctx.subagents });
	const disposeTools = tools.map((tool) => ctx.tools.register(tool));

	registerCommands(ctx.commands, { taskboard, defaultWorkspaceId });

	const disposeAll = (): void => {
		disposeRoutes();
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
export { createTools, describeFailure } from './tools.ts';
export type { ToolDeps, ToolLike, DefineTool } from './tools.ts';
export { actorAware, type ActorAwareWrites, type WriteActor } from './core-writes.ts';
export { holderOf, type ExecLike, type SubagentsLike } from './holder.ts';
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
