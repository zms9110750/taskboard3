/**
 * 「是否允许领卡」控件的 CSS —— **跟着组件走**（用户 `2026-11-22`：
 * 「CSS 必须跟着组件走」）。
 *
 * ## 为什么单独一个文件
 *
 * `WORKSPACE_CSS` 已经是几百行的大常量；这个控件是**后加的独立部件**
 * （用户 `2026-11-23` 把 card 轴从 composer 搬到任务板工具栏）。
 * 混进 `WORKSPACE_CSS` 会让「它在哪」更难找。
 *
 * ## 紧凑是硬要求
 *
 * 工具栏右列在 952 宽的抽屉里还要放下「工作空间 ▾ / 科技树 列表 / 新建」。
 * ⇒ 按钮只占一行、字号比正文小一档、`white-space:nowrap`。
 *   **不许把工具栏挤到第二行** —— 挤了就是这里做得太大。
 *
 * ## 配色
 *
 * 和旁边「工作空间 ▾」同一套（同圆角/同边框色/同 hover），
 * 只有「非默认档位」时边框转蓝 —— 让「我改过」一眼可见。
 */

export const CARD_ACTION_CSS = `
.tb3w-cardact{position:relative;display:inline-flex;flex:0 0 auto}
.tb3w-cardact__btn{
  display:inline-flex;align-items:center;gap:5px;
  height:24px;padding:0 8px;
  border:1px solid var(--tb3w-line,#e5e7eb);border-radius:6px;
  background:#fff;color:var(--tb3w-text-2,#4b5563);
  font:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;
}
.tb3w-cardact__btn:hover{border-color:#cfd5dd;background:#f8fafc}
.tb3w-cardact__btn[data-pending="true"]{opacity:.6;cursor:progress}
.tb3w-cardact__value{color:inherit;font-weight:500}
.tb3w-cardact__btn[data-phase="ready"][data-non-default="true"]{border-color:#2563eb;color:#1d4ed8}
.tb3w-cardact__caret{font-size:9px;color:#9ca3af;transform:translateY(1px)}

.tb3w-cardact__menu{
  position:absolute;top:calc(100% + 4px);right:0;z-index:30;
  display:flex;flex-direction:column;min-width:184px;
  padding:4px;
  border:1px solid var(--tb3w-line,#e5e7eb);border-radius:8px;
  background:#fff;box-shadow:0 6px 20px rgb(15 23 42 / 14%);
}
.tb3w-cardact__opt{
  display:flex;flex-direction:column;align-items:flex-start;gap:2px;
  padding:6px 8px;border:0;border-radius:6px;background:transparent;
  font:inherit;font-size:12px;line-height:1.35;text-align:left;cursor:pointer;color:inherit;
}
.tb3w-cardact__opt:hover{background:#f3f4f6}
.tb3w-cardact__opt.is-on{background:#eff6ff}
.tb3w-cardact__opt.is-on .tb3w-cardact__opt-label{color:#1d4ed8;font-weight:600}
.tb3w-cardact__opt-desc{font-size:11px;color:#6b7280}
`;
