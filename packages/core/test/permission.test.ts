/**
 * 工具权限测试 —— **两条正交轴**。
 *
 * ```
 * UI 轴   CardActionLevel  no-claim | claim | adopt      ← 用户授权任务板动作
 * 宿主轴  ToolGuardLevel   off | manage | manage-edit     ← 宿主管不管工具调用
 * ```
 *
 * ## 判定分两段（顺序是规则）
 *
 * - **第一段**：`release` / `claim` / `adopt` —— 只看 `cardLevel`，**不看 `toolLevel`**；
 * - **第二段**：其它工具 —— 只看 `toolLevel`（`off` 全放行 / `manage` 按 BASE + 四档 /
 *   `manage-edit` 另放开权限管理工具）。
 *
 * ## 本文件最关键的三条
 *
 * 1. **两段互不干扰**：`toolLevel='off'` 时 `no-claim` 档的 `taskboard_claim` 仍被拒。
 * 2. **穷举矩阵**：3 × 3 × 关键工具名，全表验一遍。
 * 3. **卡死回归**：`release` / `transition` 永不因为权限配置被拒。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createTaskboard, type Taskboard } from '../src/index.ts';
import {
	BASE_TOOLS,
	EMPTY_POLICY_STORE,
	EXECUTION_TOOLS,
	POLICY_TOOLS,
	READONLY_TOOLS,
	effectiveToolsOf,
	judgeToolCall,
	type CardActionLevel,
	type PermissionFacts,
	type ToolGuardLevel,
	type ToolPolicyStore,
} from '../src/permission.ts';
import type { TemplateDef } from '../src/template/types.ts';

function makeTemplate(ref: string, kind: string): TemplateDef {
	return {
		ref,
		displayName: ref,
		kind,
		domain: '核心',
		codePrefix: 'P',
		usage: '',
		description: '',
		sections: [
			{ id: 'body', label: '正文', hint: '', action: 'text', defaultPayload: { $type: 'text' } },
		],
		derives: [],
	};
}

const ALL_CARD_LEVELS: readonly CardActionLevel[] = ['no-claim', 'claim', 'adopt'];
const ALL_TOOL_LEVELS: readonly ToolGuardLevel[] = ['off', 'manage', 'manage-edit'];

/** 空策略。 */
const NO_POLICIES: PermissionFacts = { policies: EMPTY_POLICY_STORE };

/** 造一份策略（各档可选）。 */
function makeStore(over: Partial<ToolPolicyStore> = {}): ToolPolicyStore {
	return {
		common: over.common ?? [],
		groups: over.groups ?? {},
		groupMembers: over.groupMembers ?? {},
		templates: over.templates ?? {},
	};
}

type HeldCards = readonly { readonly templateRef: string }[];

/** 判一次（只看 ok）。 */
function judge(
	cardLevel: CardActionLevel,
	toolLevel: ToolGuardLevel,
	toolName: string,
	heldCards: HeldCards = [],
	policies: ToolPolicyStore = EMPTY_POLICY_STORE,
): boolean {
	return judgeToolCall({ cardLevel, toolLevel, toolName, heldCards }, { policies }).ok;
}

/** 判一次并返回拒绝理由（放行时返回空串）。 */
function reasonOf(
	cardLevel: CardActionLevel,
	toolLevel: ToolGuardLevel,
	toolName: string,
	heldCards: HeldCards = [],
	policies: ToolPolicyStore = EMPTY_POLICY_STORE,
): string {
	const verdict = judgeToolCall({ cardLevel, toolLevel, toolName, heldCards }, { policies });
	return verdict.ok ? '' : verdict.reason;
}

/* ────────────────────────── BASE 清单 ────────────────────────── */

