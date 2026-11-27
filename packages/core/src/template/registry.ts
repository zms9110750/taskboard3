/**
 * 模板注册表 —— **注册 / 注销 / 变更通知**。
 *
 * ## 通知是契约的一部分（用户明确要求）
 *
 * > 「任何模板被注册/注销的时候需要通知。而架构会监听这个通知。
 * >    他会在这个时候重建架构。」
 *
 * ⇒ 监听器集合 + `onChange(fn)` 退订函数。监听器**同步**调用（不是微任务）：
 *   「重建 schema 缓存」必须在一次校验之前完成，异步会让中间态被观察到。
 *
 * ## 注册与注销对称
 *
 * `register` 返回的注销函数幂等。注销一个已注销的模板是**无操作**，不抛 ——
 * 这样"关掉一个 mod"不会因为顺序问题炸掉整个装配。
 *
 * ## 注册冲突要炸
 *
 * 同名 ref 注册两次是**装配错误**，必须抛。静默覆盖会让"到底用哪份定义"
 * 变成不可判的事实。
 *
 * ## 解析归 `loader.ts`，读包内文件归 `builtin.ts`
 *
 * 本文件只管「放进表里 + 通知」。**不碰磁盘。**
 *
 * ## ⚠ 没有 `loadDirectory(dir)`（`2026-11-23` 删）
 *
 * 用户裁决：
 *
 * > 「所谓的留接口是留注册接口。给别人以包的形式接入。不是以文本 yaml 的形式接入。」
 * > 「外来的包原则上不该挤进去这个放配置的地方。」
 *
 * ⇒ 「给我一个目录」这条路**整个删掉**。模板从哪来只有两条：
 *   1. `@taskboard/core` 包内自带的（`builtin.ts` 在启动时读一次）
 *   2. 别人的**包**在 `apply` 里调 `registerAll()` / `register()`
 */

import type { TemplateDef, TemplateMeta, TemplateSummary } from './types.ts';
import { describe, summarize } from './types.ts';

/** 一个模板加载失败的原因。 */
export interface TemplateLoadError {
	/** 文件路径。 */
	readonly file: string;
	/** 人话原因。 */
	readonly message: string;
}

/**
 * 模板注册表。
 *
 * 一个实例属于一个「任务板实例」—— **不是全局单例**，
 * L2 测试要能同时开多个互不干扰。
 */
export class TemplateRegistry {
	readonly #templates = new Map<string, TemplateDef>();
	readonly #listeners = new Set<() => void>();
	#errors: TemplateLoadError[] = [];

	/**
	 * 注册一个模板。
	 *
	 * @throws 已存在同名 ref（装配错误，静默覆盖会让"用哪份定义"不可判）
	 * @returns 注销函数（幂等）
	 */
	register(template: TemplateDef): () => void {
		if (this.#templates.has(template.ref)) {
			throw new TypeError(`taskboard3-core: 模板「${template.ref}」已注册`);
		}
		this.#templates.set(template.ref, Object.freeze(template));
		this.#notify();

		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			if (this.#templates.delete(template.ref)) this.#notify();
		};
	}

	/** 取一个模板定义。 */
	get(ref: string): TemplateDef | undefined {
		return this.#templates.get(ref);
	}

	/** 全部模板（注册顺序）。 */
	list(): readonly TemplateDef[] {
		return [...this.#templates.values()];
	}

	/** 摘要清单（给选择器）。 */
	summaries(): readonly TemplateSummary[] {
		return this.list().map(summarize);
	}

	/** 展开视图（给「看模板有哪些章节」）。 */
	meta(ref: string): TemplateMeta | undefined {
		const template = this.#templates.get(ref);
		return template === undefined ? undefined : describe(template);
	}

	/** 是否已注册。 */
	has(ref: string): boolean {
		return this.#templates.has(ref);
	}

	/** 内置模板加载的错误（正常为空）。见 `setErrors`。 */
	errors(): readonly TemplateLoadError[] {
		return this.#errors;
	}

	/**
	 * 订阅注册变更。
	 *
	 * @returns 退订函数（幂等）
	 */
	onChange(fn: () => void): () => void {
		this.#listeners.add(fn);
		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			this.#listeners.delete(fn);
		};
	}

	/**
	 * 批量注册（**一次性通知**）。
	 *
	 * ## 为什么需要它
	 *
	 * 内置模板有 18 个。逐个 `register()` 会广播 18 次变更 ——
	 * 订阅方（schema 缓存）会白重建 18 次。
	 *
	 * ## 这是「包形式接入」的入口
	 *
	 * 第三方包在它的 `apply` 里调这个（或对单个模板调 `register()`）。
	 * **不是**「给我一个 YAML 目录」—— 那条路已删（见文件头）。
	 *
	 * @param templates 模板清单
	 * @throws 有任何一个 ref 已注册，或**同一批**里出现重复 ref（装配错误）
	 */
	registerAll(templates: readonly TemplateDef[]): void {
		/*
		 * 先整体校验再写入 —— 半途抛错会让注册表停在「一半」的状态。
		 * ⚠ 既要查**已有表**，也要查**入参自身**：同一批里两个同 ref 会让后者
		 *   静默覆盖前者（`#templates.set` 不报错）。
		 */
		const seen = new Set<string>();
		for (const template of templates) {
			if (seen.has(template.ref)) {
				throw new TypeError(`taskboard3-core: 模板「${template.ref}」在同一批里重复`);
			}
			seen.add(template.ref);
			if (this.#templates.has(template.ref)) {
				throw new TypeError(`taskboard3-core: 模板「${template.ref}」已注册`);
			}
		}
		for (const template of templates) {
			this.#templates.set(template.ref, Object.freeze(template));
		}
		if (templates.length > 0) this.#notify();
	}

	/**
	 * 记下「内置模板加载时的失败」。
	 *
	 * ## 为什么不是 `registerAll` 的一部分
	 *
	 * 加载失败发生在「读包内 YAML」那一步（`builtin.ts`），注册表只关心
	 * 「已注册成功的有哪些」。两件事分开：注册表**存储**失败原因，但不**产生**它。
	 *
	 * @param errors 失败清单（正常为空）
	 */
	setErrors(errors: readonly TemplateLoadError[]): void {
		this.#errors = [...errors];
	}

	/** 触发全部监听器（同步；一个抛错不影响其它）。 */
	#notify(): void {
		for (const fn of this.#listeners) {
			try {
				fn();
			} catch (error) {
				// TODO(审查): 库层直接 console（同 actions/domains 的监听器）⇒ 建议注入可选 logger，省略退回 console，可直接改。
				console.error('[taskboard3-core] 模板变更监听器抛错：', error);
			}
		}
	}
}

