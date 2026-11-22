/**
 * `apply()` 的**生命周期契约** —— 插件注册的东西，卸载时才该消失。
 *
 * ## 这个测试存在的理由（2026-11-22 实测踩到的真 bug）
 *
 * 我们原来写的是：
 *
 * ```ts
 * ctx.effect(disposeAll, 'taskboard3: routes / tools / commands');
 * ```
 *
 * 但 Cordis 的 `ctx.effect(execute)` 语义是：
 *
 * ```js
 * // cordis/lib/index.js:435
 * const effect = runner.execute.call(this);
 * if (typeof effect === "function") return runner.collect(effect);
 * ```
 *
 * **`execute` 会被立即调用，它的返回值才被收作 disposer。**
 *
 * ⇒ 我们把「清理函数」当「要执行的工厂」传进去 ⇒ **`disposeAll` 被立即调用**
 * ⇒ 它里面 `disposeRoutes()` 把刚注册的路由删掉、`disposeTools` 把 11 个 AI 工具删掉。
 *
 * **症状**：插件「看起来激活了」，但所有 HTTP 路由 404（body 为空），
 * 11 个 AI 工具也全部没注册。这个 bug 在 desktop profile 里可能被别的因素掩盖，
 * 直到在**隔离 profile**（只装 base + web-app）里才暴露出来。
 *
 * ⇒ 下面的断言钉住「apply 之后注册的东西还在」和「disposer 被收集起来了」。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apply } from '../src/index.ts';

/** 记一次注册 / 反注册。 */
interface Event {
	readonly what: string;
	readonly detail: string;
}

/** 造一个最小的假 store —— 只要 `createTaskboard` 能跑起来即可。 */
function fakeStore(): Record<string, unknown> {
	const memory = new Map<string, string>();
	return {
		kvGet: (key: string) => memory.get(key),
		kvSet: async (key: string, value: string) => {
			memory.set(key, value);
		},
		kvDelete: async (key: string) => {
			memory.delete(key);
		},
		loadWorkspaces: () => [],
		saveWorkspaces: async () => undefined,
		readCards: () => [],
		writeCard: async () => undefined,
		deleteCard: async () => undefined,
	};
}

/**
 * 造一个**符合 Cordis 语义**的假 ctx。
 *
 * ⚠ `effect(execute)` 必须**立即调用 `execute`**、把返回值收作 disposer ——
 *   这正是被测契约的核心，不能图省事直接存起来。
 *
 * @returns ctx + 事件日志 + 收集到的 disposer
 */
function fakeCtx(): {
	readonly ctx: Record<string, unknown>;
	readonly events: Event[];
	readonly disposers: (() => void)[];
} {
	const events: Event[] = [];
	const disposers: (() => void)[] = [];

	const ctx = {
		webServer: {
			register(route: { kind: string; path: string }): () => void {
				events.push({ what: 'route+', detail: `${route.kind} ${route.path}` });
				return () => {
					events.push({ what: 'route-', detail: `${route.kind} ${route.path}` });
				};
			},
		},
		connection: {},
		tools: {
			guard(): () => void {
				events.push({ what: 'guard+', detail: '' });
				return () => {
					events.push({ what: 'guard-', detail: '' });
				};
			},
			register(tool: { name: string }): () => void {
				events.push({ what: 'tool+', detail: tool.name });
				return () => {
					events.push({ what: 'tool-', detail: tool.name });
				};
			},
		},
		commands: {
			register(command: { name: string }): () => void {
				events.push({ what: 'command+', detail: command.name });
				return () => {
					events.push({ what: 'command-', detail: command.name });
				};
			},
		},
		taskboard3Store: fakeStore(),
		/* subagents 缺席（隔离 profile 的真实情况）—— 代码必须能容忍。 */
		get: () => undefined,
		effect(execute: () => unknown): void {
			const disposer = execute();
			events.push({ what: 'effect', detail: typeof disposer });
			if (typeof disposer === 'function') disposers.push(disposer as () => void);
		},
	};

	return { ctx, events, disposers };
}

describe('apply() 的生命周期契约', () => {
	it('⭐ apply 之后 HTTP 路由**仍然注册着**（不是注册完就被自己删掉）', () => {
		const { ctx, events } = fakeCtx();
		apply(ctx as never, {});

		const added = events.filter((one) => one.what === 'route+');
		const removed = events.filter((one) => one.what === 'route-');

		assert.equal(added.length, 1, 'apply 应该注册 1 条路由');
		assert.equal(removed.length, 0, `⚠ apply 期间不该反注册路由（实际反注册 ${String(removed.length)} 次）`);
		assert.equal(added[0]?.detail, 'prefix /taskboard3');
	});

	it('⭐ apply 之后 AI 工具**仍然注册着**', () => {
		const { ctx, events } = fakeCtx();
		apply(ctx as never, {});

		const added = events.filter((one) => one.what === 'tool+').length;
		const removed = events.filter((one) => one.what === 'tool-').length;

		assert.ok(added > 0, 'apply 应该注册至少一个 AI 工具');
		assert.equal(removed, 0, `⚠ apply 期间不该反注册工具（实际反注册 ${String(removed)} 个）`);
	});

	it('⭐ `ctx.effect` 的 execute 被立即调用，返回值被收作 disposer', () => {
		const { ctx, events, disposers } = fakeCtx();
		apply(ctx as never, {});

		const effect = events.find((one) => one.what === 'effect');
		assert.notEqual(effect, undefined, 'apply 应该调 ctx.effect');
		assert.equal(effect?.detail, 'function', '传给 effect 的 execute 必须**返回** disposer');
		assert.equal(disposers.length, 1, 'disposer 应该被收集起来');
	});

	it('⭐ 调 disposer 之后，路由和工具才被反注册（卸载语义）', () => {
		const { ctx, events, disposers } = fakeCtx();
		apply(ctx as never, {});

		/* apply 之后什么都没反注册。 */
		assert.equal(events.filter((one) => one.what === 'route-').length, 0);

		/* 手动调 disposer 模拟插件卸载。 */
		for (const dispose of disposers) dispose();

		assert.equal(events.filter((one) => one.what === 'route-').length, 1, 'disposer 应反注册路由');
		assert.ok(events.filter((one) => one.what === 'tool-').length > 0, 'disposer 应反注册工具');
	});

	it('⚠ subagents 缺席时也能跑（隔离 profile 的真实情况）', () => {
		const { ctx } = fakeCtx();
		/* fakeCtx 的 get() 恒返回 undefined ⇒ subagents 是 undefined。 */
		assert.doesNotThrow(() => {
			apply(ctx as never, {});
		});
	});
});
