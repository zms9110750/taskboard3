/**
 * `StatusButton` 的**渲染模型**测试（#62 / #63）。
 *
 * ## 为什么测模型而不是直接渲染 `.tsx`
 *
 * `node --test` 不能 import `.tsx`（Node 的类型剥离不处理 JSX，见 AGENTS 规则 6）。
 * 所以组件把「尺寸 → class」「可点 / 只读 → 元素种类 + aria」全部收进
 * `status-button-model.ts`，这里断言**真正的判决**；`.tsx` 只做机械映射，
 * 由 `dev/preview/statusbutton/verify.mjs` 的 SSR 断言兜住 DOM。
 *
 * ## 文案来源（用户要求）
 *
 * 「改 protocol 的 label，组件跟着变 —— 不要复制字符串。」
 * ⇒ 这里**不写任何中文状态名**，只断言 `statusButtonLabel(state)` 等于
 *   `@taskboard/protocol` 的 `STATE_LABELS[state]`。谁把词表抄进组件，这条会红。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STATE_LABELS, TASK_STATES, TaskState } from '@taskboard/protocol';

import {
	STATUS_BUTTON_CARET,
	statusButtonClassName,
	statusButtonLabel,
	statusButtonModelOf,
	taskStateOf,
} from '../src/renderers/status-button-model.ts';

/** 造一个模型输入（默认可点、画三角）。 */
function input(
	over: Partial<Parameters<typeof statusButtonModelOf>[0]> = {},
): Parameters<typeof statusButtonModelOf>[0] {
	return {
		status: TaskState.AUTH_REQUIRED,
		size: 'sm',
		interactive: true,
		showChevron: true,
		disabledReason: null,
		...over,
	};
}

describe('① 两档尺寸：class 只差一个尺寸标记', () => {
	it('sm ⇒ status-button--sm', () => {
		const cls = statusButtonClassName({ size: 'sm', tone: 'authRequired', interactive: true });
		assert.equal(cls, 'status-button status-button--sm status-button--authRequired is-interactive');
	});

	it('md ⇒ status-button--md', () => {
		const cls = statusButtonClassName({ size: 'md', tone: 'authRequired', interactive: true });
		assert.equal(cls, 'status-button status-button--md status-button--authRequired is-interactive');
	});

	it('⭐ 两档的 size 标记**不同**，且都不带对方那一档（防止两档写成一样）', () => {
		const sm = statusButtonClassName({ size: 'sm', tone: 'working', interactive: true });
		const md = statusButtonClassName({ size: 'md', tone: 'working', interactive: true });
		assert.notEqual(sm, md);
		assert.ok(sm.includes('status-button--sm'));
		assert.equal(sm.includes('status-button--md'), false);
		assert.ok(md.includes('status-button--md'));
		assert.equal(md.includes('status-button--sm'), false);
	});

	it('可点 / 只读只换 is-interactive / is-static，不改基类和尺寸类', () => {
		const on = statusButtonClassName({ size: 'sm', tone: 'failed', interactive: true });
		const off = statusButtonClassName({ size: 'sm', tone: 'failed', interactive: false });
		assert.equal(on.replace('is-interactive', 'is-static'), off);
	});
});

describe('② 可点态：真按钮 + 后缀 ▾', () => {
	it('tag = button，caret = ▾', () => {
		const model = statusButtonModelOf(input());
		assert.equal(model.tag, 'button');
		assert.equal(model.caret, STATUS_BUTTON_CARET);
		assert.equal(model.ariaDescription, null);
	});

	it('showChevron=false ⇒ 不画三角（按钮仍然可点）', () => {
		const model = statusButtonModelOf(input({ showChevron: false }));
		assert.equal(model.tag, 'button');
		assert.equal(model.caret, null);
	});
});

describe('③ 只读态：span + aria-description（不是 disabled button）', () => {
	it('⭐ tag = span', () => {
		const model = statusButtonModelOf(
			input({ interactive: false, showChevron: false, disabledReason: '在详情里改状态' }),
		);
		assert.equal(model.tag, 'span');
	});

	it('⭐ title 和 aria-description 都是那个原因', () => {
		const reason = '卡已收尾（冻结），状态不能再改';
		const model = statusButtonModelOf(
			input({ interactive: false, showChevron: false, disabledReason: reason }),
		);
		assert.equal(model.title, reason);
		assert.equal(model.ariaDescription, reason);
	});

	it('⭐ 只读态永远不画三角（没有「可以点」的暗示）', () => {
		const model = statusButtonModelOf(
			input({ interactive: false, showChevron: true, disabledReason: '在详情里改状态' }),
		);
		assert.equal(model.caret, null);
	});
});

describe('④ 文案：唯一来源是 protocol 的 STATE_LABELS', () => {
	it('⭐ 九个状态的文案都等于 STATE_LABELS（这里不复制任何中文串）', () => {
		for (const state of TASK_STATES) {
			assert.equal(statusButtonLabel(state), STATE_LABELS[state]);
		}
	});

	it('⭐ 模型里的 label 也来自同一处（不是组件另写一份）', () => {
		for (const state of TASK_STATES) {
			const model = statusButtonModelOf(input({ status: state }));
			assert.equal(model.label, STATE_LABELS[state]);
		}
	});

	it('未知状态 → 协议状态收窄成 UNSPECIFIED（按钮仍有一个确定档位）', () => {
		assert.equal(taskStateOf('TASK_STATE_WAT'), TaskState.UNSPECIFIED);
		assert.equal(taskStateOf('garbage'), TaskState.UNSPECIFIED);
		for (const state of TASK_STATES) assert.equal(taskStateOf(state), state);
	});
});
