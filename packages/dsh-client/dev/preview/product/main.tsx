/**
 * 产品入口预览 —— **跑的是 `WorkspaceBody` 本身**，不是 `Workspace`。
 *
 * ## 为什么需要这个预览
 *
 * 用户 `2026-11-22`：
 * > 「我看不懂。产品在哪？有入口吗？我一直在改 UI。你写了入口吗？如果写了，那就接。」
 *
 * `WorkspaceBody` 是「产品入口」——它把 `useBoardState()`（数据层）和
 * `<Workspace>`（界面）焊在一起。**但它自己没法在预览里直接跑**：
 *
 * ```
 * 预览页是 file://  ⇒  fetch('taskboard3/api/state') 必失败 ⇒ 永远显示「加载中」
 * ```
 *
 * ⇒ `WorkspaceBodyProps.api` 就是为此存在的：注入一个假 API，
 *   让**真的 body 组件**跑在假数据上。这样验证的是「接线对不对」，
 *   不是「`Workspace` 好不好看」（那是 `vp-full` 的事）。
 *
 * ## 这个预览证明什么
 *
 * | 证明 | 怎么证明 |
 * |---|---|
 * | 数据真的流进去了 | 假 API 的 `getState()` 被调用，卡渲染出来 |
 * | `loading` → 内容 的状态切换对 | 初次渲染是「正在加载」，100ms 后是列表 |
 * | 空间切换真的重新取数 | 点 chips ⇒ 假 API 记录第二次 `getState(newId)` |
 * | 没接的入口会说话 | 点「新建」/「归档」⇒ alert（预览里改成底部 toast）|
 *
 * ⚠ 它**不证明**的东西：真 HTTP、真服务端、真 AI 工具。那些要装进 DSH 才能测。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { initRenderers } from '../../../src/init-renderers.ts';
import { injectStyles } from '../../../src/styles.ts';
import type { TaskboardApi } from '../../../src/api.ts';
import type { Card, StateData, TemplateSummary, Workspace as SpaceEntity } from '../../../src/types.ts';
import { WorkspaceBody } from '../../../src/WorkspaceBody.tsx';

import { CARDS, TEMPLATES, WORKSPACES } from '../vp-drawer/main.tsx';

/* ══════════════════════════════════════════════════════════
   假 API —— 记录每次调用，让「接线对不对」可断言
   ══════════════════════════════════════════════════════════ */

/** 调用记录（预览底部打印 + CDP 可读 `window.__CALLS__`）。 */
interface CallLog {
	readonly method: string;
	readonly args: unknown;
}

const CALLS: CallLog[] = [];
(globalThis as unknown as { __CALLS__: CallLog[] }).__CALLS__ = CALLS;

/** 按空间 id 过滤卡（假数据里每张卡都有 workspaceId 之外的信息，这里简化：全给）。 */
function cardsOf(_workspaceId: string): readonly Card[] {
	return CARDS;
}

/**
 * 预览里的空间表 —— **可变副本**。
 *
 * `WORKSPACES` 是 `vp-drawer` 导出的夹具（只读）。归档要能改状态，
 * 所以这里复制一份；`fakeApi` 的 `getState` / `listWorkspaces` 都读它。
 */
const SPACES: SpaceEntity[] = WORKSPACES.map((one) => ({ ...one }));

/**
 * 预览里归档 / 取消归档 —— **真的改 `SPACES`**。
 *
 * 这样才验得出来「chip 变样式 / 从列表消失」；
 * 如果只是返回一个值，UI 行为验不到。
 *
 * @param id 空间 id
 * @param archived 目标状态
 */
function setArchivedInPreview(id: string, archived: boolean): {
	readonly changed: boolean;
	readonly workspace: SpaceEntity | undefined;
} {
	const index = SPACES.findIndex((one) => one.id === id);
	if (index === -1) return { changed: false, workspace: undefined };

	const current = SPACES[index];
	if (current === undefined) return { changed: false, workspace: undefined };
	if ((current.archived === true) === archived) {
		/* 幂等：已是目标状态 ⇒ changed: false，不改任何东西。 */
		return { changed: false, workspace: current };
	}

	const next: SpaceEntity = { ...current, archived };
	SPACES[index] = next;
	return { changed: true, workspace: next };
}

/**
 * 造一个假 API。
 *
 * @returns 满足 `TaskboardApi` 的对象，所有调用都记进 `CALLS`
 */
