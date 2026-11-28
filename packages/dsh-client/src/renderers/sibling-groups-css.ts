/**
 * 兄弟归组相关样式：科技树最左的「根卡窄列」、树里的组节点、关系区面板。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（会被当成字符串结束）。
 */

/*
 * 折叠组件的样式单独一份：权限链（`@taskboard/dsh-permissions`）通过
 * `@taskboard/dsh-client/fold-pill` 复用组件时，也要能拿到**同一份** CSS。
 * ⇒ 这里插值进去，而不是在这儿再写一遍（见 `fold-pill-css.ts` 的说明）。
 */
import { FOLD_PILL_CSS } from './fold-pill-css.ts';

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
 * 唯一一份 CSS 在 fold-pill-css.ts（权限链复用组件时 import 同一份）。
 * 这里插值进来，styles.ts 照旧只注入 SIBLING_GROUPS_CSS 一段。
 */
${FOLD_PILL_CSS}

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
