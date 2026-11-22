/**
 * 权限框的**纯逻辑**测试 —— `summaryOf()` / `isNonDefault()` / `labelOf()`。
 *
 * ## 为什么这些要在 `pure/` 测
 *
 * 三个函数决定「按钮上显示什么」，错了用户会看到**错误的当前档位**。
 * 那是比「按钮没出现」更坏的失败：用户以为那就是设置。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	DEFAULT_CARD_LEVEL,
	DEFAULT_TOOL_LEVEL,
	isNonDefault,
	labelOf,
	summaryOf,
	type BoxSnapshot,
} from '../src/pure/permission-box.ts';

/* 夹具：文案照抄 core 的 CARD_ACTION_OPTIONS / TOOL_GUARD_OPTIONS
 * （`packages/core/src/permission.ts:408` / `:433`）。 */
const CARD_OPTIONS = [
	{ value: 'no-claim', label: '不允许领卡', description: 'AI 不能领取工作卡，也不能采纳草稿。' },
	{ value: 'claim', label: '允许领卡', description: 'AI 可以领取工作卡；草稿仍由用户自己点采纳。' },
	{ value: 'adopt', label: '允许采纳草稿', description: 'AI 可以领取工作卡，也可以自己采纳草稿。' },
] as const;

const TOOL_OPTIONS = [
	{ value: 'off', label: '任务板不管理', description: '任务板不拦截任何工具调用（领卡类动作仍受 UI 轴管）。' },
	{ value: 'manage', label: '任务板管理权限', description: '按 BASE / 持有卡 / 四档策略判定工具调用。' },
	{
		value: 'manage-edit',
		label: '允许编辑档位权限',
		description: '在「管理权限」之上，额外允许 AI 读写档位权限工具。',
	},
] as const;

/**
 * 造一个快照。
 *
 * @param card 卡片动作档位
 * @param tool 工具管控档位
 * @returns 快照
 */
function snapshotOf(card: string, tool: string): BoxSnapshot {
	return {
		cardActionLevel: card,
		toolGuardLevel: tool,
		cardActionOptions: CARD_OPTIONS,
		toolGuardOptions: TOOL_OPTIONS,
	};
}

describe('权限框的摘要（按钮上那句话）', () => {
	it('⭐ 两条轴都用 label，不是原始值', () => {
		assert.equal(summaryOf(snapshotOf('no-claim', 'off')), '不允许领卡 · 任务板不管理');
	});

	it('⭐ 两条轴各自独立拼（正交的可见性）', () => {
		assert.equal(summaryOf(snapshotOf('adopt', 'manage-edit')), '允许采纳草稿 · 允许编辑档位权限');
	});

	it('⭐ 中间那个轴会变、另一条不动（3×3 抽两格）', () => {
		const low = summaryOf(snapshotOf('no-claim', 'manage'));
		const high = summaryOf(snapshotOf('adopt', 'manage'));
		assert.equal(low, '不允许领卡 · 任务板管理权限');
		assert.equal(high, '允许采纳草稿 · 任务板管理权限');
		/* 工具轴那半没变 —— 这是「正交」在文案层的体现。 */
		assert.equal(low.split(' · ')[1], high.split(' · ')[1]);
	});

	it('⚠ 未知档位回落到原始值（不编造文案）', () => {
		assert.equal(summaryOf(snapshotOf('weird', 'off')), 'weird · 任务板不管理');
	});
});

describe('权限框的「非默认」判定', () => {
	it('⭐ 两条轴都是默认 ⇒ false', () => {
		assert.equal(isNonDefault(snapshotOf(DEFAULT_CARD_LEVEL, DEFAULT_TOOL_LEVEL)), false);
	});

	it('⭐ 只有卡片轴偏离 ⇒ true', () => {
		assert.equal(isNonDefault(snapshotOf('claim', DEFAULT_TOOL_LEVEL)), true);
	});

	it('⭐ 只有工具轴偏离 ⇒ true', () => {
		assert.equal(isNonDefault(snapshotOf(DEFAULT_CARD_LEVEL, 'manage')), true);
	});

	it('⚠ 两条都偏离 ⇒ true', () => {
		assert.equal(isNonDefault(snapshotOf('adopt', 'manage-edit')), true);
	});

	it('⚠ 默认值必须是 core 的真实默认（不是随手写的）', () => {
		/* core 的默认：`no-claim` / `off` —— 见 `permission.ts` 的 getter 兜底。 */
		assert.equal(DEFAULT_CARD_LEVEL, 'no-claim');
		assert.equal(DEFAULT_TOOL_LEVEL, 'off');
	});
});

describe('labelOf', () => {
	it('找到就用 label', () => {
		assert.equal(labelOf(TOOL_OPTIONS, 'manage'), '任务板管理权限');
	});

	it('找不到回落原始值', () => {
		assert.equal(labelOf(TOOL_OPTIONS, 'nope'), 'nope');
	});

	it('空选项表回落原始值（不抛）', () => {
		assert.equal(labelOf([], 'x'), 'x');
	});
});
