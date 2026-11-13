/**
 * action 注册表 —— **m 个 action**，payload 形状的**唯一来源**。
 *
 * ## 为什么 action 是可注册的
 *
 * 用户：「重依赖的部分只留下扩展和注册，不给关，就不用分包。」
 * ⇒ 模板/状态机关不掉，进 core；action 是**可扩展的**（第三方可加一个
 * `table` / `chart` 之类），所以走注册。
 *
 * ## 三个内置 action
 *
 * 与旧仓库 `templates/actions/*.yaml` 一一对应。它们的 payload schema 在这里
 * 用 zod 写一遍，**是所有模板章节共用的那一份**。
 *
 * ## 注册即失效
 *
 * 注册/注销都调 `onChange`（由 `registry.ts` 传入）—— 章节 schema 缓存要重建，
 * 因为「某个模板的某章用了一个刚被注销的 action」会让那个模板的 schema 变。
 */

import { z } from 'zod';

import type { ActionDef } from './types.js';

/**
 * `text` —— 自由文本。
 *
 * 三态共用同一个 payload：草稿写正文、进行时编辑、完成时只读。
 * `placeholder` 是「内容清空后框里显示的灰字」（三态一致）。
 */
const textSchema = z
	.strictObject({
		$type: z.literal('text'),
		value: z.string().optional(),
		placeholder: z.string().optional(),
	})
	.describe('自由文本。value 是正文，placeholder 是空框灰字。');

/**
 * `markdown` —— 富文本。
 *
 * 与 `text` 的区别只在渲染：创建时可预览源码，进行与完成时只读渲染。
 */
const markdownSchema = z
	.strictObject({
		$type: z.literal('markdown'),
		value: z.string().optional(),
		placeholder: z.string().optional(),
	})
	.describe('Markdown 富文本。value 是源码，placeholder 是空框灰字。');

/** 一个选项。 */
const askOptionSchema = z
	.strictObject({
		label: z.string(),
		description: z.string().optional(),
	})
	.describe('一个可选项。');

/** 一个问卷组（一个问题 + 它的选项）。 */
const askItemSchema = z
	.strictObject({
		header: z.string().optional(),
		question: z.string().optional(),
		options: z.array(askOptionSchema),
		multi_select: z.boolean().optional(),
		/** 三态：不存在 = 未选择；`[]` = 看了但都不要；`["A"]` = 选了 A。 */
		picked: z.array(z.string()).optional(),
		/** 自填值（不进 `picked`）。 */
		custom: z.array(z.string()).optional(),
		placeholder: z.string().optional(),
	})
	.describe('一个问卷组。');

/**
 * `ask` —— 选项选择（单选或多选），恒有「未选择」与自填框。
 *
 * ⚠ `items` 至少一条，且每条必须有 `options` —— 最小合法形态是
 * 「一个空问题组」，不是空对象。
 */
const askSchema = z
	.strictObject({
		$type: z.literal('ask'),
		items: z.array(askItemSchema).min(1),
	})
	.describe('选项选择，单选或多选，恒有「未选择」和自填框。');

/** 三个内置 action。顺序 = 「选择 action」里的显示顺序。 */
export const BUILTIN_ACTIONS: readonly ActionDef[] = Object.freeze([
	{
		$type: 'text',
		summary: '自由文本。创建时写正文（灰字可切换编辑），进行时编辑内容',
		payloadSchema: textSchema,
		defaultPayload: { $type: 'text' },
	},
	{
		$type: 'markdown',
		summary: '富文本。创建时写源码并可预览，进行与完成时只读',
		payloadSchema: markdownSchema,
		defaultPayload: { $type: 'markdown' },
	},
	{
		$type: 'ask',
		summary: '选项选择，单选或多选，恒有「未选择」和自填框',
		payloadSchema: askSchema,
		defaultPayload: { $type: 'ask', items: [{ options: [] }] },
	},
]);

/**
 * action 注册表。
 *
 * 与旧仓库的区别：旧仓库用 `Map` + 一串 `if` 抛错；这里同样用 `Map`，
 * 但**注册面收窄为一个函数**，并且把「注销会通知」做成契约的一部分。
 */
export class ActionRegistry {
	readonly #actions = new Map<string, ActionDef>();
	readonly #listeners = new Set<() => void>();

	constructor() {}

	/**
	 * 订阅注册变更。
	 *
	 * 用户裁定：「任何模板被注册/注销的时候需要通知。而架构会监听这个通知。」
	 * action 也是同一个道理 —— 注销一个 action 会让所有引用它的模板失效。
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

	/** 同步通知全部监听器（一个抛错不影响其它）。 */
	#notify(): void {
		for (const fn of this.#listeners) {
			try {
				fn();
			} catch (error) {
				console.error('[taskboard3-core] action 变更监听器抛错：', error);
			}
		}
	}

	/**
	 * 注册一个 action。
	 *
	 * @returns 注销函数（幂等）。
	 * @throws 名字非法 / 已注册 / schema 不是 zod / defaultPayload 的 $type 不匹配
	 */
	register(def: ActionDef): () => void {
		if (typeof def.$type !== 'string' || !/^[a-z][a-z0-9_]*$/u.test(def.$type)) {
			throw new TypeError(
				`taskboard3-core: action 名「${String(def.$type)}」只能是小写字母开头、字母数字下划线`,
			);
		}
		if (this.#actions.has(def.$type)) {
			throw new TypeError(`taskboard3-core: action「${def.$type}」已注册`);
		}
		if (typeof def.summary !== 'string' || def.summary === '') {
			throw new TypeError(`taskboard3-core: action「${def.$type}」必须有 summary`);
		}
		const payload = def.defaultPayload;
		if (typeof payload !== 'object' || payload === null) {
			throw new TypeError(
				`taskboard3-core: action「${def.$type}」的 defaultPayload 必须是对象`,
			);
		}
		if ((payload as { $type?: unknown }).$type !== def.$type) {
			throw new TypeError(
				`taskboard3-core: action「${def.$type}」的 defaultPayload.$type 必须是「${def.$type}」`,
			);
		}

		this.#actions.set(def.$type, Object.freeze({ ...def }));
		this.#notify();

		let disposed = false;
		return () => {
			if (disposed) return;
			disposed = true;
			this.#actions.delete(def.$type);
			this.#notify();
		};
	}

	/** 取一个 action（未注册返回 `undefined`）。 */
	get($type: string): ActionDef | undefined {
		return this.#actions.get($type);
	}

	/** 全部已注册 action（按注册顺序）。 */
	list(): readonly ActionDef[] {
		return [...this.#actions.values()];
	}

	/** 是否已注册。 */
	has($type: string): boolean {
		return this.#actions.has($type);
	}
}

