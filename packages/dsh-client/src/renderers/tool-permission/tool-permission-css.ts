/**
 * 「工具权限」页（组图编辑器）的样式 —— `.tb3g-` 前缀，只作用于本页。
 *
 * ## 来源
 *
 * 从 `dev/preview/graph-editor/style.css`（759 行）搬来，**内容一字未改**，
 * 只做了两处必要处理：
 *
 *   1. 转成 TS 字符串常量（本仓约定：CSS 跟着组件走，见 `styles.ts` 的注入链）
 *   2. 反引号与 `${` 转义
 *
 * 搬进 `src/` 之后它由 `injectStyles()` 注入，因此**预览页那份 .css 不再是唯一真值**
 * —— 改样式请改本文件。
 *
 * ## 为什么前缀是 `tb3g-` 而不是 `tb3w-` / `tb3d-`
 *
 * 本页和「任务板」面板在同一个 `main` 槽里轮流出现，但两者样式互不继承。
 * 独立前缀避免任何一条规则漏出去影响别的入口。
 */

export const TOOL_PERMISSION_CSS = `/*
 * 「工具组图编辑器」预览样式 —— 类名统一 tb3g- 前缀，不碰产品样式。
 * 配色对齐设计稿（docs/perm-ui-v2/b-双栏画布拖拽）。
 */

:root {
	--tb3g-bg: #f7f8fa;
	--tb3g-card: #fff;
	--tb3g-border: #e5e7eb;
	--tb3g-border-strong: #d1d5db;
	--tb3g-text: #111827;
	--tb3g-text-2: #6b7280;
	--tb3g-text-3: #9ca3af;
	--tb3g-blue: #2563eb;
	--tb3g-blue-bg: #eff6ff;
	--tb3g-blue-border: #bfdbfe;
	--tb3g-purple: #6d28d9;
	--tb3g-purple-bg: #f5f3ff;
	--tb3g-purple-border: #c4b5fd;
	--tb3g-danger: #dc2626;
	--tb3g-danger-bg: #fef2f2;
	--tb3g-danger-border: #fecaca;
	--tb3g-ok: #059669;
}

* {
	box-sizing: border-box;
}

html,
body,
#root {
	height: 100%;
	margin: 0;
}

body {
	background: var(--tb3g-bg);
	color: var(--tb3g-text);
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
	font-size: 13px;
	line-height: 1.5;
}

.tb3g-root {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	padding: 18px 24px 20px;
	gap: 12px;
}

/* ── 头部 ── */
.tb3g-head {
	flex: 0 0 auto;
}
.tb3g-title {
	margin: 0;
	font-size: 19px;
	font-weight: 650;
	letter-spacing: 0.01em;
}
.tb3g-sub {
	margin: 4px 0 10px;
	font-size: 12px;
	color: var(--tb3g-text-2);
}
.tb3g-tabs {
	display: flex;
	gap: 6px;
}
.tb3g-tab {
	padding: 5px 16px;
	border: 1px solid var(--tb3g-border);
	border-radius: 7px;
	background: var(--tb3g-card);
	color: var(--tb3g-text-2);
	font: inherit;
	font-size: 12.5px;
	cursor: pointer;
}
.tb3g-tab.is-on {
	background: #111827;
	border-color: #111827;
	color: #fff;
	font-weight: 600;
}

/* ── 组图页：两栏 ── */
.tb3g-graph {
	flex: 1 1 auto;
	display: flex;
	gap: 12px;
	min-height: 0;
}

.tb3g-side {
	flex: 0 0 268px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-height: 0;
	padding: 12px;
	border: 1px solid var(--tb3g-border);
	border-radius: 10px;
	background: var(--tb3g-card);
}
.tb3g-side__head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	font-size: 12.5px;
	font-weight: 600;
}
.tb3g-side__hint {
	font-size: 11px;
	font-weight: 400;
	color: var(--tb3g-text-3);
}
.tb3g-side__section {
	display: flex;
	flex-direction: column;
	gap: 5px;
	min-height: 0;
}
.tb3g-side__label {
	font-size: 11px;
	color: var(--tb3g-text-3);
	letter-spacing: 0.04em;
}
.tb3g-scroll {
	overflow: auto;
	min-height: 0;
}
.tb3g-side__section .tb3g-scroll {
	max-height: 190px;
}

.tb3g-drag {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 5px 9px;
	border: 1px solid var(--tb3g-border);
	border-radius: 7px;
	background: var(--tb3g-card);
	font-size: 12px;
	cursor: grab;
	user-select: none;
}
.tb3g-drag:hover {
	border-color: var(--tb3g-blue-border);
	background: var(--tb3g-blue-bg);
}
.tb3g-drag--group {
	border-color: var(--tb3g-purple-border);
	background: var(--tb3g-purple-bg);
	color: var(--tb3g-purple);
}
.tb3g-drag__name {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.tb3g-drag__count {
	flex: 0 0 auto;
	font-size: 11px;
	color: var(--tb3g-text-3);
}
.tb3g-drag__src {
	flex: 0 0 auto;
	font-size: 10.5px;
	color: var(--tb3g-text-3);
}

.tb3g-create {
	display: flex;
	gap: 6px;
}
.tb3g-create__input {
	flex: 1 1 auto;
	min-width: 0;
	padding: 4px 8px;
	border: 1px solid var(--tb3g-border-strong);
	border-radius: 6px;
	font: inherit;
	font-size: 12px;
}

.tb3g-btn {
	padding: 4px 10px;
	border: 1px solid var(--tb3g-border-strong);
	border-radius: 6px;
	background: var(--tb3g-card);
	color: var(--tb3g-text);
	font: inherit;
	font-size: 12px;
	cursor: pointer;
}
.tb3g-btn:hover {
	border-color: var(--tb3g-blue);
	color: var(--tb3g-blue);
}
.tb3g-btn--primary {
	border-color: var(--tb3g-blue);
	background: var(--tb3g-blue);
	color: #fff;
}
.tb3g-btn--primary:hover {
	color: #fff;
	opacity: 0.92;
}
.tb3g-btn--tiny {
	padding: 2px 8px;
	font-size: 11px;
}
.tb3g-btn:disabled {
	opacity: 0.45;
	cursor: default;
}

.tb3g-tips {
	margin-top: auto;
	padding: 8px 10px;
	border-radius: 8px;
	background: #f9fafb;
	border: 1px solid var(--tb3g-border);
	font-size: 11px;
	color: var(--tb3g-text-2);
	line-height: 1.7;
}

/* ── 画布 ── */
.tb3g-canvaswrap {
	flex: 1 1 auto;
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	position: relative;
	border: 1px solid var(--tb3g-border);
	border-radius: 10px;
	background: var(--tb3g-card);
	overflow: hidden;
}
.tb3g-canvasbar {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	padding: 8px 12px;
	border-bottom: 1px solid var(--tb3g-border);
	font-size: 12px;
	color: var(--tb3g-text-2);
}
.tb3g-zoom {
	display: flex;
	align-items: center;
	gap: 6px;
}
.tb3g-zoom__label {
	min-width: 42px;
	text-align: center;
	font-variant-numeric: tabular-nums;
}

.tb3g-canvaswrap > .tb3g-scroll {
	flex: 1 1 auto;
	overflow: auto;
}
.tb3g-canvas {
	position: relative;
	width: 1200px;
	height: 760px;
	transform-origin: 0 0;
	/* 网格底 —— 让人看出这是画布 */
	background-image:
		linear-gradient(to right, #f1f3f6 1px, transparent 1px),
		linear-gradient(to bottom, #f1f3f6 1px, transparent 1px);
	background-size: 24px 24px;
}

.tb3g-edges {
	position: absolute;
	left: 0;
	top: 0;
	overflow: visible;
	pointer-events: none;
}
.tb3g-edge {
	fill: none;
	stroke: #c4b5fd;
	stroke-width: 1.6;
}
.tb3g-edge--temp {
	stroke: var(--tb3g-blue);
	stroke-dasharray: 5 4;
}
.tb3g-edge--temp.is-bad {
	stroke: var(--tb3g-danger);
	stroke-width: 2;
}

/* ── 节点 ── */
.tb3g-node {
	position: absolute;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 0 8px;
	border-radius: 9px;
	border: 1px solid var(--tb3g-border-strong);
	background: var(--tb3g-card);
	cursor: grab;
	user-select: none;
	box-shadow: 0 1px 2px rgb(15 23 42 / 6%);
}
.tb3g-node--group {
	border-color: var(--tb3g-purple-border);
	background: var(--tb3g-purple-bg);
	color: var(--tb3g-purple);
}
.tb3g-node.is-selected {
	outline: 2px solid var(--tb3g-blue);
	outline-offset: 1px;
}
.tb3g-node__main {
	display: flex;
	flex-direction: column;
	min-width: 0;
	flex: 1 1 auto;
}
.tb3g-node__name {
	font-size: 12px;
	font-weight: 600;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.tb3g-node--tool .tb3g-node__name {
	font-weight: 500;
	color: var(--tb3g-text);
}
.tb3g-node__meta {
	font-size: 10.5px;
	color: var(--tb3g-text-3);
	white-space: nowrap;
}
.tb3g-node__expanded {
	position: absolute;
	left: 0;
	bottom: -16px;
	font-size: 10px;
	color: var(--tb3g-text-3);
	white-space: nowrap;
}
.tb3g-anchor {
	position: absolute;
	right: -6px;
	top: 50%;
	width: 12px;
	height: 12px;
	margin-top: -6px;
	padding: 0;
	border: 2px solid var(--tb3g-purple-border);
	border-radius: 50%;
	background: var(--tb3g-card);
	cursor: crosshair;
}
.tb3g-anchor:hover {
	border-color: var(--tb3g-blue);
	background: var(--tb3g-blue-bg);
}

/* ── 状态条 / 提示 / 拒绝 ── */
.tb3g-status {
	flex: 0 0 auto;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	padding: 6px 12px;
	border-top: 1px solid var(--tb3g-border);
	font-size: 11.5px;
	color: var(--tb3g-text-3);
}
.tb3g-status__sel {
	display: flex;
	align-items: center;
	gap: 8px;
	color: var(--tb3g-text-2);
}

.tb3g-draginfo {
	position: absolute;
	left: 14px;
	bottom: 44px;
	display: flex;
	flex-direction: column;
	gap: 2px;
	max-width: 460px;
	padding: 7px 11px;
	border-radius: 8px;
	border: 1px solid var(--tb3g-blue-border);
	background: var(--tb3g-blue-bg);
	color: var(--tb3g-blue);
	font-size: 11.5px;
	pointer-events: none;
}
.tb3g-draginfo.is-bad {
	border-color: var(--tb3g-danger-border);
	background: var(--tb3g-danger-bg);
	color: var(--tb3g-danger);
}
.tb3g-draginfo__path {
	font-weight: 600;
}

.tb3g-reject {
	position: absolute;
	left: 14px;
	right: 14px;
	bottom: 44px;
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 11px 14px;
	border-radius: 9px;
	border: 1px solid var(--tb3g-danger-border);
	background: var(--tb3g-danger-bg);
	color: var(--tb3g-danger);
	font-size: 12px;
}
.tb3g-reject__title {
	font-weight: 650;
}
.tb3g-reject__path {
	font-weight: 600;
	font-size: 12.5px;
}
.tb3g-reject__hint {
	color: #b91c1c;
	font-size: 11.5px;
}
.tb3g-reject .tb3g-btn {
	align-self: flex-start;
	margin-top: 2px;
}

.tb3g-ghost {
	position: fixed;
	z-index: 50;
	padding: 4px 9px;
	border-radius: 7px;
	border: 1px solid var(--tb3g-blue);
	background: var(--tb3g-blue-bg);
	color: var(--tb3g-blue);
	font-size: 11.5px;
	pointer-events: none;
	opacity: 0.92;
}

/* ── 工具清单 / 模板授权 ── */
.tb3g-page {
	flex: 1 1 auto;
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-height: 0;
	padding: 14px;
	border: 1px solid var(--tb3g-border);
	border-radius: 10px;
	background: var(--tb3g-card);
	overflow: auto;
}
.tb3g-page__bar {
	display: flex;
	align-items: center;
	gap: 12px;
}
.tb3g-input {
	padding: 5px 10px;
	border: 1px solid var(--tb3g-border-strong);
	border-radius: 7px;
	font: inherit;
	font-size: 12px;
	min-width: 260px;
}
.tb3g-page__count {
	font-size: 11.5px;
	color: var(--tb3g-text-3);
}
.tb3g-table {
	width: 100%;
	border-collapse: collapse;
	font-size: 12px;
}
.tb3g-table th {
	text-align: left;
	padding: 6px 8px;
	border-bottom: 1px solid var(--tb3g-border);
	color: var(--tb3g-text-3);
	font-weight: 500;
	font-size: 11px;
}
.tb3g-table td {
	padding: 6px 8px;
	border-bottom: 1px solid #f1f2f4;
}
.tb3g-table__name {
	font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.tb3g-table__groups {
	color: var(--tb3g-purple);
}
.tb3g-muted {
	color: var(--tb3g-text-3);
}
.tb3g-pager {
	display: flex;
	align-items: center;
	gap: 10px;
	font-size: 11.5px;
	color: var(--tb3g-text-2);
}
.tb3g-placeholder {
	max-width: 620px;
	padding: 18px;
	border: 1px dashed var(--tb3g-border-strong);
	border-radius: 10px;
	background: #fbfbfc;
}
.tb3g-placeholder__title {
	font-weight: 650;
	margin-bottom: 6px;
}

.tb3g-debug {
	position: fixed;
	right: 6px;
	bottom: 4px;
	font-size: 10px;
	color: #c3c8d0;
	pointer-events: none;
}

/* ══════════════════════════════════════════════════════════
   三栏点选版（2026-11-23 重做）—— 拖拽相关样式已弃用
   ══════════════════════════════════════════════════════════ */

.tb3g-graph {
	gap: 10px;
}
.tb3g-side--left {
	flex: 0 0 216px;
}
.tb3g-side--right {
	flex: 0 0 244px;
}
.tb3g-side--right .tb3g-scroll {
	flex: 1 1 auto;
}

/* 左栏：组列表（单选） */
.tb3g-groupitem {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 6px 9px;
	margin-bottom: 4px;
	border: 1px solid var(--tb3g-border);
	border-radius: 7px;
	background: var(--tb3g-card);
	color: var(--tb3g-purple);
	font: inherit;
	font-size: 12px;
	text-align: left;
	cursor: pointer;
}
.tb3g-groupitem:hover {
	border-color: var(--tb3g-purple-border);
	background: var(--tb3g-purple-bg);
}
.tb3g-groupitem.is-active {
	border-color: var(--tb3g-blue);
	background: var(--tb3g-blue-bg);
	color: var(--tb3g-blue);
	font-weight: 650;
	box-shadow: inset 2px 0 0 var(--tb3g-blue);
}
.tb3g-groupitem__name {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.tb3g-groupitem__count {
	flex: 0 0 auto;
	font-size: 10.5px;
	color: var(--tb3g-text-3);
}

/* 右栏：工具复选 */
.tb3g-input--side {
	width: 100%;
	min-width: 0;
}
.tb3g-checkitem {
	display: flex;
	align-items: center;
	gap: 7px;
	padding: 5px 8px;
	border-radius: 6px;
	font-size: 12px;
	cursor: pointer;
}
.tb3g-checkitem:hover {
	background: #f7f9fc;
}
.tb3g-checkitem.is-checked {
	background: var(--tb3g-blue-bg);
}
.tb3g-checkitem input {
	margin: 0;
	accent-color: var(--tb3g-blue);
}
.tb3g-checkitem__name {
	flex: 1 1 auto;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
	font-size: 11.5px;
}
.tb3g-checkitem__src {
	flex: 0 0 auto;
	font-size: 10px;
	color: var(--tb3g-text-3);
}

/* 节点三态 */
.tb3g-node {
	cursor: default;
}
.tb3g-node--group {
	cursor: pointer;
}
.tb3g-node.is-active {
	border-color: var(--tb3g-blue);
	box-shadow:
		0 0 0 2px rgb(37 99 235 / 25%),
		0 1px 2px rgb(15 23 42 / 8%);
}
.tb3g-node.is-member {
	background: #eef4ff;
	border-color: #93b4f8;
}
.tb3g-node.is-blocked {
	border-color: var(--tb3g-danger);
	background: var(--tb3g-danger-bg);
	color: var(--tb3g-danger);
	cursor: not-allowed;
	opacity: 0.95;
}
.tb3g-node.is-blocked .tb3g-node__meta {
	color: #ef4444;
}

/* 提示条 */
.tb3g-notice {
	position: absolute;
	left: 14px;
	bottom: 42px;
	display: flex;
	align-items: center;
	gap: 10px;
	max-width: calc(100% - 28px);
	padding: 8px 12px;
	border-radius: 8px;
	border: 1px solid var(--tb3g-blue-border);
	background: var(--tb3g-blue-bg);
	color: var(--tb3g-blue);
	font-size: 11.5px;
}
.tb3g-notice.is-bad {
	border-color: var(--tb3g-danger-border);
	background: var(--tb3g-danger-bg);
	color: var(--tb3g-danger);
}

/* 状态条图例 */
.tb3g-status__legend {
	display: flex;
	align-items: center;
	gap: 6px;
}
.tb3g-dot {
	width: 9px;
	height: 9px;
	border-radius: 3px;
	border: 1px solid var(--tb3g-border-strong);
	margin-left: 6px;
}
.tb3g-dot--active {
	border-color: var(--tb3g-blue);
	background: var(--tb3g-blue-bg);
}
.tb3g-dot--member {
	border-color: #93b4f8;
	background: #eef4ff;
}
.tb3g-dot--blocked {
	border-color: var(--tb3g-danger);
	background: var(--tb3g-danger-bg);
}

.tb3g-crumb {
	display: flex;
	align-items: baseline;
	gap: 10px;
	flex-wrap: wrap;
}
.tb3g-crumb__hint {
	font-size: 11px;
	color: var(--tb3g-text-3);
}
/* 节点内部改成一列（名字在上、元信息在下） */
.tb3g-node {
	flex-direction: column;
	align-items: flex-start;
	justify-content: center;
	gap: 1px;
}

/* 调试数据只给 CDP 读，不该挡在界面上 */
.tb3g-debug {
	position: absolute;
	left: -10000px;
	top: 0;
	width: 1px;
	height: 1px;
	overflow: hidden;
	pointer-events: none;
}

/* ── 列头标签（不画线，只标层） ── */
.tb3g-collabel {
	position: absolute;
	font-size: 10px;
	color: var(--tb3g-text-3);
	letter-spacing: 0.04em;
	pointer-events: none;
	user-select: none;
}

/* ── 工具清单页：直接所属组 chips + 连通组数 ── */
.tb3g-chips {
	display: inline-flex;
	flex-wrap: wrap;
	gap: 4px;
}
.tb3g-chip {
	padding: 1px 7px;
	border-radius: 999px;
	border: 1px solid var(--tb3g-purple-border);
	background: var(--tb3g-purple-bg);
	color: var(--tb3g-purple);
	font-size: 10.5px;
	white-space: nowrap;
}
.tb3g-chip--more {
	border-color: var(--tb3g-border-strong);
	background: #f3f4f6;
	color: var(--tb3g-text-2);
}
.tb3g-table__count {
	text-align: right;
	font-variant-numeric: tabular-nums;
	color: var(--tb3g-text-2);
	width: 84px;
}

/* 分列后节点更紧凑（行距由 layout 的 gapY=8 决定） */
.tb3g-node {
	box-shadow: 0 1px 1px rgb(15 23 42 / 5%);
}

/* ══════════════════════════════════════════════════════════
   页面外壳（ToolPermissionPage）：常驻提示条 + 载入态
   ══════════════════════════════════════════════════════════ */

/* 外壳：竖向排列「提示条 + 组图」，组图吃掉剩余高度 */
.tb3g-shell {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
}

/*
 * 常驻提示条。
 *
 * ⚠ 不是组件里那个 .tb3g-notice —— 那是绝对定位、几秒后消失的一次性 toast。
 *   两者语义不同（常驻状态说明 vs 操作反馈），不要合并成一个类。
 */
.tb3g-banner {
	margin: 10px 24px 0;
	padding: 7px 12px;
	border: 1px solid #fde68a;
	border-radius: 8px;
	background: #fffbeb;
	color: #92400e;
	font-size: 12px;
	line-height: 1.5;
	flex: 0 0 auto;
}

/* 降级提示（工具清单取不到）—— 红色，和黄色「不持久化」区分开 */
.tb3g-banner--bad {
	border-color: #fecaca;
	background: #fef2f2;
	color: #b91c1c;
}

.tb3g-loading {
	margin: 0;
	padding: 18px 24px;
	color: #6b7280;
	font-size: 13px;
}

/* 左栏面板顶部：编组 / 授权 两个选项卡 */
.tb3g-side__head--tabs {
	display: flex;
	gap: 6px;
	padding: 6px 8px;
	align-items: center;
}
.tb3g-side__head--tabs .tb3g-tab {
	padding: 3px 12px;
	border: 1px solid #d7dbe2;
	border-radius: 7px;
	background: #fff;
	color: #4b5563;
	font-size: 11.5px;
}
.tb3g-side__head--tabs .tb3g-tab.is-on {
	border-color: #2563eb;
	background: #2563eb;
	color: #fff;
	font-weight: 600;
}
.tb3g-groupitem__name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
}

/* 右栏工具：直接勾选=绿勾，因组间接包含=灰勾 */
.tb3g-checkitem[data-check='direct'] input {
	accent-color: #12b76a;
}
.tb3g-checkitem[data-check='inherited'] input {
	accent-color: #9ca3af;
}
.tb3g-checkitem[data-check='inherited'].is-checked {
	background: #f3f4f6;
}
.tb3g-checkitem[data-check='inherited'] .tb3g-checkitem__name {
	color: #6b7280;
}`;
