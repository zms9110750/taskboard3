/**
 * action 的**字符串输出** —— 每个 action 注册一个函数，从 JSON object 到 string。
 *
 * ## 用户 2026-11-22 的规格
 *
 * > 「C5 action 的字符串输出 —— 形状：每个 action 要注册一个函数。从 json Object 到 string。」
 *
 * ⇒ 注册表：`type` → `(payload) => string`。
 *
 * ## 为什么需要它
 *
 * 同一个 payload 会在很多地方被「读成人话」：
 * - AI tool 的纯文本输出（`taskboard_card` 返回的 `text`）
 * - 日志 / 浏览器控制台
 * - 将来导出 Markdown / 复制到剪贴板
 *
 * 如果每处各写一遍格式化，就会出现**三套不一致的文案**。
 *
 * ## 降级函数**也在注册表里**（用户 2026-11-22）
 *
 * > 「分发器写了逻辑。但是找不到注册的渲染器，降级的降级渲染器应该是组件。
 * >   **UI 和 tool 的两边都应该如此。**」
 *
 * ⇒ 「找不到注册的渲染器时怎么办」不是两行 `if`，而是注册表上的
 *   **一个可替换的一等公民**（`setFallback` / `fallback`）。
 *   UI 侧（`dsh-client/src/render-registry.ts`）结构对称。
 *
 * 默认降级 = 把原始 JSON 格式化成人读文字（旧行为），但它**只是默认值**，
 * 第三方可以整体换掉 —— 换掉之后本文件里不再有任何关于「降级长什么样」的知识。
 */


/* ══════════════════════════════════════════════════════════
   类型
   ══════════════════════════════════════════════════════════ */

/** 一个 action 的格式化函数：JSON object → 人读字符串。 */
export type ActionTextFn = (payload: Record<string, unknown>) => string;

/** 注册表。 */
export interface ActionTextRegistry {
	/**
	 * 注册一个 action 的文字格式化函数。
	 *
	 * @throws type 为空白 / 重复注册
	 */
	register(type: string, format: ActionTextFn): void;
	/** 有没有注册过。 */
	has(type: string): boolean;
	/** 取格式化函数（没注册返回 `null`）。 */
	get(type: string): ActionTextFn | null;
	/** 列出已注册的 type（**按注册顺序**）。 */
	types(): readonly string[];
	/**
	 * 设置**降级函数** —— 没注册的 `$type`（或 payload 根本没有 `$type`）时用它。
	 *
	 * @throws 已经设置过
	 */
	setFallback(fn: ActionTextFn): void;
	/** 取当前降级函数（**永远有值** —— 注册表自带一个默认的）。 */
	fallback(): ActionTextFn;
}

/* ══════════════════════════════════════════════════════════
   注册表实现
   ══════════════════════════════════════════════════════════ */

/**
 * 默认的降级函数 —— 把 payload 格式化成原始 JSON。
 *
 * ⚠ **它不是「降级逻辑」本身，只是默认值。** 注册表里 `fallback()` 拿到的
 *   永远是这个或第三方换掉的那个；`textOfAction` 只调 `fallback()`，
 *   不知道降级长什么样。
 *
 * @param payload 未注册的 payload（**任意形状**，不是 `$type` 已知的对象）
 */
function jsonFallbackOf(payload: Record<string, unknown>): string {
	return JSON.stringify(payload);
}

/**
 * 造一个注册表。
 *
 * @param seed 初始注册项（可选）
 * @param fallback 降级函数（可选，省略 = 内置的 JSON 格式化）
 */
