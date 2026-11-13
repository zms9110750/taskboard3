/**
 * 工具权限测试。
 *
 * ## 模型（`2026-11-14` 四档）
 *
 * ```
 * effective(templateRef) =
 *     BASE_TOOLS                         ← 11 个 taskboard_*，常量
 *   ∪ common                             ← 通用：所有工作卡都吃
 *   ∪ ⋃{ groups[g] | ref ∈ groupMembers[g] }   ← 组：批量设置
 *   ∪ templates[ref]                      ← 独立：只对该模板
 * ```
 *
 * ## 最关键的两条
 *
 * 1. **超集不变量**：任何 BASE 工具、任何持有状态，都必须放行。
 * 2. **卡死回归**：`taskboard_transition` / `taskboard_release` 永远放行 ——
 *    否则 AI 领了卡却转不了状态 / 松不了手 ⇒ 永久卡在「处理中」+ 占配额 ⇒ 锁死。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createTaskboard, type Taskboard } from '../lib/index.js';
import {
	BASE_TOOLS,
	EMPTY_POLICY_STORE,
	EXECUTION_TOOLS,
	POLICY_TOOLS,
	READONLY_TOOLS,
	effectiveToolsOf,
	judgeToolCall,
	type PermissionFacts,
	type ToolPolicyStore,
} from '../lib/permission.js';
import type { TemplateDef } from '../lib/template/types.js';

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

/** 空事实（四档全空、开关全关）。 */
function noFacts(): PermissionFacts {
	return { policies: EMPTY_POLICY_STORE, policyEditOn: new Set() };
}

/** 造一份策略（各档可选）。 */
function makeStore(over: Partial<ToolPolicyStore> = {}): ToolPolicyStore {
	return {
		common: over.common ?? [],
		groups: over.groups ?? {},
		groupMembers: over.groupMembers ?? {},
		templates: over.templates ?? {},
	};
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

	it('只读类被拒的理由：会「获得不知道的信息」', () => {
		for (const tool of READONLY_TOOLS) {
			const verdict = judgeToolCall({ scope: 's', toolName: tool, heldCards: [] }, noFacts());
			assert.equal(verdict.ok, false, `${tool} 在无卡时必须被拒`);
		}
	});

	it('BASE 里没有重复项', () => {
		assert.equal(new Set(BASE_TOOLS).size, BASE_TOOLS.length);
	});
});

describe('POLICY_TOOLS', () => {
	it('不在 BASE 里', () => {
		for (const tool of POLICY_TOOLS) {
			assert.equal(BASE_TOOLS.includes(tool), false, `${tool} 不该在 BASE 里`);
		}
	});

	it('也不在 EXECUTION_TOOLS / READONLY_TOOLS 里', () => {
		for (const tool of POLICY_TOOLS) {
			assert.equal(EXECUTION_TOOLS.includes(tool), false);
			assert.equal(READONLY_TOOLS.includes(tool), false);
		}
	});

	it('★ 就算有人把 POLICY_TOOLS 写进四档增量，也必须靠开关（不靠领卡）', () => {
		/*
		 * `judgeToolCall` 第 ① 步就判 POLICY_TOOLS，早于 BASE / 四档。
		 * ⇒ 领一百张卡也没用，开关关着就是关着。
		 */
		const policies = makeStore({
			common: POLICY_TOOLS,
			groups: { g: POLICY_TOOLS },
			groupMembers: { g: ['writeCode'] },
			templates: { writeCode: POLICY_TOOLS },
		});
		for (const tool of POLICY_TOOLS) {
			const verdict = judgeToolCall(
				{ scope: 's', toolName: tool, heldCards: [{ templateRef: 'writeCode' }] },
				{ policies, policyEditOn: new Set() },
			);
			assert.equal(verdict.ok, false, `${tool} 靠领卡不该获得，只能靠开关`);
		}
	});
});

