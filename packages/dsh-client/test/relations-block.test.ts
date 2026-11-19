/**
 * `pure/relations-block.ts` 的测试 —— 纯函数，零 DOM、零 React。
 *
 * 钉住四条（前三条是用户裁定，第四条是原版顺序）：
 *
 * | # | 断言 |
 * |---|---|
 * | 1 | 草稿被剔除（子任务 / link 目标 / 父任务三种位置）+ `total` 跟着重算 |
 * | 2 | 三种 status 组分别落 `active` / `shelved` / `ended` 三列 |
 * | 3 | 0 关系是空态（`total=0`、`groups=[]`、`parentCard=null`） |
 * | 4 | 父任务单独一个字段，**不生进 groups、不算进 total** |
 *
 * 另外钉住原版的关系类型顺序/中文名（抄自 `taskboard2/.../lib/relations.js:118-125`）
 * —— 顺序是用户原话的视觉顺序，不是字典序（原版注释明说）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	RELATION_COLUMNS,
	RELATION_GROUP_DEFS,
	relationsOf,
	statusGroupOf,
} from '../src/pure/relations-block.ts';
import type { Card } from '../src/types.ts';

/* ── 夹具 ── */

const S = {
	draft: 'TASK_STATE_UNSPECIFIED',
	submitted: 'TASK_STATE_SUBMITTED',
	working: 'TASK_STATE_WORKING',
	inputRequired: 'TASK_STATE_INPUT_REQUIRED',
	authRequired: 'TASK_STATE_AUTH_REQUIRED',
	completed: 'TASK_STATE_COMPLETED',
	failed: 'TASK_STATE_FAILED',
	canceled: 'TASK_STATE_CANCELED',
	rejected: 'TASK_STATE_REJECTED',
} as const;

/**
 * 建一张卡。
 *
 * @param id 编号
 * @param status A2A 状态全名
 * @param over 覆盖字段
 */
function card(id: string, status: string, over: Partial<Card> = {}): Card {
	return {
		id,
		title: `${id} 的标题`,
		status,
		template: { ref: 'design.demo', kind: 'design', domain: '演示' },
		relations: { parent: null, links: [] },
		sections: {},
		note: '',
		createdAt: 1_762_000_000_000,
		adoptedAt: null,
		history: [],
		deleted: false,
		holders: [],
		unread: { ai: false, user: false },
		...over,
	};
}

/** 全部卡 id（按视图里出现的顺序）。 */
function idsOf(relations: { readonly groups: readonly { readonly cards: readonly Card[] }[] }): string[] {
	return relations.groups.flatMap((group) => group.cards.map((one) => one.id));
}

/** 某组的卡 id。 */
function groupIds(
	relations: ReturnType<typeof relationsOf>,
	rel: string,
): string[] {
	const found = relations.groups.find((one) => one.rel === rel);
	return found === undefined ? [] : found.cards.map((one) => one.id);
}

/* ══════════════════════════════════════════════════════════
   ① 草稿被剔除（用户 2026-11-09 08:45）
   ══════════════════════════════════════════════════════════ */

describe('① 草稿不能成为关系对象（用户 2026-11-09 08:45）', () => {
	it('草稿子任务是入边，但不出现在「子任务」组里，也不进 total', () => {
		const me = card('ME-06', S.working);
		const child = card('CH-01', S.submitted, { relations: { parent: 'ME-06', links: [] } });
		const draftChild = card('CH-02', S.draft, { relations: { parent: 'ME-06', links: [] } });

		const result = relationsOf(me, [me, child, draftChild], statusGroupOf);

		assert.deepEqual(idsOf(result), ['CH-01']);
		assert.equal(result.total, 1, 'total 必须按过滤后的数量重算（否则按钮数字撒谎）');
	});

	it('草稿作为 link 目标（出边）被剔除', () => {
		const me = card('ME-06', S.working, {
			relations: { parent: null, links: [{ label: 'dependsOn', to: 'WI-DRAFT' }] },
		});
		const draft = card('WI-DRAFT', S.draft);

		const result = relationsOf(me, [me, draft], statusGroupOf);

		assert.deepEqual(result.groups, []);
		assert.equal(result.total, 0);
	});

	it('草稿作为 link 来源（入边）被剔除', () => {
		const me = card('ME-06', S.working);
		const draft = card('WI-DRAFT', S.draft, {
			relations: { parent: null, links: [{ label: 'related', to: 'ME-06' }] },
		});

		const result = relationsOf(me, [me, draft], statusGroupOf);

		assert.deepEqual(result.groups, []);
		assert.equal(result.total, 0);
	});

	it('草稿父任务 ⇒ parentCard 为 null（不显示一套「标红异常」UI）', () => {
		const me = card('ME-06', S.working, { relations: { parent: 'DE-DRAFT', links: [] } });
		const draft = card('DE-DRAFT', S.draft);

		const result = relationsOf(me, [me, draft], statusGroupOf);

		assert.equal(result.parentCard, null);
	});

	it('草稿是唯一的关系对象时 ⇒ 完全空态', () => {
		const me = card('ME-06', S.working, {
			relations: { parent: 'DE-DRAFT', links: [{ label: 'dependsOn', to: 'WI-DRAFT' }] },
		});
		const all = [
			me,
			card('DE-DRAFT', S.draft),
			card('WI-DRAFT', S.draft),
			card('CH-DRAFT', S.draft, { relations: { parent: 'ME-06', links: [] } }),
		];

		const result = relationsOf(me, all, statusGroupOf);

		assert.deepEqual(result.groups, []);
		assert.equal(result.total, 0);
		assert.equal(result.parentCard, null);
	});
});

