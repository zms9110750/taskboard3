/**
 * `apply()` 的**生命周期契约** —— 插件注册的东西，卸载时才该消失。
 *
 * ## 这个测试存在的理由（2026-11-23 实测踩到的真 bug）
 *
 * 我们原来写的是：
 *
 * ```ts
 * ctx.effect(disposeAll, 'taskboard3: routes / tools / commands');
 * ```
 *
 * Cordis 的 `ctx.effect(execute)` 语义是：
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
 * ⇒ 它里面 `disposeRoutes()` 把刚注册的路由删掉。
 *
 * **症状**：插件「看起来激活了」，但所有 HTTP 路由 404（body 为空）。
 *
 * ## 拆分后的结构（`2026-11-23`）
 *
 * ```
 * @taskboard/dsh-core   建实例，provide('taskboard3Core')      ← 不注册任何东西
 * @taskboard/dsh        HTTP 路由 + 斜杠命令                    ← 本文件测这个
 * @taskboard/dsh-tools  11 个 AI 工具 + 权限 guard              ← 见 dsh-tools/test/
 * @taskboard/dsh-client 浏览器 UI
 * ```
 *
 * ## ⚠ 为什么命令**没有**单独的 disposer
 *
 * `ctx.commands.register()` 是在 `apply` 里调的 —— **Cordis 按 fiber 所有权
 * 自动清理**它，删除时机是插件卸载。所以本包只手工持有**路由**的 disposer
 * （`webServer.register` 返回它，且路由挂着长连接，顺序有意义）。
 *
 * ⇒ 断言里「命令被 disposer 反注册」是**错的期望**，真实的清理路径是
 *   Cordis 卸载插件。本文件用 `command+` 只断言「注册了 3 个」，不断言 disposer 删它。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apply } from '../src/index.ts';

/** 记一次注册 / 反注册。 */
interface Event {
	readonly what: string;
	readonly detail: string;
}

/**
 * 造一个 **`@taskboard/dsh-core` 提供的实例替身**。
 *
 * ⚠ 不用真 `Taskboard`：本文件测的是「注册了几个东西、卸载时删没删」，
 *   不是业务语义。用真实例要造 store + 18 个模板，和契约无关。
 */
function fakeTaskboard(): Record<string, unknown> {
	return {
		listWorkspaces: () => [],
		ensureAnyWorkspace: async () => ({ id: 'ws1' }),
		list: () => [],
		listTemplates: () => [],
		templateErrors: () => [],
		templates: () => ({
			register: () => () => {},
			registerAll: () => () => {},
			errors: () => [],
		}),
		close: async () => undefined,
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
		commands: {
			/*
			 * ⚠ 返回 disposer，但**产品代码不持有它** —— 命令的清理归 Cordis
			 *   的 fiber 所有权。这里返回 disposer 只是为了记录「注册了」。
			 */
			register(command: { name: string }): () => void {
				events.push({ what: 'command+', detail: command.name });
				return () => {
					events.push({ what: 'command-', detail: command.name });
				};
			},
		},
		/* `@taskboard/dsh-core` 提供的实例（不是 store）。 */
		taskboard3Core: fakeTaskboard(),
		/* `@taskboard/dsh-core` 提供的总线（⚠ 原型期脚手架）。 */
		taskboard3Bus: {
			on: () => () => {},
			emit: () => {},
			size: () => 0,
			close: () => {},
		},
		effect(execute: () => unknown): void {
			const disposer = execute();
			events.push({ what: 'effect', detail: typeof disposer });
			if (typeof disposer === 'function') disposers.push(disposer as () => void);
		},
	};

	return { ctx, events, disposers };
}

describe('apply() 的生命周期契约（@taskboard/dsh = HTTP + 命令）', () => {
	it('⭐ apply 之后 HTTP 路由**仍然注册着**（不是注册完就被自己删掉）', () => {
		const { ctx, events } = fakeCtx();
		apply(ctx as never, {});

		const added = events.filter((one) => one.what === 'route+');
		const removed = events.filter((one) => one.what === 'route-');

		assert.equal(added.length, 1, 'apply 应该注册 1 条路由');
		assert.equal(removed.length, 0, `⚠ apply 期间不该反注册路由（实际反注册 ${String(removed.length)} 次）`);
		assert.equal(added[0]?.detail, 'prefix /taskboard3');
	});

	it('⭐ apply 之后斜杠命令**仍然注册着**', () => {
		const { ctx, events } = fakeCtx();
		apply(ctx as never, {});

		const names = events.filter((one) => one.what === 'command+').map((one) => one.detail);
		assert.deepEqual(names, ['taskboard', 'task-card', 'task-create']);
	});

	it('⭐ 本包**不注册 AI 工具、不加 guard**（那些在 @taskboard/dsh-tools 里）', () => {
		const { ctx, events } = fakeCtx();
		apply(ctx as never, {});

		/* 假 ctx 里根本没给 `tools` 服务 —— 如果本包还碰它就会抛。 */
		assert.equal(events.filter((one) => one.what === 'tool+').length, 0, '本包不该注册工具');
		assert.equal(events.filter((one) => one.what === 'guard+').length, 0, '本包不该加 guard');
	});

	it('⭐ `ctx.effect` 的 execute 被立即调用，返回值被收作 disposer', () => {
		const { ctx, events, disposers } = fakeCtx();
		apply(ctx as never, {});

		const effect = events.find((one) => one.what === 'effect');
		assert.notEqual(effect, undefined, 'apply 应该调 ctx.effect');
		assert.equal(effect?.detail, 'function', '传给 effect 的 execute 必须**返回** disposer');
		assert.equal(disposers.length, 1, 'disposer 应该被收集起来');
	});

	it('⭐ 调 disposer 之后路由才被反注册（卸载语义）', () => {
		const { ctx, events, disposers } = fakeCtx();
		apply(ctx as never, {});

		/* apply 之后什么都没反注册。 */
		assert.equal(events.filter((one) => one.what === 'route-').length, 0);

		/* 手动调 disposer 模拟插件卸载。 */
		for (const dispose of disposers) dispose();

		assert.equal(events.filter((one) => one.what === 'route-').length, 1, 'disposer 应反注册路由');
		/*
		 * ⚠ 命令**不在**这个 disposer 的职责里 —— 它们在 `apply` 里注册，
		 *   由 Cordis 的 fiber 所有权在卸载时清理（见文件头）。
		 */
	});

	it('⚠ 没有 `subagents` 服务时也能跑（隔离 profile 的真实情况）', () => {
		const { ctx } = fakeCtx();
		/* 假 ctx 里没有 subagents ⇒ 本包也不再读它（工具面搬走了）。 */
		assert.doesNotThrow(() => {
			apply(ctx as never, {});
		});
	});
});
