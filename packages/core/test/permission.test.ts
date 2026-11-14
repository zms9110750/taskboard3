/**
 * 工具权限测试。
 *
 * ## 两层模型
 *
 * ### ① 模式（互斥）
 *
 * | 模式 | 谁选的 | 我们管不管 |
 * |---|---|---|
 * | `undefined` | DSH 自己的 / 别的插件的预设 | **完全不管**（一律放行） |
 * | `plan` / `work` / `auto` | 用户选任务板的三个预设 | 我们管 |
 *
 * 用户原话：「只要开的是他自己或者别的插件提供的权限，那么这个插件给的限制都不生效。」
 *
 * ### ② 四档并集（只在我们的模式下生效）
 *
 * ```
 * effective(ref) = BASE_TOOLS ∪ common ∪ 命中的组 ∪ 独立档
 * ```
 *
 * ## 最关键的三条
 *
 * 1. **互斥守卫**：`mode === undefined` ⇒ 任意工具都放行（包括 `bash`）
 * 2. **超集不变量**：任何 BASE 工具（plan 禁的两个除外）永远放行
 * 3. **卡死回归**：`taskboard_transition` / `taskboard_release` 永远放行
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createTaskboard, type Taskboard } from '../src/index.ts';
import {
	BASE_TOOLS,
	BOARD_PRESETS,
	EMPTY_POLICY_STORE,
	EXECUTION_TOOLS,
	PLAN_BLOCKED_TOOLS,
	POLICY_TOOLS,
	READONLY_TOOLS,
	boardModeOf,
	effectiveToolsOf,
	judgeToolCall,
	type BoardMode,
	type PermissionFacts,
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

/** 在一个模式下判一次。 */
function judge(
	mode: BoardMode | undefined,
	toolName: string,
	heldCards: readonly { readonly templateRef: string }[] = [],
	policies: ToolPolicyStore = EMPTY_POLICY_STORE,
): boolean {
	return judgeToolCall({ mode, toolName, heldCards }, { policies }).ok;
}

/* ────────────────────────── ① 互斥语义 ────────────────────────── */

describe('★ 互斥：mode === undefined ⇒ 一律放行', () => {
	it('任意工具都放行（包括执行类、权限管理工具）', () => {
		const all = [...BASE_TOOLS, ...EXECUTION_TOOLS, ...READONLY_TOOLS, ...POLICY_TOOLS, 'any_unknown_tool'];
		for (const toolName of all) {
			assert.ok(judge(undefined, toolName), `mode=undefined 时 ${toolName} 必须放行`);
		}
	});

	it('就算有工作卡也不改变结论（我们完全不介入）', () => {
		for (const toolName of ['bash', 'write', 'taskboard_tool_policy_set']) {
			assert.ok(judge(undefined, toolName, [{ templateRef: 'writeCode' }]));
			assert.ok(judge(undefined, toolName, []));
			assert.ok(judge(undefined, toolName, [{ templateRef: 'a' }, { templateRef: 'b' }]));
		}
	});

	it('就算四档策略是空/脏也不改变结论', () => {
		const dirty = makeStore({
			common: [],
			templates: { writeCode: [] },
		});
		assert.ok(judge(undefined, 'bash', [{ templateRef: 'writeCode' }], dirty));
	});
});

/* ────────────────────────── 预设表 ────────────────────────── */

