/**
 * SearchBox 的样式 —— 前缀 「.search-box」（SearchBox 组件自带，类名不改）。
 *
 * ## 为什么在组件目录
 *
 * 用户要求「CSS 必须跟着组件走」：组件在哪，样式就在哪，不再全堆在
 * src/styles.ts 的巨型字符串里。本文件放在 renderers/ 下，与 SearchBox.tsx 同级。
 *
 * ## 为什么是纯 .ts，不是 .css
 *
 * rolldown 1.3.2 对 import “./x.css” 直接报 Bundling CSS is no longer supported
 * ⇒ 不能建 .css 文件；产物只有单个 lib/client.js，没有独立的 style.css 可取。
 * 宿主允许运行时插 <style>，所以 CSS 只能是 TS 字符串常量，由 src/styles.ts 的
 * injectStyles() 拼进同一个 style 标签。
 *
 * ## 从哪来（历史）
 *
 * SearchBox 的视觉细节原先只存在于 dev/preview/searchbox/style.css（那一份仍给
 * SearchBox 自己的预览用）。V3 工作区要用它 ⇒ 在产品样式里收口成一份，
 * 原先放在 src/styles.ts 的 SEARCHBOX_CSS；2026-11-22 按用户要求搬到这里。
 *
 * ## 和 preview 那份的差别（只有两处，都不是行为）
 *
 * 1. 作用域：全部包在 「.tb3w-root」 下（类名保持原样，只加前缀 —— 同
 *    WORKSPACE_CSS 的约定，避免 .search-box 这种通用名撞到宿主）。
 * 2. 颜色：用宿主 token + 兜底色（var(--accent, #2563eb) 这套），
 *    兜底值就是 preview 里写的那个色值。焦点 / hover / disabled 都是样式，
 *    判决（能不能提交）在 src/pure/search-box.ts，本段不碰。
 *
 * ⚠ 布局宽度由调用方决定（WORKSPACE_CSS 的 .tb3w-filters__tail .search-box）；
 *   组件本身 field 是 flex:1，没有固定宽度 —— 这是 SearchBox 的设计，本文件不改它。
 *
 * ⚠ 本文件是模板字符串 —— 注释里不能出现反引号。
 */
export const SEARCHBOX_CSS = `
.tb3w-root .search-box{display:flex;align-items:stretch;min-width:0}
.tb3w-root .search-box__field{position:relative;display:flex;align-items:center;flex:1 1 auto;min-width:0;height:28px;border:1px solid var(--border,#e7e9ee);border-radius:8px;background:var(--bg-card,#fff);transition:border-color .12s,background .12s}
.tb3w-root .search-box__field:focus-within{border-color:var(--accent,#2563eb)}
.tb3w-root .search-box__icon{position:absolute;left:7px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--text-weak,#9aa1ad);cursor:pointer}
/* 图标是按钮：hover 变深，禁用时不可点（它和「前往」是同一个 submit()） */
.tb3w-root .search-box__icon:hover:not(:disabled){color:var(--accent,#2563eb)}
.tb3w-root .search-box__icon:disabled{cursor:default;opacity:.55}
/* 左内边距 30px = 图标左 9px + 图标 14px + 间距 7px —— 文字不会压到图标 */
.tb3w-root .search-box__input{width:100%;height:100%;padding:0 10px 0 30px;border:0;border-radius:8px;outline:none;background:transparent;font-family:inherit;font-size:12.5px;line-height:1.5;color:var(--text,#16181d)}
.tb3w-root .search-box__input::placeholder{color:var(--text-weak,#9aa1ad)}
.tb3w-root .search-box__input:disabled{cursor:not-allowed}





.tb3w-root .search-box[data-search-disabled='true'] .search-box__field{background:#f7f8fa;border-color:var(--border,#e7e9ee)}
`;
