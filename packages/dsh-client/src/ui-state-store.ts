/**
 * UI 状态（组 + 折叠态）的**模块级单例 store** —— 快照**按空间键控**。
 *
 * ## 裁定（B-8；lead `2026-11-28` 定稿）
 *
 * 缺陷：本 store 是单例，但内部只有**一份**「当前快照」
 * （workspaceId + groups + folded + expanded）。三个入口（左侧栏全屏 / 抽屉 /
 * 右侧工作区页签）共享它 ⇒ 一个入口切了空间，另外两个入口**正在看的**空间被切走，
 * 而且它们的折叠 / 组操作会写到**切换后**的空间名下。
 *
 * 产品意图（`locale/zh.json` 里 dsh-client 的描述原话）：
 *
 * > 「同一个面板能在三处打开，各自独立：……
 * >   三处用同一份数据和同一套组件，但各持自己的选中状态：在一处切空间，
 * >   不会改掉另一处正在看的东西。」
 *
 * ⇒ 现状违背**已声明的**产品意图 ⇒ 改法（不另发明）：
 *
 * · **核心不变式**：对空间 X 的 `commit` / `saveNow` **永远只碰 X 的快照**，
 *   与任何入口「当前在看什么」无关。所以空间是**参数**，不是从某个全局字段读的。
 * · `snapshots: Map<workspaceId, UiStateSnapshot>` —— 每个空间一份快照，
 *   **只有对它的 commit / GET 会替换它**；别的空间变了，这个对象的**身份不变**
 *   ⇒ `useSyncExternalStore` 的订阅者不会因无关空间的变化而重渲染。
 * · **「哪个入口在看哪个空间」不在本 store 里**：由调用方持有
 *   （`Workspace` 的 `viewingId`），组件用 `useUiState(workspaceId)` 订阅自己那个键
 *   （见 `use-ui-state.ts`）。入口 A 切空间只换 A 的订阅键，碰不到 B 的键。
 * · 保存的防抖 / 在飞 PUT 也**按空间各一个槽**：一次 GET / PUT 只影响自己那个空间。
 *
 * ## 为什么仍然是模块级单例
 *
 * 用户 `2026-11-24`：「三出入口用同一的。内存都是一份数据。」
 *
 * ⇒ 三个入口读的是**同一个 store**（同一份 cache、同一份「每空间快照」）：
 *   两个入口看**同一个空间**时，一处改了组，另一处立刻看到。
 *   但「同一份数据」不等于「同一个当前空间」—— 后者是每个入口自己的事，
 *   这正是上面那条裁定的分界线。
 *
 * ## 为什么本文件不 import React
 *
 * 它要被 `node --test` 直接覆盖（保存的合并 / 防抖 / 失败回退都是真逻辑）。
 * React 绑定在 `use-ui-state.ts`：`useUiState(workspaceId)` 内部就是
 * `useSyncExternalStore(store.subscribe, () => store.getSnapshot(workspaceId))`
 * 加一次 `ensureLoaded(workspaceId)` 的 effect。**不要在组件里直接订阅本 store 的
 * 「快照」以外的全局量** —— 那等于又造一份「当前空间」。
 *
 * ## 保存策略
 *
 * · 改一次不立刻打网络 ⇒ **按空间防抖 300ms**（同一空间连点几下只发一次；
 *   两个空间各有自己的 timer 槽，互不取消）
 * · 失败**不回滚**：本地仍保留用户的整理结果，该空间的 `error` 里给出原因，
 *   下次改动会重试（回滚会让用户刚做的整理凭空消失，比「没存上」更糟）
 * · 每个空间**各存一份缓存**，切回来不丢，也不重复请求
 * · ⚠ **加载失败 ≠ 空状态**（裁定：todo-audit `2026-11-27` 逐行核实、`2026-11-28` 修复）：
 *   GET 失败**不写 cache、该空间 `loaded` 保持 false、不排任何保存**，写回路径
 *   `saveNow` 另有一道「该空间已成功加载过」的门禁（`loadedWorkspaces`）⇒ 服务端已保存的
 *   组 / 折叠态**绝不会**被一次失败的 GET 拿空状态覆盖。
 *   代价（有意的）：未加载期间的本地改动只留在内存，重新加载**成功后以服务端数据为准**
 *   —— 它不允许成为保存基线。
 */

