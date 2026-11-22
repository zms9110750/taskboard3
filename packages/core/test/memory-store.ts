/**
 * 内存版 `CardStore` —— **只给测试用**。
 *
 * ## 为什么需要它
 *
 * 有些状态**走公开 API 构造不出来**：比如「父卡是提交、但有一个子任务停在需要授权」——
 * 采纳那张子卡时连带的沿树重算已经把你父卡推成需要授权了。
 * 这类状态在真实数据里也会出现（别人改库、迁移、并发），所以判定代码必须扛得住。
 *
 * ⇒ 用内存 store 直接摆好数据，再调被测方法。这也正是
 *   `CardStore` 是**端口**的价值：换一个实现不用动 core。
 *
 * ## ⚠ `close()` 不清数据（`2026-11-23`）
 *
 * 之前的实现里 `close()` 会 `tables.clear()` + `kv.clear()`。
 * 那让「关掉实例再开一个新的」永远读不到数据 —— 与 **SQLite 的真实语义相反**
 * （关库不会删文件）。
 *
 * 症状：`permission-levels.test.ts` 的「★ 写后新建实例，两个档位都还在」
 * 用内存 store 时必然失败，而它在 SQLite 时代是绿的。
 *
 * ⇒ `close()` 现在只标记「不再服务」，数据留着 —— 等价于「关掉句柄，磁盘还在」。
 *   一次性用完就丢的用例不受影响（对象被 GC，Map 跟着走）。
 */

import type { Card } from '../src/card.ts';
import type { CardStore } from '../src/ports.ts';

/** 造一个内存版 store。 */
export function createMemoryStore(): CardStore {
	/** workspaceId → (cardId → 卡)。 */
	const tables = new Map<string, Map<string, Card>>();
	const kv = new Map<string, string>();

	const tableOf = (workspaceId: string): Map<string, Card> => {
		let table = tables.get(workspaceId);
		if (table === undefined) {
			table = new Map();
			tables.set(workspaceId, table);
		}
		return table;
	};

	return {
		loadAll(workspaceId: string): readonly Card[] {
			return [...tableOf(workspaceId).values()];
		},
		async save(workspaceId: string, card: Card): Promise<void> {
			tableOf(workspaceId).set(card.id, card);
		},
		kvGet(key: string): string | undefined {
			return kv.get(key);
		},
		async kvSet(key: string, value: string | undefined): Promise<void> {
			if (value === undefined) kv.delete(key);
			else kv.set(key, value);
		},
		async close(): Promise<void> {
			/*
			 * **故意不清 Map** —— 见文件头「`close()` 不清数据」。
			 * 关了再开一个新实例（共用本对象）应当还能读到，这才是「持久化」的语义。
			 */
		},
	};
}
