/**
 * UI 轴（`CardActionLevel`）的**档位持久化**测试 —— core 侧。
 *
 * ```
 * kv  taskboard.permission.cardActionLevel   no-claim | claim | adopt   （默认 no-claim）
 * ```
 *
 * ## ⚠ 本文件只剩 UI 轴（`2026-11-23`）
 *
 * 用户裁决：「权限，一个在 core 的 ui 里面。一个在 agent ui 里面，core 完全不知道
 * 也不干涉 agent 的那一侧的注入权限。」
 *
 * ⇒ agent 侧那套（`ToolGuardLevel` / `readToolGuardLevelOf` / `writeToolGuardLevel` /
 *   `judgeToolCall`）已搬到 `@taskboard/dsh-tools`，**它的档位与判定测试也跟着搬走了**
 *   （`packages/dsh-tools/test/tool-guard.test.ts`）。
 *
 * ⇒ **core 的测试不许 import `@taskboard/dsh-tools`** —— 依赖方向是
 *   `dsh-tools → core`，反向 import 会让 `tsc -b` 的项目引用成环。这也是「搬家」
 *   而不是「改 import」的原因：搬走的不只是实现，还有它们的测试。
 *
 * 本文件锁住的四件事：
 *
 * 1. 选项常量（UI / HTTP 路由的唯一真值）；
 * 2. 默认值 `no-claim`；
 * 3. 写后读 + 持久化（新建实例从同一 store 读回）；
 * 4. 脏值 ⇒ 回落默认 + `console.warn`，**不抛错**。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CARD_ACTION_OPTIONS, createTaskboard, type Taskboard } from '../src/index.ts';
import { createMemoryStore } from './memory-store.ts';

/** kv 键（与 core 实现一致；这里是"外部世界怎么弄脏它"的入口）。 */
const CARD_KEY = 'taskboard.permission.cardActionLevel';

/** 造一个实例 + 它的 store（不碰磁盘：测试只用内存实现）。 */
function makeTaskboard(): { readonly store: ReturnType<typeof createMemoryStore>; readonly tb: Taskboard } {
	const store = createMemoryStore();
	return { store, tb: createTaskboard({ store }) };
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
});

/* ────────────────────────── 默认值 ────────────────────────── */

describe('默认档位', () => {
	it('未配置时 cardActionLevel=no-claim', async () => {
		const { tb } = makeTaskboard();
		try {
			assert.equal(tb.getCardActionLevel(), 'no-claim');
		} finally {
			await tb.close();
		}
	});
});

/* ────────────────────────── 写后读 ────────────────────────── */

describe('写后读', () => {
	it('setCardActionLevel 写后读：三档都能设', async () => {
		const { tb } = makeTaskboard();
		try {
			for (const level of ['claim', 'adopt', 'no-claim'] as const) {
				await tb.setCardActionLevel(level);
				assert.equal(tb.getCardActionLevel(), level);
			}
		} finally {
			await tb.close();
		}
	});
});

/* ────────────────────────── 持久化 ────────────────────────── */

describe('持久化（落 kv）', () => {
	it('★ 写后新建实例，档位还在', async () => {
		/*
		 * ⚠ **共用同一个 store 实例** —— 这条测的是「core 把档位写进端口、
		 *   新实例从同一端口读回」。内存 store 每次 new 一个就是空库，
		 *   那样测的就不是持久化，而是「新库」（当然读不到）。
		 *
		 *   SQLite 的**真落盘**（关库再开仍在）由 `@taskboard/io` 自己的
		 *   测试负责 —— 那是实现的事，不是端口语义的事。
		 */
		const shared = createMemoryStore();
		const first = createTaskboard({ store: shared });
		await first.setCardActionLevel('adopt');
		await first.close();

		const second = createTaskboard({ store: shared });
		try {
			assert.equal(second.getCardActionLevel(), 'adopt');
		} finally {
			await second.close();
		}
	});
});

/* ────────────────────────── 脏值 ────────────────────────── */

describe('脏值：回落默认 + 警告，不抛错', () => {
	it('★ 垃圾值 ⇒ 回落默认值，警告一次并点明是哪个键', async () => {
		/*
		 * 用内存 store：这条测的是「core 读到脏 kv 怎么反应」，
		 * 不是「SQLite 怎么写」。写脏值只要有 kvSet 就行。
		 */
		const store = createMemoryStore();
		await store.kvSet(CARD_KEY, 'garbage');

		const { result: tb, warnings } = captureWarnings(() => createTaskboard({ store, builtinTemplates: false }));
		try {
			assert.equal(tb.getCardActionLevel(), 'no-claim', '脏值 ⇒ 回落默认');

			assert.equal(warnings.length, 1, `应警告一次，实际：\n${warnings.join('\n')}`);
			assert.ok(
				warnings.some((one) => one.includes(CARD_KEY)),
				`警告里应点明是哪个键：${warnings.join('\n')}`,
			);
		} finally {
			await tb.close();
		}
	});
});
