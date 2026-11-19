/**
 * `pure/permission-view.ts` 的测试 —— **纯函数，零 DOM、零 mock、零网络**。
 *
 * 语义依据：`docs/权限两轴.md`（用户 `2026-11-19` 定稿）的两条正交轴 +
 * `GET/POST /taskboard3/api/permission` 的 PATCH 契约。
 *
 * 覆盖四类判决（一类一组）：
 *
 * 1. **取文案 / 取档位** —— label 来自 options，找不到就回落原值（不编造）；
 * 2. **当前 / 保存中 / 不可点** —— `optionViewOf()` 的三个布尔；
 * 3. **点下去要不要发请求** —— `shouldSaveOnSelect()` 的四个「不发」；
 * 4. **状态迁移** —— 乐观更新、失败回滚、**只回滚失败的那条轴**、PATCH body。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	NO_PENDING,
	axisLevelOf,
	axisOptionsOf,
	axisPendingOf,
	beginSave,
	commitSave,
	dismissSaveError,
	failSave,
	levelLabelOf,
	optionViewOf,
	pendingOf,
	requestBodyOf,
	requestFieldOf,
	shouldSaveOnSelect,
	withLevel,
} from '../src/pure/permission-view.ts';
import type {
	PanelState,
	PermissionOption,
	PermissionSnapshot,
	ReadyState,
} from '../src/pure/permission-view.ts';

/* ══════════════════════════════════════════════════════════ */
/* 夹具 —— 文案刻意和 core 的选项表一致（但这是**数据**，不是第二份定义）*/
/* ══════════════════════════════════════════════════════════ */

/** UI 轴（`CARD_ACTION_OPTIONS` 的形状）。 */
const CARD_OPTIONS: readonly PermissionOption[] = [
	{ value: 'no-claim', label: '不允许领卡', description: 'AI 不能领取工作卡，也不能采纳草稿。' },
	{
		value: 'claim',
		label: '允许领卡',
		description: 'AI 可以领取工作卡；草稿仍由用户自己点采纳。',
	},
	{ value: 'adopt', label: '允许采纳草稿', description: 'AI 可以领取工作卡，也可以自己采纳草稿。' },
];

/** 宿主轴（`TOOL_GUARD_OPTIONS` 的形状）。 */
const TOOL_OPTIONS: readonly PermissionOption[] = [
	{
		value: 'off',
		label: '任务板不管理',
		description: '任务板不拦截任何工具调用（领卡类动作仍受 UI 轴管）。',
	},
	{ value: 'manage', label: '任务板管理权限', description: '按 BASE / 持有卡 / 四档策略判定工具调用。' },
	{
		value: 'manage-edit',
		label: '允许编辑档位权限',
		description: '在「管理权限」之上，额外允许 AI 读写档位权限工具。',
	},
];

const SNAPSHOT: PermissionSnapshot = {
	cardActionLevel: 'claim',
	toolGuardLevel: 'manage',
	cardActionOptions: CARD_OPTIONS,
	toolGuardOptions: TOOL_OPTIONS,
};

const READY: PanelState = {
	phase: 'ready',
	snapshot: SNAPSHOT,
	pending: NO_PENDING,
	saveError: null,
};

const LOADING: PanelState = { phase: 'loading' };
const LOAD_ERROR: PanelState = { phase: 'load-error', message: '无法连接任务板服务：fetch failed' };

/** 取 ready 相位（断言里少一层 `if`）。 */
function ready(state: PanelState): ReadyState {
	assert.equal(state.phase, 'ready');
	return state as ReadyState;
}

/* ══════════════════════════════════════════════════════════ */
/* ① 取选项 / 取档位 / 取文案                                   */
/* ══════════════════════════════════════════════════════════ */

