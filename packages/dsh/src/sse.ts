/**
 * SSE 端点 —— **原型期脚手架，跟 `core/src/bus.ts` 一起拆**。
 *
 * ---
 * ## ⚠ 这个文件是临时的，拆 `bus.ts` 时必须一起删
 *
 * `core/src/bus.ts` 的文件头写着拆解步骤，第 4 条就是：
 *
 * > 4. dsh：删 SSE 端点（如果加了）
 *
 * ⇒ 拆的时候要删掉：
 *
 * ```
 * · 本文件（packages/dsh/src/sse.ts）
 * · packages/dsh/src/http.ts 里 `GET /api/events` 那一段
 * · packages/dsh/src/http.ts 的 `RouteDeps.events` 字段
 * · packages/dsh/src/index.ts 里 `createBus()` + `bus` 的构造与传入
 * · packages/dsh/test/sse.test.ts
 * ```
 *
 * 判据（`bus.ts` 里写的）：**设计目标不是「优雅」，是「可拆」**。
 * ⇒ 本文件刻意只做四件事：**订阅、写帧、退订、清理**。不解析消息内容
 *   （收到什么都原样转发），不做重连，不做断点续传，不做压缩。
 *
 * ## 消息类型直接用 core 的 `TaskboardMessage`
 *
 * core 已 `export { createBus, type Bus, type TaskboardMessage }`（`8786ac7`），
 * ⇒ 本文件**不另写一份消息类型**。那是「第二处真值」：
 * 原来放宽成 `type: string` 会诱使人在这里按 `type` 分支处理，
 * 而 `bus.ts` 明确禁止「消费方解析细节」。
 *
 * ## 一条连接 = 一个订阅（不是共享订阅）
 *
 * 每个 SSE 连接**自己** `bus.on(...)`，断开时自己退订。
 *
 * 好处：`bus.size()` **恒等于活跃连接数** —— 这是个可断言的不变量
 * （测试里三条验收都靠它：断开后减少、卸载后归零）。
 * 若改成「一条共享订阅转发给所有连接」，`bus.size()` 永远是 0 或 1，
 * 就证明不了「有没有泄漏」。
 */

import type { Bus, Card, TaskboardMessage } from '@taskboard/core';

import type { IncomingLike, OutgoingLike } from './types.ts';

/* ────────────────────────── SSE 帧 ────────────────────────── */

/**
 * 一帧 SSE 的负载。
 *
 * ⚠ **与 bus 的消息类型分开**：`kind: 'hello'` 是本文件的传输层问候，
 *   不是业务事件。把它塞进 bus 的 `type` 会让「bus 的消息类型」多一个
 *   假成员 —— 那是给临时脚手架加能力，`bus.ts` 明确反对。
 */
export interface SseHello {
	readonly kind: 'hello';
	/** 服务端时间（毫秒）。客户端可据此判断连接是新的。 */
	readonly at: number;
	/** 客户端订阅时指定的空间（可能为 `''`）。 */
	readonly workspaceId: string;
}

/** 一条 bus 消息的转发帧。`message` 原样转发，不解析。 */
export interface SseBusFrame {
	readonly kind: 'bus';
	readonly message: TaskboardMessage;
}

/** SSE 帧负载。 */
export type SsePayload = SseHello | SseBusFrame;

/**
 * 把负载编成一帧 SSE。
 *
 * 格式（SSE 规范）：`data: <单行 JSON>\n\n`
 *
 * ⚠ JSON 里不会有裸换行（`JSON.stringify` 会转义），所以单行 `data:` 是安全的。
 *   若将来负载含多行文本，必须按 SSE 规范拆成多个 `data:` 行。
 */
export function encodeFrame(payload: SsePayload): string {
	return `data: ${JSON.stringify(payload)}\n\n`;
}

/* ────────────────────────── 连接 ────────────────────────── */

/**
 * 一个能写 SSE 的响应。
 *
 * ⚠ 与普通 `OutgoingLike` 的区别：
 *   · `write` —— 长期写，不 `end()`
 *   · `on('close')` —— 客户端断开时 server 会发这个事件
 *
 * `dsh-host-webserver` 的 `WebRoute.handler` 允许长期持有 response
 * （它的注释写了 `may hold the response open, e.g. SSE`），
 * **但 disposer 不会主动断开已建立的连接** ⇒ 集合必须自己管。
 */
export interface SseResponseLike extends OutgoingLike {
	write(chunk: string): unknown;
	on(event: 'close', listener: () => void): unknown;
}

/** 一条活跃连接。 */
interface Connection {
	readonly res: SseResponseLike;
	/** 退订 bus（幂等）。 */
	readonly off: () => void;
}

/**
 * SSE 连接管理。
 *
 * 生命周期：
 *
 * ```
 * open()  → 写头 + 发 hello 帧 + 订阅 bus + 加入集合 + 挂 close 监听
 * 收到消息 → 写一帧（写失败 ⇒ 视为断开，清理）
 * close   → 退订 + 移出集合
 * closeAll→ 逐个 res.end() + 退订 + 清空集合（provider 卸载时调）
 * ```
 */
export interface SseHub {
	/**
	 * 开一条 SSE 连接。
	 *
	 * @param req 请求（只用来读 `url` 里的 `workspace`）
	 * @param res 响应；本函数**持有它**直到客户端断开或 `closeAll()`
	 */
	open(req: IncomingLike, res: SseResponseLike): void;
	/** 当前活跃连接数（应恒等于 `bus.size()` —— 一处连接一个订阅）。 */
	count(): number;
	/** 断开所有连接并退订（幂等）。provider 卸载时调。 */
	closeAll(): void;
	/** 是否已关闭（关闭后再 `open()` 会被拒）。 */
	isClosed(): boolean;
}

