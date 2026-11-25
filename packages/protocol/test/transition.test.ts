/**
 * `transition.ts` 的穷举测试。
 *
 * ## import 源码，不是构建产物
 *
 * 全仓约定相对导入写 `.ts`（`tsconfig.base.json` 的
 * `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`）
 * ⇒ `node --test` 的类型剥离能直接跑 `src/**`，**不需要先 `tsc -b`**。
 *
 * ```
 * node --test packages/protocol/test/transition.test.ts
 * ```
 *
 * ## 断言覆盖
 *
 * · 9 状态 × 9 状态 × 3 trigger 的全矩阵
 * · 规则 1：自动计算的每一条通路都不含终结态
 * · 规则 2：每个终结态都至少有一个用户按钮能到达（否则卡会死锁）；
 *           且 goal 必须能由人点到成功与失败
 * · 规则 3：AI 到任一终结态（含取消）一律 `AI_CANNOT_END`
 */

/*
 * TODO(审查) 汇总（测试面）：
 * ① 全包只有本文件 —— status/relation/error 的导出零直接测试（labelOf 回落、statesInGroup 分组、ErrorCode↔ERROR_HINTS、
 *    RELATION_KINDS↔LINK_KINDS 的 id/displayName、isFailure 拒脏 code）；可直接补，不需改产品。
 * ② 缺“按钮表 (kind,from,to) 唯一性”测试（重复行会让 .find 取第一条、UI 渲染两个按钮），也缺 index.ts 文件头承诺的 no-node-imports 守卫。
 * ③ judge() 的 `as never` 三连掩盖了签名与脏输入的关系；lead 已确认 core 调用处传 TaskState ⇒ 不是消费方缺陷，优先级低。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	AUTO_STATES,
	BUTTON_ACTIONS,
	DRAFT,
	TaskState as S,
	TASK_STATES,
	autoTargetsOf,
	buttonTargetsOf,
	buttonsOf,
	endedStates,
	isEndedState,
	isKnownKind,
	judgeTransition,
} from '../src/index.ts';

/** 内置四类。 */
const KINDS = ['goal', 'work', 'design', 'record'] as const;

/** 终结态（从库查询，不写死）。 */
const ENDED = endedStates();

const TRIGGERS = ['auto', 'button', 'ai'] as const;

/** 判定一次的简写。 */
function judge(kind: string, from: string, to: string, trigger: string) {
	return judgeTransition({
		kind,
		from: from as never,
		to: to as never,
		trigger: trigger as never,
	});
}

describe('词汇一致性', () => {
	it('终结态恰好是成功/失败/取消/拒绝', () => {
		assert.deepEqual([...ENDED].sort(), [S.COMPLETED, S.FAILED, S.CANCELED, S.REJECTED].sort());
	});

	it('自动可达集恰好是四个非终结非草稿状态', () => {
		assert.deepEqual(
			[...AUTO_STATES].sort(),
			[S.SUBMITTED, S.WORKING, S.INPUT_REQUIRED, S.AUTH_REQUIRED].sort(),
		);
	});

	it('内置四类都被认作已注册，随机字符串不是', () => {
		for (const kind of KINDS) assert.equal(isKnownKind(kind), true, kind);
		assert.equal(isKnownKind('nope'), false);
	});

	it('按钮表非空，且每条都有文案与至少一个 actor', () => {
		assert.ok(BUTTON_ACTIONS.length > 0);
		for (const one of BUTTON_ACTIONS) {
			assert.ok(one.label.length > 0, `${one.kind} ${one.from}->${one.to} 缺文案`);
			assert.ok(one.actors.length > 0, `${one.kind} ${one.from}->${one.to} 没有 actor`);
		}
	});
});

