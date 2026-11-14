/**
 * 权限 guard 测试 —— **这是安全边界，要穷举**。
 *
 * ## 三件事分开测
 *
 * | 层 | 测什么 | 为什么分开 |
 * |---|---|---|
 * | `holderOf` | 卡片持有者标识怎么取 | 三条回落，且必须与 `holder.ts` 一致 |
 * | `modeOf` | 预设名 → `BoardMode` 的映射 | 互斥语义的入口：**取不到 = 放行** |
 * | `heldWorkCardsOf` | 收集持有的工作卡 | 「只查第一个空间」这个已知限制的后果 |
 * | `createPermissionGuard` | 端到端：三种模式 + 非任务板预设 | 真正的行为 |
 *
 * ## ⚠ 核心语义：与 DSH 自己的权限互斥
 *
 * 用户原话：
 * > 我说的是和dsh自己的权限互斥。只要开的是他自己或者别的插件提供的权限。
 * > 那么这个插件给的限制都不生效。
 *
 * ⇒ 「不是任务板预设」= 一律放行。这是「开发者权限」的实现方式
 *   （切到 DSH 的完全访问，任务板什么都不管）。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { BASE_TOOLS, createTaskboard, type Taskboard } from '@taskboard/core';
import { TaskState } from '@taskboard/protocol';

import {
	createPermissionGuard,
	heldWorkCardsOf,
	holderOf,
	modeOf,
	type PermissionSubagentsLike,
} from '../src/permission.ts';

/* ────────────────────────────── 夹具 ────────────────────────────── */

const TEMPLATE_DIR = join(dirname(createRequire(import.meta.url).resolve('@taskboard/core/package.json')), 'templates');

let dataDir = '';
let taskboard: Taskboard;
let workspaceId = '';

/**
 * ⚠ **每个用例一个全新数据目录**。
 *
 * 不是洁癖 —— `heldWorkCardsOf` 只查 `listWorkspaces()[0]`（已知限制，
 * 见 `src/permission.ts` 文件头）。若共用 dataDir，前面用例建的空间会排在
 * 第一个 ⇒ 新用例把卡建在**第三个空间**，guard 永远看不到它。
 */
before(() => {
	dataDir = mkdtempSync(join(tmpdir(), 'tb3-perm-'));
});

async function closeTaskboard(): Promise<void> {
	if (taskboard === undefined) return;
	const closing = taskboard;
	taskboard = undefined as unknown as Taskboard;
	await closing.close();
}

/** 用例级临时目录（跑完统一清）。 */
const createdDirs: string[] = [];