describe('BASE_TOOLS：11 个，全部 taskboard_*', () => {
	it('★ 恰好 11 个', () => {
		assert.equal(BASE_TOOLS.length, 11);
	});

	it('★ 全部以 taskboard_ 开头', () => {
		for (const tool of BASE_TOOLS) {
			assert.ok(tool.startsWith('taskboard_'), `${tool} 不是任务板工具`);
		}
	});

	it('含 11 个任务板工具（逐个断言）', () => {
		const expected = [
			'taskboard_workspaces',
			'taskboard_cards',
			'taskboard_card',
			'taskboard_create',
			'taskboard_update_content',
			'taskboard_update_note',
			'taskboard_transition',
			'taskboard_claim',
			'taskboard_release',
			'taskboard_registry',
			'taskboard_mark_seen',
		];
		assert.deepEqual([...BASE_TOOLS].sort(), [...expected].sort());
	});

	it('★ 6 个只读类一个都不在 BASE 里（逐个断言）', () => {
		for (const tool of ['read_file', 'glob', 'grep', 'web_search', 'web_fetch', 'todo_write']) {
			assert.equal(BASE_TOOLS.includes(tool), false, `BASE 不该含 ${tool}`);
			assert.ok(READONLY_TOOLS.includes(tool), `${tool} 应当在 READONLY_TOOLS 名单里`);
		}
	});

	it('★ 执行类一个都不在 BASE 里', () => {
		for (const tool of EXECUTION_TOOLS) {
			assert.equal(BASE_TOOLS.includes(tool), false, `BASE 不该含执行类 ${tool}`);
		}
	});

	it('只读类在 manage 档、无卡时被拒', () => {
		for (const tool of READONLY_TOOLS) {
			assert.equal(judge('claim', 'manage', tool), false, `${tool} 无卡时必须被拒`);
		}
	});

	it('BASE 里没有重复项', () => {
		assert.equal(new Set(BASE_TOOLS).size, BASE_TOOLS.length);
	});

	it('★ BASE 在 manage / manage-edit 下、无卡时都放行（claim 档）', () => {
		for (const toolLevel of ['manage', 'manage-edit'] as const) {
			for (const toolName of BASE_TOOLS) {
				assert.ok(
					judge('claim', toolLevel, toolName, []),
					`cardLevel=claim + toolLevel=${toolLevel} + ${toolName} 应放行`,
				);
			}
		}
	});
});

/* ────────────────────────── POLICY_TOOLS ────────────────────────── */

describe('POLICY_TOOLS：只有 manage-edit 放行', () => {
	it('不在 BASE / 执行类 / 只读类里', () => {
		for (const tool of POLICY_TOOLS) {
			assert.equal(BASE_TOOLS.includes(tool), false, `${tool} 不该在 BASE 里`);
			assert.equal(EXECUTION_TOOLS.includes(tool), false);
			assert.equal(READONLY_TOOLS.includes(tool), false);
		}
	});

	it('★ off 放行 / manage 拒绝 / manage-edit 放行（三档逐个）', () => {
		for (const tool of POLICY_TOOLS) {
			assert.ok(judge('claim', 'off', tool), `${tool} 在 off 下应放行`);
			assert.equal(judge('claim', 'manage', tool), false, `${tool} 在 manage 下必须拒绝`);
			assert.ok(judge('claim', 'manage-edit', tool), `${tool} 在 manage-edit 下应放行`);
		}
	});

	it('★ manage 下的拒绝理由必须点明需要「允许编辑档位权限」', () => {
		for (const tool of POLICY_TOOLS) {
			const reason = reasonOf('claim', 'manage', tool);
			assert.ok(reason.includes('允许编辑档位权限'), reason);
		}
	});

	it('★ 就算把 POLICY_TOOLS 写进四档增量，manage 下仍拒绝', () => {
		const policies = makeStore({
			common: POLICY_TOOLS,
			groups: { g: POLICY_TOOLS },
			groupMembers: { g: ['writeCode'] },
			templates: { writeCode: POLICY_TOOLS },
		});
		for (const tool of POLICY_TOOLS) {
			assert.equal(
				judge('claim', 'manage', tool, [{ templateRef: 'writeCode' }], policies),
				false,
				`${tool} 靠领卡不该获得`,
			);
		}
	});

	it('用一本 BASE 工具当对照：manage 下放行（证明不是所有工具都被 manage 拒）', () => {
		assert.ok(judge('claim', 'manage', 'taskboard_cards', []));
	});
});

/* ────────────────────────── ★ 两段正交（最重要） ────────────────────────── */

