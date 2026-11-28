/**
 * **markdown 排版** + 降级 JSON 的样式 —— 作用域 「.tb3w-root」。
 *
 * ## 章节外壳 / 正文控件 / ask 已经不在这里
 *
 * issue #59 / #60：章节外观曾有两套（建卡 `.tb3cc-sec*`、详情 `.section-block*`）。
 * 现在外壳与控件统一在 `src/renderers/section-shell-css.ts`（`SECTION_SHELL_CSS`，
 * 类名 `.tb3-sec*` / `.tb3-ask*`，不加 `.tb3w-root` 作用域 —— 建卡页可能不在
 * 工作区根节点下）。
 *
 * ⇒ 本文件只剩 **markdown 排版**（`.md*`）与 **降级 JSON**（`.payload-box`）。
 *   `.section-block*` / `.ask-*` 的规则是**删掉的**，不是被覆盖。
 *
 * ## 为什么在组件目录
 *
 * 用户要求「CSS 必须跟着组件走」：组件在哪，样式就在哪，不再全堆在
 * src/styles.ts 的巨型字符串里。本文件放在 renderers/ 下，与 Section.tsx 等同级。
 *
 * ## 为什么是纯 .ts，不是 .css
 *
 * rolldown 1.3.2 对 import “./x.css” 直接报 Bundling CSS is no longer supported
 * ⇒ 不能建 .css 文件；产物只有单个 lib/client.js，没有独立的 style.css 可取。
 * 宿主允许运行时插 <style>，所以 CSS 只能是 TS 字符串常量，由 src/styles.ts 的
 * injectStyles() 拼进同一个 style 标签。
 *
 * ## 间距归父容器管
 *
 * `.tb3-sec` 自己 margin:0；产品里章节挂在 `.detail-sections`
 * （display:flex;gap:12px）下 ⇒ 不在章节上加 margin，否则间距叠加。
 *
 * ⚠ `.tb3w-root` 前缀必须保留：`.md-*` / `.payload-box` 是通用名，裸写会撞到宿主。
 *
 * ⚠ 本文件是模板字符串 —— 注释里不能出现反引号。
 */
export const SECTION_CSS = `
/*
 * ⚠ 章节外壳（.tb3-sec*）、text / markdown 正文控件、ask 选项 —— 全部搬到
 *   src/renderers/section-shell-css.ts（SECTION_SHELL_CSS）。
 *
 * issue #59 / #60 之前这里有一套 .section-block* + .ask-*；建卡页另有
 * 一套 .tb3cc-sec*。两套样式各写一份，同一个章节在不同入口长得不一样。
 * ⇒ 现在**只有一套**（SectionShell），本文件只剩 markdown 排版与降级 JSON。
 *
 * 原来的 .section-block / .ask-* 规则是**删掉的**，不是被覆盖 ——
 * 别在这里加回来。
 */

/* ══════════════════════════════════════════════════════════
   markdown（来自 dev/preview/markdown/style.css）
   ══════════════════════════════════════════════════════════ */
.tb3w-root .md{line-height:1.65;color:var(--text);word-break:break-word}
.tb3w-root .md > *:first-child{margin-top:0}
.tb3w-root .md > *:last-child{margin-bottom:0}
.tb3w-root .md p,.tb3w-root .md ul,.tb3w-root .md ol,.tb3w-root .md blockquote,.tb3w-root .md table,.tb3w-root .md pre{margin:.6em 0}
.tb3w-root .md h1,.tb3w-root .md h2,.tb3w-root .md h3,.tb3w-root .md h4,.tb3w-root .md h5,.tb3w-root .md h6{margin:1em 0 .5em;line-height:1.3;font-weight:600;color:var(--text)}
.tb3w-root .md h1{font-size:1.5em}
.tb3w-root .md h2{font-size:1.28em}
.tb3w-root .md h3{font-size:1.12em}
.tb3w-root .md h4,.tb3w-root .md h5,.tb3w-root .md h6{font-size:1em}
.tb3w-root .md ul,.tb3w-root .md ol{padding-left:1.5em}
.tb3w-root .md li + li{margin-top:.2em}
.tb3w-root .md blockquote{padding:.2em 0 .2em .9em;border-left:3px solid var(--border);color:var(--text-secondary)}
.tb3w-root .md hr{margin:1.2em 0;border:0;border-top:1px solid var(--border)}
.tb3w-root .md a{color:var(--accent);text-decoration:none}
.tb3w-root .md a:hover{text-decoration:underline}
.tb3w-root .md code{padding:.15em .35em;border-radius:4px;background:#f1f3f6;font-family:var(--font-mono);font-size:.92em}
/* 代码块：pre.md-code 里再套 code.md-code__body（内层不重复加底色） */
.tb3w-root .md pre.md-code{position:relative;overflow-x:auto;padding:.9em .9em .8em;border:1px solid var(--border);border-radius:7px;background:#f7f8fa}
.tb3w-root .md pre.md-code > code.md-code__body{padding:0;background:none;font-size:.9em;white-space:pre}
/* 语言标签挂右上角（data-lang 只是数据，展示靠伪元素） */
.tb3w-root .md pre.md-code[data-lang]::before{content:attr(data-lang);position:absolute;top:.35em;right:.7em;font-size:.72em;color:#9aa1ad;text-transform:uppercase;letter-spacing:.06em}
.tb3w-root .md table.md-table{border-collapse:collapse;width:100%;font-size:.95em}
.tb3w-root .md table.md-table th,.tb3w-root .md table.md-table td{padding:.35em .7em;border:1px solid var(--border);text-align:left}
.tb3w-root .md table.md-table th{background:#f7f8fa;font-weight:600}
.tb3w-root .md table.md-table th[align='center'],.tb3w-root .md table.md-table td[align='center']{text-align:center}
.tb3w-root .md table.md-table th[align='right'],.tb3w-root .md table.md-table td[align='right']{text-align:right}
/* 任务项：方框由组件产出（span.md-task__box），这里只管排版 */
.tb3w-root .md li.md-task{list-style:none;margin-left:-1.2em}
.tb3w-root .md li.md-task .md-task__box{display:inline-block;width:1.5em;color:var(--text-secondary)}
.tb3w-root .md li.md-task.is-done{color:var(--text-secondary)}

/*
 * ══════════════════════════════════════════════════════════
 * ask 的样式在 SECTION_SHELL_CSS（.tb3-ask*，与建卡编辑态同一套）。
 * 这里不保留任何 .ask-* 规则。
 * ══════════════════════════════════════════════════════════
 */

/* ══════════════════════════════════════════════════════════
   未知 $type / 脏数据（降级成可展开的原始 JSON）
   —— 容器样式在 SECTION_SHELL_CSS 的 .tb3-sec__unknown，这里只管 .payload-box。
   ══════════════════════════════════════════════════════════ */
.tb3w-root .payload-box{width:100%;max-height:260px;margin:0;padding:9px 11px;overflow:auto;border:1px solid var(--border);border-radius:6px;background:#f6f7f9;font-family:var(--font-mono);font-size:10.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;cursor:text}
`;