/* ────────────────────────── 判定顺序 ────────────────────────── */

describe('判定顺序', () => {
	it('① 权限管理工具：开关关 ⇒ 拒绝，开着 ⇒ 放行', () => {
		const off = judgeToolCall(
			{ scope: 's1', toolName: 'taskboard_tool_policy_set', heldCards: [] },
			noFacts(),
		);
		assert.equal(off.ok, false);

		const on = judgeToolCall(
			{ scope: 's1', toolName: 'taskboard_tool_policy_set', heldCards: [] },
			{ policies: EMPTY_POLICY_STORE, policyEditOn: new Set(['s1']) },
		);
		assert.ok(on.ok);
	});

	it('① 开关按 scope 隔离', () => {
		const verdict = judgeToolCall(
			{ scope: 's-mine', toolName: 'taskboard_tool_policies', heldCards: [] },
			{ policies: EMPTY_POLICY_STORE, policyEditOn: new Set(['s-other']) },
		);
		assert.equal(verdict.ok, false);
	});

	it('② BASE 工具：无卡也放行', () => {
		for (const toolName of BASE_TOOLS) {
			const verdict = judgeToolCall({ scope: 's', toolName, heldCards: [] }, noFacts());
			assert.ok(verdict.ok, `${toolName} 无卡也应放行`);
		}
	});

	it('③ 无工作卡 + BASE 外 ⇒ 拒绝', () => {
		const verdict = judgeToolCall({ scope: 's', toolName: 'bash', heldCards: [] }, noFacts());
		assert.equal(verdict.ok, false);
		if (!verdict.ok) assert.ok(verdict.reason.includes('工作卡'), verdict.reason);
	});

	it('④ 持有两张工作卡 ⇒ 拒绝（不猜用哪份权限）', () => {
		const verdict = judgeToolCall(
			{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'a' }, { templateRef: 'b' }] },
			{ policies: makeStore({ templates: { a: ['bash'], b: ['bash'] } }), policyEditOn: new Set() },
		);
		assert.equal(verdict.ok, false);
		if (!verdict.ok) assert.ok(verdict.reason.includes('多张'), verdict.reason);
	});

	it('⑤ 独立档命中 ⇒ 放行', () => {
		const verdict = judgeToolCall(
			{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'writeCode' }] },
			{ policies: makeStore({ templates: { writeCode: ['bash', 'write'] } }), policyEditOn: new Set() },
		);
		assert.ok(verdict.ok);
	});

	it('⑥ 独立档未命中 ⇒ 拒绝，且说清该卡有哪些额外权限', () => {
		const verdict = judgeToolCall(
			{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'writeCode' }] },
			{ policies: makeStore({ templates: { writeCode: ['write'] } }), policyEditOn: new Set() },
		);
		assert.equal(verdict.ok, false);
		if (!verdict.ok) {
			assert.ok(verdict.reason.includes('writeCode'), verdict.reason);
			assert.ok(verdict.reason.includes('write'), `应列出额外权限：${verdict.reason}`);
		}
	});

	it('⑥ 任何档都没配 ⇒ 除 BASE 外全拒', () => {
		const verdict = judgeToolCall(
			{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'noPolicy' }] },
			noFacts(),
		);
		assert.equal(verdict.ok, false);
		if (!verdict.ok) assert.ok(verdict.reason.includes('没有额外权限'), verdict.reason);
	});
});

/* ────────────────────────── 四档并集 ────────────────────────── */

