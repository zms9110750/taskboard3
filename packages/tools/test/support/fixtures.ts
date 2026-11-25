/**
 * tools v2 测试夹具 —— **只给测试用**。
 *
 * 用内存 store + 程序注册模板：测试要能用「已知模板/章节/分类」精确断言文案，
 * 也要造出内置 YAML 里没有的「空模板」。
 *
 * ⚠ 跨包 import 走包名（`@taskboard/core` → `lib/`），所以跑测试前先
 *   `tsc -b packages/tools`。本包自己的源码是直接跑 `src/` 的。
 */

import { createTaskboard, type CardActionLevel, type Taskboard } from '@taskboard/core';

import { createTaskboardToolRegistry } from '../../src/registry.ts';
import { createTaskboardTools } from '../../src/tools.ts';
import type {
	TaskboardTool,
	TaskboardToolContext,
	TaskboardToolRegistry,
	TaskboardToolResult,
} from '../../src/index.ts';
import { createMemoryStore } from './memory-store.ts';

/** 一个 text 章节。 */
function textSection(id = 'body', label = '正文') {
	return { id, label, hint: '写正文', action: 'text', defaultPayload: { $type: 'text' } };
}

/** 一个 ask 章节（用来测 action 视图）。 */
function askSection(id = 'ask', label = '选择') {
	return {
		id,
		label,
		hint: '选一个',
		action: 'ask',
		defaultPayload: {
			$type: 'ask',
			items: [{ question: '选哪个', options: [{ label: 'A' }, { label: 'B' }], picked: ['A'] }],
		},
	};
}

/** 模板定义（结构上与 core 的 TemplateDef 一致）。 */
function template(input: {
	readonly ref: string;
	readonly kind: string;
	readonly domain?: string;
	readonly displayName?: string;
	readonly codePrefix?: string;
	readonly description?: string;
	readonly usage?: string;
	readonly sections?: readonly ReturnType<typeof textSection | typeof askSection>[];
}) {
	return {
		ref: input.ref,
		displayName: input.displayName ?? input.ref,
		kind: input.kind,
		domain: input.domain ?? '核心',
		codePrefix: input.codePrefix ?? 'X',
		usage: input.usage ?? '',
		description: input.description ?? '',
		sections: input.sections ?? [textSection()],
		derives: [],
	};
}

/** 测试模板集合。 */
export const TEMPLATES = Object.freeze([
	template({
		ref: 't-work',
		kind: 'work',
		displayName: '工作模板',
		codePrefix: 'W',
		description: '写完后开校验卡，别在交付里附一次性脚本。',
		usage: '真正动手做的事。',
		sections: [textSection('body', '正文'), askSection('ask', '选择')],
	}),
	template({
		ref: 't-goal',
		kind: 'goal',
		displayName: '目标模板',
		codePrefix: 'G',
		description: '目标卡采纳后等子任务推进。',
	}),
	template({
		ref: 't-design',
		kind: 'design',
		displayName: '设计模板',
		codePrefix: 'D',
		description: '设计卡采纳后等用户确认。',
	}),
	/* 空模板：模板自身没有分类/领域（内置 YAML 里没有这种形态）。 */
	template({
		ref: 'blank',
		kind: '',
		domain: '',
		displayName: '空模板',
		codePrefix: 'B',
	}),
]);

export interface Fixture {
	readonly tb: Taskboard;
	readonly ws: string;
	readonly registry: TaskboardToolRegistry;
	readonly tools: readonly TaskboardTool[];
}

/** 建一个测试板（默认 DSH 视角，全部工具可见）。 */
export async function makeFixture(
	options: { readonly cardLevel?: CardActionLevel } = {},
): Promise<Fixture> {
	const tb = createTaskboard({ store: createMemoryStore() });
	for (const one of TEMPLATES) tb.templates().register(one);
	const created = await tb.createWorkspace('测试空间');
	if (!created.ok) throw new Error(`建空间失败：${created.message}`);
	const ws = created.workspace.id;
	/*
	 * v2 第二轮恢复了 UI 轴：默认档位是 `no-claim`（AI 不能领卡/采纳）。
	 * 普通流程用例默认调到 `adopt`；专门测权限的用例显式传 `cardLevel:'no-claim'`。
	 */
	await tb.setCardActionLevel(options.cardLevel ?? 'adopt');
	const tools = createTaskboardTools(tb);
	const registry = createTaskboardToolRegistry(tools, { host: 'dsh' });
	return { tb, ws, registry, tools };
}

