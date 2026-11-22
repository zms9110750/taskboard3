/**
 * 派生子任务浮窗的样式 —— 前缀 `[data-menu="derive"]`（`DeriveMenu.tsx` 用）。
 *
 * ## 为什么单独一个文件
 *
 * 用户 `2026-11-22`：「CSS 必须跟着组件走」。
 * 同一形态见 `searchbox-css.ts` / `section-css.ts` / `fallback-css.ts` / `create-shell-css.ts`。
 *
 * ## 为什么复用 `.menu*` 类名，只换 `data-menu` 作用域
 *
 * `StatusMenu` 已经在 `styles.ts` 里定义了整套 `.menu*` 的视觉
 * （容器 / 标题 / 项 / 分隔线 / 空态 / 脚注）。两个菜单在同一屏出现，
 * **长得不一样才是 bug**。
 *
 * ⇒ 这里只补三件事：
 *
 * 1. **容器**（`fixed` + 层级 + 宽度）—— `.menu` 是共用类名，作用域靠 `data-menu`
 * 2. **派生项的图标颜色**（`＋` 不该跟状态转移的彩色图标一样）
 * 3. **目标模板名字的弱化**（说明文字比按钮文字轻）
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（会提前结束字符串，TS1005）。
 */
export const DERIVE_MENU_CSS = `

/* ── 派生子任务菜单（portal 到 body ⇒ 用 data-menu 作用域） ── */
/*
 * ⚠ 宽度必须 = pure/status-menu.ts 的 MENU_WIDTH（280）。
 *   placeMenu() 按那个常量算左右边界；这里写别的值会让浮窗在
 *   视口右侧溢出（算的时候以为是 280，画出来是 300）。
 */
[data-menu="derive"]{position:fixed;z-index:150;width:280px;min-width:280px;padding:8px;border:1px solid var(--border);border-radius:10px;background:var(--bg-card,#fff);box-shadow:0 10px 28px rgb(15 23 42 / 16%);overflow-y:auto;font-family:inherit}
[data-menu="derive"] .menu__title{padding:4px 8px 6px;color:var(--text-weak);font-size:11px;font-weight:600}
[data-menu="derive"] .menu__item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:var(--text);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
[data-menu="derive"] .menu__item:hover,[data-menu="derive"] .menu__item.is-active{background:#f3f4f6}
[data-menu="derive"] .menu__icon{flex:0 0 auto;width:15px;text-align:center;color:var(--accent,#2563eb);font-size:12px}
[data-menu="derive"] .menu__label{flex:0 0 auto}
[data-menu="derive"] .menu__hint{margin-left:auto;padding-left:14px;color:var(--text-weak);font-size:11px;text-align:right}
[data-menu="derive"] .menu__footer{margin-top:4px;padding:8px 8px 2px;border-top:1px solid #f2f4f7;color:var(--text-weak);font-size:11px;line-height:1.5}
`;
