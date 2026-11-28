/**
 * `apply()` 的形状测试 —— 用假 ctx（假总线 / 假定时器 / 假 agent）。
 *
 * 两处假件的取法直接对应 2026-11-28 真实 profile 的暴雷（当时它们没照真实行为造）：
 * · **假 ctx 是 Proxy**：读没声明的成员会抛 —— 真实 Cordis ctx 的 inject 闸门
 *   就是这样（`cannot get property "timer" without inject`），普通对象假 ctx 测不出。
 * · **假定时器替换 `globalThis`**：宿主侧真的在读全局定时器（见 src 文件头
 *   「宿主 API 事实」），不给 src 加测试专用注入口。
 *
 * 覆盖用户裁定里的四条行为：
 * · `inject` **只在**有「用户改过、AI 未读」的卡时发生（且不 followup）；
 * · `followup` **只在**泵开且有「提交/处理中」的 work 卡时发生；
 * · `pump: false` ⇒ 全静默（不建定时器、不 followup），未读侧仍工作；
 * · bus 订阅与定时器随 `effect` 的清理函数一起消失。
 *
 * 另外钉住三处容易回归的细节：在飞标记不叠加、5 分钟兜底、`whenIdle` resolve 后清兜底定时器。
 */

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { TaskState } from '@taskboard/protocol';

import {
	DEFAULT_PUMP,
	DEFAULT_PUMP_INTERVAL_MINUTES,
	PUMP_IDLE_TIMEOUT_MS,
	apply,
	inject,
	name,
	type AgentLike,
	type AgentMessage,
	type ApplyContext,
	type Config,
	type LoopCard,
} from '../src/index.ts';
import { fakeCard } from './fixtures.ts';

/* ────────────────────────────── 夹具 ────────────────────────────── */

/** 假 agent：把投递到的消息记下来。 */
interface AgentFake extends AgentLike {
	readonly injected: AgentMessage[];
	readonly followed: AgentMessage[];
}

function agentFake(whenIdle?: () => Promise<unknown>): AgentFake {
	const injected: AgentMessage[] = [];
	const followed: AgentMessage[] = [];
	return {
		injected,
		followed,
		inject: (message) => {
			injected.push(message);
		},
		followup: (message) => {
			followed.push(message);
		},
		...(whenIdle === undefined ? {} : { whenIdle }),
	};
}

/** 一条假定时器（`handle` 是身份，`ms` 用于断言配置）。 */
interface TimerEntry {
	readonly fn: () => void;
	readonly ms: number;
	readonly handle: object;
}

/** 假 ctx 的可观察面。 */
interface Harness {
	readonly ctx: ApplyContext;
	readonly intervals: TimerEntry[];
	readonly timeouts: TimerEntry[];
	readonly disposers: (() => void)[];
	readonly busSize: () => number;
	setCards(cards: readonly LoopCard[]): void;
	setAgents(agents: readonly AgentFake[]): void;
	emitBus(): void;
	/** 触发已登记的 interval 回调，并等异步体跑完。 */
	tick(): Promise<void>;
	/** 触发第一个 `ms` 匹配的 timeout（真实定时器触发后即消失，这里也一样）。 */
	fireTimeout(ms: number): Promise<void>;
	/** 等微任务 / 宏任务清空（异步的泵体不是同步的）。 */
	flush(): Promise<void>;
	dispose(): void;
}

function removeEntry(entries: TimerEntry[], handle: unknown): void {
	const index = entries.findIndex((entry) => entry.handle === handle);
	if (index >= 0) entries.splice(index, 1);
}

/* ─────────────────────── 假定时器（替换全局） ─────────────────────── */

/** 手工驱动的假定时器表；`afterEach` 负责还原全局。 */
interface FakeTimers {
	readonly intervals: TimerEntry[];
	readonly timeouts: TimerEntry[];
	restore(): void;
}

/** 当前用例装上的假定时器（`afterEach` 还原后置空）。 */
let installedTimers: FakeTimers | undefined;

/**
 * 把全局 `setInterval` / `setTimeout` 换成手工驱动的假件。
 *
 * ## 为什么替换 `globalThis`，而不是给 src 加 `setTimerBackend(…)` 之类的注入口
 *
 * 宿主侧（`src/index.ts`）现在的行为就是**用全局定时器**：真实 Cordis 的 `Context`
 * 是代理，读 `ctx.setInterval` 会路由到没 `inject` 的 `timer` 服务并**当场抛**
 * `cannot get property "timer" without inject`（2026-11-28 真实 profile 实测），
 * `?? 全局` 的回落只是死代码，已经删掉。
 *
 * 若改成模块级注入口，测的就是那个开关，而不是「代码去读全局」这条生产事实，
 * 并且要在生产代码里留一个测试专用 API。替换全局让测试与生产走同一条路，
 * src 里零测试钩子 —— 这是**实现最小、语义最诚实**的那个。
 *
 * 代价是下面一次 `as unknown as`：Node 的真实句柄是 `Timeout` 对象，而假句柄
 * 只有**身份**语义（`removeEntry` 按引用比）。这是测试替身的固有摩擦，
 * 不是在掩盖类型错误。
 */
