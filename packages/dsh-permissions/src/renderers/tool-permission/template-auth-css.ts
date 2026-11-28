/**
 * 「模板授权」页的样式（前缀 `tb3ta-`，和其它页不共享类名）。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**。
 *
 * ## 折叠（issue #56）
 *
 * 折叠组件的壳 / 两态 / 矩形都在 `@taskboard/dsh-client/fold-pill` 的
 * `FOLD_PILL_CSS` 里（与科技树**同一份**），本文件只负责「在左栏里怎么摆」：
 * 胶囊与矩形**同宽**（都撑满左栏），矩形内的内容留 6px 内边距。
 */
export const TEMPLATE_AUTH_CSS = `
/* ── 页面骨架：左栏固定宽 + 右栏吃剩余 ── */
.tb3ta-page{display:flex;gap:10px;height:100%;min-height:0;padding:2px}
.tb3ta-side{flex:0 0 252px;display:flex;flex-direction:column;min-height:0;overflow:auto;padding:8px 8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#fff}
.tb3ta-main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid #e5e7eb;border-radius:10px;background:#fff;overflow:hidden}
.tb3ta-scroll{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain}

/* ── 左栏：折叠容器 ── */
.tb3ta-fold{display:flex;flex-direction:column;flex:0 0 auto}
.tb3ta-fold + .tb3ta-fold{margin-top:6px}
/* 授权页在页面头之下，吃掉剩余高度（否则 height:100% 会把头部高度算重） */
.tb3g-root > .tb3ta-page{flex:1 1 auto;min-height:0}
/* 胶囊与矩形同宽（都撑满左栏）—— 用户要求矩形左右宽对齐胶囊 */
.tb3ta-fold > .tb3-fold-pill{width:100%}
.tb3ta-fold > .tb3-fold-rect{width:100%;padding-left:6px;padding-right:6px;padding-bottom:6px}
/* 选中的档位 / 模板 ⇒ 那一节的胶囊也标出来（仅靠行内高亮时，收起后看不出选了什么） */
.tb3ta-fold > .tb3-fold-pill[data-tone="selected"]{border-color:#2563eb;background:#e8f0fe;color:#1d4ed8}
.tb3ta-fold--domain{margin:2px 0}

/* ── 左栏：档位 / 领域 / 模板行 ── */
.tb3ta-tiers{display:flex;flex-direction:column;gap:2px;padding:2px 0}
.tb3ta-domain{display:flex;flex-direction:column;gap:1px;padding:2px 0 0}
.tb3ta-tpl{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:5px 9px;border:0;background:transparent;color:#1f2328;font-family:inherit;font-size:12px;text-align:left;cursor:pointer;border-radius:6px}
.tb3ta-tpl:hover{background:#f6f8fb}
/*
 * 选中态（issue #57）：左侧竖条 + 底色 + 加粗。
 * 「点了一个也看不出选没选中」是 issue 的原话 ⇒ 三样都给上，不靠单一线索。
 */
.tb3ta-tpl.is-picked{background:#e8f0fe;color:#1d4ed8;font-weight:700;box-shadow:inset 3px 0 0 #2563eb}
.tb3ta-tpl:focus-visible{outline:2px solid #2563eb;outline-offset:-1px}
.tb3ta-tpl__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tb3ta-tpl__count{flex:0 0 auto;min-width:20px;padding:0 5px;border-radius:9px;background:#f1f3f7;color:#6b7280;font-size:10.5px;line-height:16px;text-align:center;font-variant-numeric:tabular-nums}
.tb3ta-tpl.is-picked .tb3ta-tpl__count{background:#c7ddff;color:#1d4ed8}
.tb3ta-tpl--tier{font-weight:600}
.tb3ta-tpl--tier .tb3ta-tpl__name::before{content:'';display:inline-block;width:6px;height:6px;margin-right:7px;border-radius:2px;background:#a78bfa;vertical-align:middle}

/* ── 右栏头部 ── */
.tb3ta-head{flex:0 0 auto;padding:9px 12px;border-bottom:1px solid #eef1f5}
.tb3ta-head__title{display:flex;align-items:baseline;gap:8px;min-width:0}
.tb3ta-head__domain{flex:0 0 auto;padding:0 6px;border-radius:5px;background:#f1f3f7;color:#6b7280;font-size:10.5px;line-height:16px}
.tb3ta-head__name{font-size:13px;font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3ta-head__ref{flex:0 0 auto;color:#9ca3af;font-size:10.5px}
.tb3ta-head__edit{margin-left:auto;flex:0 0 auto}
.tb3ta-head__sum{margin:5px 0 0;color:#6b7280;font-size:11.5px}
.tb3ta-head__sum b{color:#111827;font-variant-numeric:tabular-nums}
/* 模板详情里「其中 N 个来自全局档位」那一行（全局档位不在这里逐段列） */
.tb3ta-head__global{margin:3px 0 0;color:#7c6bb0;font-size:11px;line-height:1.6}
.tb3ta-head__global b{color:#5b21b6;font-variant-numeric:tabular-nums}
/* 不能编辑时的原因（issue #57：必须说清为什么） */
.tb3ta-readonly{margin:5px 0 0;color:#b45309;font-size:11.5px;line-height:1.6}

/* ── 来源分段 ── */
.tb3ta-sec{padding:8px 12px;border-bottom:1px solid #f3f5f8}
.tb3ta-sec:last-of-type{border-bottom:0}
.tb3ta-sec__head{display:flex;align-items:center;gap:8px}
.tb3ta-sec__name{font-size:12px;font-weight:600;color:#374151}
.tb3ta-sec__count{min-width:20px;padding:0 5px;border-radius:9px;background:#f1f3f7;color:#6b7280;font-size:10.5px;line-height:16px;text-align:center;font-variant-numeric:tabular-nums}
.tb3ta-sec__lock{padding:0 6px;border-radius:5px;background:#f3f4f6;color:#6b7280;font-size:10px;line-height:16px}
.tb3ta-tools{display:flex;flex-wrap:wrap;gap:4px 6px;margin:6px 0 0;padding:0;list-style:none}
.tb3ta-tools__item{padding:1px 7px;border:1px solid #e5e7eb;border-radius:6px;background:#fbfcfe;color:#374151;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}

/* ── 编辑器（issue #57） ── */
.tb3ta-editor{flex:1 1 auto;display:flex;flex-direction:column;gap:8px;min-height:0;padding:10px 12px}
.tb3ta-editor__head{display:flex;flex-direction:column;gap:2px}
.tb3ta-editor__title{font-size:12.5px;font-weight:600;color:#111827}
.tb3ta-editor__hint{font-size:11px;color:#9ca3af}
.tb3ta-editor__list{flex:1 1 auto;min-height:0;overflow:auto;border:1px solid #eef1f5;border-radius:8px;padding:4px}
.tb3ta-editor__row{display:flex;align-items:center;gap:7px;padding:4px 7px;border-radius:6px;font-size:11.5px;cursor:pointer}
.tb3ta-editor__row:hover{background:#f7f9fc}
.tb3ta-editor__row.is-checked{background:#f0f7ff}
.tb3ta-editor__row.is-locked{opacity:.72;cursor:not-allowed}
.tb3ta-editor__row input{margin:0;accent-color:#2563eb}
.tb3ta-editor__name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.tb3ta-editor__tag{flex:0 0 auto;padding:0 5px;border-radius:5px;background:#f3f4f6;color:#6b7280;font-size:10px;line-height:15px}
.tb3ta-editor__foot{display:flex;align-items:center;gap:8px;padding-top:8px;border-top:1px solid #eef1f5}
.tb3ta-editor__foot .tb3g-btn--primary{margin-left:auto}

/* ── 状态块 ── */
.tb3ta-loading{margin:12px;color:#6b7280;font-size:12px}
.tb3ta-empty{margin:10px 8px;color:#9ca3af;font-size:11.5px}
.tb3ta-banner{margin:8px 12px;padding:6px 10px;border-radius:8px;font-size:11.5px;line-height:1.6;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
.tb3ta-banner--bad{background:#fef2f2;color:#b91c1c;border-color:#fecaca}
.tb3ta-foot{margin:12px;color:#9ca3af;font-size:11px;line-height:1.7}
.tb3ta-foot code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#6b7280}
`;
