/**
 * `DetailSection`（详情面板的表）→ `Section`（定稿章节渲染器）的**纯适配**。
 *
 * ## 为什么需要这一层
 *
 * 两边的形状差一层包装：
 *
 * | 表（`pure/card-detail.ts`） | 组件（`Section.tsx` 的 `SectionProps`） |
 * |---|---|
 * | `DetailSection.id` | `sectionId` |
 * | `DetailSection.label` + `DetailSection.payload` **两个字段** | `section: CardSection` **一个对象**（`{ label, payload }`） |
 *
 * 差别只有「拆开 vs 合起来」。但**放在 JSX 里拼**就不止是形式问题：
 * `payload` 的解析归 `Section` 内部（它按 `$type` 分派 text / markdown / ask / unknown），
 * 适配层只挑形状、**不碰内容** —— 这条边界写成纯函数才能用测试钉住
 * （`payload` 引用不变、payload 是 markdown 时不因为 `text` 字段是空串就退化成空）。
 *
 * ## 为什么**不用** `DetailSection.text` / `DetailSection.empty`
 *
 * 那两个字段是 `SectionStub` 时代的纯文本兜底（`extractText()`）：对 v3 的
 * `ask` payload 返回空串（见 `pure/section.ts` 文件头），接上定稿 `Section`
 * 后内容由 payload 自己解释 ⇒ 适配**只挑形状、不挑内容**。
 * 表里仍保留 `text` / `empty`（单测钉着，给纯文本兜底的调用方用），
 * 但本函数**不读**它们。
 */

import type { CardSection } from '../types.ts';
import type { DetailSection } from './card-detail.ts';

/** `Section` 需要的那两个形状字段。 */
export interface SectionInput {
	/** 章节 id（`Card.sections` 的 key）。 */
	readonly sectionId: string;
	/** 卡上的章节 `{ label, payload }` —— payload 是**原对象的引用**。 */
	readonly section: CardSection;
}

/**
 * 详情表里的一章 → `Section` 的输入。
 *
 * @param section `detailTableOf()` 产出的一个章节
 */
export function sectionInputOf(section: DetailSection): SectionInput {
	return {
		sectionId: section.id,
		/*
		 * `payload` 原样透传（不解析、不深拷贝）：
		 * 解析只有 `pure/section.ts` 一处，适配层再解析一次就是两处真值。
		 */
		section: { label: section.label, payload: section.payload },
	};
}