/* ══════════════════════════════════════════════════════════
   ② 三种 status 落三列（不硬编码状态名）
   ══════════════════════════════════════════════════════════ */

describe('② 卡按 status 的组落三列（不硬编码状态名）', () => {
	it('submitted / working 落 active，需要信息 / 需要授权落 shelved，成功/失败/取消/拒绝落 ended', () => {
		const me = card('ME-06', S.working);
		const members = [
			card('A-01', S.submitted, { relations: { parent: 'ME-06', links: [] } }),
			card('A-02', S.working, { relations: { parent: 'ME-06', links: [] } }),
			card('B-01', S.inputRequired, { relations: { parent: 'ME-06', links: [] } }),
			card('B-02', S.authRequired, { relations: { parent: 'ME-06', links: [] } }),
			card('C-01', S.completed, { relations: { parent: 'ME-06', links: [] } }),
			card('C-02', S.failed, { relations: { parent: 'ME-06', links: [] } }),
			card('C-03', S.canceled, { relations: { parent: 'ME-06', links: [] } }),
			card('C-04', S.rejected, { relations: { parent: 'ME-06', links: [] } }),
		];

		const result = relationsOf(me, [me, ...members], statusGroupOf);
		const children = result.groups.find((one) => one.rel === 'parent');
		assert.notEqual(children, undefined);

		assert.deepEqual(children?.byColumn.active.map((one) => one.id), ['A-01', 'A-02']);
		assert.deepEqual(children?.byColumn.shelved.map((one) => one.id), ['B-01', 'B-02']);
		assert.deepEqual(children?.byColumn.ended.map((one) => one.id), ['C-01', 'C-02', 'C-03', 'C-04']);
	});

	it('三列的组名来自协议词表（进行 / 搁置 / 完成），不是组件里写死的', () => {
		assert.deepEqual(
			RELATION_COLUMNS.map((one) => [one.group, one.label]),
			[
				['active', '进行'],
				['shelved', '搁置'],
				['ended', '完成'],
			],
		);
		/* 没有第四列（草稿列）—— 草稿在 relationsOf 已经剔掉。 */
		assert.equal(RELATION_COLUMNS.length, 3);
	});

	it('未知状态回落 active（不因为脏数据让卡凭空消失，也不会被当成草稿剔掉）', () => {
		const me = card('ME-06', S.working);
		const weird = card('X-01', 'TASK_STATE_WHATEVER', {
			relations: { parent: 'ME-06', links: [] },
		});

		const result = relationsOf(me, [me, weird], statusGroupOf);
		const children = result.groups.find((one) => one.rel === 'parent');

		assert.equal(statusGroupOf('TASK_STATE_WHATEVER'), 'active');
		assert.deepEqual(children?.byColumn.active.map((one) => one.id), ['X-01']);
	});
});

/* ══════════════════════════════════════════════════════════
   ③ 空态
   ══════════════════════════════════════════════════════════ */

describe('③ 空态', () => {
	it('没有父任务、没有 link、没有子任务 ⇒ total=0 / groups=[] / parentCard=null', () => {
		const me = card('EM-03', S.working);

		const result = relationsOf(me, [me], statusGroupOf);

		assert.equal(result.total, 0);
		assert.deepEqual(result.groups, []);
		assert.equal(result.parentCard, null);
	});
});

/* ══════════════════════════════════════════════════════════
   ④ 父任务单独列出
   ══════════════════════════════════════════════════════════ */

