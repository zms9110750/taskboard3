/**
 * 建卡内容校验 —— **逐章节校验**，不构造整体对象 schema。
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
 * 实现上：章节按 `section.action` 去 action 注册表取**同一个 ZodType 实例**，
 * 21 个模板共 93 个章节，但只存在 3 份 payload schema。
 *
 * ## ⚠ 这里曾经有一个 `as unknown as`（已删除）
 *
 * 旧实现把章节拼成 `z.strictObject({ [动态章节名]: actionSchema })`：
 *
 * ```ts
 * schema: z.strictObject(shape) as unknown as z.ZodType<Record<string, unknown>>
 * ```
 *
 * `shape` 的 key 是**运行时才知道**的章节名，zod 推不出精确类型，于是强行断言。
 * 那个断言掩了两件事：
 *
 * 1. **类型逃逸** —— 某个章节的 schema 拼错了，编译期看不出来；
 * 2. **两套错误路径** —— 「未知章节名」与「payload 形状不对」各自造 `Failure`，
 *    形状可能不一致，且各维护一份。
 *
 * 判断标准（用户提的）：**删掉断言会编译失败吗？会 ⇒ 暴露的是设计问题。**
 *
 * ⇒ 改成**逐章节校验**：不需要「把 n 个章节合成一个对象」这个中间物，
 *   于是没有类型可猜，也就没有断言要打。两套错误路径也合成一套。
 *
 * ## `additionalProperties: false` 由谁保证
 *
 * 现在是**手工的 key 归一化那一步**：`content` 的每个 key 都必须能在
 * `sectionByKey` 里命中（label 或 id），否则记进 `unknown` 并整体拒绝。
 * 这与旧 `z.strictObject` 等价，且错误消息能列出可用章节 —— 后者更可修。
 */

import type { z } from 'zod';

import type { Failure } from '@taskboard/protocol';
import { ErrorCode, failure } from '@taskboard/protocol';

import type { ActionRegistry } from './actions.ts';
import type { TemplateRegistry } from './registry.ts';
import type { SectionDef, TemplateDef } from './types.ts';

/** 一个模板的校验器。 */
export interface TemplateValidator {
	/** key（label 或 id）→ 章节定义。 */
	readonly sectionByKey: ReadonlyMap<string, SectionDef>;
	/** sectionId → 章节定义。 */
	readonly sectionById: ReadonlyMap<string, SectionDef>;
	/**
	 * 校验一个章节的 payload。
	 *
	 * 直接调该章节所用 action 的 zod schema —— **没有整体对象 schema**，
	 * 所以不需要任何类型断言。
	 */
	validateSection(section: SectionDef, payload: unknown): SectionValidation;
}

/** 单个章节的校验结果。 */
export type SectionValidation =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly issues: readonly SectionIssue[] };

/** 单章节校验失败的一条问题（`path` 是章节内的相对路径）。 */
export interface SectionIssue {
	/** 章节内相对路径：`[]` 表示 payload 本身，`['value']` 表示 payload.value。 */
	readonly path: readonly (string | number)[];
	readonly message: string;
}

