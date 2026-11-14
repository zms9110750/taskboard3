/**
 * 广播总线 —— **原型期脚手架，不是永久事件系统**。
 *
 * ---
 * ## ⚠ 这个文件是临时的，原型完成后要整个拆掉
 *
 * 用户原话（`2026-11-13`）：
 *
 * > 我习惯于在开发期间使用管道来在接收方没有创造出来的时候做耦合。
 * > 毕竟我连对方的接口都不知道。但是管道只需要一个消息类型就行了。
 * > 而消息类型随便改。好改。
 * > 如果是先把接收方接口做出来，那接口要变也是要改很多地方的。
 *
 * > 要做的是广播和总线。**在完成了原型以后，这个消息管道是要拆掉的。**
 *
 * ⇒ **设计目标不是「优雅」，是「可拆」。**
 *
 * ### 拆掉时的步骤（照这个顺序做）
 *
 * ```
 * 1. 删 packages/core/src/bus.ts（本文件）
 * 2. packages/core/src/index.ts 里删三处：
 *      · `import { type Bus, createBus } from './bus.ts';`
 *      · `CommonOptions.bus?: Bus`
 *      · `persist` 里那行 `bus?.emit(...)`
 *    外加（见下面「工作空间」一节）`emitWorkspace` 与它的 4 个调用点
 * 3. 删 packages/core/test/bus.test.ts
 * 4. dsh：删 SSE 端点（如果加了）
 * 5. dsh-client：改成直接读接口，不订阅
 * ```
 *
 * ### 为什么只有一个消息类型，而且故意粗糙
 *
 * ```ts
 * { type: 'card:written' | 'workspace:written', workspaceId, cards }
 * ```
 *
 * **它只说「有事发生」，不说「发生了什么细节」。** 消费方收到就重新拉全量。
 *
 * 精确的类型（`card:created` / `card:changed` 各带不同字段）看起来更好，
 * 但那样**每加一种事件就要改消息类型 ⇒ 消费方跟着改 ⇒ 就变成接口了** ——
 * 那正是用户要避免的东西：接口一旦存在，改动成本就从「改一个类型」变成「改很多地方」。
 *
 * 粗糙 + 消费方自己重拉，意味着**拆掉时消费方本来就没依赖细节**，迁移成本最低。
 *
 * ---
 */

import type { Card } from './card.ts';

/**
 * 广播消息 —— **原型期专用脚手架**。
 *
 * ⚠ 故意不精确：消费方只当「有事发生」的信号，不解析细节。
 */
export interface TaskboardMessage {
	/**
	 * 发生了什么。
	 *
	 * 原型期**随便加、随便改** —— 消费方不应该 switch 它，
	 * 只应该「收到就重拉」。
	 */
	readonly type: 'card:written' | 'workspace:written';
	/** 哪个空间变了（消费方据此决定要不要重拉）。 */
	readonly workspaceId: string;
	/**
	 * 被写的卡。
	 *
	 * **可能不止一张**：沿树重算会把父卡一起带上。
	 * 也可能为空数组（工作空间变更时）。
	 */
	readonly cards: readonly Card[];
}

/** 广播总线。 */
export interface Bus {
	/**
	 * 广播一条消息。
	 *
	 * **同步**调用所有订阅者。单个订阅者抛错**不影响**其它订阅者，
	 * **更不影响触发它的写操作** —— 写操作已经落库了，广播失败不该回滚。
	 */
	emit(message: TaskboardMessage): void;
	/**
	 * 订阅。
	 *
	 * @returns 退订函数（**幂等** —— 重复调用只生效一次）
	 */
	on(listener: (message: TaskboardMessage) => void): () => void;
	/** 当前订阅者数量（测试 / 诊断用）。 */
	size(): number;
}

/**
 * 造一个广播总线。
 *
 * 生命周期由调用方拥有（谁 `createBus` 谁负责在卸载时退订）。
 */
export function createBus(): Bus {
	const listeners = new Set<(message: TaskboardMessage) => void>();

	return {
		emit(message: TaskboardMessage): void {
			/*
			 * ## 为什么吞掉订阅者的错
			 *
			 * 写操作此时**已经落库**了。如果订阅者抛错冒泡出去，
			 * 调用方会看到「写失败」，但数据其实已经写进去了 ——
			 * 那是比「订阅者没收到」严重得多的错误。
			 *
			 * ⇒ 逐条 try/catch，记日志，继续广播给下一个。
			 *
			 * ⚠ 用 `console.error` 而不是静默：原型期需要看见消费方的 bug。
			 */
			for (const listener of listeners) {
				try {
					listener(message);
				} catch (error) {
					console.error('[taskboard3-core] 广播订阅者抛错（已忽略，写操作不受影响）：', error);
				}
			}
		},

		on(listener: (message: TaskboardMessage) => void): () => void {
			listeners.add(listener);
			let disposed = false;
			return () => {
				if (disposed) return;
				disposed = true;
				listeners.delete(listener);
			};
		},

		size(): number {
			return listeners.size;
		},
	};
}

