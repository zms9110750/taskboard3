/**
 * 兄弟归组相关样式：科技树最左的「根卡窄列」、树里的组节点、关系区面板。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（会被当成字符串结束）。
 */

/** 根卡窄列 + 组节点 + 关系区面板。 */
export const SIBLING_GROUPS_CSS = `
/* ── 1. 画布行：最左窄列 + 画布 ── */
.tb3t-canvas-row{flex:1 1 auto;display:flex;min-height:0;min-width:0}
.tb3t-rootcol{
  flex:0 0 44px;width:44px;align-self:stretch;
  display:flex;flex-direction:column;align-items:center;gap:6px;
  padding:8px 0 10px;border:0;border-right:1px solid var(--border,#e5e7eb);
  background:var(--bg-soft,#f9fafb);color:var(--text-weak,#6b7280);
  font-family:inherit;font-size:11px;line-height:1.3;cursor:pointer;
  transition:background .12s,color .12s;
}
.tb3t-rootcol:hover{background:#eef2f7;color:var(--text,#16181d)}
.tb3t-rootcol.is-open{background:#e8effb;color:#1d4ed8}
.tb3t-rootcol__label{writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:1px;font-weight:600}
.tb3t-rootcol__count{font-size:10px;color:var(--text-weak,#9ca3af)}

/* ── 2. 折叠组件（FoldPill / FoldRect） ──
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

/* ── 3. 兄弟关系区面板（详情位 / 全屏页共用） ── */
.tb3g-panel{display:flex;flex-direction:column;gap:8px;min-height:0;height:100%;
  padding:12px;overflow:auto;font-size:12px;color:var(--text,#16181d)}
.tb3g-panel__head{display:flex;align-items:center;gap:8px;padding-bottom:8px;
  border-bottom:1px solid var(--border,#e5e7eb)}
.tb3g-panel__title{font-size:13px;font-weight:600}
.tb3g-panel__count{font-size:11px;color:var(--text-weak,#9ca3af)}
.tb3g-panel__close{margin-left:auto;width:22px;height:22px;border:0;border-radius:5px;
  background:transparent;color:#6b7280;cursor:pointer;font-size:14px;line-height:1}
.tb3g-panel__close:hover{background:#f1f5f9;color:#16181d}

.tb3g-groups{display:flex;flex-direction:column;gap:4px}
.tb3g-group{border:1px solid #ddd6fe;border-radius:8px;background:#faf8ff;overflow:hidden}
.tb3g-group__row{display:flex;align-items:center;gap:6px;padding:5px 8px}
.tb3g-group__toggle{width:18px;height:18px;border:1px solid #ddd6fe;border-radius:4px;
  background:#fff;color:#6d28d9;cursor:pointer;font-size:10px;line-height:1;flex:0 0 auto}
.tb3g-group__name{flex:1 1 auto;min-width:0;border:0;background:transparent;padding:0;
  text-align:left;font-family:inherit;font-size:12px;font-weight:600;color:#4c1d95;cursor:text;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3g-group__input{flex:1 1 auto;min-width:0;font-family:inherit;font-size:12px;
  border:1px solid #c4b5fd;border-radius:4px;padding:1px 4px}
.tb3g-group__size{font-size:10.5px;color:#7c3aed;flex:0 0 auto}
.tb3g-group__action{border:1px solid #ddd6fe;border-radius:4px;background:#fff;
  color:#6d28d9;font-family:inherit;font-size:10.5px;padding:1px 6px;cursor:pointer;flex:0 0 auto}
.tb3g-group__action:hover{background:#f5f3ff}
.tb3g-group__body{display:flex;flex-direction:column;gap:2px;padding:2px 8px 6px 26px}

.tb3g-loose{display:flex;flex-direction:column;gap:2px}
.tb3g-row{display:flex;align-items:center;gap:7px;padding:3px 6px;border-radius:5px;cursor:pointer}
.tb3g-row:hover{background:#f4f6f9}
.tb3g-row__id{font-size:10.5px;color:#9ca3af;flex:0 0 auto;font-variant-numeric:tabular-nums}
.tb3g-row__title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3g-row__remove{margin-left:auto;border:0;background:transparent;color:#9ca3af;
  font-family:inherit;font-size:10.5px;cursor:pointer;flex:0 0 auto}
.tb3g-row__remove:hover{color:#b91c1c}

.tb3g-empty{padding:10px 4px;color:var(--text-weak,#9ca3af);font-size:11.5px}
.tb3g-error{padding:6px 8px;border-radius:6px;background:#fef2f2;color:#b91c1c;font-size:11.5px}
.tb3g-actions{display:flex;align-items:center;gap:8px;padding-top:8px;
  border-top:1px solid var(--border,#e5e7eb);margin-top:auto}
.tb3g-actions__picked{font-size:11px;color:var(--text-weak,#9ca3af)}
.tb3g-actions__select{font-family:inherit;font-size:11.5px;border:1px solid #d7dbe2;
  border-radius:5px;padding:2px 6px;background:#fff;margin-left:auto}
.tb3g-actions .ghost-btn{font-family:inherit;font-size:11.5px}
.tb3g-actions .ghost-btn:disabled{opacity:.5;cursor:not-allowed}
`;
