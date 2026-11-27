/**
 * agent 侧工具调用权限（`ToolGuardLevel` + `judgeToolCall`）—— **这套现在归本包**。
 *
 * ## 为什么这个文件在 `dsh-agent-guard` 而不在 `core`（用户裁决）
 *
 * > 「agent处有一个权限选择。完全由各自 agent 接入处提供。这不是任务板的功能。
 * >   因为这依赖 agent 自己的 tool。所以 mcp 也不提供这个功能。…
 * >   这是对于 dsh 私人的专属功能。」
 * >
 * > 「由3伴生来的一个档位对工具的拦截和权限。也是我对于 dsh 的私人专属实现。
 * >   这个 tool，不在 core 里提供。完全由 dsh 桥接包提供。」
 *
 * ⇒ 实现搬到 `packages/dsh-agent-guard/src/tool-guard.ts`（`2026-11-23` 从 core
 *   经 `dsh-tools` 迁到本包），**测试也跟着搬**。
 *   core 的测试不许 import 本包（依赖方向 `dsh-tools → core`，反向会让
 *   `tsc -b` 的项目引用成环）—— 所以这些用例是**搬过来**，不是「改个 import」。
 *
 * ## 迁移来源（一条断言都没丢）
 *
 * | 原位置 | 内容 |
 * |---|---|
 * | `core/test/permission-levels.test.ts` | `TOOL_GUARD_OPTIONS` / 默认档位 / 写后读 / 立即影响判定 / 持久化 / 两键独立 / 脏值 |
 * | `core/test/policy-scopes.test.ts` | 「未领取档真的影响判定」 |
 *
 * ## 判定是纯函数
 *
 * `judgeToolCall(input, facts)` 的三样输入各归其主：
 *
 * ```
 * cardLevel  ← core（`tb.getCardActionLevel()`，本文件只读）
 * toolLevel  ← 本包自己的 kv（`readToolGuardLevelOf(store)`）
 * policies   ← core（`tb.getToolPolicies()`）
 * ```
 *
 * ⚠ 第一段（领卡 / 采纳 / 放手）**永远先跑、完全不看 `toolLevel`** —— 这是两条轴
 *   正交性的落点，下面的「正交」用例专门钉它。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTaskboard, type CardStore, type Taskboard } from '@taskboard/core';
import type { Card } from '@taskboard/core';

import {
	TOOL_GUARD_OPTIONS,
	judgeToolCall,
	readToolGuardLevelOf,
	writeToolGuardLevel,
	type ToolGuardKv,
	type ToolCallVerdict,
} from '../src/tool-guard.ts';

/* ────────────────────────────── 夹具 ────────────────────────────── */

/**
 * 最小内存 store。
 *
 * ⚠ **不直接复用 core 的 `test/memory-store.ts`**：那是 core 的测试私有文件，
 *   没有从包入口导出，跨包 import 会走 `../` 相对路径穿过包边界 —— 既脆又违反
 *   依赖方向。这里只需要 kv 两方法（判定是纯函数，不碰卡），所以内联一份更干净。
 */
function createMemoryStore(): CardStore & ToolGuardKv {
	const tables = new Map<string, Map<string, Card>>();
	const kv = new Map<string, string>();
	return {
		loadAll(workspaceId: string): readonly Card[] {
			return [...(tables.get(workspaceId)?.values() ?? [])];
		},
		async save(workspaceId: string, card: Card): Promise<void> {
			const table = tables.get(workspaceId) ?? new Map<string, Card>();
			table.set(card.id, card);
			tables.set(workspaceId, table);
		},
		kvGet(key: string): string | undefined {
			return kv.get(key);
		},
		async kvSet(key: string, value: string | undefined): Promise<void> {
			if (value === undefined) kv.delete(key);
			else kv.set(key, value);
		},
		async close(): Promise<void> {
			/* 故意不清 —— 「关掉句柄，磁盘还在」，见 core/test/memory-store.ts 文件头。 */
		},
	};
}