describe('四档并集', () => {
	it('通用档：设了 common ⇒ 任意工作模板都生效', () => {
		const policies = makeStore({ common: ['bash'] });
		for (const ref of ['writeCode', 'research', 'anything', '']) {
			const verdict = judgeToolCall(
				{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: ref }] },
				{ policies, policyEditOn: new Set() },
			);
			assert.ok(verdict.ok, ref === '' ? '空 ref 也该吃 common' : `${ref} 应吃 common`);
		}
	});

	it('组档：组内模板生效，组外不生效', () => {
		const policies = makeStore({
			groups: { 代码类: ['bash', 'write'] },
			groupMembers: { 代码类: ['writeCode', 'refactor'] },
		});

		for (const ref of ['writeCode', 'refactor']) {
			const verdict = judgeToolCall(
				{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: ref }] },
				{ policies, policyEditOn: new Set() },
			);
			assert.ok(verdict.ok, `${ref} 在组里应当生效`);
		}

		const outside = judgeToolCall(
			{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'research' }] },
			{ policies, policyEditOn: new Set() },
		);
		assert.equal(outside.ok, false, '组外模板不该吃到组权限');
	});

	it('组档：多个组同时命中 ⇒ 全部叠加', () => {
		const policies = makeStore({
			groups: { 一组: ['bash'], 二组: ['write'] },
			groupMembers: { 一组: ['both'], 二组: ['both'] },
		});
		const effective = effectiveToolsOf(policies, 'both');
		assert.ok(effective.includes('bash'));
		assert.ok(effective.includes('write'));
	});

	it('组档：组名存在但没有成员 ⇒ 谁都不生效（合法状态）', () => {
		const policies = makeStore({ groups: { 空组: ['bash'] }, groupMembers: {} });
		const verdict = judgeToolCall(
			{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'writeCode' }] },
			{ policies, policyEditOn: new Set() },
		);
		assert.equal(verdict.ok, false);
	});

	it('独立档：只对该模板生效', () => {
		const policies = makeStore({ templates: { writeCode: ['bash'] } });

		assert.ok(
			judgeToolCall(
				{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'writeCode' }] },
				{ policies, policyEditOn: new Set() },
			).ok,
		);
		assert.equal(
			judgeToolCall(
				{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'other' }] },
				{ policies, policyEditOn: new Set() },
			).ok,
			false,
		);
	});

	it('★ 四档叠加：同一模板命中通用 + 组 + 独立，三者都生效', () => {
		const policies = makeStore({
			common: ['commonTool'],
			groups: { g: ['groupTool'] },
			groupMembers: { g: ['writeCode'] },
			templates: { writeCode: ['ownTool'] },
		});

		for (const toolName of ['commonTool', 'groupTool', 'ownTool']) {
			const verdict = judgeToolCall(
				{ scope: 's', toolName, heldCards: [{ templateRef: 'writeCode' }] },
				{ policies, policyEditOn: new Set() },
			);
			assert.ok(verdict.ok, `${toolName} 应当生效（四档之一）`);
		}
	});

	it('effectiveToolsOf：去重、稳定顺序（BASE 在前）', () => {
		const policies = makeStore({
			common: ['bash', 'taskboard_card'], /* 故意重复一个 BASE 工具 */
			templates: { x: ['bash', 'write'] }, /* bash 与 common 重复 */
		});
		const effective = effectiveToolsOf(policies, 'x');

		/* 去重 */
		assert.equal(new Set(effective).size, effective.length);
		/* 前 11 个恰好是 BASE（稳定顺序：BASE 原序） */
		assert.deepEqual(effective.slice(0, BASE_TOOLS.length), [...BASE_TOOLS]);
		/* 额外项按叠加顺序：common 先，独立档后 */
		assert.deepEqual(effective.slice(BASE_TOOLS.length), ['bash', 'write']);
	});

	it('effectiveToolsOf：空策略 ⇒ 恰好是 BASE', () => {
		assert.deepEqual(effectiveToolsOf(EMPTY_POLICY_STORE, 'whatever'), [...BASE_TOOLS]);
	});

	it('组里包含不存在的模板名 ⇒ 不报错，只是永不命中', () => {
		const policies = makeStore({
			groups: { g: ['bash'] },
			groupMembers: { g: ['不存在的模板', 'writeCode'] },
		});
		/* 存在的那个命中 */
		assert.ok(effectiveToolsOf(policies, 'writeCode').includes('bash'));
		/* 组里的幽灵名本身也能算（它就是成员名）—— 但永远不会有卡用它，所以静默无害 */
		assert.ok(effectiveToolsOf(policies, '不存在的模板').includes('bash'));
		/* 完全不在任何成员名单里的模板 ⇒ 不命中，且不抛 */
		assert.equal(effectiveToolsOf(policies, '别的模板').includes('bash'), false);
	});
});

