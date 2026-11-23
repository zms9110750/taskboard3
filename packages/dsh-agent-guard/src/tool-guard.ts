/**
 * agent 侧工具调用权限 —— **不归 core**（用户 `2026-11-23` 裁决）。
 *
 * ## 为什么这个文件在 `@taskboard/dsh-tools` 而不是 `@taskboard/core`
 *
 * 用户原话：
 *
 * > 「而且我说了。权限，一个在core的ui里面。一个在agentui里面，
 * >   core完全不知道也不干涉agent的那一侧的注入权限。说白了，这个组件视图就不对。」
 *
 * 拆开看是两套**归属不同**的权限：
 *
 * ```
 * ① UI 权限（用户的）      CardActionLevel : no-claim / claim / adopt
 *    ⇒ 在 core：限制「AI 能不能领卡 / 采纳草稿」。用户点按钮授权。
 *
 * ② agent 侧权限（注入的）  ToolGuardLevel : off / manage / manage-edit
 *    ⇒ **在本文件**：实现者入侵 agent 时给某一个 agent 的注入权限。
 *      它是「任务板这个 mod 挂到 agent 工具管线上」这件事的产物 ——
 *      没有 agent 连接器（`ctx.tools.guard`）就没有它，所以它不能住在 core。
 * ```
 *
 * ⇒ core 只留自己那几个工具的放行表（`ToolPolicyStore` / `BASE_TOOLS` /
 *   `effectiveToolsOf`），**一个 `ToolGuardLevel` 字样都不该有**。
 *
 * ## 三档语义（用户 `2026-11-21`）
 *
 * | 档位 | 管不管工具 | 能否改档位权限 |
 * |---|---|---|
 * | `off` | 不管（一律放行） | ❌ |
 * | `manage` | 管（按 BASE / 三档 / 持有卡判） | ❌ |
 * | `manage-edit` | 管 | ✅ |
 *
 * ## ⚠ 与 DSH 自己的权限**互不干涉**
 *
 * 任务板既不读 DSH 的 sandbox / approval 权限项，也不往它的权限注册表里写东西。
 * 用户 `2026-11-14`：
 *
 * > 我说的是和dsh自己的权限互斥。只要开的是他自己或者别的插件提供的权限。
 * > 那么这个插件给的限制都不生效。
 *
 * ## ⚠ 存储的键沿用旧值
 *
 * `taskboard.permission.toolGuardLevel` —— **不换键**。
 * 换键等于把用户已配好的档位丢掉（静默回落 `off` = 突然不设防）。
 */

import type { CardActionLevel, ToolPolicyStore } from '@taskboard/core';
import { effectiveToolsOf, extrasOf, isBaseTool, isPolicyTool } from '@taskboard/core';

/* ────────────────────────── 档位 ────────────────────────── */

/** agent 侧档位：任务板管不管工具调用。 */
export type ToolGuardLevel = 'off' | 'manage' | 'manage-edit';

/** 默认档位：**默认不管工具**（用户没配之前任务板不主动限制）。 */
export const DEFAULT_TOOL_GUARD_LEVEL: ToolGuardLevel = 'off';

/** kv 键（沿用旧值，见文件头「存储的键沿用旧值」）。 */
export const TOOL_GUARD_LEVEL_KEY = 'taskboard.permission.toolGuardLevel';

/**
 * 全档位选项 —— 给 UI / HTTP 路由渲染用的唯一一份定义。
 *
 * ⚠ 用 `as const satisfies`，不用类型标注（AGENTS 3.5 / 3.7）：
 *   `satisfies` 让「`value` 写了个不存在的档位」编译失败；
 *   `as const` 保留字面量类型 ⇒ `TOOL_GUARD_LEVELS` 从它派生而不是再抄一份。
 */
export const TOOL_GUARD_OPTIONS = [
	{
		value: 'off',
		label: '任务板不管理',
		description: '任务板不拦截任何工具调用（领卡类动作仍受 UI 轴管）。',
	},
	{
		value: 'manage',
		label: '任务板管理权限',
		description: '按 BASE / 持有卡 / 三档策略判定工具调用。',
	},
	{
		value: 'manage-edit',
		label: '允许编辑档位权限',
		description: '在「管理权限」之上，额外允许 AI 读写档位权限工具。',
	},
] as const satisfies readonly {
	readonly value: ToolGuardLevel;
	readonly label: string;
	readonly description: string;
}[];

