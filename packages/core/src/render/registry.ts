/**
 * 渲染注册表的 **core 侧** —— 只比对字符串、只算描述，**零 React**。
 *
 * ## 为什么 core 里会有「渲染」相关的东西
 *
 * 用户 `2026-11-18`：
 * > 「我希望渲染器走UI里面注册表。core看着模板，说我这里需要什么什么。然后平常不管。
 * >  ui在和core接通的时候，core就看ui给的注册。如果没有对应的，就进行警告。
 * >  ui真用了，而没有注册的时候，就报错。
 * > 并core提供备用的渲染器：直接渲染只读的格式化json。」
 *
 * ⇒ core 的职责只有三件，**都不涉及组件**：
 *
 * | 时刻 | core 做什么 | 本文件里的函数 |
 * |---|---|---|
 * | ① 接通 | 比对「模板要求的」和「UI 注册的」 | `missingRenderers()` |
 * | ⑧ 平常 | **什么都不做** | —— |
 * | ④ 兜底 | 把 payload 描述成可画的 JSON | `jsonPreviewOf()` |
 *
 * ⚠ **core 不写日志。** 它不知道自己跑在 Host 还是别的宿主里
 * （对比：`bus.ts` 用 `console.error` 是因为它明确知道自己只在 Host 进程里跑，原型期遗留）。
 * `render/` 是新代码，保持纯 —— 谁调谁打日志。
 *
 * ⚠ **core 不 import React，也不能。** `package.json` 的依赖只有
 * `@taskboard/protocol` / `yaml` / `zod`，`tsconfig` 的 `types` 只有 `node`。
 * 加 React 进 core = 让 Host 侧加载浏览器 UI 框架。
 */

/* ══════════════════════════════════════════════════════════
   ① 接通时的检查
   ══════════════════════════════════════════════════════════ */

/**
 * 算出「模板需要、但 UI 没注册」的 action type。
 *
 * 纯函数：**只算，不抛，不打日志**（日志由调用方各打各的 —— Host 打 Host 的、
 * 浏览器打 console）。这样它能被 `node --test` 直接覆盖。
 *
 * ⚠ **不接收 `TemplateDef[]`**：那会把这个函数绑死在模板结构上，
 * 还得在这里处理脏模板。接收**扁平字符串数组** —— 谁算 `required` 是调用方的事，
 * core 通过 `Taskboard.requiredActions()` 提供那个「算」的地方。
 *
 * @param required 模板清单需要的 action type（可有重复，内部去重）
 * @param registered UI 报上来的已注册 type（可有重复，内部去重）
 * @returns 需要但没注册的 type，**去重 + 排序**（排序让输出稳定，便于断言与日志比对）
 */
export function missingRenderers(
	required: readonly string[],
	registered: readonly string[],
): readonly string[] {
	const have = new Set(registered);
	const missing = new Set<string>();
	for (const one of required) {
		if (!have.has(one)) missing.add(one);
	}
	/* 排序让同样的输入永远给同样的输出 —— 日志可以按行 diff。 */
	return [...missing].sort();
}

/* ══════════════════════════════════════════════════════════
   ④ 兜底：payload → 只读格式化 JSON 的描述
   ══════════════════════════════════════════════════════════ */

/**
 * 「一个值」的描述。
 *
 * ⚠ **为什么不用 `JSON.stringify(payload, null, 2)`**：
 *
 * 1. **要能区分「不认识的东西」** —— `JSON.stringify` 遇到函数直接丢掉、
 *    遇到 `undefined` 丢掉、遇到循环引用**抛错**、遇到 `NaN` 变成 `null`。
 *    ⇒ 「没渲染出来」和「内容就是 null」分不清。这是本设计的核心要求
 *    （用户：「ui 真用了，而没有注册的时候，就报错」—— 同理，
 *      payload 里有怪东西时也必须看得见）。
 * 2. **要深度上限** —— 一张卡的 payload 可能嵌套极深，递归会栈溢出。
 * 3. **要长度截断** —— 一个大数组不该把界面撑爆。
 * 4. **要过 HTTP** —— 输出必须是 JSON 安全的：不能含函数 / `undefined` / `Symbol`。
 *
 * ## 谁画它
 *
 * 描述是**纯数据**，由 `dsh-client` 的 `JsonFallback` 组件画成带颜色的树。
 * core 只负责「说清楚这是什么」，不负责「长什么样」。
 */