import { buildPath } from './api.ts';
import {
	EMPTY_UI_STATE,
	parseUiState,
	toSaveBody,
	withFoldSetToggled,
	withFoldedToggled,
	withGroupAdded,
	withGroupRemoved,
	withGroupRenamed,
	withMemberAdded,
	withMemberRemoved,
	type TreeGroup,
	type UiStateData,
} from './pure/ui-state.ts';

/** 一小片 fetch 的窄接口（测试可注入）。 */
export interface UiStateFetch {
	(url: string, init?: { readonly method?: string; readonly body?: string; readonly headers?: Record<string, string> }): Promise<{
		readonly ok: boolean;
		readonly status: number;
		text(): Promise<string>;
	}>;
}

/**
 * **某一个空间**的 UI 状态快照（`useSyncExternalStore` 的快照）。
 *
 * ⚠ 快照是**按空间**的（见文件头的裁定）：`getSnapshot(ws1)` 与 `getSnapshot(ws2)`
 *   是两个对象，各自由 `ws1` / `ws2` 自己的 GET / commit 替换。
 */
export interface UiStateSnapshot {
	/** 这份快照属于哪个空间；`''` = 还没指到任何空间。 */
	readonly workspaceId: string;
	readonly groups: readonly TreeGroup[];
	readonly folded: readonly string[];
	/** 用户**强制展开**的 id（默认折叠判据不再折这些）。 */
	readonly expanded: readonly string[];
	/** 这个空间的数据取回来了吗（false ⇒ UI 可以显示占位）。 */
	readonly loaded: boolean;
	// TODO(审查): 这个 error 全 src 无消费方（TechTree.tsx / SiblingRelationPanel.tsx 只读 groups/folded/expanded）⇒ 读写失败界面上完全不可见；建议在 SiblingRelationPanel 顶部显示 error（或至少 console.warn），需用户决定是否要提示。
	/** 最近一次失败的原因；这个空间成功保存一次就清空。 */
	readonly error: string | undefined;
}

/** 构造参数。 */
export interface UiStateStoreOptions {
	/** 注入 fetch（测试用）；省略用全局 `fetch`。 */
	readonly fetchImpl?: UiStateFetch;
	/** 保存防抖毫秒数（测试用；默认 300）。 */
	readonly saveDelayMs?: number;
	/** 注入定时器（测试用；返回「取消」）。 */
	readonly schedule?: (run: () => void, delayMs: number) => () => void;
}

/**
 * store 的能力。
 *
 * ⚠ **每个读写操作都带 `workspaceId`** —— 这是本缺陷修复的形状：
 *   谁来操作、在哪个入口操作都不影响「写哪个空间」，只有传进来的 id 决定。
 */
export interface UiStateStore {
	/** 取某个空间的快照（同一空间在不变时返回**同一对象**，`useSyncExternalStore` 要求）。 */
	readonly getSnapshot: (workspaceId: string) => UiStateSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	/**
	 * 确保某个空间的快照已就绪（幂等）：已加载 ⇒ 什么都不做；在飞 ⇒ 复用；
	 * 否则清成「未加载」并发一次 GET。
	 *
	 * 取代旧的 `setWorkspace`：旧接口隐含「全局只有一个当前空间」，
	 * 本裁定之后**没有**这个全局量 —— 「我在看哪个空间」由调用方持有。
	 */
	readonly ensureLoaded: (workspaceId: string) => void;
	/**
	 * 立刻把挂起的保存发出去。
	 *
	 * 省略 `workspaceId` ⇒ **只在「有挂起保存」的空间里**各发一次（不遍历全部空间：
	 * 那会给没改过的空间发无意义的 PUT）。给了 `workspaceId` ⇒ 只处理那一个空间。
	 * 省略时逐空间处理，互不影响 —— 与「每空间一个 timer 槽」同一语义。
	 */
	readonly flush: (workspaceId?: string) => Promise<void>;
	readonly toggleFolded: (workspaceId: string, id: string) => void;
	/** 显式设置折叠态（维护 folded / expanded 互斥）。UI 用这个。 */
	readonly setFolded: (workspaceId: string, id: string, folded: boolean) => void;
	readonly addGroup: (workspaceId: string, group: TreeGroup) => void;
	readonly removeGroup: (workspaceId: string, groupId: string) => void;
	readonly renameGroup: (workspaceId: string, groupId: string, name: string | undefined) => void;
	readonly addMember: (workspaceId: string, groupId: string, cardId: string) => void;
	readonly removeMember: (workspaceId: string, groupId: string, cardId: string) => void;
}