function installFakeTimers(): FakeTimers {
	/* 只声明本包用到的四个口子，句柄是 `unknown` ⇒ 假件不必伪造 `NodeJS.Timeout`。 */
	const globals = globalThis as unknown as {
		setInterval(fn: () => void, ms: number): unknown;
		clearInterval(handle: unknown): void;
		setTimeout(fn: () => void, ms: number): unknown;
		clearTimeout(handle: unknown): void;
	};
	const real = {
		setInterval: globals.setInterval,
		clearInterval: globals.clearInterval,
		setTimeout: globals.setTimeout,
		clearTimeout: globals.clearTimeout,
	};

	const intervals: TimerEntry[] = [];
	const timeouts: TimerEntry[] = [];

	globals.setInterval = (fn, ms) => {
		const handle = {};
		intervals.push({ fn, ms, handle });
		return handle;
	};
	globals.clearInterval = (handle) => {
		removeEntry(intervals, handle);
	};
	globals.setTimeout = (fn, ms) => {
		const handle = {};
		timeouts.push({ fn, ms, handle });
		return handle;
	};
	globals.clearTimeout = (handle) => {
		removeEntry(timeouts, handle);
	};

	return {
		intervals,
		timeouts,
		restore() {
			globals.setInterval = real.setInterval;
			globals.clearInterval = real.clearInterval;
			globals.setTimeout = real.setTimeout;
			globals.clearTimeout = real.clearTimeout;
		},
	};
}

/** 取（必要时装上）本用例的假定时器。 */
function fakeTimersOf(): FakeTimers {
	installedTimers ??= installFakeTimers();
	return installedTimers;
}

/*
 * 每个用例结束还原全局：用例失败也还原（`afterEach` 照跑），
 * 否则后面的用例会拿到上一个用例的假件。
 */
afterEach(() => {
	installedTimers?.restore();
	installedTimers = undefined;
});

const flush = (): Promise<void> =>
	new Promise<void>((resolve) => {
		setImmediate(resolve);
	});

/** 造一套假 ctx（还没 apply）。 */
function harnessOf(initialAgents: readonly AgentFake[] = []): Harness {
	let cards: readonly LoopCard[] = [];
	let agents: readonly AgentFake[] = initialAgents;

	const listeners = new Set<() => void>();
	const { intervals, timeouts } = fakeTimersOf();
	const disposers: (() => void)[] = [];

	const bus = {
		on(listener: () => void): () => void {
			listeners.add(listener);
			let disposed = false;
			return () => {
				if (disposed) return;
				disposed = true;
				listeners.delete(listener);
			};
		},
	};

	/**
	 * 假 ctx —— **只暴露本行声明过的成员，读别的就抛**。
	 *
	 * 真实 Cordis 的 `Context` 是代理：读一个没 `inject` 的服务名会抛
	 * `cannot get property "<名字>" without inject`，`??` 救不了它 —— 2026-11-28
	 * 的 bug 正是这样绕过了普通对象假 ctx 的测试。这里照真实行为把「读不认识
	 * 的成员」变成抛错：以后再往 `apply` 里塞 `ctx.<新东西>` 而没同步 `inject`，
	 * 这些用例会立刻红，而不是等真实 profile 启动才报 `1 entry did not activate`。
	 */
	const ctx: ApplyContext = new Proxy(
		{
			taskboard3Core: {
				listWorkspaces: () => [{ id: 'ws-1' }],
				list: () => cards,
			},
			taskboard3Bus: bus,
			/* `agents` 只能在用时惰性取（apply 时可能还没注册）。 */
			get: (serviceName: string) =>
				serviceName === 'agents' ? { list: () => agents } : undefined,
			effect: (effect: () => () => void) => {
				/* 与 Cordis 一致：execute 立刻调用，返回值才是 disposer。 */
				disposers.push(effect());
			},
		} satisfies ApplyContext,
		{
			get(target, key, receiver) {
				if (typeof key === 'string' && Object.hasOwn(target, key)) {
					return Reflect.get(target, key, receiver);
				}
				throw new Error(`cannot get property "${String(key)}" without inject`);
			},
		},
	);

	return {
		ctx,
		intervals,
		timeouts,
		disposers,
		busSize: () => listeners.size,
		setCards(next) {
			cards = next;
		},
		setAgents(next) {
			agents = next;
		},
		emitBus() {
			for (const listener of [...listeners]) listener();
		},
		async tick() {
			for (const entry of [...intervals]) entry.fn();
			await flush();
		},
		async fireTimeout(ms) {
			const index = timeouts.findIndex((entry) => entry.ms === ms);
			assert.ok(index >= 0, `没有 ${ms}ms 的定时器`);
			const [entry] = timeouts.splice(index, 1);
			entry?.fn();
			await flush();
		},
		flush,
		dispose() {
			for (const disposer of disposers.splice(0)) disposer();
		},
	};
}

