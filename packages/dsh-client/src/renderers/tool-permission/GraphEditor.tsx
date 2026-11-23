/**
 * 「工具权限」页 —— 组图编辑器（左侧栏第二个入口）。
 *
 * 用户 `2026-11-23`：
 * > 「都到图了，为什么还是扭曲的线条。直接拓扑排序啊。在左边选一个组。
 * >   中间点选组。右边勾选tool。然后组如果包含了自己，那么那些组是置红的。
 * >   而不是靠拖动连线。一次能编辑的组只有左边选择正在激活的组。」
 * > 「左边也只有任务板。没有任务板权限。」
 *
 * ## 三栏，全部点击，没有拖拽
 *
 * ```
 * 左栏  组列表（单选 = 当前激活组 G）
 * 中栏  拓扑分层的全图 —— 点组节点 = G 加入/移出它；会成环的组**置红不可点**
 * 右栏  tool 复选框 —— 勾选 = G 包含它
 * ```
 *
 * 一次只编辑一个组。左栏换 G ⇒ 中栏选中态/红态、右栏勾选态全部跟着换。
 *
 * ## 图从哪来
 *
 * 布局是 `layoutGraph()` 算的（`src/pure/tool-graph.ts`）：**Kahn 拓扑排序 + 分层**，
 * 列间不画线（用户：「不要他们连线了。就拓扑排序然后一列一列一行一行的紧密排列算了」）。
 *
 * ## ⚠ 两件事没做完（页面上有明确提示，不许假装做了）
 *
 * 1. **组图不持久化** —— tag / 组是新的数据模型，后端存储还没实现，改动只在内存里
 * 2. **模板授权页是占位** —— 三档并集的展示还没实现
 *
 * ## 工具清单从哪来
 *
 * `GET /taskboard3/api/tools`（`@taskboard/dsh-agent-guard` 提供，全局视图）。
 * 取不到时降级到内置夹具，并在页面上显示一行提示 —— **失败要看得见，不许静默**。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
	addEdge,
	addNode,
	childrenOf,
	connectedGroupCount,
	emptyGraph,
	layoutGraph,
	nodeOf,
	orthogonalPath,
	pathBetween,
	removeEdge,
} from '../../pure/tool-graph.ts';
import type { ToolGraph, ToolGraphNode } from '../../pure/tool-graph.ts';
import { sourceOfName } from '../../pure/tool-permission.ts';
import type { ToolEntry } from '../../pure/tool-permission.ts';
import { TemplateAuthPanel } from './TemplateAuthPanel.tsx';

/* ══════════════════════════════════════════════════════════
   工具清单：真实来源 + 降级夹具
   ══════════════════════════════════════════════════════════ */


/**
 * 降级夹具 —— `/api/tools` 取不到时用它。
 *
 * ⚠ 它存在**只是为了页面不空**，不是真值。用的时候页面上会有一行红色提示，
 *   告诉用户「工具清单取不到，显示的是内置示例」。**不许静默降级。**
 */
const FALLBACK_TOOL_NAMES: readonly string[] = [
	'taskboard_card',
	'taskboard_cards',
	'taskboard_create',
	'taskboard_definitions',
	'taskboard_raw_card',
	'taskboard_tool_policy',
	'taskboard_tool_policy_read',
	'taskboard_transition',
	'taskboard_update',
	'taskboard_update_note',
	'taskboard_workspaces',
	'taskboard_release',
	'taskboard_claim',
	'taskboard_adopt',
	'taskboard_search',
	'taskboard_render_check',
	'bash',
	'pwsh',
	'read',
	'write',
	'edit',
	'grep',
	'glob',
	'apply_patch',
	'web_fetch',
	'web_search',
];

/** 降级夹具的条目。 */
export const FALLBACK_TOOL_ENTRIES: readonly ToolEntry[] = FALLBACK_TOOL_NAMES.map((name) => ({
	name,
	source: sourceOfName(name),
}));

