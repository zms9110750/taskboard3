/**
 * `@taskboard/io` —— 持久化的 IO 实现。
 *
 * ## 分工（用户 `2026-11-23`）
 *
 * > 「1.内存内容同步到磁盘的持久化这一边要做接口。
 * >   然后另一边由io包实现接口并用sqlite实现。」
 *
 * ```
 * core/src/ports.ts     CardStore 接口（纯声明，零 node: import）
 *    ↑
 *    ├── @taskboard/io   本包：SQLite 实现（真 IO 都在这里）  ← 默认
 *    └── 别人的实现       给 `createTaskboard({ store })` 传一个满足 CardStore 的对象
 * ```
 *
 * **`core` 不认识 `io`** —— 依赖单向：`io` → `core`。
 *
 * ## 为什么 `CardStore` 就够，没有另造一个「持久化端口」
 *
 * `CardStore` 的注释写得很清楚，它就是「内存内容 ↔ 磁盘」的抽象：
 *
 * ```
 * loadAll(workspaceId)  内存 ← 磁盘（一个空间的全部卡）
 * save(workspaceId,卡)  内存 → 磁盘（一张卡，原子）
 * kvGet / kvSet         内存 ↔ 磁盘（不分空间的全局键值）
 * close()               释放底层资源
 * ```
 *
 * **它就是用户说的「持久化这一边要做接口」。** 再包一层
 * `PersistencePort` 只会多一个同构的转发接口 —— 那是为了「看起来有分层」而分层。
 * 唯一缺的是「实现不该在 core 里」，本包解决的就是这一点。
 */

/*
 * TODO(审查) 汇总 —— 非本文件问题（包配置 / 产物 / 测试 / 架构）。
 * 源码内问题见 sqlite.ts 对应位置的内联 TODO；2026-11-25 pkg-io 只读审查。
 *
 * TODO(审查): package.json 的 @taskboard/core 只有类型导入（sqlite.ts 用 import type），
 *   产物无 core 运行时依赖 ⇒ 可改 peerDependencies，避免运行时拖 core。可直接改。
 * TODO(审查): 本文件 9-31 与 sqlite.ts 文件头「为什么 CardStore 就够」重复，
 *   入口留两三行指过去即可。可直接改。
 * TODO(审查): 产物 lib/types/index.d.ts:33 仍是 './sqlite.ts'（lib/index.js:33 已是
 *   './sqlite.js'，lib/types 无 sqlite.ts）⇒ 需清空 lib 后 tsc -b 确认是陈旧产物还是
 *   tsc 5.9 声明不重写；若后者外部消费者类型解析可能坏（推断未验证）。需 lead 验证。
 * TODO(审查): test/sqlite.test.ts 56-96 同 dir/ws 串联，用例间有顺序依赖；
 *   每例独立 dir 或唯一 ws 即可。可直接改。
 * TODO(审查): test/sqlite.test.ts 99-102 的 reopened 断言失败时不 close，Windows 上
 *   after 的 rmSync 可能 EBUSY 掩盖原错误；改 try/finally 即可。可直接改。
 * TODO(审查): test/sqlite.test.ts 61-64 after 在 before 失败时 store/dir 为 undefined，
 *   会二次抛 TypeError 掩盖原错误；加判空即可。可直接改。
 * TODO(审查): test/sqlite.test.ts 52 描述「四个操作」与实际 5 个方法不符；
 *   117 硬编码 taskboard3.db（应复用 DB_FILE 或在测试里发现 .db）。可直接改。
 * TODO(审查): test 缺三类用例：合法 JSON 但形状坏（null/{}）、kv 重开持久、
 *   同 id 跨 workspace。加用例即可。可直接改。
 * TODO(审查): 架构上应在 core 暴露 CardSchema/parseCard，并把 CardStore conformance
 *   测试放 core 供各实现复用（现 io 用例是从 core 搬来的）。需 lead/用户决定。
 * TODO(审查): 端口无 delete/purge，现阶段 OK；若将来加「彻底删除」，需扩端口或
 *   io 内部按 deleted+时间清理 —— 语义变更，需用户决定。
 */

export { createSqliteStore } from './sqlite.ts';