/** 章节 payload 的校验结果（校验后的 payload，key = sectionId）。 */
export type ValidatedContent =
	| {
			readonly ok: true;
			readonly payloads: ReadonlyMap<string, unknown>;
			/** 调用方给的原始 key（label 或 id），按 sectionId 索引 —— 用于错误路径。 */
			readonly keys: ReadonlyMap<string, string>;
	  }
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
			return { ok: true, payloads: defaultsOf(template), keys: new Map() };
		}
		if (typeof raw !== 'object' || Array.isArray(raw)) {
			return failure(ErrorCode.CONTENT_INVALID, 'content 必须是对象：key = 章节名，value = payload。', {
				issues: [{ path: '/content', message: '必须是对象' }],
			});
		}

		/*
		 * ── 空模板：章节完全自定义（用户 2026-11-22） ──
		 *
		 * > 「空模板允许建卡。他的章节是完全自定义的。key 怎么写都合法。」
		 *
		 * 模板没有声明任何 section ⇒ 调用方给的每个 key 都是合法章节，
		 * 原样当 payload 收下（不做 schema 校验 —— 没有 schema 可对）。
		 */
		if (template.sections.length === 0) {
			const payloads = new Map<string, unknown>();
			for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
				payloads.set(key, value);
			}
			return { ok: true, payloads, keys: new Map() };
		}

		/* ── ① key 归一化（label 或 id → sectionId），未知 key 收集起来 ── */
		const given = new Map<string, unknown>(); /* sectionId → 原始 payload */
		const keyOf = new Map<string, string>(); /* sectionId → 调用方给的原始 key */
		const unknown: string[] = [];
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
			const section = validator.sectionByKey.get(key);
			if (section === undefined) {
				unknown.push(key);
				continue;
			}
			given.set(section.id, value);
			keyOf.set(section.id, key);
		}

		/* ── ② 未知 key ⇒ 一次报全（列出可用章节 + 它们的 action） ── */
		if (unknown.length > 0) {
			return unknownKeysFailure(ref, template, unknown);
		}

		/* ── ③ 逐章节校验 —— 失败就攒起来，一次报全（不是只报第一个） ── */
		const payloads = new Map<string, unknown>();
		const issues: { section: SectionDef; key: string; issue: SectionIssue }[] = [];

		for (const section of template.sections) {
			const provided = given.get(section.id);
			if (provided === undefined) continue; /* 省略 ⇒ 第 ④ 步填默认值 */

			const verdict = validator.validateSection(section, provided);
			if (verdict.ok) {
				payloads.set(section.id, verdict.value);
				continue;
			}
			const key = keyOf.get(section.id) ?? section.label;
			for (const issue of verdict.issues) issues.push({ section, key, issue });
		}

		if (issues.length > 0) {
			return sectionIssuesFailure(ref, template, issues);
		}

		/* ── ④ 省略的章节填模板默认值 ── */
		for (const section of template.sections) {
			if (payloads.has(section.id)) continue;
			const fallback = section.defaultPayload;
			if (fallback !== undefined) payloads.set(section.id, fallback);
		}

		return { ok: true, payloads, keys: keyOf };
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
	/** sectionId → 该章节用的 payload schema。 */
	const schemaById = new Map<string, z.ZodType>();

	for (const section of template.sections) {
		sectionById.set(section.id, section);
		/* label 与 id 都能当 key —— 但 label 优先（人写得出名字）。 */
		sectionByKey.set(section.label, section);
		sectionByKey.set(section.id, section);

		const action = actions.get(section.action);
		if (action === undefined) return undefined;
		/* 章节可省略 ⇒ 只在「给了」的时候校验；省略由模板默认值补。 */
		schemaById.set(section.id, action.payloadSchema);
	}

	return {
		sectionByKey,
		sectionById,
		validateSection(section: SectionDef, payload: unknown): SectionValidation {
			const schema = schemaById.get(section.id);
			if (schema === undefined) {
				/*
				 * 走到这里说明 buildValidator 与 sections 不一致（不该发生）。
				 * 不静默放行 —— 那是「校验器坏了却装作数据没问题」。
				 */
				return {
					ok: false,
					issues: [{ path: [], message: `章节「${section.label}」没有可用的 schema` }],
				};
			}
			const parsed = schema.safeParse(payload);
			if (parsed.success) return { ok: true, value: parsed.data };
			return {
				ok: false,
				issues: parsed.error.issues.map((issue) => ({
					path: issue.path.map((one) => (typeof one === 'number' ? one : String(one))),
					message: issue.message,
				})),
			};
		},
	};
}

/* ────────────────────────── 两种失败，一套形状 ────────────────────────── */

/**
 * 未知章节名的失败 —— **错误消息就是修复指南**。
 *
 * 消息格式（有测试断言，别改）：
 *
 * ```
 * 模板「X」没有这些章节：「a」、「b」。
 * 可用的章节（key 用引号里的原文）：
 *   「label」 → action=text
 * ```
 */
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

/**
 * 章节 payload 形状不对的失败。
 *
 * 与 `unknownKeysFailure` **同一个 `Failure` 形状**：
 * `code` 都是 `CONTENT_INVALID`，都有 `issues: FieldIssue[]`，
 * `path` 都是 JSON Pointer（`/content/<调用方给的原 key>/<字段>`）。
 *
 * 消息开头保留旧格式（`模板「X」的章节内容格式不对。`），
 * 后面补上逐章节的精确位置 —— 那才是模型能照着改的东西。
 */
function sectionIssuesFailure(
	ref: string,
	template: TemplateDef,
	issues: readonly { section: SectionDef; key: string; issue: SectionIssue }[],
): Failure {
	const lines = [`模板「${template.displayName || ref}」的章节内容格式不对。`, '逐条修正：'];
	for (const { section, key, issue } of issues) {
		const where = issue.path.length === 0 ? '（整体）' : issue.path.map(String).join('.');
		lines.push(`  「${key}」的 ${where}：${issue.message}（该章 action=${section.action}）`);
	}

	return failure(ErrorCode.CONTENT_INVALID, lines.join('\n'), {
		issues: issues.map(({ key, issue }) => ({
			path: pointerOf(['content', key, ...issue.path.map(String)]),
			message: issue.message,
		})),
		detail: { templateRef: ref },
	});
}

/** 拼一个 JSON Pointer（每段转义 `~` 与 `/`）。 */
function pointerOf(segments: readonly string[]): string {
	const escaped = segments.map((one) => one.replace(/~/gu, '~0').replace(/\//gu, '~1'));
	return `/${escaped.join('/')}`;
}

/** 取模板的全部默认 payload（key = sectionId）。 */
function defaultsOf(template: TemplateDef): ReadonlyMap<string, unknown> {
	const payloads = new Map<string, unknown>();
	for (const section of template.sections) {
		if (section.defaultPayload !== undefined) payloads.set(section.id, section.defaultPayload);
	}
	return payloads;
}

