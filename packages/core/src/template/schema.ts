/**
 * 建卡内容校验 —— **按模板动态构建 zod schema**，惰性、带缓存、模板一变就重建。
 *
 * ## 为什么在这里而不是在 tool 层（用户裁定）
 *
 * > 「就在 core 里面验证就好了。因为用户从 ui 里面创建卡，也是走数据给 core 的。」
 *
 * ⇒ 校验归属**数据的所有者**，不是调用方。UI 与 AI 走同一个入口，
 *   不存在「两套校验」（那会让改一处忘一处的静默漂移）。
 *
 * ## n + m：为什么不是 n × m
 *
 * 用户：「所有模板都可以在章节处复用 action。」
 *
 *   · **n 个模板** —— 每个只贡献「章节名清单」；
 *   · **m 个 action** —— payload 形状只定义一次；
 *   · 章节**引用** action，不复制它的形状。
 *
 * 实现上：每个模板的 schema 是 `z.strictObject({ [章节名]: actionSchema })`，
 * `actionSchema` 直接从 action 注册表拿 —— **同一个 ZodType 实例被多个章节复用**。
 * 21 个模板共 93 个章节，但只存在 3 份 payload schema。
 *
 * ## 为什么缓存，为什么清空
 *
 * 建卡时才需要 schema（不是每次启动都编译 21 个模板）。首次用到某模板时构建并缓存。
 *
 * 用户裁定：「任何模板被注册/注销的时候需要通知。而架构会监听这个通知。
 * 他会在这个时候重建架构。」
 *
 * ⇒ 注册/注销时**清空整个缓存**（不是只清那一个）——
 *   因为注销一个 action 会同时让所有引用它的模板失效，逐条追依赖不划算，
 *   而重建一个模板的 schema 是微秒级。
 *
 * ## `additionalProperties: false` 等价物是 `z.strictObject`
 *
 * 这是**拦住「模型编了个不存在的章节名」的唯一手段**。
 * 少了它就是「自由 object + 靠描述约束」，那正是旧仓库的问题。
 */

import { z } from 'zod';

import type { Failure } from '@local/taskboard3-protocol';
import { ErrorCode, failure } from '@local/taskboard3-protocol';

import type { ActionRegistry } from './actions.js';
import type { TemplateRegistry } from './registry.js';
import type { SectionDef, TemplateDef } from './types.js';

/**
 * 一个模板的校验器。
 *
 * `sectionByKey` 同时接受 **label**（人写得出名字）与 **id**（稳定标识），
 * 两者都映射到同一个章节 —— 校验前先把 key 归一化成 id。
 */
export interface TemplateValidator {
	/** 归一化后的 key（= sectionId）对应的 zod schema，`z.strictObject`。 */
	readonly schema: z.ZodType<Record<string, unknown>>;
	/** key（label 或 id）→ 章节定义。 */
	readonly sectionByKey: ReadonlyMap<string, SectionDef>;
	/** sectionId → 章节定义。 */
	readonly sectionById: ReadonlyMap<string, SectionDef>;
}

/** 章节 payload 的校验结果（校验后的 payload，key = sectionId）。 */
export type ValidatedContent =
	| { readonly ok: true; readonly payloads: ReadonlyMap<string, unknown> }
	| Failure;

/**
 * 校验器缓存 + 构建逻辑。
 *
 * 一个实例属于一个任务板实例（不是全局单例）。
 */
export class ContentSchemaCache {
	readonly #templates: TemplateRegistry;
	readonly #actions: ActionRegistry;
	readonly #cache = new Map<string, TemplateValidator>();
	#dispose: (() => void) | undefined;

	constructor(templates: TemplateRegistry, actions: ActionRegistry) {
		this.#templates = templates;
		this.#actions = actions;
	}

	/**
	 * 开始监听注册表变更。
	 *
	 * 用户要求的「注册/注销 → 通知 → 重建」就是这一条：
	 * 两个注册表任一变更都清空缓存，下次校验时惰性重建。
	 */
	start(): void {
		if (this.#dispose !== undefined) return;
		const invalidate = (): void => {
			this.#cache.clear();
		};
		const offTemplates = this.#templates.onChange(invalidate);
		const offActions = this.#actions.onChange(invalidate);
		this.#dispose = () => {
			offTemplates();
			offActions();
		};
	}

	/** 停止监听（幂等）。 */
	stop(): void {
		this.#dispose?.();
		this.#dispose = undefined;
		this.#cache.clear();
	}

	/** 当前缓存的模板数（测试用）。 */
	get size(): number {
		return this.#cache.size;
	}