export function createActionTextRegistry(
	seed?: readonly (readonly [string, ActionTextFn])[],
	fallback?: ActionTextFn,
): ActionTextRegistry {
	const table = new Map<string, ActionTextFn>();

	/**
	 * 当前降级函数 + 「是否已被设置」。
	 *
	 * 构造参数显式给了也算「已设置」—— 否则 `setFallback` 能把它覆盖掉，
	 * 那就变成「构造时说了一个、运行时又说了一个」，仍然不可预测。
	 */
	let fallbackFn: ActionTextFn = fallback ?? jsonFallbackOf;
	let fallbackSet = fallback !== undefined;

	/**
	 * 注册实现 —— **seed 和运行时注册共用同一套校验**。
	 *
	 * ## 两条校验（用户 2026-11-22）
	 *
	 * > 「两个组件抢同一个 type，应该抛错。组件的展示不应该由第三方提供。
	 * >   理应有 action 自己的提供者提供唯一的。」
	 *
	 * | 校验 | 挡什么 |
	 * |---|---|
	 * | 空 type | 注册成 '' 会命中「payload 没有 $type」的兜底路径 |
	 * | 重复注册 | 两个提供者抢同一 type ⇒ 谁生效取决于注册顺序 = 不可预测 |
	 *
	 * ⚠ **seed 也走这条路径** —— 直接 `table.set` 会让「启动时写了两个同 type」
	 *   被静默覆盖，那和运行时抢占是同一个错误。
	 */
	const put = (type: string, format: ActionTextFn): void => {
		if (type.trim() === '') {
			throw new Error(
				'action 文字渲染器的 type 不能是空白。' +
					'空 type 会让「payload 没有 $type」的情况误命中一个渲染器。',
			);
		}
		if (table.has(type)) {
			throw new Error(
				`action「${type}」的文字渲染器重复注册。` +
					'同一个 type 只能有一个提供者 —— 两个提供者抢同一个 type 时，' +
					'谁生效取决于注册顺序，那是不可预测的行为。',
			);
		}
		table.set(type, format);
	};

	for (const entry of seed ?? []) put(entry[0], entry[1]);

	return {
		register: put,
		has(type) {
			return table.has(type);
		},
		get(type) {
			return table.get(type) ?? null;
		},
		types() {
			return [...table.keys()];
		},
		setFallback(fn) {
			/*
			 * 和 `register` 同一条规则的反面：一个 type 只能有一个提供者，
			 * **降级函数也只能有一个**。后设的覆盖先设的会让「到底哪个在生效」
			 * 取决于调用顺序 —— 那是不可预测的行为。
			 */
			if (fallbackSet) {
				throw new Error(
					'降级函数已经设置过，不能重复设置。' +
						'降级函数只有一个提供者 —— 两个提供者抢同一个槽位时，' +
						'谁生效取决于调用顺序，那是不可预测的行为。',
				);
			}
			fallbackFn = fn;
			fallbackSet = true;
		},
		fallback() {
			return fallbackFn;
		},
	};
}

/* ══════════════════════════════════════════════════════════
   内置三件
   ══════════════════════════════════════════════════════════ */

/** 纯文本：直接给值。 */
function textOf(payload: Record<string, unknown>): string {
	const value = payload['value'];
	return typeof value === 'string' ? value : '';
}

/**
 * Markdown：给原文（**不剥标记**）。
 *
 * 理由：这是「字符串输出」，不是「渲染」。剥标记会让用户复制到的内容失真；
 * 需要渲染时走 `MarkdownBlock`。
 */
function markdownOf(payload: Record<string, unknown>): string {
	return textOf(payload);
}

/**
 * ask：把问卷排成人读的文本。
 *
 * 形状：
 * ```
 * 这次要解决什么问题？
 *   1. 选项一 — 说明
 *   2. 选项二
 * ```
 * 多问题组之间空一行。
 */