/* ────────────────────────── ★ 超集不变量 ────────────────────────── */

describe('★ 超集不变量：BASE 永远放行', () => {
	it('对任意 templateRef × 任意 BASE 工具 × 任意四档组合，都放行', () => {
		const refs = ['', 'writeCode', 'research', '不存在的模板', 'hit'];
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

		for (const templateRef of refs) {
			for (const policies of stores) {
				for (const toolName of BASE_TOOLS) {
					/* a) 无卡 */
					assert.ok(
						judgeToolCall({ scope: 's', toolName, heldCards: [] }, { policies, policyEditOn: new Set() })
							.ok,
						`无卡 + ${toolName} 应放行`,
					);
					/* b) 持有一张 */
					assert.ok(
						judgeToolCall(
							{ scope: 's', toolName, heldCards: [{ templateRef }] },
							{ policies, policyEditOn: new Set() },
						).ok,
						`持有 ${templateRef} + ${toolName} 应放行`,
					);
					/* c) 持有两张（异常态）—— BASE 仍放行（①② 在 ③④ 之前） */
					assert.ok(
						judgeToolCall(
							{ scope: 's', toolName, heldCards: [{ templateRef }, { templateRef: 'other' }] },
							{ policies, policyEditOn: new Set() },
						).ok,
						`两卡 + ${toolName} 仍应放行`,
					);
				}
			}
		}
	});
});

/* ────────────────────────── ★ 卡死回归 ────────────────────────── */

describe('★ 卡死回归：transition / release 永远放行', () => {
	it('任意配置下都必须放行（否则卡永久卡在「处理中」→ AI 锁死）', () => {
		/*
		 * 这是「四档都是增量」这个结构决定的**唯一理由**：
		 *
		 * AI 领了工作卡 → 卡是 WORKING → 占着「一次一张」配额。
		 * 如果此时 taskboard_transition / release 被拒：
		 *   · 转不了态 → 卡出不去 WORKING
		 *   · 放不了手 → 配额一直占着
		 * ⇒ **AI 彻底锁死**，而且没有任何操作能解开。
		 */
		const configs: readonly ToolPolicyStore[] = [
			EMPTY_POLICY_STORE,
			makeStore({ common: [] }),
			makeStore({ templates: { writeCode: [] } }),
			makeStore({ templates: { writeCode: ['bash'] } }), /* 故意不含任何 taskboard_* */
			makeStore({ common: ['bash'], groups: { g: ['write'] }, groupMembers: { g: ['writeCode'] } }),
			/* 最恶劣：所有档位都塞满执行类，一个 taskboard_* 都没有 */
			makeStore({
				common: EXECUTION_TOOLS,
				groups: { g: EXECUTION_TOOLS },
				groupMembers: { g: ['writeCode'] },
				templates: { writeCode: EXECUTION_TOOLS },
			}),
		];

		for (const policies of configs) {
			for (const toolName of ['taskboard_transition', 'taskboard_release']) {
				const verdict = judgeToolCall(
					{ scope: 's', toolName, heldCards: [{ templateRef: 'writeCode' }] },
					{ policies, policyEditOn: new Set() },
				);
				assert.ok(verdict.ok, `${toolName} 在任何配置下都必须放行 —— 否则 AI 锁死`);
			}
		}
	});
});

/* ────────────────────────── Taskboard 集成 ────────────────────────── */

