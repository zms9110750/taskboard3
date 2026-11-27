/**
 * PermissionPanel 的产品样式 —— **跟着组件走**（用户 2026-11-22 裁决）。
 *
 * ## 从哪来的
 *
 * 原来这 437 行躺在 dev/preview/permission/style.css 里，文件头写着：
 *
 * > 「这份 CSS 现在是**预览样式**，还没并入 src/styles.ts。
 * >   组件先在预览里定稿，确认后把 .tb3perm-* 那一段搬进 src/styles.ts
 * >   并挂到真实面板上。」
 *
 * ⇒ 现在面板要接进产品（composer 里的权限框），所以搬进来了。
 *
 * ## 0 处预览专属变量
 *
 * 搬之前核过：这 437 行里 var(--bg-card) / var(--border) / var(--accent)
 * 这类**预览共享变量出现 0 次** —— 全部是 var(--perm-*)（本段自己定义，
 * 兜底值是宿主 token var(--dsw-alias-*, 兜底色)）。所以搬进来不会缺变量。
 *
 * ## 为什么是模板字符串
 *
 * rolldown 不支持 CSS 打包（[UNSUPPORTED_FEATURE] Bundling CSS is no longer supported），
 * 所以全仓的组件样式都是 TS 字符串常量 + injectStyles() 插一个 style 元素。
 *
 * ⚠ 本文件是模板字符串 —— **注释里不能出现反引号**（会提前结束字符串，TS1005）。
 */

