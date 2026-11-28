/**
 * `apply()` 的测试 —— **这一层以前零覆盖**。
 *
 * ## 为什么需要它
 *
 * `apply()` 是插件行的接线：`inject` 清单、`provide` 的服务面、guard 与两个工具的
 * 注册 / 卸载顺序、`ctx.inject` 的 DI cell。这些错了**不会编译失败**：
 *
 * · 少列一个 `inject` ⇒ profile 启动只是 `dsh: warning: 1 entry did not activate`，
 *   功能静默消失；
 * · 卸载先清工具再摘 guard ⇒ 卸载过程中还有一次按旧档位判定的机会；
 * · DI cell 没接上 ⇒ holder 为空（无卡），权限判定静默按「没领卡」走。
 *
 * ## 用假 ctx 的理由
 *
 * 本包只依赖 `ApplyContext` 声明的那几个字段（`taskboard3Core` / `taskboard3Store` /
 * `tools` / `inject` / `effect` / `provide`）。假 ctx 能把「调用顺序」记下来，
 * 而真 Cordis 上下文不会告诉你 disposer 是第几个跑的。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createTaskboard, type Card, type CardStore, type Taskboard } from '@taskboard/core';
import { TaskState } from '@taskboard/protocol';

import {
	AGENT_GUARD_SERVICE,
	apply,
	inject,
	type AgentGuardService,
	type ApplyContext,
} from '../src/index.ts';
import type { ToolGuardKv } from '../src/tool-guard.ts';

/* ────────────────────────────── 夹具 ────────────────────────────── */

/** 最小内存 store（同时是 `taskboard3Store` 的 kv 端口）。 */
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
			/* 内存实现没有句柄要关。 */
		},
	};
}

/** 假 ctx 记录下来的全部事件。 */
interface Recorder {
	readonly events: string[];
	readonly toolNames: string[];
	readonly guardFns: Array<(exec: unknown) => unknown>;
	readonly effects: Array<{ readonly fn: () => (() => void); readonly label: string | undefined }>;
	readonly injectCalls: Array<{
		readonly deps: readonly string[];
		readonly callback: (scope: { readonly [service: string]: unknown }) => (() => void) | void;
	}>;
	readonly provided: Map<string, unknown>;
	readonly ctx: ApplyContext;
}

/** 造一个假 ctx（只声明 `apply` 真正用到的字段）。 */
function makeCtx(taskboard: Taskboard, store: ToolGuardKv): Recorder {
	const events: string[] = [];
	const toolNames: string[] = [];
	const guardFns: Recorder['guardFns'] = [];
	const effects: Recorder['effects'] = [];
	const injectCalls: Recorder['injectCalls'] = [];
	const provided = new Map<string, unknown>();

	const ctx: ApplyContext = {
		taskboard3Core: taskboard,
		taskboard3Store: store,
		tools: {
			register(tool: unknown): () => void {
				const name = (tool as { readonly name?: unknown }).name;
				const label = typeof name === 'string' ? name : 'unnamed';
				toolNames.push(label);
				events.push(`register:${label}`);
				return () => {
					events.push(`dispose-tool:${label}`);
				};
			},
			guard(fn: (exec: unknown) => unknown): () => void {
				guardFns.push(fn);
				events.push('guard');
				return () => {
					events.push('dispose-guard');
				};
			},
			schemas(): unknown[] {
				return [{ name: 'bash', description: 'shell', parameters: {} }];
			},
		},
		get(): unknown {
			return undefined;
		},
		webServer: {
			register(): () => void {
				/* `apply` 已不挂路由（/api/tools 走 dsh 的 prefix handler），这里只为满足类型。 */
				return () => undefined;
			},
		},
		inject(
			deps: readonly string[],
			callback: (scope: { readonly [service: string]: unknown }) => (() => void) | void,
		): void {
			injectCalls.push({ deps, callback });
			events.push(`inject:${deps.join(',')}`);
		},
		provide(serviceName: string, api: unknown): void {
			provided.set(serviceName, api);
			events.push(`provide:${serviceName}`);
		},
		effect(fn: () => () => void, label?: string): void {
			effects.push({ fn, label });
			events.push(`effect:${label ?? ''}`);
		},
	};

	return { events, toolNames, guardFns, effects, injectCalls, provided, ctx };
}

