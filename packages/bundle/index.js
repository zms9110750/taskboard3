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
 *
 * TODO(审查): 本段仍是「三个组件」的旧结构 —— patch 实际插入若干行（以 cordis.patch.yml 为准，别在这里写数字：行数已两次随拆包漂移）。
 * TODO(审查): ② 行把「AI 工具」算给 @taskboard/dsh，但 patch ④ 才是 @taskboard/dsh-tools；归属写重了。
 *   两处均可直接改注释，无行为影响。
 */

/*
 * TODO(审查) 汇总 —— 非源码项（package.json / locale / icon / README），全部只加注释、未改行为：
 *
 * 1. package.json:5「一个 bundle，三个插件条目」与 patch 实际行数不符 —— 描述漂移（行数两次随拆包变化，别写数字）。
 *    可直接改成不写数字（措辞属产品文案）。
 * 2. package.json:19 的 files 列了 README.md，但仓库没有该文件；locale 也没有 meta.detail
 *    ⇒ bundle 详情页无内容（DSH host-plugin.md:31：无 meta.detail 回退包 README）。
 *    补 README 可直接改；详情里放什么内容需用户决定。
 * 3. icon.svg:1 用 stroke="currentColor" 且由 <img> 加载（artwork.md:22）⇒ 暗色主题大概率黑底黑图
 *    （推断，未做浏览器验证）；viewBox 20 也低于 artwork.md:14 的 36 网格建议。
 *    可直接按 36 网格 + 显式中性色重画，需明暗两主题目视确认。
 * 4. locale/zh.json:4、en.json:4 仍写「三个组件」，且「删掉本包只会变成三张平级卡片」与
 *    cordis.patch.yml 里「子包 patch 不再被 profile 装配」那段注释矛盾 —— 删壳会让这些行消失。
 *    文案需用户决定。
 * 5. package.json:22 的 dsh.manifestVersion 在安装版 DSH 文档（host-plugin.md / plugin-development.md /
 *    composition-reference.md）零命中，未验证是否被读取；确认后再定删不删（不要盲删）。
 * 6. package.json:11-12 的 ./cordis.patch.yml、./package.json 导出没有文档化用途（DSH 按相对路径读
 *    patch、按 ./locale/*.json 与 ./icon 读元数据）；无外部 import 时可删（低优先级）。
 * 7. 单一事实源：行清单在 patch / package.json / 本文件 / 两份 locale / test 各写一份，已从 3 漂到 6；
 *    装配事实只应存在于 cordis.patch.yml（架构建议，需 lead / 用户接受）。
 */

// TODO(审查): 本包不会被 DSH 激活 —— cordis.patch.yml 的 insert 段只插入其它 6 个包，没有 @taskboard/bundle
//   自己（lead 已确认）。因此 name / apply 永不执行，package.json 的 main(:6)、exports["."](:8)、
//   files 里的 index.js(:15) 都是无效元数据。建议删本文件改成「纯清单包」；是否删除需用户确认。
export const name = 'taskboard3';

/* 壳不注册任何东西 —— 它只提供 patch 和显示元数据。 */
/* TODO(审查): 空 apply 是「假插件」：不注册资源、不返回 cleanup，与 host-plugin.md:65 的 apply 约定不符；
 * 删上面的 index.js（改纯清单包）时一并删掉。 */
export function apply(): void {}
