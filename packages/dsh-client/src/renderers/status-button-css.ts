/**
 * `StatusButton` 的 CSS 真值 —— 用户 2026-11-22：「CSS 必须跟着组件走」。
 *
 * ## 用户诉求（`2026-11-28`，#62）
 *
 * > 「表示状态的按钮，没有边框。没有表达出这是个按钮，可以点击和交互。」
 *
 * ⇒ 三条视觉硬约束：
 * 1. **有边框**（颜色 = 该状态的色相，不是灰边框）；
 * 2. **有按钮外形**（圆角 8px、内边距、两档高度 24 / 28）；
 * 3. **可点时有反馈**（hover 加深底色、`:focus-visible` 有 outline、后缀 `▾`）。
 *
 * ## 颜色不写字面量
 *
 * 一律引用 `WORKSPACE_CSS` 的 `--state-*-dot` / `--state-*-fg`。
 * 组件里出现 `#a855f7` 这种字面量 = 无法换主题、无法统一改。
 *
 * ## 上下文的尺寸微调
 *
 * `sm` / `md` 是两档**基准**。列表左侧那个 46px 正方形、科技树 78px 高的小卡
 * 是已定稿的紧凑容器 —— 它们只收紧高度 / 字号，**不改 class**：
 *
 * | 上下文 | 高度 | 理由 |
 * |---|---|---|
 * | 默认 `sm` | 24px | 任务书规定 |
 * | `.task-card__square` | 20px | 正方形只有 46px 宽、行高被列表密度约束 |
 * | `.tb3t-card` | 22px | 卡片固定 78px 高，要留出两行标题 |
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**。
 */
export const STATUS_BUTTON_CSS = `
/* ── StatusButton（#62 / #63）：圆点 + 文案 + 状态色边框 ── */
.tb3w-root .status-button{
  display:inline-flex;flex:0 0 auto;align-items:center;gap:5px;
  height:24px;padding:0 8px;
  border:1px solid var(--status-button-border,#cbd5e1);border-radius:8px;
  background:var(--bg-card,#fff);
  color:var(--text-secondary,#5f6673);
  font-family:inherit;font-size:11.5px;line-height:1;white-space:nowrap;text-align:left;
  transition:background .12s,border-color .12s;
}
.tb3w-root .status-button--md{height:28px;padding:0 9px;font-size:12px}
.tb3w-root .status-button__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3w-root .status-button__caret{flex:0 0 auto;font-size:9px;line-height:1;color:var(--text-weak,#9aa1ad)}
.tb3w-root .status-button.is-static{cursor:default}
.tb3w-root .status-button.is-interactive{cursor:pointer}
.tb3w-root .status-button.is-interactive:hover{background:var(--bg-hover,#eef1f5)}
.tb3w-root .status-button.is-interactive:active{background:var(--border,#e7e9ee)}
.tb3w-root .status-button:focus-visible{outline:2px solid var(--accent,#2563eb);outline-offset:1px}
/* 九个状态一个档位：边框 = 状态色（和圆点同源） */
.tb3w-root .status-button--unspecified{--status-button-border:var(--state-unspecified-dot,#9ca3af)}
.tb3w-root .status-button--submitted{--status-button-border:var(--state-submitted-dot,#111827)}
.tb3w-root .status-button--working{--status-button-border:var(--state-working-dot,#06b6d4)}
.tb3w-root .status-button--inputRequired{--status-button-border:var(--state-inputRequired-dot,#eab308)}
.tb3w-root .status-button--authRequired{--status-button-border:var(--state-authRequired-dot,#a855f7)}
.tb3w-root .status-button--completed{--status-button-border:var(--state-completed-dot,#10b981)}
.tb3w-root .status-button--failed{--status-button-border:var(--state-failed-dot,#ef4444)}
.tb3w-root .status-button--canceled{--status-button-border:var(--state-canceled-dot,#92400e)}
.tb3w-root .status-button--rejected{--status-button-border:var(--state-rejected-dot,#f97316)}
/* 上下文收紧（不改 class，只改尺寸 —— 见文件头） */
.tb3w-root .task-card__square .status-button{align-self:flex-start;height:20px;padding:0 5px;gap:3px;border-radius:5px;font-size:9px}
.tb3w-root .tb3t-card .status-button{height:22px;padding:0 6px;gap:3px;border-radius:6px;font-size:9px}
`;
