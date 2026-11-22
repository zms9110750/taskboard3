/**
 * 客户端状态 hook —— **只做「调 API + 存结果 + loading/error」**。
 *
 * ## 为什么不用 signals / mobx / 自研 store
 *
 * 用户要求「尽可能引外部库来减少内部实现代码」。React 自带 `useState` 就够了：
 * 任务板的数据量是「一次全量加载」（用户裁定），没有细粒度订阅的需求。
 *
 * ## 纯函数在 `pure.ts`
 *
 * 合并 / 初始化 / 查找这些**不含 React 的逻辑全部在 `pure.ts`**，
 * 这样才能被 `node --test` 直接覆盖（本文件 import 了 React，Node 加载不了）。
 *
 * ## 写操作后不重拉全量
 *
 * 服务端的写操作返回 `{ card, recomputed }`，UI 就地替换这几张卡。
 * 一次点按钮只有一次往返，不是「写 + 全量重读」。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createApi, type TaskboardApi } from './api.ts';
import {
	chooseInitialWorkspace,
	mergeActionResult,
	messageOf,
} from './pure.ts';
import type { ActionRequest, Card, StateData, TemplateSummary, Workspace } from './types.ts';

/** `useBoardState` 的状态。 */
export interface BoardState {
	/** 全部空间（含归档）。 */
	readonly workspaces: readonly Workspace[];
	/** 当前显示的空间 id；`''` = 还没有任何空间。 */
	readonly workspaceId: string;
	/** 当前空间的卡（不含墓碑）。 */
	readonly cards: readonly Card[];
	/** 模板清单。 */
	readonly templates: readonly TemplateSummary[];
	/** 首次加载中。 */
	readonly loading: boolean;
	/** 最近一次错误的人话说明（成功请求后清空）。 */
	readonly error: string | undefined;
	/** 正在进行的写操作数（> 0 时 UI 应禁用按钮）。 */
	readonly pending: number;
}

/** `useBoardState` 的动作。 */
export interface BoardActions {
	/** 切到另一个空间（只影响本 UI 的显示，不写任何"默认"）。 */
	switchWorkspace(workspaceId: string): void;
	/** 重新从服务端拉全量。 */
	reload(workspaceId?: string): void;
	/** 执行一个卡片动作，成功后就地合并。 */
	runAction(request: ActionRequest): Promise<boolean>;
	/** 新建空间并切过去。 */
	createWorkspace(name: string): Promise<boolean>;
	/**
	 * 归档 / 取消归档一个空间。
	 *
	 * ⚠ **归档掉正在查看的空间时**：`load()` 会按旧 id 重新拉 —— 那个空间
	 * 在 `listWorkspaces(false)` 里没了，`getState` 会回落。
	 * ⇒ 归档成功后**主动切到第一个可见空间**，不留一个"正在看不存在的东西"的状态。
	 *
	 * @param id 空间 id
	 * @param archived `true` = 归档，`false` = 取消归档
	 * @returns 成功了吗（失败时 `state.error` 有说明）
	 */
	setWorkspaceArchived(id: string, archived: boolean): Promise<boolean>;
	/** 清掉当前错误提示。 */
	clearError(): void;
}

/** hook 的完整返回。 */
export interface BoardHandle {
	readonly state: BoardState;
	readonly actions: BoardActions;
}

/** 初始状态。 */
const EMPTY: BoardState = Object.freeze({
	workspaces: Object.freeze([]) as readonly Workspace[],
	workspaceId: '',
	cards: Object.freeze([]) as readonly Card[],
	templates: Object.freeze([]) as readonly TemplateSummary[],
	loading: true,
	error: undefined,
	pending: 0,
});

/**
 * 任务板状态 hook。
 *
 * @param apiImpl 可选注入（测试 / 未来换通道）；省略则用 `createApi()`
 */
