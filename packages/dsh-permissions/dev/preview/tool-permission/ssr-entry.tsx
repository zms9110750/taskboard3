/**
 * 工具权限页的 **SSR 断言入口** —— 给 `verify.mjs` 用。
 *
 * ## 为什么是 SSR 而不是 CDP
 *
 * 这个环境起不来 headless Chromium（DSH 沙箱禁止命名管道，mojo IPC 直接 FATAL），
 * 拿不到点击 / 截图 / 几何。⇒ 用 `react-dom/server` 把**真组件**渲染成 HTML，
 * 断言它们挂上去的结构（只读标记、折叠两态、选中态、保存状态文案）。
 *
 * 交互判决的可信度来自两条：
 * - 纯函数单测（`test/tool-graph-sync.test.ts` / `test/tool-policy-edit.test.ts`）；
 * - 真浏览器里点一遍（`index.html`，数据用 localStorage 模拟服务端）。
 *
 * ⚠ 这个文件在 `dev/` 下，不进产品构建；它只是给 `node verify.mjs` 打包用的。
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { FALLBACK_TOOL_ENTRIES } from '../../../src/renderers/tool-permission/GraphEditor.tsx';
import { GraphNodeBox } from '../../../src/renderers/tool-permission/GraphNodeBox.tsx';
import { SaveStatusBar } from '../../../src/renderers/tool-permission/SaveStatusBar.tsx';
import {
	AuthSidebar,
	EditBlockedReason,
	EditButton,
	PolicyEditor,
} from '../../../src/renderers/tool-permission/TemplateAuthPanel.tsx';
import { ToolPermissionShell } from '../../../src/renderers/tool-permission/ToolPermissionShell.tsx';
import { editabilityOf } from '../../../src/pure/tool-policy-edit.ts';
import type { ToolPolicySnapshot } from '../../../src/pure/tool-policy.ts';
import type { TemplateSummary } from '../../../src/types.ts';
import type { ToolEntry } from '../../../src/pure/tool-permission.ts';

/* ══════════════════════════════════════════════════════════
   夹具（与产品同一份类型；数据是手写的，不是从产品里导出的第二份真值）
   ══════════════════════════════════════════════════════════ */

/** 53 个工具（用户实测 `/api/tools` 的规模）。 */
const HOST_NAMES = [
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
];

