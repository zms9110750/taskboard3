/**
 * `JsonPreview` 的**本地副本** + 描述函数。
 *
 * ## ⚠ 为什么这里有一份重复实现
 *
 * 这个形状和 `jsonPreviewOf()` **已经存在于 `@taskboard/core`**
 * （`packages/core/src/render/registry.ts`）。
 *
 * **但 dsh-client 不能 import core** —— 见 `src/types.ts:1-14`：
 * core 会 `import 'node:sqlite'`，那是 Node 内置模块，浏览器里不存在，
 * 一旦本包 import core，bundler 解析 `node:sqlite` 就会让客户端 bundle 炸。
 *
 * ⇒ 只有两条路：
 *
 * | 方案 | 代价 |
 * |---|---|
 * | A. core 通过 HTTP 把 `JsonPreview` 发过来 | **兜底路径依赖网络** —— 网络坏了兜底也坏，与「兜底永远可用」矛盾 |
 * | B. 本包自己实现一份 | 重复 ~150 行逻辑 |
 *
 * 选了 B：兜底路径**不能有依赖**。网络、宿主服务、core 缺一个都不该让兜底失效。
 *
 * ## ⚠ 这份重复是技术债，要能自己被发现
 *
 * `test/json-preview.test.ts` 里有一条**对照测试**：同一批输入，
 * 本文件和 core 的 `jsonPreviewOf()` 必须产出**逐字段相同**的描述。
 * 任何人改了一边没改另一边 ⇒ 那条测试变红。
 *
 * （core 的版本在 Node 里能跑，测试里用真实 import 对比。这是
 *  AGENTS 3.6 说的「白名单 + 差集断言」——靠测试逼齐，不靠注释。）
 *
 * 根治办法：把 `jsonPreviewOf` 挪到 `@taskboard/protocol`（零依赖、两端都能用），
 * core 改成 re-export。**那要动 `packages/core`，不在这轮范围里。**
 */

/** 对象 / 数组最多展开多少项（剩下的记进 `truncated`）。 */
export const JSON_PREVIEW_MAX_ITEMS = 200;

/** 最多递归多少层（超过的变成 `opaque`）。 */
export const JSON_PREVIEW_MAX_DEPTH = 12;

/** 单个字符串最多显示多少字符（超过的截断并标 `truncated`）。 */
export const JSON_PREVIEW_MAX_STRING = 2000;

/**
 * 把一个值描述成只读格式化 JSON。
 *
 * 八种节点：
 *
 * | `kind` | 何时 |
 * |---|---|
 * | `object` | 普通对象 / class 实例 |
 * | `array` | 数组 |
 * | `string` | 字符串（过长记 `truncated`）|
 * | `number` | 数字（含 `NaN` / `Infinity`，靠 `value` 字符串表达）|
 * | `boolean` | 布尔 |
 * | `null` | `null` |
 * | `undefined` | `undefined`（**和 `null` 分开**：JSON 里 `null` 是「有值且空」，`undefined` 是「没有」）|
 * | `opaque` | 函数 / Symbol / bigint / 循环引用 / Date / Map / Set / 超深嵌套 / 抛错的 getter |
 *
 * ⚠ **`opaque` 必须画出来**，不能静默变 `null` —— 否则「payload 里有怪东西」
 *   这个事实被藏起来，而藏起来的后果是「界面显示空但没人知道为什么空」。
 */
export type JsonPreview =
	| {
			readonly kind: 'object';
			readonly entries: readonly { readonly key: string; readonly value: JsonPreview }[];
			readonly truncated: number;
	  }
	| { readonly kind: 'array'; readonly items: readonly JsonPreview[]; readonly truncated: number }
	| { readonly kind: 'string'; readonly value: string; readonly truncated: boolean }
	| { readonly kind: 'number'; readonly value: string }
	| { readonly kind: 'boolean'; readonly value: boolean }
	| { readonly kind: 'null' }
	| { readonly kind: 'undefined' }
	| { readonly kind: 'opaque'; readonly note: string };

/**
 * 把任意值描述成只读格式化 JSON。**永远不抛。**
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
				? { kind: 'string', value: value.slice(0, JSON_PREVIEW_MAX_STRING), truncated: true }
				: { kind: 'string', value, truncated: false };
		case 'number':
			/* `NaN` / `Infinity` 靠 `String()` 表达；`JSON.stringify` 会把它们变 `null`。 */
			return { kind: 'number', value: String(value) };
		case 'boolean':
			return { kind: 'boolean', value };
		case 'bigint':
			/* `JSON.stringify(1n)` 直接抛 `TypeError`。 */
			return { kind: 'opaque', note: `<bigint ${String(value)}>` };
		case 'symbol':
			return { kind: 'opaque', note: value.toString() };
		case 'function':
			/* 函数过不了 HTTP，但它出现在 payload 里是个事实。用 `name` 不用整个源码。 */
			return {
				kind: 'opaque',
				note: `<function ${value.name === '' ? '(anonymous)' : value.name}>`,
			};
	}

	const asObject = value as object;

	if (seen.has(asObject)) return { kind: 'opaque', note: '<循环引用>' };

	/*
	 * ⚠ 新建 Set 而不是 add/delete —— 后者在异常路径上容易漏删，
	 *   而且「当前路径」用不可变集合表达最直接。深度上限 12，拷贝代价可忽略。
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

	if (!isPlainObject(asObject)) {
		/* `Date` 单独处理：显示 ISO 比 `<Date>` 有用得多。只读它自己的值，不调 `toJSON()`。 */
		if (asObject instanceof Date) {
			return {
				kind: 'opaque',
				note: `<Date ${Number.isNaN(asObject.getTime()) ? 'Invalid' : asObject.toISOString()}>`,
			};
		}
		const ctor: unknown = (asObject as { constructor?: unknown }).constructor;
		const name =
			typeof ctor === 'function' && (ctor as { name?: unknown }).name !== undefined
				? String((ctor as { name: string }).name)
				: 'Object';
		return { kind: 'opaque', note: `<${name}>` };
	}

	const keys = Object.keys(asObject);
	const shown = keys.slice(0, JSON_PREVIEW_MAX_ITEMS);
	return {
		kind: 'object',
		entries: shown.map((key) => ({ key, value: describeProp(asObject, key, depth, next) })),
		truncated: keys.length - shown.length,
	};
}

/**
 * 读一个属性并描述它，**getter 抛错时不炸整棵树**。
 *
 * `Object.defineProperty` 可以定义会抛的 getter；`JSON.stringify` 遇到它会整个失败。
 * 描述器不该因为一个坏 getter 就放弃其它所有字段。
 */
function describeProp(
	target: object,
	key: string,
	depth: number,
	seen: ReadonlySet<object>,
): JsonPreview {
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
 * ⚠ class 实例这里算普通对象 —— 它的自有属性就是它的数据。
 *   只有 `Date` / `Map` / `Set` / `RegExp` 这类「数据藏在内部槽、自有属性为空」的
 *   才需要特殊标记，否则 `new Map([[1,2]])` 会显示成 `{}`（看起来像空对象，误导）。
 */
function isPlainObject(value: object): boolean {
	const proto: unknown = Object.getPrototypeOf(value);
	if (proto === null || proto === Object.prototype) return true;
	return !(
		value instanceof Map ||
		value instanceof Set ||
		value instanceof RegExp ||
		value instanceof Date
	);
}