/**
 * 初始图里优先上图的那批工具。
 *
 * 真实工具清单可能有上百个，全塞进初始图会糊成一团；这里只挑「有代表性」的九个，
 * 其余的仍在右栏/工具清单里可勾。**挑不到就退化成前九个**，不留空图。
 */
const PREFERRED_TOOL_NAMES: readonly string[] = [
	'taskboard_update',
	'taskboard_raw_card',
	'write',
	'edit',
	'read',
	'grep',
	'glob',
	'bash',
	'web_fetch',
];

/** 全部可选工具（按真实条目造 id / label / source）。 */
function allTools(entries: readonly ToolEntry[]): readonly { id: string; label: string; source: string }[] {
	return entries.map((one) => ({ id: `tool:${one.name}`, label: one.name, source: one.source }));
}

/** 初始图。`entries` 决定上图的工具节点集合。 */
function initialGraph(entries: readonly ToolEntry[]): ToolGraph {
	let graph = emptyGraph();
	const groups: readonly (readonly [string, string])[] = [
		['group:code', '编码工具'],
		['group:write', '写操作'],
		['group:read', '读操作'],
		['group:host', '宿主基础工具'],
		['group:file', '文件类'],
		['group:ro', '只读套装'],
		['group:net', '网络访问'],
	];
	for (const [id, label] of groups) graph = addNode(graph, { id, kind: 'group', label });

	const available = new Map(entries.map((one) => [one.name, one]));
	const preferred = PREFERRED_TOOL_NAMES.filter((name) => available.has(name));
	/* 真实清单里一个都没命中（比如工具全换了名字）⇒ 退化成前九个，不留空图。 */
	const picked = preferred.length > 0 ? preferred : entries.slice(0, 9).map((one) => one.name);
	for (const name of picked) {
		graph = addNode(graph, {
			id: `tool:${name}`,
			kind: 'tool',
			label: name,
			source: available.get(name)?.source ?? sourceOfName(name),
		});
	}

	/*
	 * 初始边。**只连「真的挑上了」的工具** —— 否则 addEdge 会因 MISSING_NODE 失败，
	 * 那些失败是静默的（只跳过一次），图会少边但看不出原因。
	 */
	const edges: readonly (readonly [string, string])[] = [
		['group:code', 'group:write'],
		['group:code', 'group:read'],
		['group:write', 'group:file'],
		['group:write', 'tool:taskboard_update'],
		['group:code', 'tool:taskboard_raw_card'],
		['group:file', 'tool:write'],
		['group:file', 'tool:edit'],
		['group:read', 'group:ro'],
		['group:ro', 'tool:read'],
		['group:ro', 'tool:grep'],
		['group:ro', 'tool:glob'],
		['group:host', 'tool:bash'],
		['group:net', 'tool:web_fetch'],
	];
	const nodeIds = new Set(graph.nodes.map((one) => one.id));
	for (const [from, to] of edges) {
		if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
		const result = addEdge(graph, from, to);
		if (result.ok) graph = result.graph;
	}
	return graph;
}

/* ══════════════════════════════════════════════════════════
   组件
   ══════════════════════════════════════════════════════════ */

/** 页签。 */
type Tab = 'graph' | 'tools' | 'templates';

/**
 * 紧密排布的布局参数。
 *
 * 用户 `2026-11-23`：「就拓扑排序然后一列一列一行一行的紧密排列算了。」
 *
 * 列间距 96 = 两列卡片之间留一条通道（不画线，但留出呼吸）；
 * 行距 8 = 只够分开相邻卡片，**不为好看留空白**。
 */
const TIGHT_LAYOUT = {
	gapX: 96,
	gapY: 8,
	paddingX: 24,
	paddingY: 28,
	groupW: 172,
	groupH: 44,
	toolW: 146,
	toolH: 32,
};

/** 组图编辑器的 props。 */
export interface GraphEditorProps {
	/**
	 * 工具清单（真实来源）。
	 *
	 * **必须由调用方先取好再挂载** —— 组件用它在 `useState` 初始化时建初始图，
	 * 挂载之后再变不会重建图（否则会把用户正在编辑的组冲掉）。
	 */
	readonly tools: readonly ToolEntry[];
}

