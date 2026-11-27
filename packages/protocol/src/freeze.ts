/**
 * 词表的运行期冻结。
 *
 * `as const` 只冻结**类型层**：数组 / 对象在运行期仍可被 JS 消费方改
 * （`TASK_STATES.push(...)`、`TaskState.WORKING = 'nope'`），而这些是
 * 被全仓当单源真值读的词表，改一处会污染全局。
 *
 * ⇒ 导出前 `deepFreeze`。手写几行，不引第三方包（本包零运行时依赖）。
 */

/** 递归冻结（对象 / 数组的元素也冻）。 */
export function deepFreeze<T>(value: T): Readonly<T> {
	if (typeof value === 'object' && value !== null) {
		for (const inner of Object.values(value as unknown as Record<string, unknown>)) {
			deepFreeze(inner);
		}
	}
	return Object.freeze(value);
}
