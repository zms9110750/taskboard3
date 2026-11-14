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
 * ## 解析归 `loader.ts`
 *
 * 本文件只管「放进表里 + 通知」。YAML → `TemplateDef` 是 `loader.fromRaw` 的事。
 */

import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

import { loadFile } from './loader.ts';
import type { TemplateDef, TemplateMeta, TemplateSummary } from './types.ts';
import { describe, summarize } from './types.ts';

/** 一个模板加载失败的原因。 */
export interface TemplateLoadError {
	/** 文件路径。 */
	readonly file: string;
	/** 人话原因。 */
	readonly message: string;
}

/** 一次目录加载的结果。 */
export interface LoadResult {
	/** 成功加载的模板数。 */
	readonly loaded: number;
	/** 失败的文件与原因（正常为空）。 */
	readonly errors: readonly TemplateLoadError[];
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

	/** 上一次目录加载的错误（正常为空）。 */
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
	 * 从一个目录**递归**加载全部 `.yaml` / `.yml`。
	 *
	 * 逐文件容错：坏文件记进 `errors()`，不影响其它模板（用户：「如果他出错了，
	 * core 可以继续开」）。
	 *
	 * 全部加载完之后**只通知一次** —— 目录里可能有几十个模板，
	 * 逐条通知会让监听器白重建几十次。
	 */
	loadDirectory(dir: string): LoadResult {
		const errors: TemplateLoadError[] = [];
		let loaded = 0;

		const walk = (current: string): void => {
			let entries: string[];
			try {
				entries = readdirSync(current);
			} catch {
				return;
			}
			for (const name of entries) {
				const file = join(current, name);
				let isDir = false;
				try {
					isDir = statSync(file).isDirectory();
				} catch {
					continue;
				}
				if (isDir) {
					walk(file);
					continue;
				}
				const ext = extname(name).toLowerCase();
				if (ext !== '.yaml' && ext !== '.yml') continue;

				const ref = name.slice(0, -ext.length);
				if (this.#templates.has(ref)) {
					errors.push({ file, message: `模板「${ref}」已注册，跳过` });
					continue;
				}
				const result = loadFile(file, ref);
				if ('error' in result) {
					errors.push({ file, message: result.error });
					continue;
				}
				this.#templates.set(ref, Object.freeze(result.template));
				loaded += 1;
			}
		};

		walk(dir);
		this.#errors = errors;
		if (loaded > 0) this.#notify();
		return { loaded, errors };
	}

	/** 触发全部监听器（同步；一个抛错不影响其它）。 */
	#notify(): void {
		for (const fn of this.#listeners) {
			try {
				fn();
			} catch (error) {
				console.error('[taskboard3-core] 模板变更监听器抛错：', error);
			}
		}
	}
}