/** 默认防抖毫秒数。 */
const DEFAULT_SAVE_DELAY_MS = 300;

/** 全局 fetch 适配成窄接口。 */
const globalFetch: UiStateFetch = (url, init) =>
	globalThis.fetch(url, {
		...(init?.method === undefined ? {} : { method: init.method }),
		...(init?.body === undefined ? {} : { body: init.body }),
		...(init?.headers === undefined ? {} : { headers: init.headers }),
	});

/** 一个「还没加载」的空快照（**每个空间一个独立对象** —— 快照同一性靠它）。 */
const emptySnapshotOf = (workspaceId: string): UiStateSnapshot => ({
	workspaceId,
	groups: EMPTY_UI_STATE.groups,
	folded: EMPTY_UI_STATE.folded,
	expanded: EMPTY_UI_STATE.expanded,
	loaded: false,
	error: undefined,
});

/** 一个「已加载」的快照。 */
const loadedSnapshotOf = (workspaceId: string, data: UiStateData): UiStateSnapshot => ({
	workspaceId,
	groups: data.groups,
	folded: data.folded,
	expanded: data.expanded,
	loaded: true,
	error: undefined,
});

// TODO(审查): listeners/subscribe 样板与 drawer-state.ts 重复（包内两份）；第三份 permission-box-state.ts 已随 2026-11-27 拆包搬去 @taskboard/dsh-permissions ⇒ 抽 `createExternalStore<T>()` 变**跨包**主题，需先裁定公共 helper 归属。另本 store 是「没有 inject 契约」的绕行，注释已说明原因，但没有任何守护阻止以后有人在组件里 `createUiStateStore()` 造第二份；建议加单例测试/注释守护。
/**
 * 造一个 store。
 *
 * @param options 注入点（测试用）
 */
