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

/**
 * 建卡整页的样式 —— **单独一段，前缀 `tb3cc-`**。
 *
 * ## 为什么不并进下面那张主表
 *
 * 主表的类名是 `tb3-*`，是**任务板面板内部**的（tab 里那套）。建卡页是
 * **`position: fixed` 的全屏页**，它盖在宿主上面 —— 两套样式的作用域完全不同。
 *
 * ⇒ 分开：出问题时能一眼看出「这条规则属于全屏页还是面板内」。
 *
 * ## ⚠ 关键：`.tb3cc-body { min-height: 0 }`
 *
 * flex 子元素默认 `min-height: auto`，会被内容撑高 ⇒ 子元素的
 * `overflow-y: auto` **永远不生效** ⇒ 整页滚动、顶栏底栏跟着滚走。
 * 这是 flex 里最常见的坑，加注释钉住。
 */
export const CREATE_CSS = `
.tb3cc-page{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:var(--dsw-alias-bg-primary,#fff);font-size:13px;line-height:1.5}
.tb3cc-page__top{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--dsw-alias-border-secondary,#e4e7ec)}
.tb3cc-page__title{font-size:16px;margin:0}
.tb3cc-page__close{border:none;background:transparent;font-size:20px;line-height:1;color:var(--dsw-alias-text-secondary,#8a919c);padding:2px 8px;border-radius:6px;cursor:pointer}
.tb3cc-page__close:hover{background:var(--dsw-alias-bg-secondary,#f1f3f6)}
.tb3cc-page__body{flex:1 1 auto;display:flex;min-height:0}
.tb3cc-page__left{flex:0 0 320px;padding:16px 18px;border-right:1px solid var(--dsw-alias-border-secondary,#e4e7ec);background:var(--dsw-alias-bg-secondary,#fafbfc);overflow-y:auto}
.tb3cc-page__right{flex:1 1 auto;padding:16px 20px;overflow-y:auto;min-width:0}
.tb3cc-page__foot{flex:0 0 auto;border-top:1px solid var(--dsw-alias-border-secondary,#e4e7ec);background:var(--dsw-alias-bg-secondary,#fafbfc)}

.tb3cc-sec-list{display:flex;flex-direction:column;gap:12px}
.tb3cc-sec-list__empty{color:var(--dsw-alias-text-secondary,#8a919c);padding:24px 0}
.tb3cc-sec{border:1px solid var(--dsw-alias-border-secondary,#e4e7ec);border-radius:10px;background:var(--dsw-alias-bg-primary,#fff);overflow:hidden}
.tb3cc-sec.has-error{border-color:var(--dsw-alias-border-danger,#f0a8a8)}
.tb3cc-sec__head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 13px;background:var(--dsw-alias-bg-secondary,#fafbfc);border-bottom:1px solid var(--dsw-alias-border-secondary,#eef1f5)}
.tb3cc-sec__title{display:flex;align-items:center;gap:8px;min-width:0}
.tb3cc-sec__no{flex:0 0 auto;width:19px;height:19px;border-radius:50%;background:var(--dsw-alias-bg-tertiary,#e4e7ec);color:var(--dsw-alias-text-secondary,#4b5563);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.tb3cc-sec__label{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb3cc-sec__kind{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}
.tb3cc-sec__kind-label{color:var(--dsw-alias-text-secondary,#6b7280);font-size:12px;white-space:nowrap}
.tb3cc-sec__kind-select{padding:4px 8px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:7px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#1f2328);font-size:12px;outline:none;font-family:inherit}
.tb3cc-sec__kind-select:focus{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.tb3cc-sec__body{padding:12px 13px}
.tb3cc-sec__error{padding:7px 13px;background:var(--dsw-alias-bg-danger,#fdf2f2);border-top:1px solid var(--dsw-alias-border-danger,#f7d4d4);color:var(--dsw-alias-text-danger,#b91c1c);font-size:12px}
.tb3cc-sec__input{width:100%;padding:9px 11px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);border-radius:8px;resize:vertical;outline:none;color:var(--dsw-alias-text-primary,#1f2328);line-height:1.6;font-family:inherit;font-size:13px;box-sizing:border-box}
.tb3cc-sec__input:focus{border-color:var(--dsw-alias-brand-primary,#2563eb)}
.tb3cc-sec__input--markdown{font-family:Consolas,"Courier New",monospace;font-size:12px;line-height:1.65}
.tb3cc-sec__pending{padding:12px 13px;border-radius:8px;background:var(--dsw-alias-bg-secondary,#f4f5f7);border:1px dashed var(--dsw-alias-border-primary,#d7dbe2);color:var(--dsw-alias-text-secondary,#6b7280);font-size:12px;line-height:1.55}

.tb3cc-actions{display:flex;align-items:center;justify-content:space-between;padding:10px 18px}
.tb3cc-actions__msg{color:var(--dsw-alias-text-secondary,#6b7280);font-size:12px}
.tb3cc-actions__err{color:var(--dsw-alias-text-danger,#b91c1c)}
.tb3cc-actions__buttons{display:flex;gap:8px}

.tb3cc-btn{padding:6px 16px;border-radius:7px;border:1px solid var(--dsw-alias-border-primary,#d7dbe2);background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#2b3138);font-weight:500;font-family:inherit;font-size:13px;cursor:pointer}
.tb3cc-btn:hover:not(:disabled){background:var(--dsw-alias-bg-secondary,#f6f7f9)}
.tb3cc-btn:disabled{opacity:.55;cursor:default}
.tb3cc-btn--primary{background:var(--dsw-alias-text-primary,#1f2328);border-color:var(--dsw-alias-text-primary,#1f2328);color:var(--dsw-alias-bg-primary,#fff)}
.tb3cc-btn--primary:hover:not(:disabled){opacity:.88}

.tb3cc-tpl-hint{padding:9px 11px;border-radius:8px;background:var(--dsw-alias-bg-secondary,#f6f8fb);border:1px solid var(--dsw-alias-border-secondary,#e6eaf0)}
.tb3cc-tpl-hint.is-empty{border-style:dashed}
.tb3cc-tpl-hint__empty{color:var(--dsw-alias-text-secondary,#a6adb8)}
.tb3cc-tpl-hint__usage{color:var(--dsw-alias-text-secondary,#4b5563);margin-bottom:6px;font-size:12px;line-height:1.55}
.tb3cc-tpl-hint__meta{display:flex;justify-content:space-between;gap:10px;color:var(--dsw-alias-text-secondary,#6b7280);font-size:11px;flex-wrap:wrap}
`;

