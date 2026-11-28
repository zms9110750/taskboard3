/**
 * 权限 guard 测试 —— **这是安全边界，要穷举**。
 *
 * ## 四层分开测
 *
 * | 层 | 测什么 | 为什么分开 |
 * |---|---|---|
 * | `holderOf` | 卡片持有者标识怎么取 | 只认名字；拿不到名字 ⇒ 无 holder（`''`），不回落 UUID（issue #42 Bug 2） |
 * | `heldWorkCardsOf` | 收集持有的工作卡 | 「只查第一个空间」这个已知限制的后果 |
 * | `createPermissionGuard` | 端到端：两条正交轴的档位组合 | 真正的行为 |
 * | 依赖面 | `judgeToolCall` 收到什么、**不**读什么 | 防止「悄悄又接回 DSH 预设」 |
 *
 * ## ⚠ 两套档位各归其主（`2026-11-23` 用户裁决）
 *
 * > 「权限，一个在 core 的 ui 里面。一个在 agent ui 里面，core 完全不知道也不干涉
 * >   agent 的那一侧的注入权限。」
 *
 * ⇒ `cardActionLevel`（UI 轴）留在 core，`toolGuardLevel`（agent 侧）**归本包**、
 *   借用 store 的 kv 端口落库。所以本文件的用例这样改档位：
 *
 * ```
 * taskboard.setCardActionLevel(...)        ← UI 轴：core 的方法
 * writeToolGuardLevel(store, ...)          ← agent 侧：本包的函数，写 kv
 * ```
 *
 * 然后断言 **guard 的行为跟着变**。默认值：`cardActionLevel = 'no-claim'`、
 * `toolGuardLevel = 'off'`。
 *
 * ## ⚠ 与 DSH 自己的权限不再有关系
 *
 * 上一版 guard 会读 `ctx.permissionPresets` 里的预设名反推 `BoardMode`。
 * `2026-11-19` 把那一整层删掉了 —— 这里留一条**否定断言**：
 * 就算把 `permissionPresets` 塞进依赖，结果也不该被它左右。
 */

import assert from 'node:assert/strict';
import { createSqliteStore } from '@taskboard/io';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { BASE_TOOLS, createTaskboard, type Taskboard } from '@taskboard/core';
import { TaskState } from '@taskboard/protocol';

import {
	createPermissionGuard,
	heldWorkCardsOf,
	holderOf,
	type PermissionSubagentsLike,
} from '../src/permission.ts';
import { writeToolGuardLevel } from '../src/tool-guard.ts';

/* ────────────────────────────── 夹具 ────────────────────────────── */

/**
 * ⚠ **每个用例一个全新数据目录**（在 `beforeEach` 里建）。
 *
 * 不是洁癖 —— `heldWorkCardsOf` 只查 `listWorkspaces()[0]`（已知限制，
 * 见 `src/permission.ts` 文件头）。若共用同一个目录，前面用例建的空间会排在
 * 第一个 ⇒ 新用例把卡建在**第三个空间**，guard 永远看不到它。
 */
let taskboard: Taskboard | undefined;
/**
 * agent 侧档位的存储端口。
 *
 * ⚠ 档位**不在 core 上了**（用户 2026-11-23：core 不干涉 agent 那一侧的注入权限）
 * ⇒ 测试里改档位要直接写 store 的 kv，不再有 `taskboard.setToolGuardLevel()`。
 */
let store: ReturnType<typeof createSqliteStore>;
let workspaceId = '';

async function closeTaskboard(): Promise<void> {
	if (taskboard === undefined) return;
	const closing = taskboard;
	taskboard = undefined;
	await closing.close();
}

/**
 * 取当前实例。
 *
 * `taskboard` 声明成 `Taskboard | undefined` 是为了让 `closeTaskboard` 能表达
 * 「已关闭」——不是 `undefined as unknown as Taskboard` 那种骗类型；
 * 用例体里一律经这个收窄函数取（`beforeEach` 之后它一定存在）。
 */
function tb(): Taskboard {
	const current = taskboard;
	if (current === undefined) throw new Error('taskboard 尚未初始化');
	return current;
}

/** 用例级临时目录（跑完统一清）。 */
const createdDirs: string[] = [];

