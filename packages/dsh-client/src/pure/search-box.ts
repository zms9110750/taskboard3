/**
 * 搜索框的**纯逻辑** —— 零 React、零 DOM。
 *
 * 「什么算一次提交」这条判决放在这里（不在组件里），三个理由：
 *
 * 1. **只有一份**：回车和「前往」走同一个 `submitQueryOf()`；
 *    组件里不再各写一次 `trim()` / `length === 0`。
 * 2. **能直接测**：`node --test` 跑 `.ts` 源码，不需要 DOM、不需要构建产物。
 * 3. **组件只剩渲染**：`SearchBox.tsx` 里没有「空值算不算空」的判断。
 *
 * 用户 `2026-11-19`：
 * > 「加一个按钮。为搜索框加一个框内图标。别的组件框架都提供这种插槽的。
 * >  你应该知道框内图标长啥样。」
 *
 * ## 判决表
 *
 * | 输入 `value` | `submitQueryOf` | `canSubmitOf(v, false)` | 结果 |
 * |---|---|---|---|
 * | `''` | `null` | `false` | 不提交；按钮禁用 |
 * | `'   '` | `null` | `false` | 不提交；按钮禁用 |
 * | `'  K-1024  '` | `'K-1024'` | `true` | 提交 `K-1024` |
 * | 任意值 + `disabled` | 同上 | `false` | 不提交；按钮禁用 |
 */

/** 默认占位文字（用户描述里那句）。组件与预览都从这里取，不各写一份。 */
export const DEFAULT_SEARCH_PLACEHOLDER = '搜标题，或输入完整编号后回车…';

/**
 * 一次提交的参数：**`trim()` 过** 的查询词。
 *
 * trim 后为空 ⇒ 返回 `null`。`null` 是「没有可提交的东西」，
 * 和空串不是一回事 —— 用它来区分「按钮为什么禁用」，调用方没法把空串误传进 `onSubmit`。
 *
 * @param value 输入框当前原始值（未 trim）
 */
export function submitQueryOf(value: string): string | null {
	const query = value.trim();
	return query.length === 0 ? null : query;
}

/**
 * 「前往」按钮能不能点 / 回车会不会提交。
 *
 * @param value 输入框当前原始值（未 trim）
 * @param disabled 整框是否禁用
 */
export function canSubmitOf(value: string, disabled: boolean): boolean {
	return !disabled && submitQueryOf(value) !== null;
}
