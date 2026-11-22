/**
 * 抽屉（V5 重做）的样式 —— 前缀 `tb3d-`，**唯一真值**。
 *
 * ## ⚠ 为什么单独一个 `.ts` 文件（CSS 跟着组件走）
 *
 * 用户 `2026-11-22` 的要求：**CSS 必须跟着组件走**，不再全堆在 `src/styles.ts`。
 * 抽屉的组件是 `src/renderers/Drawer.tsx`，所以它的样式放在同一个目录下。
 *
 * 但 `styles.ts` **不能 import `.tsx`**（见 `pure/techtree-css.ts` 文件头：
 * `node --test` 直接跑 TS 源码时不认 `.tsx`，`drawer-view.test.ts` 会整个挂）。
 * ⇒ 样式放纯 `.ts`，两个使用方都 import 这里：
 *
 * ```
 * src/renderers/Drawer.tsx  （组件所在的位置，语义上的归属）
 * src/styles.ts             （产品 injectStyles() 时拼进同一个 style 标签）
 * ```
 *
 * `styles.ts` 只做 import + export 转发（末尾一行 `export { DRAWER_CSS }`），
 * `test/css-ownership.test.ts` 钉住「两边拿到的是同一个字符串值」，
 * 并且钉住「`styles.ts` 里不再残留抽屉的 CSS 字面量」。
 *
 * ## 纵向压缩的数值来源
 *
 * `.tb3d-panel .tb3w-*` 那些覆盖里的间距不是写死的，全部从
 * `pure/drawer-view.ts` 的 `DRAWER_COMPACT_SPACING` 插值生成 —— 单一来源。
 * 改了表，CSS 跟着变，单测能断言；反例：CSS 写死一份、报告再写一份，
 * 两边漂了没人发现（这个仓库已经踩过「文档写的数和实现漂了」）。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（会提前结束字符串，TS1005）。
 */

import {
	DRAWER_COMPACT_SPACING,
	DRAWER_VARIANTS,
	DRAWER_VARIANT_IDS,
	drawerEntryCssOf,
	drawerMaskCssOf,
	drawerPanelCssOf,
} from '../pure/drawer-view.ts';

/** 数值 → N px（模板字符串里复用）。 */
function px(value: number): string {
	return `${String(value)}px`;
}

/* ══════════════════════════════════════════════════════════
   抽屉（V5 重做）—— 前缀 `tb3d-`

   形状（用户 `2026-11-20` 画图标注）：

   ```
   ┌──────────────────────────────────────┐
   │ 面板：输入框正上方展开，宽度 = 输入框宽 │
   │ 高度 ≈ 屏幕一半；底边贴输入框上边缘     │
   └──────────────────────────────────────┘
   ┌─┐ ┌──────────────────────────────┬───┐
   │▣│ │ 发消息或创建任务…              │ ➤ │
   └─┘ └──────────────────────────────┴───┘
    ↑ 正方形入口：右边缘贴输入框左边缘，和 + 同一行
   ```

   挂载点：入口 `conversation.input.left`、面板 `conversation.input.overlay`
   （asar 原文与几何证据见 `pure/drawer-view.ts` 文件头）。
   **不用 `shell.overlay`** —— 那是整帧浮层，会横跨窗口（V4 因此被用户否了）。

   ## 为什么 CSS 由纯逻辑插值生成

   三个候选形态的间距 / 圆角 / 高度 / 阴影 / 动画都在 `DRAWER_VARIANTS` 表里
   （`pure/drawer-view.ts`），这里只拼 `[data-drawer-variant="…"]` 规则。
   表改了 CSS 跟着变；单测断言「表里的每个值都出现在 CSS 里」⇒ 两份数值不可能漂。

   ## 三条硬约束

   1. **面板不用 `position:fixed`**（用户 `2026-11-19` 否过：fixed 会逃出父容器）。
      只有候选 C 的半透明**遮罩**用 fixed —— 那是「铺满视口」的语义，而且只在
      用户选中 C 时才渲染。
   2. **两栏各自滚，面板自己不滚**（`.tb3d-body{overflow:hidden}`）。
   3. **宽度不写死**：面板 `left:0;right:0` 撑满 overlayAnchor = 输入框卡片宽。

   ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（会提前结束字符串）。
   ══════════════════════════════════════════════════════════ */