/** 造一个实例 + 它的 store。 */
function makeTaskboard(): { readonly store: ReturnType<typeof createMemoryStore>; readonly tb: Taskboard } {
	const store = createMemoryStore();
	return { store, tb: createTaskboard({ store }) };
}

/**
 * 造一个「按旧签名判定」的闭包 —— 迁移前 core 的 `tb.judgeToolCall(input)` 就长这样。
 *
 * 保留它让迁移过来的断言**一行都不用改**，只是调用形式变了：
 * 三样输入各归其主（见文件头）。
 */
function judgeOf(
	tb: Taskboard,
	kv: ToolGuardKv,
): (input: {
	readonly toolName: string;
	readonly heldCards: readonly { readonly templateRef: string }[];
}) => ToolCallVerdict {
	return (input) =>
		judgeToolCall(
			{ cardLevel: tb.getCardActionLevel(), toolLevel: readToolGuardLevelOf(kv), ...input },
			{ policies: tb.getToolPolicies() },
		);
}

/** 跑一段代码，收集期间的 `console.warn` 文本（然后恢复原函数）。 */
function captureWarnings<T>(fn: () => T): { readonly result: T; readonly warnings: readonly string[] } {
	const warnings: string[] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]): void => {
		warnings.push(args.map((one) => String(one)).join(' '));
	};
	try {
		return { result: fn(), warnings };
	} finally {
		console.warn = original;
	}
}

/** agent 侧档位在 kv 里的键（沿用旧值，不许换 —— 换了用户配的档位会静默丢失）。 */
const GUARD_KEY = 'taskboard.permission.toolGuardLevel';

/* ────────────────────────── 选项常量 ────────────────────────── */

describe('档位选项常量：给 UI / HTTP 路由用', () => {
	it('TOOL_GUARD_OPTIONS：三档、顺序、文案齐全', () => {
		assert.deepEqual(
			TOOL_GUARD_OPTIONS.map((one) => one.value),
			['off', 'manage', 'manage-edit'],
		);
		for (const option of TOOL_GUARD_OPTIONS) {
			assert.ok(option.label.length > 0, `${option.value} 缺 label`);
			assert.ok(option.description.length > 0, `${option.value} 缺 description`);
		}
	});
});

/* ────────────────────────── 默认值 + 判定 ────────────────────────── */

describe('默认档位', () => {
	it('未配置时 toolGuardLevel=off', async () => {
		const { store, tb } = makeTaskboard();
		try {
			assert.equal(readToolGuardLevelOf(store), 'off');
		} finally {
			await tb.close();
		}
	});

	it('★ 默认档位下：claim 拒、adopt 拒、其它非领卡类工具放行', async () => {
		const { store, tb } = makeTaskboard();
		const judge = judgeOf(tb, store);
		try {
			/* 第二段：off ⇒ 非领卡类工具一律放行（包括 BASE / 权限管理 / 执行类）。 */
			for (const toolName of [
				'taskboard_cards',
				'taskboard_create',
				'taskboard_transition',
				'taskboard_tool_policy',
				'bash',
				'write',
				'read_file',
				'unknown_tool',
			]) {
				assert.ok(judge({ toolName, heldCards: [] }).ok, `${toolName} 在默认 off 下应放行`);
			}

			/* 第一段：UI 轴默认 no-claim ⇒ 领卡类动作被拒。 */
			assert.equal(
				judge({ toolName: 'taskboard_claim', heldCards: [] }).ok,
				false,
				'默认 no-claim ⇒ claim 必须拒',
			);
			assert.equal(
				judge({ toolName: 'taskboard_claim', heldCards: [{ templateRef: 'writeCode' }] }).ok,
				false,
				'有卡也不放开领卡（档位是全局状态）',
			);
			assert.equal(
				judge({ toolName: 'taskboard_adopt', heldCards: [] }).ok,
				false,
				'默认 no-claim ⇒ adopt 也必须拒',
			);

			/* 放手永远允许。 */
			assert.ok(judge({ toolName: 'taskboard_release', heldCards: [] }).ok);
		} finally {
			await tb.close();
		}
	});
});