describe('BOARD_PRESETS：三个预设', () => {
	it('恰好三个', () => {
		assert.equal(BOARD_PRESETS.length, 3);
	});

	it('key / mode / label / sandbox 都对', () => {
		assert.deepEqual(
			BOARD_PRESETS.map((one) => ({
				name: one.name,
				mode: one.mode,
				label: one.label,
				sandbox: one.sandbox,
				approval: one.approval,
			})),
			[
				{
					name: 'taskboard-plan',
					mode: 'plan',
					label: '任务版（计划）',
					sandbox: 'read-only',
					approval: 'ask',
				},
				{
					name: 'taskboard-work',
					mode: 'work',
					label: '任务版（工作）',
					sandbox: 'workspace-write',
					approval: 'ask',
				},
				{
					name: 'taskboard-auto',
					mode: 'auto',
					label: '任务版（自动工作）',
					sandbox: 'workspace-write',
					approval: 'ask',
				},
			],
		);
	});

	it('没有第四个「开发者」预设（用 DSH 自己的完全权限）', () => {
		assert.equal(
			BOARD_PRESETS.some((one) => one.mode === ('developer' as never)),
			false,
		);
		assert.equal(BOARD_PRESETS.length, 3, '开发者权限不新增 —— 用 dsh 的 danger-full-access');
	});

	it('boardModeOf：认我们的三个', () => {
		assert.equal(boardModeOf('taskboard-plan'), 'plan');
		assert.equal(boardModeOf('taskboard-work'), 'work');
		assert.equal(boardModeOf('taskboard-auto'), 'auto');
	});

	it('boardModeOf：不是我们的 ⇒ undefined', () => {
		assert.equal(boardModeOf(undefined), undefined);
		assert.equal(boardModeOf(''), undefined);
		assert.equal(boardModeOf('workspace-write'), undefined);
		assert.equal(boardModeOf('danger-full-access'), undefined);
		assert.equal(boardModeOf('no-tools'), undefined);
		assert.equal(boardModeOf('taskboard-plan-typo'), undefined);
	});
});

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

	it('只读类在工作模式下被拒（无卡时）', () => {
		for (const tool of READONLY_TOOLS) {
			assert.equal(judge('work', tool), false, `${tool} 无卡时必须被拒`);
		}
	});

	it('BASE 里没有重复项', () => {
		assert.equal(new Set(BASE_TOOLS).size, BASE_TOOLS.length);
	});
});

describe('POLICY_TOOLS', () => {
	it('不在 BASE / 执行类 / 只读类里', () => {
		for (const tool of POLICY_TOOLS) {
			assert.equal(BASE_TOOLS.includes(tool), false, `${tool} 不该在 BASE 里`);
			assert.equal(EXECUTION_TOOLS.includes(tool), false);
			assert.equal(READONLY_TOOLS.includes(tool), false);
		}
	});

	it('★ 三个模式下都拒绝（不再有内存开关）', () => {
		for (const mode of ['plan', 'work', 'auto'] as const) {
			for (const tool of POLICY_TOOLS) {
				assert.equal(judge(mode, tool), false, `${mode} 下 ${tool} 必须拒绝`);
			}
		}
	});

	it('★ 就算把 POLICY_TOOLS 写进四档增量，我们的模式下仍拒绝', () => {
		const policies = makeStore({
			common: POLICY_TOOLS,
			groups: { g: POLICY_TOOLS },
			groupMembers: { g: ['writeCode'] },
			templates: { writeCode: POLICY_TOOLS },
		});
		for (const tool of POLICY_TOOLS) {
			assert.equal(
				judge('work', tool, [{ templateRef: 'writeCode' }], policies),
				false,
				`${tool} 靠领卡不该获得`,
			);
		}
	});

	it('但 mode === undefined 时放行（切到完全权限即可改权限）', () => {
		for (const tool of POLICY_TOOLS) {
			assert.ok(judge(undefined, tool), `${tool} 在完全权限下必须放行`);
		}
	});
});

/* ────────────────────────── plan 模式 ────────────────────────── */

describe('plan 模式', () => {
	it('禁的恰好是 create / claim', () => {
		assert.deepEqual([...PLAN_BLOCKED_TOOLS].sort(), ['taskboard_claim', 'taskboard_create']);
	});

	it('★ taskboard_create / taskboard_claim 被拒', () => {
		for (const tool of PLAN_BLOCKED_TOOLS) {
			assert.equal(judge('plan', tool), false, `plan 下 ${tool} 必须拒绝`);
		}
	});

	it('★ 其它写操作照常放行（update_content / update_note / transition / release）', () => {
		for (const tool of [
			'taskboard_update_content',
			'taskboard_update_note',
			'taskboard_transition',
			'taskboard_release',
		]) {
			assert.ok(judge('plan', tool), `plan 下 ${tool} 应当放行（用户只说了不能创建和领取）`);
		}
	});

	it('只读任务板工具照常放行', () => {
		for (const tool of ['taskboard_workspaces', 'taskboard_cards', 'taskboard_card', 'taskboard_registry']) {
			assert.ok(judge('plan', tool));
		}
	});

	it('★ 因为不能领卡 ⇒ 拿不到文件 / 网络工具', () => {
		for (const tool of [...READONLY_TOOLS, ...EXECUTION_TOOLS]) {
			assert.equal(judge('plan', tool), false, `plan 下 ${tool} 必须拒绝`);
		}
	});

	it('★ 就算强行持有工作卡也拿不到（plan 模式不给执行权限）', () => {
		const policies = makeStore({ templates: { writeCode: ['bash', 'read_file'] } });
		assert.equal(judge('plan', 'bash', [{ templateRef: 'writeCode' }], policies), false);
		assert.equal(judge('plan', 'read_file', [{ templateRef: 'writeCode' }], policies), false);
	});
});

