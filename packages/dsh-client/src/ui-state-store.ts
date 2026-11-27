/**
 * UI 状态（组 + 折叠态）的**模块级单例 store**。
 *
 * ## 为什么是模块级单例
 *
 * 用户 `2026-11-24`：「三出入口用同一的。内存都是一份数据。」
 *
 * ⇒ 抽屉 / 右侧工作区 / 全屏三个入口读的是**同一个对象**，
 *   在任一处改了组，另两处立刻看到。**不要每个入口 new 一个**。
 *
 * ## 为什么本文件不 import React
 *
 * 它要被 `node --test` 直接覆盖（保存的合并 / 防抖 / 失败回退都是真逻辑）。
 * React 绑定留给调用方：`useSyncExternalStore(store.subscribe, store.getSnapshot)`。
 *
 * ## 保存策略
 *
 * · 改一次不立刻打网络 ⇒ **防抖 300ms**（用户连点几下只发一次）
 * · 失败**不回滚**：本地仍保留用户的整理结果，`error` 里给出原因，下次改动会重试
 *   （回滚会让用户刚做的整理凭空消失，比「没存上」更糟）
 * · 切换空间**各存一份缓存**，切回来不丢，也不重复请求
 * · ⚠ **加载失败 ≠ 空状态**（裁定：todo-audit 2026-11-27 逐行核实、2026-11-28 修复）：
 *   GET 失败**不写 cache、`loaded` 保持 false、不排任何保存**，写回路径 `saveNow`
 *   另有一道「该空间已成功加载过」的门禁（`loadedWorkspaces`）⇒ 服务端已保存的
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

/** `useSyncExternalStore` 的快照。 */
export interface UiStateSnapshot {
	/** 当前工作空间；`''` = 还没设。 */
	readonly workspaceId: string;
	readonly groups: readonly TreeGroup[];
	readonly folded: readonly string[];
	/** 用户**强制展开**的 id（默认折叠判据不再折这些）。 */
	readonly expanded: readonly string[];
	/** 这个空间的数据取回来了吗（false ⇒ UI 可以显示占位）。 */
	readonly loaded: boolean;
	// TODO(审查): 这个 error 全 src 无消费方（TechTree.tsx:686 / SiblingRelationPanel.tsx:63 只读 groups/folded/expanded）⇒ 读写失败界面上完全不可见；建议在 SiblingRelationPanel 顶部显示 error（或至少 console.warn），需用户决定是否要提示。
	/** 最近一次失败的原因；成功一次就清空。 */
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

/** store 的能力。 */
export interface UiStateStore {
	readonly getSnapshot: () => UiStateSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	/** 切到某个空间：有缓存就用缓存，没有就拉一次。 */
	readonly setWorkspace: (workspaceId: string) => void;
	/** 立刻把挂起的保存发出去（测试 / 关面板前用）。 */
	readonly flush: () => Promise<void>;
	readonly toggleFolded: (id: string) => void;
	/** 显式设置折叠态（维护 folded / expanded 互斥）。UI 用这个。 */
	readonly setFolded: (id: string, folded: boolean) => void;
	readonly addGroup: (group: TreeGroup) => void;
	readonly removeGroup: (groupId: string) => void;
	readonly renameGroup: (groupId: string, name: string | undefined) => void;
	readonly addMember: (groupId: string, cardId: string) => void;
	readonly removeMember: (groupId: string, cardId: string) => void;
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

	/** 每个空间一份缓存（切换回来不丢、不重拉）。⚠ 只有**成功加载过**的空间才可写回，见 `loadedWorkspaces`。 */
	const cache = new Map<string, UiStateData>();
	/**
	 * 「服务端数据已成功取回」的空间 —— **唯一**允许写回的门禁。
	 *
	 * 裁定（todo-audit 2026-11-27 核实、2026-11-28 修复）：**加载失败 ≠ 空状态**。
	 * 加载失败不得触发任何写回；本地初始状态只有**加载成功之后**才允许作为保存基线。
	 *
	 * ⚠ 必须是**按空间**的集合，不能只靠 `snapshot.loaded`：三个入口共享本单例
	 *   （见 `Workspace.tsx` 的 viewingId 同步），一个入口的加载失败会改写共享快照，
	 *   若只用快照标记，另一个入口的写回就会把失败空间的空态带到服务端。
	 */
	const loadedWorkspaces = new Set<string>();
	const listeners = new Set<() => void>();
	/** 挂起的更新请求（同空间连续调用只保留最后一个）。 */
	const pendingLoad = new Map<string, Promise<void>>();

