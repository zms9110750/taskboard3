/**
 * 权限框的样式 —— composer 工具行里的**入口按钮** + 全屏页的**容器**。
 *
 * ## 两半，各自归属
 *
 * | 段 | 归属 | 在哪 |
 * |---|---|---|
 * | `.tb3perm` 面板本体（437 行）| `PermissionPanel` 组件 | `permission-css.ts` |
 * | `.tb3pbox` 入口按钮 + 全屏壳 | 本文件 | 这里 |
 *
 * ## ⚠ 入口按钮**不用 absolute**
 *
 * 用户截图里的红框位置：composer 工具行内、`完全权限 ▾` 右边。
 * 那个位置是 `conversation.input.left` 槽的**正常文档流**（list 布局），
 * 不是绝对定位区。
 *
 * ⚠ 不要照抄 `.tb3d-entry` 的 absolute —— 那个是**抽屉入口**，它贴到
 *   卡片左外侧（`left:-32px`），是用户 2026-11-20 明确要的另一个位置。
 *   两者槽相同但视觉位置不同：抽屉在卡片外，权限框在工具行内。
 *
 * ## 为什么宽度不写死
 *
 * 按钮文案是「不允许领卡 · 任务板不管理」这种，长度随档位变。
 * 写死宽度会截断 ⇒ `white-space:nowrap` 让内容撑开，上限用 `max-width` 兜。
 *
 * ⚠ 本文件是模板字符串 —— 注释里不能出现反引号（会提前结束字符串，TS1005）。
 */

export const PERMISSION_BOX_CSS = `
/* ══════════════════════════════════════════════════════════
   1. 入口按钮（composer 工具行内，正常文档流）
   ══════════════════════════════════════════════════════════ */
.tb3pbox-entry{
  display:inline-flex;align-items:center;gap:5px;
  height:28px;padding:0 9px;
  border:1px solid #d5dae1;border-radius:8px;
  background:#fff;color:#5f6673;
  font-family:inherit;font-size:11px;line-height:1;white-space:nowrap;
  cursor:pointer;
  transition:border-color .12s,background .12s,color .12s;
}
.tb3pbox-entry:hover{border-color:#cfd5dd;background:#f8fafc;color:#1f2328}
/* 有人动过档位 ⇒ 加一点强调（一眼看出「我设过什么」） */
.tb3pbox-entry[data-non-default="true"]{border-color:#2563eb;color:#1d4ed8}
.tb3pbox-entry svg{display:block;flex:0 0 auto}
.tb3pbox-entry__summary{overflow:hidden;text-overflow:ellipsis;max-width:200px}

/* ══════════════════════════════════════════════════════════
   2. 全屏页容器（用户 2026-11-22：「权限选择只能在全屏下开一个页面」）
   ══════════════════════════════════════════════════════════ */
.tb3pbox-page{
  position:fixed;inset:0;z-index:900;
  display:flex;flex-direction:column;
  background:#fff;color:#16181d;
  font-family:inherit;
}
.tb3pbox-page__head{
  flex:0 0 auto;display:flex;align-items:center;gap:10px;
  height:48px;padding:0 16px;
  border-bottom:1px solid #e7e9ee;background:#fbfcfd;
}
.tb3pbox-page__title{font-size:13.5px;font-weight:600}
.tb3pbox-page__hint{flex:1 1 auto;min-width:0;font-size:11.5px;color:#9aa1ad;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3pbox-page__close{
  display:inline-flex;align-items:center;justify-content:center;
  width:26px;height:26px;padding:0;
  border:1px solid transparent;border-radius:7px;
  background:transparent;color:#5f6673;
  font-family:inherit;font-size:16px;line-height:1;
  cursor:pointer;transition:background .12s,color .12s;
}
.tb3pbox-page__close:hover{background:#f1f3f6;color:#16181d}
.tb3pbox-page__body{
  flex:1 1 auto;min-height:0;overflow-y:auto;
  padding:20px 16px 28px;
}
/* 内容居中、最大宽 760（和 permission-page 候选 A 一致） */
.tb3pbox-page__inner{max-width:760px;margin:0 auto}
`;