/* ────────────────────────── work / auto 的四档 ────────────────────────── */

describe('work / auto：四档并集', () => {
	it('③ 无工作卡 + BASE 外 ⇒ 拒绝', () => {
		for (const mode of ['work', 'auto'] as const) {
			const verdict = judgeToolCall({ mode, toolName: 'bash', heldCards: [] }, NO_POLICIES);
			assert.equal(verdict.ok, false);
			if (!verdict.ok) assert.ok(verdict.reason.includes('工作卡'), verdict.reason);
		}
	});

	it('④ 持有两张工作卡 ⇒ 拒绝（不猜用哪份权限）', () => {
		const policies = makeStore({ templates: { a: ['bash'], b: ['bash'] } });
		for (const mode of ['work', 'auto'] as const) {
			const verdict = judgeToolCall(
				{ mode, toolName: 'bash', heldCards: [{ templateRef: 'a' }, { templateRef: 'b' }] },
				{ policies },
			);
			assert.equal(verdict.ok, false);
			if (!verdict.ok) assert.ok(verdict.reason.includes('多张'), verdict.reason);
		}
	});

	it('⑥ 独立档命中 ⇒ 放行', () => {
		const policies = makeStore({ templates: { writeCode: ['bash'] } });
		for (const mode of ['work', 'auto'] as const) {
			assert.ok(judge(mode, 'bash', [{ templateRef: 'writeCode' }], policies));
		}
	});

	it('⑥ 独立档未命中 ⇒ 拒绝，且说清该卡有哪些额外权限', () => {
		const policies = makeStore({ templates: { writeCode: ['write'] } });
		const verdict = judgeToolCall(
			{ mode: 'work', toolName: 'bash', heldCards: [{ templateRef: 'writeCode' }] },
			{ policies },
		);
		assert.equal(verdict.ok, false);
		if (!verdict.ok) {
			assert.ok(verdict.reason.includes('writeCode'), verdict.reason);
			assert.ok(verdict.reason.includes('write'), `应列出额外权限：${verdict.reason}`);
		}
	});

	it('通用档：任何工作模板都吃', () => {
		const policies = makeStore({ common: ['bash'] });
		for (const ref of ['writeCode', 'research', 'whatever']) {
			assert.ok(judge('work', 'bash', [{ templateRef: ref }], policies), `${ref} 应吃 common`);
		}
	});

	it('组档：组内生效、组外不生效', () => {
		const policies = makeStore({
			groups: { 代码类: ['bash'] },
			groupMembers: { 代码类: ['writeCode', 'refactor'] },
		});
		assert.ok(judge('work', 'bash', [{ templateRef: 'writeCode' }], policies));
		assert.ok(judge('auto', 'bash', [{ templateRef: 'refactor' }], policies));
		assert.equal(judge('work', 'bash', [{ templateRef: 'research' }], policies), false);
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
			assert.ok(judge('work', toolName, [{ templateRef: 'writeCode' }], policies), `${toolName} 应当生效`);
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

/* ────────────────────────── ★ 超集不变量 ────────────────────────── */

describe('★ 超集不变量：BASE 永远放行', () => {
	it('三个模式下，BASE 里除 plan 禁的两个之外都放行', () => {
		const stores: readonly ToolPolicyStore[] = [
			EMPTY_POLICY_STORE,
			makeStore({ common: ['bash'] }),
			makeStore({ groups: { g: ['bash'] }, groupMembers: { g: ['hit'] } }),
			makeStore({ templates: { hit: ['bash', 'write'] } }),
			makeStore({
				common: EXECUTION_TOOLS,
				groups: { g: POLICY_TOOLS },
				groupMembers: { g: ['hit'] },
				templates: { hit: READONLY_TOOLS },
			}),
		];
		const modes: readonly BoardMode[] = ['plan', 'work', 'auto'];

		for (const mode of modes) {
			for (const policies of stores) {
				for (const toolName of BASE_TOOLS) {
					/* plan 模式刻意禁掉 create / claim —— 那两个不适用超集不变量。 */
					if (mode === 'plan' && PLAN_BLOCKED_TOOLS.includes(toolName)) continue;

					/* a) 无卡 */
					assert.ok(judge(mode, toolName, [], policies), `${mode} 无卡 + ${toolName} 应放行`);
					/* b) 一张卡 */
					assert.ok(
						judge(mode, toolName, [{ templateRef: 'hit' }], policies),
						`${mode} 一卡 + ${toolName} 应放行`,
					);
					/* c) 两张卡（异常态）—— BASE 仍放行（③ 在 ④⑤ 之前） */
					assert.ok(
						judge(mode, toolName, [{ templateRef: 'hit' }, { templateRef: 'other' }], policies),
						`${mode} 两卡 + ${toolName} 仍应放行`,
					);
				}
			}
		}
	});
});

/* ────────────────────────── ★ 卡死回归 ────────────────────────── */

describe('★ 卡死回归：transition / release 永远放行', () => {
	it('任意模式 + 任意四档配置都必须放行', () => {
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

		for (const mode of ['plan', 'work', 'auto'] as const) {
			for (const policies of configs) {
				for (const toolName of ['taskboard_transition', 'taskboard_release']) {
					assert.ok(
						judge(mode, toolName, [{ templateRef: 'writeCode' }], policies),
						`${mode} 模式下 ${toolName} 必须放行 —— 否则 AI 锁死`,
					);
				}
			}
		}
	});
});

/* ────────────────────────── Taskboard 集成 ────────────────────────── */

describe('Taskboard：四档持久化 + 判定接模式', () => {
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
				tb.judgeToolCall({ mode: 'work', toolName: 'commonTool', heldCards: [{ templateRef: ref }] }).ok,
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
			tb.judgeToolCall({ mode: 'work', toolName: 'groupTool', heldCards: [{ templateRef: 'writeCode' }] }).ok,
		);
		assert.equal(
			tb.judgeToolCall({ mode: 'work', toolName: 'groupTool', heldCards: [{ templateRef: 'research' }] }).ok,
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

	it('★ 实例的 judgeToolCall 认模式（不再有开关）', () => {
		/* 不是我们的预设 ⇒ 一律放行 */
		assert.ok(tb.judgeToolCall({ mode: undefined, toolName: 'bash', heldCards: [] }).ok);

		/* 我们的模式 + 无卡 ⇒ 拒 */
		assert.equal(tb.judgeToolCall({ mode: 'work', toolName: 'bash', heldCards: [] }).ok, false);

		/* 权限管理工具：我们的模式下永远拒（没有开关可开） */
		assert.equal(
			tb.judgeToolCall({ mode: 'auto', toolName: 'taskboard_tool_policy_set', heldCards: [] }).ok,
			false,
		);
		assert.ok(
			tb.judgeToolCall({ mode: undefined, toolName: 'taskboard_tool_policy_set', heldCards: [] }).ok,
		);
	});

	it('effectiveToolsOf 走实例的策略', async () => {
		await tb.setTemplatePolicy('writeCode', ['myTool']);
		const effective = tb.effectiveToolsOf('writeCode');
		assert.deepEqual(effective.slice(0, BASE_TOOLS.length), [...BASE_TOOLS]);
		assert.ok(effective.includes('myTool'));
	});
});

/* ────────────────────────── adopt：auto 放开 AI ────────────────────────── */

describe('adopt：auto 模式放开 AI 采纳', () => {
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

	it('★ AI 采纳 goal：默认拒绝（work 模式的行为）', async () => {
		const id = await makeCard('t-goal');
		const result = await tb.adopt(ws, id, 'ai');
		assert.equal(result.ok, false, 'goal 的采纳按钮只有 user');
	});

	it('★ AI 采纳 goal：allowAiAdopt: true ⇒ 成功（auto 模式）', async () => {
		const id = await makeCard('t-goal');
		const result = await tb.adopt(ws, id, 'ai', { allowAiAdopt: true });
		assert.ok(result.ok, JSON.stringify(result));
		assert.equal(result.card.status, 'TASK_STATE_SUBMITTED');
		/* history 里那条 adopt 必须记 actor='ai' */
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

	it('★ 不改 protocol 的 BUTTON_ACTIONS：AI 采纳后 history 记 ai，但按钮表仍是 user', async () => {
		/*
		 * 这一条锁住「不要改 protocol」这个决定：
		 * 若有人把 goal 的采纳按钮 actors 改成 BOTH，
		 * 上一轮那条「AI 采纳 goal：默认拒绝」就会变绿 —— 那是错的。
		 */
		const id = await makeCard('t-goal');
		const refused = await tb.adopt(ws, id, 'ai');
		assert.equal(refused.ok, false, 'goal 的 AI 采纳必须默认拒绝（按钮表没改）');
	});
});


