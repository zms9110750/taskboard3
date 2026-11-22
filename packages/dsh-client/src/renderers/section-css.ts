/**
 * 章节渲染（Section / Markdown / AskSection）的样式 —— 作用域 「.tb3w-root」。
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
 * ## 为什么单独一段
 *
 * 这三个组件是 C6 定稿的，但它们的 CSS 一直只存在于预览里：
 * dev/preview/section/style.css + dev/preview/markdown/style.css。
 * 2026-11-20 章节接进 CardDetail（详情是产品级页面）⇒ 必须在产品样式里
 * 收口一份，否则详情里的章节是裸文本：没有外框、markdown 没有排版、
 * ask 没有选项样式。
 *
 * 规则逐条照搬那两个 preview CSS，只加 .tb3w-root 前缀，类名一个没改
 * （那些预览验收过的 DOM 仍然对得上）。
 *
 * ## 间距归父容器管
 *
 * .section-block 在预览里自带 margin-bottom:10px；产品里章节挂在
 * .detail-sections（display:flex;gap:12px）下 ⇒ 这里不加 margin，
 * 否则间距叠加成 22px。
 *
 * ⚠ .tb3w-root 前缀必须保留：它靠这个作用域隔离（.md-* / .ask-* / .payload-box
 *   都是通用名，裸写会撞到宿主）。
 *
 * ⚠ 本文件是模板字符串 —— 注释里不能出现反引号。
 */
