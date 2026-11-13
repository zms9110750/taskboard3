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
	element.textContent = STYLES;
	document.head.appendChild(element);
}
