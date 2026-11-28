/**
 * 折叠组件（`FoldPill` / `FoldRect`）的**唯一一份** CSS。
 *
 * ## 为什么单独成文件
 *
 * 用户 `2026-11-28`（issue #56）：权限链的授权页要**复用**同一个折叠组件，
 * 而 `@taskboard/dsh-permissions` 是独立包。组件本体通过
 * `@taskboard/dsh-client/fold-pill` 子路径导出（见 `fold-pill-public.ts`），
 * 样式也必须能跟着走 —— 否则复用了组件却只得到一颗没样式的按钮。
 *
 * ⇒ 从 `sibling-groups-css.ts` 里抽出这一段，两边 **import 同一份字符串**：
 *
 * | 谁 | 怎么用 |
 * |---|---|
 * | `dsh-client` | `sibling-groups-css.ts` 插值进 `SIBLING_GROUPS_CSS`，再由 `styles.ts` 注入 |
 * | `dsh-permissions` | `styles.ts` 直接拼进自己的 `<style>` |
 *
 * ⚠ **不要复制这段 CSS 到第二个文件** —— 那是「复制折叠组件」的另一种形态：
 *   两处样式各自演化，改一处只在一边生效，而且没有任何测试会红。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（会被当成字符串结束）。
 */

/** 胶囊 + 容器矩形。 */
export const FOLD_PILL_CSS = `
/* ── 折叠组件（FoldPill / FoldRect） ──
 *
 * 用户 2026-11-28 的裁定：
 * - 胶囊折叠/展开都在，而且两态完全一样（没有 is-collapsed 的 dashed / 换色）；
 * - 虚线矩形容器只在展开时存在（FoldRect 收起直接返回 null）；
 * - 展开时矩形顶边被胶囊压住：负 margin-top = 胶囊半高（16px）。
 */
.tb3-fold-group{position:absolute}
.tb3-fold-pill{
  box-sizing:border-box;position:relative;z-index:5;
  display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;
  border:1px solid #a78bfa;border-radius:16px;background:#ede9fe;color:#4c1d95;
  font-family:inherit;font-size:11.5px;font-weight:600;line-height:1;cursor:pointer;text-align:left;
  box-shadow:0 1px 2px rgb(109 40 217 / 12%);
}
.tb3-fold-pill:hover{background:#e4ddfd;border-color:#5b21b6}
.tb3-fold-pill:focus-visible{outline:2px solid #2563eb;outline-offset:1px}
.tb3-fold-pill__caret{font-size:17px;font-weight:700;line-height:1;color:#6d28d9;flex:0 0 auto}
.tb3-fold-pill__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tb3-fold-pill__count{margin-left:auto;font-size:10.5px;color:#7c3aed;flex:0 0 auto}

/* 容器矩形：只有展开才存在 */
.tb3-fold-rect{
  box-sizing:border-box;position:relative;
  border:1px dashed #c4b5fd;border-radius:12px;background:#f5f3ff;
  /* 顶边被胶囊压住：负的 margin-top = 胶囊半高，使矩形顶边落在胶囊中线上 */
  margin-top:-16px;padding-top:24px;
}
.tb3-fold-rect__body{position:relative;width:100%}
`;
