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
 * ## 图从哪来、到哪去（issue #58）
 *
 * ```
 * 挂载   GET  /taskboard3/api/tool-graph   →  { groups, edges }   （后端真值，落 kv）
 * 改动   PUT  /taskboard3/api/tool-graph   ←  { groups, edges }   （防抖 400ms）
 * ```
 *
 * - **工具节点不落库**：工具清单的真值在 `/api/tools`，组图只存组与边。
 *   读回时边引用的工具如果宿主已经没有 ⇒ 标成「已失效」（`data-invalid="1"`），
 *   **不静默丢** —— 用户要能看见并决定删不删。
 * - 保存状态在画布工具条上可见：保存中 / 已保存 / 失败（带原因与重试）。
 * - 失败原因取服务端 `detail.code` 翻成人话；成环时把**环路径**画出来
 *   （`文件类 → 编码工具 → 文件类`）。
 * - 页面顶部**不再有**「组图改动暂不持久化」的黄条（那条提示的唯一理由已消失）。
 *
 * ## 布局
 *
 * 布局是 `layoutGraph()` 算的（`src/pure/tool-graph.ts` → core）：**Kahn 拓扑排序 + 分层**，
 * 列间不画线（用户：「不要他们连线了。就拓扑排序然后一列一列一行一行的紧密排列算了」）。
 *
 * ## 只读的成员位（issue #53）
 *
 * 中栏白底卡是**组成员位**，不是可编辑对象：它们带 `data-readonly="1"`、
 * 悬停说明「这是成员位（只读）：请在左栏选组，再到右栏勾选工具」，
 * 并且**没有** role / tabIndex / onClick。工具的开关只有右栏一处。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
	addEdge,
	addNode,
	childrenOf,
	emptyGraph,
	layoutGraph,
	nodeOf,
	pathBetween,
	removeEdge,
	topoLayers,
} from '../../pure/tool-graph.ts';
import type { ToolGraph } from '../../pure/tool-graph.ts';
import { sourceOfName } from '../../pure/tool-permission.ts';
import type { ToolEntry } from '../../pure/tool-permission.ts';
import {
	docKey,
	docOfGraph,
	graphFailureText,
	graphOfDoc,
	parseGraphDoc,
	pruneOrphanTools,
} from '../../pure/tool-graph-sync.ts';
import type { GraphDoc } from '../../pure/tool-graph-sync.ts';
import { requestJson } from '../../wire.ts';
import { GraphNodeBox } from './GraphNodeBox.tsx';
import { SaveStatusBar, type SaveState } from './SaveStatusBar.tsx';
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

/** 防抖窗口（毫秒）。用户「别每个像素一次请求」—— 点选是离散的，400ms 够合并连点。 */
const SAVE_DEBOUNCE_MS = 400;

/* ══════════════════════════════════════════════════════════
   组件
   ══════════════════════════════════════════════════════════ */

/** 页签。 */
type Tab = 'group' | 'auth';

/**
 * 紧密排布的布局参数。
 *
 * 用户 `2026-11-23`：「就拓扑排序然后一列一列一行一行的紧密排列算了。」
 *
 * 列间距 40 = 两列之间只留一条窄缝（用户 2026-11-24：「这里的列宽度间隔太远了」——
 *   原来 96 是为了「不画线也留呼吸」，但实际看图发现列与列之间空得离谱，
 *   而且网格背景把空白全露出来了 ⇒ 收紧到 40，接近相邻卡片的视觉节奏）。
 * 行距 8 = 只够分开相邻卡片，**不为好看留空白**。
 *
 * ⚠ **组与工具同宽**（issue #54）：原来 groupW=172 / toolW=146，白底的工具卡明显更窄，
 *   标题被挤掉。宽度统一之后，标题只在真的过长时 ellipsis（CSS 侧还有 min-width 兜底）。
 */
const TIGHT_LAYOUT = {
	gapX: 40,
	gapY: 8,
	paddingX: 24,
	paddingY: 28,
	groupW: 176,
	groupH: 44,
	toolW: 176,
	toolH: 36,
};

/** 组图编辑器的 props。 */
export interface GraphEditorProps {
	/**
	 * 工具清单（真实来源）。
	 *
	 * 进页面时已经取好（`ToolPermissionPage` 负责），组件用它在挂载时判断
	 * 哪些工具节点「已失效」；挂载后再变不会重建画布。
	 */
	readonly tools: readonly ToolEntry[];
}