describe('★ 两条轴正交：第一段不受 toolLevel 影响', () => {
	it('★ toolLevel=off + cardLevel=no-claim + taskboard_claim ⇒ 拒（第一段不受第二段影响）', () => {
		assert.equal(judge('no-claim', 'off', 'taskboard_claim'), false);
		const reason = reasonOf('no-claim', 'off', 'taskboard_claim');
		assert.ok(reason.includes('不允许领卡'), reason);
	});

	it('★ toolLevel=off + cardLevel=no-claim + taskboard_adopt ⇒ 拒', () => {
		assert.equal(judge('no-claim', 'off', 'taskboard_adopt'), false);
		assert.ok(reasonOf('no-claim', 'off', 'taskboard_adopt').includes('不允许采纳草稿'));
	});

	it('★ toolLevel=manage + cardLevel=adopt + taskboard_adopt ⇒ 放行', () => {
		assert.ok(judge('adopt', 'manage', 'taskboard_adopt'));
	});

	it('★ toolLevel=manage-edit + cardLevel=adopt + taskboard_adopt ⇒ 放行', () => {
		assert.ok(judge('adopt', 'manage-edit', 'taskboard_adopt'));
	});

	it('★ toolLevel=off + 任意非领卡类工具（无卡）⇒ 放行', () => {
		for (const toolName of [
			'bash',
			'write',
			'read_file',
			'web_search',
			'unknown_tool',
			'taskboard_create',
			'taskboard_transition',
			'taskboard_tool_policy_set',
		]) {
			assert.ok(judge('no-claim', 'off', toolName), `off 下 ${toolName} 应放行`);
		}
	});

	it('★ 第二段拒绝不影响第一段：manage + claim 档 + 无卡 + claim ⇒ 放行', () => {
		/* 若把两段写反（先判第二段），这条会变成「需要先持有一张工作卡」而拒绝。 */
		assert.ok(judge('claim', 'manage', 'taskboard_claim', []));
	});

	it('★ manage-edit 不会让 no-claim 档能领卡（宿主轴不能替 UI 轴授权）', () => {
		assert.equal(judge('no-claim', 'manage-edit', 'taskboard_claim'), false);
	});
});

/* ────────────────────────── release / claim / adopt ────────────────────────── */

describe('release：三档 cardLevel × 三档 toolLevel 全部放行', () => {
	it('★ 放手永远允许（带卡 / 无卡 / 多卡都一样）', () => {
		const heldVariants: readonly HeldCards[] = [
			[],
			[{ templateRef: 'writeCode' }],
			[{ templateRef: 'a' }, { templateRef: 'b' }],
		];
		for (const cardLevel of ALL_CARD_LEVELS) {
			for (const toolLevel of ALL_TOOL_LEVELS) {
				for (const heldCards of heldVariants) {
					assert.ok(
						judge(cardLevel, toolLevel, 'taskboard_release', heldCards),
						`${cardLevel}/${toolLevel} 下 release 必须放行 —— 否则 AI 可能锁死`,
					);
				}
			}
		}
	});
});

describe('claim：no-claim 拒，其余两档放行', () => {
	it('★ cardLevel=no-claim ⇒ 三档 toolLevel 全拒，理由含「不允许领卡」', () => {
		for (const toolLevel of ALL_TOOL_LEVELS) {
			assert.equal(judge('no-claim', toolLevel, 'taskboard_claim'), false);
			assert.ok(reasonOf('no-claim', toolLevel, 'taskboard_claim').includes('不允许领卡'));
		}
	});

	it('★ cardLevel=claim / adopt ⇒ 三档 toolLevel 全放行', () => {
		for (const cardLevel of ['claim', 'adopt'] as const) {
			for (const toolLevel of ALL_TOOL_LEVELS) {
				assert.ok(
					judge(cardLevel, toolLevel, 'taskboard_claim'),
					`${cardLevel}/${toolLevel} 下 claim 应放行`,
				);
			}
		}
	});
});

