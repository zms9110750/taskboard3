/**
 * 工作空间 —— 容器。
 *
 * ## 它不知道里面有什么
 *
 * 用户口径：「工作空间是个容器，不关心里面长啥样。」
 * ⇒ 本模块**只**管：id、显示名、是否归档、创建时间。
 *   它不知道卡、不知道模板、不知道状态。
 *
 * ## 「激活」不在这里
 *
 * 用户 `2026-11-13`：「整个激活都只对 dsh 会话有效。mcp 是没法提供的。」
 * ⇒ 激活是**入口的默认参数策略**，不是领域概念。core 只认显式的 `workspaceId`。
 *
 * ## 一个空间一个 id，库文件不分空间
 *
 * 旧仓库是「一空间一 `.db`」。新实现用**一张 `cards` 表 + `workspace_id` 分区** ——
 * 因为存储端口只有四个操作，没有跨库事务的需求，而单库的运维成本低得多。
 *
 * ## 归档 = 标记
 *
 * 用户原话：「归档只是标记归档。从索引里面不列出。没有任何物理意义。
 * 并不会删除或转移。」
 * ⇒ 归档只写一个标记，库不移动、不删除，归档后的空间照样可读写。
 */

import type { WorkspaceId } from './card.ts';
import type { CardStore } from './ports.ts';

/** 一个工作空间。**容器，不关心内容。** */
export interface Workspace {
	readonly id: WorkspaceId;
	/** 用户输入的显示名（清洗后）。 */
	readonly displayName: string;
	/** 归档标记。归档 ≠ 失活；归档后照样可读写。 */
	readonly archived: boolean;
	/** 创建时间（毫秒）。 */
	readonly createdAt: number;
}

/** 全局 KV 里的键：全部空间（JSON 数组）。 */
const WORKSPACES_KEY = 'workspaces';

/** 全局 KV 里的键：下一个空间序号。 */
const NEXT_SEQ_KEY = 'workspaceSeq';

/** 读全部空间（内部用；含归档）。 */
// TODO(审查): `JSON.parse(...) as Workspace[]` 不校验元素形状（对比 index.ts 对策略 kv 有 readDelta/readFlag）⇒ 坏记录会让 `Workspace` 字段变 undefined；建议用 zod 统一清洗，可直接改。
function readAll(store: CardStore): readonly Workspace[] {
	const raw = store.kvGet(WORKSPACES_KEY);
	if (raw === undefined) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed) ? (parsed as Workspace[]) : [];
	} catch {
		return [];
	}
}

/** 写全部空间。 */
// TODO(审查): 所有空间改动都是 `readAll → 改数组 → writeAll` 整体覆盖（create/rename/archive）⇒ 多实例并发会丢更新；将来多进程需 kv 版本号或按空间分键，属架构改动，需用户决定。
async function writeAll(store: CardStore, list: readonly Workspace[]): Promise<void> {
	await store.kvSet(WORKSPACES_KEY, JSON.stringify(list));
}

/**
 * 清洗用户输入的名字。
 *
 * 规则：去首尾空白、把连续空白折成一个、去掉控制字符、最长 120 字符。
 * 空名 —— 调用方应当拒绝，这里返回空串让调用方判。
 */
export function sanitizeName(raw: string): string {
	return raw
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 120);
}

/** 列空间。 */
export function listWorkspaces(store: CardStore, includeArchived = false): readonly Workspace[] {
	const all = readAll(store);
	return includeArchived ? all : all.filter((one) => !one.archived);
}

/** 按 id 取空间。 */
export function getWorkspace(store: CardStore, id: WorkspaceId): Workspace | undefined {
	return readAll(store).find((one) => one.id === id);
}

/**
 * 建一个空间。
 *
 * id 用 `ws<N>`（N 是单调递增的序号）—— **不用显示名做 id**：
 * 显示名可以重名、可以改，而 id 一旦写进卡里就终身不变。
 */
export async function createWorkspace(
	store: CardStore,
	rawName: string,
	at: number,
): Promise<{ workspace: Workspace } | { error: 'NAME_EMPTY' | 'NAME_TAKEN' }> {
	const displayName = sanitizeName(rawName);
	if (displayName === '') return { error: 'NAME_EMPTY' };

	const all = readAll(store);
	if (all.some((one) => one.displayName === displayName)) return { error: 'NAME_TAKEN' };

	const rawSeq = store.kvGet(NEXT_SEQ_KEY);
	// TODO(审查): 坏值（如 'abc'）经 `Number()+1` 得 NaN ⇒ 生成 `wsNaN` 且之后永久 NaN；建议 Number.isSafeInteger 校验后重置/报错，可直接改。
	const seq = rawSeq === undefined ? 1 : Number(rawSeq) + 1;
	const id = `ws${seq}`;

	const workspace: Workspace = { id, displayName, archived: false, createdAt: at };
	await store.kvSet(NEXT_SEQ_KEY, String(seq));
	await writeAll(store, [...all, workspace]);
	return { workspace };
}

/** 归档 / 取消归档。幂等，返回标记是否真的变了。 */
export async function setArchived(
	store: CardStore,
	id: WorkspaceId,
	archived: boolean,
): Promise<{ changed: boolean } | { error: 'NOT_FOUND' }> {
	const all = readAll(store);
	const index = all.findIndex((one) => one.id === id);
	if (index < 0) return { error: 'NOT_FOUND' };
	const current = all[index] as Workspace;
	// TODO(审查): 本文件三处 `as Workspace`（此处、renameWorkspace 的 current 与返回值）都是 `noUncheckedIndexedAccess` 下的断言 ⇒ 可用已取到的对象拼返回免掉，可直接改。
	if (current.archived === archived) return { changed: false };

	const next = [...all];
	next[index] = { ...current, archived };
	await writeAll(store, next);
	return { changed: true };
}

/** 改显示名。 */
export async function renameWorkspace(
	store: CardStore,
	id: WorkspaceId,
	rawName: string,
): Promise<{ workspace: Workspace } | { error: 'NOT_FOUND' | 'NAME_EMPTY' | 'NAME_TAKEN' }> {
	const displayName = sanitizeName(rawName);
	if (displayName === '') return { error: 'NAME_EMPTY' };
	const all = readAll(store);
	const index = all.findIndex((one) => one.id === id);
	if (index < 0) return { error: 'NOT_FOUND' };
	if (all.some((one, i) => i !== index && one.displayName === displayName)) return { error: 'NAME_TAKEN' };

	const next = [...all];
	const current = all[index] as Workspace;
	next[index] = { ...current, displayName };
	await writeAll(store, next);
	return { workspace: next[index] as Workspace };
}

/**
 * 没有任何空间时建一个「默认」。
 *
 * ⚠ 这不是「全局默认空间」——用户明确说「不应该存在全局默认的垃圾堆」。
 * 这是**首次使用时的初始化**：建一次，之后 id 就固定在数据里，
 * 各入口的「默认值」由入口自己记（dsh 记在会话上，mcp 记在配置里）。
 */
export async function ensureAnyWorkspace(store: CardStore, at: number): Promise<Workspace> {
	const all = readAll(store);
	const first = all[0];
	if (first !== undefined) return first;
	const created = await createWorkspace(store, '默认', at);
	if ('workspace' in created) return created.workspace;
	// 竞态兜底：名字被占了就再读一次。
	const again = readAll(store)[0];
	if (again !== undefined) return again;
	throw new Error('建默认空间失败');
}


