/**
 * DSH 侧的**窄接口** —— 只声明本包实际用到的那几个字段。
 *
 * ## 为什么不 import `@deepseek-ai/cordis` 的类型
 *
 * Cordis 的 `Context` 是一个合并了上百个包的巨大接口。直接用它会让本包
 * 编译期依赖整个 DSH 服务图，而这里只需要 DSH 侧**三个**服务的面：
 * `webServer` / `connection` / `commands`。
 *
 * ⚠ 任务板侧的服务（`taskboard3Core` / `taskboard3Bus` / `taskboard3Store`）
 *   **不在这里声明类型** —— 它们的形状来自 `@taskboard/core` 与
 *   `@taskboard/store` 的公开面，在本文件再写一份就是第二份真值。
 *
 * ⇒ 声明窄接口。Cordis 的 `Context` 结构上满足它们，所以运行时能传进来；
 *   而测试可以传一个假对象，不需要起真的 Cordis。
 *
 * ## 为什么不 import `@taskboard/core` 的 `Card`
 *
 * `@taskboard/core` 的 `exports` 只开放 `.`，而根入口没有 re-export `Card`
 * 类型（那是 `card.ts` 的内部类型）。本包又不应为了一个类型去 import 子路径
 * （`exports` 不允许，且那会把 core 的内部结构焊死在这里）。
 *
 * ⇒ 本包只声明「我从卡上读哪两个字段」。core 的 `Card` 结构上满足它。
 */

import type { TaskState } from '@taskboard/protocol';

/** node `IncomingMessage` 的最小形状（够本包用，且测试可造）。 */
export interface IncomingLike {
	readonly method?: string | undefined;
	readonly url?: string | undefined;
	readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

/** 可异步迭代读 body 的请求（node 的 `IncomingMessage` 满足）。 */
export type ReadableIncoming = IncomingLike & AsyncIterable<Buffer | string>;

/** node `ServerResponse` 的最小形状。 */
export interface OutgoingLike {
	statusCode: number;
	setHeader(name: string, value: string): unknown;
	end(body?: string): unknown;
}

/** `ctx.webServer` 的最小面。 */
export interface WebServerLike {
	register(route: {
		kind: 'exact' | 'prefix';
		path: string;
		handler: (req: ReadableIncoming, res: OutgoingLike) => void | Promise<void>;
	}): () => void;
}

/** `ctx.connection` 的最小面。 */
export interface ConnectionLike {
	/** 返回 `401` / `403` 表示拒绝；`undefined` 表示放行。 */
	requestRejection(request: { readonly headers: IncomingLike['headers'] }): 401 | 403 | undefined;
}

/**
 * `ctx.commands` 的最小面。
 *
 * ⚠ **形状只有一份** —— 在 `src/commands.ts` 的 `CommandRegistryLike`（含
 *   `input` / `recordInput`）。本文件只按「DSH 服务」的口径重命名导出：
 *   两份声明靠方法参数双变（bivariance）也能编过，但那不是设计保证
 *   （AGENTS 3.7 的同一类：看着像约束，实际把检查关掉了）。
 */
export type { CommandRegistryLike as CommandsLike } from './commands.ts';

