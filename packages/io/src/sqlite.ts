/**
 * SQLite 持久化实现 —— `CardStore` 端口的一个实现。
 *
 * ## 这个包为什么存在（用户 `2026-11-23`）
 *
 * > 「1.内存内容同步到磁盘的持久化这一边要做接口。
 * >   然后另一边由io包实现接口并用sqlite实现。」
 *
 * ### 之前是假的
 *
 * `createSqliteStore` 原来躺在 `core/src/storage/sqlite.ts` 里，
 * 而 `@taskboard/store` 只是：
 *
 * ```ts
 * const store = createSqliteStore(config.dataDir);  // ← 实现在 core
 * ctx.provide('taskboard3Store', store);
 * ```
 *
 * ⇒ 「`store` 可替换」这个设计**只隔离了「构造」一个动作**，
 *   真正的 SQLite 实现（`node:sqlite` / `mkdirSync`）还在 core 里。
 *   换实现的人仍然要把 core 连同它的 sqlite 拖进来。
 *
 * ### 现在
 *
 * ```
 * core/src/ports.ts        CardStore 接口（纯声明，零 node: import）
 *    ↑
 *    └── @taskboard/io     本包：SQLite 实现（真 IO 都在这里）
 * ```
 *
 * **依赖方向单向**：`io` → `core`。core 不认识 io。
 *
 * ## 为什么是 `node:sqlite`
 *
 * 实测（1000 张卡、JSON 整文件 769KB 时）：
 *
 * ```
 * 改一张卡   SQLite 1.47ms   JSON 整文件 10.56ms
 * 全量读      SQLite 4.1ms
 * ```
 *
 * 而 JSON 整文件每次保存要**重写 769KB**。卡越多差得越多。
 *
 * ## 表结构
 *
 * ```
 * cards(id TEXT PRIMARY KEY, workspace_id TEXT, doc TEXT)
 *   ↑ 一行的存法：doc 是整卡 JSON
 *   ↑ 索引在 workspace_id 上 —— 全量读一个空间就是一次索引扫描
 *
 * kv(key TEXT PRIMARY KEY, value TEXT)
 *   ↑ 不按空间分的：工作空间索引、归档标记
 * ```
 *
 * ## 三个实现细节
 *
 * ① **开 WAL** —— 读写不互斥，UI 读的时候写不阻塞。
 * ② **`save` 是单行 upsert** —— 与卡总数无关（这就是窄接口的收益）。
 * ③ **打开时不做全量校验** —— 坏数据在读的时候暴露（`JSON.parse` 抛 → 跳过该行并记警告），
 *    而不是让整个库打不开。数据是用户资产，一张坏卡不该让所有人看不到卡。
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { Card, CardStore } from '@taskboard/core';

/** 库文件名。 */
const DB_FILE = 'taskboard3.db';

/**
 * 打开一个 SQLite 存储。
 *
 * @param dataDir 数据目录（不存在会建）。
 */
export function createSqliteStore(dataDir: string): CardStore {
	mkdirSync(dataDir, { recursive: true });
	const file = join(dataDir, DB_FILE);
	mkdirSync(dirname(file), { recursive: true });

	const db = new DatabaseSync(file);
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA synchronous = NORMAL');
	db.exec('PRAGMA foreign_keys = ON');

	db.exec(`
		CREATE TABLE IF NOT EXISTS cards (
			id           TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			doc          TEXT NOT NULL
		)
	`);
	db.exec('CREATE INDEX IF NOT EXISTS idx_cards_workspace ON cards(workspace_id)');
	db.exec(`
		CREATE TABLE IF NOT EXISTS kv (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`);

	const selectAll = db.prepare('SELECT doc FROM cards WHERE workspace_id = ?');
	const upsertCard = db.prepare(
		'INSERT INTO cards (id, workspace_id, doc) VALUES (?, ?, ?) ' +
			'ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, doc = excluded.doc',
	);
	const selectKv = db.prepare('SELECT value FROM kv WHERE key = ?');
	const upsertKv = db.prepare(
		'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
	);
	const deleteKv = db.prepare('DELETE FROM kv WHERE key = ?');

	/** 坏数据计数 —— 只在本次会话里记，不写库。 */
	let corrupt = 0;

	return {
		loadAll(workspaceId: string): readonly Card[] {
			const rows = selectAll.all(workspaceId) as { doc: string }[];
			const cards: Card[] = [];
			for (const row of rows) {
				try {
					cards.push(JSON.parse(row.doc) as Card);
				} catch {
					corrupt += 1;
					console.warn(`[taskboard3] 跳过一张无法解析的卡（空间 ${workspaceId}），共 ${corrupt} 张`);
				}
			}
			return cards;
		},

		async save(workspaceId: string, card: Card): Promise<void> {
			// `workspace_id` 是索引列；卡本身不带空间字段（卡是空间内的对象）。
			upsertCard.run(card.id, workspaceId, JSON.stringify(card));
		},


		kvGet(key: string): string | undefined {
			const row = selectKv.get(key) as { value: string } | undefined;
			return row?.value;
		},

		async kvSet(key: string, value: string | undefined): Promise<void> {
			if (value === undefined) {
				deleteKv.run(key);
				return;
			}
			upsertKv.run(key, value);
		},

		async close(): Promise<void> {
			db.close();
		},
	};
}