/**
 * 造一个 SSE 连接管理器。
 *
 * @param bus core 的 `createBus()` 产物
 * @param now 时间来源（测试注入）
 */
export function createSseHub(
	bus: Bus,
	options: { readonly now?: () => number } = {},
): SseHub {
	const now = options.now ?? (() => Date.now());
	const connections = new Set<Connection>();
	let closed = false;

	/** 清理一条连接（退订 + 移出集合 + 尽力关闭响应）。幂等。 */
	const cleanup = (connection: Connection, endResponse: boolean): void => {
		if (!connections.delete(connection)) return;
		connection.off();
		if (!endResponse) return;
		try {
			connection.res.end();
		} catch {
			/* 已经断了；忽略。 */
		}
	};

	/** 往一条连接写一帧；写失败 ⇒ 认为断开，清理。 */
	// TODO(审查): [⑦] 只 try/catch，忽略 `res.write()` 的返回值（背压）⇒ 慢客户端会让 socket 缓冲无限增长；也没有心跳/`retry` 帧，过代理会被静默断。
	//   本文件是原型脚手架（文件头自己写了「不加能力」）⇒ 只补一行注释记录已知上限，不加能力。
	const writeTo = (connection: Connection, payload: SsePayload): void => {
		if (!connections.has(connection)) return;
		try {
			connection.res.write(encodeFrame(payload));
		} catch {
			/*
			 * 写到已关闭的 socket 会抛（`ERR_STREAM_WRITE_AFTER_END` 等）。
			 * ⇒ 当成断开处理，别让它冒泡出去 —— 一条连接坏了不该影响其它连接。
			 */
			cleanup(connection, false);
		}
	};

	return {
		open(req: IncomingLike, res: SseResponseLike): void {
			if (closed) {
				/*
				 * 卸载之后又来了连接 ⇒ 直接关掉。
				 * 这不是「错误」，是防止 `closeAll()` 之后集合里再长出新的泄漏。
				 */
				try {
					res.end();
				} catch {
					/* 忽略 */
				}
				return;
			}

			const workspaceId = workspaceOf(req);

			/* ① 写 SSE 头。顺序上必须先于任何 `write`。 */
			res.statusCode = 200;
			res.setHeader('content-type', 'text/event-stream; charset=utf-8');
			res.setHeader('cache-control', 'no-cache');
			res.setHeader('connection', 'keep-alive');
			/*
			 * `X-Accel-Buffering: no` 让 nginx 之类的反代不缓冲 ——
			 * 否则帧会攒着不发，客户端看起来「连上了但没消息」。
			 * 对直连场景无害（未知头会被忽略）。
			 */
			res.setHeader('x-accel-buffering', 'no');

			/* ② 先发 hello —— 让客户端知道「连上了」，而不是干等。
			 *
			 * ⚠ **hello 写失败 ⇒ 直接放弃这条连接，且不订阅。**
			 *   顺序很重要：若先订阅再写 hello，写失败时就留下一个
			 *   「订阅着但客户端已断」的泄漏 —— `bus.size()` 会永久多 1。
			 */
			const hello = encodeFrame({ kind: 'hello', at: now(), workspaceId });
			try {
				res.write(hello);
			} catch {
				/* socket 已经断了（或写不进去）⇒ 关掉，不进集合、不订阅。 */
				try {
					res.end();
				} catch {
					/* 已经断了；忽略。 */
				}
				return;
			}

			/* ③ 自己订阅（一条连接一个订阅，见文件头）。 */
			const off = bus.on((message) => {
				/* 只转发本空间的消息（`?workspace=` 给了才过滤）。 */
				if (workspaceId !== '' && workspaceIdOf(message) !== workspaceId) return;
				writeTo(connection, { kind: 'bus', message });
			});

			const connection: Connection = { res, off };
			connections.add(connection);

			/* ④ 客户端断开 ⇒ 退订 + 移出集合（不 `end()` —— 已经断了）。 */
			res.on('close', () => {
				/*
				 * ⚠ 用 `cleanup` 而不是直接 `off()`：
				 *   断开与 `closeAll()` 可能同时发生，`cleanup` 靠
				 *   `connections.delete` 的返回值做幂等守卫。
				 */
				cleanup(connection, false);
			});
		},

		count(): number {
			return connections.size;
		},

		closeAll(): void {
			closed = true;
			/*
			 * 先快照再遍历：`cleanup` 会修改集合，直接遍历会漏。
			 * （`Set` 的遍历在中途删除时行为虽可预期，但显式快照更清楚。）
			 */
			for (const connection of [...connections]) cleanup(connection, true);
		},

		isClosed(): boolean {
			return closed;
		},
	};
}

/* ────────────────────────── 小工具 ────────────────────────── */

/** 从 `url` 的 query 里取 `workspace`；没有则 `''`。 */
function workspaceOf(req: IncomingLike): string {
	const url = req.url ?? '';
	const q = url.indexOf('?');
	if (q < 0) return '';
	return new URLSearchParams(url.slice(q + 1)).get('workspace') ?? '';
}

/**
 * 从一条 bus 消息里取 `workspaceId`。
 *
 * ⚠ 这是**唯一**一处读消息内容的代码，而且只读一个字段。
 *   读它是因为 SSE 要按空间过滤（客户端只关心自己那个空间）。
 *   其余一律不解析 —— 见 `bus.ts`「消费方不解析细节」。
 */
function workspaceIdOf(message: TaskboardMessage): string {
	return message.workspaceId;
}
