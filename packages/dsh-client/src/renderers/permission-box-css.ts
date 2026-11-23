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
   2. 浮层容器（用户 2026-11-23：「他还是全屏的」）
   ══════════════════════════════════════════════════════════ */

/*
 * 锚点：正好裹住入口按钮，给浮层当定位基准。
 *
 * ⚠ z-index:1200 不是随手写的（用户 2026-11-24：「有什么东西把权限的位置弄走了」）：
 *   DSH 自己的「访问模式」下拉菜单是 position:fixed + z-index:1100，从它自己的
 *   触发器往上弹。我们这一条入口就插在同一行、紧挨着那个触发器 ——
 *   菜单一开，它的**右下角**正好压到我们按钮的左上角（实测水平重叠 ~6px，
 *   垂直只差 4px 的间隙），看上去就是「权限的位置被弄走了」。
 *
 *   ⇒ 把锚点抬到 1200（高于 DSH 菜单的 1100），保证任何情况下我们的按钮
 *     都画在菜单之上、且可点 —— 不改变位置，只保证不被盖住。
 *     同处一个层叠上下文里才有效，所以 position:relative 必须保留。
 */
.tb3pbox-anchor{position:relative;z-index:1200;display:inline-flex;align-items:center}

/*
 * 浮层：贴按钮**上方**弹出（composer 在视口底部，向下弹会出界）。
 *
 * 宽度 340 —— 足够一行放「任务板限制工具调用」这种档位名 + 右侧单选圈，
 * 又不至于把 composer 上方盖掉一大片。高度按内容，最多 70vh 后可滚。
 */
.tb3pbox-pop{
  position:absolute;left:0;bottom:calc(100% + 8px);z-index:900;
  width:340px;max-height:min(70vh,520px);overflow-y:auto;
  border:1px solid #d5dae1;border-radius:12px;
  background:#fff;color:#16181d;
  box-shadow:0 12px 32px rgb(15 23 42 / 16%),0 2px 8px rgb(15 23 42 / 8%);
  font-family:inherit;
  animation:tb3pbox-pop-in .12s ease-out;
}
@keyframes tb3pbox-pop-in{
  from{opacity:0;transform:translateY(4px)}
  to{opacity:1;transform:translateY(0)}
}
/* 关闭按钮压在面板标题右侧（面板自带 h2，浮层不再重复渲染标题）。 */
.tb3pbox-pop__close{
  position:absolute;top:8px;right:8px;
  display:inline-flex;align-items:center;justify-content:center;
  width:26px;height:26px;padding:0;
  border:1px solid transparent;border-radius:7px;
  background:transparent;color:#5f6673;
  font-family:inherit;font-size:16px;line-height:1;
  cursor:pointer;transition:background .12s,color .12s;
}
.tb3pbox-pop__close:hover{background:#f1f3f6;color:#16181d}

/*
 * 面板进浮层后要**收紧**：全屏版的 20px 段距 + 大标题在 340px 宽的浮层里太占地方。
 * ⚠ 只覆盖间距/字号，不动 PermissionPanel 自己的结构（那份是全屏与预览共用的）。
 * ⚠ 本段在模板字符串里 —— 注释中**不能出现反引号**，会提前结束字符串（踩过一次）。
 */
.tb3pbox-pop .tb3perm{padding:14px 14px 12px}
.tb3pbox-pop .tb3perm__head{padding-right:26px;margin-bottom:10px}
.tb3pbox-pop .tb3perm__title{font-size:13px}
.tb3pbox-pop .tb3perm__intro{font-size:11px;margin-top:4px}
.tb3pbox-pop .tb3perm__foot{font-size:11px;padding-top:8px}
`;



