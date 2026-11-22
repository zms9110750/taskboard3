/**
 * `CardAction` → 服务端认的 `to` 的换算测试。
 *
 * ## 为什么这块必须测
 *
 * 出错的表现是**点任何状态按钮都 400「不是已知状态」**（修之前的真 bug）：
 * 客户端发 `{ action: { kind, to } }`，服务端在顶层读 `to` ⇒ 空串。
 *
 * 另一类更隐蔽的错：**`adopt` 换算错**。`goal` / `work` 采纳到「提交」，
 * `design` / `record` 采纳到「需要授权」—— 硬编码 `SUBMITTED` 会让后两类
 * 卡采纳到错的状态，而服务端 `isAdoptTransition` 认为「这不是采纳按钮」
 * ⇒ 走普通 `transition()` ⇒ **`adoptedAt` 不写** ⇒ 排序键错乱
 * （`search` 的排序键是 `adoptedAt ?? createdAt`）。
 *
 * 断言直接跑 `protocol` 的真实按钮表，不是我们维护的第二份副本。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TaskState } from '@taskboard/protocol';

import { toOfAction } from '../src/pure/card-action.ts';
import type { CardAction } from '../src/types.ts';

/** 造一张只有 `kind` / `status` 的卡（换算只需要这两个字段）。 */
function cardOf(kind: string, status: string): { readonly template: { readonly kind: string }; readonly status: string } {
	return { template: { kind }, status };
}

describe('toOfAction —— transition', () => {
	it('直接用 action.to', () => {
		const action: CardAction = { kind: 'transition', to: TaskState.COMPLETED };
		assert.equal(toOfAction(action, cardOf('work', TaskState.WORKING)), TaskState.COMPLETED);
	});

	it('不同的目标各自透传（不是查表得来的）', () => {
		for (const to of [TaskState.CANCELED, TaskState.FAILED, TaskState.REJECTED]) {
			assert.equal(toOfAction({ kind: 'transition', to }, cardOf('goal', TaskState.SUBMITTED)), to);
		}
	});
});

describe('toOfAction —— claim / release', () => {
	it('claim ⇒ 处理中', () => {
		assert.equal(toOfAction({ kind: 'claim' }, cardOf('work', TaskState.SUBMITTED)), TaskState.WORKING);
	});

	it('release ⇒ 提交', () => {
		assert.equal(toOfAction({ kind: 'release' }, cardOf('work', TaskState.WORKING)), TaskState.SUBMITTED);
	});

	it('claim / release 与卡的类别无关（它们只对 work 有意义，但换算不看类别）', () => {
		assert.equal(toOfAction({ kind: 'claim' }, cardOf('goal', TaskState.SUBMITTED)), TaskState.WORKING);
	});
});

describe('toOfAction —— adopt 按 (类别, 源状态) 查', () => {
	it('⭐ goal 草稿 ⇒ 提交', () => {
		assert.equal(toOfAction({ kind: 'adopt' }, cardOf('goal', TaskState.UNSPECIFIED)), TaskState.SUBMITTED);
	});

	it('⭐ work 草稿 ⇒ 提交', () => {
		assert.equal(toOfAction({ kind: 'adopt' }, cardOf('work', TaskState.UNSPECIFIED)), TaskState.SUBMITTED);
	});

	it('⚠ design 草稿 ⇒ 需要授权（**不是**提交）', () => {
		assert.equal(
			toOfAction({ kind: 'adopt' }, cardOf('design', TaskState.UNSPECIFIED)),
			TaskState.AUTH_REQUIRED,
		);
	});

	it('⚠ record 草稿 ⇒ 需要授权（**不是**提交）', () => {
		assert.equal(
			toOfAction({ kind: 'adopt' }, cardOf('record', TaskState.UNSPECIFIED)),
			TaskState.AUTH_REQUIRED,
		);
	});

	it('⭐ 证明题：adopt 的结果**随类别变**，所以不能硬编码一个状态', () => {
		const goal = toOfAction({ kind: 'adopt' }, cardOf('goal', TaskState.UNSPECIFIED));
		const design = toOfAction({ kind: 'adopt' }, cardOf('design', TaskState.UNSPECIFIED));
		assert.notEqual(goal, design, '硬编码 SUBMITTED 会让 design 这条错');
		assert.equal(goal, TaskState.SUBMITTED);
		assert.equal(design, TaskState.AUTH_REQUIRED);
	});

	it('类别不在表里 ⇒ undefined（调用方必须报错，不能发空串）', () => {
		assert.equal(toOfAction({ kind: 'adopt' }, cardOf('nope', TaskState.UNSPECIFIED)), undefined);
	});

	it('不是草稿态 ⇒ undefined（没有可采纳的按钮）', () => {
		/* 采纳按钮只在 `from = UNSPECIFIED`（草稿）时存在。 */
		assert.equal(toOfAction({ kind: 'adopt' }, cardOf('goal', TaskState.SUBMITTED)), undefined);
	});
});

describe('toOfAction —— 返回值永远是合法 TaskState 或 undefined', () => {
	it('四种 kind 都不会返回空串', () => {
		const cases: readonly CardAction[] = [
			{ kind: 'transition', to: TaskState.COMPLETED },
			{ kind: 'adopt' },
			{ kind: 'claim' },
			{ kind: 'release' },
		];
		for (const action of cases) {
			const to = toOfAction(action, cardOf('work', TaskState.UNSPECIFIED));
			/*
			 * ⚠ 类型上 `to` 是 `TaskState | undefined`，而 `TaskState` 是九个
			 *   非空字面量的联合 ⇒ `to !== ''` 这个比较在类型层「不可能为真」，
			 *   `tsc` 会报 TS2367。所以这里断言**运行时**的形状：
			 *   undefined，或者一个看起来像状态名的字符串。
			 */
			assert.ok(
				to === undefined || (typeof to === 'string' && to.startsWith('TASK_STATE_')),
				`${action.kind} 算出了怪值：${String(to)}`,
			);
		}
	});
});
