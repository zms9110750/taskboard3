/**
 * 「工具权限」页的**净函数**：工具清单的投影与校验。
 *
 * ## 为什么单独一个 `.ts`（不在 `.tsx` 里）
 *
 * 本仓的测试直接 `node --test` 跑源码，而 **Node 不认 `.tsx`**
 * （`ERR_UNKNOWN_FILE_EXTENSION`）。净函数放进 `.tsx` ⇒ 测试只能放弃覆盖它。
 * 这里的输入是网络边界上的 `unknown`，**恰恰是最需要测试的那类代码**。
 *
 * ⇒ 所以 `.tsx` 只管渲染，判定逻辑住在这里（AGENTS 规则 3 / 6）。
 */

/** 一个工具条目（`/api/tools` 投影出来的形状）。 */
export interface ToolEntry {
	/** 注册名（真名，比如 `taskboard_update`）。 */
	readonly name: string;
	/** 它归哪一边：`任务板` / `宿主`。 */
	readonly source: string;
}

/**
 * 按注册名判断来源。
 *
 * @param name 工具的注册名
 * @returns `taskboard_` 前缀 ⇒ `任务板`，否则 `宿主`
 */
export function sourceOfName(name: string): string {
	return name.startsWith('taskboard_') ? '任务板' : '宿主';
}

/**
 * `/api/tools` 响应的一项（只声明本页用到的字段）。
 *
 * ⚠ 它是**不可信输入**的声明形状，不是保证 —— 真校验在 `parseToolList` 里逐项做。
 */
interface ToolSummaryWire {
	readonly name?: unknown;
	readonly description?: unknown;
	readonly parameters?: unknown;
}

/**
 * 把 `/api/tools` 的响应解成页面要的条目。
 *
 * @param raw `fetch().json()` 的原值（`unknown` —— 不可信）
 * @returns 条目数组；**结构不对时返回 `undefined`**（调用方据此降级到夹具）
 *
 * ## 三条判定规则（都由测试钉住）
 *
 * 1. **整体形状不对**（不是对象 / 没有 `tools` 数组）⇒ `undefined`
 * 2. **空清单** ⇒ `undefined`。理由：「0 个工具」在真实 DSH 里不成立，
 *    更可能是路由打到了别的端点 —— 这时候**必须降级并提示**，不能装作「没有工具」。
 * 3. **单个条目脏**（`null` / 缺 `name` / `name` 不是非空字符串）⇒ **跳过它**，
 *    不让一个坏条目把整页拖进降级态。
 */
export function parseToolList(raw: unknown): readonly ToolEntry[] | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const holder = raw as { readonly tools?: unknown };
	if (!Array.isArray(holder.tools)) return undefined;

	const out: ToolEntry[] = [];
	for (const one of holder.tools as readonly unknown[]) {
		if (typeof one !== 'object' || one === null) continue;
		const item = one as ToolSummaryWire;
		if (typeof item.name !== 'string' || item.name === '') continue;
		out.push({ name: item.name, source: sourceOfName(item.name) });
	}
	return out.length === 0 ? undefined : out;
}
