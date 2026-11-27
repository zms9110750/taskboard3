/**
 * 「模板授权」页的样式（前缀 `tb3ta-`，和其它页不共享类名）。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**。
 */
export const TEMPLATE_AUTH_CSS = `
/* ── 页面骨架：左栏固定宽 + 右栏吃剩余 ── */
.tb3ta-page{display:flex;gap:10px;height:100%;min-height:0;padding:2px}
.tb3ta-side{flex:0 0 232px;display:flex;flex-direction:column;min-height:0;border:1px solid #e5e7eb;border-radius:10px;background:#fff;overflow:hidden}
.tb3ta-side__head{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #eef1f5;font-size:12px;font-weight:600;color:#374151}
.tb3ta-side__hint{font-weight:400;color:#9ca3af;font-size:11px}
.tb3ta-main{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid #e5e7eb;border-radius:10px;background:#fff;overflow:hidden}
.tb3ta-scroll{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain}

/* ── 左栏：领域 → 模板 ── */
.tb3ta-domain{padding:4px 0 6px}
.tb3ta-domain__title{padding:4px 10px;font-size:10.5px;font-weight:600;color:#9ca3af;letter-spacing:.04em}
.tb3ta-tpl{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:5px 10px;border:0;background:transparent;color:#1f2328;font-family:inherit;font-size:12px;text-align:left;cursor:pointer;border-radius:6px}
.tb3ta-tpl:hover{background:#f6f8fb}
.tb3ta-tpl.is-picked{background:#eff6ff;color:#1d4ed8;font-weight:600}
.tb3ta-tpl__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3ta-tpl__count{flex:0 0 auto;min-width:20px;padding:0 5px;border-radius:9px;background:#f1f3f7;color:#6b7280;font-size:10.5px;line-height:16px;text-align:center;font-variant-numeric:tabular-nums}
.tb3ta-tpl.is-picked .tb3ta-tpl__count{background:#dbeafe;color:#1d4ed8}

/* ── 左栏：全局档位（跟模板同一层级，用户 2026-11-24） ── */
.tb3ta-tiers{flex:0 0 auto;padding:4px 0 6px;border-bottom:1px solid #eef1f5}
.tb3ta-tpl--tier{font-weight:600}
.tb3ta-tpl--tier .tb3ta-tpl__name::before{content:'';display:inline-block;width:6px;height:6px;margin-right:7px;border-radius:2px;background:#a78bfa;vertical-align:middle}

/* ── 右栏头部 ── */
.tb3ta-head{flex:0 0 auto;padding:9px 12px;border-bottom:1px solid #eef1f5}
.tb3ta-head__title{display:flex;align-items:baseline;gap:8px;min-width:0}
.tb3ta-head__domain{flex:0 0 auto;padding:0 6px;border-radius:5px;background:#f1f3f7;color:#6b7280;font-size:10.5px;line-height:16px}
.tb3ta-head__name{font-size:13px;font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3ta-head__ref{flex:0 0 auto;color:#9ca3af;font-size:10.5px}
.tb3ta-head__sum{margin:5px 0 0;color:#6b7280;font-size:11.5px}
.tb3ta-head__sum b{color:#111827;font-variant-numeric:tabular-nums}
/* 模板详情里「其中 N 个来自全局档位」那一行（全局档位不在这里逐段列） */
.tb3ta-head__global{margin:3px 0 0;color:#7c6bb0;font-size:11px;line-height:1.6}
.tb3ta-head__global b{color:#5b21b6;font-variant-numeric:tabular-nums}

/* ── 来源分段 ── */
.tb3ta-sec{padding:8px 12px;border-bottom:1px solid #f3f5f8}
.tb3ta-sec:last-of-type{border-bottom:0}
.tb3ta-sec__head{display:flex;align-items:center;gap:8px}
.tb3ta-sec__name{font-size:12px;font-weight:600;color:#374151}
.tb3ta-sec__count{min-width:20px;padding:0 5px;border-radius:9px;background:#f1f3f7;color:#6b7280;font-size:10.5px;line-height:16px;text-align:center;font-variant-numeric:tabular-nums}
.tb3ta-sec__lock{padding:0 6px;border-radius:5px;background:#f3f4f6;color:#6b7280;font-size:10px;line-height:16px}
.tb3ta-tools{display:flex;flex-wrap:wrap;gap:4px 6px;margin:6px 0 0;padding:0;list-style:none}
.tb3ta-tools__item{padding:1px 7px;border:1px solid #e5e7eb;border-radius:6px;background:#fbfcfe;color:#374151;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}

/* ── 状态块 ── */
.tb3ta-loading{margin:12px;color:#6b7280;font-size:12px}
.tb3ta-empty{margin:12px;color:#9ca3af;font-size:12px}
.tb3ta-banner{margin:10px 12px;padding:6px 10px;border-radius:8px;font-size:11.5px;line-height:1.6;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
.tb3ta-banner--bad{background:#fef2f2;color:#b91c1c;border-color:#fecaca}
.tb3ta-foot{margin:12px;color:#9ca3af;font-size:11px;line-height:1.7}
.tb3ta-foot code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#6b7280}
`;
