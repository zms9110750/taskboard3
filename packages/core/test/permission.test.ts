/**
 * 工具权限测试。
 *
 * ## 模型
 *
 * ```
 * 未持有工作卡  ⇒ BASE（常量）
 * 持有工作卡 X  ⇒ BASE ∪ extra[X]     ← extra 只存增量，结构上保证超集
 * ```
 *
 * ## 最关键的一条
 *
 * **超集不变量**：任何 BASE 里的工具、任何持有状态，都必须放行。
 * 这条在结构上成立（`extra` 是增量），但**要写测试锁住** ——
 * 否则将来有人把 `BASE_TOOLS` 改成参与计算（"配额"、"排除表"）就破了。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createTaskboard, type Taskboard } from '../lib/index.js';
import {
	BASE_TOOLS,
	EXECUTION_TOOLS,
	POLICY_TOOLS,
	judgeToolCall,
	type PermissionFacts,
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

/** 空事实（没有任何额外策略、开关全关）。 */
function noFacts(): PermissionFacts {
	return { policies: {}, policyEditOn: new Set() };
}

/* ────────────────────────── 清单本身 ────────────────────────── */

describe('BASE_TOOLS 清单', () => {
	it('含任务板自己也含只读类', () => {
		for (const tool of [
			'taskboard_card',
			'taskboard_create',
			'taskboard_transition',
			'taskboard_claim',
			'taskboard_release',
		]) {
			assert.ok(BASE_TOOLS.includes(tool), `BASE 应含 ${tool}`);
		}
		for (const tool of ['read_file', 'glob', 'grep', 'web_search', 'web_fetch']) {
			assert.ok(BASE_TOOLS.includes(tool), `BASE 应含 ${tool}`);
		}
	});

	it('★ 一个执行类都没有', () => {
		for (const tool of EXECUTION_TOOLS) {
			assert.equal(BASE_TOOLS.includes(tool), false, `BASE 不该含执行类 ${tool}`);
		}
	});

	it('原因：执行类必须领卡才给', () => {
		for (const tool of EXECUTION_TOOLS) {
			const verdict = judgeToolCall(
				{ scope: 's', toolName: tool, heldCards: [] },
				noFacts(),
			);
			assert.equal(verdict.ok, false, `${tool} 在无卡时必须被拒`);
		}
	});

	it('BASE 里没有重复项', () => {
		assert.equal(new Set(BASE_TOOLS).size, BASE_TOOLS.length);
	});
});

describe('POLICY_TOOLS 清单', () => {
	it('★ 权限管理工具不在 BASE 里（运行期）', () => {
		for (const tool of POLICY_TOOLS) {
			assert.equal(BASE_TOOLS.includes(tool), false, `${tool} 不该在 BASE 里`);
		}
	});

	it('★ 权限管理工具不在 BASE 里（编译期断言存在）', async () => {
		/*
		 * 编译期断言在 `permission.ts` 的 `_PERMISSION_VOCABULARY_CONSISTENT`：
		 * 用裸字面量元组做 `Extract<...> extends [never]` 判断。
		 * 这里做个运行期复核（类型层拦不住手改字面量而忘了断言的情况）。
		 */
		const { _PERMISSION_VOCABULARY_CONSISTENT } = await import('../lib/permission.js');
		assert.equal(_PERMISSION_VOCABULARY_CONSISTENT, undefined, '类型别名在运行时不存在（这是预期的）');
	});

	it('权限管理工具也不在 EXECUTION_TOOLS 里', () => {
		for (const tool of POLICY_TOOLS) {
			assert.equal(EXECUTION_TOOLS.includes(tool), false);
		}
	});
});

/* ────────────────────────── 纯判定 ────────────────────────── */

