/**
 * 章节外壳 + 章节内容控件的**唯一一套 CSS** —— 服务 `SectionShell.tsx`。
 *
 * ## 为什么单列一个文件（而不是并进 CREATE_CSS / SECTION_CSS）
 *
 * issue #59 / #60 的根因就是「两套 CSS」：
 *
 * ```
 * 建卡页   .tb3cc-sec* / .tb3cc-ask*（后者只有类名，零规则）
 * 详情页   .section-block* / .ask-*（包在 .tb3w-root 作用域里）
 * ```
 *
 * ⇒ 现在三处共用本文件：建卡 / 详情未终结 / 详情终结。
 *   **建卡页那套 `.tb3cc-sec*` 的裸 input 样式已经删掉，不是被覆盖。**
 *
 * ## 为什么这里**不**加 `.tb3w-root` 作用域
 *
 * 建卡页在产品里虽然挂在 `.tb3w-root` 下，但它在预览里（以及将来可能的
 * 独立入口）是**脱离工作区根节点**渲染的。加作用域会重演「建卡页没样式」。
 * 类名全部带 `tb3-sec` / `tb3-ask` 前缀，已经足够避免和宿主相撞
 * （与 `.tb3cc-` / `.tb3d-` 同一策略）。
 *
 * 因此颜色变量写成 `var(--border, 兜底)` 的形式：
 *
 * - 在 `.tb3w-root` 里 ⇒ 用工作区的主题变量
 * - 在建卡页 / 预览顶部 ⇒ 用兜底值
 *
 * ⇒ **同一个元素在三处的 padding / border-radius / font-size / margin 完全相等**
 *   （它们都是本文件里的字面量，不依赖任何宿主变量）。这条由
 *   `dev/preview/carddetail/verify.mjs` 的三处计算值对比钉住。
 *
 * ## ask 的编辑态与交互态是同一套类
 *
 * `.tb3-ask*` 同时服务 `AskSection`（交互/只读）和 `SectionEditorAsk`（建卡编辑）。
 * 编辑态只是把文本换成 `<input class="tb3-ask__input">`，盒子大小 / 圆角 / 字号
 * 全部来自下面的同一组规则。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（TS1005）。
 */