const TASKBOARD_NAMES = [
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

/** 53 项工具清单（37 宿主 + 16 任务板）。 */
export const TOOLS: readonly ToolEntry[] = [...HOST_NAMES, ...TASKBOARD_NAMES].map((name) => ({
	name,
	source: name.startsWith('taskboard_') ? '任务板' : '宿主',
}));

/** 模板清单（3 个领域、6 个模板）。 */
export const TEMPLATES: readonly TemplateSummary[] = [
	{ ref: 'tpl-arch', displayName: '技术架构', kind: 'builtin', domain: '代码' },
	{ ref: 'tpl-bug', displayName: '预期不符', kind: 'builtin', domain: '代码' },
	{ ref: 'tpl-review', displayName: '代码评审', kind: 'builtin', domain: '代码' },
	{ ref: 'tpl-plan', displayName: '计划', kind: 'builtin', domain: '核心' },
	{ ref: 'tpl-meeting', displayName: '会议纪要', kind: 'user', domain: '核心' },
	{ ref: 'tpl-doc', displayName: '文档', kind: 'user', domain: '文档' },
];

/** 权限策略快照（形状对齐 `GET /api/tool-policy`）。 */
export const POLICY: ToolPolicySnapshot = {
	baseTools: ['taskboard_card', 'taskboard_cards', 'read'],
	unclaimed: ['bash', 'grep'],
	common: ['write', 'edit'],
	groups: [{ name: '编码工具', tools: ['apply_patch'] }],
	groupMembers: [{ group: '编码工具', templates: ['tpl-arch', 'tpl-bug'] }],
	templates: [{ templateRef: 'tpl-arch', tools: ['glob', 'workflow'] }],
	effective: [
		{ templateRef: 'tpl-arch', tools: ['taskboard_card', 'read', 'bash', 'grep', 'write', 'edit', 'apply_patch', 'glob', 'workflow'] },
		{ templateRef: 'tpl-bug', tools: ['taskboard_card', 'read', 'bash', 'grep', 'write', 'edit', 'apply_patch'] },
	],
};

/* ══════════════════════════════════════════════════════════
   渲染函数
   ══════════════════════════════════════════════════════════ */

const noop = (): void => {};

/** 页面外壳（issue #55 / #58 的「页面说了什么」）。 */
export function renderShell(options: { readonly origin: 'host' | 'fallback'; readonly fallbackReason?: string }): string {
	return renderToStaticMarkup(
		createElement(ToolPermissionShell, {
			tools: TOOLS,
			origin: options.origin,
			...(options.fallbackReason === undefined ? {} : { fallbackReason: options.fallbackReason }),
		}),
	);
}

/** 画布节点（issue #53 / #54 的只读 / 可点 / 失效态）。 */
export function renderNode(options: {
	readonly kind: 'group' | 'tool';
	readonly label: string;
	readonly member?: boolean;
	readonly blocked?: boolean;
	readonly invalid?: boolean;
	readonly clickable?: boolean;
	readonly cycleText?: string;
}): string {
	const box = { id: 'x', layer: 1, x: 0, y: 0, w: 176, h: 44 };
	return renderToStaticMarkup(
		createElement(GraphNodeBox, {
			node: {
				id: `${options.kind}:${options.label}`,
				kind: options.kind,
				label: options.label,
				...(options.kind === 'tool' ? { source: options.invalid === true ? '宿主已无此工具' : '宿主' } : {}),
			},
			box,
			active: false,
			member: options.member === true,
			blocked: options.blocked === true,
			invalid: options.invalid === true,
			parents: 1,
			memberCount: options.member === true ? 2 : 0,
			...(options.cycleText === undefined ? {} : { cycleText: options.cycleText }),
			...(options.clickable === true ? { onToggle: noop } : {}),
		}),
	);
}

/** 保存状态条（issue #58 的三种结局）。 */
export function renderSave(state: 'idle' | 'saving' | 'saved' | 'failed'): string {
	return renderToStaticMarkup(
		createElement(SaveStatusBar, {
			state:
				state === 'saved'
					? { kind: 'saved', at: '19:00:00' }
					: state === 'failed'
						? { kind: 'failed', message: '会成环：文件类 → 编码工具 → 文件类', code: 'CYCLE' }
						: { kind: state },
			onRetry: noop,
		}),
	);
}

/** 授权页左栏（issue #56 / #57）。`folds` 缺键 = 展开。 */
export function renderSidebar(options: {
	readonly selection?: { readonly kind: 'tier'; readonly key: 'unclaimed' | 'common' } | { readonly kind: 'template'; readonly ref: string };
	readonly folds?: Readonly<Record<string, boolean>>;
}): string {
	return renderToStaticMarkup(
		createElement(AuthSidebar, {
			policy: POLICY,
			templates: TEMPLATES,
			selection: options.selection,
			folds: options.folds ?? {},
			onSelect: noop,
			onToggleFold: noop,
		}),
	);
}

/** 授权编辑器（issue #57 的「勾选 → 保存」）。 */
export function renderEditor(options: {
	readonly title: string;
	readonly picked: readonly string[];
	readonly query?: string;
	readonly saveState?: 'idle' | 'saving' | 'saved' | 'failed';
}): string {
	const saveState =
		options.saveState === 'saved'
			? ({ kind: 'saved', at: '19:00:00' } as const)
			: options.saveState === 'failed'
				? ({ kind: 'failed', message: '权限策略写不进去（403）' } as const)
				: ({ kind: options.saveState ?? 'idle' } as const);
	return renderToStaticMarkup(
		createElement(PolicyEditor, {
			title: options.title,
			toolNames: [...POLICY.baseTools, ...POLICY.unclaimed, ...POLICY.common, 'apply_patch', 'glob'],
			picked: new Set(options.picked),
			baseTools: POLICY.baseTools,
			query: options.query ?? '',
			onToggle: noop,
			onQuery: noop,
			onSave: noop,
			onCancel: noop,
			saveState,
		}),
	);
}

/** 「编辑授权」按钮 + 不可编辑原因（issue #57：不能编辑必须说明理由）。 */
export function renderEditEntry(options: {
	readonly kind: 'tier' | 'template';
	readonly ref: string;
	readonly inTemplates: boolean;
}): string {
	const selection =
		options.kind === 'tier'
			? ({ kind: 'tier', key: 'common' } as const)
			: ({ kind: 'template', ref: options.ref } as const);
	const editability = editabilityOf(
		selection,
		options.inTemplates ? TEMPLATES : [],
	);
	return renderToStaticMarkup(
		createElement('div', null, createElement(EditButton, { editability, onEdit: noop }), createElement(EditBlockedReason, { editability })),
	);
}

/** 降级夹具（引用一下，保证它也被打包 / 与产品同源）。 */
export const FALLBACK = FALLBACK_TOOL_ENTRIES;
