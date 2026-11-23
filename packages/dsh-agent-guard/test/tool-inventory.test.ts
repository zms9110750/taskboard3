/**
 * `tool-inventory.ts` 的测试 —— 「全量工具清单」怎么拼、怎么降级、怎么缓存。
 *
 * 覆盖的都是**真实故障形态**：
 *   · preset registry 不存在（TUI / headless profile）
 *   · `list()` 抛、`acquireScope()` 抛、lease 释放抛
 *   · `schemas()` 返回非数组 / 全局视图抛
 *   · 缓存：TTL 内不重复枚举、过期后重新枚举、并发只跑一次
 *
 * ⚠ 不测 DSH 本体 —— 这里全是注入的假件，跑在纯 node 里。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_TOOLS_TTL_MS, createToolInventory } from '../src/tool-inventory.ts';
import type { InventoryDeps, ScopeLeaseLike } from '../src/tool-inventory.ts';

/** 造一条工具 schema（只关心 name，其它字段原样带过）。 */
const tool = (name: string): { name: string; description: string; parameters: Record<string, unknown> } => ({
	name,
	description: `${name} 的说明`,
	parameters: {},
});

/** 收集告警（断言降级路径用）。 */
interface Recorder {
	readonly messages: string[];
	readonly warn: (message: string) => void;
}

/** 造一个告警记录器。 */
function recorder(): Recorder {
	const messages: string[] = [];
	return {
		messages,
		warn: (message: string): void => {
			messages.push(message);
		},
	};
}

/** 可编排的假 preset registry。 */
interface FakePresets {
	readonly calls: { list: number; acquire: string[]; dispose: string[] };
	readonly presets: NonNullable<InventoryDeps['presets']>;
}

/**
 * 造假 preset registry。
 *
 * @param table preset id → 该 scope 的工具名
 * @param hooks 覆盖行为（抛错等）
 */
function fakePresets(
	table: Readonly<Record<string, readonly string[]>>,
	hooks: {
		readonly listThrows?: boolean;
		readonly acquireThrows?: readonly string[];
		readonly disposeThrows?: readonly string[];
	} = {},
): FakePresets {
	const calls = { list: 0, acquire: [] as string[], dispose: [] as string[] };
	const presets = {
		async list(): Promise<readonly { readonly id: string }[]> {
			calls.list += 1;
			if (hooks.listThrows === true) throw new Error('preset registry 炸了');
			return Object.keys(table).map((id) => ({ id }));
		},
		async acquireScope(id: string): Promise<ScopeLeaseLike> {
			calls.acquire.push(id);
			if (hooks.acquireThrows?.includes(id) === true) throw new Error(`scope ${id} 炸了`);
			return {
				key: `scope:${id}`,
				// 真实对象是 [Symbol.asyncDispose](); lib 是 ES2023 没这个类型 ⇒ 运行时符号挂上去
				[(Symbol as unknown as { asyncDispose: symbol }).asyncDispose]: async (): Promise<void> => {
					calls.dispose.push(id);
					if (hooks.disposeThrows?.includes(id) === true) throw new Error(`dispose ${id} 炸了`);
				},
			} as ScopeLeaseLike;
		},
	};
	return { calls, presets };
}