describe('规则 1：自动计算不许产出终结态', () => {
	it('全矩阵：auto 到任何终结态一律 AUTO_CANNOT_END', () => {
		for (const kind of KINDS) {
			for (const from of TASK_STATES) {
				for (const to of TASK_STATES) {
					if (from === to) continue;
					if (!isEndedState(to)) continue;
					const verdict = judge(kind, from, to, 'auto');
					assert.equal(verdict.ok, false, `${kind} ${from}->${to} auto 不该放行`);
					assert.equal(
						(verdict as { reason: string }).reason,
						'AUTO_CANNOT_END',
						`${kind} ${from}->${to} auto 应为 AUTO_CANNOT_END`,
					);
				}
			}
		}
	});

	it('autoTargetsOf 永远不返回终结态，也永远不返回草稿', () => {
		for (const kind of KINDS) {
			for (const from of TASK_STATES) {
				const targets = autoTargetsOf(kind, from);
				for (const to of targets) {
					assert.equal(isEndedState(to), false, `${kind} ${from} auto 指向了终结态 ${to}`);
					assert.notEqual(to, DRAFT, `${kind} ${from} auto 指向了草稿`);
					assert.notEqual(to, from, `${kind} ${from} auto 指向了自己`);
				}
			}
		}
	});

	it('auto 到非可达的非终结态 ⇒ AUTO_TARGET_INVALID', () => {
		/* record 没有任何系统转移 ⇒ 任何 auto（除自身外）都被拒。 */
		for (const to of AUTO_STATES) {
			if (to === S.AUTH_REQUIRED) continue; /* 源与目标相同由 SAME_STATE 先挡 */
			const verdict = judge('record', S.AUTH_REQUIRED, to, 'auto');
			assert.equal(verdict.ok, false, `record auto -> ${to} 不该放行`);
			assert.equal((verdict as { reason: string }).reason, 'AUTO_TARGET_INVALID');
		}
		/* goal 不能自动回到草稿（草稿本来也不是自动可达）。 */
		const back = judge('goal', S.SUBMITTED, DRAFT, 'auto');
		assert.equal(back.ok, false);
	});

	it('auto 在可达集内 ⇒ 放行', () => {
		/* goal：提交 → 处理中 是矩阵里的「出现子任务为进行」通路。 */
		assert.equal(judge('goal', S.SUBMITTED, S.WORKING, 'auto').ok, true);
		/* goal：提交 → 需要信息。 */
		assert.equal(judge('goal', S.SUBMITTED, S.INPUT_REQUIRED, 'auto').ok, true);
		/* work：处理中 → 需要授权。 */
		assert.equal(judge('work', S.WORKING, S.AUTH_REQUIRED, 'auto').ok, true);
	});

	it('已处于终结态的卡不再被自动计算改动', () => {
		for (const from of ENDED) {
			assert.deepEqual([...autoTargetsOf('goal', from)], []);
			assert.deepEqual([...autoTargetsOf('work', from)], []);
		}
	});

	it('草稿不参与自动计算', () => {
		for (const kind of KINDS) assert.deepEqual([...autoTargetsOf(kind, DRAFT)], []);
	});
});

