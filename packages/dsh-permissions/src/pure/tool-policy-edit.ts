/**
 * 「授权」页的**纯决策**：选中了什么、能编辑吗、改了什么、PUT 发什么（issue #57）。
 *
 * ## 为什么要单独一个纯文件
 *
 * 「选中 → 编辑 → 保存」这条链上真正会出错的是**决策**：
 *
 * | 决策 | 错了会怎样 |
 * |---|---|
 * | 选中的档位映射到哪个 `tier` | `common` 对应服务端的 `claimed`；写错会静默改到别的档 |
 * | 当前生效的工具是哪些 | 拿 `effective`（并集）当可编辑集合 ⇒ 一保存就把别的档的工具搬进本档 |
 * | 差集怎么算 | 把「没改动」也发一遍 ⇒ 每次点保存都写一次 kv |
 * | 什么情况下不能编辑 | 没有原因说明 = 用户点了没反应 |
 *
 * 这些都能被 `node --test` 覆盖（Node 不认 `.tsx`，所以不能住进组件）。
 *
 * ## 可编辑集合是**本档自己的增量**，不是生效集
 *
 * `effective = BASE ∪ 未领卡 ∪ 通用 ∪ 命中的组 ∪ 独立档`（服务端算）。
 * 本档能改的只有自己那一段：档位改 `unclaimed` / `common`，模板改
 * `templates[ref]`。拿 `effective` 当可编辑集合会让「保存」把上游档位
 * 的工具**复制**成本档的增量 —— 语义被悄悄改掉。
 */

import type { GlobalTierKey, ToolPolicySnapshot } from './tool-policy.ts';

/** 左栏选中的对象：全局档位或模板（互斥，见 `TemplateAuthPanel` 的历史注释）。 */
export type AuthSelection =
	| { readonly kind: 'tier'; readonly key: GlobalTierKey }
	| { readonly kind: 'template'; readonly ref: string };

/** 「能不能编辑」的判决。 */
export type Editability =
	| { readonly editable: true }
	| { readonly editable: false; readonly reason: string };

/** 档位 key → 服务端 `tier` 取值（`common` 在 core 里叫 `claimed`）。 */
export function wireTierOf(key: GlobalTierKey): 'unclaimed' | 'claimed' {
	return key === 'unclaimed' ? 'unclaimed' : 'claimed';
}

/**
 * 选中项 → 本档**当前**的工具（原始增量）。
 *
 * @param policy 端点快照
 * @param selection 选中项；`undefined` ⇒ 空数组
 */
export function scopeToolsOf(policy: ToolPolicySnapshot, selection: AuthSelection | undefined): readonly string[] {
	if (selection === undefined) return [];
	if (selection.kind === 'tier') {
		return selection.key === 'unclaimed' ? policy.unclaimed : policy.common;
	}
	return policy.templates.find((one) => one.templateRef === selection.ref)?.tools ?? [];
}

/**
 * 现在能不能编辑。
 *
 * 只有两种「不能」：**还没选**（先选一个）和**模板已经不在了**（选了也存不进去）。
 * 其余情况都可编辑 —— 权限本身由服务端判，UI 不另造一套「只读权限」（AGENTS 3.6：
 * 两份真值必然漂）。真的写不进去时，失败信封会带着服务端的原因显示出来。
 *
 * @param selection 选中项
 * @param templates 模板清单（`GET /api/templates`）
 */
export function editabilityOf(
	selection: AuthSelection | undefined,
	templates: readonly { readonly ref: string }[],
): Editability {
	if (selection === undefined) return { editable: false, reason: '先在左栏选一个档位或模板' };
	if (selection.kind === 'template' && !templates.some((one) => one.ref === selection.ref)) {
		return {
			editable: false,
			reason: `模板「${selection.ref}」已经不在模板清单里（可能被卸载）—— 保存不进去，所以不给编辑。`,
		};
	}
	return { editable: true };
}

/** 一次勾选集合的差集（保存只发差异）。 */
export interface ScopeDiff {
	/** 新勾上的工具名。 */
	readonly allow: readonly string[];
	/** 取消勾选的工具名。 */
	readonly remove: readonly string[];
}

/**
 * 差集：`allow = next \ current`、`remove = current \ next`。
 *
 * @param current 本档当前增量
 * @param next 用户勾选后的完整集合
 */
export function diffOf(current: readonly string[], next: readonly string[]): ScopeDiff {
	const before = new Set(current);
	const after = new Set(next);
	const allow = [...after].filter((one) => !before.has(one));
	const remove = [...before].filter((one) => !after.has(one));
	return { allow, remove };
}

/** 差集为空时不必发请求。 */
export function isNoopDiff(diff: ScopeDiff): boolean {
	return diff.allow.length === 0 && diff.remove.length === 0;
}

/**
 * 保存请求的 body（`PUT /api/tool-policy`）。
 *
 * - `tier` 与 `templateRef` **二选一**（core 的硬约束）；
 * - `BASE` 工具**不进 allow / remove**：它恒可用、不可移除（服务端也会挡住并回报
 *   `protectedRemovals`，但白跑一趟来回没有意义）。
 * - 差集为空 ⇒ `undefined`（调用方据此显示「没有改动」，不发请求）。
 *
 * @param selection 选中项
 * @param diff 差集
 * @param baseTools 恒可用工具名（`policy.baseTools`）
 */
export function putBodyOf(
	selection: AuthSelection,
	diff: ScopeDiff,
	baseTools: readonly string[],
): Record<string, unknown> | undefined {
	if (isNoopDiff(diff)) return undefined;
	const base = new Set(baseTools);
	const allow = diff.allow.filter((one) => !base.has(one));
	const remove = diff.remove.filter((one) => !base.has(one));
	if (allow.length === 0 && remove.length === 0) return undefined;
	const scope = selection.kind === 'tier' ? { tier: wireTierOf(selection.key) } : { templateRef: selection.ref };
	return { ...scope, allow, remove };
}

/**
 * 编辑器的候选工具清单：**已知工具 ∪ 本档已配的工具**，去重排序。
 *
 * 为什么要并上本档的：`/api/tools` 取不到（降级）或工具已下线时，本档里
 * 已有的名字仍然要能看见 / 取消勾选 —— 否则用户永远删不掉一条失效配置。
 *
 * @param toolNames 宿主工具名（`/api/tools`）
 * @param current 本档当前增量
 */
export function pickerToolsOf(toolNames: readonly string[], current: readonly string[]): readonly string[] {
	return [...new Set([...toolNames, ...current])].sort((a, b) => a.localeCompare(b));
}

/** 选中项的稳定 key（DOM 用，也用于测试）。 */
export function selectionKeyOf(selection: AuthSelection | undefined): string {
	if (selection === undefined) return 'none';
	return selection.kind === 'tier' ? `tier:${selection.key}` : `template:${selection.ref}`;
}
