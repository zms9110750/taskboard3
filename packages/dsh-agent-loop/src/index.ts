/**
 * `@taskboard/dsh-agent-loop` —— 任务板与 **DSH 消息循环**接触的那一行（#9 动机 1：无人值守）。
 *
 * ## 为什么需要它
 *
 * 任务板的卡会被**用户**改（回答 / 补充 / 改状态），而 agent 的消息循环不会自己醒过来看。
 * 反过来，用户不在时 agent 也不会自己继续推进「提交 / 处理中」的工作卡。
 *
 * ## 用户裁定（`docs/ARCHIVE.md` §5，2026-11-28）—— 唤醒机制**已否决**
 *
 * > **唤醒机制否决。** 替代设计：
 * > · **用户值守**：用户作答后**直接在输入栏聊天**进入消息循环，无需任何唤醒。
 * >   卡上出现「AI 未读」⇒ 插件做一次**上下文注入**（`agent.inject` 进 inbox）即可。
 * > · **无人值守持续推进**：也在**消息循环层面**达成 —— 检查「提交」和「进行中」的
 * >   工作卡 ⇒ 上下文注入工作摘要 ⇒ 推进消息循环。不做「答案到达即唤醒」的定时器。
 *
 * ⇒ 本行只做两件事，**没有别的语义**：
 *
 * ```
 * ① 未读注入   bus 事件 ⇒ 重拉 ⇒ 有新未读 ⇒ 对每个活 agent `inject(...)`
 *              不 followup、不定时器、不唤醒。
 * ② 工作泵     interval ⇒ 重拉 ⇒ 有「提交/处理中」的工作卡 ⇒ `followup(...)`
 *              followup 排 next-turn 并唤醒；本泵有在飞标记，等 agent 空闲（或 5 分钟兜底）再清。
 * ```
 *
 * ## 关掉这一行会怎样（locale/*.json 里对用户也是这句话）
 *
 * ```
 * · 卡上的未读不再注入给 agent（用户回答/修改了卡，模型不会被告知）
 * · 无人值守的持续推进停止（提交 / 处理中的工作卡不再自动把 agent 叫起来）
 * · 任务板的卡 / 空间 / HTTP / 界面 / AI 工具**全部不受影响**
 * ```
 *
 * ## 宿主 API 事实（调研已核实）
 *
 * · 服务 `agents`：**惰性取**（`ctx.get('agents')`），**不能**写进静态 `inject` ——
 *   `apply()` 执行时它可能还没激活。先例：`packages/dsh-agent-guard/src/tool-inventory.ts:67-77`
 *   （第一版在 apply 时取一次值 ⇒ 永远拿不到）。
 * · `Agent.inject(message)` 进 inbox、**不唤醒**；`Agent.followup(message)` 排 next-turn
 *   并唤醒（活 driver 在轮末自己接手，不打断正在跑的轮次）。
 * · 冷会话（没有活 agent）要先 `ctx.get('sessionController').resolveAgent(sessionId)`
 *   resume 再 followup —— **v1 不做**，见下面的 TODO。
 * · 消息形状是结构式的：`{ content: [{ type: 'text', text }], source: { kind: 'user' } }`
 *   —— **不 import 宿主包**（本包对 `@deepseek-ai/*` 零依赖，`package.json` 里也没有 peer 依赖）。
 *   `source.kind` v1 用 `'user'`（自定义 kind 需注册，未验证）；文案前缀 `[任务板]`。
 * · 事件源：core 的总线脚手架（`packages/core/src/bus.ts`，`card:written`），服务名
 *   `taskboard3Bus` 由 `@taskboard/dsh-core` provide。**收到就重拉，不解析消息细节**
 *   （脚手架的约定：将来拆总线时消费方本来就没依赖细节）。
 *
 * ## TODO(审查) 汇总（本包 v1 的已知缺口，都只影响「无人值守」的覆盖面）
 *
 * · 冷会话：没有活 agent 时**跳过**，不 resume。要接
 *   `ctx.get('sessionController').resolveAgent(sessionId)`（样板在 asar 里
 *   `dsh-schedule/src/runtime.ts:328-337`，只读参考）—— 需要先定「盯哪些会话」的策略。
 * · 启动时的存量未读不会被注入：本行只在 bus 事件上注入（用户裁定：未读侧**不定时器**），
 *   而启动前就存在的未读没有事件可等。要补就得定「启动扫一次」是否算定时器。
 * · 只盯**第一个未归档工作空间**（先例：`dsh-agent-guard/src/permission.ts` 的
 *   `heldWorkCardsOf`）；多空间要定「工作摘要是按空间分开还是合并」。
 * · 已注入集合是**全 agent 共享**的内存 Set：A 注入过的卡，后加入的 B 不会补一次。
 * · 泵没有「已推进过」的去重（未读侧有 `unreadKeyOf`）：一张卡只要停在处理中，
 *   每轮空闲后都会再 followup 一次。是否要「同一张卡每轮只推一次」需用户定。
 * · 本行不 `provide` 任何服务（没有对外面），也没有浏览器半。
 */