/** 组图编辑器。 */
export function GraphEditor(props: GraphEditorProps): ReactNode {
	/* 空清单 = 取不到 ⇒ 用降级夹具，别让页面空着。页面会另外显示一行提示。 */
	const entries = props.tools.length > 0 ? props.tools : FALLBACK_TOOL_ENTRIES;
	const [graph, setGraph] = useState<ToolGraph>(() => initialGraph(entries));
	const [activeId, setActiveId] = useState<string>('group:code');
	const [tab, setTab] = useState<Tab>('graph');
	const [zoom, setZoom] = useState(1);
	const [toolQuery, setToolQuery] = useState('');
	const [toolPage, setToolPage] = useState(0);
	const [draftName, setDraftName] = useState('');
	const [creating, setCreating] = useState(false);
	const [notice, setNotice] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
	const [counter, setCounter] = useState(0);

	const tools = useMemo(() => allTools(entries), [entries]);

	/**
	 * **上图用的图 = 去掉「正在编辑的组」以及它相关的边。**
	 *
	 * 用户 `2026-11-23`：
	 * > 「a。编辑自己的时候自己不在图上。」
	 * > 「因为点选。是自己包含他们。而自己不在图上。点选也不能修改出"他们包含自己"。
	 * >   所以修改期间，这些面板上等着点选的组。应该没有挪位置的可能吧。」
	 *
	 * ⇒ 编辑组不占层、不算任何节点的父 ⇒ 候选节点之间的父子关系完全不变
	 *   ⇒ 它们的拓扑层不变 ⇒ **位置不变**。点选只改「编辑组 → 候选」这种边，
	 *   而那些边根本不在显示图上。
	 */
	const displayGraph = useMemo(
		() => ({
			nodes: graph.nodes.filter((one) => one.id !== activeId),
			edges: graph.edges.filter((edge) => edge.from !== activeId && edge.to !== activeId),
		}),
		[graph, activeId],
	);

	/** 紧密排布：列间距 96、行距 8 —— 只够分开相邻卡片，不浪费纵向空间。 */
	const layout = useMemo(() => layoutGraph(displayGraph, TIGHT_LAYOUT), [displayGraph]);
	const groups = useMemo(() => graph.nodes.filter((one) => one.kind === 'group'), [graph]);

	/** 当前激活组（一定存在 —— 删组时不会删到它，见下）。 */
	const active = nodeOf(graph, activeId);
	const activeChildren = useMemo(() => childrenOf(graph, activeId), [graph, activeId]);
	const activeGroups = useMemo(() => new Set(activeChildren.filter((one) => one.kind === 'group').map((one) => one.id)), [activeChildren]);
	const activeTools = useMemo(() => new Set(activeChildren.filter((one) => one.kind === 'tool').map((one) => one.id)), [activeChildren]);

	/**
	 * 会成环的组：加 `G → C` 会成环 ⟺ 图里 `C` 已经能走到 `G`。
	 *
	 * **选 G 的那一刻就算好**（不是点到一半才红）—— 用户要求「一开始就红」。
	 */
	const blocked = useMemo(() => {
		const map = new Map<string, readonly string[]>();
		for (const candidate of groups) {
			if (candidate.id === activeId) continue;
			const path = pathBetween(graph, candidate.id, activeId);
			if (path !== undefined) map.set(candidate.id, [...path]);
		}
		return map;
	}, [graph, groups, activeId]);

	const labelOf = useCallback((id: string): string => nodeOf(graph, id)?.label ?? id, [graph]);

	/** 环路径写成人话。 */
	const cycleText = useCallback(
		(cycle: readonly string[]): string => [activeId, ...cycle].map((id) => labelOf(id)).join(' → '),
		[activeId, labelOf],
	);

	/** 中栏点组：加入 / 移出当前组。 */
	const toggleGroupMember = useCallback(
		(candidateId: string) => {
			if (candidateId === activeId) return;
			if (blocked.has(candidateId)) return;

			if (activeGroups.has(candidateId)) {
				setGraph((prev) => removeEdge(prev, activeId, candidateId));
				setNotice({ kind: 'ok', text: `已从「${labelOf(activeId)}」移出「${labelOf(candidateId)}」` });
				return;
			}
			const result = addEdge(graph, activeId, candidateId);
			if (result.ok) {
				setGraph(result.graph);
				setNotice({ kind: 'ok', text: `已把「${labelOf(candidateId)}」加入「${labelOf(activeId)}」` });
				return;
			}
			setNotice({ kind: 'bad', text: result.message });
		},
		[activeGroups, activeId, blocked, graph, labelOf],
	);

	/** 右栏勾工具：加入 / 移出当前组。工具多父合法，所以不会被拦。 */
	const toggleTool = useCallback(
		(toolId: string, next: boolean) => {
			if (next) {
				let base = graph;
				if (nodeOf(base, toolId) === undefined) {
					const label = tools.find((one) => one.id === toolId)?.label ?? toolId;
					const source = tools.find((one) => one.id === toolId)?.source;
					base = addNode(base, { id: toolId, kind: 'tool', label, ...(source === undefined ? {} : { source }) });
				}
				const result = addEdge(base, activeId, toolId);
				if (result.ok) {
					setGraph(result.graph);
					setNotice({ kind: 'ok', text: `已把「${labelOf(toolId)}」加入「${labelOf(activeId)}」` });
					return;
				}
				setNotice({ kind: 'bad', text: result.message });
				return;
			}
			setGraph((prev) => removeEdge(prev, activeId, toolId));
			setNotice({ kind: 'ok', text: `已从「${labelOf(activeId)}」移出「${labelOf(toolId)}」` });
		},
		[activeId, graph, labelOf, tools],
	);

	/** 新建组（同时设为当前激活组）。 */
	const confirmCreate = useCallback(() => {
		const index = counter + 1;
		setCounter(index);
		const id = `group:new-${String(index)}`;
		const label = draftName.trim() === '' ? `新组 ${String(index)}` : draftName.trim();
		setGraph((prev) => addNode(prev, { id, kind: 'group', label }));
		setActiveId(id);
		setDraftName('');
		setCreating(false);
		setNotice({ kind: 'ok', text: `已新建「${label}」并切换到它` });
	}, [counter, draftName]);

	/* ── 工具清单页分页 ── */
	const filtered = useMemo(() => {
		/*
		 * 表里要能出现「图里已经存在的 tool」—— 包括右栏勾选时新建的节点，
		 * 不能只认初始那份清单。
		 */
		const known = new Map(tools.map((one) => [one.id, one]));
		for (const node of graph.nodes) {
			if (node.kind !== 'tool' || known.has(node.id)) continue;
			known.set(node.id, { id: node.id, label: node.label, source: node.source ?? '新加' });
		}
		const rows = [...known.values()].sort((a, b) => a.label.localeCompare(b.label));
		const query = toolQuery.trim().toLowerCase();
		return rows.filter(
			(one) =>
				query === '' ||
				one.label.toLowerCase().includes(query) ||
				one.source.includes(toolQuery.trim()),
		);
	}, [tools, graph.nodes, toolQuery]);
	const PAGE_SIZE = 10;
	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const page = Math.min(toolPage, pageCount - 1);
	const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

	/** 布局表：id → box。 */
	const boxOf = useMemo(() => new Map(layout.boxes.map((one) => [one.id, one])), [layout]);

	/** 每一列的 x 与个数（列头标签用）。 */
	const layoutColumns = useMemo(() => {
		const byLayer = new Map<number, { x: number; count: number }>();
		for (const box of layout.boxes) {
			const found = byLayer.get(box.layer);
			if (found === undefined) byLayer.set(box.layer, { x: box.x, count: 1 });
			else found.count += 1;
		}
		return [...byLayer.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([layer, info]) => ({ layer, x: info.x, count: info.count }));
	}, [layout]);

	return (
		<div className="tb3g-root" data-testid="graph-editor">
			<header className="tb3g-head">
				<h1 className="tb3g-title">工具权限</h1>
				<p className="tb3g-sub">组是 tag：可以含任何工具、也可以含任何别的组 —— 只要不成环。只允许、不取消。</p>
				<nav className="tb3g-tabs" role="tablist">
					<button type="button" role="tab" data-action="tab-graph" className={`tb3g-tab${tab === 'graph' ? ' is-on' : ''}`} onClick={() => setTab('graph')}>
						组图
					</button>
					<button type="button" role="tab" data-action="tab-tools" className={`tb3g-tab${tab === 'tools' ? ' is-on' : ''}`} onClick={() => setTab('tools')}>
						工具清单
					</button>
					<button type="button" role="tab" data-action="tab-templates" className={`tb3g-tab${tab === 'templates' ? ' is-on' : ''}`} onClick={() => setTab('templates')}>
						模板授权
					</button>
				</nav>
			</header>

			{tab === 'graph' ? (
				<div className="tb3g-graph" data-testid="tab-graph">
					{/* ═══ 左栏：组列表（单选） ═══ */}
					<aside className="tb3g-side tb3g-side--left">
						<div className="tb3g-side__head">
							<span>组</span>
							<span className="tb3g-side__hint">单选 = 正在编辑</span>
						</div>
						<div className="tb3g-scroll">
							{groups.map((one) => {
								const isActive = one.id === activeId;
								const count = childrenOf(graph, one.id).length;
								return (
									<button
										key={one.id}
										type="button"
										data-group-id={one.id}
										data-active={isActive ? '1' : '0'}
										className={`tb3g-groupitem${isActive ? ' is-active' : ''}`}
										onClick={() => {
											setActiveId(one.id);
											setNotice(null);
										}}
									>
										<span className="tb3g-groupitem__name"># {one.label}</span>
										<span className="tb3g-groupitem__count">{String(count)}</span>
									</button>
								);
							})}
						</div>
						{creating ? (
							<div className="tb3g-create">
								<input
									data-testid="new-group-input"
									className="tb3g-create__input"
									value={draftName}
									placeholder="组名"
									onChange={(event) => setDraftName(event.target.value)}
								/>
								<button type="button" data-action="confirm-create" className="tb3g-btn tb3g-btn--primary" onClick={confirmCreate}>
									确认
								</button>
							</div>
						) : (
							<button type="button" data-action="new-group" className="tb3g-btn" onClick={() => setCreating(true)}>
								＋ 新建组
							</button>
						)}
					</aside>

					{/* ═══ 中栏：拓扑分层的全图 ═══ */}
					<section className="tb3g-canvaswrap">
						<div className="tb3g-canvasbar">
							<div className="tb3g-crumb">
								正在编辑：<strong data-testid="active-group-label">{active?.label ?? activeId}</strong>
								<span className="tb3g-crumb__hint">
									点中栏的**组**加入/移出 · 红色 = 会成环，不可点 · 工具在右栏勾
								</span>
							</div>
							<div className="tb3g-zoom">
								<button type="button" data-action="zoom-out" className="tb3g-btn tb3g-btn--tiny" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
									−
								</button>
								<span data-testid="zoom-label" className="tb3g-zoom__label">
									{String(Math.round(zoom * 100))}%
								</span>
								<button type="button" data-action="zoom-in" className="tb3g-btn tb3g-btn--tiny" onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}>
									＋
								</button>
								<button type="button" data-action="zoom-fit" className="tb3g-btn tb3g-btn--tiny" onClick={() => setZoom(1)}>
									适应
								</button>
							</div>
						</div>

						<div className="tb3g-scroll">
							<div className="tb3g-canvas" data-testid="graph-canvas" style={{ width: `${String(layout.width)}px`, height: `${String(layout.height)}px`, transform: `scale(${String(zoom)})` }}>
								{/* 不画任何连线（用户 2026-11-23：「不要他们连线了」） */}

								{layoutColumns.map((one) => (
									<div
										key={one.layer}
										className="tb3g-collabel"
										data-layer-label={String(one.layer)}
										style={{ left: `${String(one.x)}px`, top: '4px' }}
									>
										L{String(one.layer)} · {String(one.count)} 个
									</div>
								))}
								{displayGraph.nodes.map((node) => {
									const box = boxOf.get(node.id);
									if (box === undefined) return null;
									const isGroup = node.kind === 'group';
									const isActive = node.id === activeId;
									const isMember = activeGroups.has(node.id) || activeTools.has(node.id);
									const isBlocked = blocked.has(node.id);
									const cycle = blocked.get(node.id);
									const parents = graph.edges.filter((edge) => edge.to === node.id).length;
									const memberCount = isGroup ? childrenOf(graph, node.id).length : 0;

									const className = [
										'tb3g-node',
										isGroup ? 'tb3g-node--group' : 'tb3g-node--tool',
										isActive ? ' is-active' : '',
										isMember ? ' is-member' : '',
										isBlocked ? ' is-blocked' : '',
									].join(' ');

									return (
										<div
											key={node.id}
											data-node-id={node.id}
											data-node-kind={node.kind}
											data-layer={String(box.layer)}
											data-active={isActive ? '1' : '0'}
											data-member={isMember ? '1' : '0'}
											data-blocked={isBlocked ? '1' : '0'}
											data-testid="graph-node"
											className={className}
											title={isBlocked && cycle !== undefined ? `会成环：${cycleText(cycle)}` : undefined}
											style={{ left: `${String(box.x)}px`, top: `${String(box.y)}px`, width: `${String(box.w)}px`, height: `${String(box.h)}px` }}
											onClick={
												isGroup && !isActive && !isBlocked
													? () => {
															toggleGroupMember(node.id);
														}
													: undefined
											}
										>
											<span className="tb3g-node__name">
												{isActive ? '● ' : ''}
												{isMember ? '✓ ' : ''}
												{isGroup ? `# ${node.label}` : node.label}
											</span>
											<span className="tb3g-node__meta">
												{isGroup ? `L${String(box.layer)} · 组 · ${String(memberCount)} 成员` : `L${String(box.layer)} · ${node.source ?? ''}`}
												{parents > 1 ? ` · ⧉ ${String(parents)} 父` : ''}
												{isBlocked ? ' · 会成环' : ''}
											</span>
										</div>
									);
								})}
							</div>
						</div>

						<div className="tb3g-status">
							<span>
								缩放 {String(Math.round(zoom * 100))}% · 节点 {String(displayGraph.nodes.length)} · 层{' '}
								{String(Math.max(0, ...layout.boxes.map((one) => one.layer)) + 1)}
							</span>
							<span className="tb3g-status__legend">
								<span className="tb3g-dot tb3g-dot--active" /> 正在编辑
								<span className="tb3g-dot tb3g-dot--member" /> 已在组里
								<span className="tb3g-dot tb3g-dot--blocked" /> 会成环
							</span>
						</div>

						{notice === null ? null : (
							<div className={`tb3g-notice${notice.kind === 'bad' ? ' is-bad' : ''}`} data-testid="notice">
								{notice.text}
								<button type="button" data-action="dismiss-notice" className="tb3g-btn tb3g-btn--tiny" onClick={() => setNotice(null)}>
									知道了
								</button>
							</div>
						)}
					</section>

					{/* ═══ 右栏：tool 复选 ═══ */}
					<aside className="tb3g-side tb3g-side--right">
						<div className="tb3g-side__head">
							<span>工具</span>
							<span className="tb3g-side__hint">勾选 = 加入当前组</span>
						</div>
						<input
							className="tb3g-input tb3g-input--side"
							data-testid="tool-filter"
							placeholder="搜索工具…"
							value={toolQuery}
							onChange={(event) => {
								setToolQuery(event.target.value);
								setToolPage(0);
							}}
						/>
						<div className="tb3g-scroll">
							{pageRows.map((one) => {
								const checked = activeTools.has(one.id);
								return (
									<label key={one.id} className={`tb3g-checkitem${checked ? ' is-checked' : ''}`}>
										<input
											type="checkbox"
											data-tool-id={one.id}
											checked={checked}
											onChange={(event) => toggleTool(one.id, event.target.checked)}
										/>
										<span className="tb3g-checkitem__name">{one.label}</span>
										<span className="tb3g-checkitem__src">{one.source}</span>
									</label>
								);
							})}
						</div>
						<div className="tb3g-pager">
							<button type="button" data-action="page-prev" className="tb3g-btn tb3g-btn--tiny" disabled={page === 0} onClick={() => setToolPage((p) => Math.max(0, p - 1))}>
								上一页
							</button>
							<span data-testid="page-label">
								{String(page + 1)} / {String(pageCount)}
							</span>
							<button type="button" data-action="page-next" className="tb3g-btn tb3g-btn--tiny" disabled={page >= pageCount - 1} onClick={() => setToolPage((p) => Math.min(pageCount - 1, p + 1))}>
								下一页
							</button>
						</div>
					</aside>
				</div>
			) : null}

			{tab === 'tools' ? (
				<section className="tb3g-page" data-testid="tab-tools">
					<div className="tb3g-page__bar">
						<input className="tb3g-input" data-testid="tool-search" placeholder="搜索工具名 / 来源" value={toolQuery} onChange={(event) => setToolQuery(event.target.value)} />
						<span className="tb3g-page__count">
							共 {String(tools.length)} 个工具 · 已过滤 {String(filtered.length)}
						</span>
					</div>
					<table className="tb3g-table">
						<thead>
							<tr>
								<th>工具</th>
								<th>来源</th>
								<th>直接所属组</th>
								<th>连通组数</th>
							</tr>
						</thead>
						<tbody>
							{filtered.map((one) => {
								/* 直接所属组 = 与它有直接边的父组（复数） */
								const direct = graph.edges.filter((edge) => edge.to === one.id).map((edge) => labelOf(edge.from));
								const directShown = direct.slice(0, 3);
								const directRest = direct.length - directShown.length;
								const connected = connectedGroupCount(graph, one.id);
								return (
									<tr key={one.id} data-table-tool={one.id}>
										<td className="tb3g-table__name">{one.label}</td>
										<td>{one.source}</td>
										<td className="tb3g-table__groups">
											{direct.length === 0 ? (
												<span className="tb3g-muted">未分组</span>
											) : (
												<span className="tb3g-chips" title={direct.join(' · ')}>
													{directShown.map((name) => (
														<span key={name} className="tb3g-chip">
															{name}
														</span>
													))}
													{directRest > 0 ? <span className="tb3g-chip tb3g-chip--more">+{String(directRest)}</span> : null}
												</span>
											)}
										</td>
										<td className="tb3g-table__count" data-connected-count={String(connected)}>
											{String(connected)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</section>
			) : null}

			{/*
			 * 模板授权页：真实数据（用户 2026-11-24「什么模板对应什么工具可用还没有界面」）。
			 * 数据源 GET /taskboard3/api/tool-policy（服务端用 core 的 effectiveToolsOf 算好并集）
			 * —— 本组件只按来源分组展示，**不重算并集**。
			 */}
			{tab === 'templates' ? <TemplateAuthPanel /> : null}

			<div className="tb3g-debug" data-testid="graph-stats" aria-hidden="true">
				{JSON.stringify({ nodes: graph.nodes.length, edges: graph.edges.length, active: activeId })}
			</div>
			<div className="tb3g-debug" data-testid="layout-debug" aria-hidden="true">
				{JSON.stringify({
					active: activeId,
					layers: layout.boxes.map((one) => ({ id: one.id, layer: one.layer })),
					edges: graph.edges.map((edge) => {
						const from = boxOf.get(edge.from);
						const to = boxOf.get(edge.to);
						return { from: edge.from, to: edge.to, fromLayer: from?.layer ?? -1, toLayer: to?.layer ?? -1 };
					}),
					blocked: [...blocked.keys()],
				})}
			</div>
		</div>
	);
}