describe('createToolInventory：并集', () => {
	it('全局 ∪ 每个 preset scope ∪ 活 agent，按 name 去重（先出现的赢）', async () => {
		const presets = fakePresets({ standard: ['bash', 'read'], minimal: ['read', 'todo_write'] });
		const scopes: unknown[] = [];
		const inventory = createToolInventory({
			schemas: (scope?: unknown) => {
				scopes.push(scope);
				if (scope === undefined) return [tool('taskboard_cards'), tool('bash')];
				if (scope === 'scope:standard') return [tool('bash'), tool('read')];
				if (scope === 'scope:minimal') return [tool('read'), tool('todo_write')];
				if (scope === 'agent:a') return [tool('pwsh')];
				return [];
			},
			presets: presets.presets,
			agents: { list: () => ['agent:a'] },
		});

		const names = (await inventory()).map((one) => (one as { name: string }).name);
		assert.deepEqual(names, ['taskboard_cards', 'bash', 'read', 'todo_write', 'pwsh']);
		// 全局一次 + 两个 preset + 一个活 agent
		assert.deepEqual(scopes, [undefined, 'scope:standard', 'scope:minimal', 'agent:a']);
		assert.deepEqual(presets.calls.acquire, ['standard', 'minimal']);
		assert.deepEqual(presets.calls.dispose, ['standard', 'minimal'], '租约必须都释放');
	});

	it('没有 preset registry（TUI / headless）⇒ 只返回全局 + 活 agent', async () => {
		const inventory = createToolInventory({
			schemas: (scope?: unknown) =>
				scope === undefined ? [tool('working_directory')] : [tool('team_task_list')],
			agents: { list: () => ['agent:a'] },
		});
		const names = (await inventory()).map((one) => (one as { name: string }).name);
		assert.deepEqual(names, ['working_directory', 'team_task_list']);
	});

	it('脏条目跳过：没 name / 非对象 / name 空串', async () => {
		const inventory = createToolInventory({
			schemas: () => [
				tool('good'),
				{ description: '没有名字' },
				null,
				'nope',
				{ name: '' },
				{ name: 'also-good', description: 'x', parameters: {} },
			],
		});
		const names = (await inventory()).map((one) => (one as { name: string }).name);
		assert.deepEqual(names, ['good', 'also-good']);
	});

	it('schemas 返回非数组 ⇒ 当成空（不崩、不把字符串当工具）', async () => {
		const inventory = createToolInventory({
			schemas: () => 'not-an-array' as unknown as readonly unknown[],
		});
		assert.deepEqual(await inventory(), []);
	});
});

describe('createToolInventory：降级', () => {
	it('list() 抛 ⇒ 跳过 preset 层，活 agent 仍然枚举', async () => {
		const rec = recorder();
		const presets = fakePresets({ standard: ['bash'] }, { listThrows: true });
		const inventory = createToolInventory({
			schemas: (scope?: unknown) => (scope === undefined ? [tool('taskboard_cards')] : [tool('live')]),
			presets: presets.presets,
			agents: { list: () => ['agent:a'] },
			warn: rec.warn,
		});
		const names = (await inventory()).map((one) => (one as { name: string }).name);
		assert.deepEqual(names, ['taskboard_cards', 'live']);
		assert.equal(
			rec.messages.some((one) => one.includes('列 agent preset 失败')),
			true,
		);
	});

	it('某个 preset 的 acquireScope 抛 ⇒ 只跳过那一个', async () => {
		const rec = recorder();
		const presets = fakePresets({ standard: ['bash'], broken: ['nope'] }, { acquireThrows: ['broken'] });
		const inventory = createToolInventory({
			schemas: (scope?: unknown) => {
				if (scope === undefined) return [tool('taskboard_cards')];
				if (scope === 'scope:standard') return [tool('bash')];
				if (scope === 'scope:broken') return [tool('nope')];
				return [];
			},
			presets: presets.presets,
			warn: rec.warn,
		});
		const names = (await inventory()).map((one) => (one as { name: string }).name);
		assert.deepEqual(names, ['taskboard_cards', 'bash']);
		assert.equal(
			rec.messages.some((one) => one.includes('broken')),
			true,
		);
	});

	it('lease 释放抛 ⇒ 只告警，不影响结果', async () => {
		const rec = recorder();
		const presets = fakePresets({ standard: ['bash'] }, { disposeThrows: ['standard'] });
		const inventory = createToolInventory({
			schemas: (scope?: unknown) => (scope === undefined ? [tool('taskboard_cards')] : [tool('bash')]),
			presets: presets.presets,
			warn: rec.warn,
		});
		const names = (await inventory()).map((one) => (one as { name: string }).name);
		assert.deepEqual(names, ['taskboard_cards', 'bash']);
		assert.equal(
			rec.messages.some((one) => one.includes('释放 scope 失败')),
			true,
		);
	});

	it('全局视图抛 ⇒ 仍然继续枚举 preset（不整单失败）', async () => {
		const rec = recorder();
		const presets = fakePresets({ standard: ['bash'] });
		const inventory = createToolInventory({
			schemas: (scope?: unknown) => {
				if (scope === undefined) throw new Error('注册表还没就绪');
				return [tool('bash')];
			},
			presets: presets.presets,
			warn: rec.warn,
		});
		const names = (await inventory()).map((one) => (one as { name: string }).name);
		assert.deepEqual(names, ['bash']);
		assert.equal(
			rec.messages.some((one) => one.includes('读全局视图失败')),
			true,
		);
	});

	it('waitReady 抛 ⇒ 忽略，继续枚举', async () => {
		const rec = recorder();
		const inventory = createToolInventory({
			schemas: () => [tool('bash')],
			awaitReady: async () => {
				throw new Error('loader 没就绪');
			},
			warn: rec.warn,
		});
		const names = (await inventory()).map((one) => (one as { name: string }).name);
		assert.deepEqual(names, ['bash']);
		assert.equal(
			rec.messages.some((one) => one.includes('等挂载失败')),
			true,
		);
	});
});

