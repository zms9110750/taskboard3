/**
 * 任务板 —— **bundle 壳**。
 *
 * 这个包**自己不做任何事**。它的作用是：
 *
 *   1. 承载 `cordis.patch.yml`（bundle 的插件清单）
 *   2. 在设置页显示**一张**「任务板」卡片，点进去看到三个组件各自的开关
 *   3. 提供卡片图标和显示名
 *
 * ## 为什么需要这个壳（用户 `2026-11-23`）
 *
 * > 「为什么这里有3个包？任务板1是只有一个入口，然后入口里面有各自的包。」
 *
 * 之前 `@taskboard/store` / `@taskboard/dsh` / `@taskboard/dsh-client`
 * **各自是一个独立 bundle** ⇒ 设置页看到 **3 张平级卡片**。
 * 用户要的是「一个入口」：**1 张卡片，里面 3 个开关**。
 *
 * 这个结构和任务板1（`@local/taskboard`，8 行 insert）以及官方
 * `dsh-experimental-agent-team-profile`（1 壳 + N 子包）一致。
 *
 * ## 三个实际组件都是独立的包
 *
 *   ① `@taskboard/store`       持久化提供者（**唯一可替换点**）
 *   ② `@taskboard/dsh`         Host 半边：HTTP 路由 + AI 工具 + 命令
 *   ③ `@taskboard/dsh-client`  浏览器 UI
 *
 * 每个都能单独关：关掉 ② 就只剩数据层，关掉 ③ 就只剩 Host 能力。
 */

export const name = 'taskboard3';

/* 壳不注册任何东西 —— 它只提供 patch 和显示元数据。 */
export function apply(): void {}