describe('规则 3：AI 不能进任何终结态（含取消）', () => {
	it('全矩阵：ai 到任一终结态（含取消）一律 AI_CANNOT_END', () => {
		for (const kind of KINDS) {
			for (const from of TASK_STATES) {
				for (const to of ENDED) {
					if (from === to) continue;
					const verdict = judge(kind, from, to, 'ai');
					assert.equal(verdict.ok, false, `${kind} ${from}->${to} ai 不该放行`);
					assert.equal(
						(verdict as { reason: string }).reason,
						'AI_CANNOT_END',
						`${kind} ${from}->${to} ai 应为 AI_CANNOT_END`,
					);
				}
			}
		}
	});

	it('取自结束组：AI 到取消也是 AI_CANNOT_END（不是 NOT_A_BUTTON）', () => {
		/* 用户 2026-11-13：「人通过按钮进入终结态」+ CANCELED 属终结态组 ⇒ AI 不能取消。 */
		for (const kind of KINDS) {
			for (const from of TASK_STATES) {
				if (from === S.CANCELED) continue;
				const verdict = judge(kind, from, S.CANCELED, 'ai');
				assert.equal(verdict.ok, false, `${kind} ${from}->取消 ai 不该放行`);
				assert.equal((verdict as { reason: string }).reason, 'AI_CANNOT_END');
			}
		}
	});

	it('AI 不能确认设计/记录（那是唯一决定方向的按钮）', () => {
		for (const kind of ['design', 'record'] as const) {
			const verdict = judge(kind, S.AUTH_REQUIRED, S.COMPLETED, 'ai');
			/* 先被规则 3 挡在终结态外。 */
			assert.equal(verdict.ok, false);
			assert.equal((verdict as { reason: string }).reason, 'AI_CANNOT_END');
		}
	});

	it('AI 可以采纳设计与记录，也可以领取工作 / 搁置回提交', () => {
		assert.equal(judge('design', DRAFT, S.AUTH_REQUIRED, 'ai').ok, true);
		assert.equal(judge('record', DRAFT, S.AUTH_REQUIRED, 'ai').ok, true);
		assert.equal(judge('work', S.SUBMITTED, S.WORKING, 'ai').ok, true);
		assert.equal(judge('work', S.WORKING, S.SUBMITTED, 'ai').ok, true);
	});

	it('AI 不能采纳目标/工作（采纳只归用户）', () => {
		for (const kind of ['goal', 'work'] as const) {
			const verdict = judge(kind, DRAFT, S.SUBMITTED, 'ai');
			assert.equal(verdict.ok, false);
			assert.equal((verdict as { reason: string }).reason, 'NOT_A_BUTTON');
		}
	});

	it('按钮表里没有任何到终结态的条目把 ai 放进 actors', () => {
		for (const one of BUTTON_ACTIONS) {
			if (!isEndedState(one.to)) continue;
			assert.deepEqual(
				[...one.actors],
				['user'],
				`${one.kind} ${one.from}->${one.to} 到终结态却放行了 ${one.actors.join('/')}`,
			);
		}
	});
});

describe('规则 2：人通过按钮进终结态', () => {
	it('按钮表里每一条 (kind, from, to) 对 user 都放行', () => {
		for (const one of BUTTON_ACTIONS) {
			if (!one.actors.includes('user')) continue;
			const verdict = judge(one.kind, one.from, one.to, 'button');
			assert.equal(verdict.ok, true, `${one.kind} ${one.from}->${one.to} 按钮该放行`);
		}
	});

	it('每个终结态都至少有一个用户按钮能到达', () => {
		for (const target of ENDED) {
			const sources = BUTTON_ACTIONS.filter(
				(one) => one.to === target && one.actors.includes('user'),
			);
			assert.ok(sources.length > 0, `终结态 ${target} 没有任何用户按钮能到达（死锁）`);
		}
	});

	it('不在按钮表里的按钮类转移 ⇒ NOT_A_BUTTON', () => {
		/* 目标卡没有「拒绝」按钮（旧矩阵就无入口，由取代级联产生）。 */
		const verdict = judge('goal', S.WORKING, S.REJECTED, 'button');
		assert.equal(verdict.ok, false);
		assert.equal((verdict as { reason: string }).reason, 'NOT_A_BUTTON');
	});

	it('goal 能由人点按钮到达成功与失败（返工 1）', () => {
		for (const from of [S.SUBMITTED, S.WORKING, S.INPUT_REQUIRED, S.AUTH_REQUIRED] as const) {
			const targets = buttonTargetsOf('goal', from, 'user');
			assert.ok(targets.includes(S.COMPLETED), `goal ${from} 没有成功按钮`);
			assert.ok(targets.includes(S.FAILED), `goal ${from} 没有失败按钮`);
			assert.equal(judge('goal', from, S.COMPLETED, 'button').ok, true);
			assert.equal(judge('goal', from, S.FAILED, 'button').ok, true);
		}
		/* 用户点按钮进终结态是规则 2 的本意；AI 走同一对 (from,to) 被规则 3 拒。 */
		assert.equal(judge('goal', S.WORKING, S.COMPLETED, 'ai').ok, false);
		assert.equal(
			(judge('goal', S.WORKING, S.COMPLETED, 'ai') as { reason: string }).reason,
			'AI_CANNOT_END',
		);
	});

	it('goal 的「拒绝」仍然无入口（旧矩阵就是无入口）', () => {
		for (const from of TASK_STATES) {
			const verdict = judge('goal', from, S.REJECTED, 'button');
			if (from === S.REJECTED) continue; /* 同状态由 SAME_STATE 先挡 */
			assert.equal(verdict.ok, false, `goal ${from}->拒绝 不该有按钮`);
		}
	});

	it('按钮表只对表内 actor 放行：设计的采纳 AI 可做，确认只有人', () => {
		assert.equal(judge('design', DRAFT, S.AUTH_REQUIRED, 'button').ok, true);
		assert.equal(judge('design', S.AUTH_REQUIRED, S.COMPLETED, 'button').ok, true);
		/* AI 走同一对 (from,to) 被规则 3 / 按钮表挡下。 */
		assert.equal(judge('design', S.AUTH_REQUIRED, S.COMPLETED, 'ai').ok, false);
	});

	it('取消态的重开按类别区分', () => {
		/* goal：取消 → 提交。 */
		assert.equal(judge('goal', S.CANCELED, S.SUBMITTED, 'button').ok, true);
		/* design：取消 → 需要授权。 */
		assert.equal(judge('design', S.CANCELED, S.AUTH_REQUIRED, 'button').ok, true);
		/* work / record：没有重开入口。 */
		for (const kind of ['work', 'record'] as const) {
			const verdict = judge(kind, S.CANCELED, S.SUBMITTED, 'button');
			assert.equal(verdict.ok, false, `${kind} 不该有重开`);
			assert.equal((verdict as { reason: string }).reason, 'NOT_A_BUTTON');
		}
	});
});