export type JsonPreview =
	| {
			readonly kind: 'object';
			readonly entries: readonly {
				readonly key: string;
				readonly value: JsonPreview;
			}[];
			/** 被截断掉的键数（0 = 没截断）。 */
			readonly truncated: number;
	  }
	| {
			readonly kind: 'array';
			readonly items: readonly JsonPreview[];
			/** 被截断掉的元素数（0 = 没截断）。 */
			readonly truncated: number;
	  }
	| { readonly kind: 'string'; readonly value: string; readonly truncated: boolean }
	/** 数字统一转成字符串 —— 这样 `NaN` / `Infinity` 能和普通数字一样挂在 `value` 上。 */
	| { readonly kind: 'number'; readonly value: string }
	| { readonly kind: 'boolean'; readonly value: boolean }
	| { readonly kind: 'null' }
	/** `undefined` —— 和 `null` **分开**，因为 JSON 里 `null` 是「有值且是空」，`undefined` 是「没有」。 */
	| { readonly kind: 'undefined' }
	/**
	 * 无法表示的东西（函数 / Symbol / 大整数 / 循环引用 / 超深嵌套）。
	 *
	 * ⚠ **必须画出来，不能静默变 null** —— 否则「payload 里有怪东西」这个事实会被藏起来，
	 *   而藏起来的后果是「界面显示空，但没人知道为什么空」。
	 */
	| { readonly kind: 'opaque'; readonly note: string };

/** 对象 / 数组最多展开多少项（剩下的进 `truncated`）。 */
export const JSON_PREVIEW_MAX_ITEMS = 200;

/** 最多递归多少层（超过的变成 `opaque`）。 */
export const JSON_PREVIEW_MAX_DEPTH = 12;

/** 单个字符串最多显示多少字符（超过的截断并标 `truncated`）。 */
export const JSON_PREVIEW_MAX_STRING = 2000;

/**
 * 把任意值描述成只读格式化 JSON。
 *
 * **永远不抛**：任意脏数据都给一个能画的东西。
 *
 * @param payload 任意值（包括脏数据）
 * @returns 描述树；永远非空（最差是一个 `opaque`）
 */
export function jsonPreviewOf(payload: unknown): JsonPreview {
	/*
	 * `seen` 记当前**递归路径**上的祖先（不是所有见过的值）。
	 * 只有祖先才算循环；兄弟节点重复引用同一个对象是合法的（DAG，不是环）。
	 */
	return describeValue(payload, 0, new Set<object>());
}

/**
 * 递归描述一个值。
 *
 * @param value 任意值
 * @param depth 当前深度（0 = 根）
 * @param seen 当前递归路径上的祖先对象
 */
