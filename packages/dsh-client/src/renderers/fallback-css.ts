/**
 * 降级块的样式 —— 缺渲染器时那个 ⚠ 块（`.missing-renderer`）和 JSON 树（`.json-fallback`）。
 *
 * ## 为什么单独一个文件（用户 2026-11-22）
 *
 * `.missing-renderer` / `.json-fallback` 原先**全仓 0 条 CSS 规则** ——
 * 组件写了但没样式，接上去就是一堆无样式 div。这个文件补上。
 *
 * ## 新形态：CSS 跟着组件走
 *
 * 用户的裁决（本轮）：
 * > 「css 什么的不重要。重要的是需要改的时候可以抽出来改。」
 *
 * ⇒ 这段 CSS 不走「全塞进 `styles.ts`」的老路，而是独立 `.ts` 文件导出字符串，
 *   `styles.ts` import 它并拼进 `injectStyles()`，同时 `export` 转发（老调用方不受影响）。
 *   同一个形态已经在 `searchbox-css.ts` / `section-css.ts` / `create-css.ts` 上用了。
 *
 * ## ⚠ 不带 `.tb3w-root` 前缀（和 `.json-fallback` 一致）
 *
 * 降级块是**独立组件**，不该要求「外面必须套着工作区根节点」才生效 ——
 * 那样它在预览、单独复用、别的降级路径里都是无样式的一堆 div。
 * `missing-renderer` 这个类名足够独特，撞不上宿主或其他插件。
 *
 * ## 设计要求（`docs/渲染注册表.md` 8.4）
 *
 * > 降级块**必须看起来像出问题了**，不能长得像一个正常章节。
 *
 * 三条视觉信号：
 * 1. **左侧橙红竖条** —— 和 `CardRow` 的未读边框同一套视觉语言（加粗上色，不画装饰）
 * 2. **暖色底 + 橙红边框** —— 一眼看出「这块和旁边不一样」
 * 3. **等宽字体画 JSON** —— 让「这是降级内容」和「这是正文」在字体上就分得开
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（TS1005）。
 */

/**
 * 橙红色（和 `.tb3w-root` 里未读边框的 warn 色同源）。
 *
 * 为什么不用 `var(--warn)` 兜底成别的色：降级块必须**跨主题都刺眼**，
 * 所以这里用确定的色值，只把宿主的 `--warn` 当首选。
 */
export const FALLBACK_CSS = `
/* ══════════════════════════════════════════════════════════
   降级块 —— 「这一章没有渲染器」
   ══════════════════════════════════════════════════════════

   用户 2026-11-22：
   > 「一个折叠栏一个标题，说未注册。然后点击打开以后显示格式化的 json。」

   ⇒ 头部常驻（竖条 + ⚠ + 标题 + 人话），正文是折叠栏，展开才画 JSON。 */

.missing-renderer{
  position:relative;
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:10px 12px 10px 14px;
  border:1px solid var(--fallback-border,#f0b8a0);
  border-radius:8px;
  background:var(--fallback-bg,#fff7f3);
}

/* ① 左边橙红竖条 —— 三条视觉信号里最硬的一条。 */
.missing-renderer__bar{
  position:absolute;
  left:0;
  top:0;
  bottom:0;
  width:3px;
  border-radius:8px 0 0 8px;
  background:var(--fallback-accent,#e2603c);
}

.missing-renderer__head{
  display:flex;
  align-items:flex-start;
  gap:8px;
  min-width:0;
}

/* ② ⚠ 图标：橙红，稍大，不参与换行。 */
.missing-renderer__icon{
  flex:0 0 auto;
  font-size:14px;
  line-height:1.35;
  color:var(--fallback-accent,#e2603c);
}

.missing-renderer__text{
  display:flex;
  flex-direction:column;
  gap:2px;
  min-width:0;
}

/* ③ 标题：说清「没有渲染器」+ 把 $type 打出来（报 bug 时能直接引用）。 */
.missing-renderer__title{
  font-size:12px;
  font-weight:600;
  line-height:1.5;
  color:var(--fallback-text,#8a3418);
  overflow-wrap:anywhere;
}

.missing-renderer__hint{
  font-size:11px;
  line-height:1.5;
  color:var(--fallback-hint,#a4644c);
}

.missing-renderer__body{
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:6px;
  min-width:0;
}

/* 折叠栏的按钮：沿用 ghost-btn，只把它对齐到降级块的视觉里。 */
.missing-renderer__toggle{
  font-size:11px;
  padding:2px 8px;
}

/* 展开后的 JSON 容器：等宽字体 + 可滚，视觉上明确是「降级内容」。 */
.missing-renderer__json{
  width:100%;
  max-height:260px;
  overflow:auto;
  padding:9px 11px;
  border:1px solid var(--fallback-border,#f0b8a0);
  border-radius:6px;
  background:var(--fallback-json-bg,#fffdfc);
  font-family:ui-monospace,SFMono-Regular,"Cascadia Mono","Consolas",monospace;
  font-size:11px;
  line-height:1.55;
}

/* ══════════════════════════════════════════════════════════
   JSON 树（JsonFallback 的产物）
   ══════════════════════════════════════════════════════════

   ⚠ 这些规则**不带 .tb3w-root 前缀**：JsonFallback 也会在别处被单独用
     （预览、将来别的降级路径），不该强制要求外面套工作区根节点。
     反正类名都是 json-fallback__ 打头，撞不上宿主。 */

.json-fallback{
  font-family:ui-monospace,SFMono-Regular,"Cascadia Mono","Consolas",monospace;
  font-size:11px;
  line-height:1.55;
  color:var(--fallback-json-text,#4a3a34);
}

.json-fallback__branch,
.json-fallback__leaf{
  min-width:0;
}

.json-fallback__group{
  display:inline-flex;
  flex-direction:column;
  align-items:flex-start;
  gap:1px;
}

/* 折叠/展开的开关：看起来像链接，不是按钮。 */
.json-fallback__toggle{
  display:inline-flex;
  align-items:baseline;
  gap:4px;
  padding:0;
  border:0;
  background:transparent;
  color:inherit;
  font:inherit;
  cursor:pointer;
}

.json-fallback__toggle:hover{
  color:var(--fallback-accent,#e2603c);
}

.json-fallback__caret{
  flex:0 0 auto;
  width:9px;
  color:var(--fallback-hint,#a4644c);
}

.json-fallback__children{
  display:flex;
  flex-direction:column;
  gap:1px;
  margin-left:13px;
  padding-left:8px;
  border-left:1px dashed var(--fallback-border,#e8cdc2);
}

.json-fallback__row{
  min-width:0;
}

.json-fallback__key{
  color:var(--fallback-json-key,#8a5a3a);
}

.json-fallback__string{
  color:var(--fallback-json-string,#3f7a4a);
}

.json-fallback__number{
  color:var(--fallback-json-number,#3a5f9a);
}

.json-fallback__bool{
  color:var(--fallback-json-bool,#8a4a9a);
}

.json-fallback__null{
  color:var(--fallback-json-null,#8a7a72);
}

.json-fallback__opaque{
  color:var(--fallback-json-null,#8a7a72);
  font-style:italic;
}

.json-fallback__trunc{
  color:var(--fallback-hint,#a4644c);
  font-style:normal;
}
`;