export const DRAWER_CSS = `
/* ── 0. 令牌（没宿主主题时用兜底色） ── */
.tb3d-layer{
  --tb3d-border:#d5dae1; --tb3d-border-weak:#eceff2; --tb3d-head-bg:#fbfcfd;
  /* 入口按钮的边框比面板深一档 —— 它贴在输入框上，同色会「消失」（用户 2026-11-23）。 */
  --tb3d-entry-border:#c6ced8;
  --tb3d-bg:#fff; --tb3d-text:#16181d; --tb3d-text-secondary:#6b7280;
}

/*
 * ── 1. 层：绝对定位、零高度 ──
 *
 * DSH 的 overlayAnchor 原文是 height:0;position:absolute;inset:0 0 auto。
 * 本层贴满它（= 输入框卡片顶部一条零高度线）；面板相对本层 bottom:100% 向上长，
 * 于是「面板底边 = 输入框上边缘 + 形态间距」是**结构保证**，不是调出来的。
 */
.tb3d-layer{position:absolute;left:0;right:0;top:0;height:0;z-index:30;pointer-events:none}

/* ── 2. 面板：底边贴输入框上边缘、宽度 = 输入框宽 ── */
.tb3d-panel{
  position:absolute;left:0;right:0;z-index:1;
  display:flex;flex-direction:column;min-height:0;
  border:1px solid var(--tb3d-border);background:var(--tb3d-bg);
  overflow:hidden;pointer-events:auto;
}
${DRAWER_VARIANT_IDS.map(
	(id) => `.tb3d-panel[data-drawer-variant="${id}"]{${drawerPanelCssOf(DRAWER_VARIANTS[id])}}`,
).join('\n')}
/* 候选 B / C 的上滑动画；prefers-reduced-motion 下一律不动。 */
@keyframes tb3d-rise{
  from{transform:translateY(14px);opacity:.55}
  to{transform:translateY(0);opacity:1}
}
@media (prefers-reduced-motion:reduce){.tb3d-panel{animation:none}}

/* ── 3. 遮罩（只有候选 C 渲染；点它 = 点外部 = 关） ── */
.tb3d-mask{${drawerMaskCssOf()};z-index:0}

/* ── 4. 入口：正方形，右边缘贴输入框左边缘（相对 composer 卡片定位） ── */
/*
 * 用户 2026-11-23：「这个抽屉入口加一个阴影。边框。」
 *
 * ⇒ 原来只有 1px 的 --tb3d-border，而**入口按钮不在 .tb3d-layer 里**
 *   （它在 conversation.input.left 槽、.tb3d-layer 在 overlay 槽）⇒ 自定义属性取不到
 *   ⇒ var() 整条声明在计算值阶段失效 ⇒ 实测 border 算出 0px none、背景透明，
 *   也就是说**之前根本没有边框和底色**。
 *
 * ⇒ 所以每个 var() 都带兜底值：入口是唯一活在层外的 tb3d- 元素。
 *   阴影只在入口按钮上，面板和遮罩不动。
 */
.tb3d-entry{
  position:absolute;${drawerEntryCssOf()};
  display:inline-flex;align-items:center;justify-content:center;padding:0;
  border:1px solid var(--tb3d-entry-border, #c6ced8);
  border-radius:8px;
  background:var(--tb3d-bg, #fff);color:var(--tb3d-text-secondary, #6b7280);
  font-family:inherit;line-height:1;cursor:pointer;z-index:2;
  box-shadow:0 1px 2px rgb(15 23 42 / 10%), 0 2px 6px rgb(15 23 42 / 12%);
  transition:border-color .12s,background .12s,color .12s,box-shadow .12s;
}
.tb3d-entry:hover{
  border-color:#b9c2ce;background:#f8fafc;color:#1f2328;
  box-shadow:0 2px 4px rgb(15 23 42 / 12%), 0 4px 10px rgb(15 23 42 / 14%);
}
.tb3d-entry[aria-expanded="true"]{
  border-color:#1d4ed8;background:#2563eb;color:#fff;
  box-shadow:0 1px 2px rgb(37 99 235 / 24%), 0 3px 10px rgb(37 99 235 / 32%);
}
.tb3d-entry svg{display:block}

/* ── 5. 顶栏：标题 / 刷新 / 关闭 ── */
.tb3d-head{
  flex:0 0 auto;display:flex;align-items:center;gap:8px;height:${px(DRAWER_COMPACT_SPACING.headerHeight)};
  padding:0 10px 0 16px;background:var(--tb3d-head-bg);border-bottom:1px solid var(--tb3d-border-weak);
}
.tb3d-head__title{
  flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--tb3d-text);font-size:13.5px;font-weight:700;letter-spacing:.01em;
}
.tb3d-head__actions{flex:0 0 auto;display:flex;align-items:center;gap:6px}
.tb3d-iconbtn{
  display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;
  border:1px solid #e2e5ea;border-radius:6px;background:#fff;color:#6b7280;
  font-family:inherit;line-height:1;cursor:pointer;transition:color .12s,border-color .12s,background .12s;
}
.tb3d-iconbtn:hover{color:#1f2328;border-color:#cfd5dd;background:#f8fafc}

/* ── 6. 主体：装压缩版 Workspace；面板自己不滚（两栏各自滚） ── */
.tb3d-body{flex:1 1 auto;display:flex;min-height:0;overflow:hidden}
.tb3d-body > .tb3w-root{flex:1 1 auto;min-width:0;min-height:0}

/*
 * ── 7. 压缩：**只收纵向间距**（数值全部来自 DRAWER_COMPACT_SPACING）──
 *
 * 面板高约 min(50vh,480px)，内容区比 V4 的 400 还略高；这套间距是照 400 高量的，
 * 只会更宽松。等用户选定形态、能测真实高度后再复量一次。
 */
.tb3d-panel .tb3w-page{padding:${px(DRAWER_COMPACT_SPACING.pagePadY)} ${px(DRAWER_COMPACT_SPACING.pagePadX)}}

/*
 * chrome 固定两行（用户 2026-11-20：「我要的抽屉视图是两行」）。
 *
 * ⚠ 旧版这里把 chrome 改成 flex-direction:row 并 display:none 掉了
 *   title / legend / filters —— 用户看到的「图例弄没了」「挤成一行」就是这 6 条
 *   造成的，**不是 flex-wrap**。
 *   行 1 = 任务条 + 关系图例 + 工具栏；行 2 = 筛选按钮 + 搜索。
 */
.tb3d-panel .tb3w-chrome{flex-direction:column;gap:0}
.tb3d-panel .tb3w-chrome > .space-bar{flex:0 1 auto;min-width:0;padding:2px 2px;gap:5px}
.tb3d-panel .tb3w-toolbar{flex:0 0 auto;justify-content:flex-end;margin-top:${px(DRAWER_COMPACT_SPACING.toolbarGap)};gap:4px 8px}
.tb3d-panel .tb3w-toolbar__perm{display:none}
/* 行 2：筛选 + 搜索。参与文档流（不浮层）—— 展开只撑高这一行。 */
.tb3d-panel .tb3w-filters{flex:0 0 auto;margin-top:${px(DRAWER_COMPACT_SPACING.toolbarGap)}}
.tb3d-panel .tb3w-main{margin-top:${px(DRAWER_COMPACT_SPACING.mainGap)}}

/* 控件小一号（高度不变形，只影响视觉密度） */
.tb3d-panel .tb3w-root .space-chip{padding:2px 9px;font-size:11px}
.tb3d-panel .tb3w-root .space-action{min-width:0;padding:2px 9px;font-size:11px}
.tb3d-panel .tb3w-root .ghost-btn{padding:2px 9px;font-size:11px}
.tb3d-panel .tb3w-seg__btn{padding:2px 9px;font-size:10.5px}
.tb3d-panel .tb3w-btn-primary{padding:3px 10px;font-size:10.5px}

/* 列表 */
.tb3d-panel .tb3w-list__head{padding:${px(DRAWER_COMPACT_SPACING.listHeadPadTop)} 12px ${px(DRAWER_COMPACT_SPACING.listHeadPadBottom)}}
.tb3d-panel .tb3w-list__cols{display:none}
.tb3d-panel .tb3w-list__body{padding:${px(DRAWER_COMPACT_SPACING.listBodyPadTop)} ${px(DRAWER_COMPACT_SPACING.listBodyPadX)} ${px(DRAWER_COMPACT_SPACING.listBodyPadBottom)}}
.tb3d-panel .tb3w-root .task-card{margin-bottom:${px(DRAWER_COMPACT_SPACING.cardGap)};padding:${px(DRAWER_COMPACT_SPACING.cardPadY)} 10px}

/* 详情 */
.tb3d-panel .tb3w-root .detail{padding:${px(DRAWER_COMPACT_SPACING.detailPadY)} ${px(DRAWER_COMPACT_SPACING.detailPadX)};gap:${px(DRAWER_COMPACT_SPACING.detailGap)}}
.tb3d-panel .tb3w-root .detail-sections{gap:${px(DRAWER_COMPACT_SPACING.sectionGap)}}
.tb3d-panel .tb3w-root .detail-title{font-size:14px}
.tb3d-panel .tb3w-root .detail-history{gap:5px}
.tb3d-panel .tb3w-root .detail-history__item{font-size:10.5px}
.tb3d-panel .tb3w-root .detail-action{padding:3px 9px;font-size:11px}

/*
 * ── 8. 宽版：左列固定 320（列表 316px、详情吃剩余）──
 *
 * ⚠ 只在容器宽 ≥ 700 时生效：窄于 700 时 Workspace 自己会切上下堆叠
 *   （@container tb3w (max-width:700px)），这时再钉死 320 宽会把堆叠挤坏。
 */
@container tb3w (min-width: 700px) {
  .tb3d-panel .tb3w-list{flex:0 0 ${px(DRAWER_COMPACT_SPACING.listWidth)}}
  .tb3d-panel .tb3w-detail{flex:1 1 0;min-width:0;max-width:none}
}
`;
