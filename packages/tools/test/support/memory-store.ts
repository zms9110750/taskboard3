/**
 * 内存版 `CardStore` —— **只给本包测试用**。
 *
 * ## 为什么复制一份（而不是 import core 测试里的那份）
 *
 * `packages/core/test/memory-store.ts` 是个测试辅助，**没有从 core 的公开面
 * 导出**（core 的 `exports` 只有包根，测试辅助不该成为跨包契约）。
 * ⇒ 本包测试自己造一个：`CardStore` 是公开端口，换实现正是它的设计目的。
 *
 * ## 为什么不用 `createTaskboard({ dataDir })`
 *
 * 内存实现让每个用例 **零文件系统状态**：没有 `mkdtemp`、没有「上一个用例
 * 的档位漏到下一个」、没有 Windows 上删临时目录偶发失败要重试。
 * 测试只验证工具层与 core 的接线，不验证 SQLite 实现（那是 core 的测试职责）。
 */

import type { Card, CardStore } from '@taskboard/core';

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
