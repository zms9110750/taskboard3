/**
 * 权限 guard 测试 —— **这是安全边界，要穷举**。
 *
 * ## 分两层测
 *
 * | 层 | 测什么 | 为什么分开 |
 * |---|---|---|
 * | **身份解析**（`identityOf` / `heldWorkCardsOf`） | scope 与 holder 怎么取 | 这是 dsh 侧的逻辑，与 core 的判定无关 |
 * | **guard 端到端**（`createPermissionGuard`） | 四种路径：放行 / 拒绝 / 预设不匹配 / 工具名空 | 这是真正的行为 |
 *
 * ## ⚠ 两个身份不是同一个东西
 *
 * - `scope`（权限编辑开关）= 根会话 **UUID**（`rootOf(agent).id`）
 * - `holder`（卡片持有者）= agent **名字**（`namesOf(agent).self`）
 *
 * 混用会导致「开关打开了但判定看不见」或「持有卡查不到」——
 * 两者都是**静默错误**，所以每条断言都显式写出它期望的是哪个。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createTaskboard, type Taskboard } from '@taskboard/core';
import { TaskState } from '@taskboard/protocol';

import {
	createPermissionGuard,
	heldWorkCardsOf,
	identityOf,
	PERMISSION_PRESET,
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
 *
 * ⇒ 每个用例一个空库 + 一个空间，`[0]` 就是它。
 */
before(() => {
	dataDir = mkdtempSync(join(tmpdir(), 'tb3-perm-'));
});