export function useBoardState(apiImpl?: TaskboardApi): BoardHandle {
	const apiRef = useRef<TaskboardApi>(apiImpl ?? createApi());
	const [state, setState] = useState<BoardState>(EMPTY);
	/** 当前空间 id 的镜像 —— 避免把 `reload` 绑到 state 上导致闭包过期。 */
	const workspaceRef = useRef('');

	/**
	 * 每发一次请求就自增；落状态前比对 —— 快速切空间时
	 * 早发的请求不能覆盖晚发的（否则会闪回旧空间的卡）。
	 */
	const loadSeq = useRef(0);

	const load = useCallback(async (workspaceId?: string): Promise<void> => {
		const seq = ++loadSeq.current;
		setState((prev) => ({ ...prev, loading: prev.cards.length === 0, error: undefined }));
		try {
			const data: StateData = await apiRef.current.getState(workspaceId);
			if (seq !== loadSeq.current) return;
			const nextId = chooseInitialWorkspace(data.workspaces, data.workspaceId);
			workspaceRef.current = nextId;
			setState({
				workspaces: data.workspaces,
				workspaceId: nextId,
				cards: data.cards,
				templates: data.templates,
				loading: false,
				error: undefined,
				pending: 0,
			});
		} catch (cause) {
			if (seq !== loadSeq.current) return;
			setState((prev) => ({ ...prev, loading: false, error: messageOf(cause) }));
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const switchWorkspace = useCallback(
		(workspaceId: string): void => {
			if (workspaceId === workspaceRef.current) return;
			workspaceRef.current = workspaceId;
			void load(workspaceId);
		},
		[load],
	);

	const reload = useCallback(
		(workspaceId?: string): void => {
			void load(workspaceId ?? workspaceRef.current);
		},
		[load],
	);

	const runAction = useCallback(async (request: ActionRequest): Promise<boolean> => {
		const workspaceId = workspaceRef.current;
		setState((prev) => ({ ...prev, pending: prev.pending + 1, error: undefined }));
		try {
			const result = await apiRef.current.act({ workspaceId, request });
			setState((prev) => ({
				...prev,
				cards: mergeActionResult(prev.cards, result),
				pending: Math.max(0, prev.pending - 1),
			}));
			return true;
		} catch (cause) {
			setState((prev) => ({
				...prev,
				pending: Math.max(0, prev.pending - 1),
				error: messageOf(cause),
			}));
			return false;
		}
	}, []);

	const createWorkspace = useCallback(
		async (name: string): Promise<boolean> => {
			setState((prev) => ({ ...prev, pending: prev.pending + 1, error: undefined }));
			try {
				const created = await apiRef.current.createWorkspace(name);
				await load(created.id);
				return true;
			} catch (cause) {
				setState((prev) => ({
					...prev,
					pending: Math.max(0, prev.pending - 1),
					error: messageOf(cause),
				}));
				return false;
			}
		},
		[load],
	);

	const clearError = useCallback((): void => {
		setState((prev) => (prev.error === undefined ? prev : { ...prev, error: undefined }));
	}, []);

	const setWorkspaceArchived = useCallback(
		async (id: string, archived: boolean): Promise<boolean> => {
			setState((prev) => ({ ...prev, pending: prev.pending + 1, error: undefined }));
			try {
				const result = archived
					? await apiRef.current.archiveWorkspace(id)
					: await apiRef.current.unarchiveWorkspace(id);

				/*
				 * 归档掉的是**正在看的那个空间** ⇒ 必须换一个，不能停在
				 * 「正在看一个已从列表消失的空间」上（那种状态下 `workspaceId`
				 * 指向的东西已经不在 `workspaces` 里了，UI 会自相矛盾）。
				 *
				 * 处理办法：**不指定空间重拉**。`getState()` 会让服务端按默认空间返回，
				 * 再由 `chooseInitialWorkspace()` 在返回的列表里挑一个可见的
				 * —— 这条路径本来就在 `load()` 里，不用在这里重新实现一遍。
				 *
				 * `changed: false` 时什么都不用做 —— 状态没变，重拉是浪费。
				 */
				if (!result.changed) {
					setState((prev) => ({ ...prev, pending: Math.max(0, prev.pending - 1) }));
					return true;
				}

				const wasViewing = id === workspaceRef.current;
				const next = workspaceRef.current === '' ? undefined : workspaceRef.current;

				if (archived && wasViewing) {
					/*
					 * 正在看的空间被归档 ⇒ `load()` 会让服务端给一律回默认空间，
					 * 再由 `chooseInitialWorkspace()` 挑一个可见的。
					 *
					 * ⚠ 但**必须先把 `workspaceRef` 清掉** —— 否则 `load()` 内部
					 *   仍会把它当「当前」，`chooseInitialWorkspace()` 拿到的是一个
					 *   刚被归档的 id，可能又被选回来。
					 */
					workspaceRef.current = '';
					await load(undefined);
				} else {
					await load(next);
				}
				return true;
			} catch (cause) {
				setState((prev) => ({
					...prev,
					pending: Math.max(0, prev.pending - 1),
					error: messageOf(cause),
				}));
				return false;
			}
		},
		[load],
	);

	return {
		state,
		actions: { switchWorkspace, reload, runAction, createWorkspace, setWorkspaceArchived, clearError },
	};
}
