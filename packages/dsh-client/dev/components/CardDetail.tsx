/**
 * 卡片详情面板（C7）—— **整张卡**的详情。
 *
 * ## 它只做「拼装」
 *
 * 全部显示决定在 `dev/pure/card-detail.ts` 的 `detailTableOf()`（55 条单测）：
 * 标题、meta 五格、动作行、章节、备注、历史 —— 显示什么、按什么顺序、
 * 哪些常驻哪些折叠，**一条都不在这里判**。
 *
 * ```
 * CardDetail
 *  ├ DetailHead      标题行 / 状态+meta 行 / 动作行 / 墓碑横幅
 *  ├ detail-sections 章节（← flatten，直接平铺）
 *  ├ DetailNote      备注（常驻）
 *  └ DetailHistory   历史（**不折叠**，竖直全画）
 * ```
 *
 * ## ⚠ 用户 `2026-11-15` 否定的三件事 → 各自的结构保证
 *
 * | 要求 | 保证方式 |
 * |---|---|
 * | 标题独占一行 | `DetailHead` 里标题是**独立的一行 div**，meta 在**另一个 div**；CDP 量矩形不重叠 |
 * | 状态放最左 | `head.status` 是**独立字段**（不在 `head.meta` 里）+ 固定宽度列 `flex:0 0 92px`；CDP 量 left 且构造超长 label 复测 |
 * | 不要「正文」容器标签 | 章节直接 `map` 进 `.detail-sections`，**没有** `.detail-body` 这种包一层再给标题的节点；全组件无「正文」字符串 |
 * | 备注常驻 | `DetailNote` 无 `visible` 分支（`DetailNoteView.visible` 是字面量 `true`）|
 * | 历史不折叠 | `DetailHistory` 无 `useState`、无折叠按钮；`DetailHistoryView` 类型里没有 `collapsed` 字段 |
 *
 * ## ⚠ 章节渲染：等 C6 `Section` 合并后替换
 *
 * 本文件底部的 `SectionStub` 是**最简版**：章节名 + 文本 / 占位。
 * 真正的 `Section`（text / markdown / ask 的渲染器，831 行旧版逻辑）由另一个成员
 * 在做 C6。这里刻意**不**猜它的 props，只把 `payload` 原样传下去：
 *
 * **payload 形状假设**：卡上 `sections[id] = { label, payload }`（`src/types.ts:44`），
 * `payload` 是不透明结构（`{ $type:'text', value }` 一类）。C6 的 `Section`
 * 应当接 `{ section: { label, payload } }` 自己解释类型。
 * ⇒ 合并后把 `<SectionStub …>` 换成 `<Section …>` 即可，`DetailSection.payload`
 *   已经是**原对象的引用**（单测用 `assert.strictEqual` 钉住这一点）。
 *
 * ## 参数里没有的东西
 *
 * - **状态菜单**（`onTransition`）：菜单归 C4 `StatusMenu`（另一个成员）。
 *   本组件收下 `onTransition` 但**不画菜单** —— 它由外层组装，见 `src/views/CardDetail.tsx`
 *   的 `menu` 参数。这里留回调是为了合并时接得上，不是为了现在能点。
 * - **关系浮层内容**：关系按钮是入口，内容归 C7 之外（关系区还没做）。
 */

import type { ReactNode } from 'react';

import {
	detailTableOf,
	type DetailLabels,
	type DetailSection,
} from '../pure/card-detail.ts';
import type { Card } from '../../src/types.ts';
import { DetailHead } from './DetailHead.tsx';
import { DetailHistory } from './DetailHistory.tsx';
import { DetailNote } from './DetailNote.tsx';

/** 组件属性。 */
export interface CardDetailProps {
	readonly card: Card;
	/** 模板 displayName。 */
	readonly templateLabel: string;
	/** 分类中文名（调用方从模板清单查）。 */
	readonly kindLabel: string;
	/** 状态菜单选了某个转移目标。（菜单归 C4，本组件只留回调。） */
	readonly onTransition: (to: string) => void;
	/** 点「关系 N」。 */
	readonly onAddRelation: () => void;
	/** 点「+ 派生子任务」。 */
	readonly onDerive: () => void;
	/** 备注失焦提交（值没变时不调）。 */
	readonly onNoteChange: (text: string) => void;
	/**
	 * 右上角 ×；省略 = 不显示这个按钮。
	 *
	 * ⚠ 类型是 `?:`（可省略），**不是** `?: (() => void) | undefined` ——
	 *   `exactOptionalPropertyTypes: true` 下前者**不允许**显式传 `undefined`，
	 *   后者允许。两种都合规；选 `?:` 是因为它和任务描述给的参数形状一致，
	 *   而「条件显示」的调用点用条件展开（`...(cond ? {onClose} : {})`）表达，
	 *   意图比传一个 `undefined` 更清楚。
	 */
	readonly onClose?: () => void;
	/** 右上角 ⧉；省略 = 不显示这个按钮。 */
	readonly onExpand?: () => void;
}

/**
 * 卡片详情面板。
 *
 * @param props 见 `CardDetailProps`
 */
export function CardDetail(props: CardDetailProps): ReactNode {
	const labels: DetailLabels = {
		kindLabel: props.kindLabel,
		templateLabel: props.templateLabel,
	};
	const table = detailTableOf(props.card, labels);

	return (
		<div className="detail" data-card-detail data-card-id={props.card.id}>
			<DetailHead
				head={table.head}
				onAddRelation={props.onAddRelation}
				onDerive={props.onDerive}
				onClose={props.onClose}
				onExpand={props.onExpand}
			/>

			{/*
			 * 章节：直接平铺。
			 * ⚠ 用户 `2026-11-15`：「那个『正文』那两个字。存在那里的意义是什么。」
			 *   ⇒ 这里**没有**任何包住所有章节的带标题容器。`detail-sections`
			 *     只是布局用的 flex 列，没有标题、不渲染文字。
			 */}
			<div className="detail-sections" data-detail-sections>
				{table.sections.length === 0 ? (
					<div className="detail-empty" data-sections-empty>
						这张卡的模板没有章节。
					</div>
				) : (
					table.sections.map((section) => <SectionStub key={section.id} section={section} />)
				)}
			</div>

			<DetailNote note={table.note} onNoteChange={props.onNoteChange} />

			{/*
			 * 历史：**不折叠**（用户 `2026-11-18`：「历史自己就是最后了……他没有更后面了」）。
			 * ⚠ 这里**不需要** `key={card.id}` —— 组件已经没有 `useState` 了，
			 *   没有「上一张卡的展开态带过来」这个问题。
			 */}
			<DetailHistory history={table.history} />
		</div>
	);
}

/**
 * ⚠ 等 C6 `Section` 合并后替换（最简版：章节名 + 文本 / 占位）。
 *
 * 这里**只是占位**，故意不叫 `Section`（避免和 C6 的组件重名，合并时一眼能搜到）。
 * payload 原样透传（`DetailSection.payload` 是卡上那个对象的引用）。
 *
 * @param props 一个章节
 */
function SectionStub(props: { readonly section: DetailSection }): ReactNode {
	const section = props.section;
	return (
		<div className="detail-section" data-section-id={section.id}>
			<div className="detail-section__label">{section.label}</div>
			<div className="detail-section__body">
				{section.empty ? <span className="detail-section__empty">（空）</span> : section.text}
			</div>
		</div>
	);
}
