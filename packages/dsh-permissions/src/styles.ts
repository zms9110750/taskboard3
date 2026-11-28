/**
 * 样式 —— 权限面的五段 CSS，一个 `<style>` 运行时注入一次。
 *
 * 形态与 `@taskboard/dsh-client/src/styles.ts` 相同（DSH 客户端产物必须是
 * 一个 JS 文件 ⇒ CSS 写成 TS 字符串常量；颜色全走宿主主题 token）。
 * 这四段从 dsh-client 的 injectStyles 里移过来 —— dsh-client 不再注入它们，
 * 两边的 `STYLE_ID` 不同，互不覆盖。
 *
 * ## 为什么第五段（`FOLD_PILL_CSS`）要从 dsh-client 取
 *
 * issue #56 要求复用 `FoldPill` / `FoldRect`（组件从
 * `@taskboard/dsh-client/fold-pill` 来）。CSS 必须跟着组件走：折叠胶囊的
 * 两态 / 矩形只在展开时存在 / 矩形顶边压住胶囊 —— 这些样式在
 * `@taskboard/dsh-client` 的 `fold-pill-css.ts` 里，是**同一份**
 * （科技树也在用）。这里 import 进来，而不是在本包再抄一遍：
 *
 * - dsh-client 行开着时：两处注入同样的规则（后注入的等价覆盖，无副作用）；
 * - dsh-client 行**关着**时（本包可以独立激活）：胶囊仍然有样式，
 *   不会退化成一颗裸按钮。
 */

import { FOLD_PILL_CSS } from '@taskboard/dsh-client/fold-pill';

import { PERMISSION_CSS } from './renderers/permission-css.ts';
import { PERMISSION_BOX_CSS } from './renderers/permission-box-css.ts';
import { TEMPLATE_AUTH_CSS } from './renderers/tool-permission/template-auth-css.ts';
import { TOOL_PERMISSION_CSS } from './renderers/tool-permission/tool-permission-css.ts';

/** 注入用的 `<style>` 元素的 id（重复注入时用它去重）。 */
export const STYLE_ID = 'taskboard3-permissions-styles';

/** 把样式插进文档（幂等，故意不做清理 —— 全局幂等资源，漏删比多留危险）。 */
export function injectStyles(): void {
	if (typeof document === 'undefined') return;
	if (document.getElementById(STYLE_ID) !== null) return;
	const element = document.createElement('style');
	element.id = STYLE_ID;
	/* ⚠ 必须挂上去：createElement + textContent 只是造了一个游离节点。 */
	element.textContent = `${PERMISSION_CSS}\n${PERMISSION_BOX_CSS}\n${TOOL_PERMISSION_CSS}\n${TEMPLATE_AUTH_CSS}\n${FOLD_PILL_CSS}`;
	document.head.append(element);
}