describe('adopt：只有 cardLevel=adopt 放行', () => {
	it('★ no-claim / claim ⇒ 三档 toolLevel 全拒，理由含「不允许采纳草稿」', () => {
		for (const cardLevel of ['no-claim', 'claim'] as const) {
			for (const toolLevel of ALL_TOOL_LEVELS) {
				assert.equal(judge(cardLevel, toolLevel, 'taskboard_adopt'), false);
				assert.ok(
					reasonOf(cardLevel, toolLevel, 'taskboard_adopt').includes('不允许采纳草稿'),
					`${cardLevel}/${toolLevel} 的拒绝理由`,
				);
			}
		}
	});

	it('★ adopt ⇒ 三档 toolLevel 全放行', () => {
		for (const toolLevel of ALL_TOOL_LEVELS) {
			assert.ok(judge('adopt', toolLevel, 'taskboard_adopt'), `adopt/${toolLevel} 应放行`);
		}
	});
});

/* ────────────────────────── 第二段：其它工具 ────────────────────────── */

describe('第二段：只看 toolLevel', () => {
	it('off：无卡也能跑执行类 / 未知工具', () => {
		for (const toolName of ['bash', 'write', 'no_such_tool']) {
			assert.ok(judge('no-claim', 'off', toolName, []), `off 下 ${toolName} 应放行`);
		}
	});

	it('manage：无卡 + 非 BASE ⇒ 拒，理由含「需要先持有一张工作卡」', () => {
		const reason = reasonOf('claim', 'manage', 'bash', []);
		assert.ok(reason.includes('需要先持有一张工作卡'), reason);
	});

	it('manage：拿卡 + 模板授予 ⇒ 放行', () => {
		const policies = makeStore({ templates: { writeCode: ['bash'] } });
		assert.ok(judge('claim', 'manage', 'bash', [{ templateRef: 'writeCode' }], policies));
	});

	it('manage：拿卡 + 模板没授予 ⇒ 拒，理由说明当前卡不授予', () => {
		const policies = makeStore({ templates: { writeCode: ['write'] } });
		const reason = reasonOf('claim', 'manage', 'bash', [{ templateRef: 'writeCode' }], policies);
		assert.ok(reason.includes('writeCode'), reason);
		assert.ok(reason.includes('write'), `应列出该卡的额外权限：${reason}`);
		assert.ok(reason.includes('不授予该工具'), reason);
	});

	it('存在多张工作卡 ⇒ 拒，理由含「多张」', () => {
		const policies = makeStore({ templates: { a: ['bash'], b: ['bash'] } });
		const reason = reasonOf(
			'claim',
			'manage',
			'bash',
			[{ templateRef: 'a' }, { templateRef: 'b' }],
			policies,
		);
		assert.ok(reason.includes('多张'), reason);
	});

	it('多张卡时 BASE 仍放行（BASE 判定在持卡判定之前）', () => {
		assert.ok(judge('claim', 'manage', 'taskboard_cards', [{ templateRef: 'a' }, { templateRef: 'b' }]));
	});
});

/* ────────────────────────── 四档并集 ────────────────────────── */

