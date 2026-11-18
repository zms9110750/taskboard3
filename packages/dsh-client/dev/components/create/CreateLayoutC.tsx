/**
 * 新建页 **布局 C：三段式（顶栏固定 / 章节两列网格 / 底栏固定）**。
 *
 * ## 相对 A/B 的取舍
 *
 * | | A 左右分栏 | B 单栏居中 | C 三段式 |
 * |---|---|---|---|
 * | 标题/模板位置 | 左栏 | 顶部，会滚走 | **顶栏固定**，永远可见 |
 * | 章节排布 | 单列 | 单列 | **两列网格** |
 * | 滚动区 | 右栏 | 整页 | **中间区**（顶栏底栏都不动） |
 * | 适合 | 章节多要反复调元信息 | 一次写到底 | 章节多且彼此独立、屏幕宽 |
 *
 * ## ⚠ 两列网格的代价
 *
 * 章节内容长短不一时网格会**参差不齐**（`align-items: start`），
 * 长的那一格把整行撑高，另一列下半截是空的。
 * ⇒ 这是 C 的固有缺点，**不是 bug**。用户挑的时候要看到这一点。
 *
 * ## 布局
 *
 * ```
 * ┌──────────────────────────────────────────────────────┐
 * │ 新建事项                              [取消] [提交]  │ ← 顶栏固定
 * │ 标题 * [                              ]              │
 * │ 模板 [预期不符 ▾]  说明…  E-01                       │
 * ├───────────────────────┬──────────────────────────────┤
 * │ ① 一句话描述          │ ② 期望发生什么               │
 * │ [                  ]  │ ┌──────────────────────┐     │
 * │                       │ │ 源码 | 预览          │     │  ← 中间滚动
 * │                       │ └──────────────────────┘     │
 * ├───────────────────────┼──────────────────────────────┤
 * │ ③ 为什么这么想        │                              │
 * │ ...                   │                              │
 * ├───────────────────────┴──────────────────────────────┤
 * │ 预期不符 · E-01                        [取消][提交]  │ ← 底栏固定
 * └──────────────────────────────────────────────────────┘
 * ```
 */

import type { ReactNode } from 'react';

import { SectionBody, type AskVariant } from './SectionBody.tsx';
import { TemplateField } from './TemplateField.tsx';
import type { CreateHandle } from './useCreateForm.ts';

/** 组件属性。 */
export interface CreateLayoutCProps {
	readonly handle: CreateHandle;
	readonly askVariant: AskVariant;
}

/**
 * 布局 C。
 *
 * @param props 见 `CreateLayoutCProps`
 */
export function CreateLayoutC(props: CreateLayoutCProps): ReactNode {
	const { form, actions } = props.handle;

	return (
		<div className="create create--c">
			<header className="c__top">
				<div className="c__top-row">
					<h2 className="create__h">新建事项</h2>
					<div className="create__buttons">
						<button type="button" className="btn">
							取消
						</button>
						<button type="button" className="btn btn--primary">
							提交
						</button>
					</div>
				</div>
				<div className="c__top-fields">
					<label className="c__title">
						<span className="a__label">
							标题 <b className="req">*</b>
						</span>
						<input
							className="a__input"
							value={form.title}
							placeholder="例如：修好任务板分组为空时的提示"
							onChange={(event) => {
								actions.setTitle(event.target.value);
							}}
						/>
					</label>
					<div className="c__tpl">
						<TemplateField value={form.template} onChange={actions.setTemplate} compact />
					</div>
				</div>
			</header>

			<div className="c__scroll">
				<div className="c__grid">
					{form.template.sections.map((section, index) => (
						<SectionBody
							key={section.id}
							section={section}
							index={index + 1}
							form={form}
							actions={actions}
							askVariant={props.askVariant}
						/>
					))}
				</div>
			</div>

			<footer className="create__foot">
				<span className="create__hint">
					{form.template.displayName} · {form.template.codePrefix}-01
				</span>
				<div className="create__buttons">
					<button type="button" className="btn">
						取消
					</button>
					<button type="button" className="btn btn--primary">
						提交
					</button>
				</div>
			</footer>
		</div>
	);
}
