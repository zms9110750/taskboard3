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
 * cards(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, doc TEXT NOT NULL)
 *   ↑ 一行的存法：doc 是整卡 JSON
 *   ↑ 索引在 workspace_id 上 —— 全量读一个空间就是一次索引扫描
 *
 * kv(key TEXT PRIMARY KEY, value TEXT NOT NULL)
 *   ↑ 不按空间分的：工作空间索引、归档标记
 * ```
 *
 * ## 实现细节
 *
 * ① **WAL + busy_timeout** —— 读写不互斥；写与写之间最多等 5s 再报 `SQLITE_BUSY`。
 * ② **WAL 打开后读回断言** —— 网络盘上 SQLite 可能拒绝 WAL 并回退 `delete`；
 *    此时直接报错，不让「代码以为在 WAL、其实没有」的假设静默成立。
 * ③ **`save` 是单行 upsert** —— 与卡总数无关（这就是窄接口的收益）。
 * ④ **打开时不做全量校验** —— 坏数据在读的时候暴露（`JSON.parse` 失败或形状不对 →
 *    跳过该行并记一条按空间汇总的警告），而不是让整个库打不开。
 *    数据是用户资产，一张坏卡不该让所有人看不到卡。
 * ⑤ **`close` 幂等** —— Cordis 拆卸与测试清理可能都调一次。
 */

// TODO(审查): 部分 Node 版本导入 node:sqlite 会打 ExperimentalWarning（未实测）；
//   若宿主仍标 experimental，可在 DSH 启动参数静音，避免控制台噪音。
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { Card, CardStore } from '@taskboard/core';

/** 库文件名。 */
const DB_FILE = 'taskboard3.db';

/** 当前 schema 版本（`PRAGMA user_version`）。改表结构时 +1，并在打开时补迁移。 */
const SCHEMA_VERSION = 1;

/** 写锁等待上限（毫秒）。SQLite 默认 0：别的连接持写锁时立刻 `SQLITE_BUSY`。 */
const BUSY_TIMEOUT_MS = 5000;

/**
 * 卡的最小形状检查（`JSON.parse` 之后）。
 *
 * 只保证「下游不会因为 `undefined` 崩」：是对象，且 `id` / `title` 是字符串。
 * **不是完整的 `Card` 校验** —— core 目前没有导出 `parseCard`；在这里做深校验
 * 会把 Card 的形状复制一遍（改字段时两处漂移）。完整校验需要 core 提供一个解析器。
 */
function isMinimalCard(value: unknown): value is Card {
	if (typeof value !== 'object' || value === null) return false;
	if (!('id' in value) || typeof value.id !== 'string') return false;
	if (!('title' in value) || typeof value.title !== 'string') return false;
	return true;
}

/** 读一个单值 PRAGMA（`journal_mode` / `user_version`），值不存在返回 `undefined`。 */
function pragmaValue(db: DatabaseSync, name: 'journal_mode' | 'user_version'): unknown {
	const row = db.prepare(`PRAGMA ${name}`).get();
	return row?.[name];
}

/**
 * 配置连接与 schema。
 *
 * 失败时抛错；连接由调用方关闭（`createSqliteStore` 负责，避免半开句柄泄漏）。
 *
 * @param db 已打开的连接
 * @param file 库文件路径（只用于报错）
 */
function configureDatabase(db: DatabaseSync, file: string): void {
	/*
	 * schema 版本：为将来「旧库 upcast」留口。
	 * 0 = 本包引入 user_version 之前的库；建表语句是幂等的，所以 0 → 1 不需要 ALTER。
	 * 比本程序新的库**拒绝打开**（先查版本，再动任何 PRAGMA / DDL）：
	 * 旧程序不认识新字段，继续写会静默丢数据。
	 */
	const userVersion = pragmaValue(db, 'user_version');
	if (typeof userVersion !== 'number' || !Number.isInteger(userVersion)) {
		throw new Error(`[taskboard3] 读不到 ${file} 的 user_version（得到 ${String(userVersion)}）。`);
	}
	if (userVersion > SCHEMA_VERSION) {
		throw new Error(
			`[taskboard3] ${file} 的 schema 版本是 ${String(userVersion)}，` +
				`本程序只支持到 ${String(SCHEMA_VERSION)}；请升级 @taskboard/io，不要用旧版打开新库。`,
		);
	}

	/* 并发写：写与写仍互斥，只是改成「等一会儿」而不是立刻抛错。 */
	db.exec(`PRAGMA busy_timeout = ${String(BUSY_TIMEOUT_MS)}`);

	/* WAL：读写不互斥，UI 读的时候写不阻塞。设置在库文件头，重开仍然生效。 */
	db.exec('PRAGMA journal_mode = WAL');
	const journalMode = pragmaValue(db, 'journal_mode');
	if (journalMode !== 'wal') {
		throw new Error(
			`[taskboard3] 无法把 ${file} 切到 WAL（journal_mode=${String(journalMode)}）；` +
				'数据目录可能在网络盘 / 只读介质上。',
		);
	}

	// TODO(审查): synchronous=NORMAL 在 WAL 下掉电可能丢最后若干事务（不损坏）——
	//   这里按 WAL 的推荐值取 NORMAL；要改 FULL 是性能取舍，需用户决定。
	db.exec('PRAGMA synchronous = NORMAL');

	/*
	 * ⚠ 当前 DDL 没有任何外键 —— 本行现在**不产生实际约束**。
	 * 保留是为了将来加外键时不用记得再打开（SQLite 默认 OFF）。
	 * 读到这行不要以为「现在有外键校验」。
	 */
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

	/* 建表成功后才落版本号：建表中途失败不会留下「版本已升、表却没建完」的库。 */
	if (userVersion < SCHEMA_VERSION) {
		db.exec(`PRAGMA user_version = ${String(SCHEMA_VERSION)}`);
	}
}

/**
 * 打开一个 SQLite 存储。
 *
 * @param dataDir 数据目录（不存在会建）。**本函数不改写路径**：相对路径按进程
 *   cwd 解析，跨进程复用请传绝对路径（`@taskboard/store` 里会先 `resolve`）。
 */
export function createSqliteStore(dataDir: string): CardStore {
	mkdirSync(dataDir, { recursive: true });
	const file = join(dataDir, DB_FILE);

	const db = new DatabaseSync(file);
	try {
		configureDatabase(db, file);
	} catch (error) {
		db.close();
		throw error;
	}

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

	/** 本次会话里跳过的坏卡总数（跨空间累计，只用于日志）。 */
	let corrupt = 0;

	/** 连接是否已关闭 —— `close` 幂等用。 */
	let closed = false;

	return {
		loadAll(workspaceId: string): readonly Card[] {
			const rows = selectAll.all(workspaceId);
			const cards: Card[] = [];
			let skipped = 0;

			for (const row of rows) {
				/* `doc` 列是 TEXT NOT NULL；这里仍先确认类型，不让损坏的库把非字符串塞进 JSON.parse。 */
				if (typeof row.doc !== 'string') {
					skipped += 1;
					continue;
				}
				try {
					const parsed: unknown = JSON.parse(row.doc);
					if (!isMinimalCard(parsed)) {
						skipped += 1;
						continue;
					}
					cards.push(parsed);
				} catch {
					skipped += 1;
				}
			}

			if (skipped > 0) {
				corrupt += skipped;
				// TODO(审查): 裸 console.warn 绕过 DSH/Cordis 的 ctx.logger；io 是纯库拿不到
				//   ctx ⇒ 建议 createSqliteStore 加可选 log 注入（默认 console.warn），默认行为不变。
				/* 按空间汇总成一条：逐条 warn 在大库损坏时会刷屏；「共 N 张」是会话累计、不是本空间的数。 */
				console.warn(
					`[taskboard3] 空间 ${workspaceId}：跳过 ${String(skipped)} 张无法解析的卡` +
						`（本次会话累计 ${String(corrupt)} 张）`,
				);
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

		/**
		 * 关闭连接；**幂等** —— 重复调用不再碰已释放的句柄。
		 *
		 * Cordis 拆卸和测试清理可能都调一次；第二次抛「database is not open」
		 * 只会掩盖真正的关闭错误。
		 */
		async close(): Promise<void> {
			if (closed) return;
			closed = true;
			db.close();
		},
	};
}
