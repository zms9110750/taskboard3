/**
 * 样式 —— 权限面的四段 CSS，一个 `<style>` 运行时注入一次。
 *
 * 形态与 `@taskboard/dsh-client/src/styles.ts` 相同（DSH 客户端产物必须是
 * 一个 JS 文件 ⇒ CSS 写成 TS 字符串常量；颜色全走宿主主题 token）。
 * 这四段从 dsh-client 的 injectStyles 里移过来 —— dsh-client 不再注入它们，
 * 两边的 `STYLE_ID` 不同，互不覆盖。
 */

import { PERMISSION_CSS } from './renderers/permission-css.ts';
import { PERMISSION_BOX_CSS } from './renderers/permission-box-css.ts';
import { TOOL_PERMISSION_CSS } from './renderers/tool-permission/tool-permission-css.ts';
import { TEMPLATE_AUTH_CSS } from './renderers/tool-permission/template-auth-css.ts';

/** 注入用的 `<style>` 元素的 id（重复注入时用它去重）。 */
export const STYLE_ID = 'taskboard3-permissions-styles';

/** 把样式插进文档（幂等，故意不做清理 —— 全局幂等资源，漏删比多留危险）。 */
export function injectStyles(): void {
	if (typeof document === 'undefined') return;
	if (document.getElementById(STYLE_ID) !== null) return;
	const element = document.createElement('style');
	element.id = STYLE_ID;
	/* ⚠ 必须挂上去：createElement + textContent 只是造了一个游离节点。 */
	element.textContent = `${PERMISSION_CSS}\n${PERMISSION_BOX_CSS}\n${TOOL_PERMISSION_CSS}\n${TEMPLATE_AUTH_CSS}`;
	document.head.append(element);
}