describe('四档并集：common / 组 / 独立档 / 叠加', () => {
	it('通用档：任何工作模板都吃', () => {
		const policies = makeStore({ common: ['bash'] });
		for (const ref of ['writeCode', 'research', 'whatever']) {
			assert.ok(judge('claim', 'manage', 'bash', [{ templateRef: ref }], policies), `${ref} 应吃 common`);
		}
	});

	it('组档：组内生效、组外不生效', () => {
		const policies = makeStore({
			groups: { 代码类: ['bash'] },
			groupMembers: { 代码类: ['writeCode', 'refactor'] },
		});
		assert.ok(judge('claim', 'manage', 'bash', [{ templateRef: 'writeCode' }], policies));
		assert.ok(judge('adopt', 'manage', 'bash', [{ templateRef: 'refactor' }], policies));
		assert.equal(judge('claim', 'manage', 'bash', [{ templateRef: 'research' }], policies), false);
	});

	it('多组叠加', () => {
		const policies = makeStore({
			groups: { 一组: ['bash'], 二组: ['write'] },
			groupMembers: { 一组: ['both'], 二组: ['both'] },
		});
		const effective = effectiveToolsOf(policies, 'both');
		assert.ok(effective.includes('bash'));
		assert.ok(effective.includes('write'));
	});

	it('★ 四档叠加：同一模板命中通用 + 组 + 独立，三者都生效', () => {
		const policies = makeStore({
			common: ['commonTool'],
			groups: { g: ['groupTool'] },
			groupMembers: { g: ['writeCode'] },
			templates: { writeCode: ['ownTool'] },
		});
		for (const toolName of ['commonTool', 'groupTool', 'ownTool']) {
			assert.ok(
				judge('claim', 'manage', toolName, [{ templateRef: 'writeCode' }], policies),
				`${toolName} 应当生效`,
			);
		}
	});

	it('effectiveToolsOf：去重、BASE 在前、稳定顺序', () => {
		const policies = makeStore({
			common: ['bash', 'taskboard_card'],
			templates: { x: ['bash', 'write'] },
		});
		const effective = effectiveToolsOf(policies, 'x');
		assert.equal(new Set(effective).size, effective.length);
		assert.deepEqual(effective.slice(0, BASE_TOOLS.length), [...BASE_TOOLS]);
		assert.deepEqual(effective.slice(BASE_TOOLS.length), ['bash', 'write']);
	});

	it('effectiveToolsOf：空策略 ⇒ 恰好 BASE', () => {
		assert.deepEqual(effectiveToolsOf(EMPTY_POLICY_STORE, 'x'), [...BASE_TOOLS]);
	});

	it('组里含不存在的模板名 ⇒ 不抛', () => {
		const policies = makeStore({
			groups: { g: ['bash'] },
			groupMembers: { g: ['幽灵模板', 'writeCode'] },
		});
		assert.ok(effectiveToolsOf(policies, 'writeCode').includes('bash'));
		assert.equal(effectiveToolsOf(policies, '别的').includes('bash'), false);
	});
});

/* ────────────────────────── ★ 穷举矩阵 ────────────────────────── */

interface MatrixCase {
	readonly toolName: string;
	readonly heldCards?: HeldCards;
	readonly policies?: ToolPolicyStore;
	/** 这条工具在 (cardLevel, toolLevel) 下是否应放行 —— 规则表的独立重述。 */
	readonly allow: (cardLevel: CardActionLevel, toolLevel: ToolGuardLevel) => boolean;
}

/**
 * 3 档 cardLevel × 3 档 toolLevel × 7 个关键工具 / 状态组合，全表走一遍。
 *
 * ⚠ 这里的 `allow` 是**从规则表抄下来的独立重述**，不是调用被测实现算出来的
 *   —— 否则矩阵只是把同一段代码跑两遍，验不出任何东西。
 */
const MATRIX_CASES: readonly MatrixCase[] = [
	/* ① release：三条轴都无关，永远放行。 */
	{ toolName: 'taskboard_release', allow: () => true },

	/* ② claim：只看 cardLevel。 */
	{ toolName: 'taskboard_claim', allow: (cardLevel) => cardLevel !== 'no-claim' },

	/* ③ adopt：只看 cardLevel。 */
	{ toolName: 'taskboard_adopt', allow: (cardLevel) => cardLevel === 'adopt' },

	/* ④ 权限管理工具：只看 toolLevel（off 在 ⑤ 先放行；manage-edit 放开）。 */
	{
		toolName: 'taskboard_tool_policy_set',
		allow: (_cardLevel, toolLevel) => toolLevel === 'off' || toolLevel === 'manage-edit',
	},

	/* ⑤ BASE 工具（非领卡类）：manage / manage-edit 放行；off 也放行。 */
	{ toolName: 'taskboard_cards', allow: () => true },

	/* ⑥ 执行类 + 无卡：只有 off 放行。 */
	{ toolName: 'bash', allow: (_cardLevel, toolLevel) => toolLevel === 'off' },

	/* ⑦ 执行类 + 拿卡 + 模板授予：off 放行，manage / manage-edit 也放行。 */
	{
		toolName: 'bash',
		heldCards: [{ templateRef: 'writeCode' }],
		policies: makeStore({ templates: { writeCode: ['bash'] } }),
		allow: () => true,
	},

	/* ⑧ 执行类 + 拿卡 + 模板没授予：只有 off 放行。 */
	{
		toolName: 'bash',
		heldCards: [{ templateRef: 'writeCode' }],
		policies: makeStore({ templates: { writeCode: ['write'] } }),
		allow: (_cardLevel, toolLevel) => toolLevel === 'off',
	},
];

