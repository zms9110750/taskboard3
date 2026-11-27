/**
 * `@taskboard/io` —— 持久化的 IO 实现。
 *
 * ```
 * core/src/ports.ts     CardStore 接口（纯声明，零 node: import）
 *    ↑
 *    ├── @taskboard/io   本包：SQLite 实现（真 IO 都在这里）  ← 默认
 *    └── 别人的实现       给 `createTaskboard({ store })` 传一个满足 CardStore 的对象
 * ```
 *
 * **`core` 不认识 `io`** —— 依赖单向：`io` → `core`。本包只 `import type` core，
 * 所以 core 在 `package.json` 里是 **peer dependency**，不是运行时依赖。
 *
 * 设计动机（用户 `2026-11-23` 原话）、表结构与实现细节都在 `sqlite.ts` 文件头，
 * 这里只留包出口。
 */

/*
 * TODO(审查) 汇总 —— 非本文件问题（包配置 / 产物 / 架构）。
 * 源码内问题见 sqlite.ts 对应位置的内联 TODO；2026-11-25 pkg-io 只读审查。
 *
 * TODO(审查): 产物 lib/types/index.d.ts:33 仍是 './sqlite.ts'（lib/index.js:33 已是
 *   './sqlite.js'，lib/types 无 sqlite.ts）⇒ 需清空 lib 后 tsc -b 确认是陈旧产物还是
 *   tsc 5.9 声明不重写；若后者外部消费者类型解析可能坏（推断未验证）。需 lead 验证。
 * TODO(审查): test 缺两类用例：kv 重开持久、同 id 跨 workspace。加用例即可。可直接改。
 * TODO(审查): 架构上应在 core 暴露 CardSchema/parseCard，并把 CardStore conformance
 *   测试放 core 供各实现复用（现 io 用例是从 core 搬来的）。需 lead/用户决定。
 * TODO(审查): 端口无 delete/purge，现阶段 OK；若将来加「彻底删除」，需扩端口或
 *   io 内部按 deleted+时间清理 —— 语义变更，需用户决定。
 */

export { createSqliteStore } from './sqlite.ts';
