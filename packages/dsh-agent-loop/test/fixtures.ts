/**
 * 本包测试的卡夹具 —— **只给测试用**。
 *
 * 用 `LoopCard`（`src/pure/loop-judgment.ts`）而不是 core 的 `Card`：
 * 本包只读五个字段，夹具跟着那个窄面走，测试也就不需要建 store / 模板。
 */

import { TaskState } from '@taskboard/protocol';

import type { LoopCard } from '../src/pure/loop-judgment.ts';

/**
 * 造一张卡。
 *
 * @param overrides 必给 `id`；其余字段按「一张已提交的 work 卡」给默认值，
 *                  要测别的形态就覆盖（`status` / `template.kind` / `unread` / `history`）。
 */
export function fakeCard(overrides: Partial<LoopCard> & { readonly id: string }): LoopCard {
	return {
		title: `卡 ${overrides.id}`,
		status: TaskState.SUBMITTED,
		template: { kind: 'work' },
		unread: { ai: false, user: false },
		history: [{ at: 1 }],
		...overrides,
	};
}

/** 造一条 history（只需要 `at`；夹具不模拟真实事件形状）。 */
export function historyAt(...at: readonly number[]): readonly { readonly at: number }[] {
	return at.map((one) => ({ at: one }));
}