describe('④ 父任务单独一个字段（不在 groups 里、不算进 total）', () => {
	it('父任务出现在 parentCard，但不生进 groups、不算进 total', () => {
		const me = card('ME-06', S.working, { relations: { parent: 'DE-01', links: [] } });
		const parent = card('DE-01', S.working);

		const result = relationsOf(me, [me, parent], statusGroupOf);

		assert.equal(result.parentCard?.id, 'DE-01');
		assert.equal(result.total, 0, '父任务不算进关系总数（原版 relationsSummary 的口径）');
		assert.deepEqual(result.groups, []);
	});

	it('关系合计 = 各组卡数之和（父任务不重复计入）', () => {
		const me = card('ME-06', S.working, {
			relations: { parent: 'DE-01', links: [{ label: 'dependsOn', to: 'WI-02' }] },
		});
		const all = [
			me,
			card('DE-01', S.working),
			card('WI-02', S.working),
			card('CH-07', S.submitted, { relations: { parent: 'ME-06', links: [] } }),
		];

		const result = relationsOf(me, all, statusGroupOf);

		assert.equal(result.total, 2, '1 个子任务 + 1 条依赖；父任务不算');
		assert.equal(result.parentCard?.id, 'DE-01');
	});
});

/* ══════════════════════════════════════════════════════════
   ⑤ 关系类型的顺序 / 中文名（照原版，不自己编）
   ══════════════════════════════════════════════════════════ */

describe('⑤ 关系类型顺序与中文名（原版 relations.js:118-125）', () => {
	it('顺序 = 子任务 / 本项依赖 / 相关 / 参考 / 取代 / 约束', () => {
		assert.deepEqual(
			RELATION_GROUP_DEFS.map((one) => [one.rel, one.label]),
			[
				['parent', '子任务'],
				['dependsOn', '本项依赖'],
				['related', '相关'],
				['references', '参考'],
				['supersedes', '取代'],
				['constrains', '约束'],
			],
		);
	});

	it('视图里的组顺序跟着 RELATION_GROUP_DEFS（不是字典序）', () => {
		const me = card('ME-06', S.working, {
			relations: {
				parent: null,
				links: [
					{ label: 'constrains', to: 'C-01' },
					{ label: 'references', to: 'R-01' },
					{ label: 'dependsOn', to: 'D-01' },
				],
			},
		});
		const all = [me, card('C-01', S.working), card('R-01', S.working), card('D-01', S.working)];

		const result = relationsOf(me, all, statusGroupOf);

		assert.deepEqual(
			result.groups.map((one) => one.rel),
			['dependsOn', 'references', 'constrains'],
		);
	});

	it('空组不出现（原版 relations.js:213-214）', () => {
		const me = card('ME-06', S.working, {
			relations: { parent: null, links: [{ label: 'dependsOn', to: 'WI-02' }] },
		});

		const result = relationsOf(me, [me, card('WI-02', S.working)], statusGroupOf);

		assert.deepEqual(result.groups.map((one) => one.rel), ['dependsOn']);
	});
});

/* ══════════════════════════════════════════════════════════
   ⑥ 方向 / 去重 / 脏数据
   ══════════════════════════════════════════════════════════ */

describe('⑥ 方向、去重与脏数据', () => {
	it('dependsOn 出边（我依赖谁）+ 入边（谁依赖我）都列出', () => {
		const me = card('ME-06', S.working, {
			relations: { parent: null, links: [{ label: 'dependsOn', to: 'WI-OUT' }] },
		});
		const back = card('WI-IN', S.working, {
			relations: { parent: null, links: [{ label: 'dependsOn', to: 'ME-06' }] },
		});

		const result = relationsOf(me, [me, card('WI-OUT', S.working), back], statusGroupOf);

		assert.deepEqual(groupIds(result, 'dependsOn'), ['WI-OUT', 'WI-IN']);
	});

	it('related 是双向边 ⇒ 出边和入边是同一张卡时只出现一次', () => {
		const me = card('ME-06', S.working, {
			relations: { parent: null, links: [{ label: 'related', to: 'DE-03' }] },
		});
		const back = card('DE-03', S.inputRequired, {
			relations: { parent: null, links: [{ label: 'related', to: 'ME-06' }] },
		});

		const result = relationsOf(me, [me, back], statusGroupOf);

		assert.deepEqual(groupIds(result, 'related'), ['DE-03']);
		assert.equal(result.total, 1);
	});

	it('目标卡不在本空间（已删除 / 指向别的空间）⇒ 跳过，不炸', () => {
		const me = card('ME-06', S.working, {
			relations: { parent: 'GONE-01', links: [{ label: 'references', to: 'GONE-02' }] },
		});

		const result = relationsOf(me, [me], statusGroupOf);

		assert.equal(result.parentCard, null);
		assert.deepEqual(result.groups, []);
	});

	it('不认识的 link label ⇒ 忽略（不编一个组出来）', () => {
		const me = card('ME-06', S.working, {
			relations: { parent: null, links: [{ label: 'blocks', to: 'X-01' }] },
		});

		const result = relationsOf(me, [me, card('X-01', S.working)], statusGroupOf);

		assert.deepEqual(result.groups, []);
	});
});
