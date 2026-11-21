/**
 * 工具层的小工具：读参数、解析空间、取身份、宿主事实。
 *
 * 全部是**纯读取 + 显式失败**：不猜、不静默回落。
 */

import type { TaskboardToolContext, TaskboardToolResult } from './types.ts';
import { inputFailure } from './failure.ts';

/** 读字符串参数。 */
export function str(args: unknown, key: string): string | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === 'string' && value !== '' ? value : undefined;
}

/** 读字符串数组参数（过滤非字符串项）。 */
export function strs(args: unknown, key: string): readonly string[] | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	if (!Array.isArray(value)) return undefined;
	return value.filter((one): one is string => typeof one === 'string' && one !== '');
}

/** 读布尔参数（严格：只认 boolean）。 */
export function boolOf(args: unknown, key: string): boolean | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === 'boolean' ? value : undefined;
}

/** 读整数参数（非法 = undefined）。 */
export function intOf(args: unknown, key: string): number | undefined {
	if (typeof args !== 'object' || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/** 读任意参数。 */
export function rawOf(args: unknown, key: string): unknown {
	if (typeof args !== 'object' || args === null) return undefined;
	return (args as Record<string, unknown>)[key];
}

/** 对象参数（不是数组 / null）。 */
export function objectOf(args: unknown, key: string): Record<string, unknown> | undefined {
	const value = rawOf(args, key);
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

/** 解析空间的成功 / 失败判别联合。 */
export type WorkspaceResolution =
	| { readonly ok: true; readonly workspaceId: string }
	| { readonly ok: false; readonly result: TaskboardToolResult };

/**
 * 解析目标空间。
 *
 * ## 「空间为空」的唯一语义（用户前提）
 *
 * - 显式给了 `workspaceId` ⇒ 用它；
 * - 没给，宿主注入了 `resolveDefaultWorkspace` ⇒ 用宿主解析（DSH：激活空间）；
 * - 没给，宿主没注册这个行为 ⇒ **报错**（MCP 等），并告诉 AI 怎么自救：
 *   显式传 workspaceId，或先调 `taskboard_workspaces` 拿 id。
 *
 * ⚠ 不猜「第一个空间」：那会让写操作静默落到一个 AI 没确认的空间。
 */
export async function resolveWorkspace(
	args: unknown,
	ctx: TaskboardToolContext,
): Promise<WorkspaceResolution> {
	const explicit = str(args, 'workspaceId');
	if (explicit !== undefined) return { ok: true, workspaceId: explicit };

	const resolver = ctx.resolveDefaultWorkspace;
	if (typeof resolver === 'function') {
		try {
			const resolved = await resolver();
			if (typeof resolved === 'string' && resolved !== '') return { ok: true, workspaceId: resolved };
			return {
				ok: false,
				result: inputFailure('宿主的默认空间解析器返回了空值；这是宿主接线问题。', '显式传 workspaceId 后重试。'),
			};
		} catch (error) {
			return {
				ok: false,
				result: inputFailure(
					`宿主解析激活空间失败：${error instanceof Error ? error.message : String(error)}。`,
					'显式传 workspaceId 后重试。',
				),
			};
		}
	}

	return {
		ok: false,
		result: inputFailure(
			'当前宿主没有注册「空间为空 = 激活空间」的行为（MCP 等），所以必须显式给 workspaceId。',
			'显式传 workspaceId；不知道 id 就先调 taskboard_workspaces 列空间。',
		),
	};
}

/**
 * 取调用者身份。
 *
 * @returns 宿主给的名字；没给返回 `undefined`（由调用方决定是「失败」还是「可以继续」）
 */
export function holderOf(ctx: TaskboardToolContext): string | undefined {
	const holder = ctx.holder;
	return typeof holder === 'string' && holder !== '' ? holder : undefined;
}
