/**
 * 模板与 action 的形状 —— **注册进来的数据**，不是协议。
 *
 * ## 为什么归 core 而不归 protocol
 *
 * 模板是 YAML 数据，action 是注册出来的对象。它们的形状会随实现变化
 * （加一个字段、改一个默认值），而 `protocol` 只放**不会变**的词汇
 * （状态、边、错误码）。把形状写进 protocol 就是第二份真值。
 *
 * ## n + m 建模
 *
 * 用户：「所有模板都可以在章节处复用 action。」
 *
 * ⇒
 *   · **n 个模板**，每个只贡献「章节清单」（章节 id + label + 用哪个 action）；
 *   · **m 个 action**，每个只定义一次 payload 形状；
 *   · 章节**引用** action，**不复制**它的形状。
 *
 * 这条建模直接决定 `template/schema.ts` 怎么写：`$defs` 里放 m 个 action schema，
 * 每个章节用 `$ref` 引用 —— 而不是每个模板把 payload 形状再抄一遍。
 */

import type { ZodType } from 'zod';

/** 一个 action 的注册内容。 */
export interface ActionDef {
	/** 稳定标识（`text` / `markdown` / `ask` …）。 */
	readonly $type: string;
	/** 一句话说明（给「选择 action」用）。 */
	readonly summary: string;
	/**
	 * payload 的**形状**。
	 *
	 * 这是 m 个 action 里唯一的一份 schema —— 所有模板的章节都引用它。
	 * 校验用 zod（`core` 的依赖），与 DSH 生态一致。
	 */
	readonly payloadSchema: ZodType;
	/** 默认形态（新建章节时用）。其 `$type` 必须等于本 action 的 `$type`。 */
	readonly defaultPayload: unknown;
}

/** 模板里的一个章节定义。 */
export interface SectionDef {
	/** 章节稳定 id（存在卡上的 key）。 */
	readonly id: string;
	/**
	 * 章节名。**这是 AI / UI 传参时用的 key**，也是存在卡上的 `label` 副本。
	 *
	 * ⚠ 同一模板内必须唯一（否则"按 label 找章节"有歧义）。
	 */
	readonly label: string;
	/** 给人看的填写提示（**不进 tool schema**，只在展开模板详情时给）。 */
	readonly hint: string;
	/** 这一章用哪个 action（m 个之一）。 */
	readonly action: string;
	/** 该章的默认 payload（来自模板 YAML 的 `default`）。 */
	readonly defaultPayload: unknown;
}

/** 派生声明：这张卡能派生到哪个模板。 */
export interface DeriveDef {
	/** 按钮文字。 */
	readonly label: string;
	/** 悬浮说明。 */
	readonly description?: string;
	/** 目标模板 ref。 */
	readonly template: string;
}

/** 一个模板的定义。 */
export interface TemplateDef {
	/** 稳定引用（= 文件名去扩展名）。 */
	readonly ref: string;
	/** 显示名。 */
	readonly displayName: string;
	/** 类别 id（goal / work / design / record）。 */
	readonly kind: string;
	/** 领域名（核心 / 代码 …）。纯展示 + 筛选。 */
	readonly domain: string;
	/** 编号字母段（`''` 合法 = 不提供字母段）。 */
	readonly codePrefix: string;
	/** 使用说明（**给 AI 的提示词**，不进 tool schema）。 */
	readonly usage: string;
	/** 建卡后返回的「下一步」说明（**给 AI 的提示词**）。 */
	readonly description: string;
	/** 章节清单，顺序有意义（= UI 里的顺序）。 */
	readonly sections: readonly SectionDef[];
	/** 派生声明，顺序有意义（= 菜单顺序）。 */
	readonly derives: readonly DeriveDef[];
}

/** 模板的**窄投影** —— 给列表 / 选择器用（不带章节与提示词）。 */
export interface TemplateSummary {
	readonly ref: string;
	readonly displayName: string;
	readonly kind: string;
	readonly domain: string;
	readonly codePrefix: string;
}

/** 模板的**展开视图** —— 给「看模板有哪些章节」用。 */
export interface TemplateMeta {
	readonly ref: string;
	readonly displayName: string;
	readonly kind: string;
	readonly domain: string;
	readonly usage: string;
	readonly description: string;
	readonly sections: readonly {
		readonly id: string;
		readonly label: string;
		readonly hint: string;
		readonly action: string;
	}[];
	readonly derives: readonly DeriveDef[];
}

/** 投影成摘要。 */
export function summarize(template: TemplateDef): TemplateSummary {
	return {
		ref: template.ref,
		displayName: template.displayName,
		kind: template.kind,
		domain: template.domain,
		codePrefix: template.codePrefix,
	};
}

/** 投影成展开视图。 */
export function describe(template: TemplateDef): TemplateMeta {
	return {
		ref: template.ref,
		displayName: template.displayName,
		kind: template.kind,
		domain: template.domain,
		usage: template.usage,
		description: template.description,
		sections: template.sections.map((section) => ({
			id: section.id,
			label: section.label,
			hint: section.hint,
			action: section.action,
		})),
		derives: template.derives,
	};
}
