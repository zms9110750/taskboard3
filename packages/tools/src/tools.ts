/**
 * tool contract v2 的工具集合 —— 10 个工具（9 条用户定义 + 「看原始卡」）。
 *
 * 每个工具的实现都在 `tools/` 下单独一个文件；本文件只负责**顺序与装订**。
 * 顺序是契约的一部分（prompt 前缀按此字节序；改顺序等于改前缀）。
 *
 * | # | 工具 | 用户要求 |
 * |---|---|---|
 * | 1 | `taskboard_workspaces` | 列出空间 + 卡数 + includeArchived（DSH 额外给激活空间） |
 * | 2 | `taskboard_cards` | 列卡：空间 + 4 筛选 + 2 未读 bool + 标题搜索 + page |
 * | 3 | `taskboard_card` | 查看卡：编号强制、含草稿/墓碑、action 视图、查看即已读 |
 * | — | `taskboard_raw_card` | 看原始 JSON（用户后续裁决 #5：改卡前先确认结构） |
 * | 4 | `taskboard_definitions` | 查看定义：名字可空=列出；type 枚举消歧 |
 * | 5 | `taskboard_create` | 建卡：title + 模板 + 关系数组 + action JSON + 空模板 kind/domain |
 * | 6 | `taskboard_update` | JSON 路径替换（先 raw_card 再看路径） |
 * | 7 | `taskboard_update_note` | 更新备注 |
 * | 8 | `taskboard_transition` | 采纳 / 领取 / 释放 / 转移 + 空目标查条件目标 |
 * | 9 | `taskboard_tool_policy` | 仅 DSH：三 scope 工具权限（需 agent 侧开关） |
 */

import type { Taskboard } from '@taskboard/core';

import type { TaskboardTool } from './types.ts';
import { createCardTool } from './tools/card.ts';
import { createCardsTool } from './tools/cards.ts';
import { createCreateTool } from './tools/create.ts';
import { createDefinitionsTool } from './tools/definitions.ts';
import { createRawCardTool } from './tools/raw-card.ts';
import { createToolPolicyReadTool } from './tools/tool-policy-read.ts';
import { createToolPolicyTool } from './tools/tool-policy.ts';
import { createTransitionTool } from './tools/transition.ts';
import { createUpdateTool } from './tools/update.ts';
import { createUpdateNoteTool } from './tools/update-note.ts';
import { createWorkspacesTool } from './tools/workspaces.ts';

/**
 * 建全部工具（**名字与顺序都是契约**）。
 *
 * @param taskboard 领域实例（只调 core 的公开面）
 */
export function createTaskboardTools(taskboard: Taskboard): readonly TaskboardTool[] {
	const deps = { taskboard };
	return Object.freeze([
		createWorkspacesTool(deps),
		createCardsTool(deps),
		createCardTool(deps),
		createRawCardTool(deps),
		createDefinitionsTool(deps),
		createCreateTool(deps),
		createUpdateTool(deps),
		createUpdateNoteTool(deps),
		createTransitionTool(deps),
		createToolPolicyTool(deps),
		createToolPolicyReadTool(deps),
	]);
}