	/** 取（或构建）某模板的校验器。 */
	validatorFor(ref: string): TemplateValidator | undefined {
		const cached = this.#cache.get(ref);
		if (cached !== undefined) return cached;

		const template = this.#templates.get(ref);
		if (template === undefined) return undefined;

		const built = buildValidator(template, this.#actions);
		if (built === undefined) return undefined;
		this.#cache.set(ref, built);
		return built;
	}

	/**
	 * 校验一份 `content`。
	 *
	 * @param ref 模板 ref
	 * @param raw 调用方给的 `content`：`{ [章节名]: payload }`
	 * @returns 归一化成 `sectionId -> payload` 的结果，或一个 `Failure`
	 */
	validate(ref: string, raw: unknown): ValidatedContent {
		const template = this.#templates.get(ref);
		if (template === undefined) {
			return failure(ErrorCode.TEMPLATE_NOT_FOUND, `模板「${ref}」不存在。用注册表看可用模板。`);
		}

		const validator = this.validatorFor(ref);
		if (validator === undefined) {
			const missing = [...new Set(template.sections.map((one) => one.action))].filter(
				(action) => !this.#actions.has(action),
			);
			return failure(
				ErrorCode.ACTION_NOT_FOUND,
				`模板「${ref}」引用了未注册的 action：${missing.join('、')}。`,
				{ detail: { templateRef: ref, missingActions: missing } },
			);
		}

		/* 省略 content ⇒ 全部用模板默认值（合法）。 */
		if (raw === undefined || raw === null) {
			return { ok: true, payloads: defaultsOf(template) };
		}
		if (typeof raw !== 'object' || Array.isArray(raw)) {
			return failure(ErrorCode.CONTENT_INVALID, 'content 必须是对象：key = 章节名，value = payload。', {
				issues: [{ path: '/content', message: '必须是对象' }],
			});
		}

		/* ── 第一步：key 归一化（label 或 id → id），未知 key 收集起来 ── */
		const normalized: Record<string, unknown> = {};
		const unknown: string[] = [];
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
			const section = validator.sectionByKey.get(key);
			if (section === undefined) {
				unknown.push(key);
				continue;
			}
			normalized[section.id] = value;
		}

		if (unknown.length > 0) {
			return unknownKeysFailure(ref, template, unknown);
		}

		/* ── 第二步：形状校验（strictObject 会拦住多余 key，但归一化后 key 都是合法的） ── */
		const parsed = validator.schema.safeParse(normalized);
		if (!parsed.success) {
			return zodIssuesToFailure(ref, parsed.error);
		}

		/* ── 第三步：省略的章节填模板默认值 ── */
		const payloads = new Map<string, unknown>();
		for (const section of template.sections) {
			const given = normalized[section.id];
			if (given !== undefined) {
				payloads.set(section.id, given);
				continue;
			}
			const fallback = section.defaultPayload;
			if (fallback !== undefined) payloads.set(section.id, fallback);
		}
		return { ok: true, payloads };
	}
}

/**
 * 构建一个模板的校验器。
 *
 * @returns `undefined` 当模板引用了未注册的 action（调用方会给更好的错误）
 */
export function buildValidator(
	template: TemplateDef,
	actions: ActionRegistry,
): TemplateValidator | undefined {
	const sectionByKey = new Map<string, SectionDef>();
	const sectionById = new Map<string, SectionDef>();
	const shape: Record<string, z.ZodType> = {};

	for (const section of template.sections) {
		sectionById.set(section.id, section);
		/* label 与 id 都能当 key —— 但 label 优先（人写得出名字）。 */
		sectionByKey.set(section.label, section);
		sectionByKey.set(section.id, section);

		const action = actions.get(section.action);
		if (action === undefined) return undefined;
		/* 章节可省略 ⇒ optional；省略时用模板默认值。 */
		shape[section.id] = action.payloadSchema.optional();
	}

	return {
		schema: z.strictObject(shape) as unknown as z.ZodType<Record<string, unknown>>,
		sectionByKey,
		sectionById,
	};
}

/** 未知章节名的失败 —— **错误消息就是修复指南**。 */
function unknownKeysFailure(ref: string, template: TemplateDef, unknown: readonly string[]): Failure {
	const lines = [
		`模板「${template.displayName || ref}」没有这些章节：${unknown.map((one) => `「${one}」`).join('、')}。`,
		'可用的章节（key 用引号里的原文）：',
		...template.sections.map((section) => `  「${section.label}」 → action=${section.action}`),
	];
	return failure(ErrorCode.CONTENT_INVALID, lines.join('\n'), {
		issues: unknown.map((key) => ({
			path: `/content/${key}`,
			message: '不是该模板的章节名',
		})),
		detail: { templateRef: ref, unknown, available: template.sections.map((one) => one.label) },
	});
}

/** 把 zod 的 issue 翻成 `Failure`（path 转 JSON Pointer）。 */
function zodIssuesToFailure(ref: string, error: z.ZodError): Failure {
	const issues = error.issues.map((issue) => ({
		path: `/content/${issue.path.map(String).join('/')}`,
		message: issue.message,
	}));
	return failure(ErrorCode.CONTENT_INVALID, `模板「${ref}」的章节内容格式不对。`, {
		issues,
		detail: { templateRef: ref },
	});
}

/** 取模板的全部默认 payload（key = sectionId）。 */
function defaultsOf(template: TemplateDef): ReadonlyMap<string, unknown> {
	const payloads = new Map<string, unknown>();
	for (const section of template.sections) {
		if (section.defaultPayload !== undefined) payloads.set(section.id, section.defaultPayload);
	}
	return payloads;
}