/**
 * 全部类名 —— **单一来源**。
 *
 * 组件里只用 `CLS.xxx`，不写字面量。写错类名的后果是样式静默失效
 * （不是报错），所以这里集中一处，改名字只需改这里 + CSS。
 */
export const CLS = {
	board: 'tb3-board',
	topbar: 'tb3-topbar',
	select: 'tb3-select',
	btn: 'tb3-btn',
	error: 'tb3-error',
	errorText: 'tb3-error-text',
	body: 'tb3-body',
	list: 'tb3-list',
	detail: 'tb3-detail',
	row: 'tb3-row',
	rowSelected: 'tb3-row-selected',
	rowId: 'tb3-row-id',
	rowTitle: 'tb3-row-title',
	rowTitleDone: 'tb3-row-title-done',
	badge: 'tb3-badge',
	badgeActive: 'tb3-badge-active',
	badgeShelved: 'tb3-badge-shelved',
	badgeEnded: 'tb3-badge-ended',
	detailHead: 'tb3-detail-head',
	detailTitle: 'tb3-detail-title',
	meta: 'tb3-meta',
	section: 'tb3-section',
	sectionLabel: 'tb3-section-label',
	sectionBody: 'tb3-section-body',
	note: 'tb3-note',
	menuWrap: 'tb3-menu-wrap',
	menu: 'tb3-menu',
	menuItem: 'tb3-menu-item',
	menuEmpty: 'tb3-menu-empty',
	empty: 'tb3-empty',
} as const;

/**
 * 全部样式。
 *
 * ⚠ 这是唯一一处写样式的地方。组件里只用类名字符串。
 */