/* ────────────────────────── 写后读 + 立即影响判定 ────────────────────────── */

describe('写后读', () => {
	it('setToolGuardLevel 写后读：三档都能设', async () => {
		const { store, tb } = makeTaskboard();
		try {
			for (const level of ['manage', 'manage-edit', 'off'] as const) {
				await writeToolGuardLevel(store, level);
				assert.equal(readToolGuardLevelOf(store), level);
			}
		} finally {
			await tb.close();
		}
	});

	it('★ 档位改动立即反映到 judgeToolCall（不需要重建实例）', async () => {
		const { store, tb } = makeTaskboard();
		const judge = judgeOf(tb, store);
		try {
			const ok = (toolName: string): boolean => judge({ toolName, heldCards: [] }).ok;

			/* 默认：both off / no-claim。 */
			assert.ok(ok('bash'));
			assert.equal(ok('taskboard_claim'), false);

			/* 宿主轴 → manage：无卡的非 BASE 工具被拒，但领卡判定不受影响。 */
			await writeToolGuardLevel(store, 'manage');
			assert.equal(ok('bash'), false, 'manage + 无卡 ⇒ bash 拒');
			assert.ok(ok('taskboard_cards'), 'BASE 工具不需要卡');
			assert.equal(ok('taskboard_claim'), false, 'UI 轴仍是 no-claim');

			/* 宿主轴 → manage-edit：权限管理工具放开。 */
			await writeToolGuardLevel(store, 'manage-edit');
			assert.ok(ok('taskboard_tool_policy'));

			/* UI 轴 → claim：能领卡但还不能采纳。 */
			await tb.setCardActionLevel('claim');
			assert.ok(ok('taskboard_claim'));
			assert.equal(ok('taskboard_adopt'), false);

			/* UI 轴 → adopt：采纳也放开。 */
			await tb.setCardActionLevel('adopt');
			assert.ok(ok('taskboard_adopt'));
		} finally {
			await tb.close();
		}
	});
});

/* ────────────────────────── 持久化 ────────────────────────── */

describe('持久化（落 kv）', () => {
	it('★ 写后新建实例，两个档位都还在，且判定沿用', async () => {
		/*
		 * ⚠ **共用同一个 store 实例** —— 这条测的是「档位写进端口、新实例从同一端口
		 *   读回」。内存 store 每次 new 一个就是空库，那样测的就不是持久化，而是
		 *   「新库」（当然读不到）。
		 *
		 *   SQLite 的**真落盘**（关库再开仍在）由 `@taskboard/io` 自己的测试负责
		 *   —— 那是实现的事，不是端口语义的事。
		 */
		const shared = createMemoryStore();
		const first = createTaskboard({ store: shared });
		await first.setCardActionLevel('adopt');
		await writeToolGuardLevel(shared, 'manage-edit');
		await first.close();

		const second = createTaskboard({ store: shared });
		try {
			assert.equal(second.getCardActionLevel(), 'adopt');
			assert.equal(readToolGuardLevelOf(shared), 'manage-edit');

			/* 判定确实用了从端口读回的档位。 */
			const judge = judgeOf(second, shared);
			assert.ok(judge({ toolName: 'taskboard_claim', heldCards: [] }).ok);
			assert.ok(judge({ toolName: 'taskboard_adopt', heldCards: [] }).ok);
			assert.ok(judge({ toolName: 'taskboard_tool_policy', heldCards: [] }).ok);
		} finally {
			await second.close();
		}
	});

	it('两个键互相独立：只改一个，另一个保持默认', async () => {
		const { store, tb } = makeTaskboard();
		try {
			await writeToolGuardLevel(store, 'manage');
			assert.equal(readToolGuardLevelOf(store), 'manage');
			assert.equal(tb.getCardActionLevel(), 'no-claim', '改宿主轴不该动 UI 轴');
		} finally {
			await tb.close();
		}
	});
});

/* ────────────────────────── 正交性（两轴互不代偿） ────────────────────────── */

