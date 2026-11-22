/**
 * 两条正交轴的**档位持久化**测试。
 *
 * ```
 * kv  taskboard.permission.cardActionLevel   no-claim | claim | adopt        （默认 no-claim）
 * kv  taskboard.permission.toolGuardLevel    off | manage | manage-edit     （默认 off）
 * ```
 *
 * 档位存在 core 的实例上（内存缓存 + kv 落盘），**由 `taskboard.judgeToolCall` 自己读** ——
 * 调用方只给 `toolName` / `heldCards`。本文件锁住四件事：
 *
 * 1. 默认值（`no-claim` + `off`）下 `claim` 被拒、其它非领卡类工具放行；
 * 2. 写后读（实例状态立即生效）；
 * 3. 持久化（新建实例读得到）；
 * 4. 脏值 ⇒ 回落默认 + `console.warn`，**不抛错**。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
	CARD_ACTION_OPTIONS,
	TOOL_GUARD_OPTIONS,
	createSqliteStore,
	createTaskboard,
	type Taskboard,
} from '../src/index.ts';

/** kv 键（与 core 实现一致；这里是"外部世界怎么弄脏它"的入口）。 */
const CARD_KEY = 'taskboard.permission.cardActionLevel';
const GUARD_KEY = 'taskboard.permission.toolGuardLevel';

