/**
 * 「工具权限」页预览 —— **真组件 + 桩后端**（一个 HTML 文件，file:// 直开）。
 *
 * ## 构建 / 打开
 *
 * ```powershell
 * # 在仓库根执行（借用 dsh-client 的预览构建器，参数是相对它自己 dev/preview 的路径）
 * node packages/dsh-client/dev/preview/build.mjs ../../../dsh-permissions/dev/preview/tool-permission
 * # 双击 products:
 * packages\dsh-permissions\dev\preview\tool-permission\index.html
 * ```
 *
 * ## 为什么用桩后端（不连真 DSH）
 *
 * 这是**组件预览**，不是集成环境：没有宿主就没有 `/taskboard3/api/*`。
 * 桩只做三件事：
 *
 * | 路由 | 行为 |
 * |---|---|
 * | `GET /api/tools` | 53 个工具（与用户实测规模一致） |
 * | `GET/PUT /api/tool-graph` | **存进 localStorage** ⇒ 刷新页面改动还在（#58 的观感） |
 * | `GET/PUT /api/tool-policy` | 四档策略；PUT 按 `allow/remove` 改本档增量，回新视图（#57） |
 *
 * ⚠ 桩**不校验成环**（那由真服务端的 core 判）。所以这里看不到 400/CYCLE 的
 *   真实失败路径 —— 那条路径的证据在 `verify.mjs` 的状态条断言 + 一次性探针里。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ToolPermissionPage } from '../../../src/renderers/tool-permission/ToolPermissionPage.tsx';
import { injectStyles } from '../../../src/styles.ts';

/* ══════════════════════════════════════════════════════════
   夹具
   ══════════════════════════════════════════════════════════ */

const TOOL_NAMES = [
	'ask_user_question',
	'apply_patch',
	'bash',
	'code_search',
	'cordis_inspect',
	'cordis_inspect_config',
	'cordis_inspect_context',
	'create_goal',
	'edit',
	'exit_plan_mode',
	'get_goal',
	'glob',
	'grep',
	'job_kill',
	'job_list',
	'job_output',
	'list_agents',
	'list_resources',
	'pwsh',
	'read',
	'read_image',
	'read_resource',
	'screenshot',
	'send_message',
	'update_goal',
	'wait_agent',
	'web_fetch',
	'web_search',
	'workflow',
	'write',
	'write_files',
	'workspace_create',
	'workspace_list',
	'workspace_open',
	'workspace_send',
	'workspace_watch',
	'agent_send',
	'taskboard_adopt',
	'taskboard_card',
	'taskboard_cards',
	'taskboard_claim',
	'taskboard_create',
	'taskboard_definitions',
	'taskboard_raw_card',
	'taskboard_release',
	'taskboard_render_check',
	'taskboard_search',
	'taskboard_tool_policy',
	'taskboard_tool_policy_read',
	'taskboard_transition',
	'taskboard_update',
	'taskboard_update_note',
	'taskboard_workspaces',
];

/** `/api/tools` 的 wire 形状（*裸* `{ tools }`，没有信封）。 */
const TOOLS_WIRE = {
	tools: TOOL_NAMES.map((name) => ({ name, description: `${name} 的说明`, parameters: { type: 'object' } })),
};

const TEMPLATES = {
	templates: [
		{ ref: 'tpl-arch', displayName: '技术架构', kind: 'builtin', domain: '代码' },
		{ ref: 'tpl-bug', displayName: '预期不符', kind: 'builtin', domain: '代码' },
		{ ref: 'tpl-review', displayName: '代码评审', kind: 'builtin', domain: '代码' },
		{ ref: 'tpl-plan', displayName: '计划', kind: 'builtin', domain: '核心' },
		{ ref: 'tpl-meeting', displayName: '会议纪要', kind: 'user', domain: '核心' },
		{ ref: 'tpl-doc', displayName: '文档', kind: 'user', domain: '文档' },
	],
};

/** 组图（含一条指向宿主已无工具 `ghost_tool` 的边 —— 演示「已失效」）。 */
const DEMO_GRAPH = {
	groups: [
		{ name: '编码工具', column: 0 },
		{ name: '写操作', column: 1 },
		{ name: '文件类', column: 2 },
	],
	edges: [
		{ from: 'group:编码工具', to: 'group:写操作' },
		{ from: 'group:编码工具', to: 'group:文件类' },
		{ from: 'group:写操作', to: 'tool:taskboard_update' },
		{ from: 'group:文件类', to: 'tool:write' },
		{ from: 'group:文件类', to: 'tool:edit' },
		{ from: 'group:文件类', to: 'tool:ghost_tool' },
	],
};

/** 权限策略（与服务端视图同形；`effective` 每次按并集重算）。 */
interface PolicyWire {
	baseTools: string[];
	unclaimed: string[];
	common: string[];
	groups: { name: string; tools: string[] }[];
	groupMembers: { group: string; templates: string[] }[];
	templates: { templateRef: string; tools: string[] }[];
	effective: { templateRef: string; tools: string[] }[];
}