/** 造一个真实实例（带内存 store）。 */
function makeTaskboard(): { readonly taskboard: Taskboard; readonly store: CardStore & ToolGuardKv } {
	const store = createMemoryStore();
	return { taskboard: createTaskboard({ store }), store };
}

/** 假响应（`handleTools` 只需要这三个成员）。 */
interface FakeRes {
	statusCode: number;
	readonly headers: Record<string, string>;
	body: string | undefined;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
}

function fakeRes(): FakeRes {
	return {
		statusCode: 0,
		headers: {},
		body: undefined,
		setHeader(name: string, value: string): void {
			this.headers[name] = value;
		},
		end(body?: string): void {
			this.body = body;
		},
	};
}

/** 等一轮微任务 / 宏任务（fire-and-forget 的 then 跑完）。 */
const tick = async (): Promise<void> => {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
};

/** 造一个 `exec`（工具执行上下文的最小替身）。 */
function exec(name: string, agentId: string): unknown {
	return { agent: { id: agentId }, name };
}

/** 建一张 work 卡并推进到「处理中」（领取）。 */
async function claimedWorkCard(
	taskboard: Taskboard,
	workspaceId: string,
	title: string,
	holder: string,
): Promise<string> {
	const template = taskboard.listTemplates().find((one) => one.kind === 'work');
	assert.notEqual(template, undefined, '应当存在 work 模板');
	const created = await taskboard.create({
		workspaceId,
		templateRef: template?.ref ?? '',
		title,
		actor: 'user',
	});
	if (!created.ok) throw new Error(created.message);
	const cardId = created.card.id;
	const adopted = await taskboard.transition(workspaceId, cardId, TaskState.SUBMITTED, 'button');
	assert.equal(adopted.ok, true, adopted.ok ? '' : adopted.message);
	const claimed = await taskboard.claim(workspaceId, cardId, 'ai', holder);
	assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.message);
	return cardId;
}

/** 取第一个空间；没有就建一个（`createWorkspace` 是幂等满足的）。 */
async function ensureWorkspace(taskboard: Taskboard): Promise<string> {
	const existing = taskboard.listWorkspaces(false)[0];
	if (existing !== undefined) return existing.id;
	const created = await taskboard.createWorkspace('apply 测试');
	if (!created.ok) throw new Error(created.message);
	return created.workspace.id;
}

/* ────────────────────────────── 用例 ────────────────────────────── */