/** 临时目录 + 一个实例。调用方负责 `tb.close()` 和 `rmSync(dir)`。 */
function makeTaskboard(prefix = 'tb3-levels-'): { readonly dir: string; readonly tb: Taskboard } {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	return { dir, tb: createTaskboard({ dataDir: dir }) };
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

/* ────────────────────────── 选项常量（UI / HTTP 路由的唯一真值） ────────────────────────── */

describe('档位选项常量：给 UI / HTTP 路由用', () => {
	it('CARD_ACTION_OPTIONS：三档、顺序、文案齐全', () => {
		assert.deepEqual(
			CARD_ACTION_OPTIONS.map((one) => one.value),
			['no-claim', 'claim', 'adopt'],
		);
		for (const option of CARD_ACTION_OPTIONS) {
			/*
			 * `!== ''` 在这里是**类型层无意义**的比较：`option.label` 的类型是
			 * 三个文案的字面量联合，和 `''` 没有重叠 ⇒ tsc 报 TS2367。
			 * 语义上要的是「非空」，用 `.length > 0` 表达 —— 运行时等价，
			 * 类型层也成立（不靠缩小类型让编译器闭嘴）。
			 */
			assert.ok(option.label.length > 0, `${option.value} 缺 label`);
			assert.ok(option.description.length > 0, `${option.value} 缺 description`);
		}
	});

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

/* ────────────────────────── 默认值 ────────────────────────── */

describe('默认档位', () => {
	it('未配置时 cardActionLevel=no-claim、toolGuardLevel=off', async () => {
		const { dir, tb } = makeTaskboard();
		try {
			assert.equal(tb.getCardActionLevel(), 'no-claim');
			assert.equal(tb.getToolGuardLevel(), 'off');
		} finally {
			await tb.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('★ 默认档位下：claim 拒、adopt 拒、其它非领卡类工具放行', async () => {
		const { dir, tb } = makeTaskboard();
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
				assert.ok(tb.judgeToolCall({ toolName, heldCards: [] }).ok, `${toolName} 在默认 off 下应放行`);
			}

			/* 第一段：UI 轴默认 no-claim ⇒ 领卡类动作被拒。 */
			assert.equal(
				tb.judgeToolCall({ toolName: 'taskboard_claim', heldCards: [] }).ok,
				false,
				'默认 no-claim ⇒ claim 必须拒',
			);
			assert.equal(
				tb.judgeToolCall({ toolName: 'taskboard_claim', heldCards: [{ templateRef: 'writeCode' }] }).ok,
				false,
				'有卡也不放开领卡（档位是全局状态）',
			);
			assert.equal(
				tb.judgeToolCall({ toolName: 'taskboard_adopt', heldCards: [] }).ok,
				false,
				'默认 no-claim ⇒ adopt 也必须拒',
			);

			/* 放手永远允许。 */
			assert.ok(tb.judgeToolCall({ toolName: 'taskboard_release', heldCards: [] }).ok);
		} finally {
			await tb.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

/* ────────────────────────── 写后读 + 立即影响判定 ────────────────────────── */

describe('写后读', () => {
	it('setCardActionLevel 写后读：三档都能设', async () => {
		const { dir, tb } = makeTaskboard();
		try {
			for (const level of ['claim', 'adopt', 'no-claim'] as const) {
				await tb.setCardActionLevel(level);
				assert.equal(tb.getCardActionLevel(), level);
			}
		} finally {
			await tb.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('setToolGuardLevel 写后读：三档都能设', async () => {
		const { dir, tb } = makeTaskboard();
		try {
			for (const level of ['manage', 'manage-edit', 'off'] as const) {
				await tb.setToolGuardLevel(level);
				assert.equal(tb.getToolGuardLevel(), level);
			}
		} finally {
			await tb.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('★ 档位改动立即反映到 judgeToolCall（不需要重建实例）', async () => {
		const { dir, tb } = makeTaskboard();
		try {
			const judge = (toolName: string): boolean => tb.judgeToolCall({ toolName, heldCards: [] }).ok;

			/* 默认：both off / no-claim。 */
			assert.ok(judge('bash'));
			assert.equal(judge('taskboard_claim'), false);

			/* 宿主轴 → manage：无卡的非 BASE 工具被拒，但领卡判定不受影响。 */
			await tb.setToolGuardLevel('manage');
			assert.equal(judge('bash'), false, 'manage + 无卡 ⇒ bash 拒');
			assert.ok(judge('taskboard_cards'), 'BASE 工具不需要卡');
			assert.equal(judge('taskboard_claim'), false, 'UI 轴仍是 no-claim');

			/* 宿主轴 → manage-edit：权限管理工具放开。 */
			await tb.setToolGuardLevel('manage-edit');
			assert.ok(judge('taskboard_tool_policy'));

			/* UI 轴 → claim：能领卡但还不能采纳。 */
			await tb.setCardActionLevel('claim');
			assert.ok(judge('taskboard_claim'));
			assert.equal(judge('taskboard_adopt'), false);

			/* UI 轴 → adopt：采纳也放开。 */
			await tb.setCardActionLevel('adopt');
			assert.ok(judge('taskboard_adopt'));
		} finally {
			await tb.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

/* ────────────────────────── 持久化 ────────────────────────── */

describe('持久化（落 kv）', () => {
	it('★ 写后新建实例，两个档位都还在，且判定沿用', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-levels-persist-'));
		try {
			const first = createTaskboard({ dataDir: dir });
			await first.setCardActionLevel('adopt');
			await first.setToolGuardLevel('manage-edit');
			await first.close();

			const second = createTaskboard({ dataDir: dir });
			try {
				assert.equal(second.getCardActionLevel(), 'adopt');
				assert.equal(second.getToolGuardLevel(), 'manage-edit');

				/* 判定确实用了落盘的档位。 */
				assert.ok(second.judgeToolCall({ toolName: 'taskboard_claim', heldCards: [] }).ok);
				assert.ok(second.judgeToolCall({ toolName: 'taskboard_adopt', heldCards: [] }).ok);
				assert.ok(second.judgeToolCall({ toolName: 'taskboard_tool_policy', heldCards: [] }).ok);
			} finally {
				await second.close();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('两个键互相独立：只改一个，另一个保持默认', async () => {
		const { dir, tb } = makeTaskboard();
		try {
			await tb.setToolGuardLevel('manage');
			assert.equal(tb.getToolGuardLevel(), 'manage');
			assert.equal(tb.getCardActionLevel(), 'no-claim', '改宿主轴不该动 UI 轴');
		} finally {
			await tb.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

/* ────────────────────────── 脏值 ────────────────────────── */

describe('脏值：回落默认 + 警告，不抛错', () => {
	it('★ 两个键都是垃圾值 ⇒ 回落默认值，各警告一次', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-levels-dirty-'));
		try {
			const store = createSqliteStore(dir);
			await store.kvSet(CARD_KEY, 'garbage');
			await store.kvSet(GUARD_KEY, 'PLAN');

			const { result: tb, warnings } = captureWarnings(() => createTaskboard({ store }));
			try {
				assert.equal(tb.getCardActionLevel(), 'no-claim', '脏值 ⇒ 回落默认');
				assert.equal(tb.getToolGuardLevel(), 'off', '脏值 ⇒ 回落默认');

				assert.equal(warnings.length, 2, `应警告两次，实际：\n${warnings.join('\n')}`);
				assert.ok(
					warnings.some((one) => one.includes(CARD_KEY)),
					`警告里应点明是哪个键：${warnings.join('\n')}`,
				);
				assert.ok(
					warnings.some((one) => one.includes(GUARD_KEY)),
					`警告里应点明是哪个键：${warnings.join('\n')}`,
				);

				/* 回落后的判定按默认档位走。 */
				assert.equal(tb.judgeToolCall({ toolName: 'taskboard_claim', heldCards: [] }).ok, false);
				assert.ok(tb.judgeToolCall({ toolName: 'bash', heldCards: [] }).ok);
			} finally {
				await tb.close();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('只有一个键是脏值 ⇒ 另一个合法值照常生效', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tb3-levels-dirty2-'));
		try {
			const store = createSqliteStore(dir);
			await store.kvSet(CARD_KEY, '深入敌后'); // 脏
			await store.kvSet(GUARD_KEY, 'manage'); // 合法

			const { result: tb, warnings } = captureWarnings(() => createTaskboard({ store }));
			try {
				assert.equal(tb.getCardActionLevel(), 'no-claim');
				assert.equal(tb.getToolGuardLevel(), 'manage');
				assert.equal(warnings.length, 1, warnings.join('\n'));
			} finally {
				await tb.close();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

