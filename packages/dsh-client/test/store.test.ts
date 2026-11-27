/**
 * `store.ts` 纯函数的测试 —— 合并、初始化、模板名。
 *
 * ## 为什么这些是纯函数
 *
 * 「就地合并」是这条 UI 的核心约定：写操作返回 `{ card, recomputed }`，
 * UI 只替换那几张卡，**不重拉全量**。合并写错的表现是**界面显示旧状态**
 * —— 用户点了「成功」但徽章还是「处理中」，且没有任何报错。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Card, Workspace } from '../src/types.ts';
import {
	activeWorkspaces,
	chooseInitialWorkspace,
	findWorkspace,
	isLatestWrite,
	mergeActionResult,
	replaceCards,
	templateLabelOf,
} from '../src/pure.ts';

/** 造一张最小卡。 */
function card(id: string, patch: Partial<Card> = {}): Card {
	return {
		id,
		title: `卡 ${id}`,
		status: 'TASK_STATE_SUBMITTED',
		template: { ref: 'userNeed', kind: 'goal', domain: '核心' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		createdAt: 0,
		adoptedAt: null,
		history: [],
		deleted: false,
		holders: [],
		unread: { ai: false, user: false },
		...patch,
	};
}

/** 造一个空间。 */
function workspace(id: string, archived = false): Workspace {
	return { id, displayName: `空间 ${id}`, archived, createdAt: 0 };
}

describe('replaceCards', () => {
	it('替换同 id 的卡', () => {
		const before = [card('A'), card('B')];
		const after = replaceCards(before, [card('B', { status: 'TASK_STATE_COMPLETED' })]);
		assert.equal(after.length, 2);
		assert.equal(after[0]?.id, 'A');
		assert.equal(after[1]?.status, 'TASK_STATE_COMPLETED');
	});

	it('没有命中时返回原数组（让 React 跳过重渲染）', () => {
		const before = [card('A')];
		const after = replaceCards(before, [card('ZZZ')]);
		assert.equal(after, before);
	});

	it('空更新返回原数组', () => {
		const before = [card('A')];
		assert.equal(replaceCards(before, []), before);
	});

	it('不往列表里塞新卡', () => {
		const before = [card('A')];
		const after = replaceCards(before, [card('A'), card('NEW')]);
		assert.equal(after.length, 1);
	});
});

describe('mergeActionResult', () => {
	it('card 与 recomputed 一起合并', () => {
		const before = [card('A'), card('B'), card('C')];
		const after = mergeActionResult(before, {
			card: card('B', { status: 'TASK_STATE_COMPLETED' }),
			recomputed: [card('A', { status: 'TASK_STATE_WORKING' })],
		});
		assert.equal(after[0]?.status, 'TASK_STATE_WORKING');
		assert.equal(after[1]?.status, 'TASK_STATE_COMPLETED');
		assert.equal(after[2]?.status, 'TASK_STATE_SUBMITTED');
	});

	it('recomputed 为空时只换 card', () => {
		const before = [card('A')];
		const after = mergeActionResult(before, {
			card: card('A', { status: 'TASK_STATE_CANCELED' }),
			recomputed: [],
		});
		assert.equal(after[0]?.status, 'TASK_STATE_CANCELED');
	});
});

describe('chooseInitialWorkspace —— 没有全局默认的垃圾堆', () => {
	it('服务端给的 id 优先', () => {
		assert.equal(chooseInitialWorkspace([workspace('a'), workspace('b')], 'b'), 'b');
	});

	it('没有建议时取第一个未归档的', () => {
		assert.equal(chooseInitialWorkspace([workspace('a', true), workspace('b')], ''), 'b');
	});

	it('全是归档时取第一个（哪怕归档）', () => {
		assert.equal(chooseInitialWorkspace([workspace('a', true), workspace('b', true)], ''), 'a');
	});

	it('一个空间都没有时返回空串', () => {
		assert.equal(chooseInitialWorkspace([], ''), '');
	});

	it('preferred 是 undefined 时走回落', () => {
		assert.equal(chooseInitialWorkspace([workspace('a')], undefined), 'a');
	});
});

describe('activeWorkspaces', () => {
	it('过滤掉归档的，保持顺序', () => {
		const list = [workspace('a', true), workspace('b'), workspace('c', true), workspace('d')];
		assert.deepEqual(
			activeWorkspaces(list).map((one) => one.id),
			['b', 'd'],
		);
	});
});

describe('findWorkspace', () => {
	it('找到返回对象', () => {
		const found = findWorkspace([workspace('a'), workspace('b')], 'b');
		assert.equal(found?.id, 'b');
	});

	it('找不到返回 undefined', () => {
		assert.equal(findWorkspace([workspace('a')], 'zzz'), undefined);
	});
});

describe('templateLabelOf', () => {
	const templates = [{ ref: 'userNeed', displayName: '用户任务', kind: 'goal', domain: '核心' }];

	it('找到时用显示名', () => {
		assert.equal(templateLabelOf(templates, 'userNeed'), '用户任务');
	});

	it('找不到时回落到 ref（不显示空白）', () => {
		assert.equal(templateLabelOf(templates, 'research'), 'research');
	});
});

describe('isLatestWrite —— 只有最新代次能写 UI', () => {
	it('代次相同 ⇒ 可以写（这笔仍是最新意图）', () => {
		assert.equal(isLatestWrite(3, 3), true);
	});

	it('⭐ 旧代次 ⇒ 丢弃（晚到的旧响应不能把新答案盖回去）', () => {
		assert.equal(isLatestWrite(3, 2), false);
		assert.equal(isLatestWrite(5, 1), false);
	});

	it('还没有保存过（undefined）⇒ 不写', () => {
		assert.equal(isLatestWrite(undefined, 1), false);
	});
});

