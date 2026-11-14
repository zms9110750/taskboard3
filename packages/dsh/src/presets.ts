/**
 * 注册任务板的三个权限预设 —— **在运行时改 DSH 的预设表**。
 *
 * ## 为什么是「就地改表」而不是 patch 配置
 *
 * `@deepseek-ai/dsh-permission-presets` 的 config 里的 `presets` 是静态的：
 * 写 `cordis.patch.yml` 覆盖它会**替换整张表**（把 DSH 自带的
 * `workspace-write` / `danger-full-access` 挤掉），而且和别的插件抢同一个
 * 配置项。
 *
 * 官方**没有**「注册一个预设」的 API（只有 `registerAuto`，那个是给 Auto
 * 审核集成留的固定槽位）。所以只能拿 `ctx.permissionPresets.presets` 这张
 * 表就地加键 —— DSH 自己的插件也是这么干的（`@local/gate-switch12`）。
 *
 * ## 三条必须照抄的细节（来自 `gate-switch12`，每一条都有代价）
 *
 * | 细节 | 不这么做的后果 |
 * |---|---|
 * | 改表后 `emit('permission-presets/catalog-changed')` | 下拉栏的选项是缓存目录 ⇒ **看不到新预设** |
 * | 卸载时**只删自己的键** | 整表清空再按快照恢复，会把别的插件在我们挂载期间注册/删掉的档位一起抹掉 —— 那不是「清理自己」，是**回滚别人的工作** |
 * | 注册挂在 `ctx.effect` 上 | 插件禁用/热重载后预设还挂着，而 guard 已经没了 ⇒ 用户选了一个**不设防**的档位 |
 *
 * ## ⚠ 一个容易搞错的字段撞名
 *
 * | core 的 `BoardPreset` | DSH 预设表里的含义 |
 * |---|---|
 * | `name`（如 `taskboard-plan`） | 表的**键** |
 * | `label`（如 `任务版（计划）`） | 表项的 `name`（下拉栏显示名） |
 *
 * ⇒ 映射时 core 的 `name` → 表的 key，core 的 `label` → 表项的 `name`。
 *   写反了下拉栏会显示 `taskboard-plan` 这种机器名。
 */

import type { BoardPreset } from '@taskboard/core';
import { BOARD_PRESETS } from '@taskboard/core';

/**
 * DSH 预设表里一项的形状（`PresetSpec` 的字段子集）。
 *
 * ⚠ 本包不 import `@deepseek-ai/dsh-permission-presets` 的类型：npm 上没有与
 *   DSH 同版本，而且只用到这么几个字段。结构兼容即可。
 */
export interface PresetSpecLike {
	readonly sandbox: string;
	readonly approval: string;
	/** 下拉栏显示名。 */
	readonly name: string;
	readonly description: string;
}

/** 预设表（`ctx.permissionPresets.presets` 的最小形状）。 */
export interface PresetTableLike {
	presets: Record<string, PresetSpecLike>;
}

/**
 * core 的 `BoardPreset` → DSH 预设表的一项。
 *
 * 见文件头的「字段撞名」表：`label` 才是显示名。
 */
export function presetSpecOf(preset: BoardPreset): PresetSpecLike {
	return {
		sandbox: preset.sandbox,
		approval: preset.approval,
		name: preset.label,
		description: preset.description,
	};
}

/** 一次注册的结果：退订函数 + 我们自己写了哪些键（测试用）。 */
export interface BoardPresetInstall {
	/** 卸载：只还原我们写过的键。幂等。 */
	readonly dispose: () => void;
	/** 我们注册的预设名（= 表的键）。 */
	readonly names: readonly string[];
}

/**
 * 把任务板的三个预设装进 DSH 的预设表。
 *
 * @param target 预设服务（`ctx.permissionPresets`）
 * @param notify 发 `permission-presets/catalog-changed` 的回调
 * @param presets 要注册的预设（默认 core 的 `BOARD_PRESETS`；测试可注入）
 * @returns 卸载函数 + 注册的键名
 *
 * ⚠ 卸载**只动我们写过的键**：
 *   · 我们挂载前就有的键（`had === true`）⇒ 还原成原值；
 *   · 原本没有的 ⇒ 删掉。
 *   ⚠ 不整表替换、不清空重排 —— 那会回滚别的插件的工作（见文件头）。
 *
 * ⚠ `notify` 只在**真的改了表**之后调一次（不是每个键一次）：
 *   目录变更事件的语义是「目录变了，自己来重读」，一次就够了。
 */
export function installBoardPresets(
	target: PresetTableLike,
	notify: () => void,
	presets: readonly BoardPreset[] = BOARD_PRESETS,
): BoardPresetInstall {
	const table = target.presets;

	/* 记录每个键「我们进来之前」的状态 —— 卸载时按这个还原。 */
	const before = new Map<string, PresetSpecLike | undefined>();

	for (const preset of presets) {
		before.set(preset.name, Object.prototype.hasOwnProperty.call(table, preset.name) ? table[preset.name] : undefined);
		table[preset.name] = presetSpecOf(preset);
	}

	notify();

	let disposed = false;
	return {
		dispose: () => {
			if (disposed) return;
			disposed = true;
			for (const [name, previous] of before) {
				if (previous === undefined) delete table[name];
				else table[name] = previous;
			}
			notify();
		},
		names: presets.map((one) => one.name),
	};
}
