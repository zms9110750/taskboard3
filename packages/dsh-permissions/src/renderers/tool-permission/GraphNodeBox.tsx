/**
 * 画布上的**一个节点**（组 / 工具）—— 纯展示，判决全在调用方（issue #53 / #54）。
 *
 * ## 为什么要单独一个组件文件（而不是内联在 `GraphEditor` 的 map 里）
 *
 * 两个 issue 都是「节点看起来能点 / 点不动」的问题，而它们的分歧点只有两条：
 *
 * | 节点 | 能不能点 | 为什么 |
 * |---|---|---|
 * | 组 | ✅ 点 = 加入 / 移出当前编辑组 | 它是**可编辑对象**（成员关系） |
 * | 工具（白底卡） | ❌ 只读 | 它是**组成员位**，工具的开关在右栏勾选（issue #53 的裁定） |
 *
 * 抽出来之后，这两条约定能被 SSR 断言钉住（`dev/preview/tool-permission/verify.mjs`），
 * 而不用在 700 行的 `GraphEditor` 里靠 grep。
 *
 * ## 尺寸（issue #54）
 *
 * 组和工具**同一套最小宽度与内边距**（`TIGHT_LAYOUT` 的 `groupW` / `toolW` 已统一），
 * 标题单行 ellipsis，不裁切。CSS 在 `tool-permission-css.ts` 的「节点」段。
 */

import type { KeyboardEvent, ReactNode } from 'react';

import type { LayoutBox } from '../../pure/tool-graph.ts';
import type { ToolGraphNode } from '../../pure/tool-graph.ts';

/** 工具位（白底卡）的悬停说明 —— issue #53 的裁定：明确只读，并说清去哪儿选。 */
export const TOOL_NODE_HINT = '这是成员位（只读）：请在左栏选组，再到右栏勾选工具';

/** 一个节点的 props。 */
export interface GraphNodeBoxProps {
	readonly node: ToolGraphNode;
	readonly box: LayoutBox;
	/** 是不是正在编辑的组（正常不会出现在画布上，防御）。 */
	readonly active: boolean;
	/** 已在本组里（组 = 直接成员；工具 = 直接勾选）。 */
	readonly member: boolean;
	/** 会成环（不可点）。 */
	readonly blocked: boolean;
	/** 宿主已经没有这个工具了（issue #58：标出来，不静默丢）。 */
	readonly invalid: boolean;
	/** 有多少个父组包含它。 */
	readonly parents: number;
	/** 组的直接成员数（工具为 0）。 */
	readonly memberCount: number;
	/** 成环路径的人话（`blocked` 时给 title）。 */
	readonly cycleText?: string | undefined;
	/** 点组：加入 / 移出。工具不传（只读）。 */
	readonly onToggle?: (() => void) | undefined;
}

/**
 * 画布节点。
 *
 * @param props 见 `GraphNodeBoxProps`
 */
export function GraphNodeBox(props: GraphNodeBoxProps): ReactNode {
	const { node, box } = props;
	const isGroup = node.kind === 'group';
	const clickable = isGroup && props.onToggle !== undefined && !props.blocked;

	const className = [
		'tb3g-node',
		isGroup ? 'tb3g-node--group' : 'tb3g-node--tool',
		props.active ? ' is-active' : '',
		props.member ? ' is-member' : '',
		props.blocked ? ' is-blocked' : '',
		!isGroup ? ' is-readonly' : '',
	].join(' ');

	const title = !isGroup
		? TOOL_NODE_HINT
		: props.blocked
			? props.cycleText === undefined
				? '会成环，不能加入'
				: `会成环：${props.cycleText}`
			: props.onToggle === undefined
				? undefined
				: props.member
					? '点它：把这一组从当前组移出'
					: '点它：把这一组加进当前组';

	return (
		<div
			data-node-id={node.id}
			data-node-kind={node.kind}
			data-layer={String(box.layer)}
			data-active={props.active ? '1' : '0'}
			data-member={props.member ? '1' : '0'}
			data-blocked={props.blocked ? '1' : '0'}
			data-invalid={props.invalid ? '1' : '0'}
			data-readonly={isGroup ? '0' : '1'}
			data-testid="graph-node"
			className={className}
			title={title}
			/* 只读节点连「像按钮」的样子都不给：没有 role / tabIndex / onClick。 */
			{...(clickable
				? {
						role: 'button',
						tabIndex: 0,
						onClick: props.onToggle,
						onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
							if (event.key !== 'Enter' && event.key !== ' ') return;
							event.preventDefault();
							props.onToggle?.();
						},
					}
				: {})}
			{...(isGroup ? {} : { 'aria-disabled': 'true' })}
			style={{
				left: `${String(box.x)}px`,
				top: `${String(box.y)}px`,
				width: `${String(box.w)}px`,
				height: `${String(box.h)}px`,
			}}
		>
			<span className="tb3g-node__name">
				{props.active ? '● ' : ''}
				{props.member ? '✓ ' : ''}
				{isGroup ? `# ${node.label}` : node.label}
				{props.invalid ? '（已失效）' : ''}
			</span>
			<span className="tb3g-node__meta">
				{isGroup
					? `L${String(box.layer)} · 组 · ${String(props.memberCount)} 成员`
					: `L${String(box.layer)} · ${node.source ?? ''}`}
				{props.parents > 1 ? ` · ⧉ ${String(props.parents)} 父` : ''}
				{props.blocked ? ' · 会成环' : ''}
				{!isGroup ? ' · 只读' : ''}
			</span>
		</div>
	);
}
