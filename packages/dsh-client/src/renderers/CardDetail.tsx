/**
 * 卡片详情面板（C7）—— **整张卡**的详情。
 *
 * ## 它只做「拼装」
 *
 * 全部显示决定在 `pure/card-detail.ts` 的 `detailTableOf()`（55 条单测）：
 * 标题、meta 五格、动作行、章节、备注、历史 —— 显示什么、按什么顺序、
 * 哪些常驻哪些折叠，**一条都不在这里判**。
 *
 * ```
 * CardDetail
 *  ├ DetailHead      标题行 / 状态+meta 行 / 动作行（含关系面板）/ 墓碑横幅
 *  ├ detail-sections 章节（各自一个定稿 Section）
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
 * ## 章节：定稿 `Section`（`2026-11-20` 接上，`SectionStub` 已删）
 *
 * 章节内容不在这里解释 —— `DetailSection` 经 `pure/section-adapter.ts` 的
 * `sectionInputOf()` 转成 `Section` 的输入，由 `Section` 按 payload 的 `$type`
 * 自己分派 text / markdown / ask / 未知降级（解析只有 `pure/section.ts` 一处）。
 * 这里是**纯形状适配**，不在 JSX 里拼对象、不读 `DetailSection.text`。
 *
 * ⚠ 章节的**编辑 / ask 回答**还没接线（`api.patchCard` 在，但外层没有回调）
 *   ⇒ 这里传 `readonly`。只读时 `AskSection` 把选项渲染成 `div`（不假装能点），
 *   空章节显示「（空）」而不是模板的编辑提示。接编辑时把 `readonly` 换成
 *   卡状态 / 回调判断即可，组件本身不用改。
 *
 * ## 参数里没有的东西
 *
 * - **状态菜单**（`onTransition`）：菜单归 C4 `StatusMenu`（另一个成员）。
 *   本组件收下 `onTransition` 但**不画菜单** —— 它由外层组装，见 `src/views/CardDetail.tsx`
 *   的 `menu` 参数。这里留回调是为了合并时接得上，不是为了现在能点。
 * - **章节编辑 / ask 回答**：见上（还没接线）。
 */

import type { ReactNode } from 'react';

import { detailTableOf, type DetailLabels } from '../pure/card-detail.ts';
import type { RelationsView } from '../pure/relations-block.ts';
import { sectionInputOf } from '../pure/section-adapter.ts';
import type { Card } from '../types.ts';
import { DetailHead } from './DetailHead.tsx';
import { DetailHistory } from './DetailHistory.tsx';
import { DetailNote } from './DetailNote.tsx';
import { Section } from './Section.tsx';

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
	/**
	 * 关系面板数据（`relationsOf(card, allCards, statusGroupOf)`）。
	 *
	 * ⚠ 由**调用方**算（本组件只有一张卡，反查入边需要全量卡列表）。
	 *   省略 ⇒ `DetailHead` 退回旧的「关系」按钮行（老预览不受影响）。
	 */
	readonly relations?: RelationsView;
	/** 点关系卡 / 父任务卡。省略 = 面板里的卡不跳转。 */
	readonly onJumpRelation?: (cardId: string) => void;
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
	/*
	 * 章节的渲染输入在**这里**一次算好：
	 * 形状适配是纯函数（`sectionInputOf`），JSX 里只剩「按 id 画一个 Section」。
	 * ⚠ 不读 `table.sections[i].text` —— 内容由 Section 按 payload 自己解释。
	 */
	const sections = table.sections.map((one) => sectionInputOf(one));

	return (
		<div className="detail" data-card-detail data-card-id={props.card.id}>
			{/*
			 * ⚠ `key={card.id}`：关系面板的展开态是**组件自持**的（未受控），
			 *   切卡时重挂一次才会收起 —— 和原版 `renderDetail` 重跑时
			 *   `expanded` 自然归 false 一致。标题/meta 没有 state，重挂无副作用。
			 */}
			{/*
			 * 两个「可省略」的 props 在 `CardDetail` 上是 `?:`，到 `DetailHead` 上
			 * 写成「必选但可为 undefined」（`exactOptionalPropertyTypes` 的经典写法，
			 * 见 `onClose` 的注释）⇒ 这里直接透传，不用条件展开。
			 */}
			<DetailHead
				key={props.card.id}
				head={table.head}
				onAddRelation={props.onAddRelation}
				onDerive={props.onDerive}
				relations={props.relations}
				onJumpRelation={props.onJumpRelation}
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
				{sections.length === 0 ? (
					<div className="detail-empty" data-sections-empty>
						这张卡的模板没有章节。
					</div>
				) : (
					sections.map((one) => (
						/*
						 * 定稿 `Section`：text / markdown / ask / 未知降级都在它内部按 payload 分派。
						 * `readonly` 的原因见文件头「章节：定稿 Section」那一节
						 * （编辑 / ask 回答还没接线 ⇒ 不假装能点）。
						 */
						<Section
							key={one.sectionId}
							sectionId={one.sectionId}
							section={one.section}
							readonly={true}
						/>
					))
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