/** 合法值从选项常量派生，不在这里再抄一份。 */
export const TOOL_GUARD_LEVELS: readonly ToolGuardLevel[] = TOOL_GUARD_OPTIONS.map((one) => one.value);

/**
 * 从不可信的值里读一个档位。
 *
 * ⚠ **脏值 ⇒ 回落默认 + `console.warn`，不抛错** —— 一条坏记录不该让整个插件挂掉；
 *   但档位错会影响安全边界，静默回落会掩盖配置问题，所以要留痕。
 */
export function readToolGuardLevel(raw: string | undefined): ToolGuardLevel {
	if (raw === undefined) return DEFAULT_TOOL_GUARD_LEVEL;
	for (const choice of TOOL_GUARD_LEVELS) if (choice === raw) return choice;
	console.warn(
		`[taskboard3-tool-guard] 档位值非法（键 ${TOOL_GUARD_LEVEL_KEY}）：${raw}。回落「${DEFAULT_TOOL_GUARD_LEVEL}」。`,
	);
	return DEFAULT_TOOL_GUARD_LEVEL;
}

/** 把外部传入的值收窄成合法档位；非法返回 `undefined`（供 HTTP 校验用）。 */
export function parseToolGuardLevel(raw: unknown): ToolGuardLevel | undefined {
	if (typeof raw !== 'string') return undefined;
	return TOOL_GUARD_OPTIONS.find((one) => one.value === raw)?.value;
}

/* ────────────────────────── 存储 ────────────────────────── */

/**
 * 档位存储用的最小端口 —— 就是 `@taskboard/core` 的 `CardStore` 的 kv 两方法。
 *
 * ## 为什么用 store 的 kv，而不是自己开文件
 *
 * 这个插件行不该知道数据目录在哪（那是 `@taskboard/store` 的事）。
 * 复用 kv 端口 ⇒ 换存储实现时档位跟着走，且**键沿用旧值** ⇒ 老数据能读出来。
 */
export interface ToolGuardKv {
	kvGet(key: string): string | undefined;
	kvSet(key: string, value: string | undefined): Promise<void>;
}

/** 读档位。 */
export function readToolGuardLevelOf(kv: ToolGuardKv): ToolGuardLevel {
	return readToolGuardLevel(kv.kvGet(TOOL_GUARD_LEVEL_KEY));
}

/** 写档位（落 kv，下次启动仍在）。 */
export async function writeToolGuardLevel(kv: ToolGuardKv, level: ToolGuardLevel): Promise<void> {
	await kv.kvSet(TOOL_GUARD_LEVEL_KEY, level);
}

/* ────────────────────────── 判定 ────────────────────────── */

/** 一次判定。 */
export type ToolCallVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** 一次工具调用判定的输入。 */
export interface ToolCallJudgement {
	/** UI 轴：用户对任务板动作的授权档位（由 core 提供，本文件只读）。 */
	readonly cardLevel: CardActionLevel;
	/** agent 侧：任务板管不管工具调用。**本文件拥有它。** */
	readonly toolLevel: ToolGuardLevel;
	readonly toolName: string;
	/** 这个 agent 当前持有的工作卡。空的、或多于一张，都是有意义的状态。 */
	readonly heldCards: readonly { readonly templateRef: string }[];
}

/** 判定的外部事实（纯参数，不是注入的服务）。 */
export interface PermissionFacts {
	/** 三档策略。 */
	readonly policies: ToolPolicyStore;
}