describe('apply：服务与注册面', () => {
	it('inject 列 3 个必需服务；provide 只暴露 AGENT_GUARD_SERVICE', async () => {
		const { taskboard, store } = makeTaskboard();
		try {
			assert.deepEqual([...inject], ['taskboard3Core', 'taskboard3Store', 'tools']);

			const recorder = makeCtx(taskboard, store);
			apply(recorder.ctx);

			assert.deepEqual([...recorder.provided.keys()], [AGENT_GUARD_SERVICE]);
			const service = recorder.provided.get(AGENT_GUARD_SERVICE) as AgentGuardService | undefined;
			assert.notEqual(service, undefined);
			assert.equal(typeof service?.readLevel, 'function');
			assert.equal(typeof service?.writeLevel, 'function');
			assert.equal(typeof service?.isManageEdit, 'function');
			assert.equal(typeof service?.handleTools, 'function');

			/* 三档位经服务写、经服务读 —— `isManageEdit` 是同一份判定的唯一出口。 */
			assert.equal(service?.readLevel(), 'off');
			await service?.writeLevel('manage-edit');
			assert.equal(service?.readLevel(), 'manage-edit');
			assert.equal(service?.isManageEdit(), true);
		} finally {
			await taskboard.close();
		}
	});

	it('注册 2 个策略工具；guard 先挂、disposer 先摘 guard 再清工具', async () => {
		const { taskboard, store } = makeTaskboard();
		try {
			const recorder = makeCtx(taskboard, store);
			apply(recorder.ctx);

			assert.deepEqual(recorder.toolNames, ['taskboard_tool_policy', 'taskboard_tool_policy_read']);
			assert.ok(
				recorder.events.indexOf('guard') < recorder.events.indexOf('register:taskboard_tool_policy'),
				'guard 必须先于工具挂上',
			);

			assert.equal(recorder.effects.length, 1, '应注册恰好一个 effect');
			const disposer = recorder.effects[0]?.fn();
			assert.equal(typeof disposer, 'function');
			assert.equal(
				recorder.events.some((one) => one.startsWith('dispose-')),
				false,
				'拿到 disposer 的那一刻不该卸载任何东西',
			);

			disposer?.();
			assert.deepEqual(recorder.events.slice(-3), [
				'dispose-guard',
				'dispose-tool:taskboard_tool_policy',
				'dispose-tool:taskboard_tool_policy_read',
			]);
		} finally {
			await taskboard.close();
		}
	});

	it('handleTools 走服务暴露的清单（provide 面可用）', async () => {
		const { taskboard, store } = makeTaskboard();
		try {
			const recorder = makeCtx(taskboard, store);
			apply(recorder.ctx);
			const service = recorder.provided.get(AGENT_GUARD_SERVICE) as AgentGuardService;
			const res = fakeRes();
			const handled = service.handleTools(
				{ requestRejection: () => undefined },
				{ method: 'GET', headers: {} },
				res,
			);
			assert.equal(handled, true);
			await tick();
			assert.equal(res.statusCode, 200);
			const body = JSON.parse(res.body ?? '{}') as { tools?: readonly { name: string }[] };
			assert.deepEqual(
				body.tools?.map((one) => one.name),
				['bash'],
			);
		} finally {
			await taskboard.close();
		}
	});
});

describe('apply：DI cell（subagents 走 ctx.inject）', () => {
	it('cell 有/无服务，guard 的 holder 跟着变（晚到也能看到）', async () => {
		const { taskboard, store } = makeTaskboard();
		try {
			const recorder = makeCtx(taskboard, store);
			apply(recorder.ctx);
			const guard = recorder.guardFns[0];
			assert.notEqual(guard, undefined);

			/* DI 通道只声明了一个可选服务。 */
			assert.equal(recorder.injectCalls.length, 1);
			assert.deepEqual([...recorder.injectCalls[0]!.deps], ['subagents']);

			/* 布置「lead 持有一张授予 bash 的工作卡」，档位 manage。 */
			const service = recorder.provided.get(AGENT_GUARD_SERVICE) as AgentGuardService;
			await service.writeLevel('manage');
			const workspaceId = await ensureWorkspace(taskboard);
			const cardId = await claimedWorkCard(taskboard, workspaceId, 'apply DI 卡', 'lead');
			const card = taskboard.get(workspaceId, cardId);
			assert.equal(card.ok, true);
			if (!card.ok) return;
			const set = await taskboard.setTemplatePolicy(card.card.template.ref, ['bash']);
			assert.equal(set.ok, true);

			/* cell 空 ⇒ 无 holder（issue #42 Bug 2：不再回落 UUID）⇒ 找不到 lead 的卡 ⇒ 拒。 */
			assert.notEqual(guard?.(exec('bash', 'uuid-1')), undefined, 'cell 空时无持有卡应拒');

			/* 服务出现 ⇒ 同一次 apply 的 guard 立刻看到（cell 每次判定都读）。 */
			const cleanup = recorder.injectCalls[0]!.callback({
				subagents: { namesOf: () => ({ self: 'lead' }) },
			});
			assert.equal(typeof cleanup, 'function', 'inject 回调应返回清理函数');
			assert.equal(guard?.(exec('bash', 'uuid-1')), undefined, 'cell 有 lead ⇒ 用名字找到持有卡，放行');

			/* 服务消失 ⇒ cell 清空、holder 为空 ⇒ 又拒。 */
			cleanup?.();
			assert.notEqual(guard?.(exec('bash', 'uuid-1')), undefined, 'cell 清空后无 holder，权限不生效');
		} finally {
			await taskboard.close();
		}
	});
});
