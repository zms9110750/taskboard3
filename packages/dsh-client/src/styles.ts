/**
 * 样式 —— **一个 CSS 字符串，运行时注入一次**。
 *
 * ## 为什么不用 `.css` 文件 + CSS Modules
 *
 * DSH 的客户端插件产物必须是**一个** JS 文件（`lib/client.js`）。
 * 用 `.css` 文件会：
 *   · 让 bundler 产出独立的 `style.css`（宿主的模块加载器不会去取它）；
 *   · 需要 `@tsdown/css` 插件 + CSS Modules 类型声明 + 额外的构建复杂度。
 *
 * ⇒ 把 CSS 写成 TS 字符串常量，在 `apply()` 里插一个 `<style>`。
 *   产物仍然是一个 JS，零额外依赖，也顺便满足「纯 TS」的要求。
 *
 * ## 颜色全部走宿主主题 token
 *
 * `--dsw-alias-*` 由宿主主题插件写在 `body` 上；浅色/深色切换自动跟随。
 * **本文件不出现任何字面色值**（除了 `rgb(0 0 0 / 20%)` 的阴影，
 * 它在两套主题下都成立）。
 *
 * ## 类名前缀
 *
 * 全部带 `tb3-` 前缀，避免与宿主或其他插件的类名相撞。
 */

/** 注入用的 `<style>` 元素的 id（重复注入时用它去重）。 */
export const STYLE_ID = 'taskboard3-styles';


/*
 * 降级块的样式（`.missing-renderer` / `.json-fallback`）。
 *
 * 用户 2026-11-22 的裁决：「降级的渲染器应该是组件」「CSS 要能抽出来改」。
 * ⇒ 那段 CSS 放在组件目录下，本文件只 import + 拼进 injectStyles()。
 *   同一个形态见 searchbox-css / section-css / create-css / drawer-css。
 */
import { FALLBACK_CSS } from './renderers/fallback-css.ts';
/* 建卡页的 CSS 真值放在 renderers/create/create-css.ts —— 用户要求「CSS 跟着组件走」。 */
import { CREATE_CSS } from './renderers/create/create-css.ts';
/* 建卡流程的外壳（tb3w-create，作用域是工作区而不是建卡页）—— 同一个形态。 */
import { CREATE_SHELL_CSS } from './renderers/create/create-shell-css.ts';

/*
 * 建卡页的样式（`tb3cc-*`）搬到 ./renderers/create/create-css.ts —— 用户 2026-11-22
 * 「CSS 必须跟着组件走」。本文件只 import 同一份，再拼进 injectStyles()。
 * 同一个形态见 searchbox-css / section-css / fallback-css。
 */


/**
 * 工作区（V3）的样式 —— 前缀 `tb3w-`。
 *
 * ## 它为什么单独一段
 *
 * 这是**拼装层**：六个已定稿组件（SpaceBar / FilterRow+FilterBox / CardRow /
 * CardDetail / StatusMenu）的 CSS 原本只存在于各自的 `dev/preview/<组件>/style.css`
 * 里。V3 是第一个**产品级**页面，所以在这里收口成一份：
 *
 * | 来源 | 类名 | 作用域 |
 * |---|---|---|
 * | 各组件的 preview CSS | `.space-bar` / `.filter-box` / `.task-card` / `.detail` / `.menu` … | 全部包在 `.tb3w-root` 下 |
 * | StatusMenu 的浮层 | `.menu*` | 它 portal 到 `body` ⇒ 用 `[data-menu="status"]` 作用域 |
 * | 本组件（拼装）| `.tb3w-*` | 新前缀，不跟 `tb3-*` / `tb3cc-*` 混 |
 *
 * ⚠ **组件类名保持原样、只加作用域前缀** —— 已定稿组件的 DOM 是它们的
 *   preview 验收过的，改类名等于让那些 CDP 断言失去意义。
 *
 * ## 颜色全走宿主 token + 兜底色
 *
 * 和 `CREATE_CSS` 同一手法：`var(--dsw-alias-*, 兜底)`。预览里没有宿主
 * token ⇒ 用兜底色，也就是设计图上的那套颜色。
 *
 * ⚠ 本文件是模板字符串 —— 注释里**不能出现反引号**（会提前结束字符串）。
 */