describe('★ 穷举矩阵：3 × 3 × 关键工具/状态', () => {
	for (const matrixCase of MATRIX_CASES) {
		const label =
			matrixCase.toolName +
			(matrixCase.heldCards === undefined || matrixCase.heldCards.length === 0
				? '（无卡）'
				: `（持卡：${matrixCase.heldCards.map((one) => one.templateRef).join('、')}）`);

		it(`${label}`, () => {
			for (const cardLevel of ALL_CARD_LEVELS) {
				for (const toolLevel of ALL_TOOL_LEVELS) {
					const expected = matrixCase.allow(cardLevel, toolLevel);
					const actual = judge(
						cardLevel,
						toolLevel,
						matrixCase.toolName,
						matrixCase.heldCards ?? [],
						matrixCase.policies ?? EMPTY_POLICY_STORE,
					);
					assert.equal(
						actual,
						expected,
						`${label}：cardLevel=${cardLevel} toolLevel=${toolLevel} 期望 ${expected} 实际 ${actual}`,
					);
				}
			}
		});
	}
});

/* ────────────────────────── ★ 卡死回归 ────────────────────────── */

describe('★ 卡死回归：transition / release 永远放行', () => {
	it('任意 cardLevel + 任意 toolLevel + 任意四档配置都必须放行', () => {
		/*
		 * 「四档都是增量」这个结构的唯一理由：
		 * AI 领了工作卡 → 卡是 WORKING → 占着「一次一张」配额。
		 * 若此时 transition / release 被拒 → 转不了态 + 放不了手 → AI 彻底锁死。
		 */
		const configs: readonly ToolPolicyStore[] = [
			EMPTY_POLICY_STORE,
			makeStore({ templates: { writeCode: [] } }),
			makeStore({ templates: { writeCode: ['bash'] } }),
			makeStore({
				common: EXECUTION_TOOLS,
				groups: { g: EXECUTION_TOOLS },
				groupMembers: { g: ['writeCode'] },
				templates: { writeCode: EXECUTION_TOOLS },
			}),
		];

		for (const cardLevel of ALL_CARD_LEVELS) {
			for (const toolLevel of ALL_TOOL_LEVELS) {
				for (const policies of configs) {
					for (const toolName of ['taskboard_transition', 'taskboard_release']) {
						assert.ok(
							judge(cardLevel, toolLevel, toolName, [{ templateRef: 'writeCode' }], policies),
							`${cardLevel}/${toolLevel} 下 ${toolName} 必须放行 —— 否则 AI 锁死`,
						);
					}
				}
			}
		}
	});
});

/* ────────────────────────── Taskboard 集成 ────────────────────────── */

