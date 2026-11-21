/**
 * 科技树的样式 —— 前缀 `tb3t-`（唯一，不跟 `tb3-*` / `tb3cc-*` / `tb3w-*` 混）。
 *
 * ## ⚠ 为什么单独一个 `.ts` 文件
 *
 * CSS 是**纯字符串**，但它得被两处用：
 *
 * ```
 * src/renderers/TechTree.tsx   ← 组件自己 injectTechTreeStyles() 时用
 * src/styles.ts                ← 产品注入 injectStyles() 时拼进去
 * ```
 *
 * 而 `styles.ts` **不能 import `.tsx`**：`node --test` 直接跑 TS 源码（规则 6），
 * Node 的类型剥离只认 `.ts`，import `.tsx` 会抛 `ERR_UNKNOWN_FILE_EXTENSION` ——
 * `test/create-layout.test.ts` 从 `styles.ts` import `CREATE_CSS`，
 * 一旦 `styles.ts` import 了 `.tsx`，整个测试文件就挂。
 *
 * 所以曾经是**两份复制**（`styles.ts` 一份、`TechTree.tsx` 一份），
 * 靠人肉保证一致 —— 那是本仓库明令禁止的形态（AGENTS 3.6：改动不能被测试发现）。
 *
 * 现在两份都从这里 import ⇒ **物理上不可能漂移**。
 *
 * ## ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**
 */
