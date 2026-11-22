/**
 * 权限 guard 测试 —— **这是安全边界，要穷举**。
 *
 * ## 四层分开测
 *
 * | 层 | 测什么 | 为什么分开 |
 * |---|---|---|
 * | `holderOf` | 卡片持有者标识怎么取 | 三条回落，且必须与 `holder.ts` 一致 |
 * | `heldWorkCardsOf` | 收集持有的工作卡 | 「只查第一个空间」这个已知限制的后果 |
 * | `createPermissionGuard` | 端到端：两条正交轴的档位组合 | 真正的行为 |
 * | 依赖面 | `judgeToolCall` 收到什么、**不**读什么 | 防止「悄悄又接回 DSH 预设」 |
 *
 * ## ⚠ 档位在 core，不在本文件（`2026-11-19` 两条正交轴定稿）
 *
 * core 的 `judgeToolCall` 入参只有 `{ toolName, heldCards }` ——
 * 两个档位（`cardActionLevel` / `toolGuardLevel`）由 `Taskboard` 实例自己从
 * kv 缓存读。所以本文件的用例通过 `taskboard.setCardActionLevel(...)` /
 * `taskboard.setToolGuardLevel(...)` 改档位，然后断言 **guard 的行为跟着变**。
 *
 * 默认值（`core/src/index.ts:188,191`）：
 * `cardActionLevel = 'no-claim'`、`toolGuardLevel = 'off'`。
 *
 * ## ⚠ 与 DSH 自己的权限不再有关系
 *
 * 上一版 guard 会读 `ctx.permissionPresets` 里的预设名反推 `BoardMode`。
 * `2026-11-19` 把那一整层删掉了 —— 这里留一条**否定断言**：
 * 就算把 `permissionPresets` 塞进依赖，结果也不该被它左右。
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
		const created = await taskboard.create({ workspaceId, templateRef: template.ref, title: '还是草稿', actor: 'user' });
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
	/** 造 guard（档位**不注入** —— 它从 taskboard 读）。 */
	function guardOf(options: { subagents?: unknown } = {}): (exec: unknown) => string | undefined {
		return createPermissionGuard({
			taskboard,
			...(options.subagents === undefined ? {} : { subagents: options.subagents }),
		});
	}

	/** 一个「有 agent + 工具名」的 exec。 */
	function exec(name: string, agentId = 'child'): unknown {
		return execOf({ agent: { id: agentId }, name });
	}

	/* ── 第一段：领卡类动作（只看 cardLevel，永远先跑） ── */

	it('⚠ 默认档位（no-claim + off）：领卡与采纳都被拒，普通工具放行', () => {
		const guard = guardOf({ subagents: subagentsOf('lead') });

		const claimVerdict = guard(exec('taskboard_claim'));
		assert.notEqual(claimVerdict, undefined, '默认档位不允许领卡');
		assert.ok(claimVerdict?.includes('不允许领卡'), `理由该说清档位：${claimVerdict}`);

		const adoptVerdict = guard(exec('taskboard_adopt'));
		assert.notEqual(adoptVerdict, undefined, '默认档位不允许采纳草稿');
		assert.ok(adoptVerdict?.includes('采纳草稿'), `理由该说清档位：${adoptVerdict}`);

		/* toolLevel = off ⇒ 第二段不管理工具。 */
		assert.equal(guard(exec('bash')), undefined, 'off 档不管理工具调用');
		assert.equal(guard(exec('taskboard_tool_policy')), undefined, 'off 档连权限工具都不管');
	});

	it('⚠ 第一段不看 toolLevel：off 档也不等于替用户放开领卡', async () => {
		/*
		 * 正交语义的核心：宿主「不管理工具」不等于「用户授权 AI 领卡」。
		 * ⇒ 把 toolLevel 显式设成 off，claim / adopt 仍按 cardLevel 判。
		 */
		await taskboard.setToolGuardLevel('off');
		await taskboard.setCardActionLevel('no-claim');
		const guard = guardOf({ subagents: subagentsOf('lead') });

		assert.notEqual(guard(exec('taskboard_claim')), undefined, 'off 档下 claim 仍受 cardLevel 管');
		assert.notEqual(guard(exec('taskboard_adopt')), undefined, 'off 档下 adopt 仍受 cardLevel 管');
	});

	it('cardLevel=claim：领卡放行，采纳仍拒', async () => {
		await taskboard.setCardActionLevel('claim');
		const guard = guardOf({ subagents: subagentsOf('lead') });

		assert.equal(guard(exec('taskboard_claim')), undefined, '允许领卡 ⇒ claim 放行');
		assert.notEqual(guard(exec('taskboard_adopt')), undefined, '允许领卡 ≠ 允许采纳');
	});

	it('cardLevel=adopt：领卡与采纳都放行', async () => {
		await taskboard.setCardActionLevel('adopt');
		const guard = guardOf({ subagents: subagentsOf('lead') });

		assert.equal(guard(exec('taskboard_claim')), undefined);
		assert.equal(guard(exec('taskboard_adopt')), undefined);
	});

	/* ── 第二段：其它工具（只看 toolLevel） ── */

	it('toolLevel=manage + BASE 工具 ⇒ 放行（不需要领卡）', async () => {
		await taskboard.setToolGuardLevel('manage');
		/*
		 * ⚠ `taskboard_claim` 也在 BASE 里，但它同时受**第一段**（UI 轴）管 ——
		 *   `no-claim` 档下会被拒。这里把 UI 轴调到 claim，测的才是
		 *   「BASE 工具不需要领卡」这件事本身。
		 */
		await taskboard.setCardActionLevel('claim');
		const guard = guardOf({ subagents: subagentsOf('lead') });
		for (const name of BASE_TOOLS) {
			assert.equal(guard(exec(name)), undefined, `BASE 工具「${name}」不该被拦`);
		}
	});

	it('toolLevel=manage + 执行类 + 没有卡 ⇒ 拒绝，且说清「先领卡」', async () => {
		await taskboard.setToolGuardLevel('manage');
		const guard = guardOf({ subagents: subagentsOf('lead') });
		const verdict = guard(exec('bash'));
		assert.notEqual(verdict, undefined, '没领卡跑 bash 该被拒');
		assert.ok(verdict?.includes('工作卡'), `理由应说清要领卡：${verdict}`);
	});

	it('toolLevel=manage + 持有卡但独立档没有 ⇒ 拒绝', async () => {
		await taskboard.setToolGuardLevel('manage');
		await claimedWorkCard('要写代码', 'lead');
		const guard = guardOf({ subagents: subagentsOf('lead') });
		assert.notEqual(guard(exec('bash')), undefined, '独立档里没 bash 该被拒');
	});

	it('toolLevel=manage + 独立档有 ⇒ 放行；没有的仍拒绝', async () => {
		await taskboard.setToolGuardLevel('manage');
		const cardId = await claimedWorkCard('要写代码', 'lead');
		const ref = taskboard.get(workspaceId, cardId);
		assert.equal(ref.ok, true);
		if (!ref.ok) return;
		const set = await taskboard.setTemplatePolicy(ref.card.template.ref, ['bash', 'write']);
		assert.equal(set.ok, true);

		const guard = guardOf({ subagents: subagentsOf('lead') });
		assert.equal(guard(exec('bash')), undefined, '独立档里有 bash 该放行');
		assert.notEqual(guard(exec('edit')), undefined, '独立档里没有 edit 仍该拒');
	});

	it('toolLevel=manage：通用档对所有工作卡生效', async () => {
		await taskboard.setToolGuardLevel('manage');
		await claimedWorkCard('吃通用档', 'lead');
		await taskboard.setCommonPolicy(['bash']);
		const guard = guardOf({ subagents: subagentsOf('lead') });
		assert.equal(guard(exec('bash')), undefined);
	});

	it('toolLevel=manage：组档只对组成员生效', async () => {
		await taskboard.setToolGuardLevel('manage');
		const cardId = await claimedWorkCard('组测试', 'lead');
		const ref = taskboard.get(workspaceId, cardId);
		assert.equal(ref.ok, true);
		if (!ref.ok) return;
		const templateRef = ref.card.template.ref;

		await taskboard.setGroupPolicy('别组', ['bash']);
		await taskboard.setGroupMembers('别组', ['完全不存在的模板']);
		let guard = guardOf({ subagents: subagentsOf('lead') });
		assert.notEqual(guard(exec('bash')), undefined, '卡不在组里 ⇒ 组增量不生效');

		await taskboard.setGroupMembers('别组', [templateRef]);
		guard = guardOf({ subagents: subagentsOf('lead') });
		assert.equal(guard(exec('bash')), undefined, '卡在组里 ⇒ 组增量生效');
	});

	it('⚠ 权限管理工具：manage 拒、manage-edit 放行', async () => {
		await taskboard.setToolGuardLevel('manage');
		let guard = guardOf({ subagents: subagentsOf('lead') });
		const verdict = guard(exec('taskboard_tool_policy'));
		assert.notEqual(verdict, undefined, 'manage 下不该能改档位权限');
		assert.ok(verdict?.includes('允许编辑档位权限'), `理由该指向那一档：${verdict}`);

		await taskboard.setToolGuardLevel('manage-edit');
		guard = guardOf({ subagents: subagentsOf('lead') });
		assert.equal(guard(exec('taskboard_tool_policy')), undefined, 'manage-edit ⇒ 允许改权限');
	});

	it('⚠ 即使把权限工具写进 common 增量，manage 下仍拒绝', async () => {
		/*
		 * core 的判定 ⑤ 在 ⑥（BASE）与四档之前 —— 这是**结构性**保护。
		 * 这里从 dsh 侧确认：把权限工具配进 common 也绕不过去。
		 */
		await taskboard.setToolGuardLevel('manage');
		await taskboard.setCommonPolicy(['taskboard_tool_policy']);
		const guard = guardOf({ subagents: subagentsOf('lead') });
		assert.notEqual(guard(exec('taskboard_tool_policy')), undefined, '能给自己发权限的工具必须硬拒');
	});

	/* ── 依赖面：参数里有什么、没什么 ── */

	it('⚠ judgeToolCall 只收到 { toolName, heldCards }（档位不在入参里）', async () => {
		const cardId = await claimedWorkCard('持有卡', 'lead');
		const ref = taskboard.get(workspaceId, cardId);
		assert.equal(ref.ok, true);
		if (!ref.ok) return;

		/**
		 * 记录 core 被判定的入参。
		 *
		 * ⚠ `input` 必须**显式标注类型**：`spy` 是用对象字面量 + `as unknown as Taskboard`
		 *   造的，字面量里的箭头函数参数**推不出** `Taskboard.judgeToolCall` 的形状
		 *   ⇒ tsc 报 TS7006（implicitly has an 'any' type）。照着 `core/src/index.ts:377` 写。
		 */
		const seen: { readonly toolName: string; readonly heldCards: readonly { readonly templateRef: string }[] }[] = [];
		const spy: Taskboard = {
			...taskboard,
			judgeToolCall: (input: {
				readonly toolName: string;
				readonly heldCards: readonly { readonly templateRef: string }[];
			}) => {
				seen.push(input);
				return { ok: true };
			},
		} as unknown as Taskboard;

		const guard = createPermissionGuard({ taskboard: spy, subagents: subagentsOf('lead') });
		assert.equal(guard(exec('bash')), undefined);

		assert.equal(seen.length, 1, '每次工具调用恰好判一次');
		const input = seen[0] as Record<string, unknown>;
		assert.deepEqual(Object.keys(input).sort(), ['heldCards', 'toolName'], '入参只有两个字段');
		assert.equal(input['toolName'], 'bash');
		assert.deepEqual(input['heldCards'], [{ templateRef: ref.card.template.ref }]);
		assert.equal('mode' in input, false, '旧的 mode 入参必须彻底消失');
		assert.equal('cardLevel' in input, false, '档位由 core 自己读，调用方不该传');
		assert.equal('toolLevel' in input, false, '档位由 core 自己读，调用方不该传');
	});

	it('⚠ 不读 DSH 权限预设：塞进去也不影响判定', async () => {
		/*
		 * 旧接线读 `ctx.permissionPresets.current(session)` 再映射成 BoardMode。
		 * 那一层已整个删掉。这里塞一个「预设名 = taskboard-auto」的服务进去
		 * （旧语义下 claim 会放行），断言的却是**默认档位仍然拒 claim**。
		 */
		const withPresetService = createPermissionGuard({
			taskboard,
			subagents: subagentsOf('lead'),
			...( {
				permissionPresets: {
					current: () => 'taskboard-auto',
					presets: {
						'taskboard-auto': { sandbox: 'danger-full-access', approval: 'never', name: 'x', description: 'x' },
					},
				},
				emit: () => undefined,
			} as unknown as object ),
		});

		const claimVerdict = withPresetService(exec('taskboard_claim'));
		assert.notEqual(claimVerdict, undefined, '默认 no-claim 档必须拒 —— 预设名不该改变判定');

		/* 真正改变判定的是 core 的档位。 */
		await taskboard.setCardActionLevel('claim');
		assert.equal(withPresetService(exec('taskboard_claim')), undefined, '档位才是判据');
	});

	it('档位从 taskboard 内部读：改档位 ⇒ guard 行为跟着变', async () => {
		const guard = guardOf({ subagents: subagentsOf('lead') });

		assert.notEqual(guard(exec('taskboard_claim')), undefined, '默认 no-claim');
		await taskboard.setCardActionLevel('claim');
		assert.equal(guard(exec('taskboard_claim')), undefined, '改 claim 后放行');
		assert.notEqual(guard(exec('taskboard_adopt')), undefined, 'claim 下采纳仍拒');
		await taskboard.setCardActionLevel('adopt');
		assert.equal(guard(exec('taskboard_adopt')), undefined, '改 adopt 后采纳放行');

		assert.equal(guard(exec('bash')), undefined, '默认 off ⇒ bash 放行');
		await taskboard.setToolGuardLevel('manage');
		assert.notEqual(guard(exec('bash')), undefined, '改 manage 后无卡 bash 被拒');
	});

	/* ── 兜底 ── */

	it('工具名空 / agent 缺席 ⇒ 放行（不是我们的判定对象）', () => {
		const guard = guardOf({ subagents: subagentsOf('lead') });
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
		const guard = createPermissionGuard({ taskboard: broken, subagents: subagentsOf('lead') });
		assert.equal(guard(exec('bash')), undefined, '内部错应放行（并 console.error）');
	});
});