export const SECTION_CSS = `
/* ── 一章的外框 ── */
.tb3w-root .section-block{padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card)}
/* 可编辑：整章是点击目标 ⇒ 给 hover 反馈；只读时没有 pointer/hover（点不动看得出来） */
.tb3w-root .section-block.is-editable{cursor:pointer;transition:border-color .12s,background .12s}
.tb3w-root .section-block.is-editable:hover{border-color:var(--accent);background:#f8fbff}
.tb3w-root .section-block__label{display:flex;align-items:baseline;gap:8px;margin-bottom:6px;font-size:11.5px;color:var(--text-secondary)}
.tb3w-root .section-block__label-text{font-weight:600}
/* 内容类型标签（已建卡/草稿里只显示、不可改 —— 用户 2026-11-22） */
.tb3w-root .section-block__kind{padding:1px 8px;border-radius:999px;background:#f1f3f6;color:var(--text-secondary);font-size:10.5px;white-space:nowrap}
.tb3w-root .section-block__edit-hint{margin-left:auto;font-size:10.5px;color:var(--accent);opacity:0;transition:opacity .12s}
.tb3w-root .section-block.is-editable:hover .section-block__edit-hint{opacity:1}
/* text 正文：保留换行与缩进（text 与 markdown 的区别就在这里） */
.tb3w-root .section-block__text{font-size:12.5px;line-height:1.75;color:var(--text);white-space:pre-wrap;word-break:break-word}
/* ── 三相位的内联编辑（用户 2026-11-21 采纳） ── */
.tb3w-root .section-block__field{display:flex;flex-direction:column;gap:6px;min-width:0}
.tb3w-root .section-block__textarea{width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid var(--border-strong,#d7dbe2);border-radius:6px;background:#fff;color:var(--text);font:12.5px/1.7 inherit;resize:vertical}
.tb3w-root .section-block__textarea:focus{outline:none;border-color:var(--accent)}
.tb3w-root .section-block__textarea.is-readonly{background:#fafbfc;color:var(--text-secondary);border-color:var(--border,#e7e9ee);cursor:default}
.tb3w-root .section-block__textarea.is-mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
.tb3w-root .section-block__decl{border:1px dashed var(--border-strong,#d7dbe2);border-radius:6px;background:#fafbfc;padding:5px 9px}
.tb3w-root .section-block__decl summary{cursor:pointer;font-size:11px;color:var(--text-secondary)}
.tb3w-root .section-block__decl-input{width:100%;box-sizing:border-box;margin-top:5px;padding:5px 8px;border:1px solid var(--border-strong,#d7dbe2);border-radius:5px;background:#fff;font:11.5px/1.6 inherit;color:var(--text)}
.tb3w-root .section-block__actions{display:flex;gap:6px}
/* 空态 / 模板作者写的灰字 */
.tb3w-root .section-block__placeholder{font-size:12.5px;line-height:1.7;color:var(--text-weak);font-style:italic}

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

/* ══════════════════════════════════════════════════════════
   ask（来自 dev/preview/section/style.css）
   ══════════════════════════════════════════════════════════ */
.tb3w-root .ask-group + .ask-group{margin-top:14px;padding-top:12px;border-top:1px dashed var(--border)}
.tb3w-root .ask-group__header{margin-bottom:2px;font-size:10.5px;color:var(--text-weak)}
.tb3w-root .ask-group__question{margin-bottom:8px;font-size:12.5px;font-weight:600}
.tb3w-root .ask-group__options{display:flex;flex-direction:column;gap:4px}
.tb3w-root .ask-option{display:flex;align-items:flex-start;gap:7px;width:100%;padding:6px 9px;border:1px solid var(--border);border-radius:7px;background:var(--bg-card);color:var(--text);font-family:inherit;font-size:12.5px;text-align:left;cursor:pointer;transition:border-color .12s,background .12s}
.tb3w-root .ask-option:hover{border-color:#93c5fd;background:#f8fbff}
/* 只读的选项是 div —— 不给指针、不给 hover */
/*
 * 冻结态（用户 2026-11-21「这里没有css」+ 设计稿 detail-ask-states.png）：
 *   未选中 ⇒ **去掉边框、透明底、文字弱化**（降级成一行，不占版面）
 *   已选中 ⇒ 保留边框 + 淡蓝底 + 左侧竖线
 */
.tb3w-root .ask-option.is-readonly{cursor:default;border-color:transparent;background:transparent;color:var(--text-weak)}
.tb3w-root .ask-option.is-readonly .ask-option__desc{color:var(--text-weak);opacity:.75}
.tb3w-root .ask-option.is-readonly.is-picked{border-color:var(--accent);background:#eff6ff;color:var(--text)}
.tb3w-root .ask-option.is-readonly.is-picked .ask-option__desc{color:var(--text-secondary);opacity:1}
.tb3w-root .ask-option.is-readonly:hover{border-color:var(--border);background:var(--bg-card)}
/* 已选：accent 描边 + 淡蓝底 + 勾 */
.tb3w-root .ask-option.is-picked{border-color:var(--accent);background:#eff6ff}
.tb3w-root .ask-option.is-readonly.is-picked:hover{border-color:var(--accent);background:#eff6ff}
/* 勾的位置固定占宽 ⇒ 未选中的文字不会左右跳 */
.tb3w-root .ask-option__mark{flex:0 0 12px;color:var(--accent);font-weight:700;line-height:1.5}
.tb3w-root .ask-option__body{display:flex;flex:1 1 auto;flex-direction:column;gap:1px;min-width:0}
.tb3w-root .ask-option__label{font-weight:500}
.tb3w-root .ask-option__desc{font-size:11px;line-height:1.6;color:var(--text-secondary)}
/* 三态徽标：未选择灰 / 都不要橙 / 已选绿 */
.tb3w-root .ask-group__state{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:8px;font-size:10.5px;color:var(--text-weak)}
.tb3w-root .ask-group__state-text{padding:0 6px;border-radius:4px;background:#f1f3f6;font-family:var(--font-mono)}
.tb3w-root .ask-group__state[data-ask-state-label='unset'] .ask-group__state-text{color:#6b7280}
.tb3w-root .ask-group__state[data-ask-state-label='none'] .ask-group__state-text{color:#b45309;background:#fef3c7}
.tb3w-root .ask-group__state[data-ask-state-label='picked'] .ask-group__state-text{color:#047857;background:#d1fae5}
/* ── 选项标记：单选圆圈 / 多选方框 / 冻结勾（用户 2026-11-21） ── */
.tb3w-root .ask-option__mark--box{flex:0 0 14px;width:14px;height:14px;box-sizing:border-box;border:1.5px solid var(--border-strong,#c5ccd6);border-radius:50%;background:#fff;margin-top:2px}
.tb3w-root .ask-option__mark--box[data-multi='true']{border-radius:3px}
.tb3w-root .ask-option.is-picked .ask-option__mark--box{position:relative;border-color:var(--accent);background:#fff}
.tb3w-root .ask-option.is-picked .ask-option__mark--box::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--accent)}
.tb3w-root .ask-option.is-picked .ask-option__mark--box[data-multi='true']::after{border-radius:1px}

.tb3w-root .ask-option__mark--check{flex:0 0 14px;width:14px;color:var(--accent);font-weight:700;text-align:center;line-height:14px}
.tb3w-root .ask-group__state-text{padding:1px 8px;border-radius:999px;background:#f1f3f6;color:var(--text-secondary);font-family:var(--font-mono);font-size:10.5px}
/* 冻结态「未选择」带边框 —— 暗示这是一个**结果**，不是按钮 */
.tb3w-root .ask-group[data-ask-state='unset'] .ask-group__state-text{border:1px solid var(--border-strong,#c5ccd6);background:transparent;color:var(--text-weak)}
/* ── 问题行：问题 + 单选/多选标签 + 状态按钮 ── */
.tb3w-root .ask-group__qrow{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.tb3w-root .ask-group__qrow .ask-group__question{margin:0;flex:1 1 auto;min-width:0}
.tb3w-root .ask-group__multitag{flex:0 0 auto;padding:0 5px;border-radius:3px;background:#f3f4f6;color:var(--text-secondary);font-size:10px}
.tb3w-root .ask-group__state-btn{flex:0 0 auto;padding:1px 8px;font-size:10.5px}
/* 「未选择」按钮：当前就是未选择时**亮起**（黑底白字），点它能回到这个状态 */
/* 未选择按钮「亮起」= **蓝边框 + 蓝字，不填充**（用户 2026-11-21：
   和组件主题一致；用边框表示这个胶囊被选中，不是蓝底） */
.tb3w-root .ask-group__state-btn{border:1px solid var(--border-strong,#c5ccd6);border-radius:5px;background:transparent;color:var(--text-secondary);cursor:pointer}
.tb3w-root .ask-group__state-btn.is-on{color:var(--accent);background:transparent;box-shadow:inset 0 0 0 1.5px var(--accent)}
/* 「自己填：」—— 可点的选中入口 */
.tb3w-root .ask-option__custom-label{flex:0 0 auto;margin:0;padding:0;border:0;background:none;color:var(--text-secondary);font:inherit;font-size:12px;cursor:pointer}
.tb3w-root .ask-option__custom-label:hover{color:var(--accent)}
/* ── 「激活」的题目：左边竖边框 ── */
/* 左侧 12px 内边距恒定（不随状态变），边框画在 left:0 ⇒ 零位移。选择态：不是未选择就打整页左边框 */
.tb3w-root .ask-group{position:relative;padding-left:12px}
.tb3w-root .ask-group[data-ask-active='true']::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent);border-radius:2px}
/* 冻结态：不给整页打边框，只给**选中的选项**打左边框 */
/*
 * 左边框的两种态（用户 2026-11-21）：
 *   冻结（ended）⇒ **选中的那个选项框**左边有边
 *   选择（active）⇒ **整个问题页**左边有边（见下面的 [data-ask-active='true']）
 * 用 ::before 绝对定位，不占位、不位移。
 */
.tb3w-root .ask-option.is-readonly.is-picked{position:relative}
.tb3w-root .ask-option.is-readonly.is-picked::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent);border-radius:7px 0 0 7px}
/* ── 自填行：圆圈 + 文本框 ── */
.tb3w-root .ask-option--custom{cursor:default;align-items:center}
.tb3w-root .ask-option--custom .ask-group__custom{flex:1 1 auto;min-width:0;padding:4px 8px;border:1px dashed var(--border-strong,#c5ccd6);border-radius:5px;background:#fafbfc;font:12px/1.5 inherit;color:var(--text)}
.tb3w-root .ask-group__custom-values{font-size:10.5px;color:var(--text-secondary)}
/* 「都不要」+ 自填 */
.tb3w-root .ask-group__actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:9px;padding-top:9px;border-top:1px dashed #f0f2f6}
.tb3w-root .ask-group__custom{flex:1 1 200px;min-width:120px;padding:4px 9px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text);font-family:inherit;font-size:12px}
.tb3w-root .ask-group__custom:focus{outline:none;border-color:var(--accent)}

/* ══════════════════════════════════════════════════════════
   未知 $type / 脏数据（降级成可展开的原始 JSON）
   ══════════════════════════════════════════════════════════ */
.tb3w-root .section-block__unknown{display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.tb3w-root .payload-box{width:100%;max-height:260px;margin:0;padding:9px 11px;overflow:auto;border:1px solid var(--border);border-radius:6px;background:#f6f7f9;font-family:var(--font-mono);font-size:10.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;cursor:text}
`;
