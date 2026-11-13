/**
 * DSH 侧的**窄接口** —— 只声明本包实际用到的那几个字段。
 *
 * ## 为什么不 import `@deepseek-ai/cordis` 的类型
 *
 * Cordis 的 `Context` 是一个合并了上百个包的巨大接口。直接用它会让本包
 * 编译期依赖整个 DSH 服务图，而本包实际只碰四个服务：
 * `webServer` / `connection` / `tools` / `commands`。
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

/** 卡上本包实际读到的部分（用于状态转移判定的入参）。 */
export interface CardLike {
	readonly id: string;
	readonly status: TaskState;
	readonly template: { readonly kind: string };
}

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

/** `ctx.tools` 的最小面。 */
export interface ToolsLike {
	register(definition: unknown): unknown;
	/**
	 * 注册一个**单调拒绝** guard（`dsh-tools/src/index.ts:384`）。
	 *
	 * 返回的拒绝理由无法被后续监听器翻回允许 —— 这是权限判定的正确位置。
	 */
	guard(guard: (execution: unknown) => string | undefined): () => void;
}

/** `ctx.commands` 的最小面。 */
export interface CommandsLike {
	register(command: {
		name: string;
		description: string;
		handler(invocation: unknown): unknown;
	}): unknown;
}

/**
 * `ctx.permissionPresets` 的最小面。
 *
 * ⚠ 只用到 `current(session)` —— 读「这个会话当前选的是哪个权限预设」。
 *   真实接口见 `dsh-permission-presets/src/index.ts:343`：
 *   `current(session: Session): string`（可能返回 `'custom'`）。
 */
export interface PermissionPresetsLike {
	current(session: unknown): string;
}
