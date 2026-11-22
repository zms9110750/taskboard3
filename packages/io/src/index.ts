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

export { createSqliteStore } from './sqlite.ts';
