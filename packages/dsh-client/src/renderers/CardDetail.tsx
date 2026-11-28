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
 * ⚠ **章节的编辑 / ask 回答已接线**（lead `2026-11-28`，#9 动机 1.i 的用户侧闭环）。
 *
 * 判决在 `pure/section-edit.ts`，这里只把「能不能编辑」翻成 `readonly` / 回调：
 *
 * | 阶段（#10 三相位）| 卡状态（protocol 分组）| text | ask | markdown |
 * |---|---|---|---|---|
 * | 可编辑 | `draft`（草稿 / 未采纳）| 失焦提交 | 可作答 | **只读**（见下）|
 * | 交互 | `active` / `shelved`（提交 / 处理中 / 搁置）| 失焦提交 | 点选即提交 | 只读 |
 * | 冻结 | `ended`（成功 / 失败 / 取消 / 拒绝）| 只读 | 只读展示 | 只读 |
 * | 墓碑 | `deleted`（状态可能还没到终态）| 只读 | 只读展示 | 只读 |
 *
 * markdown 在 #10 的「可编辑期」本来可以改源码 + 预览，但那是**建卡页**的交互；
 * 详情页不是建卡页 ⇒ lead 裁定详情里的 md **永远只读**（`sectionEditableOf()`）。
 *
 * 一次 text 失焦 / 一次 ask 动作 ⇒ 一次 `onSectionChange(sectionId, patch)`。
 * ask 的补丁由 `askPayloadAfter()`（内部就是 `applyAskAction()`）从当前 payload
 * 算出新 payload；外层负责拿**当前全部章节**组装成 `content` 再调
 * `api.patchCard`（服务端整份覆盖，见 `pure/section-edit.ts` 的 `contentOfSections()`）。
 *
 * ## 参数里没有的东西
 *
 * - **状态菜单**（`onTransition`）：菜单归 C4 `StatusMenu`（另一个成员）。
 *   本组件收下 `onTransition` 但**不画菜单** —— 它由外层组装，见 `src/views/CardDetail.tsx`
 *   的 `menu` 参数。这里留回调是为了合并时接得上，不是为了现在能点。
 */

import type { ReactNode } from 'react';

import { detailTableOf, type DetailLabels } from '../pure/card-detail.ts';
import type { RelationsView } from '../pure/relations-block.ts';
import { isDraftStatus, isEndedStatus } from '../pure/card-view.ts';
import { askPayloadAfter, payloadKindOf, type AskAction } from '../pure/section.ts';
import { sectionInputOf } from '../pure/section-adapter.ts';
import { sectionEditableOf } from '../pure/section-edit.ts';
import type { Card } from '../types.ts';
import { DetailHead } from './DetailHead.tsx';
import { DetailHistory } from './DetailHistory.tsx';
import { DetailNote } from './DetailNote.tsx';
import { Section, type SectionPhase } from './Section.tsx';

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
	 * 章节内联编辑回写（`patch` 合并进该章节 payload）。
	 *
	 * 省略 ⇒ 章节按相位渲染但**全部只读**（没接线时不假装能改）。
	 */
	// TODO(审查): 组件层无测试 —— `test/` 现有风格只有 `.ts`（Node 的类型剥离不能 import `.tsx`，见 AGENTS 规则 6），也没有 react-dom 渲染测试基建。这次接线由 `test/section-edit.test.ts` 钉纯判决 + 三条 tsc 兜类型；真 DOM 行为（失焦提交 / 一次点选一次 PATCH）要等组件测试基建。
	readonly onSectionChange?: (sectionId: string, patch: Readonly<Record<string, unknown>>) => void;
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
	/** 兄弟归组面板（用户 2026-11-24：放在关系折叠区里点选成组）。 */
	readonly siblingGroups?: ReactNode;
	/**
	 * 点详情头的状态按钮 —— 打开状态菜单（#62 / #63）。
	 *
	 * 省略 ⇒ 状态按钮渲染成只读（预览 / 回归场景），不假装能点。
	 * 参数是锚点元素，由 `Workspace` 用来给 `StatusMenu` 定位。
	 */
	readonly onStatusOpen?: (anchor: HTMLElement) => void;
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

	/*
	 * 卡状态 ⇒ 章节相位（用户 2026-11-21 采纳的三相位）：
	 *   草稿 → create；进行 / 搁置 → active；完成 → ended。
	 */
	const phase: SectionPhase = isDraftStatus(props.card.status)
		? 'create'
		: isEndedStatus(props.card.status)
			? 'ended'
			: 'active';

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
				siblingGroups={props.siblingGroups}
				onStatusOpen={props.onStatusOpen}
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
					sections.map((one, index) => {
						/*
						 * 每章各自判：md / 未知永远只读；text / ask 看卡状态。
						 * 父层没接线（`onSectionChange` 缺省）时也不假装能改。
						 */
						const change = props.onSectionChange;
						const editable =
							change !== undefined &&
							sectionEditableOf(
								payloadKindOf(one.section.payload),
								props.card.status,
								props.card.deleted,
							);
						/* 收窄成「有值 / 只读」两态，避免 JSX 里依赖布尔别名做类型收窄。 */
						const onChange = editable ? change : undefined;

						/*
						 * `key` 带 card.id：`TextBlock` / `AskCustomRow` 有「输入中的本地草稿」，
						 * 切卡时 sectionId 可能重复（每张卡都有一章叫 goal）⇒ 必须重挂，
						 * 否则上一张卡打了一半的字会跟到下一张卡上。
						 */
						const key = `${props.card.id}:${one.sectionId}`;

						return (
							<Section
								key={key}
								sectionId={one.sectionId}
								section={one.section}
								index={index + 1}
								phase={phase}
								readonly={!editable}
								{...(onChange === undefined || !editable
									? {}
									: {
											onChange,
											/*
											 * ask 的一次动作 → 新 payload。以「整份 payload」当 patch 上抛，
											 * 因为 `applyAskAction()` 的返回值就是完整 payload（形如
											 * `{ $type:'ask', items:[…] }`）；外层合并后语义不变。
											 */
											onAsk: (
												sectionId: string,
												groupIndex: number,
												action: AskAction,
											) => {
												const source = props.card.sections[sectionId]?.payload;
												const next = askPayloadAfter(source, groupIndex, action);
												if (next !== undefined) onChange(sectionId, next);
											},
										})}
							/>
						);
					})
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