describe('边界', () => {
	it('源与目标相同 ⇒ SAME_STATE', () => {
		for (const state of TASK_STATES) {
			for (const trigger of TRIGGERS) {
				const verdict = judge('work', state, state, trigger);
				assert.equal(verdict.ok, false);
				assert.equal((verdict as { reason: string }).reason, 'SAME_STATE');
			}
		}
	});

	it('未知类别 ⇒ UNKNOWN_KIND', () => {
		for (const trigger of TRIGGERS) {
			const verdict = judge('nope', S.SUBMITTED, S.CANCELED, trigger);
			assert.equal(verdict.ok, false);
			assert.equal((verdict as { reason: string }).reason, 'UNKNOWN_KIND');
		}
	});

	it('未知状态 ⇒ UNKNOWN_STATE', () => {
		const verdict = judge('work', 'TASK_STATE_NOPE', S.CANCELED, 'button');
		assert.equal(verdict.ok, false);
		assert.equal((verdict as { reason: string }).reason, 'UNKNOWN_STATE');
	});

	it('全矩阵：任何放行的转移都必须在按钮表里', () => {
		for (const kind of KINDS) {
			for (const from of TASK_STATES) {
				for (const to of TASK_STATES) {
					const verdict = judge(kind, from, to, 'button');
					if (!verdict.ok) continue;
					const found = BUTTON_ACTIONS.some(
						(one) => one.kind === kind && one.from === from && one.to === to,
					);
					assert.ok(found, `${kind} ${from}->${to} 被放行但不在按钮表里`);
				}
			}
		}
	});

	it('查询辅助与判定同源', () => {
		for (const kind of KINDS) {
			for (const from of TASK_STATES) {
				for (const actor of ['user', 'ai'] as const) {
					const targets = buttonTargetsOf(kind, from, actor);
					for (const to of targets) {
						const trigger = actor === 'ai' ? 'ai' : 'button';
						/* 查询说能转，判定也必须同意（除非被规则 3 挡在终结态外）。 */
						const verdict = judge(kind, from, to, trigger);
						if (verdict.ok) continue;
						const reason = (verdict as { reason: string }).reason;
						assert.equal(
							reason,
							'AI_CANNOT_END',
							`${kind} ${from}->${to} ${actor}：查询给了但判定拒了（${reason}）`,
						);
					}
				}
			}
		}
	});

	it('buttonsOf 与 buttonTargetsOf 一致', () => {
		for (const kind of KINDS) {
			for (const from of TASK_STATES) {
				for (const actor of ['user', 'ai'] as const) {
					assert.deepEqual(
						[...buttonsOf(kind, from, actor).map((one) => one.to)],
						[...buttonTargetsOf(kind, from, actor)],
					);
				}
			}
		}
	});
});
