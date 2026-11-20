/**
 * 关系折叠面板 —— **独立组件**（不依赖 `CardDetail`，也不依赖 store）。
 *
 * 用户 `2026-11-20`：
 * > 「卡片的详情页。关系的折叠面板。你也没有做独立组件给我看给我选。没有接入。」
 *
 * ⇒ 本文件是「给我看给我选」的那一份：同一份 `RelationsView` 上做**三个候选形态**，
 *   预览页 `dev/preview/relation-panel/` 把三者并排画出来。
 *
 * ## 三个变体（用 `variant` 选，默认 A）
 *
 * | 变体 | 形态 |
 * |---|---|
 * | `a` · 原版三列表 | 折叠；展开后「进行 / 搁置 / 完成」三列表头 + 每个关系类型一条组横条，卡按自身 status 落列 |
 * | `b` · 平铺列表 | **不折叠**；每个关系类型一条组横条，卡片在横条下**横向平铺**（不分列） |
 * | `c` · 折叠 + 计数条 | 折叠时标题写「关系 N（子任务 2 / 本项依赖 1 …）」；展开后同 B |
 *
 * ## 卡头那一行（三条铁规则的第 3 条）
 *
 * 用户 `2026-11-11`：父任务栏要在外面（卡头那一行）。
 * 原版 `header.js:94-99` 的第三行 = `[父任务 chip] [spacer] [▸ 关系 N] [+ 派生子任务]`。
 *
 * ⇒ 本组件的**卡头行**是：
 *
 * ```
 * [▾ 关系 N] │ 父任务 [编号 标题]          [+ 派生子任务]
 * ```
 *
 * ⚠ `+ 派生子任务` 也在这一行里（`onDerive`）—— 原版就在这一行，
 *   用户没要求把它移走。接进 `CardDetail` 时这一行**替换**原来的
 *   `.detail-actions` 动作行（不是新增一行）。
 *
 * ## 展开态：受控优先，不传自持
 *
 * `expanded` 传了就是受控（组件不改自己的 state，只调 `onToggle`）；
 * 不传就组件自持。`CardDetail` 接入时用 `key={card.id}` 重置 —— 切卡收起，
 * 和原版 `renderDetail` 重跑时 `expanded` 自然归 false 一致。
 *
 * ## 为什么「空组不画」在 pure 里
 *
 * `relationsOf` 已经不返回空组（原版 `relations.js:213-214`）。组件里
 * **没有** `if (group.cards.length === 0) return null` —— 显示决定不在组件。
 */

import { useState, type ReactNode } from 'react';

import { kindTone } from '../pure/card-view.ts';
import {
	RELATION_COLUMNS,
	type RelationColumnKey,
	type RelationGroupView,
	type RelationsView,
} from '../pure/relations-block.ts';
import type { Card } from '../types.ts';
import { StatusDot } from './StatusDot.tsx';

/* ══════════════════════════════════════════════════════════
   属性
   ══════════════════════════════════════════════════════════ */

/** 三个候选形态。 */
export type RelationPanelVariant = 'a' | 'b' | 'c';

/**
 * 「+ 派生子任务」按钮的展示决定。
 *
 * ⚠ 只透传 `pure/card-detail.ts` 已经判好的三个字段，**不在组件里再判一次**
 *   （`disabled` 是「卡已删除」⇒ 动作行禁用，那条判决归 pure）。
 *   省略时用旧文案 + 可点。
 */
export interface RelationDeriveAction {
	readonly label: string;
	readonly disabled: boolean;
	readonly title: string;
}

/** 组件属性。 */
export interface RelationPanelProps {
	/** `relationsOf()` 的产物 —— 组、列、计数全在里面。 */
	readonly relations: RelationsView;
	/** 点关系卡 / 父任务卡（跳到那张卡）。 */
	readonly onJump: (cardId: string) => void;
	/** 点「+ 添加关系」（展开后的底部 / 空态）。 */
	readonly onAddRelation: () => void;
	/** 点「+ 派生子任务」（卡头行）。 */
	readonly onDerive: () => void;
	/**
	 * 受控展开态。**不传 = 组件自持**。
	 *
	 * ⚠ `exactOptionalPropertyTypes: true` ⇒ 不能显式传 `undefined`；
	 *   要么不给这个键，要么给 `boolean`。
	 */
	readonly expanded?: boolean;
	/** 点折叠头时调（受控时调用方负责改 `expanded`）。 */
	readonly onToggle?: () => void;
	/** 形态，默认 `'a'`（原版）。 */
	readonly variant?: RelationPanelVariant;
	/** 「+ 派生子任务」的展示决定；省略 = 旧文案 + 可点。 */
	readonly derive?: RelationDeriveAction;
	/** 「+ 添加关系」禁用（卡已删除）；省略 = 可点。 */
	readonly addRelationDisabled?: boolean;
	/** 空态文案；省略 = 「这张卡还没有任何关系。」（原版文案）。 */
	readonly emptyText?: string;
}