/** 组图编辑器。 */
export function GraphEditor(props: GraphEditorProps): ReactNode {
	/* 空清单 = 取不到 ⇒ 用降级夹具，别让页面空着。页面会另外显示一行提示。 */
	const entries = props.tools.length > 0 ? props.tools : FALLBACK_TOOL_ENTRIES;
	const knownToolNames = useMemo(() => new Set(entries.map((one) => one.name)), [entries]);

	/* ── 图：`undefined` = 正在读；`loadError` 非空 = 读失败 ── */
	const [graph, setGraph] = useState<ToolGraph | undefined>(undefined);
	const [invalidTools, setInvalidTools] = useState<ReadonlySet<string>>(() => new Set());
	const [loadError, setLoadError] = useState<string | undefined>(undefined);
	const [reloadToken, setReloadToken] = useState(0);
	const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
	/** 上一次成功保存（或刚读回）的文档指纹；相等 = 没有未保存的改动。 */
	const savedKeyRef = useRef<string | undefined>(undefined);
	/** 保存序号：晚发出的覆盖早发出的，早响应回来时直接丢掉。 */
	const saveSeq = useRef(0);

	const [activeId, setActiveId] = useState<string | undefined>(undefined);
	const [tab, setTab] = useState<Tab>('group');
	const [zoom, setZoom] = useState(1);
	const [toolQuery, setToolQuery] = useState('');
	const [toolPage, setToolPage] = useState(0);
	const [draftName, setDraftName] = useState('');
	const [creating, setCreating] = useState(false);
	const [notice, setNotice] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
	const [counter, setCounter] = useState(0);

	/* ── 读图（挂载 / 重试）── */
	useEffect(() => {
		const controller = new AbortController();
		setGraph(undefined);
		setLoadError(undefined);
		void (async () => {
			const result = await requestJson('GET', 'tool-graph', { signal: controller.signal });
			if (controller.signal.aborted) return;
			if (!result.ok) {
				setLoadError(`读取组图失败：${graphFailureText(result.failure).message}`);
				return;
			}
			const doc = parseGraphDoc(result.data);
			if (doc === undefined) {
				setLoadError('读取组图失败：服务返回的形状不对（缺少 groups / edges）。');
				return;
			}
			const built = graphOfDoc(doc, knownToolNames);
			const layers = topoLayers(built.graph).layer;
			setGraph(built.graph);
			setInvalidTools(built.invalidTools);
			setActiveId(built.graph.nodes.find((one) => one.kind === 'group')?.id);
			/*
			 * 「已保存」的基准 = **我们会存成什么样**，而不是服务端原样。
			 * 组图的 `column` 是从边算出来的（布局不读它），所以两者可能不同；
			 * 用我们的版本做基准，打开页面才不会立刻触发一次「原地重存」。
			 */
			savedKeyRef.current = docKey(docOfGraph(built.graph, (id) => layers.get(id) ?? 0));
			setSaveState({ kind: 'idle' });
		})();
		return () => {
			controller.abort();
		};
	}, [reloadToken, knownToolNames]);

	/** 层号（= 画布列号；也是落库时 `column` 的来源）。 */
	const layerMap = useMemo(
		() => (graph === undefined ? new Map<string, number>() : topoLayers(graph).layer),
		[graph],
	);

	const columnOf = useCallback((id: string): number => layerMap.get(id) ?? 0, [layerMap]);

	/** 一次真正发出 PUT（防抖之后调；保留失败信息 + 丢弃过期响应）。 */
	const flushSave = useCallback(
		async (doc: GraphDoc, key: string): Promise<void> => {
			const seq = saveSeq.current + 1;
			saveSeq.current = seq;
			setSaveState({ kind: 'saving' });
			const result = await requestJson('PUT', 'tool-graph', { body: doc });
			/* 更新的那次已经发出 ⇒ 这次的结果过期了，不要覆盖它的状态。 */
			if (saveSeq.current !== seq) return;

			if (!result.ok) {
				const text = graphFailureText(result.failure);
				setSaveState({
					kind: 'failed',
					message: text.message,
					...(text.code === undefined ? {} : { code: text.code }),
				});
				return;
			}
			const saved = parseGraphDoc(result.data);
			if (saved === undefined) {
				setSaveState({ kind: 'failed', message: '保存后服务端返回的图格式不对（缺少 groups / edges）' });
				return;
			}
			const savedKey = docKey(saved);
			savedKeyRef.current = savedKey;
			/* 服务端规范化过（trim / 列号）⇒ 把本地也对齐，否则界面和库里会长期不一致。 */
			if (savedKey !== key) {
				const rebuilt = graphOfDoc(saved, knownToolNames);
				setGraph(rebuilt.graph);
				setInvalidTools(rebuilt.invalidTools);
			}
			setSaveState({ kind: 'saved', at: new Date().toLocaleTimeString() });
		},
		[knownToolNames],
	);

	/* ── 写图：改动后防抖保存（不是每个点击一次请求，更不是每个像素）── */
	useEffect(() => {
		if (graph === undefined) return;
		const doc = docOfGraph(graph, columnOf);
		const key = docKey(doc);
		if (savedKeyRef.current === key) return;
		const timer = setTimeout(() => {
			void flushSave(doc, key);
		}, SAVE_DEBOUNCE_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [graph, columnOf, flushSave]);

	/** 失败后的「重试」：拿当前画布再存一次。 */
	const retrySave = useCallback((): void => {
		if (graph === undefined) return;
		const doc = docOfGraph(graph, columnOf);
		void flushSave(doc, docKey(doc));
	}, [graph, columnOf, flushSave]);

	const groups = useMemo(() => (graph === undefined ? [] : graph.nodes.filter((one) => one.kind === 'group')), [graph]);

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
	const displayGraph = useMemo(() => {
		if (graph === undefined) return emptyGraph();
		if (activeId === undefined) return graph;
		return {
			nodes: graph.nodes.filter((one) => one.id !== activeId),
			edges: graph.edges.filter((edge) => edge.from !== activeId && edge.to !== activeId),
		};
	}, [graph, activeId]);

	const layout = useMemo(() => layoutGraph(displayGraph, TIGHT_LAYOUT), [displayGraph]);

	/** 当前激活组（没选 / 空图时为 `undefined`）。 */
	const active = graph === undefined || activeId === undefined ? undefined : nodeOf(graph, activeId);
	const activeChildren = useMemo(
		() => (graph === undefined || activeId === undefined ? [] : childrenOf(graph, activeId)),
		[graph, activeId],
	);
	const activeGroups = useMemo(
		() => new Set(activeChildren.filter((one) => one.kind === 'group').map((one) => one.id)),
		[activeChildren],
	);
	const activeTools = useMemo(
		() => new Set(activeChildren.filter((one) => one.kind === 'tool').map((one) => one.id)),
		[activeChildren],
	);

	/** 子组里间接包含的工具（右栏灰勾）。 */
	const inheritedTools = useMemo(() => {
		const out = new Set<string>();
		if (graph === undefined) return out;
		const seen = new Set<string>();
		const queue = activeChildren.map((one) => one.id);
		while (queue.length > 0) {
			const id = queue.pop();
			if (id === undefined || seen.has(id)) continue;
			seen.add(id);
			const node = nodeOf(graph, id);
			if (node === undefined) continue;
			if (node.kind === 'tool') {
				out.add(id);
				continue;
			}
			for (const child of childrenOf(graph, id)) queue.push(child.id);
		}
		return out;
	}, [activeChildren, graph]);

	/**
	 * 会成环的组：加 `G → C` 会成环 ⟺ 图里 `C` 已经能走到 `G`。
	 *
	 * **选 G 的那一刻就算好**（不是点到一半才红）—— 用户要求「一开始就红」。
	 * 这只是**预览**：真正的判决仍由服务端在做（PUT 的 400 + 环路径）——
	 * 一份实现，不在 UI 里重写（AGENTS 3.6）。
	 */
	const blocked = useMemo(() => {
		const map = new Map<string, readonly string[]>();
		if (graph === undefined || activeId === undefined) return map;
		for (const candidate of groups) {
			if (candidate.id === activeId) continue;
			const path = pathBetween(graph, candidate.id, activeId);
			if (path !== undefined) map.set(candidate.id, [...path]);
		}
		return map;
	}, [graph, groups, activeId]);

	const labelOf = useCallback(
		(id: string): string => (graph === undefined ? id : (nodeOf(graph, id)?.label ?? id)),
		[graph],
	);

	/** 环路径写成人话。 */
	const cycleText = useCallback(
		(cycle: readonly string[]): string =>
			(activeId === undefined ? cycle : [activeId, ...cycle]).map((id) => labelOf(id)).join(' → '),
		[activeId, labelOf],
	);

	/** 中栏点组：加入 / 移出当前组。 */
	const toggleGroupMember = useCallback(
		(candidateId: string): void => {
			if (graph === undefined || activeId === undefined || candidateId === activeId) return;
			if (blocked.has(candidateId)) return;

			if (activeGroups.has(candidateId)) {
				setGraph(pruneOrphanTools(removeEdge(graph, activeId, candidateId)));
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
		(toolId: string, next: boolean): void => {
			if (graph === undefined || activeId === undefined) return;
			if (next) {
				let base = graph;
				if (nodeOf(base, toolId) === undefined) {
					const entry = entries.find((one) => `tool:${one.name}` === toolId);
					const label = entry?.name ?? toolId;
					const source = entry?.source;
					base = addNode(base, {
						id: toolId,
						kind: 'tool',
						label,
						...(source === undefined ? {} : { source }),
					});
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
			setGraph(pruneOrphanTools(removeEdge(graph, activeId, toolId)));
			setNotice({ kind: 'ok', text: `已从「${labelOf(activeId)}」移出「${labelOf(toolId)}」` });
		},
		[activeId, entries, graph, labelOf],
	);

	/** 新建组（同时设为当前激活组）。组名唯一 —— 服务端会以 DUPLICATE_GROUP 拒重名。 */
	const confirmCreate = useCallback((): void => {
		const taken = new Set(groups.map((one) => one.label));
		let index = counter + 1;
		let label = draftName.trim() === '' ? `新组 ${String(index)}` : draftName.trim();
		while (taken.has(label)) {
			index += 1;
			label = draftName.trim() === '' ? `新组 ${String(index)}` : `${draftName.trim()} ${String(index)}`;
		}
		setCounter(index);
		const id = `group:${label}`;
		setGraph((prev) => addNode(prev ?? emptyGraph(), { id, kind: 'group', label }));
		setActiveId(id);
		setDraftName('');
		setCreating(false);
		setNotice({ kind: 'ok', text: `已新建「${label}」并切换到它` });
	}, [counter, draftName, groups]);

	/* ── 工具清单页分页 ── */
	const filtered = useMemo(() => {
		/*
		 * 表里要能出现「图里已经存在的 tool」—— 包括右栏勾选时新建的节点，
		 * 不能只认初始那份清单。
		 */
		const known = new Map(entries.map((one) => [`tool:${one.name}`, one]));
		for (const node of graph?.nodes ?? []) {
			if (node.kind !== 'tool' || known.has(node.id)) continue;
			known.set(node.id, { name: node.label, source: node.source ?? '新加' });
		}
		const rows = [...known.entries()]
			.map(([id, one]) => ({ id, label: one.name, source: one.source }))
			.sort((a, b) => a.label.localeCompare(b.label));
		const query = toolQuery.trim().toLowerCase();
		return rows.filter(
			(one) => query === '' || one.label.toLowerCase().includes(query) || one.source.includes(toolQuery.trim()),
		);
	}, [entries, graph, toolQuery]);
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

	const hasActive = graph !== undefined && activeId !== undefined;
	const loading = graph === undefined && loadError === undefined;

	return (
		<div className="tb3g-root" data-testid="graph-editor">
			<header className="tb3g-head">
				<h1 className="tb3g-title">工具权限</h1>
				<p className="tb3g-sub">组是 tag：可以含任何工具、也可以含任何别的组 —— 只要不成环。只允许、不取消。</p>
				<div className="tb3g-tabs" role="tablist">
					<button
						type="button"
						role="tab"
						aria-selected={tab === 'group'}
						data-action="tab-group"
						className={`tb3g-tab${tab === 'group' ? ' is-on' : ''}`}
						onClick={() => setTab('group')}
					>
						编组
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={tab === 'auth'}
						data-action="tab-auth"
						className={`tb3g-tab${tab === 'auth' ? ' is-on' : ''}`}
						onClick={() => setTab('auth')}
					>
						授权
					</button>
				</div>
			</header>

			{tab === 'auth' ? (
				/* 授权页自带左右两栏（档位 / 模板 + 详情 + 编辑），不再挤进左栏 */
				<TemplateAuthPanel tools={entries} />
			) : (
				<div className="tb3g-graph">
					<aside className="tb3g-side tb3g-side--left">
						<div className="tb3g-side__head">
							<span>组</span>
							<span className="tb3g-side__hint">{hasActive ? '单选 = 正在编辑' : '先选一个组'}</span>
						</div>
						<div className="tb3g-scroll">
							{graph === undefined ? (
								<p className="tb3g-muted">{loadError === undefined ? '正在读取组图…' : '组图读不出来（原因见中栏）'}</p>
							) : groups.length === 0 ? (
								<p className="tb3g-muted" data-testid="no-groups">
									还没有任何组 —— 点下面「＋ 新建组」开始。
								</p>
							) : (
								groups.map((one) => {
									const isActive = one.id === activeId;
									const count = childrenOf(graph ?? emptyGraph(), one.id).length;
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
								})
							)}
						</div>
						{/*
						 * 图还没读到时**不给**新建入口：此时本地是空图，新建再保存会把
						 * 服务端已有的组覆盖掉。读取失败只能「重新读取」。
						 */}
						{graph === undefined ? null : creating ? (
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
								正在编辑：<strong data-testid="active-group-label">{active?.label ?? '（未选组）'}</strong>
								<span className="tb3g-crumb__hint">
									点组加入/移出 · 红色 = 会成环，不可点 · 白底卡是成员位（只读），工具在右栏勾
								</span>
							</div>
							<div className="tb3g-zoom">
								<SaveStatusBar state={saveState} onRetry={retrySave} />
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

						{loadError === undefined ? null : (
							<div className="tb3g-empty-state" data-testid="graph-load-error" role="alert">
								<p className="tb3g-empty-state__title">组图读不出来</p>
								<p className="tb3g-empty-state__text">{loadError}</p>
								<button type="button" className="tb3g-btn" data-action="reload-graph" onClick={() => setReloadToken((one) => one + 1)}>
									重新读取
								</button>
							</div>
						)}

						{loading ? <p className="tb3g-loading">正在读取组图…</p> : null}

						{loadError !== undefined || loading ? null : (
							<>
								<div className="tb3g-scroll">
									{displayGraph.nodes.length === 0 ? (
										<div className="tb3g-empty-state" data-testid="empty-canvas">
											<p className="tb3g-empty-state__title">
												{groups.length === 0 ? '画布还是空的' : '这个组还没有成员'}
											</p>
											<p className="tb3g-empty-state__text">
												{groups.length === 0
													? '在左栏「＋ 新建组」建第一个组。组与包含边会存到任务板服务端 —— 刷新页面改动还在。'
													: '在右栏勾工具，或者新建 / 选中别的组再点它（点组 = 把它加进当前组）。'}
											</p>
										</div>
									) : null}
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
											const isMember = activeGroups.has(node.id) || activeTools.has(node.id);
											const isBlocked = blocked.has(node.id);
											const cycle = blocked.get(node.id);
											const parents = graph === undefined ? 0 : graph.edges.filter((edge) => edge.to === node.id).length;
											const memberCount = isGroup && graph !== undefined ? childrenOf(graph, node.id).length : 0;
											return (
												<GraphNodeBox
													key={node.id}
													node={node}
													box={box}
													active={node.id === activeId}
													member={isMember}
													blocked={isBlocked}
													invalid={invalidTools.has(node.id)}
													parents={parents}
													memberCount={memberCount}
													{...(cycle === undefined ? {} : { cycleText: cycleText(cycle) })}
													{...(isGroup && !isBlocked && hasActive
														? { onToggle: () => toggleGroupMember(node.id) }
														: {})}
												/>
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
										<span className="tb3g-dot tb3g-dot--readonly" /> 成员位（只读）
									</span>
								</div>
							</>
						)}

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
						{hasActive ? null : <p className="tb3g-muted">先在左栏选一个组，右栏勾选才会生效。</p>}
						<div className="tb3g-scroll">
							{pageRows.map((one) => {
								const direct = activeTools.has(one.id);
								const inherited = !direct && inheritedTools.has(one.id);
								const checked = direct || inherited;
								const mark = direct ? 'direct' : inherited ? 'inherited' : 'none';
								const invalid = invalidTools.has(one.id);
								return (
									<label
										key={one.id}
										className={`tb3g-checkitem${checked ? ' is-checked' : ''}`}
										data-check={mark}
										data-invalid={invalid ? '1' : '0'}
										title={
											invalid
												? '宿主已经没有这个工具（已失效）—— 取消勾选可把它从组里删掉'
												: inherited
													? '由子组间接包含（勾上 = 直接加入当前组）'
													: undefined
										}
									>
										<input
											type="checkbox"
											data-tool-id={one.id}
											data-check={mark}
											checked={checked}
											disabled={!hasActive}
											onChange={(event) => toggleTool(one.id, event.target.checked)}
										/>
										<span className="tb3g-checkitem__name">{one.label}</span>
										<span className="tb3g-checkitem__src">{invalid ? '已失效' : one.source}</span>
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
			)}

			<div className="tb3g-debug" data-testid="graph-stats" aria-hidden="true">
				{JSON.stringify({
					nodes: graph?.nodes.length ?? 0,
					edges: graph?.edges.length ?? 0,
					active: activeId ?? null,
					save: saveState.kind,
					invalid: invalidTools.size,
				})}
			</div>
			<div className="tb3g-debug" data-testid="layout-debug" aria-hidden="true">
				{JSON.stringify({
					active: activeId ?? null,
					layers: layout.boxes.map((one) => ({ id: one.id, layer: one.layer })),
					blocked: [...blocked.keys()],
				})}
			</div>
		</div>
	);
}