export const SECTION_SHELL_CSS = `
/* ══════════════════════════════════════════════════════════
   ① 章节外壳（三处唯一）
   ══════════════════════════════════════════════════════════ */
.tb3-sec{display:flex;flex-direction:column;min-width:0;margin:0;padding:0;border:1px solid var(--border,#e7e9ee);border-radius:10px;background:var(--bg-card,#fff);color:var(--text,#16181d);font-size:12.5px;line-height:1.65;overflow:hidden}
/* 整章可点（详情里 text / markdown 的「点这一章去编辑」）—— 交互反馈，不是 mode 的视觉差异 */
.tb3-sec.is-editable{cursor:pointer;transition:border-color .12s,background .12s}
.tb3-sec.is-editable:hover{border-color:var(--accent,#2563eb);background:#f8fbff}
.tb3-sec.has-error{border-color:#f0a8a8}
/*
 * readonly 只改**可交互性**：光标、可选择。
 * ⚠ 这里不许写 padding / border-radius / font-size / margin / background / color
 *   —— 否则「三种 mode 不影响视觉」就假了。由 SSR 断言钉住。
 */
.tb3-sec--readonly{cursor:default;user-select:text}

.tb3-sec__head{display:flex;align-items:center;gap:8px;min-width:0;margin:0;padding:9px 13px;background:var(--bg-soft,#fafbfc);border-bottom:1px solid var(--border,#e7e9ee)}
.tb3-sec__index{display:flex;flex:0 0 auto;align-items:center;justify-content:center;width:19px;height:19px;margin:0;padding:0;border-radius:50%;background:var(--bg-hover,#f1f3f6);color:var(--text-secondary,#5f6673);font-size:11px;font-weight:700;line-height:1}
.tb3-sec__title{flex:1 1 auto;min-width:0;margin:0;padding:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text,#16181d);font-size:12.5px;font-weight:600}
/* 类型徽章（详情）/ 类型选择控件（建卡）共用同一个盒子。
   ⚠ 不写 margin-left:auto —— auto 的计算值随可用宽度变，三处比出来会不等。
   右对齐靠上面的 title 吃满剩余宽度。 */
.tb3-sec__type{display:inline-flex;flex:0 0 auto;align-items:center;gap:4px;margin:0;padding:1px 8px;border-radius:999px;background:var(--bg-hover,#f1f3f6);color:var(--text-secondary,#5f6673);font-size:11px;line-height:1.5;white-space:nowrap}
.tb3-sec__type-name{flex:0 0 auto;font-size:11px;color:var(--text-secondary,#5f6673);white-space:nowrap}
.tb3-sec__type-select{padding:0;border:0;border-radius:0;background:none;color:inherit;font-family:inherit;font-size:11px;line-height:1.5;outline:none;cursor:pointer}
.tb3-sec__type-select:focus{color:var(--accent,#2563eb)}
.tb3-sec__hint{margin:0;padding:8px 13px 0;color:var(--text-weak,#9aa1ad);font-size:11px;line-height:1.55}
.tb3-sec__body{display:flex;flex-direction:column;gap:8px;min-width:0;margin:0;padding:10px 12px}
.tb3-sec__error{margin:0;padding:7px 13px;border-top:1px solid #f7d4d4;background:#fdf2f2;color:#b91c1c;font-size:12px;line-height:1.55}

/* ── text / markdown 的正文控件（编辑态与详情态同源） ── */
.tb3-sec__field{display:flex;flex-direction:column;gap:6px;min-width:0;margin:0}
.tb3-sec__textarea{width:100%;box-sizing:border-box;margin:0;padding:7px 9px;border:1px solid var(--border-strong,#d7dbe2);border-radius:6px;background:#fff;color:var(--text,#16181d);font-family:inherit;font-size:12.5px;line-height:1.7;resize:vertical}
.tb3-sec__textarea:focus{outline:none;border-color:var(--accent,#2563eb)}
.tb3-sec__textarea.is-readonly{background:#fafbfc;border-color:var(--border,#e7e9ee);color:var(--text-secondary,#5f6673);cursor:default}
.tb3-sec__textarea.is-mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
.tb3-sec__text{margin:0;color:var(--text,#16181d);font-size:12.5px;line-height:1.75;white-space:pre-wrap;word-break:break-word}
.tb3-sec__placeholder{margin:0;color:var(--text-weak,#9aa1ad);font-size:12.5px;font-style:italic;line-height:1.7}
.tb3-sec__decl{margin:0;padding:5px 9px;border:1px dashed var(--border-strong,#d7dbe2);border-radius:6px;background:#fafbfc}
.tb3-sec__decl summary{cursor:pointer;font-size:11px;color:var(--text-secondary,#5f6673)}
.tb3-sec__decl-input{width:100%;box-sizing:border-box;margin:5px 0 0;padding:5px 8px;border:1px solid var(--border-strong,#d7dbe2);border-radius:5px;background:#fff;color:var(--text,#16181d);font-family:inherit;font-size:11.5px;line-height:1.6}
.tb3-sec__actions{display:flex;gap:6px;margin:0}
.tb3-sec__unknown{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0;margin:0}

/* ══════════════════════════════════════════════════════════
   ② ask —— 交互态 / 只读态 / 建卡编辑态共用这一套
   ══════════════════════════════════════════════════════════ */
.tb3-ask{display:flex;flex-direction:column;min-width:0;margin:0;padding:0;color:var(--text,#16181d);font-size:12.5px;line-height:1.65}
/* 左侧 12px 内边距恒定（不随状态变），竖线用 ::before 画在 left:0 ⇒ 零位移 */
.tb3-ask__group{position:relative;min-width:0;margin:0;padding:0 0 0 12px}
.tb3-ask__group + .tb3-ask__group{margin-top:14px;padding-top:12px;border-top:1px dashed var(--border,#e7e9ee)}
.tb3-ask__group[data-ask-active='true']::before{content:"";position:absolute;top:0;bottom:0;left:0;width:3px;border-radius:2px;background:var(--accent,#2563eb)}

/* 问题行：问题 + 灰字 header + 状态按钮/徽章 */
.tb3-ask__qrow{display:flex;align-items:center;gap:8px;min-width:0;margin:0 0 6px;padding:0}
.tb3-ask__question{flex:1 1 auto;min-width:0;margin:0;padding:0;border:0;background:none;color:var(--text,#16181d);font-family:inherit;font-size:12.5px;font-weight:600;line-height:1.5}
.tb3-ask__question--input{width:100%;box-sizing:border-box;outline:none}
.tb3-ask__question--input:focus{background:#f8fbff}
.tb3-ask__header{flex:0 0 auto;margin:0;padding:0;border:0;background:none;color:var(--text-weak,#9aa1ad);font-family:inherit;font-size:10.5px;line-height:1.5}
.tb3-ask__state-btn{flex:0 0 auto;margin:0;padding:1px 8px;border:1px solid var(--border-strong,#c5ccd6);border-radius:5px;background:transparent;color:var(--text-secondary,#5f6673);font-family:inherit;font-size:10.5px;line-height:1.6;cursor:pointer}
.tb3-ask__state-btn:hover{color:var(--accent,#2563eb);border-color:var(--accent,#2563eb)}
.tb3-ask__state-btn.is-on{color:var(--accent,#2563eb);background:transparent;box-shadow:inset 0 0 0 1.5px var(--accent,#2563eb)}
/* 只读结果徽标（未选择 / 都不要 / 已选） */
.tb3-ask__state-text{display:inline-block;flex:0 0 auto;margin:0;padding:1px 8px;border-radius:999px;background:#f1f3f6;color:var(--text-secondary,#5f6673);font-family:var(--font-mono,ui-monospace,Consolas,monospace);font-size:10.5px;line-height:1.6}
.tb3-ask__group[data-ask-state='unset'] .tb3-ask__state-text{border:1px solid var(--border-strong,#c5ccd6);background:transparent;color:var(--text-weak,#9aa1ad)}

/* 选项列表 */
.tb3-ask__options{display:flex;flex-direction:column;gap:4px;min-width:0;margin:0;padding:0}
.tb3-ask__option{display:flex;align-items:flex-start;gap:7px;width:100%;min-width:0;margin:0;padding:6px 9px;border:1px solid var(--border,#e7e9ee);border-radius:7px;background:var(--bg-card,#fff);color:var(--text,#16181d);font-family:inherit;font-size:12.5px;line-height:1.5;text-align:left;cursor:pointer;transition:border-color .12s,background .12s}
.tb3-ask__option:hover{border-color:#93c5fd;background:#f8fbff}
.tb3-ask__option.is-picked{border-color:var(--accent,#2563eb);background:#eff6ff}
/* 只读：未选中降级成一行（去边框、透明底、弱化文字）；选中保留边框 + 淡蓝底 */
.tb3-ask__option.is-readonly{cursor:default;border-color:transparent;background:transparent;color:var(--text-weak,#9aa1ad)}
.tb3-ask__option.is-readonly .tb3-ask__option-desc{color:var(--text-weak,#9aa1ad);opacity:.75}
.tb3-ask__option.is-readonly.is-picked{border-color:var(--accent,#2563eb);background:#eff6ff;color:var(--text,#16181d)}
.tb3-ask__option.is-readonly.is-picked .tb3-ask__option-desc{color:var(--text-secondary,#5f6673);opacity:1}
.tb3-ask__option.is-readonly:hover{border-color:var(--border,#e7e9ee);background:var(--bg-card,#fff)}
.tb3-ask__option.is-readonly.is-picked:hover{border-color:var(--accent,#2563eb);background:#eff6ff}
.tb3-ask__option.is-readonly.is-picked{position:relative}
.tb3-ask__option.is-readonly.is-picked::before{content:"";position:absolute;top:0;bottom:0;left:0;width:3px;border-radius:7px 0 0 7px;background:var(--accent,#2563eb)}

/* 标记：单选圆圈 / 多选方框 / 冻结勾 / 编辑态序号 */
.tb3-ask__mark{flex:0 0 12px;margin:0;padding:0;color:var(--accent,#2563eb);font-weight:700;line-height:1.5}
.tb3-ask__mark--box{flex:0 0 14px;width:14px;height:14px;box-sizing:border-box;margin:2px 0 0;border:1.5px solid var(--border-strong,#c5ccd6);border-radius:50%;background:#fff}
.tb3-ask__mark--box[data-multi='true']{border-radius:3px}
.tb3-ask__option.is-picked .tb3-ask__mark--box{position:relative;border-color:var(--accent,#2563eb);background:#fff}
.tb3-ask__option.is-picked .tb3-ask__mark--box::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--accent,#2563eb)}
.tb3-ask__option.is-picked .tb3-ask__mark--box[data-multi='true']::after{border-radius:1px}
.tb3-ask__mark--check{flex:0 0 14px;width:14px;color:var(--accent,#2563eb);font-weight:700;line-height:14px;text-align:center}
.tb3-ask__mark--num{display:flex;flex:0 0 14px;align-items:center;justify-content:center;width:14px;height:14px;margin:1px 0 0;border-radius:50%;background:#f1f3f6;color:var(--text-secondary,#5f6673);font-size:10px;font-weight:700;line-height:1}

.tb3-ask__option-body{display:flex;flex:1 1 auto;flex-direction:column;gap:1px;min-width:0;margin:0;padding:0}
.tb3-ask__option-label{width:100%;box-sizing:border-box;margin:0;padding:0;border:0;background:none;color:inherit;font-family:inherit;font-size:12.5px;font-weight:500;line-height:1.5}
.tb3-ask__option-desc{width:100%;box-sizing:border-box;margin:0;padding:0;border:0;background:none;color:var(--text-secondary,#5f6673);font-family:inherit;font-size:11px;line-height:1.6}

/* 编辑态输入：去掉浏览器默认边框/内边距，盒子由上面那几行决定 */
.tb3-ask__input{display:block;outline:none}
.tb3-ask__input:focus{background:#f8fbff}
.tb3-ask__option-del{flex:0 0 auto;margin:0;padding:0 2px;border:0;border-radius:4px;background:none;color:var(--text-weak,#9aa1ad);font-family:inherit;font-size:13px;line-height:1.5;cursor:pointer}
.tb3-ask__option-del:hover{color:#dc2626}

/* 自填行：交互态是「自己填：+ 输入框」，编辑态是「灰字提示 + 输入框」——同一个盒子 */
.tb3-ask__option--custom{align-items:center;cursor:default}
.tb3-ask__custom-label{flex:0 0 auto;margin:0;padding:0;border:0;background:none;color:var(--text-secondary,#5f6673);font:inherit;font-size:12px;cursor:pointer}
.tb3-ask__custom-label:hover{color:var(--accent,#2563eb)}
.tb3-ask__custom{flex:1 1 auto;min-width:0;box-sizing:border-box;margin:0;padding:4px 9px;border:1px dashed var(--border-strong,#c5ccd6);border-radius:6px;background:#fafbfc;color:var(--text,#16181d);font-family:inherit;font-size:12px;line-height:1.5}
.tb3-ask__custom:focus{outline:none;border-color:var(--accent,#2563eb)}

/* 组尾：单选/多选、添加选项/问题组、删除这组 */
.tb3-ask__actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;margin:9px 0 0;padding:9px 0 0;border-top:1px dashed #f0f2f6}
.tb3-ask__radio{display:inline-flex;align-items:center;gap:4px;color:var(--text-secondary,#5f6673);font-size:11.5px;line-height:1.5;white-space:nowrap;cursor:pointer}
.tb3-ask__radio input{margin:0}
.tb3-ask__field-label{flex:0 0 auto;margin:0;padding:0;color:var(--text-secondary,#5f6673);font-size:11px;line-height:1.5;white-space:nowrap}
.tb3-ask__add-option,.tb3-ask__add-group{align-self:flex-start;margin:0;padding:4px 10px;border:1px dashed var(--border-strong,#c5ccd6);border-radius:6px;background:transparent;color:var(--text-secondary,#5f6673);font-family:inherit;font-size:11.5px;line-height:1.5;cursor:pointer}
.tb3-ask__add-option:hover,.tb3-ask__add-group:hover{border-color:var(--accent,#2563eb);color:var(--accent,#2563eb)}
.tb3-ask__add-group{margin-top:12px}
/* 编辑态（建卡）：行不假装可点，hover 不变色（控件在 input 里） */
.tb3-ask[data-ask-edit='1'] .tb3-ask__option{cursor:default}
.tb3-ask[data-ask-edit='1'] .tb3-ask__option:hover{border-color:var(--border,#e7e9ee);background:var(--bg-card,#fff)}
`;