function describeValue(value: unknown, depth: number, seen: ReadonlySet<object>): JsonPreview {
	if (depth > JSON_PREVIEW_MAX_DEPTH) {
		return { kind: 'opaque', note: `<嵌套超过 ${JSON_PREVIEW_MAX_DEPTH} 层>` };
	}

	if (value === null) return { kind: 'null' };
	if (value === undefined) return { kind: 'undefined' };

	switch (typeof value) {
		case 'string':
			return value.length > JSON_PREVIEW_MAX_STRING
				? {
						kind: 'string',
						value: value.slice(0, JSON_PREVIEW_MAX_STRING),
						truncated: true,
				  }
				: { kind: 'string', value, truncated: false };
		case 'number':
			/*
			 * `NaN` / `Infinity` / `-Infinity` 都留在这里，靠字符串表达 ——
			 * 它们的值是「真的不是有限数」，不是「不认识」。
			 * 用 `String()` 而不是 `JSON.stringify()`：后者会把它们变成 `null`。
			 */
			return { kind: 'number', value: String(value) };
		case 'boolean':
			return { kind: 'boolean', value };
		case 'bigint':
			/* `JSON.stringify(1n)` 直接抛 `TypeError`。 */
			return { kind: 'opaque', note: `<bigint ${String(value)}>` };
		case 'symbol':
			return { kind: 'opaque', note: value.toString() };
		case 'function':
			/*
			 * 函数不可能过 HTTP，但它在 payload 里出现是个**事实**，要显示出来。
			 * 用 `name` 而不是整个 `toString()` —— 源码进描述会把体积撑爆。
			 */
			return { kind: 'opaque', note: `<function ${value.name === '' ? '(anonymous)' : value.name}>` };
	}

	/* 剩下的只有 object。 */
	const asObject = value as object;

	if (seen.has(asObject)) {
		return { kind: 'opaque', note: '<循环引用>' };
	}

	/*
	 * ⚠ **必须新建 Set 而不是 add/delete** —— 后者在并发/异常路径上容易漏删，
	 * 而且「当前路径」这件事用不可变集合表达最直接。
	 * 代价是每层一次 Set 拷贝；深度上限 12，可忽略。
	 */
	const next = new Set(seen);
	next.add(asObject);

	if (Array.isArray(asObject)) {
		const shown = asObject.slice(0, JSON_PREVIEW_MAX_ITEMS);
		return {
			kind: 'array',
			items: shown.map((one) => describeValue(one, depth + 1, next)),
			truncated: asObject.length - shown.length,
		};
	}

	/* Date / Map / Set 等：当作对象展开没意义，直接标出来。 */
	if (!isPlainObject(asObject)) {
		const ctor: unknown = (asObject as { constructor?: unknown }).constructor;
		const name =
			typeof ctor === 'function' && (ctor as { name?: unknown }).name !== undefined
				? String((ctor as { name: string }).name)
				: 'Object';
		/*
		 * `Date` 单独处理：它是最常见的内建对象，把 ISO 字符串显示出来比 `<Date>` 有用得多。
		 * 但**只读它自己的值**，不走 `toJSON()`（那可能被覆写并产生副作用）。
		 */
		if (asObject instanceof Date) {
			return { kind: 'opaque', note: `<Date ${Number.isNaN(asObject.getTime()) ? 'Invalid' : asObject.toISOString()}>` };
		}
		return { kind: 'opaque', note: `<${name}>` };
	}

	const keys = Object.keys(asObject);
	const shown = keys.slice(0, JSON_PREVIEW_MAX_ITEMS);
	return {
		kind: 'object',
		entries: shown.map((key) => ({
			key,
			value: describeProp(asObject, key, depth, next),
		})),
		truncated: keys.length - shown.length,
	};
}

/**
 * 读一个属性并描述它，**getter 抛错时不炸整棵树**。
 *
 * `Object.defineProperty` 可以定义会抛的 getter；`JSON.stringify` 遇到它会整个失败。
 * 描述器不该因为一个坏 getter 就放弃其它所有字段。
 *
 * @param target 目标对象
 * @param key 键
 * @param depth 当前深度
 * @param seen 祖先集合
 */
function describeProp(target: object, key: string, depth: number, seen: ReadonlySet<object>): JsonPreview {
	let value: unknown;
	try {
		value = (target as Record<string, unknown>)[key];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { kind: 'opaque', note: `<getter 抛错：${message}>` };
	}
	return describeValue(value, depth + 1, seen);
}

/**
 * 是不是「普通对象」（字面量 / `Object.create(null)` / class 实例）。
 *
 * ⚠ class 实例这里**算普通对象** —— 它的自有属性就是它的数据。
 * 只有 `Date` / `Map` / `Set` / `RegExp` 这类「数据藏在内部槽里、自有属性为空」
 * 的才需要特殊标记，否则 `new Map([[1,2]])` 会显示成 `{}`（看起来像空对象，是误导）。
 *
 * @param value 任意对象
 */
function isPlainObject(value: object): boolean {
	const proto: unknown = Object.getPrototypeOf(value);
	if (proto === null || proto === Object.prototype) return true;
	/* class 实例：原型链上有 constructor，且不是内建集合类型。 */
	return !(
		value instanceof Map ||
		value instanceof Set ||
		value instanceof RegExp ||
		value instanceof Date
	);
}
