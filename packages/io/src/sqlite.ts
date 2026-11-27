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

// TODO(审查): 本文件「表结构」注释写 workspace_id TEXT，DDL 实际 TEXT NOT NULL，
//   注释与实现漂移。可直接改注释。
// TODO(审查): 部分 Node 版本导入 node:sqlite 会打 ExperimentalWarning（未实测）；
//   若宿主仍标 experimental，可在 DSH 启动参数静音，避免控制台噪音。
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
	// TODO(审查): 函数开头 mkdirSync(dataDir) 后，这里 dirname(file) 恒等于 dataDir（重复）；
	//   删掉本行与 dirname 导入即可。可直接改。
	mkdirSync(dirname(file), { recursive: true });

	const db = new DatabaseSync(file);
	// TODO(审查): 未设 busy_timeout（SQLite 默认 0，Node 侧未核实）；WAL 意在并发，但并发写
	//   会立刻 SQLITE_BUSY（测试同 dir 开 store/scratch/raw 三连接）⇒ 加 busy_timeout=5000。可直接改。
	// TODO(审查): journal_mode=WAL 的 exec 忽略返回值；网络盘可能回退 delete 而代码仍假设 WAL；
	//   读回 PRAGMA journal_mode 断言即可。可直接改。
	// TODO(审查): synchronous=NORMAL 在 WAL 下掉电可能丢最后若干事务（不损坏），注释只提 WAL
	//   未提该取舍；写明或改 FULL —— 性能取舍需用户决定。
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA synchronous = NORMAL');
	// TODO(审查): DDL 没有任何外键，foreign_keys=ON 是死配置；删掉或注明「为将来预留」。可直接改。
	db.exec('PRAGMA foreign_keys = ON');

	// TODO(审查): 全是 CREATE IF NOT EXISTS，无 PRAGMA user_version/upcast；Card 形状以后变
	//   （历史变过）旧行会被 as Card 静默接受 ⇒ 加 user_version 迁移阶梯。可直接改。
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

	// TODO(审查): WAL 会在 dataDir 生成 taskboard3.db-wal/-shm；备份/迁移只拷 .db 会丢最近
	//   写入（崩溃后必须三件一起）⇒ 写进交付/备份文档。需 lead/用户决定。
	const selectAll = db.prepare('SELECT doc FROM cards WHERE workspace_id = ?');
	// TODO(审查): ON CONFLICT 改 workspace_id ⇒ 同 id 出现在另一 workspace（id 全局唯一下
	//   只可能是 bug）会把卡静默搬走、旧空间重启后丢卡；建议不改 workspace_id 并在不一致时
	//   抛错。产品上是否允许「移动」需用户决定。
	const upsertCard = db.prepare(
		'INSERT INTO cards (id, workspace_id, doc) VALUES (?, ?, ?) ' +
			'ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, doc = excluded.doc',
	);
	const selectKv = db.prepare('SELECT value FROM kv WHERE key = ?');
	const upsertKv = db.prepare(
		'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
	);
	const deleteKv = db.prepare('DELETE FROM kv WHERE key = ?');

	// TODO(审查): corrupt 是全会话计数、跨 workspace 累计；下方 warn 的「共 N 张」不是该
	//   空间的数，排障会误导。可改为按空间/单次汇总。可直接改。
	/** 坏数据计数 —— 只在本次会话里记，不写库。 */
	let corrupt = 0;

	return {
		loadAll(workspaceId: string): readonly Card[] {
			// TODO(审查): all(...) as { doc: string }[] 整体断言；node:sqlite 返回记录类型，
			//   可先取 row.doc 再 guard 减少 cast。只影响类型诚实度，可直接改。
			const rows = selectAll.all(workspaceId) as { doc: string }[];
			const cards: Card[] = [];
			for (const row of rows) {
				try {
					// TODO(审查): JSON.parse(...) as Card 是唯一信任边界：只捕获语法坏 JSON，合法
					//   JSON 但形状坏（null/{}）会以 Card 进内存，下游 undefined/崩；应复用 core 的
					//   parseCard（未核实是否存在）或加最小形状检查（object、id string）。可直接改。
					cards.push(JSON.parse(row.doc) as Card);
				} catch {
					corrupt += 1;
					// TODO(审查): 裸 console.warn 绕过 DSH/Cordis 的 ctx.logger；io 是纯库拿不到
					//   ctx ⇒ 建议 createSqliteStore 加可选 log 注入（默认 console.warn），默认行为不变。
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

		// TODO(审查): close 不幂等（无 closed 标志）；重复 close 是否抛错未实测（沙箱禁止跑
		//   node 探针）。Cordis 拆卸/测试可能二次释放，抛错会掩盖真错 ⇒ 加 if (closed) return。
		//   可直接改。
		async close(): Promise<void> {
			db.close();
		},
	};
}