/** 造夹具并立刻 apply。 */
function appliedHarness(options: {
	readonly agents?: readonly AgentFake[];
	readonly config?: Config;
} = {}): Harness {
	const harness = harnessOf(options.agents ?? []);
	apply(harness.ctx, options.config ?? {});
	return harness;
}

/** 取消息里的文本（顺便断言形状是 text 段）。 */
function textOf(message: AgentMessage | undefined): string {
	assert.ok(message !== undefined, '应有一条消息');
	const part = message.content[0];
	assert.ok(part !== undefined, '消息应有一个 content 段');
	assert.equal(part.type, 'text');
	return part.text;
}

/* ────────────────────────────── 用例 ────────────────────────────── */

test('行标识与服务声明', () => {
	assert.equal(name, 'taskboard3-agent-loop');
	assert.deepEqual([...inject], ['taskboard3Core', 'taskboard3Bus']);
	assert.equal(DEFAULT_PUMP, true);
	assert.equal(DEFAULT_PUMP_INTERVAL_MINUTES, 10);
	assert.equal(PUMP_IDLE_TIMEOUT_MS, 300_000);
});

test('apply：只登记一个 effect，默认建一个 10 分钟的 interval', () => {
	const harness = appliedHarness();

	assert.equal(harness.disposers.length, 1, '清理必须挂在 effect 上');
	assert.equal(harness.intervals.length, 1);
	assert.equal(harness.intervals[0]?.ms, 600_000);
});

test('未读注入：只在「用户改过、AI 未读」时 inject，且同一版 history 只注入一次', () => {
	const agent = agentFake();
	const harness = appliedHarness({ agents: [agent] });
	harness.setCards([fakeCard({ id: '3', title: '补一句验收标准', unread: { ai: false, user: true } })]);

	harness.emitBus();

	assert.equal(agent.injected.length, 1);
	assert.equal(agent.followed.length, 0, '未读注入不许 followup（不唤醒）');
	const message = agent.injected[0];
	assert.deepEqual(message?.source, { kind: 'user' });
	assert.match(textOf(message), /^\[任务板\] 你有未读更新：3 补一句验收标准/);

	harness.emitBus();
	assert.equal(agent.injected.length, 1, '同一张卡同一版 history 不重复注入');
});

test('未读注入：unread.ai（AI 改过、用户未读）不注入', () => {
	const agent = agentFake();
	const harness = appliedHarness({ agents: [agent] });
	harness.setCards([fakeCard({ id: '3', unread: { ai: true, user: false } })]);

	harness.emitBus();
	assert.equal(agent.injected.length, 0);
});

test('未读注入：事件到达时没有活 agent ⇒ 不投也不消耗去重键', () => {
	const harness = appliedHarness();
	harness.setCards([fakeCard({ id: '3', unread: { ai: false, user: true } })]);

	harness.emitBus();

	const agent = agentFake();
	harness.setAgents([agent]);
	harness.emitBus();
	assert.equal(agent.injected.length, 1, '后续 agent 仍应收到这次未读');
});

test('工作泵：有提交 / 处理中的 work 卡 ⇒ followup 一次（不 inject）', async () => {
	const agent = agentFake();
	const harness = appliedHarness({ agents: [agent] });
	harness.setCards([
		fakeCard({ id: 'W1', title: '拆守卫', status: TaskState.SUBMITTED }),
		fakeCard({ id: 'W2', title: '跑测试', status: TaskState.WORKING }),
	]);

	await harness.tick();

	assert.equal(agent.followed.length, 1);
	assert.equal(agent.injected.length, 0, '泵只推进，不做未读注入');
	const text = textOf(agent.followed[0]);
	assert.match(text, /^\[任务板\] 可推进的工作：/);
	assert.match(text, /1\. W1 拆守卫（提交）/);
	assert.match(text, /2\. W2 跑测试（处理中）/);
});

