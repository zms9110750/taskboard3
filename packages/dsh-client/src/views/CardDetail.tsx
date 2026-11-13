/**
 * 卡片详情 —— 标题、状态、元数据、章节内容、备注。
 *
 * ## payload 怎么显示
 *
 * 章节的 `payload` 是 action 给的结构（`{ $type: 'text', value: '…' }`）。
 * **MVP 只做纯文本提取**，不渲染 markdown / 不做 ask 交互 —— 那些需要
 * action 自己的渲染器，属于第二轮。
 *
 * `extractText()` 是纯函数，由 `test/pure.test.ts` 覆盖。
 */

import type { ReactNode } from 'react';

import { CLS } from '../styles.ts';
import type { Card, CardSection } from '../types.ts';
import { extractText } from '../pure.ts';
import { StatusBadge } from './StatusBadge.tsx';

/** 详情属性。 */
export interface CardDetailProps {
	readonly card: Card;
	/** 模板显示名（找不到时由调用方传 ref）。 */
	readonly templateLabel: string;
	/** 状态菜单（由外层组装 —— 详情不自己管动作）。 */
	readonly menu: ReactNode;
}

/**
 * 卡详情。
 *
 * @param props 卡 + 模板名 + 状态菜单
 */
export function CardDetail(props: CardDetailProps): ReactNode {
	const { card } = props;
	const sections = Object.entries(card.sections);
	return (
		<>
			<div className={CLS.detailHead}>
				<h3 className={CLS.detailTitle}>{card.title}</h3>
				{props.menu}
			</div>
			<div className={CLS.meta}>
				<span>{card.id}</span>
				<StatusBadge status={card.status} />
				<span>{props.templateLabel}</span>
				{card.claimedBy !== null ? <span>占用：{card.claimedBy}</span> : null}
			</div>

			{sections.length === 0 ? (
				<div className={CLS.empty}>这张卡没有章节。</div>
			) : (
				sections.map(([id, section]) => <SectionView key={id} section={section} />)
			)}

			{card.note !== '' ? (
				<div className={CLS.section}>
					<div className={CLS.sectionLabel}>备注</div>
					<div className={CLS.note}>{card.note}</div>
				</div>
			) : null}
		</>
	);
}

/** 一个章节。 */
function SectionView(props: { readonly section: CardSection }): ReactNode {
	const text = extractText(props.section.payload);
	return (
		<div className={CLS.section}>
			<div className={CLS.sectionLabel}>{props.section.label}</div>
			<div className={CLS.sectionBody}>{text === '' ? '（空）' : text}</div>
		</div>
	);
}