import type { LoopCard } from './pure/loop-judgment.ts';
import { unreadDigestOf, workDigestOf } from './pure/loop-judgment.ts';

/** Cordis 插件名（bundle 第 8 行的 id 用 `taskboard3-agent-loop`）。 */
export const name = 'taskboard3-agent-loop';

/**
 * 前置服务。
 *
 * · `taskboard3Core` —— `@taskboard/dsh-core` 提供的任务板实例（读卡）
 * · `taskboard3Bus`  —— `@taskboard/dsh-core` 提供的总线（⚠ 原型期脚手架，与 `core/src/bus.ts` 同生共死）
 *
 * ⚠ **两个都要列**：少列一个不报「缺依赖」，而是在 `apply` 里第一次读
 *   `ctx.<服务>` 时才抛 `cannot get property … without inject`，症状是 profile 启动报
 *   `dsh: warning: 1 entry did not activate`（AGENTS §3.10 的教训）。
 *   `agents` **不列** —— 它是可选的、可能晚到的服务，只能惰性 `get`。
 */
export const inject = ['taskboard3Core', 'taskboard3Bus'] as const;

/** 泵默认开（`pump: false` 才是关）。 */
export const DEFAULT_PUMP = true;

/** 泵默认间隔：10 分钟。 */
export const DEFAULT_PUMP_INTERVAL_MINUTES = 10;

/**
 * 在飞标记的兜底超时：**5 分钟**。
 *
 * `whenIdle()` 是可选的宿主方法：没有它（或它永远不 resolve）时，
 * 在飞标记必须能自己清掉，否则泵只跑一次。用户裁定里的数就是 5 分钟。
 */
export const PUMP_IDLE_TIMEOUT_MS = 5 * 60_000;

/** 读活 agent 的宿主服务名。 */
export const AGENTS_SERVICE = 'agents' as const;

/**
 * 本插件行的配置。
 *
 * 两个字段都在 `cordis.patch.yml` 的行配置里可改；省略用默认值。
 */
export interface Config {
	/** 工作泵开关，默认 `true`。关掉 ⇒ 只剩未读注入。 */
	readonly pump?: boolean;
	/** 工作泵间隔（分钟），默认 10。 */
	readonly pumpIntervalMinutes?: number;
}

/*
 * ───────────────────────── 宿主侧的结构式声明 ─────────────────────────
 *
 * **不 import 任何 `@deepseek-ai/*`**（与 dsh-agent-guard 同一取舍：
 * 宿主类型随版本漂，垫片只声明本行真正用到的那几个成员）。
 */

/**
 * agent 消息 —— 结构式，不 import 宿主包。
 *
 * v1 用 `source.kind: 'user'`：自定义 kind 需要在宿主注册，**未验证**；
 * 升级路径记在上面文件头的 TODO。
 */
export interface AgentMessage {
	readonly content: readonly { readonly type: 'text'; readonly text: string }[];
	readonly source: { readonly kind: 'user' };
}

/** 一个**活** agent 的最小面（`agents.list()` 的元素）。 */
export interface AgentLike {
	/** 进 inbox，**不唤醒**。 */
	inject(message: AgentMessage): void;
	/** 排 next-turn 并唤醒。 */
	followup(message: AgentMessage): void;
	/**
	 * 轮末自己接手后 resolve（宿主可选方法）。
	 *
	 * 没有就由 `PUMP_IDLE_TIMEOUT_MS` 兜底清在飞标记。
	 */
	whenIdle?(): Promise<unknown>;
}

/** `ctx.get('agents')` 的最小面。 */
export interface AgentsLike {
	list(): readonly AgentLike[];
}

/** 总线服务的最小面：只要「订阅」，**不要**消息细节（收到就重拉）。 */
export interface BusLike {
	/** @returns 退订函数（幂等由 core 的 bus 保证） */
	on(listener: () => void): () => void;
}