describe('判定顺序', () => {
	it('① 权限管理工具：开关关 ⇒ 拒绝，开着 ⇒ 放行', () => {
		const off = judgeToolCall(
			{ scope: 's1', toolName: 'taskboard_tool_policy_set', heldCards: [] },
			noFacts(),
		);
		assert.equal(off.ok, false);

		const on = judgeToolCall(
			{ scope: 's1', toolName: 'taskboard_tool_policy_set', heldCards: [] },
			{ policies: {}, policyEditOn: new Set(['s1']) },
		);
		assert.ok(on.ok, '开关开着 ⇔ 放行');
	});

	it('① 开关按 scope 隔离（别的 scope 开着不算）', () => {
		const verdict = judgeToolCall(
			{ scope: 's-mine', toolName: 'taskboard_tool_policies', heldCards: [] },
			{ policies: {}, policyEditOn: new Set(['s-other']) },
		);
		assert.equal(verdict.ok, false, '别的 scope 的开关不该放行我');
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

	it('④ 持有两张工作卡 ⇒ 拒绝（异常状态，不猜该用哪份权限）', () => {
		const verdict = judgeToolCall(
			{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'a' }, { templateRef: 'b' }] },
			{ policies: { a: ['bash'], b: ['bash'] }, policyEditOn: new Set() },
		);
		assert.equal(verdict.ok, false);
		if (!verdict.ok) assert.ok(verdict.reason.includes('多张'), verdict.reason);
	});

	it('⑤ 持有一张工作卡 + extra 含它 ⇒ 放行', () => {
		const verdict = judgeToolCall(
			{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'writeCode' }] },
			{ policies: { writeCode: ['bash', 'write'] }, policyEditOn: new Set() },
		);
		assert.ok(verdict.ok);
	});

	it('⑥ 持有一张工作卡但 extra 不含它 ⇒ 拒绝，且说清该卡有哪些权限', () => {
		const verdict = judgeToolCall(
			{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'writeCode' }] },
			{ policies: { writeCode: ['write'] }, policyEditOn: new Set() },
		);
		assert.equal(verdict.ok, false);
		if (!verdict.ok) {
			assert.ok(verdict.reason.includes('writeCode'), verdict.reason);
			assert.ok(verdict.reason.includes('write'), `应列出该卡现有的 extra：${verdict.reason}`);
		}
	});

	it('⑥ 该模板没有任何策略 ⇒ 除 BASE 外全拒', () => {
		const verdict = judgeToolCall(
			{ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'noPolicy' }] },
			noFacts(),
		);
		assert.equal(verdict.ok, false);
		if (!verdict.ok) assert.ok(verdict.reason.includes('没有额外权限'), verdict.reason);
	});
});

/* ────────────────────────── ★ 超集不变量 ────────────────────────── */

describe('★ 超集不变量：BASE 永远放行', () => {
	it('对任意 templateRef × 任意 BASE 工具 × 任意 extra，都放行', () => {
		const refs = ['', 'writeCode', 'research', '不存在的模板', 'hasPolicy', 'emptyPolicy'];
		const extraCases: readonly (readonly string[])[] = [
			[],
			['bash'],
			['bash', 'write', 'edit'],
			POLICY_TOOLS, /* 就算有人把权限管理工具塞进 extra，也不影响 BASE */
			EXECUTION_TOOLS,
		];

		for (const templateRef of refs) {
			for (const extra of extraCases) {
				const policies: Record<string, readonly string[]> =
					templateRef === '' ? {} : { [templateRef]: extra };

				for (const toolName of BASE_TOOLS) {
					/* a) 无卡 */
					const noCard = judgeToolCall({ scope: 's', toolName, heldCards: [] }, {
						policies,
						policyEditOn: new Set(),
					});
					assert.ok(noCard.ok, `无卡 + ${toolName} + ref=${templateRef} 应放行`);

					/* b) 持有一张该模板的卡 */
					const oneCard = judgeToolCall(
						{ scope: 's', toolName, heldCards: [{ templateRef }] },
						{ policies, policyEditOn: new Set() },
					);
					assert.ok(oneCard.ok, `持有 ${templateRef} + ${toolName} 应放行`);

					/* c) 持有两张卡（异常态）—— BASE 仍应放行（①② 在 ③④ 之前） */
					const twoCards = judgeToolCall(
						{
							scope: 's',
							toolName,
							heldCards: [{ templateRef }, { templateRef: 'other' }],
						},
						{ policies, policyEditOn: new Set() },
					);
					assert.ok(
						twoCards.ok,
						`持有两张卡 + ${toolName} 仍应放行（基础权限不需要卡，也不受多卡影响）`,
					);

					/* d) 开关关着也不影响 BASE（开关只管 POLICY_TOOLS） */
					const policyOff = judgeToolCall(
						{ scope: 's', toolName, heldCards: [{ templateRef }] },
						{ policies, policyEditOn: new Set() },
					);
					assert.ok(policyOff.ok);
				}
			}
		}
	});

	it('★ 关键后果：AI 领了工作卡也永远能 transition / release', () => {
		/*
		 * 这是决定 ①（extra 是增量）存在的**唯一理由**：
		 * 若工作策略能配成不含 taskboard_*，AI 领了卡却无法 transition/release
		 * ⇒ **永久卡在「处理中」**，而卡又占着「一次一张」配额 ⇒ AI 彻底锁死。
		 */
		const facts: PermissionFacts = {
			policies: { writeCode: ['bash'] }, /* 故意配一个只有执行权限的 extra */
			policyEditOn: new Set(),
		};
		for (const toolName of ['taskboard_transition', 'taskboard_release']) {
			const verdict = judgeToolCall(
				{ scope: 's', toolName, heldCards: [{ templateRef: 'writeCode' }] },
				facts,
			);
			assert.ok(verdict.ok, `${toolName} 必须永远可用，否则卡会永久卡在「处理中」`);
		}

		/* 换成"空策略"也一样。 */
		const empty = judgeToolCall(
			{ scope: 's', toolName: 'taskboard_release', heldCards: [{ templateRef: 'writeCode' }] },
			{ policies: { writeCode: [] }, policyEditOn: new Set() },
		);
		assert.ok(empty.ok);
	});
});