function fakeApi(): TaskboardApi {
	/** 每次 `getState` 延迟 80ms —— 让「加载中」这个状态真的出现一次。 */
	const delay = async (ms: number): Promise<void> =>
		new Promise((resolve) => {
			setTimeout(resolve, ms);
		});

	return {
		async getState(workspaceId?: string) {
			CALLS.push({ method: 'getState', args: workspaceId });
			await delay(80);
			const target = workspaceId ?? SPACES[0]?.id ?? '';
			const data: StateData = {
				workspaces: SPACES,
				workspaceId: target,
				cards: cardsOf(target),
				templates: TEMPLATES,
			};
			return data;
		},
		async listWorkspaces(): Promise<readonly SpaceEntity[]> {
			CALLS.push({ method: 'listWorkspaces', args: undefined });
			return SPACES;
		},
		async createWorkspace(name: string): Promise<SpaceEntity> {
			CALLS.push({ method: 'createWorkspace', args: name });
			return { id: `W${String(SPACES.length + 1)}`, displayName: name, archived: false, createdAt: Date.now() };
		},
		async createCard(input) {
			CALLS.push({ method: 'createCard', args: input });
			throw new Error('预览没接建卡');
		},
		/*
		 * 建卡页要取模板详情（章节清单）。
		 *
		 * ⚠ 这个预览**真的会走建卡流程**（点「新建」→ 表单 → 提交），
		 *   所以这里必须给真章节，不能 throw —— 否则建卡页一选模板就报错。
		 */
		async getTemplate(ref: string) {
			CALLS.push({ method: 'getTemplate', args: ref });
			const summary = TEMPLATES.find((one) => one.ref === ref);
			return {
				ref,
				displayName: summary?.displayName ?? ref,
				kind: summary?.kind ?? '',
				domain: summary?.domain ?? '',
				usage: '预览假模板',
				description: '',
				sections: [
					{ id: 'body', label: '正文', hint: '', action: 'text' },
					{ id: 'extra', label: '补充', hint: '', action: 'markdown' },
				],
				/*
				 * 派生菜单的数据（「+ 派生子任务」要读它）。
				 *
				 * ⚠ 预览里给**两条**：这样浮窗菜单能真的画出来给人看。
				 *   产品里这份来自模板 YAML 的 `derive:`（15/18 个模板有，
				 *   archive / delivery / demo 是 0 项 ⇒ 走兜底项）。
				 */
				derives: [
					{ label: '写测试', description: '先补测试再改', template: 'writeTests' },
					{ label: '调研', description: '查清再动手', template: 'research' },
				],
			};
		},
		async patchCard(input) {
			CALLS.push({ method: 'patchCard', args: input });
			throw new Error('预览没接 patch');
		},
		/*
		 * 归档 / 取消归档 —— 预览里**真的改**这份假数据，
		 * 否则「点一下 chip 变样式 / 从列表消失」验不出来。
		 *
		 * ⚠ `WORKSPACES` 是 `const` 数组，这里不是改它，是改 `fakeApi` 闭包里
		 *   持有的 `SPACES`（可变副本）。
		 */
		async archiveWorkspace(id: string) {
			CALLS.push({ method: 'archiveWorkspace', args: id });
			return setArchivedInPreview(id, true);
		},
		async unarchiveWorkspace(id: string) {
			CALLS.push({ method: 'unarchiveWorkspace', args: id });
			return setArchivedInPreview(id, false);
		},
		async act(input) {
			CALLS.push({ method: 'act', args: input });
			throw new Error('预览没接动作');
		},
		async renderCheck(registered: readonly string[]) {
			CALLS.push({ method: 'renderCheck', args: registered });
			return { required: [], missing: [] };
		},
	};
}

/* ══════════════════════════════════════════════════════════
   alert 拦截 —— 预览里换成底部 toast（alert 会卡住 headless）
   ══════════════════════════════════════════════════════════ */

function installToast(): void {
	const box = document.createElement('div');
	box.id = 'tb3-toast';
	box.style.cssText =
		'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:640px;padding:10px 16px;' +
		'border:1px solid #f0a44a;border-radius:8px;background:#fffbeb;color:#92400e;font:13px/1.6 sans-serif;' +
		'box-shadow:0 8px 24px rgb(15 23 42 / 12%);display:none;white-space:pre-wrap;z-index:9999';
	document.body.appendChild(box);

	globalThis.alert = (message?: unknown): void => {
		box.textContent = String(message ?? '');
		box.style.display = 'block';
		clearTimeout((box as unknown as { __timer: number }).__timer);
		(box as unknown as { __timer: number }).__timer = setTimeout(() => {
			box.style.display = 'none';
		}, 4000) as unknown as number;
	};
}

/* ══════════════════════════════════════════════════════════
   挂载
   ══════════════════════════════════════════════════════════ */

initRenderers();
injectStyles();
installToast();

const root = document.getElementById('root');
if (root !== null) {
	createRoot(root).render(
		<StrictMode>
			<div className="pv">
				<div className="pv-tabhead">
					右侧工作区 · <b>任务板</b> 页签 —— 这里跑的是产品入口 <code>WorkspaceBody</code>，
					API 换成了假数据（`file://` 下 fetch 必失败）
				</div>
				<div className="pv-scroll">
					<div className="pv-stage" style={{ width: '570px', height: '920px' }}>
						{/*
						 * 用真的产品入口组件，只把 API 换成假的。
						 *
						 * ⚠ 这是**唯一**允许注入 `api` 的地方 —— 产品里 `client.tsx` 不传。
						 */}
						<WorkspaceBody api={fakeApi()} />
					</div>
				</div>
			</div>
		</StrictMode>,
	);
}
