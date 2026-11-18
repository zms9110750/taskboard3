/**
 * 模板说明块 —— 选中模板后**常显**的三行信息。
 *
 * ## 为什么常显（不是弹层里看一次）
 *
 * `ux-review/create-modal-height.png` 第 ③ 条：
 *
 * > 模板说明常驻在选择器下方：一句话说明 + 编号前缀 + 段数
 * > 现状是「现在只在弹层里看得到，选完就消失」。
 *
 * ⇒ 选完模板之后，用户要能一直看到「这个模板有几段、编号长什么样」。
 */

import type { ReactNode } from 'react';

import type { FormTemplate } from './useCreateForm.ts';

/** 组件属性。 */
export interface TemplateHintProps {
	/** 当前模板（`undefined` = 还没选）。 */
	readonly template: FormTemplate | undefined;
}

/**
 * 模板说明。
 *
 * @param props 见 `TemplateHintProps`
 */
export function TemplateHint(props: TemplateHintProps): ReactNode {
	const template = props.template;
	if (template === undefined) {
		return (
			<div className="create-tpl-hint is-empty">
				<span className="create-tpl-hint__empty">还没选模板。</span>
			</div>
		);
	}

	return (
		<div className="create-tpl-hint">
			<div className="create-tpl-hint__usage">{template.usage}</div>
			<div className="create-tpl-hint__meta">
				<span>
					编号前缀 <b>{template.codePrefix}</b> · 形如 <code>{template.codePrefix}-01</code>
				</span>
				<span>共 {template.sections.length} 段</span>
			</div>
		</div>
	);
}
