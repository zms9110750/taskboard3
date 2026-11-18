/**
 * 模板说明块 —— 选中模板后**常显**的三行信息。
 *
 * ## 为什么常显（不是弹层里看一次就没了）
 *
 * `ux-review/create-modal-height.png` 第 ③ 条：
 *
 * > 模板说明常驻在选择器下方：一句话说明 + 编号前缀 + 段数
 * > 现状是「现在只在弹层里看得到，选完就消失」。
 *
 * ⇒ 选完模板之后，用户要能一直看到「这个模板有几段、编号长什么样」。
 *
 * ## ⚠ 三个字段都是**可选**的，拿不到就不显示，不编
 *
 * `GET /api/state` 的 `TemplateSummary` 只有 `ref` / `displayName` / `kind` / `domain` /
 * `codePrefix` —— **没有 `usage`，也没有段数**。那两个要 `GET /api/templates?ref=`
 * （core 的 `TemplateMeta`）。
 *
 * ⇒ 本组件收 `TemplateHintData`（全可选）。调用方补到哪一步就显示到哪一步：
 *   还没取详情时只显示「编号前缀」，不假装知道段数。
 *   这比编一个「共 0 段」诚实 —— 用户会以为模板真的没有章节。
 */

import type { ReactNode } from 'react';

/**
 * 说明块要的数据 —— **全部可选**。
 *
 * ⚠ 不用 `FormTemplate` / `PickerTemplate` 当参数：说明块的来源有好几处
 *   （摘要 / 详情 / 预览假数据），形状不一样。只认这三个值，谁都能喂。
 */
export interface TemplateHintData {
	/** 一句话说明（来自模板详情；摘要里没有）。 */
	readonly usage?: string;
	/** 编号字母段（来自摘要）。空串 = 该模板不提供字母段（**合法值**）。 */
	readonly codePrefix?: string;
	/** 段数（来自模板详情；摘要里没有）。 */
	readonly sectionCount?: number;
}

/** 组件属性。 */
export interface TemplateHintProps {
	/** 选中模板的说明数据；`undefined` = 还没选模板。 */
	readonly data: TemplateHintData | undefined;
	/** 错误文案（挂在说明块下面）。 */
	readonly error?: string;
}

/**
 * 模板说明。
 *
 * @param props 见 `TemplateHintProps`
 */
export function TemplateHint(props: TemplateHintProps): ReactNode {
	const data = props.data;

	if (data === undefined) {
		return (
			<div className="tb3cc-tpl-hint is-empty">
				<span className="tb3cc-tpl-hint__empty">还没选模板。</span>
				{props.error === undefined ? null : (
					<div className="tb3cc-field-err">{props.error}</div>
				)}
			</div>
		);
	}

	/* ⚠ 空串是**合法**前缀（= 该模板不提供字母段），显示成「—」，不拼出 `-01`。 */
	const prefix = data.codePrefix === undefined || data.codePrefix === '' ? '—' : data.codePrefix;

	return (
		<div className="tb3cc-tpl-hint">
			{data.usage === undefined ? null : (
				<div className="tb3cc-tpl-hint__usage">{data.usage}</div>
			)}
			<div className="tb3cc-tpl-hint__meta">
				<span>
					编号前缀 <b>{prefix}</b>
					{data.codePrefix === undefined || data.codePrefix === '' ? (
						' · 由系统分配'
					) : (
						<>
							{' · 形如 '}
							<code>{`${data.codePrefix}-01`}</code>
						</>
					)}
				</span>
				{data.sectionCount === undefined ? null : <span>共 {data.sectionCount} 段</span>}
			</div>
			{props.error === undefined ? null : <div className="tb3cc-field-err">{props.error}</div>}
		</div>
	);
}
