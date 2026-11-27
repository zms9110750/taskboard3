/**
 * @deprecated 展厅副本 —— 冻结保存，**不要在这里改行为**。
 *
 * `dev/` 的这一批文件是 `dev/README.md` 明示的冻结展厅副本：产品版在
 * `src/renderers/create/` / `src/pure/`，两边不共享代码。改行为只改 `src/` 那份；
 * 本文件存在只为展厅还能构建、还能回看当时挑的是什么。
 */
/**
 * 左栏的「元数据」块：**父任务 + 两个折叠标签** —— `CreateLayoutFinal` 用的组合体。
 *
 * ## 用户原话（`2026-11-18`）
 *
 * > 「新建任务卡肯定是左右分栏的。重点是左边他摆什么东西。
 * >  原来是这样的
 * >  标题：/ 模板：/ 父任务：/ 关系|高级设置
 * >  关系和高级设置是两个按钮。点开了，在下面会有额外内容。
 * >  也就是说他们的内容是折叠的而且共用展示的。」
 *
 * ⚠ **顺序是竖的**：标题 → 模板 → 父任务 → [关系|高级设置] → 折叠区。
 *   `ux-review/create-modal-height.png` 的旧建议是「模板 / 父任务」横排一行，
 *   **那个已作废**（那是 2026-11-10 的建议）。
 *
 * ## ⚠ 本文件现在是**组合体**，不再承载判决逻辑
 *
 * 展厅要对比「折叠区怎么藏」的两种外壳（⑤ `MetaTabs` / ⑥ `MetaAccordion`），
 * 还要对比「模板和父任务怎么排」（① 同行 / ② 分行）。也能对比「父任务放在哪」。
 *
 * ⇒ 判决（三值 `active`）在 `dev/pure/create-meta.ts`，
 *   面板内容在 `MetaPanelContent.tsx`，
 *   折叠外壳在 `MetaTabs.tsx` / `MetaAccordion.tsx`。
 *   **本文件只负责「父任务字段 + 外壳」的竖直拼接**，不重复任何一块的实现。
 */

import type { ReactNode } from 'react';

import type { RelationDraft } from '../../pure/create-meta.ts';
import { CardPicker, type PickableCard } from './CardPicker.tsx';
import { MetaTabs } from './MetaTabs.tsx';

/** 组件属性。 */
export interface CreateMetaProps {
	/** 父任务卡 id（空串 = 顶层）。 */
	readonly parentId: string;
	readonly onParentChange: (cardId: string) => void;
	/** 关系草稿（受控，父层持有）。 */
	readonly relations: readonly RelationDraft[];
	readonly onRelationsChange: (rows: readonly RelationDraft[]) => void;
	/** 候选卡（当前空间的全部卡，`CardPicker` 自己过滤）。 */
	readonly cards: readonly PickableCard[];
}

/**
 * 左栏元数据块（父任务 + 关系/高级设置）。
 *
 * @param props 见 `CreateMetaProps`
 */
export function CreateMeta(props: CreateMetaProps): ReactNode {
	return (
		<div className="meta-host">
			{/* 父任务 —— combobox，不是 select（要能输入筛选） */}
			<div className="meta__field">
				<label className="a__label">父任务</label>
				<CardPicker
					value={props.parentId}
					cards={props.cards}
					placeholder="（无，顶层）"
					allowEmpty
					onChange={props.onParentChange}
				/>
			</div>

			<MetaTabs
				relations={props.relations}
				onRelationsChange={props.onRelationsChange}
				cards={props.cards}
			/>
		</div>
	);
}