describe('createToolInventory：缓存', () => {
	it('TTL 内第二次调用不重新枚举', async () => {
		const presets = fakePresets({ standard: ['bash'] });
		let clock = 1_000;
		const inventory = createToolInventory({
			schemas: () => [tool('taskboard_cards')],
			presets: presets.presets,
			now: () => clock,
			ttlMs: 10_000,
		});
		await inventory();
		assert.equal(presets.calls.list, 1);
		clock += 1;
		await inventory();
		await inventory();
		assert.equal(presets.calls.list, 1, 'TTL 内不该再 list()');
	});

	it('TTL 过期后重新枚举', async () => {
		const presets = fakePresets({ standard: ['bash'] });
		let clock = 0;
		const inventory = createToolInventory({
			schemas: () => [],
			presets: presets.presets,
			now: () => clock,
			ttlMs: 100,
		});
		await inventory();
		assert.equal(presets.calls.list, 1);
		clock = 101;
		await inventory();
		assert.equal(presets.calls.list, 2);
	});

	it('并发调用只跑一次枚举（共享 inflight）', async () => {
		const presets = fakePresets({ standard: ['bash'] });
		const inventory = createToolInventory({
			schemas: () => [tool('taskboard_cards')],
			presets: presets.presets,
		});
		const [a, b] = await Promise.all([inventory(), inventory()]);
		assert.deepEqual(a, b);
		assert.equal(presets.calls.list, 1);
	});

	it('默认 TTL 是 10 秒', () => {
		assert.equal(DEFAULT_TOOLS_TTL_MS, 10_000);
	});

	it('延迟解析：服务在第一次枚举后才出现 ⇒ 短 TTL 到期后能补上', async () => {
		/*
		 * 真实故障形态：`apply()` 时 preset-registry 还没激活（激活顺序不由本行决定），
		 * 所以 deps 只能给 resolver。第一版在 apply 时固化成 undefined ⇒
		 * /api/tools 永远只有那 16 个全局工具。
		 */
		const presets = fakePresets({ standard: ['bash'] });
		let serviceReady = false;
		let clock = 0;
		const inventory = createToolInventory({
			schemas: (scope?: unknown) => (scope === undefined ? [tool('taskboard_cards')] : [tool('bash')]),
			resolvePresets: () => (serviceReady ? presets.presets : undefined),
			now: () => clock,
			ttlMs: 10_000,
		});

		assert.deepEqual(
			(await inventory()).map((one) => (one as { name: string }).name),
			['taskboard_cards'],
		);
		/* 服务就绪了，但还在短 TTL 内 ⇒ 不重试 */
		serviceReady = true;
		clock += 10;
		assert.deepEqual(
			(await inventory()).map((one) => (one as { name: string }).name),
			['taskboard_cards'],
		);
		/* 短 TTL（UNSCOPED_TOOLS_TTL_MS = 1000ms）过了 ⇒ 重新枚举并带上 preset 层 */
		clock += 5_000;
		assert.deepEqual(
			(await inventory()).map((one) => (one as { name: string }).name),
			['taskboard_cards', 'bash'],
		);
	});

	it('枚举到 scope 层后按正常 TTL 缓存（不再每次重试）', async () => {
		const presets = fakePresets({ standard: ['bash'] });
		let clock = 0;
		const inventory = createToolInventory({
			schemas: (scope?: unknown) => (scope === undefined ? [tool('taskboard_cards')] : [tool('bash')]),
			presets: presets.presets,
			now: () => clock,
			ttlMs: 10_000,
		});
		await inventory();
		assert.equal(presets.calls.list, 1);
		clock += 5_000;
		await inventory();
		assert.equal(presets.calls.list, 1, '10 秒内不该重试');
		clock += 6_000;
		await inventory();
		assert.equal(presets.calls.list, 2, '过期后重新枚举');
	});
});
