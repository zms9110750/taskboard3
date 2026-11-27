/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * 新建页 **布局 A：左右分栏**。
 *
 * 最接近旧版（旧版是 `overlay > dialog > left/right`），但有三处关键差别：
 *
 * | 旧版 | 这一版 |
 * |---|---|
 * | 模态框，高度写死 720px | **满屏**（`inset: 0`），高度跟着视口 |
 * | 内容少时一大片空白 | 右栏独立滚动，空白只在右栏底部（可接受） |
 * | 「正文」容器标签 | **没有**（用户 2026-11-15 否定过） |
 *
 * ## 布局
 *
 * ```
 * ┌──────────────────────────────────────────────────────┐
 * │ 新建事项                                        ×    │  ← 顶栏
 * ├──────────────┬───────────────────────────────────────┤
 * │ 标题 *       │  1 一句话描述          [内容类型 ▾]   │
 * │ [         ]  │  [                                  ] │
 * │              │                                       │
 * │ 模板         │  2 期望发生什么        [内容类型 ▾]   │
 * │ [预期不符 ▾] │  ┌─────────────────────────────────┐ │
 * │ 说明…        │  │ 源码 | 预览                     │ │  ← 右栏独立滚动
 * │ 编号前缀 E   │  └─────────────────────────────────┘ │
 * │              │                                       │
 * │ 关系 0       │  3 为什么这么想        [内容类型 ▾]   │
 * │ 高级设置     │  ...                                  │
 * ├──────────────┴───────────────────────────────────────┤
 * │ 预期不符 · E-01            [取消]  [提交]             │  ← 底栏
 * └──────────────────────────────────────────────────────┘
 * ```
 */

import type { ReactNode } from 'react';

import { SectionBody, type AskVariant } from './SectionBody.tsx';
import { TemplateField } from './TemplateField.tsx';
import type { CreateHandle } from './useCreateForm.ts';

/** 组件属性。 */
export interface CreateLayoutAProps {
	readonly handle: CreateHandle;
	readonly askVariant: AskVariant;
}

/**
 * 布局 A。
 *
 * @param props 见 `CreateLayoutAProps`
 */
export function CreateLayoutA(props: CreateLayoutAProps): ReactNode {
	const { form, actions } = props.handle;

	return (
		<div className="create create--a">
			<header className="create__top">
				<h2 className="create__h">新建事项</h2>
				<button type="button" className="create__close" title="关闭">
					×
				</button>
			</header>

			<div className="a__body">
				<aside className="a__side">
					<label className="a__field">
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

					<TemplateField
						value={form.template}
						onChange={actions.setTemplate}
						compact
					/>

					<div className="a__extra">
						<button type="button" className="ghost">
							关系 0
						</button>
						<button type="button" className="ghost">
							高级设置
						</button>
					</div>
				</aside>

				<main className="a__main">
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
				</main>
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