const DEFAULT_POLICY: PolicyWire = {
	baseTools: ['taskboard_card', 'taskboard_cards', 'read'],
	unclaimed: ['bash', 'grep'],
	common: ['write', 'edit'],
	groups: [{ name: '编码工具', tools: ['apply_patch'] }],
	groupMembers: [{ group: '编码工具', templates: ['tpl-arch', 'tpl-bug'] }],
	templates: [{ templateRef: 'tpl-arch', tools: ['glob', 'workflow'] }],
	effective: [],
};

/* ══════════════════════════════════════════════════════════
   桩后端（localStorage 持久化，刷新还在）
   ══════════════════════════════════════════════════════════ */

const GRAPH_KEY = 'tb3-preview:tool-graph';
const POLICY_KEY = 'tb3-preview:tool-policy';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function readStore<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		if (raw === null) return clone(fallback);
		return JSON.parse(raw) as T;
	} catch {
		return clone(fallback);
	}
}

function writeStore(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* 预览环境，忽略 */
	}
}

/** 服务端的并集规则（这里只是预览夹具；真值在 core 的 effectiveToolsOf）。 */
function effectiveOf(policy: PolicyWire, templateRef: string): string[] {
	const set = new Set<string>(policy.baseTools);
	for (const one of [...policy.unclaimed, ...policy.common]) set.add(one);
	for (const member of policy.groupMembers) {
		if (!member.templates.includes(templateRef)) continue;
		const group = policy.groups.find((one) => one.name === member.group);
		for (const one of group?.tools ?? []) set.add(one);
	}
	for (const one of policy.templates.find((entry) => entry.templateRef === templateRef)?.tools ?? []) set.add(one);
	return [...set];
}

function viewOf(policy: PolicyWire): PolicyWire {
	const { templates } = TEMPLATES;
	return {
		...policy,
		effective: templates.map((one) => ({ templateRef: one.ref, tools: effectiveOf(policy, one.ref) })),
	};
}

/** PUT 的差集语义（`allow` 加入、`remove` 移除、BASE 恒可用）。 */
function applyScope(policy: PolicyWire, body: { tier?: string; templateRef?: string; allow?: string[]; remove?: string[] }): PolicyWire {
	const next = clone(policy);
	const base = new Set(next.baseTools);
	const allow = (body.allow ?? []).filter((one) => !base.has(one));
	const remove = (body.remove ?? []).filter((one) => !base.has(one));

	const pickCurrent = (): string[] => {
		if (body.tier === 'unclaimed') return next.unclaimed;
		if (body.tier === 'claimed') return next.common;
		return next.templates.find((one) => one.templateRef === body.templateRef)?.tools ?? [];
	};
	const current = new Set(pickCurrent());
	for (const one of allow) current.add(one);
	for (const one of remove) current.delete(one);
	const configured = [...current];
	const write = (list: string[]): void => {
		if (body.tier === 'unclaimed') next.unclaimed = list;
		else if (body.tier === 'claimed') next.common = list;
		else if (body.templateRef !== undefined) {
			const others = next.templates.filter((one) => one.templateRef !== body.templateRef);
			next.templates = list.length === 0 ? others : [...others, { templateRef: body.templateRef, tools: list }];
		}
	};
	write(configured);
	return next;
}

/** 装一个只在 `taskboard3/api/*` 上生效的 fetch 替身。 */
function installStub(): void {
	const realFetch = globalThis.fetch.bind(globalThis);

	const respond = (status: number, body: unknown): Response =>
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

	globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		if (!url.includes('taskboard3/api/')) return realFetch(input, init);

		const method = (init?.method ?? 'GET').toUpperCase();

		if (url.endsWith('/tools')) return respond(200, TOOLS_WIRE);

		if (url.endsWith('/templates')) return respond(200, { ok: true, data: TEMPLATES });

		if (url.endsWith('/tool-graph')) {
			if (method === 'GET') return respond(200, { ok: true, data: readStore(GRAPH_KEY, DEMO_GRAPH) });
			const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
			writeStore(GRAPH_KEY, body);
			return respond(200, { ok: true, data: body });
		}

		if (url.endsWith('/tool-policy')) {
			if (method === 'GET') return respond(200, { ok: true, data: viewOf(readStore(POLICY_KEY, DEFAULT_POLICY)) });
			const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Parameters<typeof applyScope>[1]) : {};
			const saved = applyScope(readStore(POLICY_KEY, DEFAULT_POLICY), body);
			writeStore(POLICY_KEY, saved);
			return respond(200, { ok: true, data: viewOf(saved) });
		}

		return realFetch(input, init);
	};
}

/* ══════════════════════════════════════════════════════════
   挂载
   ══════════════════════════════════════════════════════════ */

installStub();
injectStyles();

function App(): React.ReactNode {
	return (
		<div className="tp">
			<header className="tp-bar">
				<strong>工具权限 · 预览</strong>
				<span className="tp-bar__hint">
					桩后端：组图 / 授权改动存 localStorage，<b>刷新页面仍在</b>；工具清单是 53 项夹具。
				</span>
				<button
					type="button"
					className="tp-bar__reset"
					onClick={() => {
						localStorage.removeItem(GRAPH_KEY);
						localStorage.removeItem(POLICY_KEY);
						location.reload();
					}}
				>
					重置演示数据
				</button>
			</header>
			<main className="tp-body">
				<ToolPermissionPage />
			</main>
		</div>
	);
}

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
