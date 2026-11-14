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
			tables.clear();
			kv.clear();
		},
	};
}