/** 默认调用上下文（宿主已接好激活空间 / 身份 / 权限开关）。 */
export function context(fixture: Fixture, over: TaskboardToolContext = {}): TaskboardToolContext {
	return {
		holder: 'lead',
		// TODO(审查): 这个字段在 tools 里已零读取（权限工具搬去 dsh-agent-guard，见 types.ts 的 TODO）；
		// transition-tool.test.ts:113 也还在填它。可直接删（含那条测试里的同名字段）。
		canManageToolPolicies: true,
		...over,
	};
}

/** 不需要 workspaceId 的工具（自己列空间 / 读定义）。 */
const NO_WORKSPACE_TOOLS: ReadonlySet<string> = new Set([
	'taskboard_workspaces',
	'taskboard_definitions',
	// TODO(审查): 'taskboard_tool_policy_read' 已不在本包（createTaskboardTools 只返回 9 个，两个权限工具在 dsh-agent-guard）——
	// 这个白名单项是死条目。可直接删。
	'taskboard_tool_policy_read',
]);

/**
 * 跑一个工具（默认带完整上下文）。
 *
 * ⚠ 用户 2026-11-22 取消了「激活空间」⇒ 需要空间的工具必须显式给 `workspaceId`。
 *   夹具在这里补上（测试参数里显式给了就不覆盖）。
 */
export async function run(
	fixture: Fixture,
	name: string,
	args: unknown = {},
	ctx: TaskboardToolContext | undefined = undefined,
): Promise<TaskboardToolResult> {
	let finalArgs: unknown = args;
	if (
		!NO_WORKSPACE_TOOLS.has(name) &&
		typeof args === 'object' &&
		args !== null &&
		!('workspaceId' in args)
	) {
		finalArgs = { workspaceId: fixture.ws, ...(args as Record<string, unknown>) };
	}
	return fixture.registry.invoke(name, finalArgs, ctx ?? context(fixture));
}

/** 跑一个工具并断言成功，返回文本。 */
export async function runOk(
	fixture: Fixture,
	name: string,
	args: unknown = {},
	ctx: TaskboardToolContext | undefined = undefined,
): Promise<string> {
	const result = await run(fixture, name, args, ctx);
	if (result.isError === true) throw new Error(`工具 ${name} 意外失败：\n${result.text}`);
	return result.text;
}

/**
 * 直接调 core 建一张卡（用于布置状态），返回编号。
 *
 * @param actor 默认 user：会让卡进入「AI 没看」；AI 建的卡用 actor='ai'
 */
export async function seedCard(
	fixture: Fixture,
	templateRef: string,
	title: string,
	options: {
		readonly actor?: 'ai' | 'user';
		readonly content?: unknown;
		readonly relations?: {
			readonly parent?: string;
			readonly links?: readonly { readonly label: string; readonly to: string }[];
		};
	} = {},
): Promise<string> {
	const created = await fixture.tb.create({
		workspaceId: fixture.ws,
		templateRef,
		title,
		actor: options.actor ?? 'user',
		...(options.content === undefined ? {} : { content: options.content }),
		...(options.relations === undefined ? {} : { relations: options.relations }),
	});
	if (!created.ok) throw new Error(`seedCard 失败：${created.message}`);
	return created.card.id;
}

/** 把草稿推到「提交」（用户采纳路径）。 */
export async function submitCard(fixture: Fixture, id: string): Promise<void> {
	const adopted = await fixture.tb.adopt(fixture.ws, id, 'user');
	if (!adopted.ok) throw new Error(`submitCard 失败：${adopted.message}`);
}

/** 解析工具返回的纯 JSON（raw card 的返回契约）。 */
export function parseJson(text: string): Record<string, unknown> {
	return JSON.parse(text) as Record<string, unknown>;
}

/**
 * #6 `taskboard_update` 的返回是「JSON + 状态/下一步」两段。
 * 取前半段 JSON（按分隔行切）。
 */
export function parseJsonPrefix(text: string): Record<string, unknown> {
	const marker = '\n\n—— 当前状态与接下来可以做什么 ——';
	const index = text.indexOf(marker);
	return JSON.parse(index === -1 ? text : text.slice(0, index)) as Record<string, unknown>;
}