describe('Taskboard：四档持久化 + 判定接两条轴', () => {
	let dir: string;
	let tb: Taskboard;

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-perm-'));
		tb = createTaskboard({ dataDir: dir });
		tb.templates().register(makeTemplate('writeCode', 'work'));
		tb.templates().register(makeTemplate('research', 'work'));
		tb.templates().register(makeTemplate('refactor', 'work'));
	});

	after(async () => {
		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('初始策略是空的四档', () => {
		const store = tb.getToolPolicies();
		assert.deepEqual(store.common, []);
		assert.deepEqual(store.groups, {});
		assert.deepEqual(store.groupMembers, {});
		assert.deepEqual(store.templates, {});
	});

	it('独立档落 kv，重新打开后仍在', async () => {
		assert.ok((await tb.setTemplatePolicy('writeCode', ['bash', 'write'])).ok);
		assert.deepEqual(tb.getToolPolicies().templates['writeCode'], ['bash', 'write']);

		const reopened = createTaskboard({ dataDir: dir });
		assert.deepEqual(reopened.getToolPolicies().templates['writeCode'], ['bash', 'write']);
		await reopened.close();
	});

	it('通用档落库 + 生效', async () => {
		assert.ok((await tb.setCommonPolicy(['commonTool'])).ok);
		for (const ref of ['writeCode', 'research']) {
			assert.ok(
				tb.judgeToolCall({
					cardLevel: 'claim',
					toolLevel: 'manage',
					toolName: 'commonTool',
					heldCards: [{ templateRef: ref }],
				}).ok,
			);
		}
	});

	it('组档 + 成员 + 组内生效', async () => {
		assert.ok((await tb.setGroupMembers('代码类', ['writeCode', 'refactor'])).ok);
		assert.ok((await tb.setGroupPolicy('代码类', ['groupTool'])).ok);

		const store = tb.getToolPolicies();
		assert.deepEqual(store.groupMembers['代码类'], ['writeCode', 'refactor']);
		assert.deepEqual(store.groups['代码类'], ['groupTool']);

		assert.ok(
			tb.judgeToolCall({
				cardLevel: 'claim',
				toolLevel: 'manage',
				toolName: 'groupTool',
				heldCards: [{ templateRef: 'writeCode' }],
			}).ok,
		);
		assert.equal(
			tb.judgeToolCall({
				cardLevel: 'claim',
				toolLevel: 'manage',
				toolName: 'groupTool',
				heldCards: [{ templateRef: 'research' }],
			}).ok,
			false,
		);
	});

	it('setGroupMembers 不校验模板是否存在', async () => {
		assert.ok((await tb.setGroupMembers('含幽灵', ['writeCode', '根本不存在的模板'])).ok);
		assert.deepEqual(tb.getToolPolicies().groupMembers['含幽灵'], ['writeCode', '根本不存在的模板']);
	});

	it('setGroupPolicy 空组名 ⇒ FIELD_REQUIRED', async () => {
		const result = await tb.setGroupPolicy('   ', ['bash']);
		assert.equal(result.ok, false);
		assert.equal(result.code, 'FIELD_REQUIRED');
	});

	it('removeGroup 删策略与成员；幂等', async () => {
		await tb.setGroupMembers('临时的', ['writeCode']);
		await tb.setGroupPolicy('临时的', ['tmpTool']);
		assert.ok((await tb.removeGroup('临时的')).ok);
		const store = tb.getToolPolicies();
		assert.equal(store.groups['临时的'], undefined);
		assert.equal(store.groupMembers['临时的'], undefined);
		assert.ok((await tb.removeGroup('临时的')).ok, '幂等');
	});

	it('setTemplatePolicy 去重、丢空串', async () => {
		await tb.setTemplatePolicy('research', ['bash', 'bash', '  ', ' write ']);
		assert.deepEqual(tb.getToolPolicies().templates['research'], ['bash', 'write']);
	});

	it('setTemplatePolicy 模板不存在 ⇒ TEMPLATE_NOT_FOUND', async () => {
		const result = await tb.setTemplatePolicy('no-such-template', ['bash']);
		assert.equal(result.ok, false);
		assert.equal(result.code, 'TEMPLATE_NOT_FOUND');
	});

	it('setTemplatePolicy 空 ref ⇒ FIELD_REQUIRED', async () => {
		const result = await tb.setTemplatePolicy('   ', ['bash']);
		assert.equal(result.ok, false);
		assert.equal(result.code, 'FIELD_REQUIRED');
	});

	it('不校验工具名是否存在', async () => {
		assert.ok((await tb.setTemplatePolicy('writeCode', ['totally_made_up_tool'])).ok);
	});

	it('★ 实例的 judgeToolCall 接的是两条轴', () => {
		const base = { toolName: 'bash', heldCards: [] as const };

		/* toolLevel=off ⇒ 一律放行（第二段）。 */
		assert.ok(tb.judgeToolCall({ ...base, cardLevel: 'no-claim', toolLevel: 'off' }).ok);

		/* toolLevel=manage + 无卡 + 非 BASE ⇒ 拒。 */
		assert.equal(
			tb.judgeToolCall({ ...base, cardLevel: 'claim', toolLevel: 'manage' }).ok,
			false,
		);

		/* 第一段：off 也拦得住 no-claim 档的领卡。 */
		assert.equal(
			tb.judgeToolCall({
				cardLevel: 'no-claim',
				toolLevel: 'off',
				toolName: 'taskboard_claim',
				heldCards: [],
			}).ok,
			false,
		);

		/* 权限管理工具：manage 拒 / manage-edit 放行。 */
		assert.equal(
			tb.judgeToolCall({
				cardLevel: 'claim',
				toolLevel: 'manage',
				toolName: 'taskboard_tool_policy_set',
				heldCards: [],
			}).ok,
			false,
		);
		assert.ok(
			tb.judgeToolCall({
				cardLevel: 'claim',
				toolLevel: 'manage-edit',
				toolName: 'taskboard_tool_policy_set',
				heldCards: [],
			}).ok,
		);
	});

	it('effectiveToolsOf 走实例的策略', async () => {
		await tb.setTemplatePolicy('writeCode', ['myTool']);
		const effective = tb.effectiveToolsOf('writeCode');
		assert.deepEqual(effective.slice(0, BASE_TOOLS.length), [...BASE_TOOLS]);
		assert.ok(effective.includes('myTool'));
	});
});