/* ══════════════════════════════════════════════════════════
   组件
   ══════════════════════════════════════════════════════════ */

/**
 * 关系面板。
 *
 * @param props 见 `RelationPanelProps`
 */
export function RelationPanel(props: RelationPanelProps): ReactNode {
	const variant = props.variant ?? 'a';
	/* 只有 B 不折叠。 */
	const collapsible = variant !== 'b';

	const [selfExpanded, setSelfExpanded] = useState(false);
	const expanded = props.expanded ?? selfExpanded;

	const toggle = (): void => {
		if (props.expanded === undefined) setSelfExpanded(!expanded);
		props.onToggle?.();
	};

	const relations = props.relations;

	return (
		<div
			className={`rel-panel rel-panel--${variant}`}
			data-rel-panel
			data-variant={variant}
			data-expanded={expanded ? 'true' : 'false'}
		>
			<div className="rel-head" data-rel-head>
				{collapsible ? (
					<button
						type="button"
						className={`rel-toggle${expanded ? ' is-open' : ''}`}
						data-rel-toggle
						aria-expanded={expanded}
						title={expanded ? '收起关系' : '展开关系'}
						onClick={toggle}
					>
						<span className="rel-toggle__caret">{expanded ? '▾' : '▸'}</span>
						<span className="rel-toggle__label">关系 {relations.total}</span>
						{variant === 'c' && !expanded ? (
							<span className="rel-toggle__summary" data-rel-summary>
								{summaryOf(relations)}
							</span>
						) : null}
					</button>
				) : (
					<span className="rel-head__total" data-rel-total>
						关系 {relations.total}
					</span>
				)}

				{relations.parentCard === null ? null : (
					<ParentChip card={relations.parentCard} onJump={props.onJump} />
				)}

				<span className="rel-head__spacer" />

				<DeriveButton
					action={props.derive}
					onDerive={props.onDerive}
				/>
			</div>

			{expanded || variant === 'b' ? (
				variant === 'a' ? (
					<TableBody relations={relations} onJump={props.onJump} emptyText={props.emptyText} />
				) : (
					<FlatBody relations={relations} onJump={props.onJump} emptyText={props.emptyText} />
				)
			) : null}

			{expanded || variant === 'b' ? (
				<div className="rel-foot">
					<button
						type="button"
						className="ghost-btn rel-add"
						data-rel-add
						disabled={props.addRelationDisabled ?? false}
						title="添加一条关系"
						onClick={props.onAddRelation}
					>
						+ 添加关系
					</button>
				</div>
			) : null}
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   卡头行零件
   ══════════════════════════════════════════════════════════ */

/**
 * 折叠态 C 的计数条 —— 「（子任务 2 / 本项依赖 1）」。
 *
 * ⚠ 用组自己的 label（`relations-block.ts` 那份），**不另编短名**。
 *
 * @param relations 关系视图
 */
function summaryOf(relations: RelationsView): string {
	if (relations.groups.length === 0) return '（无）';
	return `（${relations.groups.map((one) => `${one.label} ${String(one.count)}`).join(' / ')}）`;
}

/**
 * 父任务卡（`↑ 父任务 DP-04 归档与分组`）。
 *
 * @param props 卡 + 跳转回调
 */
export function ParentChip(props: { readonly card: Card; readonly onJump: (cardId: string) => void }): ReactNode {
	const card = props.card;
	return (
		<button
			type="button"
			className="rel-parent-chip"
			data-rel-parent
			title={`父任务：${card.id} ${card.title}`}
			onClick={() => props.onJump(card.id)}
		>
			<span className="rel-parent-chip__arrow">↑ 父任务</span>
			<span className={`rel-chip__id card-id--${kindTone(card.template.kind)}`}>{card.id}</span>
			<span className="rel-chip__title">{card.title}</span>
		</button>
	);
}

/**
 * 「+ 派生子任务」按钮。
 *
 * ⚠ 这个按钮**不能删**（任务书：保留「+ 派生子任务」）。
 *   它的文案/禁用/说明来自 `pure/card-detail.ts` 的 `DetailAction`，
 *   组件只映射，不判决。
 *
 * @param props 展示决定 + 回调
 */
export function DeriveButton(props: {
	readonly action: RelationDeriveAction | undefined;
	readonly onDerive: () => void;
}): ReactNode {
	const action = props.action;
	return (
		<button
			type="button"
			className="ghost-btn detail-action"
			data-action-kind="derive"
			disabled={action?.disabled ?? false}
			title={action?.title ?? '新建一张卡，并把这张卡预填为父任务'}
			onClick={props.onDerive}
		>
			<span className="detail-action__label">{action?.label ?? '+ 派生子任务'}</span>
		</button>
	);
}

/* ══════════════════════════════════════════════════════════
   一张关系小卡
   ══════════════════════════════════════════════════════════ */

/**
 * 一张关系小卡（`↗ 编号 标题`）。
 *
 * ⚠ 这里**没有** `data-draft` 分支 —— 草稿在 `relationsOf` 就被剔掉了，
 *   永远到不了这里（原版 `relations-block.js:43-48` 同一条规则）。
 *
 * @param props 卡 + 跳转回调 + 是否画状态点
 */
export function RelationChip(props: {
	readonly card: Card;
	readonly onJump: (cardId: string) => void;
	/** 非三列形态（B/C）里状态点必须画，否则看不出是进行还是完成。 */
	readonly withStatus: boolean;
}): ReactNode {
	const card = props.card;
	return (
		<button
			type="button"
			className="rel-chip"
			data-rel-card={card.id}
			title={`${card.id} ${card.title}`}
			onClick={() => props.onJump(card.id)}
		>
			<span className="rel-chip__arrow">↗</span>
			<span className={`rel-chip__id card-id--${kindTone(card.template.kind)}`}>{card.id}</span>
			{props.withStatus ? <StatusDot status={card.status} size={6} /> : null}
			<span className="rel-chip__title">{card.title}</span>
		</button>
	);
}

/* ══════════════════════════════════════════════════════════
   变体 A 的正文：三列表
   ══════════════════════════════════════════════════════════ */

/**
 * 变体 A —— 三列表头 + 每个关系组一行（组横条 + 三列）。
 *
 * @param props 关系视图 + 回调
 */
export function TableBody(props: {
	readonly relations: RelationsView;
	readonly onJump: (cardId: string) => void;
	readonly emptyText: string | undefined;
}): ReactNode {
	const relations = props.relations;

	if (relations.groups.length === 0) {
		return <EmptyBody emptyText={props.emptyText} />;
	}

	/* 三列表头的计数 = 各组同一列之和（原版 `relations-block.js:84-96`）。 */
	const counts: Record<RelationColumnKey, number> = { active: 0, shelved: 0, ended: 0 };
	for (const group of relations.groups) {
		for (const column of RELATION_COLUMNS) {
			counts[column.group] += group.byColumn[column.group].length;
		}
	}

	return (
		<div className="rel-table" data-rel-table>
			<div className="rel-columns">
				{RELATION_COLUMNS.map((column) => (
					<div
						key={column.group}
						className={`rel-columns__cell rel-columns__cell--${column.group}`}
					>
						<span className="rel-columns__dot" style={{ background: column.color }} />
						{`${column.label} `}
						<span className="rel-columns__count">{counts[column.group]}</span>
					</div>
				))}
			</div>

			{relations.groups.map((group) => (
				<div className="rel-group" key={group.rel} data-rel-group={group.rel}>
					<GroupHead group={group} />
					<div className="rel-group__body">
						{RELATION_COLUMNS.map((column) => (
							<div className="rel-group__col" key={column.group}>
								{group.byColumn[column.group].map((card) => (
									<RelationChip
										key={card.id}
										card={card}
										onJump={props.onJump}
										withStatus={false}
									/>
								))}
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   变体 B / C 的正文：平铺
   ══════════════════════════════════════════════════════════ */

/**
 * 变体 B/C —— 每个关系组一条横条 + 卡片横向平铺（**不分列**）。
 *
 * @param props 关系视图 + 回调
 */
export function FlatBody(props: {
	readonly relations: RelationsView;
	readonly onJump: (cardId: string) => void;
	readonly emptyText: string | undefined;
}): ReactNode {
	const relations = props.relations;

	if (relations.groups.length === 0) {
		return <EmptyBody emptyText={props.emptyText} />;
	}

	return (
		<div className="rel-flat" data-rel-flat>
			{relations.groups.map((group) => (
				<div className="rel-group" key={group.rel} data-rel-group={group.rel}>
					<GroupHead group={group} />
					<div className="rel-group__cards">
						{group.cards.map((card) => (
							<RelationChip key={card.id} card={card} onJump={props.onJump} withStatus />
						))}
					</div>
				</div>
			))}
		</div>
	);
}

/* ══════════════════════════════════════════════════════════
   公共零件
   ══════════════════════════════════════════════════════════ */

/**
 * 关系组的横条（按关系类型上色）。
 *
 * @param props 一个组
 */
export function GroupHead(props: { readonly group: RelationGroupView }): ReactNode {
	const group = props.group;
	return (
		<div
			className="rel-group__head"
			style={{ background: group.bg, borderLeftColor: group.line }}
		>
			<span className="rel-group__line" style={{ background: group.line }} />
			<span className="rel-group__label">{group.label}</span>
			<span className="rel-group__count">{group.count}</span>
		</div>
	);
}

/**
 * 空态。
 *
 * @param props 文案（省略用原版「这张卡还没有任何关系。」）
 */
export function EmptyBody(props: { readonly emptyText: string | undefined }): ReactNode {
	return (
		<div className="rel-empty" data-rel-empty>
			{props.emptyText ?? '这张卡还没有任何关系。'}
		</div>
	);
}
