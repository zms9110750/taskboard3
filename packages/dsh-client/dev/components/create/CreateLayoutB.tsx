/**
 * 新建页 **布局 B：单栏居中**。
 *
 * 最像文档编辑器（Notion / Obsidian 那种）：一个约 760px 的列，
 * 从上到下自然滚动，没有独立的侧栏和滚动区。
 *
 * ## 相对 A 的取舍
 *
 * | | A 左右分栏 | B 单栏居中 |
 * |---|---|---|
 * | 横向空间 | 左栏占 300px，章节区更窄 | 章节区拿到全部宽度（上限 760） |
 * | 滚动 | 右栏独立滚动，左栏不动 | **整页滚动**，标题会滚出去 |
 * | 心流 | 左边随时能改标题/模板 | 标题滚出视口后要滚回去改 |
 * | 适合 | 章节多、需要反复调元信息 | 章节少、一次写到底 |
 *
 * ## 布局
 *
 * ```
 * ┌──────────────────────────────────────────────┐
 * │              ┌────────────────────────┐      │
 * │              │ 新建事项           ×   │      │
 * │              │                        │      │
 * │              │ 标题 *                 │      │
 * │              │ [                    ] │      │
 * │              │                        │      │
 * │              │ 模板                   │      │
 * │              │ [预期不符 ▾]           │  ← 760 上限
 * │              │ 说明…                  │      │
 * │              │                        │      │
 * │              │ ① 一句话描述  [类型▾] │      │
 * │              │ [                    ] │      │
 * │              │                        │      │
 * │              │ ② 期望发生什么         │      │
 * │              │ ...                    │      │
 * │              │                        │      │
 * │              │      [取消] [提交]     │      │
 * │              └────────────────────────┘      │
 * └──────────────────────────────────────────────┘
 * ```
 */

import type { ReactNode } from 'react';

import { SectionBody, type AskVariant } from './SectionBody.tsx';
import { TemplateField } from './TemplateField.tsx';
import type { CreateHandle } from './useCreateForm.ts';

/** 组件属性。 */
export interface CreateLayoutBProps {
	readonly handle: CreateHandle;
	readonly askVariant: AskVariant;
}

/**
 * 布局 B。
 *
 * @param props 见 `CreateLayoutBProps`
 */
export function CreateLayoutB(props: CreateLayoutBProps): ReactNode {
	const { form, actions } = props.handle;

	return (
		<div className="create create--b">
			<div className="b__scroll">
				<div className="b__col">
					<header className="b__top">
						<h2 className="create__h">新建事项</h2>
						<button type="button" className="create__close" title="关闭">
							×
						</button>
					</header>

					<label className="b__field">
						<span className="a__label">
							标题 <b className="req">*</b>
						</span>
						<input
							className="b__title"
							value={form.title}
							placeholder="例如：修好任务板分组为空时的提示"
							onChange={(event) => {
								actions.setTitle(event.target.value);
							}}
						/>
					</label>

					<TemplateField value={form.template} onChange={actions.setTemplate} />

					<div className="b__sections">
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

					<div className="b__buttons">
						<button type="button" className="btn">
							取消
						</button>
						<button type="button" className="btn btn--primary">
							提交
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