export const TECHTREE_CSS = `
/* ── 根：填满父容器；画布滚动，页脚常驻 ── */
.tb3t-root{display:flex;flex-direction:column;height:100%;min-height:0;background:transparent;color:var(--text,#16181d);font-size:12px;line-height:1.5}
.tb3t-scroll{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;position:relative}
.tb3t-stage{position:relative;flex:0 0 auto}

/* ── 列背景 + 列头 ── */
.tb3t-band{position:absolute;border-radius:12px;background:var(--bg-soft,#f9fafb);pointer-events:none}
.tb3t-band__title{position:absolute;left:0;right:0;top:9px;text-align:center;font-size:11.5px;font-weight:600;color:var(--text-weak,#9ca3af);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── 线层 ── */
.tb3t-links{position:absolute;left:0;pointer-events:none;overflow:visible}
.tb3t-edge{fill:none;stroke-width:2;stroke-linecap:round;stroke:#5b6472;transition:opacity .12s ease,stroke-width .12s ease}
.tb3t-edge--derives{stroke:#5b6472}
.tb3t-edge--dependsOn{stroke:#a16207}
.tb3t-edge--supersedes{stroke:#6d28d9}
.tb3t-edge--constrains{stroke:#b91c1c}
.tb3t-edge--related{stroke:#15803d;stroke-dasharray:4 3}
.tb3t-edge--references{stroke:#6b7280;stroke-dasharray:4 3}
/* 用户 2026-11-19：hover 时无关的边淡到 25% */
.tb3t-edge.is-dim{opacity:0.25}
/* 相连的边：加粗 + 加深（光晕单独一层） */
.tb3t-edge.is-active{stroke-width:3;opacity:1}
.tb3t-edge-glow{fill:none;stroke-width:10;stroke-linecap:round;opacity:0.16;filter:blur(2px)}
.tb3t-edge-label{font-size:10px;font-weight:700;text-anchor:middle;paint-order:stroke;stroke:#ffffff;stroke-width:3.5;stroke-linejoin:round}
.tb3t-edge-label--derives{fill:#5b6472}
.tb3t-edge-label--dependsOn{fill:#a16207}
.tb3t-edge-label--supersedes{fill:#6d28d9}
.tb3t-edge-label--constrains{fill:#b91c1c}
.tb3t-edge-label--related{fill:#15803d}
.tb3t-edge-label--references{fill:#6b7280}

/* ── 箭头（尖端贴目标卡边：refX=9 让三角形顶点正好落在路径终点） ── */
.tb3t-arrow path{stroke:none}
.tb3t-arrow--derives path{fill:#5b6472}
.tb3t-arrow--dependsOn path{fill:#a16207}
.tb3t-arrow--supersedes path{fill:#6d28d9}
.tb3t-arrow--constrains path{fill:#b91c1c}
.tb3t-arrow--related path{fill:#15803d}
.tb3t-arrow--references path{fill:#6b7280}

/* ── 卡片 ── */
.tb3t-card{position:absolute;display:flex;flex-direction:column;gap:3px;padding:8px 9px;border:2px solid var(--card-border,#9aa1ad);border-radius:10px;background:var(--bg-card,#fff);color:inherit;font-family:inherit;text-align:left;cursor:pointer;overflow:hidden;box-shadow:0 1px 2px rgb(15 23 42 / 7%);transition:border-color .12s,background .12s,box-shadow .12s}
.tb3t-card:hover{background:#fbfcfe;border-color:#cbd5e1}
.tb3t-card.is-selected{border-color:var(--accent,#2563eb);box-shadow:0 0 0 4px rgb(37 99 235 / 16%),0 1px 2px rgb(15 23 42 / 7%)}
/* 草稿：无可见边框，但保留 2px 占位（用户 2026-11-10：草稿无边框） */
.tb3t-card.is-draft{border-color:transparent;box-shadow:none}
/* 用户 2026-11-21：用户未读=左，AI 未读=右（跟列表卡同一套判决）*/
.tb3t-card.is-unread-user{border-left-width:4px;border-left-color:var(--warn,#d97706)}
.tb3t-card.is-unread-ai{border-right-width:4px;border-right-color:var(--accent,#2563eb)}
.tb3t-card.is-draft:hover{border-color:var(--card-border,#9aa1ad)}
.tb3t-card.is-draft.is-selected{border-color:var(--accent,#2563eb)}
.tb3t-card__top{display:flex;align-items:center;gap:4px;min-width:0;height:16px}
.tb3t-card__spacer{flex:1 1 auto;min-width:2px}
.tb3t-card__warn{flex:0 0 auto;color:#ef4444;font-size:9px;line-height:1}
.tb3t-card__title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:13px;font-weight:600;line-height:1.35;color:var(--text,#1f2328);word-break:break-word}
.tb3t-card .card-id{font-size:11px;flex:0 0 auto}
.tb3t-card .badge{flex:0 1 auto;min-width:0;max-width:76px;padding:0 4px;font-size:9.5px;line-height:1.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* StatusCell 在卡片里：圆点 + 中文名（用户：不只靠颜色） */
.tb3t-card .task-card__status{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;font-size:9px;color:var(--text-weak,#9aa1ad);white-space:nowrap}
.tb3t-card .task-card__status-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:42px}

/* ── 页脚：状态图例 + 布局警告 ── */
.tb3t-footer{flex:0 0 auto;display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px;padding:6px 12px;border-top:1px solid var(--border,#eef0f3);background:var(--bg-soft,#fafbfc);font-size:11px;color:var(--text-secondary,#6b7280)}
.tb3t-footer__states{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;min-width:0}
.tb3t-footer__label{color:var(--text-weak,#9ca3af)}
.tb3t-footer__state{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.tb3t-footer__warn{margin-left:auto;color:var(--text-weak,#9aa1ad);white-space:nowrap}
.tb3t-footer__warn.has-warning{color:#b45309}

/* ── 空态 ── */
.tb3t-empty{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:40px 16px;color:var(--text-weak,#9aa1ad);font-size:12.5px;text-align:center}

/* ── 关系图例（工具栏里用） ── */
.tb3t-legend{display:flex;align-items:center;flex-wrap:wrap;gap:2px 12px;font-size:11px;color:var(--text-secondary,#5f6673)}
.tb3t-legend__item{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.tb3t-legend__item[data-rel="derives"]{color:#5b6472}
.tb3t-legend__item[data-rel="dependsOn"]{color:#a16207}
.tb3t-legend__item[data-rel="supersedes"]{color:#6d28d9}
.tb3t-legend__item[data-rel="constrains"]{color:#b91c1c}
.tb3t-legend__item[data-rel="related"]{color:#15803d}
.tb3t-legend__item[data-rel="references"]{color:#6b7280}
.tb3t-legend__svg{flex:0 0 auto;display:block;overflow:visible}
.tb3t-legend__path{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.tb3t-legend__head{fill:currentColor;stroke:none}
.tb3t-legend__item[data-rel="related"] .tb3t-legend__path{stroke-dasharray:4 3}
.tb3t-legend__item[data-rel="references"] .tb3t-legend__path{stroke-dasharray:4 3}
`;