export const WORKSPACE_CSS = `
/* ══════════════════════════════════════════════════════════
   0. 令牌 + 盒模型
   ══════════════════════════════════════════════════════════ */

.tb3w-root, [data-menu="status"] {
  --bg: var(--dsw-alias-bg-secondary, #f5f7fa);
  --bg-card: var(--dsw-alias-bg-primary, #fff);
  --bg-soft: var(--dsw-alias-bg-secondary, #fafbfc);
  --bg-hover: var(--dsw-alias-bg-hover, #f3f4f6);
  --border: var(--dsw-alias-border-secondary, #e7e9ee);
  --border-strong: var(--dsw-alias-border-primary, #d7dbe2);
	/*
	 * 卡片 / 列表行的边框 —— 比 --border-strong 深一档。
	 * 用户 2026-11-21：先加深（草稿的无边框才看得出来）；
	 * 具体色值 / 要不要跟状态色同步，他之后定。
	 */
	--card-border: #9aa1ad;
  --text: var(--dsw-alias-text-primary, #16181d);
  --text-secondary: var(--dsw-alias-text-secondary, #5f6673);
  --text-weak: var(--dsw-alias-text-tertiary, #9aa1ad);
  /*
   * 强调色 = **品牌蓝**。用户 2026-11-20 修正：
   * 「改为用蓝色主题的。我让你用黑色是一些东西黑底白字。
   *   你把面包屑做成黑色加粗字。这哪看的清他是可选的。」
   *
   * 上一版把 accent 改成正文色（黑）是理解错了 —— 结果面包屑选中态成了
   * 黑色加粗字，看不出可点。黑色只用于**开关类**控件的激活态（黑底白字），
   * 见 .space-chip.is-current / .space-action.is-on / .ghost-btn.is-active。
   * 状态色（--state-*）不动，那是九状态语义色。
   *
   * ## ⚠ 为什么**不借** DSH 的变量（2026-11-23）
   *
   * 原来写的是 var(--dsw-alias-brand-primary, #2563eb)，看上去「跟随主题」，
   * 实际是**借错了源**：DSH 当前主题把 --dsw-alias-brand-primary 定义成
   * #0f1115（近黑，那是它的**文字/主色**，不是强调蓝）⇒ 蓝色 fallback
   * **永远不生效**，--accent 一直是黑的。
   *
   * 症状（隔离 profile 实测）：.filter-box__title{color:var(--accent)} 渲染成
   * rgb(15, 17, 21) 黑字，而它的 hover 规则用 --accent-strong
   * （--dsw-alias-brand-hover **未定义** ⇒ 走 fallback #1d4ed8）反而是蓝的
   * —— **静止黑、hover 蓝**。同一个控件两种颜色，就是变量借错源的指纹。
   *
   * ⇒ 强调色是我们自己的设计值，就写自己的值。要跟随主题的话，得先有一个
   *   语义确实是「强调蓝」的宿主变量，而不是宿主的 brand-primary。
   */
  --accent: #2563eb;
  --accent-strong: #1d4ed8;
  --warn: #d97706;
  --font-mono: ui-monospace, Consolas, "Courier New", monospace;
  --fs-id: 11px;
  --fs-badge: 10px;
  --fs-body: 12.5px;
  --state-unspecified-dot: #9ca3af;
  --state-unspecified-fg: #6b7280;
  --state-submitted-dot: #111827;
  --state-submitted-fg: #111827;
  --state-working-dot: #06b6d4;
  --state-working-fg: #0e7490;
  --state-inputRequired-dot: #eab308;
  --state-inputRequired-fg: #a16207;
  --state-authRequired-dot: #a855f7;
  --state-authRequired-fg: #7e22ce;
  --state-completed-dot: #10b981;
  --state-completed-fg: #047857;
  --state-failed-dot: #ef4444;
  --state-failed-fg: #b91c1c;
  --state-canceled-dot: #92400e;
  --state-canceled-fg: #78350f;
  --state-rejected-dot: #f97316;
  --state-rejected-fg: #c2410c;
  --kind-goal-fg: #7c3aed;
  --kind-goal-bg: #f3e8ff;
  --kind-design-fg: #2563eb;
  --kind-design-bg: #dbeafe;
  --kind-work-fg: #0891b2;
  --kind-work-bg: #cffafe;
  --kind-record-fg: #6b7280;
  --kind-record-bg: #f3f4f6;
}
.tb3w-root, .tb3w-root *, [data-menu="status"], [data-menu="status"] *{box-sizing:border-box}

/* ══════════════════════════════════════════════════════════
   1. 拼装壳
   ══════════════════════════════════════════════════════════ */

.tb3w-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:13px;line-height:1.5}
.tb3w-page{container-type:size;container-name:tb3w;display:flex;flex-direction:column;height:100%;min-height:0;padding:16px 20px;overflow:hidden}
.tb3w-chrome{flex:0 0 auto;display:flex;flex-direction:column;min-width:0}
.tb3w-main{flex:1 1 auto;display:flex;flex-direction:row;min-height:0;min-width:0;margin-top:12px}

/*
 * 切空间的加载态 —— 用户 2026-11-23：
 * 「切换工作空间的时候整个视口都跳变。给他加一点过度时间。或者跳变也不要全变了。
 *   显示"正在加载"不应该包含视口上面的菜单部分。应该只有里面的列表或者科技树的视口显示正在加载。」
 *
 * ⇒ 加载层只在 .tb3w-main 里面；chrome（chips / 工具栏 / 筛选行）不动。
 *   兄弟节点用 CSS 隐藏而不是卸载 —— 旧内容保持挂载，加载前后没有重排。
 *   fade-in 就是用户要的「一点过度时间」：内容不是硬切，是淡入。
 *
 * ⚠ 这个字符串是 JS 模板字面量 —— 注释里**不能出现反引号**，否则字面量提前结束。
 */
.tb3w-main__loading{flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;min-width:0;color:var(--text-weak);font-size:12.5px;animation:tb3w-fade-in 160ms ease both}
.tb3w-main[data-loading="1"] > :not(.tb3w-main__loading){display:none}
@keyframes tb3w-fade-in{from{opacity:0}to{opacity:1}}

/* ── chrome 的固定形态（用户 2026-11-23：三处入口同一套，没有密度档） ──
   常驻的：任务计数 / 关系图例（只读装饰）、视图切换 / 新建（高频）
   折叠的：空间 chip 行（点「工作空间 ▾」才显示）
   目标：chrome 只占两行 —— 第 1 行工具、第 2 行筛选。 */
.tb3w-space-wrap{position:relative;display:inline-flex}
.tb3w-space-toggle{flex:0 0 auto;padding:3px 10px;border-radius:7px}
/* 下拉面板：浮在内容上，不推挤布局（用户 2026-11-20）。40 个空间在面板内部滚动。 */
.tb3w-space-pop{position:absolute;top:calc(100% + 6px);right:0;z-index:40;min-width:min(560px,88vw);max-height:min(320px,60vh);overflow:auto;padding:8px;border:1px solid var(--border,#e5e7eb);border-radius:10px;background:var(--bg-card,#fff);box-shadow:0 12px 32px rgb(15 23 42 / 16%)}
.tb3w-space-pop > .space-bar{flex-wrap:wrap;padding:0}
/*
 * 空间折叠栏（A 款）—— 用户 2026-11-22 选定：
 * 「点开以后是打开折叠的隐藏栏，不是悬浮窗」。
 * ⇒ 整行、推挤下面的筛选行（不是 absolute）。
 */
.tb3w-space-fold{padding:8px 10px;margin-top:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg-soft,#f9fafb)}
.tb3w-space-fold > .space-bar{padding:0}
.tb3w-root .tb3w-space-toggle.is-open{border-color:var(--accent);color:var(--accent);background:#eff6ff}

/* SpaceBar 自己带 6px 上下 padding ⇒ 这里只补左右对齐 */
.tb3w-chrome > .space-bar{padding-left:2px;padding-right:2px}

/*
 * 行 1 的外层：工具栏 + 空间开关按钮并排。
 *
 * 用户 2026-11-20：「工作区组件只要一个工作区组件，不包括折叠工作区用的按钮」
 * ⇒ 开关按钮不进 WorkspaceToolbar，由 Workspace 在外面拼（见 Workspace.tsx）。
 */
.tb3w-chrome__bar{display:flex;align-items:center;gap:8px;min-width:0}
.tb3w-chrome__bar > .tb3w-toolbar{flex:1 1 auto;min-width:0}

/* ── 工具栏：条数 / 图例 / 视图切换 / 新建 ── */
/*
 * ── 行布局原语（用户 2026-11-23）──
 *
 * > 「分割线是假的。不画。是我用blazor用他们的组建库，他们的分割线提供
 * >   挤过去对齐的功能。而你要做的是像组建库一样，写一个row。
 * >   然后这里面写列。两个列包裹的内容一个左对齐一个右对齐。」
 * > 「宽度不够换行。就像所有组建库提供的row那样」
 *
 * ⇒ **不画任何视觉分隔线**：右列靠 「margin-left:auto」 把剩余空间吃掉。
 *   放不下时 「flex-wrap」 让右列整组掉到下一行，**仍然右对齐**。
 *
 * 三处入口（左侧栏全屏 / 抽屉 / 右侧工作区页签）共用这一套 —— 没有第二份。
 */
.tb3w-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;min-width:0;width:100%}
.tb3w-col{display:flex;align-items:center;gap:8px;min-width:0}
.tb3w-col--start{flex:0 1 auto;flex-wrap:wrap}
.tb3w-col--end{margin-left:auto;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end}

.tb3w-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;min-width:0;margin-top:10px;padding:0 2px}
.tb3w-toolbar__title{flex:0 0 auto;font-size:12.5px;font-weight:600;color:var(--text);white-space:nowrap}
.tb3w-toolbar__count{margin-left:4px;font-weight:400;color:var(--text-secondary)}
.tb3w-toolbar__legend{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px;order:2;min-width:0;font-size:11px;color:var(--text-secondary)}
.tb3w-toolbar__legend-label{flex:0 0 auto;white-space:nowrap}
.tb3w-legend__item{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.tb3w-legend__line{display:inline-block;flex:0 0 auto;width:14px;height:2px;border-radius:1px;background:#5b6472}
.tb3w-legend__line[data-rel="depends"]{background:#a16207}
.tb3w-legend__line[data-rel="supersedes"]{background:#6d28d9}
.tb3w-legend__line[data-rel="constrains"]{background:#b91c1c}
.tb3w-legend__line[data-rel="related"]{height:0;border-top:2px dashed #15803d;background:none}
.tb3w-legend__line[data-rel="references"]{height:0;border-top:2px dashed #6b7280;background:none}

.tb3w-toolbar__actions{display:flex;align-items:center;gap:8px;order:3;margin-left:auto;min-width:0}
.tb3w-seg{display:inline-flex;align-items:center;padding:2px;border-radius:6px;background:var(--bg-hover)}
.tb3w-seg__btn{padding:3px 10px;border:0;border-radius:5px;background:transparent;color:var(--text-secondary);font-family:inherit;font-size:11.5px;cursor:pointer;white-space:nowrap}
.tb3w-seg__btn.is-on{background:var(--text);color:#fff;font-weight:600}
.tb3w-btn-primary{padding:4px 12px;border:1px solid var(--text);border-radius:6px;background:var(--text);color:#fff;font-family:inherit;font-size:11.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.tb3w-btn-primary:hover{opacity:.88}

/* ── 筛选区：3 个 FilterBox 独占一行；尾部（AI 计数 / 搜索）另起一行 ──
 *
 * 用户 2026-11-20：
 * 「筛选按钮是有弹出的文档流的。把别人挤走了怎么办」
 * 「我要他参与文档流。所以他要独立一行」
 *
 * ⇒ 筛选按钮**参与文档流**（展开是撑宽这一行，不是浮层盖住别人），
 *   所以必须独占一行 —— 行 1 只有筛选按钮，行 2 才是尾部。
 *   这样展开/收起只改行 1 的宽度与高度，不会把搜索框挤走。
 *
 * ⚠ .tb3w-chrome 是 column flex，两行天然各占一行；这里去掉 spacer
 *   （它原来把尾部推到行 1 的右边）并让尾部强制换行。
 */
.tb3w-filters{flex:1 0 100%;min-width:0;margin-top:8px}
.tb3w-filters .filter-row__spacer{display:none}
.tb3w-filters__tail{flex:0 1 auto;display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0;margin-left:auto}
.tb3w-ai-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-secondary);font-size:10.5px;white-space:nowrap}
.tb3w-ai-chip b{font-weight:600;color:var(--text)}
/* 未读筛选按钮：可点 + 选中态（用户 2026-11-21 要「两个筛选按钮」）*/
.tb3w-ai-chip{cursor:pointer;font:inherit;font-size:10.5px;border-color:var(--card-border,#9aa1ad)}
.tb3w-ai-chip:hover{background:#f1f3f6}
.tb3w-ai-chip.is-on{border-color:var(--accent);background:#eff6ff;color:var(--accent)}
.tb3w-ai-chip.is-on b{color:var(--accent)}
/*
 * 尾部搜索框 = 定稿的 SearchBox（类名 .search-box，样式在 SEARCHBOX_CSS）。
 * 这里只管**布局**：宽版固定 250px（和原来的行内输入框同宽），窄版整行。
 */
.tb3w-filters__tail .search-box{flex:0 0 auto;width:200px}

/* ── 左栏：列表 ── */
.tb3w-list{flex:2 1 0;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.tb3w-list__head{flex:0 0 auto;display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:11px 14px 7px}
.tb3w-list__title{font-size:12.5px;font-weight:600;color:var(--text)}
.tb3w-list__title em{font-style:normal;font-weight:400;color:var(--text-secondary)}
.tb3w-list__sort{flex:0 0 auto;font-size:11px;color:var(--text-weak)}
/*
 * 列表的列名行。设计图里只在宽版出现（窄版把纵向空间让给行本身）。
 * 三列与 CardRow 的几何对齐：46px 正方形 + 12px gap ≈ 58（首列给到 190 是为了
 * 把「分类 · 领域 · 模板」对齐到 label 起点），最后一列 90px 对齐「最后动过」。
 */
.tb3w-list__cols{flex:0 0 auto;display:grid;grid-template-columns:190px 150px minmax(0,1fr) 90px;gap:0;padding:0 14px 5px;border-bottom:1px solid #eef1f5;font-size:8.5px;color:#b6bec9}
.tb3w-list__cols span:last-child{text-align:right}
.tb3w-list__body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 14px 12px}
.tb3w-list__empty{padding:28px 8px;text-align:center;font-size:12px;color:var(--text-weak)}

/*
 * 科技树视图 —— 用定稿的 TechTree（类名 tb3t-*，CSS 在 TECHTREE_CSS）。
 * 它的根是 height:100% 的 flex 列（画布自己滚、页脚常驻）⇒ 这里只给一个
 * 「撑满列表栏」的容器。min-height:0 是 flex 里让子元素内部滚动的必要条件
 * （同 .tb3w-list__body 的理由）。
 */
.tb3w-tree{flex:1 1 auto;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
.tb3w-tree > .tb3t-root{flex:1 1 auto;min-height:0}

/* ── 分隔条：可拖（宽版竖 / 窄版横） ── */
.tb3w-split{position:relative;display:flex;flex:0 0 20px;align-items:center;justify-content:center;cursor:col-resize;user-select:none;touch-action:none}
.tb3w-split__line{position:absolute;top:0;bottom:0;left:50%;width:0;border-left:1px dashed #cbd5e1}
.tb3w-split__grip{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-secondary);font-size:10px}

/* ── 右栏：详情 ── */
.tb3w-detail{flex:1.2 1 0;display:flex;flex-direction:column;min-width:300px;max-width:460px;min-height:0}
.tb3w-detail > .detail{flex:1 1 auto;min-height:0;overflow-y:auto}
.tb3w-detail__empty{flex:1 1 auto;display:flex;align-items:center;justify-content:center;border:1px dashed var(--border);border-radius:10px;background:var(--bg-card);color:var(--text-weak);font-size:12px}
/* 详情里的状态 = 状态菜单的触发器（设计图没画胶囊，见 V3 报告） */
.tb3w-detail [data-meta="status"]{position:relative;cursor:pointer;border-radius:5px}
.tb3w-detail [data-meta="status"]:hover{background:var(--bg-hover)}
.tb3w-detail [data-meta="status"]::after{content:"⌄";position:absolute;top:50%;right:-3px;transform:translateY(-50%);font-size:9px;color:var(--text-weak);opacity:.85}
.tb3w-root[data-detail="closed"] .tb3w-split,.tb3w-root[data-detail="closed"] .tb3w-detail{display:none}

/* ══════════════════════════════════════════════════════════
   2. 已定稿组件的样式（作用域化；值照抄各自 preview 的 style.css）
   ══════════════════════════════════════════════════════════ */

/* ── SpaceBar ── */
.tb3w-root .ghost-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text-secondary);font-family:inherit;font-size:12px;white-space:nowrap;cursor:pointer;transition:border-color .12s,color .12s,background .12s}
.tb3w-root .ghost-btn:hover:not(:disabled){border-color:var(--text-weak);color:var(--text)}
.tb3w-root .ghost-btn:disabled{opacity:.45;cursor:default}
/*
 * 开关类控件的激活态 = **黑底白字**。用户 2026-11-20：
 * 「对于开关性质的。比如当前空间，展示已归档。这些切换开关的，
 *   用黑底白字来表示现在选用/激活。」
 *
 * 这一条只作用于「显示已归档」这个开关（SpaceBar 里的 .space-toggle）。
 * 筛选按钮（状态 / 类别 / 领域）不是开关，用蓝色 —— 见下面的 .filter-box 段。
 */
.tb3w-root .ghost-btn.is-active{border-color:var(--text);background:var(--text);color:#fff}
.tb3w-root .ghost-btn.is-active:hover:not(:disabled){border-color:var(--text);background:var(--text);color:#fff}
.tb3w-root .space-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;padding:6px 2px}
.tb3w-root .space-bar > *{flex:0 0 auto}
.tb3w-root .space-action{min-width:84px;justify-content:center}
.tb3w-root .space-action.is-emphasis-current{border-color:var(--accent);background:#eef4ff;color:var(--accent);font-weight:600;cursor:default}
.tb3w-root .space-action.is-emphasis-current:hover{border-color:var(--accent);color:var(--accent)}
.tb3w-root .space-action.is-emphasis-action{border-color:var(--border);background:var(--bg-card);color:var(--text-secondary)}
.tb3w-root .space-action.is-emphasis-action:hover:not(:disabled){border-color:var(--accent);background:#f5f9ff;color:var(--accent)}
.tb3w-root .space-action.is-emphasis-plain{color:var(--text-weak)}
.tb3w-root .space-action.is-on{border-color:var(--text);background:var(--text);color:#fff}
.tb3w-root .space-action.is-on:hover:not(:disabled){border-color:var(--text);background:var(--text);color:#fff}
.tb3w-root .space-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border:1px solid var(--border);border-radius:999px;background:var(--bg-card);color:var(--text-secondary);font-family:inherit;font-size:12px;white-space:nowrap;cursor:pointer;transition:border-color .12s,background .12s}
.tb3w-root .space-chip:hover{border-color:var(--text-weak)}
.tb3w-root .space-chip.is-current{border-color:var(--text);background:var(--text);color:#fff}
.tb3w-root .space-chip.is-viewing{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.tb3w-root .space-chip.is-current.is-viewing{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.tb3w-root .space-chip.is-archived{border-style:dashed;opacity:.65}
.tb3w-root .space-chip.is-archived:hover{opacity:1}
.tb3w-root .space-chip.is-current.is-archived{opacity:1}
.tb3w-root .space-chip__count{font-family:var(--font-mono);font-size:11px;opacity:.75}
.tb3w-root .space-chip--add{padding:4px 9px;color:var(--text-weak)}

/* ── FilterBox / FilterRow ── */
.tb3w-root .filter-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
/*
 * 筛选按钮 = **蓝色风格**（不是开关）。用户 2026-11-20：
 * 「对状态筛选按钮这些，突出可交互的，但只是可以点击，不是切换性质的，
 *   用蓝色的风格。」
 *
 * ⇒ 描边淡蓝、标题蓝字（看得出能点）；展开时描边变实蓝。
 *   激活态**不用黑底白字** —— 那是开关类的语言（见上面 .ghost-btn.is-active）。
 */
.tb3w-root .filter-box{position:relative;flex:0 0 auto;height:32px;max-width:100%;border:1px solid #c7d9f7;border-radius:6px;background:var(--bg-card);overflow:hidden;cursor:pointer;user-select:none;transition:width .18s ease,border-color .12s ease}
.tb3w-root .filter-box:hover{border-color:var(--accent)}
.tb3w-root .filter-box.is-open{border-color:var(--accent)}
.tb3w-root .filter-box__face{position:absolute;top:0;bottom:0;left:12px;display:inline-flex;align-items:center;white-space:nowrap;transition:opacity .12s ease}
.tb3w-root .filter-box__face--expanded{opacity:0;pointer-events:none}
.tb3w-root .filter-box.is-open .filter-box__face--collapsed{opacity:0;pointer-events:none}
.tb3w-root .filter-box.is-open .filter-box__face--expanded{opacity:1;pointer-events:auto}
.tb3w-root .filter-box__title{padding:0 2px;border:0;border-radius:4px;background:none;color:var(--accent);font-family:inherit;font-size:12.5px;cursor:pointer}
.tb3w-root .filter-box__title:hover{background:#eff6ff;color:var(--accent-strong)}
.tb3w-root .filter-box__colon{font-size:12.5px;color:var(--text-secondary)}
.tb3w-root .filter-box__crumbs{display:inline-flex;align-items:center}
/* 分隔斜杠要看得见（用过 #cbd5e1，截图里几乎看不见） */
.tb3w-root .filter-box__csep{padding:0 1px;font-size:12px;color:#9aa1ad;user-select:none}
.tb3w-root .filter-box__items{display:inline-flex;align-items:center}
.tb3w-root .filter-box__item{display:inline-flex;align-items:center;gap:2px;padding:2px 4px;border:0;border-radius:4px;background:none;color:var(--text);font-family:inherit;font-size:12.5px;cursor:pointer}
.tb3w-root .filter-box__item:hover{background:#f3f4f6}
/*
 * 面包屑 / 选项的选中态 = **蓝字**（不是黑字加粗）。
 *
 * 用户 2026-11-20 骂的就是这一条：「你把面包屑做成黑色加粗字。
 * 这哪看的清他是可选的。」⇒ accent 已恢复蓝，字重从 700 降到 600
 * （700 看起来像小标题，不像可点的项）。
 */
.tb3w-root .filter-box__item.is-picked{color:var(--accent);font-weight:600}
.tb3w-root .filter-box__item.is-picked:hover{background:#eff6ff}
.tb3w-root .filter-box__item--crumb:not(.is-picked){text-decoration:underline dotted #b6bec9;text-underline-offset:3px}
.tb3w-root .filter-box__item--crumb:not(.is-picked):hover{color:var(--accent);text-decoration-color:var(--accent)}
.tb3w-root .filter-box__more{margin-left:1px;font-size:9px;opacity:.5}
.tb3w-root .filter-box__sep{padding:0 2px;font-size:12px;color:#cbd5e1;user-select:none}
.tb3w-root .filter-box__vline{align-self:stretch;width:1px;margin:0 10px;background:#d1d5db}

/* ── 状态圆点 / 编号 / 徽章（StatusCell 系） ── */
.tb3w-root .dot{display:inline-block;flex:0 0 auto;width:7px;height:7px;border-radius:50%;background:var(--state-unspecified-dot)}
.tb3w-root .dot--unspecified{background:var(--state-unspecified-dot)}
.tb3w-root .dot--submitted{background:var(--state-submitted-dot)}
.tb3w-root .dot--working{background:var(--state-working-dot)}
.tb3w-root .dot--inputRequired{background:var(--state-inputRequired-dot)}
.tb3w-root .dot--authRequired{background:var(--state-authRequired-dot)}
.tb3w-root .dot--completed{background:var(--state-completed-dot)}
.tb3w-root .dot--failed{background:var(--state-failed-dot)}
.tb3w-root .dot--canceled{background:var(--state-canceled-dot)}
.tb3w-root .dot--rejected{background:var(--state-rejected-dot)}
.tb3w-root .card-id{flex:0 0 auto;font-family:var(--font-mono);font-size:var(--fs-id);font-weight:700;letter-spacing:-.2px}
.tb3w-root .card-id--goal{color:var(--kind-goal-fg)}
.tb3w-root .card-id--design{color:var(--kind-design-fg)}
.tb3w-root .card-id--work{color:var(--kind-work-fg)}
.tb3w-root .card-id--record{color:var(--kind-record-fg)}
.tb3w-root .badge{display:inline-block;flex:0 0 auto;padding:0 5px;border-radius:3px;font-size:var(--fs-badge);line-height:1.6;white-space:nowrap}
.tb3w-root .badge--goal{background:var(--kind-goal-bg);color:var(--kind-goal-fg)}
.tb3w-root .badge--design{background:var(--kind-design-bg);color:var(--kind-design-fg)}
.tb3w-root .badge--work{background:var(--kind-work-bg);color:var(--kind-work-fg)}
.tb3w-root .badge--record{background:var(--kind-record-bg);color:var(--kind-record-fg)}
.tb3w-root .badge--domain{background:#f3f4f6;color:var(--text-secondary)}
.tb3w-root .badge--template{background:#eef1f5;color:var(--text-secondary)}
/*
 * ⚠ 非紧凑态的 .task-card__status 原先只存在于旧面板的 CSS（.status-line 那段），
 *   V3 的详情头部用到了它 ⇒ 这里补一条基础规则（**样式钩子，不改组件行为**）。
 */
.tb3w-root .task-card__status{display:inline-flex;align-items:center;gap:4px;min-width:0;font-size:11.5px;color:var(--text-secondary)}
.tb3w-root .task-card__status-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3w-root .task-card__status.is-compact{flex:0 0 auto;align-items:center;gap:3px;font-size:9px;color:var(--text-weak)}

/* ── CardRow ── */
.tb3w-root .task-card{display:flex;align-items:stretch;gap:0;width:100%;margin-bottom:6px;padding:8px 12px;border:2px solid var(--card-border,#9aa1ad);border-radius:8px;background:var(--bg-card);color:inherit;font-family:inherit;text-align:left;cursor:pointer;transition:border-color .12s,background .12s}
.tb3w-root .task-card:hover{background:#f8f9fb}
.tb3w-root .task-card.is-selected{border-color:var(--accent);background:#f5f9ff}
.tb3w-root .task-card.is-draft{border-color:transparent}
.tb3w-root .task-card.is-draft:hover{border-color:var(--card-border,#9aa1ad)}
.tb3w-root .task-card.is-draft.is-selected{border-color:var(--accent)}
.tb3w-root .task-card.is-unread-user{border-left-width:4px;border-left-color:var(--warn);padding-left:10px}
.tb3w-root .task-card.is-unread-ai{border-right-width:4px;border-right-color:var(--accent);padding-right:10px}
.tb3w-root .task-card__square{flex:0 0 46px;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0}
.tb3w-root .task-card__square-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);font-size:var(--fs-id);font-weight:700;letter-spacing:-.2px}
.tb3w-root .task-card__body{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;min-width:0}
.tb3w-root .task-card__line{display:flex;align-items:center;gap:6px;min-width:0}
.tb3w-root .task-card__line .badge{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3w-root .task-card__title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-body);font-weight:600}
.tb3w-root .task-card__when{flex:0 0 90px;overflow:hidden;text-align:right;font-size:11px;color:var(--text-weak);white-space:nowrap}
.tb3w-root .task-card__when-label{display:block;font-size:9px;opacity:.7}
.tb3w-root .task-card.is-unread-user .card-id{font-weight:800}

/* ── CardDetail ── */
.tb3w-root .detail{display:flex;flex-direction:column;gap:14px;min-width:0;padding:16px 18px;border:1px solid var(--border);border-radius:10px;background:var(--bg-card)}
.tb3w-root .detail-head{display:flex;flex-direction:column;gap:8px;min-width:0}
.tb3w-root .detail-title-row{display:flex;align-items:flex-start;gap:8px;min-width:0}
.tb3w-root .detail-title{flex:1 1 auto;min-width:0;margin:0;overflow-wrap:anywhere;color:var(--text);font-size:17px;font-weight:700;line-height:1.4;letter-spacing:-.01em}
.tb3w-root .detail-title-row__spacer{flex:0 0 auto;width:0}
.tb3w-root .icon-btn{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:1px solid transparent;border-radius:5px;background:none;color:var(--text-weak);font-family:inherit;font-size:14px;line-height:1;cursor:pointer}
.tb3w-root .icon-btn:hover{border-color:var(--border);background:#f6f7f9;color:var(--text)}
/* meta 行：状态是**固定 92px 首列**，不随 label 变宽而漂移 */
.tb3w-root .detail-meta{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;min-width:0;font-size:11.5px;color:var(--text-secondary)}
.tb3w-root .detail-meta > *{flex:0 0 auto;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 用户 2026-11-20：「为什么是固定宽度呢。应该是设计这个东西最小宽度 4em 啊」——
 * 用 min-width 而不是 flex-basis：短状态保持 4em（中文 1em = 1 字，正好容纳「需要信息」这种 4 字状态），
 * 更长的状态自动撑开，不会被截断。 */
.tb3w-root .detail-status-col{display:inline-flex;align-items:center;min-width:4em;margin-left:0;padding:0}
.tb3w-root .detail-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.tb3w-root .detail-action{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;font-size:12px}
.tb3w-root .detail-action.is-primary{border-color:var(--accent);background:var(--accent);color:#fff;font-weight:600}
.tb3w-root .detail-action.is-primary:hover:not(:disabled){border-color:var(--accent-strong);background:var(--accent-strong);color:#fff}
.tb3w-root .detail-action.is-primary:disabled{opacity:.4;cursor:not-allowed}
.tb3w-root .detail-action__badge{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:rgb(255 255 255 / 24%);font-family:var(--font-mono);font-size:10px;font-weight:700;line-height:1}
.tb3w-root .detail-action:not(.is-primary) .detail-action__badge{background:#eef1f5;color:var(--text-secondary)}
.tb3w-root .detail-banner{padding:8px 11px;border:1px solid #fde68a;border-radius:7px;background:#fffbeb;color:#92400e;font-size:11.5px;line-height:1.6}
.tb3w-root .detail-sections{display:flex;flex-direction:column;gap:12px;min-width:0}
/*
 * ⚠ 这里曾经有 .detail-section / __label / __body / __empty —— 它们只服务
 *   CardDetail 里的占位组件 SectionStub。2026-11-20 章节改用定稿 Section
 *   （.section-block 那一套在 SECTION_CSS 里）⇒ 这几条已删，别再加回来。
 */
.tb3w-root .detail-empty{font-size:12px;color:var(--text-weak)}
.tb3w-root .detail-note{display:flex;flex-direction:column;gap:5px;min-width:0;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:#fbfcfd}
.tb3w-root .detail-note__label{font-size:11.5px;font-weight:600;color:var(--text-secondary)}
.tb3w-root .detail-note__input{width:100%;padding:7px 9px;border:1px solid transparent;border-radius:5px;background:var(--bg-card);resize:vertical;color:var(--text);font-family:inherit;font-size:12.5px;line-height:1.7}
.tb3w-root .detail-note__input:focus{border-color:#93c5fd;box-shadow:0 0 0 3px rgb(37 99 235 / 10%);outline:none}
.tb3w-root .detail-note__input:disabled{background:#f4f5f7;color:var(--text-weak);cursor:not-allowed}
.tb3w-root .detail-note__readonly{font-size:11px;color:var(--text-weak)}
.tb3w-root .detail-history{display:flex;flex-direction:column;gap:6px;min-width:0}
.tb3w-root .detail-history__head{display:inline-flex;align-self:flex-start;align-items:center;gap:6px;margin-left:-6px;padding:2px 6px;color:var(--text-secondary);font-size:12px;font-weight:600}
.tb3w-root .detail-history__list{display:flex;flex-direction:column;gap:7px;margin:0;padding:0 0 0 2px;list-style:none}
.tb3w-root .detail-history__item{display:flex;align-items:baseline;gap:8px;min-width:0;color:#3f4652;font-size:11.5px;line-height:1.6}
.tb3w-root .detail-history__dot{flex:0 0 auto;width:5px;height:5px;border-radius:50%;background:#cbd5e1;transform:translateY(-2px)}
.tb3w-root .detail-history__item.is-ai .detail-history__dot{background:#2563eb}
.tb3w-root .detail-history__item.is-user .detail-history__dot{background:var(--text)}
.tb3w-root .detail-history__text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.tb3w-root .detail-history__time{flex:0 0 auto;color:var(--text-weak);font-family:var(--font-mono);font-size:10.5px}

/*
 * ── RelationPanel（关系折叠面板） ──
 *
 * 用户 2026-11-20：「关系的折叠面板。你也没有做独立组件给我看给我选。没有接入。」
 *
 * 结构（变体 A，原版形态）：
 *   .rel-head   [折叠头 关系 N] [父任务 chip] [spacer] [+ 派生子任务]
 *   .rel-table
 *     .rel-columns  进行 / 搁置 / 完成 三列表头（带计数）
 *     .rel-group    每个关系类型一条组横条 + 三列（卡按自身 status 落列）
 *
 * 组横条的线色/底色、三列表头的圆点色都是**内联 style** —— 值来自
 * pure/relations-block.ts（原版 relations.js:118-125 的颜色），
 * CSS 里不写第二份（写第二份就会漂）。
 */
.tb3w-root .rel-panel{display:flex;flex-direction:column;gap:8px;min-width:0}
.tb3w-root .rel-head{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
.tb3w-root .rel-head__spacer{flex:1 1 auto}
.tb3w-root .rel-head__total{display:inline-flex;align-items:center;padding:4px 2px;color:var(--text);font-size:12px;font-weight:600;white-space:nowrap}
.tb3w-root .rel-toggle{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border:1px solid var(--border);border-radius:6px;background:#f3f4f6;color:var(--text);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:background .12s}
.tb3w-root .rel-toggle:hover{background:#e5e7eb}
.tb3w-root .rel-toggle.is-open{background:#eef1f5}
.tb3w-root .rel-toggle__caret{flex:0 0 auto;color:var(--text-secondary);font-size:10px}
.tb3w-root .rel-toggle__label{flex:0 0 auto;white-space:nowrap}
.tb3w-root .rel-toggle__summary{min-width:0;margin-left:2px;overflow:hidden;text-overflow:ellipsis;color:var(--text-secondary);font-weight:400;white-space:nowrap}
.tb3w-root .rel-parent-chip{display:inline-flex;align-items:center;gap:6px;max-width:260px;min-width:0;padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text);font-family:inherit;font-size:12px;text-align:left;cursor:pointer}
.tb3w-root .rel-parent-chip:hover{border-color:var(--text-weak)}
.tb3w-root .rel-parent-chip__arrow{flex:0 0 auto;color:var(--text-weak);font-size:11px;white-space:nowrap}
.tb3w-root .rel-table{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg-card)}
.tb3w-root .rel-columns{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid #f2f4f7;background:#f9fafb}
.tb3w-root .rel-columns__cell{display:flex;align-items:center;gap:5px;padding:7px 10px;border-top:2px solid transparent;border-right:1px solid #f2f4f7;color:var(--text-secondary);font-size:11.5px;font-weight:600}
.tb3w-root .rel-columns__cell:last-child{border-right:none}
.tb3w-root .rel-columns__cell--active{border-top-color:#2563eb}
.tb3w-root .rel-columns__cell--shelved{border-top-color:#f59e0b}
.tb3w-root .rel-columns__cell--ended{border-top-color:#10b981}
.tb3w-root .rel-columns__dot{flex:0 0 auto;width:6px;height:6px;border-radius:50%}
.tb3w-root .rel-columns__count{color:var(--text-weak);font-family:var(--font-mono);font-size:10.5px;font-weight:700}
.tb3w-root .rel-group + .rel-group{border-top:1px solid #f2f4f7}
.tb3w-root .rel-group__head{display:flex;align-items:center;gap:6px;padding:5px 10px 5px 8px;border-left:3px solid transparent;color:var(--text);font-size:11.5px;font-weight:600}
.tb3w-root .rel-group__line{flex:0 0 auto;width:12px;height:2px}
.tb3w-root .rel-group__label{flex:0 0 auto}
.tb3w-root .rel-group__count{color:var(--text-secondary);font-family:var(--font-mono);font-size:10.5px}
.tb3w-root .rel-group__body{display:grid;grid-template-columns:repeat(3,1fr)}
.tb3w-root .rel-group__col{display:flex;flex-direction:column;gap:5px;min-width:0;padding:8px 10px;border-right:1px solid #f2f4f7}
.tb3w-root .rel-group__col:last-child{border-right:none}
.tb3w-root .rel-group__cards{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px}
.tb3w-root .rel-flat{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--bg-card)}
.tb3w-root .rel-chip{display:flex;align-items:center;gap:5px;width:100%;min-width:0;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-card);color:var(--text);font-family:inherit;font-size:12px;text-align:left;cursor:pointer}
.tb3w-root .rel-chip:hover{border-color:var(--text-weak);background:#fafafa}
.tb3w-root .rel-chip__arrow{flex:0 0 auto;color:var(--text-weak);font-size:10px}
.tb3w-root .rel-chip__id{flex:0 0 auto;font-family:var(--font-mono);font-size:11px;font-weight:700;letter-spacing:-.2px}
.tb3w-root .rel-chip__title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.tb3w-root .rel-group__cards .rel-chip{width:auto;max-width:100%}
.tb3w-root .rel-group__cards .rel-chip__title{max-width:200px}
.tb3w-root .rel-empty{padding:16px;border:1px dashed var(--border);border-radius:8px;color:var(--text-weak);font-size:12px;text-align:center}
.tb3w-root .rel-foot{display:flex}
.tb3w-root .rel-add{font-size:11.5px}

/* ── StatusMenu（portal 到 body ⇒ 用 data-menu 作用域） ── */
[data-menu="status"]{position:fixed;z-index:150;width:280px;min-width:250px;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);box-shadow:0 10px 30px rgb(0 0 0 / 14%);overflow-y:auto;color:var(--text);font-size:13px;line-height:1.5}
[data-menu="status"] .menu__title{padding:4px 8px 6px;color:var(--text-weak);font-size:11px;font-weight:600}
[data-menu="status"] .menu__item{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:0;border-radius:5px;background:none;color:var(--text);font-family:inherit;font-size:12px;text-align:left;cursor:pointer}
[data-menu="status"] .menu__item:hover,[data-menu="status"] .menu__item.is-active{background:#f3f4f6}
[data-menu="status"] .menu__tone--unspecified{color:var(--state-unspecified-fg)}
[data-menu="status"] .menu__tone--submitted{color:var(--state-submitted-fg)}
[data-menu="status"] .menu__tone--working{color:var(--state-working-fg)}
[data-menu="status"] .menu__tone--inputRequired{color:var(--state-inputRequired-fg)}
[data-menu="status"] .menu__tone--authRequired{color:var(--state-authRequired-fg)}
[data-menu="status"] .menu__tone--completed{color:var(--state-completed-fg)}
[data-menu="status"] .menu__tone--failed{color:var(--state-failed-fg)}
[data-menu="status"] .menu__tone--canceled{color:var(--state-canceled-fg)}
[data-menu="status"] .menu__tone--rejected{color:var(--state-rejected-fg)}
[data-menu="status"] .menu__icon{flex:0 0 auto;width:15px;text-align:center;color:var(--text-weak);font-size:11px}
[data-menu="status"] .menu__item[class*="menu__tone--"] .menu__icon{color:inherit}
[data-menu="status"] .menu__label{flex:0 0 auto}
[data-menu="status"] .menu__hint{margin-left:auto;padding-left:14px;color:var(--text-weak);font-size:11px}
[data-menu="status"] .menu__divider{height:1px;margin:4px 0;background:#f2f4f7}
[data-menu="status"] .menu__empty{padding:8px;color:var(--text-weak);font-size:12px}
[data-menu="status"] .menu__footer{margin-top:4px;padding:8px 8px 2px;border-top:1px solid #f2f4f7;color:var(--text-weak);font-size:11px;line-height:1.6}

/* ══════════════════════════════════════════════════════════
   3. 响应式：宽 < 700px ⇒ 上下堆叠（结构变）
   ══════════════════════════════════════════════════════════ */

@container tb3w (max-width: 700px) {
  .tb3w-page{padding:10px 12px}
  .tb3w-main{flex-direction:column;margin-top:6px}
  .tb3w-list{flex:0 0 52%}
  /*
   * ⚠ 详情关着 ⇒ 列表吃满（用户 2026-11-23：「抽屉还是只有一半」）。
   *
   * 横版宽版那条在 drawer-css.ts（列表被钉死 listWidth）；
   * 竖版这条是同一个毛病：列表占 52% 高，详情不渲染时下面 48% 没人要。
   * 两处必须成对，否则一改宽高就漏一头。
   */
  .tb3w-root[data-detail="closed"] .tb3w-list{flex:1 1 0}
  .tb3w-split{flex:0 0 20px;cursor:row-resize}
  .tb3w-split__line{top:50%;bottom:auto;left:8px;right:8px;width:auto;height:0;border-left:0;border-top:3px dashed #c3cad4}
  .tb3w-split__grip{display:none}
  .tb3w-detail{flex:1 1 0;min-width:0;max-width:none;min-height:0}
  /* 列名行在小容器里去掉 —— 8.5px 的列名比行本身还占地方 */
  .tb3w-list__cols{display:none}

  /* 设计图（570×920）里窄版控件小一号：chip 24px、工具栏 10.5px、筛选框 26px */
  .tb3w-chrome > .space-bar{gap:5px;padding:4px 2px}
  .tb3w-root .space-chip{padding:3px 10px;font-size:11px}
  .tb3w-root .space-chip__count{font-size:9.5px}
  .tb3w-root .ghost-btn{padding:3px 9px;font-size:11px}
  .tb3w-root .space-action{min-width:72px}
  .tb3w-toolbar{margin-top:8px;gap:4px 8px}
  .tb3w-toolbar__title{font-size:12px}
  .tb3w-toolbar__legend{order:3;flex:1 0 100%;gap:2px 9px;font-size:9.5px}
  .tb3w-toolbar__actions{order:2}
  .tb3w-toolbar__perm{display:none}
  .tb3w-seg__btn{padding:2px 9px;font-size:10.5px}
  .tb3w-btn-primary{padding:3px 10px;font-size:10.5px}
  .tb3w-filters{margin-top:6px}
  .tb3w-filters .filter-row__spacer{display:none}
  .tb3w-filters__tail{flex:0 1 auto;flex-wrap:wrap;gap:6px}
  .tb3w-root .filter-row{gap:6px}
  .tb3w-root .filter-box{height:26px}
  .tb3w-root .filter-box__face{left:10px}
  .tb3w-root .filter-box__title,.tb3w-root .filter-box__colon{font-size:11px}
  .tb3w-root .filter-box__item{font-size:11px;padding:2px 3px}
  .tb3w-root .filter-box__csep,.tb3w-root .filter-box__sep{font-size:11px}
  .tb3w-root .filter-box__vline{margin:0 7px}
  .tb3w-ai-chip{display:inline-flex}
  .tb3w-filters__tail .search-box{flex:0 0 auto;width:160px}
  .tb3w-list__head{padding:9px 12px 5px}
  .tb3w-list__title{font-size:12px}
  .tb3w-list__body{padding:6px 12px 10px}
  .tb3w-root .task-card{margin-bottom:5px;padding:6px 10px}
  .tb3w-root .task-card.is-unread-user{padding-left:8px}
  .tb3w-root .task-card.is-unread-ai{padding-right:8px}
  .tb3w-root .detail{padding:12px 14px;gap:11px}
  .tb3w-root .detail-title{font-size:14px}
  .tb3w-root .detail-history__item{font-size:10.5px}
}
`;


