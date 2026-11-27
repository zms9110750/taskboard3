/**
 * 纯逻辑 —— **零 React、零网络、零 DOM**。
 *
 * ## 为什么和 `store.ts` 分开
 *
 * `store.ts` 里有 `useBoardState()`，它 import 了 React。而 Node 的
 * `node --test` 加载不了 `react`（浏览器包，宿主提供，我们没装）。
 *
 * 若把这些纯函数留在 `store.ts` 里，**测试就永远跑不起来** ——
 * 这是「纯逻辑被 React 污染」的代价。分开之后：
 *
 *   · `pure.ts` —— 可被 `node --test` 直接 import，97% 的分支在这里
 *   · `store.ts` —— 只有 hook，薄薄一层，靠人工/集成验证
 *
 * ⇒ **以后加任何纯函数，都放这里，不要放进 `store.ts`。**
 */

import type { Card, TemplateSummary, Workspace } from './types.ts';

/**
 * 用一批新卡替换旧列表里的同 id 项。
 *
 * @param cards 当前列表
 * @param updates 要替换的卡（找不到 id 就忽略 —— 不往列表里塞新卡）
 * @returns 新数组；没有任何命中时**返回原数组**（让 React 跳过重渲染）
 */
export function replaceCards(cards: readonly Card[], updates: readonly Card[]): readonly Card[] {
	if (updates.length === 0) return cards;
	const byId = new Map(updates.map((card) => [card.id, card]));
	let changed = false;
	const next = cards.map((card) => {
		const replacement = byId.get(card.id);
		if (replacement === undefined) return card;
		changed = true;
		return replacement;
	});
	return changed ? next : cards;
}

/**
 * 把一次动作的返回（`card` + `recomputed`）合进列表。
 *
 * 服务端的写操作返回这两样，UI **就地替换**，不重拉全量。
 *
 * @param cards 当前列表
 * @param result 服务端返回
 * @returns 新数组
 */
export function mergeActionResult(
	cards: readonly Card[],
	result: { readonly card: Card; readonly recomputed: readonly Card[] },
): readonly Card[] {
	return replaceCards(cards, [result.card, ...result.recomputed]);
}

/**
 * 选初始空间。
 *
 * 规则（用户裁定：「不应该存在全局默认的垃圾堆」）：
 * 1. 服务端给的 `workspaceId` 非空 ⇒ 用它
 * 2. 否则第一个**未归档**的空间
 * 3. 否则第一个空间（哪怕全是归档的）
 * 4. 一个都没有 ⇒ 空串（UI 显示「新建空间」）
 *
 * @param workspaces 全部空间
 * @param preferred 服务端建议的 id（可空）
 */
export function chooseInitialWorkspace(
	workspaces: readonly Workspace[],
	preferred?: string,
): string {
	if (preferred !== undefined && preferred !== '') return preferred;
	const active = workspaces.find((one) => !one.archived);
	if (active !== undefined) return active.id;
	return workspaces[0]?.id ?? '';
}

/**
 * 未归档的空间（保持原顺序）。
 *
 * @internal 仅测试使用（`test/store.test.ts`）；产品代码零调用 ——
 *   `chooseInitialWorkspace()` 内部只用 `find`，不需要整份过滤结果。
 */
export function activeWorkspaces(workspaces: readonly Workspace[]): readonly Workspace[] {
	return workspaces.filter((one) => !one.archived);
}

/**
 * 按 id 找空间（找不到返回 `undefined`）。
 *
 * @internal 仅测试使用（`test/store.test.ts`）；产品代码零调用。
 */
export function findWorkspace(
	workspaces: readonly Workspace[],
	id: string,
): Workspace | undefined {
	return workspaces.find((one) => one.id === id);
}

/**
 * 模板 ref → 显示名（找不到回落 ref 本身）。
 *
 * @internal 仅测试使用（`test/store.test.ts`）；产品代码零调用 ——
 *   `Workspace.tsx` 自己用 `Map` 查（`templateLabels`），不走这里。
 */
export function templateLabelOf(templates: readonly TemplateSummary[], ref: string): string {
	return templates.find((one) => one.ref === ref)?.displayName ?? ref;
}

/**
 * 这一代写入的响应是否还该落 UI —— **只有最新一代能写**。
 *
 * ## 为什么需要
 *
 * 同一张卡的章节保存可能连点两次（两次 `PATCH`），而网络不保证按发起顺序
 * 返回。若旧响应晚到就写 UI，用户会看到答案被"回滚"成上一笔 ——
 * 静默、无报错、刷新后又对了。
 *
 * ⇒ 每次保存自增一个代次（`sectionSeq`），落状态前用它比对：
 * 只有 `current === seq`（这次仍是最新意图）才允许写卡片。
 *
 * @param current 该卡当前最新代次（`undefined` = 还没有保存过）
 * @param seq 这笔响应对应的代次
 * @returns 是否是最新代次
 */
export function isLatestWrite(current: number | undefined, seq: number): boolean {
	return current === seq;
}

/** 从异常里取人话（hook 也用，所以在这里）。 */
export function messageOf(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 从 action payload 里抽纯文本。
 *
 * ## 支持的形状
 *
 * | payload | 结果 |
 * |---|---|
 * | `{ value: '…' }` | 那个字符串（`text` / `markdown` 都是这个形状） |
 * | `{ title: '…', case: [...] }` | 标题 + 选项列表（`ask` 的形状） |
 * | `'…'` | 原样 |
 * | 其它 / 空 | 空串 |
 *
 * ⚠ **不猜测**：遇到不认识的形状返回空串，而不是 `JSON.stringify` 一整坨
 * —— 后者会让界面出现一屏 JSON，看起来像数据坏了。
 *
 * @param payload 任意 payload
 * @returns 可显示的纯文本
 */
export function extractText(payload: unknown): string {
	if (typeof payload === 'string') return payload;
	if (payload === null || typeof payload !== 'object') return '';

	const record = payload as Record<string, unknown>;

	const value = record['value'];
	if (typeof value === 'string') return value;

	/* ask 的形状：title + case/options 列表。 */
	const title = record['title'];
	const options = record['case'] ?? record['options'];
	if (typeof title === 'string' || Array.isArray(options)) {
		const lines: string[] = [];
		if (typeof title === 'string' && title !== '') lines.push(title);
		if (Array.isArray(options)) {
			for (const one of options) {
				lines.push(`· ${typeof one === 'string' ? one : JSON.stringify(one)}`);
			}
		}
		return lines.join('\n');
	}

	return '';
}