/* ────────────────────────── adopt：core 域逻辑 ────────────────────────── */

describe('adopt：AI 采纳草稿的域逻辑（与权限判定无关）', () => {
	let dir: string;
	let tb: Taskboard;
	let ws: string;

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-adopt-'));
		tb = createTaskboard({ dataDir: dir });
		tb.templates().register(makeTemplate('t-goal', 'goal'));
		tb.templates().register(makeTemplate('t-design', 'design'));
		tb.templates().register(makeTemplate('t-work', 'work'));
		const created = await tb.createWorkspace('采纳');
		assert.ok(created.ok);
		ws = created.workspace.id;
	});

	after(async () => {
		await tb.close();
		rmSync(dir, { recursive: true, force: true });
	});

	async function makeCard(kind: 't-goal' | 't-design' | 't-work'): Promise<string> {
		const result = await tb.create({
			workspaceId: ws,
			templateRef: kind,
			title: `卡-${Math.random().toString(36).slice(2, 7)}`,
		});
		assert.ok(result.ok, JSON.stringify(result));
		return result.card.id;
	}

	it('★ AI 采纳 goal：默认拒绝', async () => {
		const id = await makeCard('t-goal');
		const result = await tb.adopt(ws, id, 'ai');
		assert.equal(result.ok, false, 'goal 的采纳按钮只有 user');
	});

	it('★ AI 采纳 goal：allowAiAdopt: true ⇒ 成功', async () => {
		const id = await makeCard('t-goal');
		const result = await tb.adopt(ws, id, 'ai', { allowAiAdopt: true });
		assert.ok(result.ok, JSON.stringify(result));
		assert.equal(result.card.status, 'TASK_STATE_SUBMITTED');
		const adoptEntry = result.card.history.find((one) => one.action === 'adopt');
		assert.equal(adoptEntry?.actor, 'ai');
	});

	it('AI 采纳 work：allowAiAdopt: true ⇒ 成功', async () => {
		const id = await makeCard('t-work');
		const result = await tb.adopt(ws, id, 'ai', { allowAiAdopt: true });
		assert.ok(result.ok, JSON.stringify(result));
	});

	it('AI 采纳 design：本来就在按钮表里对 ai 开放 ⇒ 不需要开关', async () => {
		const id = await makeCard('t-design');
		const result = await tb.adopt(ws, id, 'ai');
		assert.ok(result.ok, JSON.stringify(result));
	});

	it('user 采纳不受 allowAiAdopt 影响', async () => {
		const a = await makeCard('t-goal');
		const r1 = await tb.adopt(ws, a, 'user', { allowAiAdopt: true });
		assert.ok(r1.ok);

		const b = await makeCard('t-goal');
		const r2 = await tb.adopt(ws, b, 'user');
		assert.ok(r2.ok);
	});

	it('allowAiAdopt 不会让非草稿卡也能采纳', async () => {
		const id = await makeCard('t-goal');
		await tb.adopt(ws, id, 'user');
		const again = await tb.adopt(ws, id, 'ai', { allowAiAdopt: true });
		assert.equal(again.ok, false, '只有草稿能采纳');
	});
});