	let snapshot: UiStateSnapshot = {
		workspaceId: '',
		groups: [],
		folded: [],
		expanded: [],
		loaded: false,
		error: undefined,
	};
	let cancelSave: (() => void) | undefined;
	let saveInFlight: Promise<void> | undefined;

	const emit = (): void => {
		for (const listener of listeners) listener();
	};

	const setSnapshot = (next: UiStateSnapshot): void => {
		snapshot = next;
		emit();
	};

	const stateOf = (workspaceId: string): UiStateData => cache.get(workspaceId) ?? EMPTY_UI_STATE;

	/** 把「当前快照 + 新状态」写回缓存与快照；该空间已成功加载过才安排一次保存。 */
	const commit = (next: UiStateData): void => {
		const workspaceId = snapshot.workspaceId;
		if (workspaceId === '') return;
		cache.set(workspaceId, next);
		setSnapshot({ ...snapshot, groups: next.groups, folded: next.folded, expanded: next.expanded });
		/*
		 * 裁定（todo-audit 2026-11-27 核实、2026-11-28 修复）：**加载失败 ≠ 空状态**。
		 * 没成功加载过的空间连防抖都不排 —— 本地改动只留在内存，不成为保存基线；
		 * （重试）加载成功后以服务端数据为准。
		 */
		if (loadedWorkspaces.has(workspaceId)) scheduleSave();
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

	const saveNow = async (): Promise<void> => {
		const workspaceId = snapshot.workspaceId;
		/*
		 * 裁定（todo-audit 2026-11-27 核实、2026-11-28 修复）：**加载失败 ≠ 空状态**。
		 * 只有「服务端数据已成功取回」的空间才允许写回 —— 否则失败后被当成空状态的
		 * `groups` / `folded` 会 PUT 回去，覆盖用户已保存的整理结果。
		 * `loadedWorkspaces` 是真正的门禁；`snapshot.loaded` 是同一事实的 UI 可见标记
		 * （`flush()` 会绕过 `commit` 的防抖直接走到这里，所以这里必须再挡一次）。
		 */
		if (workspaceId === '' || !snapshot.loaded || !loadedWorkspaces.has(workspaceId)) return;
		/* 保存前先取**这一刻**的本地状态：期间又改了也没关系，下次还会存。 */
		const data = stateOf(workspaceId);
		try {
			await putState(workspaceId, data);
			if (snapshot.workspaceId === workspaceId) setSnapshot({ ...snapshot, error: undefined });
		} catch (cause) {
			if (snapshot.workspaceId === workspaceId) {
				setSnapshot({
					...snapshot,
					error: cause instanceof Error ? cause.message : String(cause),
				});
			}
		}
	};

	function scheduleSave(): void {
		cancelSave?.();
		let cancelled = false;
		const cancel = schedule(() => {
			if (cancelled) return;
			cancelSave = undefined;
			saveInFlight = saveNow().finally(() => {
				saveInFlight = undefined;
			});
		}, saveDelayMs);
		cancelSave = () => {
			cancelled = true;
			cancel();
		};
	}

	/*
	 * 裁定（todo-audit 2026-11-27 逐行核实、2026-11-28 修复）：**加载失败 ≠ 空状态**。
	 *
	 * 失败路径以前把 cache 写成 `EMPTY_UI_STATE` 且 `loaded` 仍为 true ⇒ 用户之后
	 * 任意一次折叠 / 组操作（`commit` → `saveNow`）都会把空的 groups PUT 回服务端，
	 * 覆盖已保存的整理结果 —— 一次网络抖动就丢掉全部 UI 状态。
	 *
	 * 现在的契约：
	 * · GET 失败 ⇒ **不写 cache**、快照 `loaded:false`、不排保存 ⇒ 不会有任何写回；
	 * · cache / 写回只认 `loadedWorkspaces` 里「成功加载过」的空间；
	 * · 未加载期间的本地改动**不是**保存基线，重新加载成功后以服务端数据为准。
	 */
	const load = async (workspaceId: string): Promise<void> => {
		/* 只有成功加载过的缓存才可信：未加载时 `commit` 也会往 cache 写草稿，不能拿它冒充服务端数据。 */
		const cachedData = loadedWorkspaces.has(workspaceId) ? cache.get(workspaceId) : undefined;
		if (cachedData !== undefined) {
			setSnapshot({
				workspaceId,
				groups: cachedData.groups,
				folded: cachedData.folded,
				expanded: cachedData.expanded,
				loaded: true,
				error: undefined,
			});
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
			/* ⚠ 期间可能已经切到别的空间 ⇒ 只写缓存，不动快照。 */
			cache.set(workspaceId, data);
			loadedWorkspaces.add(workspaceId);
			if (snapshot.workspaceId !== workspaceId) return;
			setSnapshot({
				workspaceId,
				groups: data.groups,
				folded: data.folded,
				expanded: data.expanded,
				loaded: true,
				error: undefined,
			});
		} catch (cause) {
			if (snapshot.workspaceId !== workspaceId) return;
			/*
			 * 裁定（同上）：**加载失败 ≠ 空状态** —— 这里**不写 cache**（写了就等于把「空」
			 * 当成这个空间的值，切回来还会命中缓存），`loaded` 保持 false ⇒ `commit`
			 * 不排保存、`saveNow` 挡住 `flush()`。服务端已保存的数据只能由下一次
			 * **成功**的 GET 交付。
			 */
			setSnapshot({
				workspaceId,
				groups: [],
				folded: [],
				expanded: [],
				loaded: false,
				error: cause instanceof Error ? cause.message : String(cause),
			});
		}
	};

	return {
		getSnapshot: () => snapshot,

		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		setWorkspace: (workspaceId) => {
			if (snapshot.workspaceId === workspaceId && snapshot.loaded) return;
			/* 切换空间：先把上一个空间的挂起保存落掉，避免丢改动。 */
			if (snapshot.workspaceId !== '' && snapshot.workspaceId !== workspaceId) {
				cancelSave?.();
				cancelSave = undefined;
				void saveNow();
			}
			/*
			 * 只信「成功加载过」的缓存（裁定：加载失败 ≠ 空状态）。未加载时的草稿
			 * 不能把 `loaded` 置回 true —— 否则草稿就成了保存基线、把空态写回服务端。
			 */
			const cached = loadedWorkspaces.has(workspaceId) ? cache.get(workspaceId) : undefined;
			if (cached !== undefined) {
				setSnapshot({
					workspaceId,
					groups: cached.groups,
					folded: cached.folded,
					expanded: cached.expanded,
					loaded: true,
					error: undefined,
				});
				return;
			}
			setSnapshot({ workspaceId, groups: [], folded: [], expanded: [], loaded: false, error: undefined });
			const existing = pendingLoad.get(workspaceId);
			if (existing !== undefined) {
				void existing;
				return;
			}
			const task = load(workspaceId).finally(() => {
				pendingLoad.delete(workspaceId);
			});
			pendingLoad.set(workspaceId, task);
		},

		flush: async () => {
			cancelSave?.();
			cancelSave = undefined;
			await (saveInFlight ?? Promise.resolve());
			/* 防抖被取消后可能还有一次没发 ⇒ 直接发一次。 */
			await saveNow();
		},

		toggleFolded: (id) => {
			commit(withFoldedToggled(stateOf(snapshot.workspaceId), id));
		},

		setFolded: (id, folded) => {
			commit(withFoldSetToggled(stateOf(snapshot.workspaceId), id, folded));
		},

		addGroup: (group) => {
			commit(withGroupAdded(stateOf(snapshot.workspaceId), group));
		},

		removeGroup: (groupId) => {
			commit(withGroupRemoved(stateOf(snapshot.workspaceId), groupId));
		},

		renameGroup: (groupId, name) => {
			commit(withGroupRenamed(stateOf(snapshot.workspaceId), groupId, name));
		},

		addMember: (groupId, cardId) => {
			commit(withMemberAdded(stateOf(snapshot.workspaceId), groupId, cardId));
		},

		removeMember: (groupId, cardId) => {
			commit(withMemberRemoved(stateOf(snapshot.workspaceId), groupId, cardId));
		},
	};
}

/**
 * 应用用的单例 —— **三个入口必须共用这一个**（用户：「内存都是一份数据」）。
 *
 * ⚠ 不要在组件里 `createUiStateStore()`；那会让抽屉和全屏各有一份。
 */
export const uiStateStore: UiStateStore = createUiStateStore();
