/**
 * 「工具权限」页 —— 左侧栏第二个入口的页面外壳。
 *
 * ## 它负责什么
 *
 * ```
 *  ① 取工具清单（GET /taskboard3/api/tools，真实数据）
 *  ② 取不到就降级到内置夹具，并把失败原因显示出来（**不许静默**）
 *  ③ 说清「共 N 个工具、来自哪里」（issue #55）
 *  ④ 挂 <GraphEditor tools={entries} />（组图自己读 / 自己存，issue #58）
 * ```
 *
 * ## 为什么要在外壳里取数（而不是组件自己取）
 *
 * `GraphEditor` 用工具清单判断「哪些工具节点已失效」，并且一旦开始编辑就
 * **不该**因为清单重新拉取而重建画布（会把用户正在编辑的组冲掉）。
 * ⇒ 外壳负责等待，组件只在挂载时收一次清单。
 *
 * ## 为什么不用 `createApi()`
 *
 * `createApi()` 走的是标准信封 `{ ok, data }`；而 `/api/tools` 返回的是
 * **裸 `{ tools: [...] }`**（见 `@taskboard/dsh-agent-guard` 的 `handleToolsRequest`，
 * 它照 DSH 的 `schemas()` 形状给）。为了不为了一个端点去改公共信封，
 * 这里直接用 `buildPath()` + `fetch`。
 *
 * `fetch` 不带 `credentials` ⇒ 浏览器默认 `same-origin`，**同源请求自动带 cookie**，
 * 正好满足 `/api/tools` 的鉴权（它复用 DSH 的 `requestRejection`）。
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { buildPath } from '../../api.ts';
import { parseToolList } from '../../pure/tool-permission.ts';
import type { ToolEntry } from '../../pure/tool-permission.ts';
import { FALLBACK_TOOL_ENTRIES, GraphEditor } from './GraphEditor.tsx';
import { ToolPermissionShell, type ToolOrigin } from './ToolPermissionShell.tsx';

/** 取工具清单的三种结局。 */
export type ToolListState =
	| { readonly kind: 'loading' }
	| { readonly kind: 'ok'; readonly tools: readonly ToolEntry[] }
	| { readonly kind: 'fallback'; readonly reason: string };

/** 一次取数（失败返回原因字符串，不抛）。 */
export async function fetchToolList(signal: AbortSignal): Promise<readonly ToolEntry[] | string> {
	let response: Response;
	try {
		response = await fetch(buildPath('tools'), { signal, headers: { accept: 'application/json' } });
	} catch (cause) {
		if (cause instanceof DOMException && cause.name === 'AbortError') return '已取消';
		return `无法连接任务板服务：${cause instanceof Error ? cause.message : String(cause)}`;
	}
	if (!response.ok) return `服务返回 HTTP ${String(response.status)}`;
	let raw: unknown;
	try {
		raw = await response.json();
	} catch {
		return '服务返回了非 JSON 内容';
	}
	const parsed = parseToolList(raw);
	if (parsed === undefined) return '响应里没有可用的工具清单';
	return parsed;
}

/** 页面外壳。 */
export function ToolPermissionPage(): ReactNode {
	const [state, setState] = useState<ToolListState>({ kind: 'loading' });

	useEffect(() => {
		const controller = new AbortController();
		void (async () => {
			const result = await fetchToolList(controller.signal);
			if (controller.signal.aborted) return;
			setState(typeof result === 'string' ? { kind: 'fallback', reason: result } : { kind: 'ok', tools: result });
		})();
		return () => {
			controller.abort();
		};
	}, []);

	if (state.kind === 'loading') {
		return <p className="tb3g-loading">正在读取工具清单…</p>;
	}

	const tools = state.kind === 'ok' ? state.tools : FALLBACK_TOOL_ENTRIES;
	const origin: ToolOrigin = state.kind === 'ok' ? 'host' : 'fallback';

	return (
		<ToolPermissionShell
			tools={tools}
			origin={origin}
			{...(state.kind === 'fallback' ? { fallbackReason: state.reason } : {})}
		>
			<GraphEditor tools={tools} />
		</ToolPermissionShell>
	);
}
