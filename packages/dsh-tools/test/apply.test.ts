/**
 * `apply()` 的测试 —— 注册面 / 失败回滚 / 清理时机。
 *
 * ## 为什么单独一个文件
 *
 * `tools.test.ts` 测的是**适配层契约**（假 `defineTool` + 逐个工具 `execute`）；
 * 本文件测的是**插件行的接线**：`ctx.tools.register` 被调用几次、顺序是什么、
 * 中途失败会不会留下半注册状态、`ctx.effect` 的 disposer 何时真正执行。
 *
 * ## 两条钉住的行为
 *
 * 1. **9 个工具、顺序 = `createTaskboardTools()` 的顺序**（顺序是 prompt 前缀的一部分，
 *    改顺序等于改契约）。
 * 2. **第 N 个 register 抛错 ⇒ 已注册的 N-1 个被回滚，原错误原样抛出**。
 *    没有回滚时插件激活失败，`ctx.effect` 根本不会被注册 ⇒ 前 N-1 个工具泄漏到 reload。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTaskboard, type Card, type CardStore, type Taskboard } from '@taskboard/core';

import { apply, type ApplyContext } from '../src/index.ts';

/* ────────────────────────────── 夹具 ────────────────────────────── */

/** 最小内存 store（`apply` 只把它当 kv / 卡后端用，不落盘）。 */
function createMemoryStore(): CardStore {
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
			/* 内存实现没有句柄要关。 */
		},
	};
}

/** 假 ctx 里能观察到的全部事件（按发生顺序）。 */
interface Recorder {
	readonly events: string[];
	readonly toolNames: string[];
	readonly effects: Array<{ readonly fn: () => (() => void); readonly label: string | undefined }>;
	readonly ctx: ApplyContext;
}

/**
 * 造一个假 ctx。
 *
 * @param taskboard 真实实例（`apply` 只把它塞进工具依赖，构建期不读它）
 * @param failAt 第几次 `register`（0 基）抛错；省略 = 全部成功
 */
function makeCtx(taskboard: Taskboard, failAt?: number): Recorder {
	const events: string[] = [];
	const toolNames: string[] = [];
	const effects: Recorder['effects'] = [];
	let registerIndex = 0;

	const ctx: ApplyContext = {
		taskboard3Core: taskboard,
		tools: {
			register(tool: unknown): () => void {
				const index = registerIndex;
				registerIndex += 1;
				if (index === failAt) {
					events.push(`register-fail:${index}`);
					throw new Error(`register failed at ${index}`);
				}
				const name = (tool as { readonly name?: unknown }).name;
				const label = typeof name === 'string' ? name : `#${index}`;
				toolNames.push(label);
				events.push(`register:${label}`);
				return () => {
					events.push(`dispose:${label}`);
				};
			},
		},
		get(): unknown {
			return undefined;
		},
		effect(fn: () => () => void, label?: string): void {
			effects.push({ fn, label });
			events.push(`effect:${label ?? ''}`);
		},
	};

	return { events, toolNames, effects, ctx };
}

/** 造一个真实实例（带内存 store）。 */
function makeTaskboard(): { readonly taskboard: Taskboard; readonly store: CardStore } {
	const store = createMemoryStore();
	return { taskboard: createTaskboard({ store }), store };
}

/** 9 个宿主无关工具的名字与顺序（= `createTaskboardTools()` 的注册顺序）。 */
const EXPECTED_TOOL_NAMES = [
	'taskboard_workspaces',
	'taskboard_cards',
	'taskboard_card',
	'taskboard_raw_card',
	'taskboard_definitions',
	'taskboard_create',
	'taskboard_update',
	'taskboard_update_note',
	'taskboard_transition',
] as const;

/* ────────────────────────────── 用例 ────────────────────────────── */

describe('apply：注册面', () => {
	it('注册 9 个工具，名字与顺序与 createTaskboardTools 一致', async () => {
		const { taskboard } = makeTaskboard();
		try {
			const recorder = makeCtx(taskboard);
			apply(recorder.ctx);
			assert.deepEqual(recorder.toolNames, [...EXPECTED_TOOL_NAMES]);
		} finally {
			await taskboard.close();
		}
	});

	it('effect 的 fn 被调用之前不清理；返回的 disposer 才真清理', async () => {
		const { taskboard } = makeTaskboard();
		try {
			const recorder = makeCtx(taskboard);
			apply(recorder.ctx);
			assert.equal(recorder.effects.length, 1, '应注册恰好一个 effect');

			/* `ctx.effect(execute)` 会立刻调用 fn，用它**返回**的函数做 disposer。 */
			const disposer = recorder.effects[0]?.fn();
			assert.equal(typeof disposer, 'function');
			assert.equal(
				recorder.events.some((one) => one.startsWith('dispose:')),
				false,
				'拿到 disposer 的那一刻不该清理任何工具',
			);

			disposer?.();
			const disposed = recorder.events.filter((one) => one.startsWith('dispose:'));
			assert.deepEqual(disposed, EXPECTED_TOOL_NAMES.map((name) => `dispose:${name}`));
		} finally {
			await taskboard.close();
		}
	});
});

describe('apply：失败回滚', () => {
	it('第 3 个 register 抛错 ⇒ 前 2 个被回滚，原错误原样抛出', async () => {
		const { taskboard } = makeTaskboard();
		try {
			const recorder = makeCtx(taskboard, 2);
			assert.throws(() => apply(recorder.ctx), /register failed at 2/);

			assert.deepEqual(recorder.toolNames, [...EXPECTED_TOOL_NAMES.slice(0, 2)]);
			const disposed = recorder.events.filter((one) => one.startsWith('dispose:'));
			assert.deepEqual(disposed, [
				`dispose:${EXPECTED_TOOL_NAMES[0]}`,
				`dispose:${EXPECTED_TOOL_NAMES[1]}`,
			]);
			/* 抛错发生在 effect 注册之前 ⇒ 不能留下一个「清理已注册工具」的 effect。 */
			assert.equal(recorder.effects.length, 0, '注册失败时不该注册 effect');
		} finally {
			await taskboard.close();
		}
	});
});