after(async () => {
	await closeTaskboard();
	for (const dir of createdDirs) {
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
	taskboard = createTaskboard({ store: (store = createSqliteStore(dir)) });
	const created = await tb().createWorkspace('权限测试');
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
	const template = tb().listTemplates().find((one) => one.kind === 'work');
	assert.notEqual(template, undefined, '应当存在 work 模板');
	const ref = template?.ref ?? '';

	const created = await tb().create({ workspaceId, templateRef: ref, title, actor: 'user' });
	assert.equal(created.ok, true, created.ok ? '' : created.message);
	if (!created.ok) return '';
	const cardId = created.card.id;

	const adopted = await tb().transition(workspaceId, cardId, TaskState.SUBMITTED, 'button');
	assert.equal(adopted.ok, true, adopted.ok ? '' : adopted.message);

	const claimed = await tb().claim(workspaceId, cardId, 'ai', holder);
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

	it('没有 subagents 服务 ⇒ 无 holder（不猜 UUID；issue #42 Bug 2）', () => {
		assert.equal(holderOf(undefined, execOf({ agent: { id: 'solo-uuid' } })), '');
	});

	it('namesOf 抛错 ⇒ 无 holder（不猜 UUID；issue #42 Bug 2）', () => {
		const subagents: PermissionSubagentsLike = {
			namesOf() {
				throw new Error('not in tree');
			},
		};
		assert.equal(holderOf(subagents, execOf({ agent: { id: 'self-uuid' } })), '');
	});

	/*
	 * ⚠ issue #42 Bug 2（lead 裁定：统一到 fail-safe 的 `''`）。
	 *
	 * 本包 holderOf 曾经在 namesOf 空串 / 缺席 / 抛错时回落 `agent.id`（UUID）；
	 * 但卡只会以 `namesOf.self`（名字）被领取 ⇒ UUID 回落**永远查不到已领卡**，
	 * 是死语义 + 地雷（有人在 UUID 下领卡时 guard 与 tools 的读写语义就会错位）。
	 *
	 * ⇒ 现在三种拿不到名字的情况都当作**无 holder**，判定走「无持有卡」路径
	 *   （`heldWorkCardsOf('')` 直接返回空数组，不会误匹配）。
	 */
	it('namesOf 返回空串 ⇒ 无 holder（不回落 agent.id；issue #42 Bug 2）', () => {
		assert.equal(holderOf(subagentsOf(''), execOf({ agent: { id: 'u' } })), '');
	});

	it('namesOf 的 self 缺席（非字符串）⇒ 无 holder（不回落 agent.id）', () => {
		/* 类型声明保证不了运行时形状：显式模拟 self 缺失，钉住回落分支。 */
		const subagents = { namesOf: () => ({}) } as unknown as PermissionSubagentsLike;
		assert.equal(holderOf(subagents, execOf({ agent: { id: 'u' } })), '');
	});

	it('subagents 形状不全（没有 namesOf）⇒ 无 holder', () => {
		assert.equal(holderOf({ rootOf: () => ({ id: 'x' }) }, execOf({ agent: { id: 'u' } })), '');
	});

	it('agent 存在但 id 为空 ⇒ 无 holder（id 已不参与判定）', () => {
		assert.equal(holderOf(undefined, execOf({ agent: { id: '' } })), '');
	});
});

/* ────────────────────────── 持有卡收集 ────────────────────────── */

describe('heldWorkCardsOf', () => {
	it('只收「处理中」且是本 holder 持有的卡', async () => {
		const mine = await claimedWorkCard('我的卡', 'lead');
		assert.notEqual(mine, '');

		const { cards, workspaceId: ws } = heldWorkCardsOf(tb(), 'lead');
		assert.equal(ws, workspaceId);
		assert.deepEqual(
			cards.map((one) => one.id),
			[mine],
		);
	});

	it('别的 holder 的卡不收', async () => {
		await claimedWorkCard('别人的卡', 'reviewer');

		const { cards } = heldWorkCardsOf(tb(), 'lead');
		assert.equal(cards.length, 0);
	});

	it('未领取（草稿 / 提交）的卡不算持有', async () => {
		const template = tb().listTemplates().find((one) => one.kind === 'work');
		if (template === undefined) return;
		const created = await tb().create({ workspaceId, templateRef: template.ref, title: '还是草稿', actor: 'user' });
		assert.equal(created.ok, true);

		const { cards } = heldWorkCardsOf(tb(), 'lead');
		assert.equal(cards.length, 0, '草稿 / 提交态不算「领取了工作」');
	});

	it('holder 为空或 unknown ⇒ 空数组（不查）', () => {
		assert.deepEqual(heldWorkCardsOf(tb(), '').cards, []);
		assert.deepEqual(heldWorkCardsOf(tb(), 'unknown').cards, []);
	});
});

/* ────────────────────────── guard 端到端 ────────────────────────── */

describe('createPermissionGuard', () => {
	/** 造 guard（档位**不注入** —— 它从 taskboard + kv 读）。 */
	function guardOf(options: { subagents?: unknown } = {}): (exec: unknown) => string | undefined {
		return createPermissionGuard({
			taskboard: tb(),
			kv: store,
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
		await writeToolGuardLevel(store, 'off');
		await tb().setCardActionLevel('no-claim');
		const guard = guardOf({ subagents: subagentsOf('lead') });

		assert.notEqual(guard(exec('taskboard_claim')), undefined, 'off 档下 claim 仍受 cardLevel 管');
		assert.notEqual(guard(exec('taskboard_adopt')), undefined, 'off 档下 adopt 仍受 cardLevel 管');
	});

	it('cardLevel=claim：领卡放行，采纳仍拒', async () => {
		await tb().setCardActionLevel('claim');
		const guard = guardOf({ subagents: subagentsOf('lead') });

		assert.equal(guard(exec('taskboard_claim')), undefined, '允许领卡 ⇒ claim 放行');
		assert.notEqual(guard(exec('taskboard_adopt')), undefined, '允许领卡 ≠ 允许采纳');
	});

	it('cardLevel=adopt：领卡与采纳都放行', async () => {
		await tb().setCardActionLevel('adopt');
		const guard = guardOf({ subagents: subagentsOf('lead') });

		assert.equal(guard(exec('taskboard_claim')), undefined);
		assert.equal(guard(exec('taskboard_adopt')), undefined);
	});

	/* ── 第二段：其它工具（只看 toolLevel） ── */

	it('toolLevel=manage + BASE 工具 ⇒ 放行（不需要领卡）', async () => {
		await writeToolGuardLevel(store, 'manage');
		/*
		 * ⚠ `taskboard_claim` 也在 BASE 里，但它同时受**第一段**（UI 轴）管 ——
		 *   `no-claim` 档下会被拒。这里把 UI 轴调到 claim，测的才是
		 *   「BASE 工具不需要领卡」这件事本身。
		 */
		await tb().setCardActionLevel('claim');
		const guard = guardOf({ subagents: subagentsOf('lead') });
		for (const name of BASE_TOOLS) {
			assert.equal(guard(exec(name)), undefined, `BASE 工具「${name}」不该被拦`);
		}
	});

	it('toolLevel=manage + 执行类 + 没有卡 ⇒ 拒绝，且说清「先领卡」', async () => {
		await writeToolGuardLevel(store, 'manage');
		const guard = guardOf({ subagents: subagentsOf('lead') });
		const verdict = guard(exec('bash'));
		assert.notEqual(verdict, undefined, '没领卡跑 bash 该被拒');
		assert.ok(verdict?.includes('工作卡'), `理由应说清要领卡：${verdict}`);
	});

	it('⚠ holder 为空串 ⇒ 按无持有卡判（空 self 不猜 UUID；issue #42 Bug 2）', async () => {
		/*
		 * 布置一张被 `lead` 持有的卡，但 namesOf 返回空串。
		 * 若旧语义回落 agent.id，而这里 agent.id 恰好是 `lead`，
		 * guard 就会「找到」这张卡、走进「模板不授予」分支；
		 * 新语义把空 self 当无 holder ⇒ 必须走「没有持有任何工作卡」。
		 */
		await writeToolGuardLevel(store, 'manage');
		await claimedWorkCard('空 self 领的卡', 'lead');
		const guard = guardOf({ subagents: subagentsOf('') });
		const verdict = guard(exec('bash', 'lead'));
		assert.notEqual(verdict, undefined, '空 holder 没有卡，bash 该被拒');
		assert.ok(verdict?.includes('没有持有任何工作卡'), `应走无卡路径，而不是按 agent.id 找卡：${verdict}`);
	});

	it('toolLevel=manage + 持有卡但独立档没有 ⇒ 拒绝', async () => {
		await writeToolGuardLevel(store, 'manage');
		await claimedWorkCard('要写代码', 'lead');
		const guard = guardOf({ subagents: subagentsOf('lead') });
		assert.notEqual(guard(exec('bash')), undefined, '独立档里没 bash 该被拒');
	});

	it('toolLevel=manage + 独立档有 ⇒ 放行；没有的仍拒绝', async () => {
		await writeToolGuardLevel(store, 'manage');
		const cardId = await claimedWorkCard('要写代码', 'lead');
		const ref = tb().get(workspaceId, cardId);
		assert.equal(ref.ok, true);
		if (!ref.ok) return;
		const set = await tb().setTemplatePolicy(ref.card.template.ref, ['bash', 'write']);
		assert.equal(set.ok, true);

		const guard = guardOf({ subagents: subagentsOf('lead') });
		assert.equal(guard(exec('bash')), undefined, '独立档里有 bash 该放行');
		assert.notEqual(guard(exec('edit')), undefined, '独立档里没有 edit 仍该拒');
	});

	it('toolLevel=manage：通用档对所有工作卡生效', async () => {
		await writeToolGuardLevel(store, 'manage');
		await claimedWorkCard('吃通用档', 'lead');
		await tb().setCommonPolicy(['bash']);
		const guard = guardOf({ subagents: subagentsOf('lead') });
		assert.equal(guard(exec('bash')), undefined);
	});

	it('toolLevel=manage：组档只对组成员生效', async () => {
		await writeToolGuardLevel(store, 'manage');
		const cardId = await claimedWorkCard('组测试', 'lead');
		const ref = tb().get(workspaceId, cardId);
		assert.equal(ref.ok, true);
		if (!ref.ok) return;
		const templateRef = ref.card.template.ref;

		await tb().setGroupPolicy('别组', ['bash']);
		await tb().setGroupMembers('别组', ['完全不存在的模板']);
		let guard = guardOf({ subagents: subagentsOf('lead') });
		assert.notEqual(guard(exec('bash')), undefined, '卡不在组里 ⇒ 组增量不生效');

		await tb().setGroupMembers('别组', [templateRef]);
		guard = guardOf({ subagents: subagentsOf('lead') });
		assert.equal(guard(exec('bash')), undefined, '卡在组里 ⇒ 组增量生效');
	});

	it('⚠ 只读权限工具：manage + 未持卡也放行（读：无门槛；issue #42 Bug 1）', async () => {
		/*
		 * `taskboard_tool_policy_read` 不在 BASE / POLICY / EXECUTION / READONLY
		 * 任何集合里 —— 修复前会落到「没持卡 ⇒ 拒绝」，用户连当前档位都查不了。
		 */
		await writeToolGuardLevel(store, 'manage');
		const guard = guardOf({ subagents: subagentsOf('lead') });
		assert.equal(guard(exec('taskboard_tool_policy_read')), undefined, '读工具不该要求持卡');
	});

	it('⚠ 写权限工具：manage（无 manage-edit）仍拒绝（读放行不连带写；issue #42 Bug 1 回归）', async () => {
		await writeToolGuardLevel(store, 'manage');
		const guard = guardOf({ subagents: subagentsOf('lead') });
		const verdict = guard(exec('taskboard_tool_policy'));
		assert.notEqual(verdict, undefined, '写工具仍受 manage-edit 管');
		assert.ok(verdict?.includes('允许编辑档位权限'), `理由该指向那一档：${verdict}`);
	});

	it('⚠ 权限管理工具：manage 拒、manage-edit 放行', async () => {
		await writeToolGuardLevel(store, 'manage');
		let guard = guardOf({ subagents: subagentsOf('lead') });
		const verdict = guard(exec('taskboard_tool_policy'));
		assert.notEqual(verdict, undefined, 'manage 下不该能改档位权限');
		assert.ok(verdict?.includes('允许编辑档位权限'), `理由该指向那一档：${verdict}`);

		await writeToolGuardLevel(store, 'manage-edit');
		guard = guardOf({ subagents: subagentsOf('lead') });
		assert.equal(guard(exec('taskboard_tool_policy')), undefined, 'manage-edit ⇒ 允许改权限');
	});

	it('⚠ 即使把权限工具写进 common 增量，manage 下仍拒绝', async () => {
		/*
		 * core 的判定 ⑥ 在 ⑦（BASE）与四档之前 —— 这是**结构性**保护。
		 * 这里从 dsh 侧确认：把权限工具配进 common 也绕不过去。
		 */
		await writeToolGuardLevel(store, 'manage');
		await tb().setCommonPolicy(['taskboard_tool_policy']);
		const guard = guardOf({ subagents: subagentsOf('lead') });
		assert.notEqual(guard(exec('taskboard_tool_policy')), undefined, '能给自己发权限的工具必须硬拒');
	});

	/* ── 档位来源：三样输入各归其主 ── */

	it('⚠ 档位不来自调用方：exec 上塞 cardLevel / toolLevel 一律无效', async () => {
		/*
		 * `judgeToolCall` 已搬进本包、变成**纯函数**（用户 2026-11-23：agent 侧那套
		 * 权限不归 core）。它的三样输入各归其主：
		 *
		 *   cardLevel ← core（`tb.getCardActionLevel()`）
		 *   toolLevel ← 本包的 kv（`readToolGuardLevelOf(store)`）
		 *   policies  ← core（`tb.getToolPolicies()`）
		 *
		 * ⇒ 调用方（工具执行上下文）只能提供 `toolName` / agent 身份，
		 *   **塞档位字段不能改变判定**。这条就是「档位不由调用方传」的行为证明。
		 */
		await tb().setCardActionLevel('no-claim');
		await writeToolGuardLevel(store, 'manage');
		const guard = guardOf({ subagents: subagentsOf('lead') });

		/* 想放开领卡：塞 cardLevel='adopt' —— 必须仍然拒（core 里是 no-claim）。 */
		const sneakyClaim = {
			...execOf({ agent: { id: 'child' }, name: 'taskboard_claim' }),
			cardLevel: 'adopt',
		} as unknown;
		assert.notEqual(guard(sneakyClaim), undefined, 'cardLevel 只能从 core 读，塞进来不该生效');

		/* 想不管理工具：塞 toolLevel='off' —— 必须仍然拒（kv 里是 manage、无卡）。 */
		const sneakyBash = {
			...execOf({ agent: { id: 'child' }, name: 'bash' }),
			toolLevel: 'off',
		} as unknown;
		assert.notEqual(guard(sneakyBash), undefined, 'toolLevel 只能从 kv 读，塞进来不该生效');
	});

	it('⚠ 不读 DSH 权限预设：塞进去也不影响判定', async () => {
		/*
		 * 旧接线读 `ctx.permissionPresets.current(session)` 再映射成 BoardMode。
		 * 那一层已整个删掉。这里塞一个「预设名 = taskboard-auto」的服务进去
		 * （旧语义下 claim 会放行），断言的却是**默认档位仍然拒 claim**。
		 */
		const withPresetService = createPermissionGuard({
			taskboard: tb(),
			kv: store,
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
		await tb().setCardActionLevel('claim');
		assert.equal(withPresetService(exec('taskboard_claim')), undefined, '档位才是判据');
	});

	it('档位从 taskboard 内部读：改档位 ⇒ guard 行为跟着变', async () => {
		const guard = guardOf({ subagents: subagentsOf('lead') });

		assert.notEqual(guard(exec('taskboard_claim')), undefined, '默认 no-claim');
		await tb().setCardActionLevel('claim');
		assert.equal(guard(exec('taskboard_claim')), undefined, '改 claim 后放行');
		assert.notEqual(guard(exec('taskboard_adopt')), undefined, 'claim 下采纳仍拒');
		await tb().setCardActionLevel('adopt');
		assert.equal(guard(exec('taskboard_adopt')), undefined, '改 adopt 后采纳放行');

		assert.equal(guard(exec('bash')), undefined, '默认 off ⇒ bash 放行');
		await writeToolGuardLevel(store, 'manage');
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
			...tb(),
			listWorkspaces: () => {
				throw new Error('boom');
			},
		} as unknown as Taskboard;
		const guard = createPermissionGuard({ taskboard: broken, kv: store, subagents: subagentsOf('lead') });
		assert.equal(guard(exec('bash')), undefined, '内部错应放行（并 console.error）');
	});

	/* ── DI 通道（用户 2026-11-27 裁定：subagents 走 ctx.inject 的 cell） ── */

	it('resolveSubagents 每次判定读当前值：cell 变 ⇒ holder 跟着变', async () => {
		/* cell 模拟 ctx.inject：服务出现时写入、消失时清空。 */
		let cell: unknown;
		const guard = createPermissionGuard({
			taskboard: tb(),
			kv: store,
			resolveSubagents: () => cell,
		});

		/* cell 空 ⇒ 无 holder（issue #42 Bug 2：不再猜 agent.id）⇒ 按无卡判。 */
		await writeToolGuardLevel(store, 'manage');
		assert.ok(guard(exec('bash', 'uuid-1')) !== undefined, 'manage 且无持有卡应拒');

		/* 服务出现 ⇒ 同一次 guard 生命周期内立刻生效（旧实现拿不到晚到的服务）。 */
		cell = subagentsOf('lead');
		const verdictWithService = guard(exec('bash', 'uuid-1'));
		assert.ok(verdictWithService !== undefined, '无持有卡仍应拒（只是 holder 名字变了）');

		/* 服务消失 ⇒ 无 holder，判定照常走（仍是「无卡 ⇒ 拒」）。 */
		cell = undefined;
		assert.ok(guard(exec('bash', 'uuid-1')) !== undefined, 'cell 清空后按无 holder 判，不影响档位判定');
	});
});