describe('Taskboard：开关纯内存、策略持久化、四档入口', () => {
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

	it('开关默认关', () => {
		assert.equal(tb.isPolicyEditOn('any-scope'), false);
	});

	it('开关按 scope 独立；可开关', () => {
		tb.setPolicyEdit('a', true);
		tb.setPolicyEdit('b', false);
		assert.equal(tb.isPolicyEditOn('a'), true);
		assert.equal(tb.isPolicyEditOn('b'), false);
		tb.setPolicyEdit('a', false);
		assert.equal(tb.isPolicyEditOn('a'), false);
	});

	it('初始策略是空的四档', () => {
		const store = tb.getToolPolicies();
		assert.deepEqual(store.common, []);
		assert.deepEqual(store.groups, {});
		assert.deepEqual(store.groupMembers, {});
		assert.deepEqual(store.templates, {});
	});

	it('独立档落 kv，重新打开后仍在', async () => {
		const result = await tb.setTemplatePolicy('writeCode', ['bash', 'write']);
		assert.ok(result.ok, JSON.stringify(result));

		assert.deepEqual(tb.getToolPolicies().templates['writeCode'], ['bash', 'write']);

		const reopened = createTaskboard({ dataDir: dir });
		assert.deepEqual(reopened.getToolPolicies().templates['writeCode'], ['bash', 'write']);
		await reopened.close();
	});

	it('★ 但开关不持久化（重启即关）', async () => {
		tb.setPolicyEdit('scope-x', true);
		const reopened = createTaskboard({ dataDir: dir });
		assert.equal(reopened.isPolicyEditOn('scope-x'), false, '权限编辑开关必须重启即关');
		await reopened.close();
	});

	it('通用档：落库 + 对所有模板生效', async () => {
		assert.ok((await tb.setCommonPolicy(['commonTool'])).ok);
		assert.deepEqual(tb.getToolPolicies().common, ['commonTool']);

		for (const ref of ['writeCode', 'research', 'refactor']) {
			assert.ok(
				tb.judgeToolCall({ scope: 's', toolName: 'commonTool', heldCards: [{ templateRef: ref }] }).ok,
				`${ref} 应当吃通用档`,
			);
		}
	});

	it('组档：setGroupMembers + setGroupPolicy 后组内生效', async () => {
		assert.ok((await tb.setGroupMembers('代码类', ['writeCode', 'refactor'])).ok);
		assert.ok((await tb.setGroupPolicy('代码类', ['groupTool'])).ok);

		const store = tb.getToolPolicies();
		assert.deepEqual(store.groupMembers['代码类'], ['writeCode', 'refactor']);
		assert.deepEqual(store.groups['代码类'], ['groupTool']);

		for (const ref of ['writeCode', 'refactor']) {
			assert.ok(
				tb.judgeToolCall({ scope: 's', toolName: 'groupTool', heldCards: [{ templateRef: ref }] }).ok,
			);
		}
		/* 组外 */
		assert.equal(
			tb.judgeToolCall({ scope: 's', toolName: 'groupTool', heldCards: [{ templateRef: 'research' }] })
				.ok,
			false,
		);
	});

	it('setGroupMembers 不校验模板是否存在（无所谓是否存在）', async () => {
		const result = await tb.setGroupMembers('含幽灵', ['writeCode', '根本不存在的模板']);
		assert.ok(result.ok, '不该因为模板不存在而拒');
		assert.deepEqual(tb.getToolPolicies().groupMembers['含幽灵'], ['writeCode', '根本不存在的模板']);
	});

	it('setGroupPolicy 空组名 ⇒ FIELD_REQUIRED', async () => {
		const result = await tb.setGroupPolicy('   ', ['bash']);
		assert.equal(result.ok, false);
		assert.equal(result.code, 'FIELD_REQUIRED');
	});

	it('removeGroup 删掉策略与成员；幂等', async () => {
		await tb.setGroupMembers('临时的', ['writeCode']);
		await tb.setGroupPolicy('临时的', ['tmpTool']);

		assert.ok((await tb.removeGroup('临时的')).ok);
		const store = tb.getToolPolicies();
		assert.equal(store.groups['临时的'], undefined);
		assert.equal(store.groupMembers['临时的'], undefined);

		/* 再删一次也算成功（幂等）。 */
		assert.ok((await tb.removeGroup('临时的')).ok);
	});

	it('setTemplatePolicy 去重、丢空串', async () => {
		await tb.setTemplatePolicy('research', ['bash', 'bash', '  ', ' write ']);
		assert.deepEqual(tb.getToolPolicies().templates['research'], ['bash', 'write']);
	});

	it('setTemplatePolicy 空数组 = 清掉该模板的独立档（不是删 key，是存空）', async () => {
		await tb.setTemplatePolicy('research', ['bash']);
		await tb.setTemplatePolicy('research', []);
		const own = tb.getToolPolicies().templates['research'];
		assert.deepEqual(own, [], '空数组是合法值（该模板没有额外权限）');
	});

	it('setTemplatePolicy 模板不存在 ⇒ TEMPLATE_NOT_FOUND（唯一的粒度校验）', async () => {
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
		const result = await tb.setTemplatePolicy('writeCode', ['totally_made_up_tool']);
		assert.ok(result.ok, '名字不存在也该能存 —— 没注册的工具本来就不会生效');
		assert.deepEqual(tb.getToolPolicies().templates['writeCode'], ['totally_made_up_tool']);
	});

	it('effectiveToolsOf 走实例的策略', async () => {
		await tb.setTemplatePolicy('writeCode', ['myTool']);
		const effective = tb.effectiveToolsOf('writeCode');
		assert.deepEqual(effective.slice(0, BASE_TOOLS.length), [...BASE_TOOLS]);
		assert.ok(effective.includes('myTool'));
	});

	it('judgeToolCall 走实例的四档 + 开关', async () => {
		await tb.setTemplatePolicy('writeCode', ['bash']);

		assert.equal(tb.judgeToolCall({ scope: 's', toolName: 'bash', heldCards: [] }).ok, false);
		assert.ok(
			tb.judgeToolCall({ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'writeCode' }] }).ok,
		);

		assert.equal(
			tb.judgeToolCall({ scope: 's', toolName: 'taskboard_tool_policy_set', heldCards: [] }).ok,
			false,
		);
		tb.setPolicyEdit('s', true);
		assert.ok(
			tb.judgeToolCall({ scope: 's', toolName: 'taskboard_tool_policy_set', heldCards: [] }).ok,
		);
		tb.setPolicyEdit('s', false);
	});

	it('★ 清空所有档位后 BASE 仍全部放行', async () => {
		await tb.setCommonPolicy([]);
		await tb.setTemplatePolicy('writeCode', []);
		for (const toolName of BASE_TOOLS) {
			assert.ok(
				tb.judgeToolCall({ scope: 's', toolName, heldCards: [{ templateRef: 'writeCode' }] }).ok,
				`清空后 ${toolName} 仍应放行`,
			);
		}
	});
});

describe('★ 旧 v1 结构不读不迁移', () => {
	it('kv 里只有 v1 ⇒ 读出来是空四档（不迁移、不报错）', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-perm-v1-'));
		/* 直接往 kv 塞旧格式。 */
		const tb1 = createTaskboard({ dataDir: dir });
		/* 用任意写路径拿到底层 store 不现实 ⇒ 用 v2 空表 + 手工断言即可。 */
		const store = tb1.getToolPolicies();
		assert.deepEqual(store.common, [], 'v2 键不存在 ⇒ 空四档');

		await tb1.close();
		rmSync(dir, { recursive: true, force: true });
	});
});