describe('① 取值：选项表与档位', () => {
	it('UI 轴的选项就是 cardActionOptions（3 档）', () => {
		assert.deepEqual(
			axisOptionsOf(SNAPSHOT, 'card').map((one) => one.value),
			['no-claim', 'claim', 'adopt'],
		);
	});

	it('宿主轴的选项就是 toolGuardOptions（3 档）', () => {
		assert.deepEqual(
			axisOptionsOf(SNAPSHOT, 'tool').map((one) => one.value),
			['off', 'manage', 'manage-edit'],
		);
	});

	it('axisLevelOf 各取各的轴，互不串', () => {
		assert.equal(axisLevelOf(SNAPSHOT, 'card'), 'claim');
		assert.equal(axisLevelOf(SNAPSHOT, 'tool'), 'manage');
	});

	it('⭐ levelLabelOf 省略 level 时取「当前档位」的 label', () => {
		assert.equal(levelLabelOf(SNAPSHOT, 'card'), '允许领卡');
		assert.equal(levelLabelOf(SNAPSHOT, 'tool'), '任务板管理权限');
	});

	it('⭐ levelLabelOf 不传 level 之外的档位 —— 文案只从 options 来', () => {
		assert.equal(levelLabelOf(SNAPSHOT, 'card', 'adopt'), '允许采纳草稿');
		assert.equal(levelLabelOf(SNAPSHOT, 'tool', 'off'), '任务板不管理');
	});

	it('⭐ 服务端给了选项表里没有的档位 ⇒ 回落原始值，不编造文案', () => {
		assert.equal(levelLabelOf(SNAPSHOT, 'card', 'weird-level'), 'weird-level');
	});

	it('withLevel 只改一条轴，另一条轴原样保留', () => {
		const next = withLevel(SNAPSHOT, 'card', 'adopt');
		assert.equal(next.cardActionLevel, 'adopt');
		assert.equal(next.toolGuardLevel, 'manage');
		/* 不可变：原对象不动 */
		assert.equal(SNAPSHOT.cardActionLevel, 'claim');
	});

	it('withLevel 改宿主轴同理', () => {
		const next = withLevel(SNAPSHOT, 'tool', 'off');
		assert.equal(next.toolGuardLevel, 'off');
		assert.equal(next.cardActionLevel, 'claim');
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ② 当前 / 保存中 / 不可点                                     */
/* ══════════════════════════════════════════════════════════ */

describe('② optionViewOf：一条轴恰好一个「当前」', () => {
	it('⭐ UI 轴上只有 claim 是选中的', () => {
		assert.deepEqual(
			CARD_OPTIONS.map((one) => optionViewOf(READY, 'card', one.value).selected),
			[false, true, false],
		);
	});

	it('⭐ 宿主轴上只有 manage 是选中的', () => {
		assert.deepEqual(
			TOOL_OPTIONS.map((one) => optionViewOf(READY, 'tool', one.value).selected),
			[false, true, false],
		);
	});

	it('没有 pending 时三个布尔是「选中 / 不转圈 / 可点」', () => {
		assert.deepEqual(optionViewOf(READY, 'card', 'claim'), {
			selected: true,
			saving: false,
			disabled: false,
		});
	});

	it('没有 pending 时非当前档也是可点的', () => {
		const view = optionViewOf(READY, 'card', 'adopt');
		assert.equal(view.selected, false);
		assert.equal(view.disabled, false);
		assert.equal(view.saving, false);
	});

	it('⭐ 保存中：正在保存的那一档 selected + saving 同时为真（乐观更新）', () => {
		const saving = beginSave(READY, 'card', 'adopt');
		assert.deepEqual(optionViewOf(saving, 'card', 'adopt'), {
			selected: true,
			saving: true,
			disabled: true,
		});
	});

	it('⭐ 保存中：同一条轴的其他档「不可点但不转圈」', () => {
		const saving = beginSave(READY, 'card', 'adopt');
		assert.deepEqual(optionViewOf(saving, 'card', 'claim'), {
			selected: false,
			saving: false,
			disabled: true,
		});
	});

	it('⭐ 保存中：另一条轴的档位照常可点（正交）', () => {
		const saving = beginSave(READY, 'card', 'adopt');
		assert.deepEqual(optionViewOf(saving, 'tool', 'off'), {
			selected: false,
			saving: false,
			disabled: false,
		});
	});

	it('加载中：所有档位 disabled、没有选中、没有转圈', () => {
		assert.deepEqual(optionViewOf(LOADING, 'card', 'claim'), {
			selected: false,
			saving: false,
			disabled: true,
		});
	});

	it('加载失败：同上（组件此时画的是错误态）', () => {
		assert.deepEqual(optionViewOf(LOAD_ERROR, 'tool', 'manage'), {
			selected: false,
			saving: false,
			disabled: true,
		});
	});

	it('axisPendingOf 只对正在保存的那条轴为真', () => {
		const saving = beginSave(READY, 'card', 'adopt');
		assert.equal(axisPendingOf(saving, 'card'), true);
		assert.equal(axisPendingOf(saving, 'tool'), false);
		assert.equal(axisPendingOf(READY, 'card'), false);
		assert.equal(axisPendingOf(LOADING, 'card'), false);
	});

	it('pendingOf 拿得到「改成什么 / 之前是什么」', () => {
		const saving = beginSave(READY, 'card', 'adopt');
		assert.deepEqual(pendingOf(saving, 'card'), {
			axis: 'card',
			value: 'adopt',
			previousLevel: 'claim',
		});
		assert.equal(pendingOf(saving, 'tool'), null);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ③ 点下去要不要发请求                                         */
/* ══════════════════════════════════════════════════════════ */

describe('③ shouldSaveOnSelect：四个「不发」', () => {
	it('换一档 ⇒ 发', () => {
		assert.equal(shouldSaveOnSelect(READY, 'card', 'adopt'), true);
		assert.equal(shouldSaveOnSelect(READY, 'tool', 'off'), true);
	});

	it('⭐ 点当前档位 ⇒ 不发（同值不重发）', () => {
		assert.equal(shouldSaveOnSelect(READY, 'card', 'claim'), false);
		assert.equal(shouldSaveOnSelect(READY, 'tool', 'manage'), false);
	});

	it('⭐ 这条轴正在保存 ⇒ 不发（本轴串行）', () => {
		const saving = beginSave(READY, 'card', 'adopt');
		assert.equal(shouldSaveOnSelect(saving, 'card', 'no-claim'), false);
	});

	it('⭐ 另一条轴正在保存 ⇒ 照发（正交，不锁面板）', () => {
		const saving = beginSave(READY, 'card', 'adopt');
		assert.equal(shouldSaveOnSelect(saving, 'tool', 'off'), true);
	});

	it('加载中 ⇒ 不发', () => {
		assert.equal(shouldSaveOnSelect(LOADING, 'card', 'adopt'), false);
	});

	it('加载失败 ⇒ 不发（先点重试）', () => {
		assert.equal(shouldSaveOnSelect(LOAD_ERROR, 'card', 'adopt'), false);
	});

	it('⭐ 值不在选项表里 ⇒ 不发（不制造必然 400 的请求）', () => {
		assert.equal(shouldSaveOnSelect(READY, 'card', 'not-a-level'), false);
		assert.equal(shouldSaveOnSelect(READY, 'tool', 'not-a-level'), false);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ④ 状态迁移：begin / commit / fail / dismiss                  */
/* ══════════════════════════════════════════════════════════ */

describe('④ beginSave：乐观选中 + 记下回滚点', () => {
	it('⭐ 立刻把新档位画成选中（不等服务端）', () => {
		const next = ready(beginSave(READY, 'card', 'adopt'));
		assert.equal(next.snapshot.cardActionLevel, 'adopt');
	});

	it('⭐ 另一条轴的档位一动不动', () => {
		const next = ready(beginSave(READY, 'card', 'adopt'));
		assert.equal(next.snapshot.toolGuardLevel, 'manage');
	});

	it('pending 槽里记着 axis / value / previousLevel', () => {
		const next = ready(beginSave(READY, 'tool', 'manage-edit'));
		assert.deepEqual(next.pending.tool, {
			axis: 'tool',
			value: 'manage-edit',
			previousLevel: 'manage',
		});
		assert.equal(next.pending.card, null);
	});

	it('⭐ 开始新保存会清掉旧的失败提示', () => {
		const failed = failSave(beginSave(READY, 'card', 'adopt'), 'card', '网络断了');
		assert.notEqual(ready(failed).saveError, null);
		const retried = ready(beginSave(failed, 'tool', 'off'));
		assert.equal(retried.saveError, null);
	});

	it('不合法的点击原样返回同一个对象（调用方可用 === 判断没发生）', () => {
		assert.equal(beginSave(READY, 'card', 'claim'), READY);
		assert.equal(beginSave(LOADING, 'card', 'adopt'), LOADING);
		assert.equal(beginSave(LOAD_ERROR, 'card', 'adopt'), LOAD_ERROR);
		assert.equal(beginSave(READY, 'card', 'not-a-level'), READY);
	});

	it('同一条轴已有保存在飞时再点 ⇒ 原样返回（不覆盖 pending）', () => {
		const saving = beginSave(READY, 'card', 'adopt');
		assert.equal(beginSave(saving, 'card', 'no-claim'), saving);
	});
});

describe('⑤ failSave：只回滚失败的那条轴 + 说清回滚到哪', () => {
	it('⭐ 回滚到点之前那一档', () => {
		const failed = ready(failSave(beginSave(READY, 'card', 'adopt'), 'card', '网络断了'));
		assert.equal(failed.snapshot.cardActionLevel, 'claim');
	});

	it('⭐ 回滚用的 label 来自 options（不写死文案）', () => {
		const failed = ready(failSave(beginSave(READY, 'card', 'adopt'), 'card', '网络断了'));
		assert.equal(failed.saveError?.rolledBackTo, 'claim');
		assert.match(failed.saveError?.message ?? '', /已回滚到「允许领卡」/);
	});

	it('错误消息带着失败原因', () => {
		const failed = ready(
			failSave(beginSave(READY, 'card', 'adopt'), 'card', '任务板服务返回了非 JSON 内容（HTTP 502）'),
		);
		assert.match(failed.saveError?.message ?? '', /任务板服务返回了非 JSON 内容（HTTP 502）/);
	});

	it('失败后 pending 清空、错误记在对应轴上', () => {
		const failed = ready(failSave(beginSave(READY, 'tool', 'off'), 'tool', '网络断了'));
		assert.deepEqual(failed.pending, NO_PENDING);
		assert.equal(failed.saveError?.axis, 'tool');
	});

	it('⭐ 失败不碰另一条轴：值、pending 都保留', () => {
		const cardSaving = beginSave(READY, 'card', 'adopt');
		const both = beginSave(cardSaving, 'tool', 'off');
		/* 宿主轴先失败 */
		const partial = ready(failSave(both, 'tool', '网络断了'));
		assert.equal(partial.snapshot.cardActionLevel, 'adopt', 'UI 轴的乐观值不能被宿主轴的失败回滚');
		assert.notEqual(partial.pending.card, null, 'UI 轴的 pending 不能被宿主轴的失败清掉');
		assert.equal(partial.pending.tool, null);
		assert.equal(partial.saveError?.axis, 'tool');
	});

	it('两条轴可以同时在保存（各自的槽互不覆盖）', () => {
		const both = ready(beginSave(beginSave(READY, 'card', 'adopt'), 'tool', 'off'));
		assert.deepEqual(both.pending.card, {
			axis: 'card',
			value: 'adopt',
			previousLevel: 'claim',
		});
		assert.deepEqual(both.pending.tool, {
			axis: 'tool',
			value: 'off',
			previousLevel: 'manage',
		});
	});

	it('没有 pending 时 failSave 原样返回（不编造错误）', () => {
		assert.equal(failSave(READY, 'card', '网络断了'), READY);
		const cardOnly = beginSave(READY, 'card', 'adopt');
		/* 宿主轴没有 pending ⇒ 失败宿主轴不该动任何东西 */
		assert.equal(failSave(cardOnly, 'tool', '网络断了'), cardOnly);
	});
});

describe('⑥ commitSave：服务端回声覆盖 + 清 pending', () => {
	it('⭐ 回声覆盖两条轴的档位', () => {
		const saving = beginSave(READY, 'card', 'adopt');
		const done = ready(commitSave(saving, 'card', { cardActionLevel: 'adopt', toolGuardLevel: 'manage' }));
		assert.equal(done.snapshot.cardActionLevel, 'adopt');
		assert.equal(done.snapshot.toolGuardLevel, 'manage');
	});

	it('⭐ 回声里另一条轴变了也跟着更新（服务端是唯一事实来源）', () => {
		const saving = beginSave(READY, 'card', 'adopt');
		const done = ready(commitSave(saving, 'card', { cardActionLevel: 'adopt', toolGuardLevel: 'off' }));
		assert.equal(done.snapshot.toolGuardLevel, 'off');
	});

	it('成功后 pending 与 saveError 都清空', () => {
		const saving = beginSave(READY, 'card', 'adopt');
		const done = ready(commitSave(saving, 'card', { cardActionLevel: 'adopt', toolGuardLevel: 'manage' }));
		assert.deepEqual(done.pending, NO_PENDING);
		assert.equal(done.saveError, null);
	});

	it('⭐ 只清「这次保存的那条轴」的 pending，另一条在飞的保留', () => {
		const both = beginSave(beginSave(READY, 'card', 'adopt'), 'tool', 'off');
		const done = ready(commitSave(both, 'card', { cardActionLevel: 'adopt', toolGuardLevel: 'off' }));
		assert.equal(done.pending.card, null);
		assert.notEqual(done.pending.tool, null);
	});

	it('这条轴没有 pending 时回声被忽略（不误回写）', () => {
		const stray = commitSave(READY, 'card', { cardActionLevel: 'no-claim', toolGuardLevel: 'off' });
		assert.equal(stray, READY);
	});

	it('加载中 / 加载失败时 commit 原样返回', () => {
		assert.equal(commitSave(LOADING, 'card', { cardActionLevel: 'adopt', toolGuardLevel: 'off' }), LOADING);
		assert.equal(
			commitSave(LOAD_ERROR, 'card', { cardActionLevel: 'adopt', toolGuardLevel: 'off' }),
			LOAD_ERROR,
		);
	});
});

describe('⑦ dismissSaveError：只清提示，不动数据', () => {
	it('⭐ 清掉错误横幅，档位保持回滚后的值', () => {
		const failed = ready(failSave(beginSave(READY, 'card', 'adopt'), 'card', '网络断了'));
		const dismissed = ready(dismissSaveError(failed));
		assert.equal(dismissed.saveError, null);
		assert.equal(dismissed.snapshot.cardActionLevel, 'claim');
	});

	it('没有错误时原样返回同一个对象', () => {
		assert.equal(dismissSaveError(READY), READY);
		assert.equal(dismissSaveError(LOADING), LOADING);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ⑦ POST body：PATCH 语义 —— 只带一条轴                        */
/* ══════════════════════════════════════════════════════════ */

describe('⑧ requestBodyOf：PATCH 只发一个字段', () => {
	it('requestFieldOf 的映射', () => {
		assert.equal(requestFieldOf('card'), 'cardActionLevel');
		assert.equal(requestFieldOf('tool'), 'toolGuardLevel');
	});

	it('⭐ UI 轴的 body 只有 cardActionLevel 一个键', () => {
		const body = requestBodyOf('card', 'adopt');
		assert.deepEqual(body, { cardActionLevel: 'adopt' });
		assert.deepEqual(Object.keys(body), ['cardActionLevel']);
	});

	it('⭐ 宿主轴的 body 只有 toolGuardLevel 一个键', () => {
		const body = requestBodyOf('tool', 'manage-edit');
		assert.deepEqual(body, { toolGuardLevel: 'manage-edit' });
		assert.deepEqual(Object.keys(body), ['toolGuardLevel']);
	});
});

/* ══════════════════════════════════════════════════════════ */
/* ⑧ 全流程 + 3 × 3 正交矩阵                                   */
/* ══════════════════════════════════════════════════════════ */

describe('⑨ 全流程（begin → commit / fail）', () => {
	it('⭐ 点击 → 成功：状态收敛到服务端回声', () => {
		const saving = beginSave(READY, 'card', 'adopt');
		const done = ready(commitSave(saving, 'card', { cardActionLevel: 'adopt', toolGuardLevel: 'manage' }));
		assert.equal(done.snapshot.cardActionLevel, 'adopt');
		assert.equal(pendingOf(done, 'card'), null);
		assert.equal(done.saveError, null);
	});

	it('⭐ 点击 → 失败 → 再点 → 成功：回滚后还能正常保存', () => {
		const first = failSave(beginSave(READY, 'card', 'adopt'), 'card', '网络断了');
		assert.equal(ready(first).snapshot.cardActionLevel, 'claim');
		const second = beginSave(first, 'card', 'no-claim');
		const done = ready(commitSave(second, 'card', { cardActionLevel: 'no-claim', toolGuardLevel: 'manage' }));
		assert.equal(done.snapshot.cardActionLevel, 'no-claim');
		assert.equal(done.saveError, null);
	});

	it('⭐ 3 × 3 正交：任一轴取任一档都不影响另一轴', () => {
		const cardLevels = ['no-claim', 'claim', 'adopt'];
		const toolLevels = ['off', 'manage', 'manage-edit'];
		for (const card of cardLevels) {
			for (const tool of toolLevels) {
				/* 先落到目标 UI 轴（可能需要两次点击：当前是 claim） */
				let state: PanelState = READY;
				if (card !== 'claim') {
					const saving = beginSave(state, 'card', card);
					state = commitSave(saving, 'card', { cardActionLevel: card, toolGuardLevel: 'manage' });
				}
				/* 再落到目标宿主轴（当前是 manage） */
				if (tool !== 'manage') {
					const saving = beginSave(state, 'tool', tool);
					state = commitSave(saving, 'tool', { cardActionLevel: card, toolGuardLevel: tool });
				}
				const final = ready(state);
				assert.equal(final.snapshot.cardActionLevel, card, `${card} / ${tool}`);
				assert.equal(final.snapshot.toolGuardLevel, tool, `${card} / ${tool}`);
			}
		}
	});
});