/* ────────────────────────── Taskboard 集成 ────────────────────────── */

describe('Taskboard：开关是纯内存、策略是持久化', () => {
	let dir: string;
	let tb: Taskboard;

	before(async () => {
		dir = mkdtempSync(join(tmpdir(), 'tb3-perm-'));
		tb = createTaskboard({ dataDir: dir });
		tb.templates().register(makeTemplate('writeCode', 'work'));
		tb.templates().register(makeTemplate('research', 'work'));
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

	it('setToolPolicy 落 kv，重新打开后仍在', async () => {
		const result = await tb.setToolPolicy('writeCode', ['bash', 'write']);
		assert.ok(result.ok, JSON.stringify(result));

		assert.deepEqual(tb.getToolPolicies()['writeCode'], ['bash', 'write']);

		/* 重新开一个实例读同一个目录。 */
		const reopened = createTaskboard({ dataDir: dir });
		assert.deepEqual(
			reopened.getToolPolicies()['writeCode'],
			['bash', 'write'],
			'策略必须持久化',
		);
		await reopened.close();
	});

	it('★ 但开关不持久化（重启即关）', async () => {
		tb.setPolicyEdit('scope-x', true);
		assert.equal(tb.isPolicyEditOn('scope-x'), true);

		const reopened = createTaskboard({ dataDir: dir });
		assert.equal(
			reopened.isPolicyEditOn('scope-x'),
			false,
			'权限编辑开关是纯内存的 —— 重启必须默认关',
		);
		await reopened.close();
	});

	it('setToolPolicy 去重、丢空串', async () => {
		await tb.setToolPolicy('research', ['bash', 'bash', '  ', ' write ']);
		assert.deepEqual(tb.getToolPolicies()['research'], ['bash', 'write']);
	});

	it('setToolPolicy 空数组 = 清掉该模板的策略', async () => {
		await tb.setToolPolicy('research', ['bash']);
		await tb.setToolPolicy('research', []);
		assert.equal(tb.getToolPolicies()['research'], undefined);
	});

	it('setToolPolicy 模板不存在 ⇒ TEMPLATE_NOT_FOUND', async () => {
		const result = await tb.setToolPolicy('no-such-template', ['bash']);
		assert.equal(result.ok, false);
		assert.equal(result.code, 'TEMPLATE_NOT_FOUND');
	});

	it('setToolPolicy 空 ref ⇒ FIELD_REQUIRED', async () => {
		const result = await tb.setToolPolicy('   ', ['bash']);
		assert.equal(result.ok, false);
		assert.equal(result.code, 'FIELD_REQUIRED');
	});

	it('不校验工具名是否存在（core 不知道 dsh 有哪些工具）', async () => {
		const result = await tb.setToolPolicy('writeCode', ['totally_made_up_tool']);
		assert.ok(result.ok, '名字不存在也该能存 —— 没注册的工具本来就不会生效');
		assert.deepEqual(tb.getToolPolicies()['writeCode'], ['totally_made_up_tool']);
	});

	it('judgeToolCall 走实例的策略 + 开关', async () => {
		await tb.setToolPolicy('writeCode', ['bash']);

		/* 无卡 ⇒ bash 拒 */
		assert.equal(tb.judgeToolCall({ scope: 's', toolName: 'bash', heldCards: [] }).ok, false);

		/* 持有 writeCode ⇒ bash 放行 */
		assert.ok(
			tb.judgeToolCall({ scope: 's', toolName: 'bash', heldCards: [{ templateRef: 'writeCode' }] })
				.ok,
		);

		/* 权限管理工具：开关关 ⇒ 拒 */
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

	it('★ 持久化只影响 extra，BASE 永远不变', async () => {
		await tb.setToolPolicy('writeCode', []);
		for (const toolName of BASE_TOOLS) {
			assert.ok(
				tb.judgeToolCall({ scope: 's', toolName, heldCards: [{ templateRef: 'writeCode' }] }).ok,
				`清空 extra 后 ${toolName} 仍应放行`,
			);
		}
	});
});