after(async () => {
	await closeTaskboard();
	for (let i = 0; i < 10; i += 1) {
		try {
			rmSync(dataDir, { recursive: true, force: true });
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
});

async function closeTaskboard(): Promise<void> {
	if (taskboard === undefined) return;
	const closing = taskboard;
	taskboard = undefined as unknown as Taskboard;
	await closing.close();
}

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

/** 用例级临时目录（跑完统一清）。 */
const createdDirs: string[] = [];

after(() => {
	for (const dir of createdDirs) {
		for (let i = 0; i < 5; i += 1) {
			try {
				rmSync(dir, { recursive: true, force: true });
				break;
			} catch {
				/* 重试 */
			}
		}
	}
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

/** 造一个 subagents 替身：rootOf 返回根 id，namesOf 返回名字。 */
function subagentsOf(rootId: string, self: string): PermissionSubagentsLike {
	return {
		rootOf: () => ({ id: rootId }),
		namesOf: () => ({ self }),
	};
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

	/* 草稿 → 提交（采纳）。 */
	const adopted = await taskboard.transition(workspaceId, cardId, TaskState.SUBMITTED, 'button');
	assert.equal(adopted.ok, true, adopted.ok ? '' : adopted.message);

	/* 提交 → 处理中（领取）。 */
	const claimed = await taskboard.claim(workspaceId, cardId, 'ai', holder);
	assert.equal(claimed.ok, true, claimed.ok ? '' : claimed.message);

	return cardId;
}

/* ────────────────────────── 身份解析 ────────────────────────── */

describe('identityOf', () => {
	it('scope 用根会话 UUID，holder 用 agent 名字', () => {
		const subagents = subagentsOf('root-uuid', 'reviewer/checker');
		const identity = identityOf(subagents, execOf({ agent: { id: 'child-uuid' } }));
		assert.equal(identity.scope, 'root-uuid', 'scope 应是根会话 UUID（不是子会话）');
		assert.equal(identity.holder, 'reviewer/checker', 'holder 应是 agent 名字');
	});

	it('agent 缺席 ⇒ 两者都是 unknown', () => {
		const identity = identityOf(subagentsOf('r', 'lead'), execOf({}));
		assert.deepEqual(identity, { scope: 'unknown', holder: 'unknown' });
	});

	it('没有 subagents 服务 ⇒ 两者都回落 agent.id', () => {
		/*
		 * ⚠ 这是**唯一**能自洽的回落：卡上的 holder 也会存成 UUID
		 *   （`holder.ts` 同样回落），开关的 scope 也是 UUID，两边对得上。
		 */
		const identity = identityOf(undefined, execOf({ agent: { id: 'solo-uuid' } }));
		assert.deepEqual(identity, { scope: 'solo-uuid', holder: 'solo-uuid' });
	});

	it('rootOf 抛错 ⇒ scope 回落自己的 id（名字仍能取到）', () => {
		const subagents: PermissionSubagentsLike = {
			rootOf() {
				throw new Error('not in tree');
			},
			namesOf: () => ({ self: 'lead' }),
		};
		const identity = identityOf(subagents, execOf({ agent: { id: 'self-uuid' } }));
		assert.equal(identity.scope, 'self-uuid');
		assert.equal(identity.holder, 'lead');
	});

	it('namesOf 抛错 ⇒ holder 回落 UUID（scope 仍能取到）', () => {
		const subagents: PermissionSubagentsLike = {
			rootOf: () => ({ id: 'root-uuid' }),
			namesOf() {
				throw new Error('not in tree');
			},
		};
		const identity = identityOf(subagents, execOf({ agent: { id: 'self-uuid' } }));
		assert.equal(identity.scope, 'root-uuid');
		assert.equal(identity.holder, 'self-uuid');
	});

	it('两个都抛 ⇒ 两者都回落自己的 UUID（不编名字）', () => {
		const subagents: PermissionSubagentsLike = {
			rootOf() {
				throw new Error('x');
			},
			namesOf() {
				throw new Error('y');
			},
		};
		const identity = identityOf(subagents, execOf({ agent: { id: 'me' } }));
		assert.deepEqual(identity, { scope: 'me', holder: 'me' });
	});

	it('subagents 形状不全（只有 namesOf）⇒ 当成没有服务', () => {
		assert.deepEqual(identityOf({ namesOf: () => ({ self: 'lead' }) }, execOf({ agent: { id: 'u' } })), {
			scope: 'u',
			holder: 'u',
		});
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
	/** 造 guard，默认不带预设过滤。 */
	function guardOf(options: {
		subagents?: unknown;
		presetOf?: (agent: unknown) => string | undefined;
		presetName?: string;
	} = {}): (exec: unknown) => string | undefined {
		return createPermissionGuard({
			taskboard,
			...(options.subagents === undefined ? {} : { subagents: options.subagents }),
			...(options.presetOf === undefined ? {} : { presetOf: options.presetOf }),
			...(options.presetName === undefined ? {} : { presetName: options.presetName }),
		});
	}

	it('BASE 里的工具 ⇒ 放行（不需要领卡）', () => {
		const guard = guardOf();
		const verdict = guard(execOf({ agent: { id: 'u' }, name: 'read_file' }));
		assert.equal(verdict, undefined, 'BASE 工具不该被拦');

		const taskboardTool = guard(execOf({ agent: { id: 'u' }, name: 'taskboard_cards' }));
		assert.equal(taskboardTool, undefined, '任务板工具也在 BASE 里');
	});

	it('执行类工具 + 没有卡 ⇒ 拒绝，且理由说清「先领卡」', () => {
		const guard = guardOf({ subagents: subagentsOf('root', 'lead') });
		const verdict = guard(execOf({ agent: { id: 'child' }, name: 'bash' }));
		assert.notEqual(verdict, undefined, '没领卡跑 bash 该被拒');
		assert.ok(verdict?.includes('工作卡'), `理由应说清要领卡：${verdict}`);
	});

	it('执行类工具 + 持有卡但 extra 没有 ⇒ 拒绝', async () => {
		await claimedWorkCard('要写代码', 'lead');
		const guard = guardOf({ subagents: subagentsOf('root', 'lead') });
		const verdict = guard(execOf({ agent: { id: 'child' }, name: 'bash' }));
		assert.notEqual(verdict, undefined, 'extra 里没 bash 该被拒');
	});

	it('执行类工具 + 持有卡的 extra 有 ⇒ 放行', async () => {
		const cardId = await claimedWorkCard('要写代码', 'lead');
		assert.notEqual(cardId, '');

		const ref = taskboard.get(workspaceId, cardId);
		assert.equal(ref.ok, true);
		if (!ref.ok) return;
		const set = await taskboard.setToolPolicy(ref.card.template.ref, ['bash', 'write']);
		assert.equal(set.ok, true);

		const guard = guardOf({ subagents: subagentsOf('root', 'lead') });
		assert.equal(guard(execOf({ agent: { id: 'child' }, name: 'bash' })), undefined, 'extra 里有 bash 该放行');
		assert.notEqual(guard(execOf({ agent: { id: 'child' }, name: 'edit' })), undefined, 'extra 里没有 edit 仍该拒');
	});

	it('权限管理工具：开关关着 ⇒ 拒绝', () => {
		const guard = guardOf({ subagents: subagentsOf('root', 'lead') });
		const verdict = guard(execOf({ agent: { id: 'child' }, name: 'taskboard_tool_policy_set' }));
		assert.notEqual(verdict, undefined, '开关关着不该能改权限');
	});

	it('权限管理工具：开关打开（按 scope = 根会话 UUID）⇒ 放行', () => {
		taskboard.setPolicyEdit('root', true);
		const guard = guardOf({ subagents: subagentsOf('root', 'lead') });
		assert.equal(
			guard(execOf({ agent: { id: 'child' }, name: 'taskboard_tool_policy_set' })),
			undefined,
			'开关开着该放行',
		);
	});

	it('⚠ 开关按 scope 隔离：开了别的 scope 不影响本 scope', () => {
		taskboard.setPolicyEdit('other-root', true);
		const guard = guardOf({ subagents: subagentsOf('root', 'lead') });
		assert.notEqual(
			guard(execOf({ agent: { id: 'child' }, name: 'taskboard_tool_policy_set' })),
			undefined,
			'开了别的会话的开关，本会话仍该拒',
		);
	});

	it('预设不匹配 ⇒ 完全不管（放行）', () => {
		const guard = guardOf({
			subagents: subagentsOf('root', 'lead'),
			presetOf: () => 'workspace-write',
			presetName: PERMISSION_PRESET,
		});
		assert.equal(guard(execOf({ agent: { id: 'child' }, name: 'bash' })), undefined, '不是我们的预设 ⇒ 不管');
	});

	it('预设匹配 ⇒ 开始判（无卡跑 bash 被拒）', () => {
		const guard = guardOf({
			subagents: subagentsOf('root', 'lead'),
			presetOf: () => PERMISSION_PRESET,
			presetName: PERMISSION_PRESET,
		});
		assert.notEqual(guard(execOf({ agent: { id: 'child' }, name: 'bash' })), undefined);
	});

	it('没有 presetOf（没装权限预设服务）⇒ 对所有调用生效', () => {
		const guard = guardOf({ subagents: subagentsOf('root', 'lead') });
		assert.notEqual(guard(execOf({ agent: { id: 'child' }, name: 'bash' })), undefined, '没预设服务时也该判');
	});

	it('工具名空 / agent 缺席 ⇒ 放行（不是我们的判定对象）', () => {
		const guard = guardOf({ subagents: subagentsOf('root', 'lead') });
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
		const guard = createPermissionGuard({ taskboard: broken, subagents: subagentsOf('root', 'lead') });
		assert.equal(guard(execOf({ agent: { id: 'child' }, name: 'bash' })), undefined, '内部错应放行（并 console.error）');
	});
});