/*
 * 抽屉（V5）的样式（`tb3d-*`）搬到 ./renderers/drawer-css.ts —— 用户 2026-11-22
 * 「CSS 必须跟着组件走」。数值表仍从 pure/drawer-view.ts 插值，单一来源不变。
 * 本文件只 import 同一份，再拼进 injectStyles()。
 */
import { DRAWER_CSS } from './renderers/drawer-css.ts';
/* SECTION_CSS 已搬到 ./renderers/section-css.ts（用户 2026-11-22：CSS 必须跟着组件走）；本文件只 import 同一份，再拼进 injectStyles()。 */

/* 科技树的 CSS 单独放在 pure/techtree-css.ts —— 组件和本文件共用同一份真值（曾复制两份，无自动检查会红）。 */
import { TECHTREE_CSS } from './pure/techtree-css.ts';
/* 搜索框 / 章节的 CSS 搬到组件目录 renderers/ 下 —— 用户 2026-11-22 要求「CSS 必须跟着组件走」。
 * 这里 import 同一份再拼进 injectStyles()，并转发 export 给现有 import 方。 */
import { SEARCHBOX_CSS } from './renderers/searchbox-css.ts';
import { SECTION_CSS } from './renderers/section-css.ts';
/* 派生子任务浮窗的 CSS —— 用户 2026-11-22「CSS 必须跟着组件走」，同一形态。 */
import { DERIVE_MENU_CSS } from './renderers/derive-menu-css.ts';
/*
 * 权限面板 + 权限框的 CSS —— 2026-11-23 从 `dev/preview/permission/style.css` 搬进来。
 *
 * 那份文件头原本写着「这份 CSS 现在是**预览样式**，还没并入 src/styles.ts……
 * 确认后把 .tb3perm-* 那一段搬进 src/styles.ts 并挂到真实面板上」。
 * 现在面板接进产品了（composer 权限框），所以执行那条待办。
 *
 * ⚠ 搬之前核过：产品段 437 行里 **0 处**预览专属变量（--bg-card / --border 等），
 *   全部是 --perm-*（本段自定义，兜底走宿主 token）。
 */
