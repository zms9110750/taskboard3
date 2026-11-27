/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * 新建页 **最终布局：左右分栏**（用户 `2026-11-18` 定稿的方向）。
 *
 * ## 用户原话
 *
 * > 「新建任务卡肯定是左右分栏的。重点是左边他摆什么东西。
 * >  原来是这样的
 * >  标题：
 * >  模板：
 * >  父任务：
 * >  关系|高级设置
 * >  关系和高级设置是两个按钮。点开了，在下面会有额外内容。
 * >  也就是说他们的内容是折叠的而且共用展示的。」
 *
 * ## 左栏（严格按这个顺序，**竖着**）
 *
 * ```
 * 标题：      [_______________________]
 * 模板：      [预期不符 ▾]
 *             [说明块              共 3 段]
 * 父任务：    [（无，顶层）        ⌄]
 *             [关系 0] [高级设置]      ← 两个按钮
 *             ┌─────────────────────┐
 *             │ 折叠区（共用一块位置）│      ← 互斥、可再点收起
 *             └─────────────────────┘
 * ```
 *
 * ⚠ **模板和父任务不横排。** `ux-review/create-modal-height.png` 的旧建议
 *   （2026-11-10）把这两个放同一行，**那个已作废** —— 用户刚说了竖着。
 *
 * ## 右栏
 *
 * 章节表单，独立滚动。
 *
 * ## 相对展厅里的 A 改了什么
 *
 * | | 展厅 A | 本文件 |
 * |---|---|---|
 * | 左栏宽度 | 300px | **340px**（父任务 combobox 要更宽才放得下卡标题） |
 * | 元信息 | 标题 / 模板 / 关系·高级设置按钮（没面板） | **补全了父任务 + 折叠面板** |
 * | 左栏滚动 | `overflow-y: auto` | 同（折叠区展开后可能超屏） |
 */

import { useState, type ReactNode } from 'react';

import type { PickableCard } from './CardPicker.tsx';
import { CreateMeta } from './CreateMeta.tsx';
import { SectionBody, type AskVariant } from './SectionBody.tsx';
import { TemplateField } from './TemplateField.tsx';
import type { CreateHandle } from './useCreateForm.ts';
import type { RelationDraft } from '../../pure/create-meta.ts';

/** 组件属性。 */
export interface CreateLayoutFinalProps {
	readonly handle: CreateHandle;
	readonly askVariant: AskVariant;
	/** 候选卡（父任务 / 关系目标）。 */
	readonly cards: readonly PickableCard[];
}

/**
 * 最终布局（左右分栏）。
 *
 * @param props 见 `CreateLayoutFinalProps`
 */
export function CreateLayoutFinal(props: CreateLayoutFinalProps): ReactNode {
	const { form, actions } = props.handle;

	/* 父任务与关系是**本布局自己的状态** —— 展厅其它布局不用它们。 */
	const [parentId, setParentId] = useState('');
	const [relations, setRelations] = useState<readonly RelationDraft[]>([]);

	return (
		<div className="create create--final">
			<header className="create__top">
				<h2 className="create__h">新建事项</h2>
				<button type="button" className="create__close" title="关闭">
					×
				</button>
			</header>

			<div className="final__body">
				{/* ── 左栏：元数据（竖着，按用户说的顺序） ── */}
				<aside className="final__side">
					<label className="final__field">
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

					<div className="final__field">
						<TemplateField value={form.template} onChange={actions.setTemplate} compact />
					</div>

					{/* 父任务 + 关系/高级设置折叠区 */}
					<CreateMeta
						parentId={parentId}
						onParentChange={setParentId}
						relations={relations}
						onRelationsChange={setRelations}
						cards={props.cards}
					/>
				</aside>

				{/* ── 右栏：章节表单，独立滚动 ── */}
				<main className="final__main">
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
					{parentId === '' ? '' : ` · 父任务 ${parentId}`}
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