/**
 * 判定一次工具调用 —— **纯函数**。
 *
 * ## 判定顺序（顺序本身是规则的一部分）
 *
 * ### 第一段 · 领卡类动作（**永远生效，与 `toolLevel` 无关**）
 *
 * | # | 条件 | 结果 |
 * |---|---|---|
 * | ① | `toolName === 'taskboard_release'` | **放行**（放手永远允许） |
 * | ② | `toolName === 'taskboard_claim'` 且 `cardLevel === 'no-claim'` | 拒绝 |
 * | ③ | `toolName === 'taskboard_adopt'` 且 `cardLevel !== 'adopt'` | 拒绝 |
 *
 * ### 第二段 · 其它工具（**只看 `toolLevel`**）
 *
 * | # | 条件 | 结果 |
 * |---|---|---|
 * | ④ | `toolLevel === 'off'` | **放行** |
 * | ⑤ | `toolName ∈ POLICY_TOOLS` | `manage-edit` ⇒ 放行；否则拒绝 |
 * | ⑥ | `toolName ∈ BASE_TOOLS` | **放行** |
 * | ⑦ | `heldCards` 为空 | 拒绝 |
 * | ⑧ | `heldCards` 多于一张 | 拒绝 |
 * | ⑨ | `toolName ∈ effectiveToolsOf(那张卡的模板)` | **放行** |
 * | ⑩ | 否则 | 拒绝 |
 *
 * ⚠ 第一段必须在第二段之前 —— 正交语义的实现。`toolLevel === 'off'`
 *   只说明「宿主不管理工具」，不等于「用户放开了领卡」。
 *
 * ⚠ ⑤ 在 ⑥ 之前 —— 权限管理工具能改写权限本身（等于「给自己发权限」）。
 *
 * ⚠ 没持有卡 / 多张卡 / 卡不授予 —— 三种拒绝的理由必须不同，AI 才能决定下一步。
 */
export function judgeToolCall(input: ToolCallJudgement, facts: PermissionFacts): ToolCallVerdict {
	const { cardLevel, toolLevel, toolName, heldCards } = input;

	/* ── 第一段：领卡类动作。永远先跑，完全不看 toolLevel。 ── */

	if (toolName === 'taskboard_release') return ALLOW;

	if (toolName === 'taskboard_claim') {
		if (cardLevel === 'no-claim') {
			return reject(
				`「${toolName}」不能执行：当前档位不允许领卡。` +
					'要领取工作卡，请把任务板档位调到「允许领卡」或「允许采纳草稿」。',
			);
		}
		return ALLOW;
	}

	if (toolName === 'taskboard_adopt') {
		if (cardLevel !== 'adopt') {
			return reject(
				`「${toolName}」不能执行：当前档位不允许采纳草稿。` +
					'只有「允许采纳草稿」档位才能由 AI 采纳草稿，其它档位要用户自己点采纳。',
			);
		}
		return ALLOW;
	}

	/* ── 第二段：其它工具。只看 toolLevel。 ── */

	if (toolLevel === 'off') return ALLOW;

	if (isPolicyTool(toolName)) {
		if (toolLevel === 'manage-edit') return ALLOW;
		return reject(
			`「${toolName}」是档位权限管理工具：改档位权限需要『允许编辑档位权限』。` +
				'当前宿主档位只允许按已有权限判定，不允许改写权限本身。',
		);
	}

	if (isBaseTool(toolName)) return ALLOW;
	if ((facts.policies.unclaimed ?? []).includes(toolName)) return ALLOW;

	if (heldCards.length === 0) {
		return reject(`「${toolName}」需要先持有一张工作卡；当前没有持有任何工作卡。`);
	}

	if (heldCards.length > 1) {
		const refs = heldCards.map((one) => one.templateRef).join('、');
		return reject(`同时持有多张工作卡（${refs}），无法判断该用哪一份额外权限；先释放到只剩一张。`);
	}

	const card = heldCards[0];
	/* 结构上走不到：上面已排除 0 张与多张。保留真实分支，不用 `as` 让编译器闭嘴。 */
	if (card === undefined) {
		return reject(`「${toolName}」需要先持有一张工作卡；当前没有持有任何工作卡。`);
	}
	const effective = effectiveToolsOf(facts.policies, card.templateRef);
	if (effective.includes(toolName)) return ALLOW;

	const extras = extrasOf(facts.policies, card.templateRef);
	const available =
		extras.length === 0 ? '（该模板没有额外权限）' : `（它有：${extras.join('、')}）`;
	return reject(
		`「${toolName}」需要持有工作卡授予的权限：当前卡「${card.templateRef}」不授予该工具${available}。`,
	);
}

/** 放行常量（复用，避免每次分配）。 */
const ALLOW: ToolCallVerdict = Object.freeze({ ok: true });

/** 造一个拒绝。 */
function reject(reason: string): ToolCallVerdict {
	return { ok: false, reason };
}