/**
 * 任务板实例的最小读面。
 *
 * `Taskboard` 结构上满足它 ⇒ 真实 ctx 直接传进来，测试用几十行假件。
 * 只声明本行用到的两个读方法（AGENTS §3.10：够用就好，别假装知道全部）。
 */
export interface CoreLike {
	/** 未归档工作空间（取第一个，见文件头 TODO）。 */
	listWorkspaces(includeArchived?: boolean): readonly { readonly id: string }[];
	/** 一个空间的全部卡（不含墓碑）。 */
	list(workspaceId: string): readonly LoopCard[];
}

/**
 * `apply` 用到的最小上下文（Cordis `Context` 结构上满足）。
 *
 * `effect` / `get` 沿用 dsh-agent-guard 的垫片风格：`effect` 可选（真实 ctx 一定有），
 * `get` 惰性解析可选服务。
 */
export interface ApplyContext {
	readonly taskboard3Core: CoreLike;
	readonly taskboard3Bus: BusLike;
	/**
	 * 惰性读可选服务。**只在用到的那一刻调**，别在 apply 里固化（见文件头）。
	 */
	get?(name: string): unknown;
	/** 注册副作用；入参返回清理函数，Cordis 卸载时调用它。 */
	effect?(effect: () => () => void, label?: string): void;
	/* 定时器口子：真实 ctx 不提供，省略即用全局。测试注入假件后不用等 10 分钟。 */
	setInterval?(fn: () => void, ms: number): unknown;
	clearInterval?(handle: unknown): void;
	setTimeout?(fn: () => void, ms: number): unknown;
	clearTimeout?(handle: unknown): void;
}

/** 统一告警前缀（本行只 warn，不抛 —— 一行出问题不该拖垮宿主消息循环）。 */
function warn(message: string, error?: unknown): void {
	if (error === undefined) console.warn(`[taskboard3-agent-loop] ${message}`);
	else console.warn(`[taskboard3-agent-loop] ${message}`, error);
}

/** 把文案包成宿主认的消息形状。 */
function textMessage(text: string): AgentMessage {
	return { content: [{ type: 'text', text }], source: { kind: 'user' } };
}

/**
 * 装这一行。
 *
 * @param ctx 宿主上下文（只声明本行真正用到的成员）
 * @param config 泵开关 / 间隔（省略用默认值）
 */