test('工作泵：清单空 ⇒ 不 followup（草稿 / 非 work 都不算）', async () => {
	const agent = agentFake();
	const harness = appliedHarness({ agents: [agent] });
	harness.setCards([
		fakeCard({ id: 'D1', status: TaskState.UNSPECIFIED }),
		fakeCard({ id: 'G1', template: { kind: 'goal' } }),
	]);

	await harness.tick();
	assert.equal(agent.followed.length, 0);
});

test('工作泵：没有活 agent ⇒ 跳过；有活 agent 的下一轮照常', async () => {
	const harness = appliedHarness();
	harness.setCards([fakeCard({ id: 'W1' })]);

	await harness.tick();

	const agent = agentFake();
	harness.setAgents([agent]);
	await harness.tick();
	assert.equal(agent.followed.length, 1);
});

test('工作泵：在飞期间不叠加；5 分钟兜底后清标记', async () => {
	const agent = agentFake(); /* 没有 whenIdle ⇒ 只能靠兜底 */
	const harness = appliedHarness({ agents: [agent] });
	harness.setCards([fakeCard({ id: 'W1' })]);

	await harness.tick();
	assert.equal(agent.followed.length, 1);
	assert.equal(harness.timeouts.length, 1);
	assert.equal(harness.timeouts[0]?.ms, PUMP_IDLE_TIMEOUT_MS, '兜底必须是 5 分钟');

	await harness.tick();
	assert.equal(agent.followed.length, 1, '在飞时不叠加唤醒');

	await harness.fireTimeout(PUMP_IDLE_TIMEOUT_MS);
	await harness.tick();
	assert.equal(agent.followed.length, 2, '兜底清标记后下一轮应继续');
});

test('工作泵：whenIdle resolve ⇒ 立刻清在飞标记与兜底定时器', async () => {
	let resolveIdle: () => void = () => {};
	const idle = new Promise<void>((resolve) => {
		resolveIdle = resolve;
	});
	const agent = agentFake(() => idle);
	const harness = appliedHarness({ agents: [agent] });
	harness.setCards([fakeCard({ id: 'W1' })]);

	await harness.tick();
	assert.equal(agent.followed.length, 1);
	assert.equal(harness.timeouts.length, 1, '兜底定时器同时在等');

	await harness.tick();
	assert.equal(agent.followed.length, 1, 'whenIdle 未 resolve ⇒ 仍在飞');

	resolveIdle();
	await harness.flush();
	assert.equal(harness.timeouts.length, 0, '空闲后兜底定时器必须被清掉');

	await harness.tick();
	assert.equal(agent.followed.length, 2);
});

test('pump=false：不建定时器、不 followup，但未读注入照常', async () => {
	const agent = agentFake();
	const harness = appliedHarness({ agents: [agent], config: { pump: false } });

	assert.equal(harness.intervals.length, 0, '关掉泵就不该留一个空转的 interval');

	harness.setCards([fakeCard({ id: 'W1' })]);
	await harness.tick();
	assert.equal(agent.followed.length, 0);

	harness.setCards([fakeCard({ id: '3', unread: { ai: false, user: true } })]);
	harness.emitBus();
	assert.equal(agent.injected.length, 1, '泵开关不影响未读注入');
});

test('pumpIntervalMinutes 生效（0.5 分钟 ⇒ 30 秒）', () => {
	const harness = appliedHarness({ config: { pumpIntervalMinutes: 0.5 } });
	assert.equal(harness.intervals[0]?.ms, 30_000);
});

test('坏间隔回落默认，并 warn 留痕（不抛）', () => {
	const warnings: string[] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args.map((one) => String(one)).join(' '));
	};
	try {
		const harness = appliedHarness({ config: { pumpIntervalMinutes: 0 } });
		assert.equal(harness.intervals[0]?.ms, 600_000);
	} finally {
		console.warn = original;
	}
	assert.ok(
		warnings.some((message) => message.includes('pumpIntervalMinutes')),
		`应有一条关于坏配置的 warn，实际：${warnings.join(' | ')}`,
	);
});

test('effect 清理：退订总线 + 清定时器；之后事件不再注入', () => {
	const agent = agentFake();
	const harness = appliedHarness({ agents: [agent] });
	harness.setCards([fakeCard({ id: '3', unread: { ai: false, user: true } })]);
	assert.equal(harness.busSize(), 1);

	harness.dispose();

	assert.equal(harness.busSize(), 0, '总线订阅必须随 effect 退掉');
	assert.equal(harness.intervals.length, 0, 'interval 必须随 effect 清掉');

	harness.emitBus();
	assert.equal(agent.injected.length, 0);
});