describe('正交：两轴互不代偿', () => {
	it('★ 宿主 manage-edit 不会让 no-claim 档能领卡', async () => {
		const { store, tb } = makeTaskboard();
		const judge = judgeOf(tb, store);
		try {
			await writeToolGuardLevel(store, 'manage-edit');
			assert.equal(tb.getCardActionLevel(), 'no-claim');
			assert.equal(
				judge({ toolName: 'taskboard_claim', heldCards: [] }).ok,
				false,
				'第一段永远先跑、完全不看 toolLevel',
			);
			assert.equal(judge({ toolName: 'taskboard_adopt', heldCards: [] }).ok, false);
		} finally {
			await tb.close();
		}
	});

	it('★ UI adopt 不会让 off 档去拦非领卡类工具', async () => {
		const { store, tb } = makeTaskboard();
		const judge = judgeOf(tb, store);
		try {
			await tb.setCardActionLevel('adopt');
			await writeToolGuardLevel(store, 'off');
			assert.ok(judge({ toolName: 'bash', heldCards: [] }).ok, 'off 档不拦任何工具');
			assert.ok(judge({ toolName: 'taskboard_claim', heldCards: [] }).ok);
		} finally {
			await tb.close();
		}
	});
});

/* ────────────────────────── 未领取档 / 策略真的参与判定 ────────────────────────── */

describe('三 scope 策略参与判定', () => {
	it('未领取档真的影响判定：manage 档下没有卡也能调；生效集含它', async () => {
		const { store, tb } = makeTaskboard();
		const judge = judgeOf(tb, store);
		try {
			await writeToolGuardLevel(store, 'manage');
			assert.equal(
				judge({ toolName: 'bash', heldCards: [] }).ok,
				false,
				'没配之前 bash 不该放行',
			);

			/* 用内置模板（core 启动时自动注册 18 个）当「指定工作卡」的模板名。 */
			const set = await tb.setToolPolicyScope({ tier: 'unclaimed', allow: ['bash'] });
			assert.equal(set.ok, true);

			assert.equal(judge({ toolName: 'bash', heldCards: [] }).ok, true);
			assert.ok(tb.effectiveToolsOf('writeCode').includes('bash'));
		} finally {
			await tb.close();
		}
	});
});

/* ────────────────────────── 脏值 ────────────────────────── */

describe('脏值：回落默认 + 警告，不抛错', () => {
	it('★ 垃圾值 ⇒ 回落默认值，警告一次并点明是哪个键', async () => {
		const store = createMemoryStore();
		await store.kvSet(GUARD_KEY, 'PLAN');

		const { warnings } = captureWarnings(() => readToolGuardLevelOf(store));
		assert.equal(warnings.length, 1, `应警告一次，实际：\n${warnings.join('\n')}`);
		assert.ok(
			warnings.some((one) => one.includes(GUARD_KEY)),
			`警告里应点明是哪个键：${warnings.join('\n')}`,
		);
		assert.equal(readToolGuardLevelOf(store), 'off', '脏值 ⇒ 回落默认');
	});

	it('非法值不抛错，回落默认（parseToolGuardLevel 返回 undefined）', async () => {
		const store = createMemoryStore();
		await store.kvSet(GUARD_KEY, '深入敌后');
		captureWarnings(() => readToolGuardLevelOf(store));
		assert.equal(readToolGuardLevelOf(store), 'off');
	});

	it('同一个脏值只告警一次（guard 热路径上不刷日志）', async () => {
		const store = createMemoryStore();
		await store.kvSet(GUARD_KEY, 'DIRTY_ONCE');
		const first = captureWarnings(() => readToolGuardLevelOf(store));
		const second = captureWarnings(() => readToolGuardLevelOf(store));
		assert.equal(first.warnings.length, 1, `第一次读应告警：\n${first.warnings.join('\n')}`);
		assert.equal(second.warnings.length, 0, '同一个值第二次读不该再告警');
		assert.equal(readToolGuardLevelOf(store), 'off', '告警去重不改变回落结果');
	});
});