after(async () => {
	await closeTaskboard();
	for (const dir of [dataDir, ...createdDirs]) {
		for (let i = 0; i < 10; i += 1) {
			try {
				rmSync(dir, { recursive: true, force: true });
				break;
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
	}
});

beforeEach(async () => {
	await closeTaskboard();
	/* 每个用例独立的库目录（理由见上面）。 */
	const dir = mkdtempSync(join(tmpdir(), 'tb3-perm-case-'));
	createdDirs.push(dir);
	taskboard = createTaskboard({ dataDir: dir });
	taskboard.templates().loadDirectory(TEMPLATE_DIR);
	const created = await taskboard.createWorkspace('权限测试');
	assert.equal(created.ok, true);
	if (created.ok) workspaceId = created.workspace.id;
});

/** 造一个 `exec`（工具执行上下文的最小替身）。 */
function execOf(options: { agent?: unknown; name?: string }): {
	readonly agent?: unknown;
	readonly name?: string;
} {
	return {
		...(options.agent === undefined ? {} : { agent: options.agent }),
		...(options.name === undefined ? {} : { name: options.name }),
	};
}

/** 造一个 subagents 替身：`namesOf` 返回名字。 */
function subagentsOf(self: string): PermissionSubagentsLike {
	return { namesOf: () => ({ self }) };
}

/** 建一张 work 模板的卡并推进到「处理中」（领取）。返回卡编号。 */
async function claimedWorkCard(title: string, holder: string): Promise<string> {
	const template = taskboard.listTemplates().find((one) => one.kind === 'work');
	assert.notEqual(template, undefined, '应当存在 work 模板');
	const ref = template?.ref ?? '';

	const created = await taskboard.create({ workspaceId, templateRef: ref, title, actor: 'user' });
	assert.equal(created.ok, true, created.ok ? '' : created.message);
	if (!created.ok) return '';
	const cardId = created.card.id;

	const adopted = await taskboard.transition(workspaceId, cardId, TaskState.SUBMITTED, 'button');
	assert.equal(adopted.ok, true, adopted.ok ? '' : adopted.message);

	const claimed = await taskboard.claim(workspaceId, cardId, 'ai', holder);
	assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.message);

	return cardId;
}

/* ────────────────────────── holder 解析 ────────────────────────── */

describe('holderOf', () => {
	it('有 subagents 服务 ⇒ 用 agent 名字', () => {
		assert.equal(holderOf(subagentsOf('reviewer/checker'), execOf({ agent: { id: 'uuid' } })), 'reviewer/checker');
	});

	it('agent 缺席 ⇒ unknown', () => {
		assert.equal(holderOf(subagentsOf('lead'), execOf({})), 'unknown');
	});

	it('没有 subagents 服务 ⇒ 回落 agent.id', () => {
		assert.equal(holderOf(undefined, execOf({ agent: { id: 'solo-uuid' } })), 'solo-uuid');
	});

	it('namesOf 抛错 ⇒ 回落 agent.id（不编名字）', () => {
		const subagents: PermissionSubagentsLike = {
			namesOf() {
				throw new Error('not in tree');
			},
		};
		assert.equal(holderOf(subagents, execOf({ agent: { id: 'self-uuid' } })), 'self-uuid');
	});

	it('namesOf 返回空串 ⇒ 回落 agent.id', () => {
		assert.equal(holderOf(subagentsOf(''), execOf({ agent: { id: 'u' } })), 'u');
	});

	it('subagents 形状不全（没有 namesOf）⇒ 当成没有服务', () => {
		assert.equal(holderOf({ rootOf: () => ({ id: 'x' }) }, execOf({ agent: { id: 'u' } })), 'u');
	});

	it('agent.id 为空 ⇒ unknown', () => {
		assert.equal(holderOf(undefined, execOf({ agent: { id: '' } })), 'unknown');
	});
});

/* ────────────────────────── 模式解析 ────────────────────────── */

describe('modeOf', () => {
	it('三个任务板预设各自映射到正确的模式', () => {
		assert.equal(modeOf(() => 'taskboard-plan', {}), 'plan');
		assert.equal(modeOf(() => 'taskboard-work', {}), 'work');
		assert.equal(modeOf(() => 'taskboard-auto', {}), 'auto');
	});

	it('⚠ 不是任务板的预设 ⇒ undefined（互斥语义 ⇒ 放行方向）', () => {
		assert.equal(modeOf(() => 'danger-full-access', {}), undefined, 'DSH 自己的完全访问 ⇒ 不管');
		assert.equal(modeOf(() => 'workspace-write', {}), undefined);
		assert.equal(modeOf(() => 'no-tools', {}), undefined, '别的插件注册的档位 ⇒ 不管');
		assert.equal(modeOf(() => 'custom', {}), undefined);
	});

	it('预设名读取器缺席 ⇒ undefined（没装预设服务）', () => {
		assert.equal(modeOf(undefined, {}), undefined);
	});

	it('读取器返回 undefined / 抛错 ⇒ undefined（不拦）', () => {
		assert.equal(modeOf(() => undefined, {}), undefined);
		assert.equal(
			modeOf(() => {
				throw new Error('boom');
			}, {}),
			undefined,
		);
	});
});

/* ────────────────────────── 持有卡收集 ────────────────────────── */

describe('heldWorkCardsOf', () => {
	it('只收「处理中」且是本 holder 持有的卡', async () => {
		const mine = await claimedWorkCard('我的卡', 'lead');
		assert.notEqual(mine, '');

		const { cards, workspaceId: ws } = heldWorkCardsOf(taskboard, 'lead');
		assert.equal(ws, workspaceId);
		assert.deepEqual(
			cards.map((one) => one.id),
			[mine],
		);
	});

	it('别的 holder 的卡不收', async () => {
		await claimedWorkCard('别人的卡', 'reviewer');

		const { cards } = heldWorkCardsOf(taskboard, 'lead');
		assert.equal(cards.length, 0);
	});

	it('未领取（草稿 / 提交）的卡不算持有', async () => {
		const template = taskboard.listTemplates().find((one) => one.kind === 'work');
		if (template === undefined) return;
		const created = await taskboard.create({ workspaceId, templateRef: template.ref, title: '还是草稿' });
		assert.equal(created.ok, true);

		const { cards } = heldWorkCardsOf(taskboard, 'lead');
		assert.equal(cards.length, 0, '草稿 / 提交态不算「领取了工作」');
	});

	it('holder 为空或 unknown ⇒ 空数组（不查）', () => {
		assert.deepEqual(heldWorkCardsOf(taskboard, '').cards, []);
		assert.deepEqual(heldWorkCardsOf(taskboard, 'unknown').cards, []);
	});
});

/* ────────────────────────── guard 端到端 ────────────────────────── */

describe('createPermissionGuard', () => {
	/** 造 guard，`preset` 是「当前会话选中的预设名」。 */
	function guardOf(options: {
		subagents?: unknown;
		preset?: string | undefined;
		/** 不传 = 没有预设服务。 */
		withPresets?: boolean;
	} = {}): (exec: unknown) => string | undefined {
		const withPresets = options.withPresets ?? true;
		return createPermissionGuard({
			taskboard,
			...(options.subagents === undefined ? {} : { subagents: options.subagents }),
			...(withPresets ? { presetNameOf: () => options.preset } : {}),
		});
	}

	/** 一个「有 agent + 工具名」的 exec。 */
	function exec(name: string, agentId = 'child'): unknown {
		return execOf({ agent: { id: agentId }, name });
	}

	it('⚠ 非任务板预设 ⇒ 一律放行（互斥语义）', () => {
		const guard = guardOf({ subagents: subagentsOf('lead'), preset: 'danger-full-access' });
		assert.equal(guard(exec('bash')), undefined, '完全访问下任务板不该拦任何东西');
		assert.equal(guard(exec('taskboard_tool_policy_set')), undefined, '改权限工具也该放行');
	});

	it('没有预设服务 ⇒ 一律放行', () => {
		const guard = guardOf({ subagents: subagentsOf('lead'), withPresets: false });
		assert.equal(guard(exec('bash')), undefined);
	});

	it('work 模式 + BASE 工具 ⇒ 放行（不需要领卡）', () => {
		const guard = guardOf({ subagents: subagentsOf('lead'), preset: 'taskboard-work' });
		for (const name of BASE_TOOLS) {
			assert.equal(guard(exec(name)), undefined, `BASE 工具「${name}」不该被拦`);
		}
	});

	it('work 模式 + 执行类 + 没有卡 ⇒ 拒绝，且说清「先领卡」', () => {
		const guard = guardOf({ subagents: subagentsOf('lead'), preset: 'taskboard-work' });
		const verdict = guard(exec('bash'));
		assert.notEqual(verdict, undefined, '没领卡跑 bash 该被拒');
		assert.ok(verdict?.includes('工作卡'), `理由应说清要领卡：${verdict}`);
	});

	it('work 模式 + 持有卡但独立档没有 ⇒ 拒绝', async () => {
		await claimedWorkCard('要写代码', 'lead');
		const guard = guardOf({ subagents: subagentsOf('lead'), preset: 'taskboard-work' });
		assert.notEqual(guard(exec('bash')), undefined, '独立档里没 bash 该被拒');
	});

	it('work 模式 + 独立档有 ⇒ 放行；没有的仍拒绝', async () => {
		const cardId = await claimedWorkCard('要写代码', 'lead');
		const ref = taskboard.get(workspaceId, cardId);
		assert.equal(ref.ok, true);
		if (!ref.ok) return;
		const set = await taskboard.setTemplatePolicy(ref.card.template.ref, ['bash', 'write']);
		assert.equal(set.ok, true);

		const guard = guardOf({ subagents: subagentsOf('lead'), preset: 'taskboard-work' });
		assert.equal(guard(exec('bash')), undefined, '独立档里有 bash 该放行');
		assert.notEqual(guard(exec('edit')), undefined, '独立档里没有 edit 仍该拒');
	});

	it('work 模式：通用档对所有工作卡生效', async () => {
		await claimedWorkCard('吃通用档', 'lead');
		await taskboard.setCommonPolicy(['bash']);
		const guard = guardOf({ subagents: subagentsOf('lead'), preset: 'taskboard-work' });
		assert.equal(guard(exec('bash')), undefined);
	});

	it('work 模式：组档只对组成员生效', async () => {
		const cardId = await claimedWorkCard('组测试', 'lead');
		const ref = taskboard.get(workspaceId, cardId);
		assert.equal(ref.ok, true);
		if (!ref.ok) return;
		const templateRef = ref.card.template.ref;

		await taskboard.setGroupPolicy('别组', ['bash']);
		await taskboard.setGroupMembers('别组', ['完全不存在的模板']);
		let guard = guardOf({ subagents: subagentsOf('lead'), preset: 'taskboard-work' });
		assert.notEqual(guard(exec('bash')), undefined, '卡不在组里 ⇒ 组增量不生效');

		await taskboard.setGroupMembers('别组', [templateRef]);
		guard = guardOf({ subagents: subagentsOf('lead'), preset: 'taskboard-work' });
		assert.equal(guard(exec('bash')), undefined, '卡在组里 ⇒ 组增量生效');
	});

	it('⚠ 三种模式下权限管理工具都不可用（改权限要切完全访问）', () => {
		for (const preset of ['taskboard-plan', 'taskboard-work', 'taskboard-auto']) {
			const guard = guardOf({ subagents: subagentsOf('lead'), preset });
			const verdict = guard(exec('taskboard_tool_policy_set'));
			assert.notEqual(verdict, undefined, `${preset} 下不该能改权限`);
			assert.ok(verdict?.includes('完全访问'), `理由该指向完全访问：${verdict}`);
		}
	});

	it('⚠ 即使把权限工具写进 common 增量，三种模式下仍拒绝', async () => {
		/*
		 * core 的判定第 ② 条在四档之前 —— 这是**结构性**保护。
		 * 这里从 dsh 侧确认：把权限工具配进 common 也绕不过去。
		 */
		await taskboard.setCommonPolicy(['taskboard_tool_policy_set']);
		const guard = guardOf({ subagents: subagentsOf('lead'), preset: 'taskboard-work' });
		assert.notEqual(guard(exec('taskboard_tool_policy_set')), undefined, '能给自己发权限的工具必须硬拒');
	});

	it('plan 模式：不能创建、不能领取', () => {
		const guard = guardOf({ subagents: subagentsOf('lead'), preset: 'taskboard-plan' });
		assert.notEqual(guard(exec('taskboard_create')), undefined, 'plan 下不能创建');
		assert.notEqual(guard(exec('taskboard_claim')), undefined, 'plan 下不能领取');
		/* 其它 BASE 工具仍可用。 */
		assert.equal(guard(exec('taskboard_cards')), undefined, 'plan 下读卡可以');
		assert.equal(guard(exec('taskboard_transition')), undefined, 'plan 下改状态可以');
	});

	it('⚠ plan 模式：即使持有工作卡也不吃四档增量', async () => {
		const cardId = await claimedWorkCard('plan 也有卡', 'lead');
		const ref = taskboard.get(workspaceId, cardId);
		assert.equal(ref.ok, true);
		if (!ref.ok) return;
		await taskboard.setCommonPolicy(['bash']);
		await taskboard.setTemplatePolicy(ref.card.template.ref, ['bash']);
		await taskboard.setGroupPolicy('g', ['bash']);
		await taskboard.setGroupMembers('g', [ref.card.template.ref]);

		const guard = guardOf({ subagents: subagentsOf('lead'), preset: 'taskboard-plan' });
		assert.notEqual(guard(exec('bash')), undefined, 'plan 只读 ⇒ 有卡也不该放行 bash');
	});

	it('auto 模式：工具判定与 work 相同（差异只在采纳草稿）', async () => {
		await claimedWorkCard('auto 测试', 'lead');
		const guard = guardOf({ subagents: subagentsOf('lead'), preset: 'taskboard-auto' });
		assert.notEqual(guard(exec('bash')), undefined, 'auto 下也得有增量才放行 bash');
	});

	it('工具名空 / agent 缺席 ⇒ 放行（不是我们的判定对象）', () => {
		const guard = guardOf({ subagents: subagentsOf('lead'), preset: 'taskboard-work' });
		assert.equal(guard(execOf({ agent: { id: 'u' } })), undefined, '没工具名 ⇒ 放行');
		assert.equal(guard(execOf({ name: 'bash' })), undefined, '没 agent ⇒ 放行');
	});

	it('内部抛错 ⇒ 放行并打日志（加装模块坏了不该锁死 dsh）', () => {
		const broken: Taskboard = {
			...taskboard,
			listWorkspaces: () => {
				throw new Error('boom');
			},
		} as unknown as Taskboard;
		const guard = createPermissionGuard({
			taskboard: broken,
			subagents: subagentsOf('lead'),
			presetNameOf: () => 'taskboard-work',
		});
		assert.equal(guard(exec('bash')), undefined, '内部错应放行（并 console.error）');
	});
});