/* 底部追加的「权限框」样式见 permission-box-css.ts（那是新组件，单独一份）。 */
export const PERMISSION_CSS = `
.tb3perm {
	/* 宿主主题 token + 兜底色（预览里走兜底） */
	--perm-fg: var(--dsw-alias-text-primary, #16181d);
	--perm-fg-2: var(--dsw-alias-text-secondary, #5f6673);
	--perm-fg-3: var(--dsw-alias-text-tertiary, #9aa1ad);
	--perm-border: var(--dsw-alias-border-secondary, #e7e9ee);
	--perm-border-strong: var(--dsw-alias-border-primary, #d7dbe2);
	--perm-bg: var(--dsw-alias-bg-primary, #fff);
	--perm-bg-soft: var(--dsw-alias-bg-secondary, #fafbfc);
	--perm-accent: var(--dsw-alias-brand-primary, #2563eb);
	--perm-accent-strong: var(--dsw-alias-brand-hover, #1d4ed8);
	--perm-accent-soft: #eff6ff;
	--perm-danger: var(--dsw-alias-text-danger, #b91c1c);
	--perm-danger-bg: var(--dsw-alias-bg-danger, #fdf2f2);
	--perm-danger-border: var(--dsw-alias-border-danger, #f3c9c9);

	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	gap: 14px;
	width: 100%;
	max-width: 760px;
	color: var(--perm-fg);
	font-family:
		-apple-system,
		BlinkMacSystemFont,
		'Segoe UI',
		'Microsoft YaHei',
		sans-serif;
	font-size: 13px;
	line-height: 1.5;
}
.tb3perm *,
.tb3perm *::before,
.tb3perm *::after {
	box-sizing: border-box;
}

/* ── 标题 / 一句说明 ── */
.tb3perm__head {
	display: flex;
	flex-direction: column;
	gap: 5px;
}
.tb3perm__title {
	margin: 0;
	font-size: 16px;
	font-weight: 700;
	letter-spacing: -0.01em;
}
.tb3perm__intro {
	margin: 0;
	color: var(--perm-fg-2);
	font-size: 12px;
	line-height: 1.65;
}

/* ══════════════════════════════════════════════════════════
   1. 一条轴 = 一张卡
   ══════════════════════════════════════════════════════════ */

.tb3perm__axis {
	border: 1px solid var(--perm-border);
	border-radius: 10px;
	background: var(--perm-bg);
	overflow: hidden;
}

.tb3perm__axis-head {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 10px;
	padding: 11px 14px 9px;
	border-bottom: 1px solid var(--perm-border);
	background: var(--perm-bg-soft);
}
.tb3perm__axis-title {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	font-size: 13px;
	font-weight: 600;
	color: var(--perm-fg);
}
/* ①② —— 19px 圆形编号，和建卡页的 section 编号同一视觉语言 */
.tb3perm__axis-no {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex: 0 0 auto;
	width: 19px;
	height: 19px;
	border-radius: 50%;
	background: var(--dsw-alias-bg-tertiary, #e4e7ec);
	color: var(--perm-fg-2);
	font-size: 11px;
	font-weight: 700;
	line-height: 1;
}
.tb3perm__axis-current {
	flex: 0 0 auto;
	color: var(--perm-fg-3);
	font-size: 11.5px;
	white-space: nowrap;
}
.tb3perm__axis-current b {
	color: var(--perm-accent);
	font-weight: 600;
}

/* 轴的一句话解释 */
.tb3perm__axis-hint {
	margin: 0;
	padding: 9px 14px 0;
	color: var(--perm-fg-3);
	font-size: 11px;
	line-height: 1.6;
}

/* ══════════════════════════════════════════════════════════
   2. 档位行（整行是 label；原生 radio 透明覆盖）
   ══════════════════════════════════════════════════════════ */

.tb3perm__opts {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 7px;
}

.tb3perm__opt {
	position: relative;
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 9px 10px;
	border: 1px solid transparent;
	border-radius: 8px;
	cursor: pointer;
	transition:
		background 0.12s,
		border-color 0.12s;
}
.tb3perm__opt:hover {
	background: var(--perm-bg-soft);
}

/*
 * ⚠ 选中态用 'border-color + 浅蓝底'，**不用 outline**：
 *   外层 '.tb3perm__axis' 是 'overflow: hidden'，outline 物理上会被裁掉。
 */
.tb3perm__opt.is-selected {
	border-color: var(--perm-accent);
	background: var(--perm-accent-soft);
}
.tb3perm__opt.is-selected:hover {
	border-color: var(--perm-accent);
	background: var(--perm-accent-soft);
}
/* 保存中：保持选中配色，但鼠标变成「等」 */
.tb3perm__opt.is-busy {
	cursor: progress;
}
/* 同一条轴在保存时，其它档位淡下去（不是「坏掉了」，是「等它回来」） */
.tb3perm__opt.is-disabled {
	opacity: 0.55;
	cursor: default;
}
.tb3perm__opt.is-disabled:hover {
	background: transparent;
}

/*
 * 原生 radio：透明覆盖整行 ⇒ 点击热区 = 整行，键盘 / 读屏语义免费拿到。
 * ⚠ 不用 'display: none' —— 那样键盘和读屏都拿不到它。
 */
.tb3perm__opt-input {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	margin: 0;
	opacity: 0;
	cursor: pointer;
}
.tb3perm__opt-input:disabled {
	cursor: default;
}
/* 键盘聚焦：焦点环画在**圆点**上（input 本身不可见） */
.tb3perm__opt-input:focus-visible + .tb3perm__mark {
	outline: 2px solid color-mix(in srgb, var(--perm-accent) 45%, transparent);
	outline-offset: 2px;
}

/* 视觉圆点：14px 环 → 选中变实心蓝 + 白色内点 */
.tb3perm__mark {
	position: relative;
	flex: 0 0 auto;
	width: 14px;
	height: 14px;
	margin-top: 2px;
	border: 1.5px solid var(--perm-border-strong);
	border-radius: 50%;
	background: var(--perm-bg);
	transition:
		border-color 0.12s,
		background 0.12s;
}
.tb3perm__opt.is-selected .tb3perm__mark {
	border-color: var(--perm-accent);
	background: var(--perm-accent);
}
.tb3perm__opt.is-selected .tb3perm__mark::after {
	content: '';
	position: absolute;
	inset: 3px;
	border-radius: 50%;
	background: #fff;
}

/* ── 行内容 ── */
.tb3perm__body {
	display: flex;
	flex-direction: column;
	gap: 3px;
	flex: 1 1 auto;
	min-width: 0;
}
.tb3perm__label-row {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
}
.tb3perm__label {
	font-size: 13px;
	font-weight: 600;
	color: var(--perm-fg);
}
.tb3perm__opt.is-selected .tb3perm__label {
	color: var(--perm-accent-strong);
}
.tb3perm__desc {
	font-size: 11.5px;
	color: var(--perm-fg-2);
	line-height: 1.6;
}

/* 「当前」小胶囊 */
.tb3perm__badge-current {
	flex: 0 0 auto;
	padding: 0 7px;
	border-radius: 999px;
	background: var(--dsw-alias-bg-tertiary, #dbeafe);
	color: var(--perm-accent-strong);
	font-size: 10px;
	font-weight: 600;
	line-height: 16px;
	white-space: nowrap;
}

/* 「保存中…」—— 行尾，带转圈 */
.tb3perm__pending {
	flex: 0 0 auto;
	display: inline-flex;
	align-items: center;
	gap: 5px;
	margin-left: auto;
	padding-left: 8px;
	color: var(--perm-accent);
	font-size: 11px;
	white-space: nowrap;
}

.tb3perm__spinner {
	display: block;
	animation: tb3perm-spin 0.8s linear infinite;
}
@keyframes tb3perm-spin {
	to {
		transform: rotate(360deg);
	}
}

/* ══════════════════════════════════════════════════════════
   3. 保存失败横幅
   ══════════════════════════════════════════════════════════ */

.tb3perm__alert {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	padding: 9px 11px;
	border: 1px solid var(--perm-danger-border);
	border-radius: 8px;
	background: var(--perm-danger-bg);
	color: var(--perm-danger);
	font-size: 12px;
	line-height: 1.6;
}
.tb3perm__alert-icon {
	flex: 0 0 auto;
	margin-top: 3px;
}
.tb3perm__alert-msg {
	flex: 1 1 auto;
	min-width: 0;
}
.tb3perm__alert-close {
	flex: 0 0 auto;
	margin: -2px -2px 0 0;
	padding: 0 4px;
	border: 0;
	border-radius: 4px;
	background: none;
	color: inherit;
	font-family: inherit;
	font-size: 15px;
	line-height: 1.4;
	cursor: pointer;
	opacity: 0.7;
}
.tb3perm__alert-close:hover {
	opacity: 1;
	background: rgb(0 0 0 / 5%);
}

/* ══════════════════════════════════════════════════════════
   4. 加载中（骨架）
   ══════════════════════════════════════════════════════════ */

.tb3perm__loading {
	display: flex;
	flex-direction: column;
	gap: 14px;
}
.tb3perm__skeleton {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 13px 14px 15px;
	border: 1px solid var(--perm-border);
	border-radius: 10px;
	background: var(--perm-bg);
}
.tb3perm__sk-line {
	height: 11px;
	border-radius: 5px;
	background: linear-gradient(90deg, #eef1f5 25%, #f7f9fb 50%, #eef1f5 75%);
	background-size: 200% 100%;
	animation: tb3perm-shimmer 1.2s linear infinite;
}
.tb3perm__sk-line--title {
	width: 34%;
	height: 13px;
}
@keyframes tb3perm-shimmer {
	from {
		background-position: 200% 0;
	}
	to {
		background-position: -200% 0;
	}
}

/* ══════════════════════════════════════════════════════════
   5. 加载失败（虚线 = 空态，不是错误卡片）
   ══════════════════════════════════════════════════════════ */

.tb3perm__load-error {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 9px;
	padding: 20px 16px;
	border: 1px dashed var(--perm-border-strong);
	border-radius: 10px;
	background: var(--perm-bg);
}
.tb3perm__load-error-head {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	color: var(--perm-danger);
	font-size: 13px;
	font-weight: 600;
}
.tb3perm__load-error-title {
	font-weight: 600;
}
.tb3perm__load-error-msg {
	margin: 0;
	color: var(--perm-fg-2);
	font-size: 12px;
	line-height: 1.6;
}
.tb3perm__retry {
	padding: 5px 14px;
	border: 1px solid var(--perm-border-strong);
	border-radius: 7px;
	background: var(--perm-bg);
	color: var(--perm-fg);
	font-family: inherit;
	font-size: 12px;
	cursor: pointer;
	transition:
		border-color 0.12s,
		color 0.12s;
}
.tb3perm__retry:hover {
	border-color: var(--perm-accent);
	color: var(--perm-accent);
}

/* ══════════════════════════════════════════════════════════
   6. 底部正交说明
   ══════════════════════════════════════════════════════════ */

.tb3perm__foot {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 10px 13px;
	border: 1px dashed var(--perm-border-strong);
	border-radius: 9px;
	background: var(--perm-bg-soft);
	color: var(--perm-fg-2);
	font-size: 11.5px;
	line-height: 1.7;
}
.tb3perm__foot b {
	color: var(--perm-fg);
}
.tb3perm__foot-sub {
	color: var(--perm-fg-3);
}
`;