export const STYLES = `
.tb3-board {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: var(--dsh-content-font-size, 14px);
  color: var(--dsw-alias-text-primary);
  container-type: inline-size;
}

.tb3-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  flex: none;
  border-bottom: 1px solid var(--dsw-alias-border-subtle);
}

.tb3-select {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-subtle);
  background: var(--dsw-alias-bg-raised);
  color: var(--dsw-alias-text-primary);
  font: inherit;
}

.tb3-btn {
  flex: none;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-subtle);
  background: transparent;
  color: var(--dsw-alias-text-secondary);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.tb3-btn:hover:not(:disabled) {
  background: var(--dsw-alias-bg-hover);
  color: var(--dsw-alias-text-primary);
}

.tb3-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.tb3-error {
  margin: 8px 12px 0;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-subtle);
  background: var(--dsw-alias-bg-raised);
  color: var(--dsw-alias-text-primary);
  font-size: 0.9em;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex: none;
}

.tb3-error-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.tb3-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.tb3-list {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 8px;
}

.tb3-detail {
  flex: 1.2;
  min-width: 0;
  overflow-y: auto;
  padding: 12px;
  border-left: 1px solid var(--dsw-alias-border-subtle);
}

@container (max-width: 560px) {
  .tb3-body {
    flex-direction: column;
  }
  .tb3-detail {
    border-left: none;
    border-top: 1px solid var(--dsw-alias-border-subtle);
  }
}

.tb3-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tb3-row:hover {
  background: var(--dsw-alias-bg-hover);
}

.tb3-row-selected {
  border-color: var(--dsw-alias-border-subtle);
  background: var(--dsw-alias-bg-hover);
}

.tb3-row-id {
  flex: none;
  font-family: var(--dsh-code-font-family, monospace);
  font-size: 0.85em;
  color: var(--dsw-alias-text-tertiary);
  min-width: 4em;
}

.tb3-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tb3-row-title-done {
  text-decoration: line-through;
  opacity: 0.7;
}

.tb3-badge {
  flex: none;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.8em;
  line-height: 1.6;
  border: 1px solid var(--dsw-alias-border-subtle);
  background: var(--dsw-alias-bg-raised);
  color: var(--dsw-alias-text-secondary);
  white-space: nowrap;
}

.tb3-badge-active {
  background: var(--dsw-alias-bg-hover);
  color: var(--dsw-alias-text-primary);
}

.tb3-badge-shelved {
  border-style: dashed;
  color: var(--dsw-alias-text-primary);
}

.tb3-badge-ended {
  opacity: 0.65;
}

.tb3-detail-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 4px;
}

.tb3-detail-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 1.05em;
  font-weight: 600;
  word-break: break-word;
}

.tb3-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 0.85em;
  color: var(--dsw-alias-text-tertiary);
}

.tb3-section {
  margin-bottom: 12px;
}

.tb3-section-label {
  font-size: 0.85em;
  color: var(--dsw-alias-text-tertiary);
  margin-bottom: 4px;
}

.tb3-section-body {
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-raised);
  white-space: pre-wrap;
  word-break: break-word;
}

.tb3-note {
  font-size: 0.9em;
  color: var(--dsw-alias-text-secondary);
  white-space: pre-wrap;
}

.tb3-menu-wrap {
  position: relative;
  flex: none;
}

.tb3-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  min-width: 8em;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-subtle);
  background: var(--dsw-alias-bg-raised);
  box-shadow: 0 4px 16px rgb(0 0 0 / 20%);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tb3-menu-item {
  padding: 5px 10px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.tb3-menu-item:hover:not(:disabled) {
  background: var(--dsw-alias-bg-hover);
}

.tb3-menu-item:disabled {
  opacity: 0.5;
  cursor: default;
}

.tb3-menu-empty {
  padding: 5px 10px;
  color: var(--dsw-alias-text-tertiary);
  white-space: nowrap;
}

.tb3-empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--dsw-alias-text-tertiary);
  font-size: 0.9em;
}
`;

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
	 * ⚠ 两段都注入：`STYLES` 是面板内的（`tb3-*`），`CREATE_CSS` 是全屏建卡页的（`tb3cc-*`）。
	 *   合成一个 `<style>` 而不是两个 —— 少一个 DOM 节点，而且去重逻辑只需要管一个 id。
	 */
	element.textContent = `${STYLES}\n${CREATE_CSS}`;
	document.head.appendChild(element);
}