function askOf(payload: Record<string, unknown>): string {
	const items = payload['items'];
	if (!Array.isArray(items) || items.length === 0) return '';

	const blocks: string[] = [];
	for (let index = 0; index < items.length; index += 1) {
		const raw: unknown = items[index];
		if (typeof raw !== 'object' || raw === null) continue;
		const item = raw as Record<string, unknown>;

		const header = typeof item['header'] === 'string' ? item['header'] : '';
		const question = typeof item['question'] === 'string' ? item['question'] : '';
		const placeholder = typeof item['placeholder'] === 'string' ? item['placeholder'] : '';
		const multi = item['multi_select'] === true;

		const lines: string[] = [];
		if (header !== '') lines.push(header);
		if (question !== '') lines.push(question);
		if (placeholder !== '') lines.push(`（${placeholder}）`);
		if (multi) lines.push('（可多选）');

		const options = Array.isArray(item['options']) ? item['options'] : [];
		for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
			const rawOption: unknown = options[optionIndex];
			if (typeof rawOption !== 'object' || rawOption === null) continue;
			const option = rawOption as Record<string, unknown>;
			const label = typeof option['label'] === 'string' ? option['label'] : '';
			const description = typeof option['description'] === 'string' ? option['description'] : '';
			if (label === '') continue;
			lines.push(description === '' ? `  ${String(optionIndex + 1)}. ${label}` : `  ${String(optionIndex + 1)}. ${label} — ${description}`);
		}

		const picked = Array.isArray(item['picked'])
			? item['picked'].filter((one): one is string => typeof one === 'string')
			: [];
		if (picked.length > 0) lines.push(`  已选：${picked.join('、')}`);
		const custom = Array.isArray(item['custom'])
			? item['custom'].filter((one): one is string => typeof one === 'string')
			: [];
		if (custom.length > 0) lines.push(`  自填：${custom.join('、')}`);
		if (picked.length === 0 && custom.length === 0) lines.push('  状态：未选择');

		if (lines.length > 0) blocks.push(lines.join('\n'));
	}

	return blocks.join('\n\n');
}

/* ══════════════════════════════════════════════════════════
   默认注册表
   ══════════════════════════════════════════════════════════ */

/** 内置三件（`satisfies` 保证键集 —— 少一个都会编译失败）。 */
const BUILTIN: readonly (readonly [string, ActionTextFn])[] = [
	['text', textOf],
	['markdown', markdownOf],
	['ask', askOf],
] satisfies readonly (readonly [string, ActionTextFn])[];

/** 默认注册表（内置三件已注册，可以继续 `register` 第三方）。 */
// TODO(审查): 模块级可变单例，任何包 `register` 都影响所有实例（测试 action-text.test.ts 就这么改全局）⇒ 建议由 `createTaskboard` 造实例注入、只保留默认值，可直接改。
export const DEFAULT_ACTION_TEXT: ActionTextRegistry = createActionTextRegistry(BUILTIN);

/* ══════════════════════════════════════════════════════════
   入口
   ══════════════════════════════════════════════════════════ */

/**
 * 把一个 payload 转成字符串。
 *
 * ## 两条路径，第二段**永远是 `fallback()`**（不是硬编码）
 *
 * ```
 * payload.$type 是字符串 → registry.get(type)
 *                              ├── 命中  → format(payload)
 *                              └── 未命中 → registry.fallback()(payload)
 * payload.$type 缺失/非字符串 ──────→ registry.fallback()(payload)
 * ```
 *
 * @param payload action payload（`{ $type, ... }`）
 * @param registry 注册表（省略用默认）
 * @returns 人读字符串；**没注册的 type** 走注册表的降级函数
 */
export function textOfAction(payload: unknown, registry: ActionTextRegistry = DEFAULT_ACTION_TEXT): string {
	if (typeof payload !== 'object' || payload === null) return '';

	const record = payload as Record<string, unknown>;
	const type = typeof record['$type'] === 'string' ? record['$type'] : '';
	if (type === '') return registry.fallback()(record);

	const format = registry.get(type);
	if (format === null) {
		/* 不认识的 type ⇒ 交给降级函数（默认是 JSON，第三方可整体换掉）。 */
		return registry.fallback()(record);
	}
	return format(record);
}
