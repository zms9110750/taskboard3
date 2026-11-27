/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * 左栏骨架 —— **同一个布局里，左栏的几种排法**。
 *
 * ## 用户 `2026-11-19`（本次的关键裁定）
 *
 * > 「我已经决定了用左右分栏的。这个什么居中和三段没用啊。
 * >  **你应该给我演示他左栏的各种样子啊。**
 * >  比如 svg 里面的父任务和模板在一行。
 * >  和我要求的父任务和模板分行。
 * >  和你说的模板选择是分 3 列递进选择还是怎么样。
 * >  **你应该把这些东西的组件演示给我看啊。**
 * >  而且**这个模板选择的点开窗口就应该另外做一个组件了**。」
 *
 * ⇒ 布局（左右分栏）**已经定了**，不再做布局对比。要演示的是**左栏内部**：
 *
 * | 维度 | 可选 |
 * |---|---|
 * | 模板与父任务的排法 | `inline`（同一行）/ `stacked`（分行）|
 * | 模板控件 | `select`（普通下拉）/ `popover`（三级联选弹层）|
 * | 关系·高级设置外壳 | `tabs`（按钮 + 共用折叠区）/ `acc`（手风琴）|
 *
 * ## 三个维度**正交**
 *
 * 它们是三个独立的 prop，不是三个整体变体。理由：用户可能想要
 * 「分行 + 弹层 + 手风琴」这种组合，做成互斥枚举就得再补一个组合项。
 *
 * ⇒ 本组件只负责**竖直拼接**（标题 → 模板/父任务 → 关系/高级设置），
 *   每一块的具体实现都在各自的文件里，**本文件不重复任何一块**。
 *
 * ## 宽度
 *
 * 真产品里左栏 340px（`CreateLayoutFinal`）。展厅里给 320px 固定宽 ——
 * 用户要在**窄栏**里看这些东西，给宽了就是骗人（宽栏里怎么排都好看）。
 */

import { useState, type ReactNode } from 'react';

import type { RelationDraft } from '../../pure/create-meta.ts';
import type { PickableCard } from './CardPicker.tsx';
import { DEFAULT_CATALOG_REF, TEMPLATE_CATALOG, type FakeTemplate } from './data.ts';
import { MetaAccordion } from './MetaAccordion.tsx';
import { MetaTabs } from './MetaTabs.tsx';
import { TemplateFieldInline } from './TemplateFieldInline.tsx';
import { TemplateFieldStacked } from './TemplateFieldStacked.tsx';
import { TemplatePickerPopover } from './TemplatePickerPopover.tsx';
import { TemplateSelect, noteOfTemplate, type TemplateNoteData } from './TemplateField.tsx';

/** 模板与父任务的排法。 */
export type TemplateLayout = 'inline' | 'stacked';

/** 模板控件。 */
export type TemplateControl = 'select' | 'popover';

/** 关系 / 高级设置的外壳。 */
export type MetaShell = 'tabs' | 'acc';

/** 组件属性。 */
export interface CreateLeftColumnProps {
	/** 当前模板（普通下拉的选中项 + 说明块都来自它）。 */
	readonly template: FakeTemplate;
	readonly onChangeTemplate: (ref: string) => void;
	readonly title: string;
	readonly onChangeTitle: (title: string) => void;
	/** 候选卡（父任务 / 关系目标）。 */
	readonly cards: readonly PickableCard[];
	readonly layout: TemplateLayout;
	readonly control: TemplateControl;
	readonly shell: MetaShell;
	/** 初始展开哪个折叠面板（截图 / 演示用）。 */
	readonly initialOpen?: 'rel' | 'adv';
	/** 三级联选弹层初始是否展开（截图用）。 */
	readonly pickerDefaultOpen?: boolean;
}

/**
 * 左栏（可切换排法）。
 *
 * @param props 见 `CreateLeftColumnProps`
 */
export function CreateLeftColumn(props: CreateLeftColumnProps): ReactNode {
	const [parentId, setParentId] = useState('');
	const [relations, setRelations] = useState<readonly RelationDraft[]>([]);

	/* 三级联选弹层的「已选」是目录 ref（18 条真模板），和假模板 ref 是两套 id。 */
	const [pickedCatalog, setPickedCatalog] = useState(DEFAULT_CATALOG_REF);
	const catalogPicked = TEMPLATE_CATALOG.find((one) => one.name === pickedCatalog);

	/*
	 * 说明块的数据来源**跟着控件走**：
	 * - 下拉 ⇒ 选中项就是假模板 `template`（有章节内容）
	 * - 弹层 ⇒ 选中项是目录模板（只有段数，没有章节内容）
	 *
	 * ⚠ 这不是凭空的类型体操：两个控件背后的数据源本来就不同，
	 *   硬把它们凑成同一个类型会逼出一个假字段（比如给目录模板编一段 usage 之外的正文）。
	 */
	const note: TemplateNoteData =
		props.control === 'popover' && catalogPicked !== undefined
			? {
					usage: catalogPicked.usage,
					codePrefix: catalogPicked.codePrefix,
					sectionCount: catalogPicked.sectionCount,
				}
			: noteOfTemplate(props.template);

	const picker: ReactNode =
		props.control === 'popover' ? (
			<TemplatePickerPopover
				pickedRef={pickedCatalog}
				onPick={(one) => {
					setPickedCatalog(one.name);
				}}
				{...(props.pickerDefaultOpen === true ? { defaultOpen: true } : {})}
			/>
		) : (
			<TemplateSelect value={props.template} onChange={props.onChangeTemplate} />
		);

	const templateBlock: ReactNode =
		props.layout === 'inline' ? (
			<TemplateFieldInline
				picker={picker}
				note={note}
				parentId={parentId}
				onParentChange={setParentId}
				cards={props.cards}
			/>
		) : (
			<TemplateFieldStacked
				picker={picker}
				note={note}
				parentId={parentId}
				onParentChange={setParentId}
				cards={props.cards}
			/>
		);

	return (
		<div
			className="leftcol"
			data-layout={props.layout}
			data-control={props.control}
			data-shell={props.shell}
		>
			{/* ── 标题（永远最上面，不参与对比） ── */}
			<label className="leftcol__field">
				<span className="a__label">
					标题 <b className="req">*</b>
				</span>
				<input
					className="a__input"
					value={props.title}
					placeholder="例如：修好任务板分组为空时的提示"
					onChange={(event) => {
						props.onChangeTitle(event.target.value);
					}}
				/>
			</label>

			{/* ── 模板 / 父任务（① ② 的对比点） ── */}
			{templateBlock}

			{/* ── 关系 / 高级设置（⑤ ⑥ 的对比点） ── */}
			{props.shell === 'acc' ? (
				<MetaAccordion
					relations={relations}
					onRelationsChange={setRelations}
					cards={props.cards}
					{...(props.initialOpen === undefined ? {} : { initial: props.initialOpen })}
				/>
			) : (
				<MetaTabs
					relations={relations}
					onRelationsChange={setRelations}
					cards={props.cards}
					{...(props.initialOpen === undefined ? {} : { initial: props.initialOpen })}
				/>
			)}
		</div>
	);
}