export function apply(ctx: ApplyContext, config: Config = {}): void {
	const taskboard = ctx.taskboard3Core;

	/* 定时器口子：省略 = 全局；测试注入假件（否则用例要等 10 分钟）。 */
	const setIntervalFn: (fn: () => void, ms: number) => unknown =
		ctx.setInterval ?? ((fn, ms) => setInterval(fn, ms));
	const clearIntervalFn: (handle: unknown) => void =
		ctx.clearInterval ??
		((handle) => {
			/* 真实句柄是 Timeout 对象（Node）或数字（浏览器）—— 两种都交给全局。 */
			if (typeof handle === 'object' || typeof handle === 'number') {
				clearInterval(handle as ReturnType<typeof setInterval>);
			}
		});
	const setTimeoutFn: (fn: () => void, ms: number) => unknown =
		ctx.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
	const clearTimeoutFn: (handle: unknown) => void =
		ctx.clearTimeout ??
		((handle) => {
			if (typeof handle === 'object' || typeof handle === 'number') {
				clearTimeout(handle as ReturnType<typeof setTimeout>);
			}
		});

	/* ── 配置（默认值 + 坏值留痕，不抛） ── */

	const pumpEnabled = config.pump ?? DEFAULT_PUMP;
	const requestedInterval = config.pumpIntervalMinutes ?? DEFAULT_PUMP_INTERVAL_MINUTES;
	const intervalValid = Number.isFinite(requestedInterval) && requestedInterval > 0;
	if (!intervalValid && config.pumpIntervalMinutes !== undefined) {
		warn(
			`pumpIntervalMinutes「${String(config.pumpIntervalMinutes)}」不是正数，已回落默认 ${DEFAULT_PUMP_INTERVAL_MINUTES} 分钟。`,
		);
	}
	const intervalMinutes = intervalValid ? requestedInterval : DEFAULT_PUMP_INTERVAL_MINUTES;
	/* 至少 1ms：`setInterval(…, 0)` 在部分宿主里等同于「尽可能快」，不是用户要的。 */
	const intervalMs = Math.max(1, Math.round(intervalMinutes * 60_000));

	/**
	 * 惰性解析可选服务。
	 *
	 * ⚠ 每次用时重新 `ctx.get` —— 服务可能在本行之后才激活（文件头的调研事实）。
	 */
	const optionalService = <T>(serviceName: string): T | undefined => {
		if (typeof ctx.get !== 'function') return undefined;
		const found = ctx.get(serviceName);
		return found === undefined || found === null ? undefined : (found as T);
	};

	/** 当前的活 agent 清单（没有服务 / 服务坏掉 ⇒ 空数组）。 */
	const liveAgentsOf = (): readonly AgentLike[] => {
		const agents = optionalService<AgentsLike>(AGENTS_SERVICE);
		if (agents === undefined || typeof agents.list !== 'function') return [];

		let listed: readonly AgentLike[];
		try {
			listed = agents.list();
		} catch (error) {
			warn('读 agents.list() 失败，本次跳过。', error);
			return [];
		}
		if (!Array.isArray(listed)) return [];
		/* 运行期可能混进半个对象：只留真的能投递的两个方法都在的。 */
		return listed.filter(
			(agent) =>
				agent !== null &&
				typeof agent === 'object' &&
				typeof agent.inject === 'function' &&
				typeof agent.followup === 'function',
		);
	};

	/**
	 * **重拉**当前工作空间的卡。
	 *
	 * 「重拉」是脚手架的约定：总线消息只说「有事发生」，消费方不要解析细节。
	 * `Taskboard.list()` 是同步内存读，一次 `loadAll`。
	 */
	const cardsOf = (): readonly LoopCard[] => {
		const workspace = taskboard.listWorkspaces(false)[0];
		if (workspace === undefined) return [];
		return taskboard.list(workspace.id);
	};

	/* ─────────────────────── ① 未读注入（不唤醒） ─────────────────────── */

	/**
	 * 已注入集合：卡 id + 最近 history 时间戳（见 `unreadKeyOf`）。
	 *
	 * 纯内存、本行实例独占：重启后重新注入一次是**期望行为**（AI 的上下文也重建了）。
	 */
	const injectedKeys = new Set<string>();

	/**
	 * bus 事件的处理器。
	 *
	 * 顺序很关键：**先确认有人可投**，再记已注入键 —— 否则「事件到达时没有活 agent」
	 * 会把这次未读永久标成已注入，用户改的卡就再也不会被告诉给 AI。
	 */
	const handleBusEvent = (): void => {
		try {
			const digest = unreadDigestOf(cardsOf(), injectedKeys);
			if (digest === null) return;

			const agents = liveAgentsOf();
			if (agents.length === 0) {
				/* TODO(审查): 冷会话走 sessionController.resolveAgent 的先 resume 路径（见文件头）。 */
				return;
			}

			const message = textMessage(digest.text);
			let delivered = 0;
			for (const agent of agents) {
				try {
					agent.inject(message);
					delivered += 1;
				} catch (error) {
					warn('未读注入失败（单个 agent），继续投给其余 agent。', error);
				}
			}
			if (delivered === 0) return;
			for (const key of digest.keys) injectedKeys.add(key);
		} catch (error) {
			/* 读卡 / 判定抛错也不能冒泡 —— 总线订阅者抛错会被 core 吞掉并打 console.error，
			   但自己的定时器路径没有那层保护，所以两条路都就地收口。 */
			warn('处理未读事件失败（本次跳过）。', error);
		}
	};

	const disposeBus = ctx.taskboard3Bus.on(handleBusEvent);

	/* ───────────────────── ② 工作泵（followup 唤醒） ───────────────────── */

	/** 本泵是否有一次推进在飞（一次 followup 到 agent 空闲之间都算）。 */
	let pumpInFlight = false;
	/** 兜底 sleep 的句柄与 resolve（卸载时要能清掉并解开挂起的 Promise）。 */
	let pumpTimeout: unknown;
	let pendingSleepResolve: (() => void) | undefined;

	/** 可被卸载打断的 sleep（卸载时不留下永远 pending 的 Promise）。 */
	const sleep = (ms: number): Promise<void> =>
		new Promise<void>((resolve) => {
			pendingSleepResolve = resolve;
			pumpTimeout = setTimeoutFn(() => {
				pendingSleepResolve = undefined;
				pumpTimeout = undefined;
				resolve();
			}, ms);
		});

	/** 等 `work` 落定或超时（超时后清掉定时器，别让宿主进程被挂 5 分钟）。 */
	const raceWithTimeout = async (work: Promise<unknown>, ms: number): Promise<void> => {
		let handle: unknown = undefined;
		const timer = new Promise<void>((resolve) => {
			handle = setTimeoutFn(() => {
				resolve();
			}, ms);
		});
		try {
			await Promise.race([work.then(() => undefined), timer]);
		} finally {
			clearTimeoutFn(handle);
		}
	};

	/** 等这些 agent 空闲；没人给 `whenIdle`（或它不 resolve）时靠 5 分钟兜底。 */
	const waitAgentsIdle = async (agents: readonly AgentLike[]): Promise<void> => {
		const waiters: Promise<unknown>[] = [];
		for (const agent of agents) {
			const idle = agent.whenIdle;
			if (typeof idle !== 'function') continue;
			try {
				waiters.push(idle.call(agent));
			} catch (error) {
				warn('调用 agent.whenIdle() 抛错（忽略该 agent）。', error);
			}
		}

		if (waiters.length === 0) {
			await sleep(PUMP_IDLE_TIMEOUT_MS);
			return;
		}
		await raceWithTimeout(Promise.allSettled(waiters), PUMP_IDLE_TIMEOUT_MS);
	};

	/**
	 * 泵一轮。
	 *
	 * 早退条件**全部是「什么都不做」**（用户裁定：清单空 / 无活 agent / 已在飞 ⇒ 不 followup）：
	 * ```
	 * pump=false     ⇒ 定时器根本没建（apply 里跳过）
	 * 在飞           ⇒ 跳过（不叠加唤醒）
	 * 清单空         ⇒ 跳过
	 * 无活 agent     ⇒ 跳过（TODO: 冷会话 resolveAgent）
	 * ```
	 */
	const runPump = async (): Promise<void> => {
		if (!pumpEnabled || pumpInFlight) return;

		const digest = workDigestOf(cardsOf());
		if (digest === null) return;

		const agents = liveAgentsOf();
		if (agents.length === 0) return;

		pumpInFlight = true;
		try {
			const message = textMessage(digest);
			let delivered = 0;
			for (const agent of agents) {
				try {
					agent.followup(message);
					delivered += 1;
				} catch (error) {
					warn('推进消息投递失败（单个 agent），继续投给其余 agent。', error);
				}
			}
			if (delivered === 0) return;
			await waitAgentsIdle(agents);
		} finally {
			pumpInFlight = false;
		}
	};

	/** interval 的回调：异步体必须就地 catch，否则 unhandled rejection 会终止进程。 */
	const tick = (): void => {
		void runPump().catch((error: unknown) => {
			warn('工作泵一轮失败（下一轮照常）。', error);
		});
	};

	/* pump=false ⇒ 不建定时器（「关掉工作泵」不该留一个空转的 interval）。 */
	let intervalHandle: unknown;
	if (pumpEnabled) intervalHandle = setIntervalFn(tick, intervalMs);

	/* ───────────────────────── 清理（全部进 effect） ───────────────────────── */

	if (typeof ctx.effect !== 'function') {
		/*
		 * 真实 Cordis `Context` 一定有 `effect`（dsh-core / dsh-agent-guard 都这么用）。
		 * 走到这里说明是个不完整的假 ctx —— 订阅与定时器没人清，必须说一声。
		 */
		warn('宿主没有 ctx.effect：总线订阅与定时器在卸载时不会被清理。');
	}
	ctx.effect?.(
		() => () => {
			disposeBus();
			if (intervalHandle !== undefined) {
				clearIntervalFn(intervalHandle);
				intervalHandle = undefined;
			}
			if (pumpTimeout !== undefined) {
				clearTimeoutFn(pumpTimeout);
				pumpTimeout = undefined;
			}
			/* 解开可能挂起的兜底 sleep（否则闭包与 Promise 都留在内存里）。 */
			pendingSleepResolve?.();
			pendingSleepResolve = undefined;
		},
		'taskboard3-agent-loop: unread inject + work pump',
	);
}

export { unreadDigestOf, unreadKeyOf, workDigestOf, WORK_DIGEST_LIMIT } from './pure/loop-judgment.ts';
export type { LoopCard, UnreadDigest } from './pure/loop-judgment.ts';