export function createUiStateStore(options: UiStateStoreOptions = {}): UiStateStore {
	const doFetch = options.fetchImpl ?? globalFetch;
	const saveDelayMs = options.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS;
	const schedule =
		options.schedule ??
		((run: () => void, delayMs: number) => {
			const timer = setTimeout(run, delayMs);
			return () => {
				clearTimeout(timer);
			};
		});

	/** 每个空间一份缓存（切回来不丢、不重拉）。⚠ 只有**成功加载过**的空间才可写回，见 `loadedWorkspaces`。 */
	const cache = new Map<string, UiStateData>();
	/**
	 * 「服务端数据已成功取回」的空间 —— **唯一**允许写回的门禁。
	 *
	 * 裁定（todo-audit 2026-11-27 核实、2026-11-28 修复）：**加载失败 ≠ 空状态**。
	 * 加载失败不得触发任何写回；本地初始状态只有**加载成功之后**才允许作为保存基线。
	 *
	 * ⚠ 必须是**按空间**的集合。B-8 修复（2026-11-28）之后快照也按空间键控了，
	 *   这道门禁与「哪个入口在看什么」彻底无关：每个空间的写回只由它自己的加载结果决定。
	 */
	const loadedWorkspaces = new Set<string>();
	/**
	 * **每空间一份快照**（裁定 B-8，见文件头）。
	 *
	 * 不变式：对空间 X 的 commit / GET 只替换 `snapshots.get(X)`，**从不**替换别的键
	 * ⇒ 别的入口订阅的那个对象身份不变 ⇒ 它们不会因为这里的变化而重渲染。
	 */
	const snapshots = new Map<string, UiStateSnapshot>();
	const listeners = new Set<() => void>();
	/** 挂起的更新请求（同空间连续调用只保留最后一个）。 */
	const pendingLoad = new Map<string, Promise<void>>();
	/** 每个空间一个保存防抖槽（值是「取消」）。 */
	const saveTimers = new Map<string, () => void>();
	/** 每个空间最多一次在飞的 PUT。 */
	const saveInFlight = new Map<string, Promise<void>>();

	const emit = (): void => {
		for (const listener of listeners) listener();
	};

	/** 替换**某空间**的快照并广播（广播是给 React 用的；订阅者自己按 `getSnapshot(自己的键)` 判同一性）。 */
	const setSnapshot = (workspaceId: string, next: UiStateSnapshot): void => {
		snapshots.set(workspaceId, next);
		emit();
	};

	/**
	 * 取某空间的快照；没有就**建一个空的**并记住。
	 *
	 * ⚠ 这里在「读」里写 Map（在 React 渲染期也会发生）：它是**幂等的缓存填充**，
	 *   不 emit、不改数据。`useSyncExternalStore` 要求同一空间返回同一对象，
	 *   否则每次渲染都当成变了 ⇒ 无限重渲染。
	 */
	const snapshotOf = (workspaceId: string): UiStateSnapshot => {
		const existing = snapshots.get(workspaceId);
		if (existing !== undefined) return existing;
		const created = emptySnapshotOf(workspaceId);
		snapshots.set(workspaceId, created);
		return created;
	};

	const stateOf = (workspaceId: string): UiStateData => cache.get(workspaceId) ?? EMPTY_UI_STATE;

	/**
	 * 把「空间 + 新状态」写回缓存与**该空间的**快照；该空间已成功加载过才安排一次保存。
	 *
	 * ⚠ `workspaceId` 是**参数**（不是从某个全局「当前空间」读的）—— 这就是本缺陷的修复。
	 */
	const commit = (workspaceId: string, next: UiStateData): void => {
		if (workspaceId === '') return;
		cache.set(workspaceId, next);
		setSnapshot(workspaceId, {
			...snapshotOf(workspaceId),
			groups: next.groups,
			folded: next.folded,
			expanded: next.expanded,
		});
		/*
		 * 裁定（todo-audit 2026-11-27 核实、2026-11-28 修复）：**加载失败 ≠ 空状态**。
		 * 没成功加载过的空间连防抖都不排 —— 本地改动只留在内存，不成为保存基线；
		 * （重试）加载成功后以服务端数据为准。
		 */
		if (loadedWorkspaces.has(workspaceId)) scheduleSave(workspaceId);
	};

	const putState = async (workspaceId: string, data: UiStateData): Promise<void> => {
		const url = buildPath('ui-state');
		const body = JSON.stringify(toSaveBody(workspaceId, data));
		const response = await doFetch(url, {
			method: 'PUT',
			body,
			headers: { 'content-type': 'application/json' },
		});
		if (!response.ok) {
			throw new Error(`保存失败：HTTP ${String(response.status)}`);
		}
	};

	/**
	 * 保存**一个空间**的当前本地状态。
	 *
	 * @param workspaceId 要保存的空间（只碰这个空间的快照 / 缓存）
	 */
	const saveNow = async (workspaceId: string): Promise<void> => {
		if (workspaceId === '') return;
		const current = snapshotOf(workspaceId);
		/*
		 * 裁定（todo-audit 2026-11-27 核实、2026-11-28 修复）：**加载失败 ≠ 空状态**。
		 * 只有「服务端数据已成功取回」的空间才允许写回 —— 否则失败后被当成空状态的
		 * `groups` / `folded` 会 PUT 回去，覆盖用户已保存的整理结果。
		 * `loadedWorkspaces` 是真正的门禁；`snapshot.loaded` 是同一事实的 UI 可见标记
		 * （`flush()` 会绕过 `commit` 的防抖直接走到这里，所以这里必须再挡一次）。
		 */
		if (current.loaded !== true || !loadedWorkspaces.has(workspaceId)) return;
		/* 保存前先取**这一刻**的本地状态：期间又改了也没关系，下次还会存。 */
		const data = stateOf(workspaceId);
		try {
			await putState(workspaceId, data);
			/*
			 * 只清**这个空间**的 error。
			 *
			 * 旧实现这里要判 `snapshot.workspaceId === workspaceId`（共享快照可能已经被
			 * 另一个入口切走）；快照按空间键控之后这个判断**不再需要** —— 能改的只有它自己。
			 */
			setSnapshot(workspaceId, { ...snapshotOf(workspaceId), error: undefined });
		} catch (cause) {
			setSnapshot(workspaceId, {
				...snapshotOf(workspaceId),
				error: cause instanceof Error ? cause.message : String(cause),
			});
		}
	};

	/**
	 * 给**一个空间**排一次防抖保存。
	 *
	 * 每个空间一个 timer 槽：同空间连续改动只保留最后一次；另一个空间的 timer
	 * 不受影响（旧的单槽实现里，B 空间的改动会把 A 空间挂起的保存取消掉）。
	 *
	 * @param workspaceId 要保存的空间
	 */
	function scheduleSave(workspaceId: string): void {
		const cancelPrevious = saveTimers.get(workspaceId);
		if (cancelPrevious !== undefined) cancelPrevious();

		let cancelled = false;
		const cancel = schedule(() => {
			if (cancelled) return;
			saveTimers.delete(workspaceId);
			const running: Promise<void> = saveNow(workspaceId).finally(() => {
				/* 只清自己的槽：期间可能有更新的一次在飞。 */
				if (saveInFlight.get(workspaceId) === running) saveInFlight.delete(workspaceId);
			});
			saveInFlight.set(workspaceId, running);
		}, saveDelayMs);

		saveTimers.set(workspaceId, () => {
			cancelled = true;
			cancel();
			saveTimers.delete(workspaceId);
		});
	}

	/**
	 * GET 一个空间的服务端数据。
	 *
	 * 裁定（todo-audit 2026-11-27 逐行核实、2026-11-28 修复）：**加载失败 ≠ 空状态**。
	 *
	 * 失败路径以前把 cache 写成 `EMPTY_UI_STATE` 且 `loaded` 仍为 true ⇒ 用户之后
	 * 任意一次折叠 / 组操作（`commit` → `saveNow`）都会把空的 groups PUT 回服务端，
	 * 覆盖已保存的整理结果 —— 一次网络抖动就丢掉全部 UI 状态。
	 *
	 * 现在的契约：
	 * · GET 失败 ⇒ **不写 cache**、该空间快照 `loaded:false`、不排保存 ⇒ 不会有任何写回；
	 * · cache / 写回只认 `loadedWorkspaces` 里「成功加载过」的空间；
	 * · 未加载期间的本地改动**不是**保存基线，重新加载成功后以服务端数据为准。
	 *
	 * ⚠ B-8 之后「期间切走了没」的守卫（旧代码里的 `snapshot.workspaceId !== workspaceId`）
	 *   全部不需要了：快照按空间键控，写回的永远是**这个空间自己的**那个对象。
	 *
	 * @param workspaceId 要加载的空间
	 */
	const load = async (workspaceId: string): Promise<void> => {
		/* 只有成功加载过的缓存才可信：未加载时 `commit` 也会往 cache 写草稿，不能拿它冒充服务端数据。 */
		const cachedData = loadedWorkspaces.has(workspaceId) ? cache.get(workspaceId) : undefined;
		if (cachedData !== undefined) {
			setSnapshot(workspaceId, loadedSnapshotOf(workspaceId, cachedData));
			return;
		}

		const url = buildPath('ui-state', { workspace: workspaceId });
		try {
			const response = await doFetch(url);
			if (!response.ok) throw new Error(`读取失败：HTTP ${String(response.status)}`);
			const text = await response.text();
			let parsed: unknown;
			try {
				parsed = JSON.parse(text) as unknown;
			} catch {
				throw new Error('读取失败：服务端返回的不是 JSON');
			}
			const envelope = parsed as { ok?: unknown; data?: unknown };
			/*
			 * `ok` 不是 true ⇒ 服务端没交付数据（正常 200 由 dsh 的 `sendOk` 写成
			 * `{ok:true,data}`）⇒ 按**读取失败**处理，不能退化成空状态再被写回。
			 */
			if (envelope.ok !== true) throw new Error('读取失败：服务端未返回 ok');
			const data = parseUiState(envelope.data);
			cache.set(workspaceId, data);
			loadedWorkspaces.add(workspaceId);
			setSnapshot(workspaceId, loadedSnapshotOf(workspaceId, data));
		} catch (cause) {
			/*
			 * 裁定（同上）：**加载失败 ≠ 空状态** —— 这里**不写 cache**（写了就等于把「空」
			 * 当成这个空间的值，切回来还会命中缓存），`loaded` 保持 false ⇒ `commit`
			 * 不排保存、`saveNow` 挡住 `flush()`。服务端已保存的数据只能由下一次
			 * **成功**的 GET 交付。
			 */
			setSnapshot(workspaceId, {
				...emptySnapshotOf(workspaceId),
				error: cause instanceof Error ? cause.message : String(cause),
			});
		}
	};

	return {
		getSnapshot: (workspaceId) => snapshotOf(workspaceId),

		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		ensureLoaded: (workspaceId) => {
			if (workspaceId === '') return;
			/* 已经成功加载过（cache 命中）⇒ 快照本来就是它的，不用再动。 */
			if (snapshotOf(workspaceId).loaded) return;
			const existing = pendingLoad.get(workspaceId);
			if (existing !== undefined) {
				void existing;
				return;
			}
			/*
			 * 重新进入一个「未加载」的空间：先清成本空间的空快照（不信本地草稿，
			 * 见 `load()` 的契约），再发一次 GET。
			 *
			 * ⚠ 旧实现这里还会「先把上一个空间的挂起保存落掉」（`void saveNow()`）——
			 *   现在不需要了：每个空间有自己的 timer 槽，切走不取消、不丢；
			 *   而且这里也**不知道**谁在看什么，没有「上一个空间」这个概念。
			 */
			setSnapshot(workspaceId, emptySnapshotOf(workspaceId));
			const task = load(workspaceId).finally(() => {
				pendingLoad.delete(workspaceId);
			});
			pendingLoad.set(workspaceId, task);
		},

		flush: async (workspaceId) => {
			/*
			 * 语义选择（兼容现有调用方）：`flush()` 不传参 ⇒ flush **全部有挂起保存的空间**；
			 * 传参 ⇒ 只 flush 那一个。测试与「关面板前落盘」都用不传参那版。
			 */
			const targets =
				workspaceId === undefined
					? [...new Set([...saveTimers.keys(), ...saveInFlight.keys()])]
					: [workspaceId];
			for (const target of targets) {
				/* 先掐掉这个空间的防抖（它已经要立刻保存了）…… */
				const cancel = saveTimers.get(target);
				if (cancel !== undefined) cancel();
				/* ……再等这个空间在飞的那次 PUT，最后补一次。 */
				await (saveInFlight.get(target) ?? Promise.resolve());
				await saveNow(target);
			}
		},

		toggleFolded: (workspaceId, id) => {
			commit(workspaceId, withFoldedToggled(stateOf(workspaceId), id));
		},

		setFolded: (workspaceId, id, folded) => {
			commit(workspaceId, withFoldSetToggled(stateOf(workspaceId), id, folded));
		},

		addGroup: (workspaceId, group) => {
			commit(workspaceId, withGroupAdded(stateOf(workspaceId), group));
		},

		removeGroup: (workspaceId, groupId) => {
			commit(workspaceId, withGroupRemoved(stateOf(workspaceId), groupId));
		},

		renameGroup: (workspaceId, groupId, name) => {
			commit(workspaceId, withGroupRenamed(stateOf(workspaceId), groupId, name));
		},

		addMember: (workspaceId, groupId, cardId) => {
			commit(workspaceId, withMemberAdded(stateOf(workspaceId), groupId, cardId));
		},

		removeMember: (workspaceId, groupId, cardId) => {
			commit(workspaceId, withMemberRemoved(stateOf(workspaceId), groupId, cardId));
		},
	};
}

/**
 * 应用用的单例 —— **三个入口必须共用这一个**（用户：「内存都是一份数据」）。
 *
 * ⚠ 不要在组件里 `createUiStateStore()`；那会让抽屉和全屏各有一份。
 * ⚠ 但「共用这一份 store」≠「共用一个当前空间」：读的是自己的键
 *   （`getSnapshot(viewingId)` / `useUiState(viewingId)`），见文件头的裁定。
 */
export const uiStateStore: UiStateStore = createUiStateStore();