import { PERMISSION_CSS } from './renderers/permission-css.ts';
import { PERMISSION_BOX_CSS } from './renderers/permission-box-css.ts';
import { CARD_ACTION_CSS } from './renderers/workspace/card-action-css.ts';
import { TOOL_PERMISSION_CSS } from './renderers/tool-permission/tool-permission-css.ts';
import { SIBLING_GROUPS_CSS } from './renderers/sibling-groups-css.ts';
import { TEMPLATE_AUTH_CSS } from './renderers/tool-permission/template-auth-css.ts';

export { TECHTREE_CSS };
export { SEARCHBOX_CSS, SECTION_CSS };

export { CARD_ACTION_CSS, CREATE_SHELL_CSS, DERIVE_MENU_CSS, DRAWER_CSS, FALLBACK_CSS, PERMISSION_BOX_CSS, PERMISSION_CSS };



/**
 * 把样式插进文档（幂等）。
 *
 * ## 为什么不用 `ctx.effect` 管理
 *
 * 样式是**全局的、幂等的**：插一次就够，卸载时移除会让"另一个标签页
 * 还在用"的情况白屏。所以故意不做清理 —— 一个 `<style>` 元素的开销
 * 可以忽略，而漏删比多留危险得多。
 */
export function injectStyles(): void {
	if (typeof document === 'undefined') return;
	if (document.getElementById(STYLE_ID) !== null) return;
	const element = document.createElement('style');
	element.id = STYLE_ID;
	/*
	 * ⚠ 八段都注入（**没有 `STYLES`** —— 旧 MVP 的 `.tb3-*` 那套已随
	 *   `BoardBody` / `views/` 一起删掉，那几个组件是产品里唯一用它的地方）：
	 *
	 *   CREATE_CSS / WORKSPACE_CSS / SECTION_CSS / SEARCHBOX_CSS /
	 *   DRAWER_CSS / CREATE_SHELL_CSS / TECHTREE_CSS / FALLBACK_CSS
	 *
	 * ⚠ 顺序有约束：TECHTREE_CSS 靠后。它里面 `.tb3t-card .card-id` /
	 *   `.tb3t-card .badge` 与 WORKSPACE_CSS 的 `.tb3w-root .card-id` /
	 *   `.tb3w-root .badge` **特异度相同** ⇒ 靠「后写赢」把卡片内的尺寸收到
	 *   科技树自己的规格（颜色仍是 WORKSPACE_CSS 那一份真值）。
	 */
	element.textContent = `${CREATE_CSS}\n${WORKSPACE_CSS}\n${SECTION_CSS}\n${SEARCHBOX_CSS}\n${DRAWER_CSS}\n${CREATE_SHELL_CSS}\n${TECHTREE_CSS}\n${FALLBACK_CSS}\n${DERIVE_MENU_CSS}\n${PERMISSION_CSS}\n${PERMISSION_BOX_CSS}\n${CARD_ACTION_CSS}\n${TOOL_PERMISSION_CSS}\n${SIBLING_GROUPS_CSS}\n${TEMPLATE_AUTH_CSS}`;
	/*
	 * ⚠ **必须挂上去**。`createElement` + 设 `textContent` 只是造了一个游离节点，
	 *   不 `appendChild` 的话样式表根本不存在于文档里 ⇒ 面板渲染出来但**一点样式都没有**
	 *   （结构全对、`querySelectorAll('[class*="tb3"]')` 有 39 个元素，但 `getComputedStyle`
	 *   全是浏览器默认值，且 `document.getElementById(STYLE_ID)` 返回 null）。
	 *
	 *   2026-11-23 在隔离 profile 里实测到的：选中 taskboard tab 后
	 *   `document.querySelectorAll('style')` = 162 个、`withTb3` = 0 —— 我们的样式表压根没进 DOM。
	 *
	 *   挂 `head` 而不是 `body`：样式不算内容，`head` 是它的规范位置；
	 *   也避免被某些「清空 body」的逻辑带走。
	 */
	document.head.appendChild(element);
}

/* 转发给 `test/create-layout.test.ts` 等从 `styles.ts` 取建卡页 CSS 的调用方。 */
export { CREATE_CSS };
