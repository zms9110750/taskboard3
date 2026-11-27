/**
 * #4 查看定义。
 *
 * 用户要求：
 * > 一个参数输入名字。接受领域、状态、模板、分类。
 * > 另一个参数是枚举，范围就是前面 4 个，用于重名时指定类型。
 *
 * 用户后续裁决 #1：
 * > 名字可以不输入 —— 不输入 = 列出；给了枚举 = 只列出该分类下的东西。
 *
 * ⇒ 两种模式：
 * · `name` 省略/空 ⇒ 清单（可只列某一 type）；
 * · `name` 有值 ⇒ 详情；重名且没给 type ⇒ 失败并列出候选（让 AI 补 type）。
 */

import {
	DEFINITION_TYPES,
	candidatesText,
	findDefinitions,
	listText,
	allDefinitions,
	typeLabel,
	type DefinitionType,
} from '../definitions.ts';
import { inputFailure } from '../failure.ts';
import { okText } from '../schema.ts';
import type { TaskboardToolHandler } from '../types.ts';
import { defineTool, type ToolDeps } from './shared.ts';
import { str } from '../context.ts';

export function createDefinitionsTool(deps: ToolDeps): ReturnType<typeof defineTool> {
	const { taskboard } = deps;

	const handler: TaskboardToolHandler = async (args) => {
		const rawType = str(args, 'type');
		let type: DefinitionType | undefined;
		if (rawType !== undefined) {
			// TODO(审查): 「先断言成 string[] 再 includes，再 as DefinitionType」的两连击（本文件一处，create.ts/cards.ts 三处）。
			// 可直接改：写 isDefinitionType(rawType): rawType is DefinitionType 类型守卫，后一个 `as` 也一起消失。
			if (!(DEFINITION_TYPES as readonly string[]).includes(rawType)) {
				return inputFailure(
					`type「${rawType}」不认识；可用：${DEFINITION_TYPES.map((one) => `${one}（${typeLabel(one)}）`).join('、')}。`,
					'改成上面列出的枚举值后重试。',
				);
			}
			type = rawType as DefinitionType;
		}

		const name = str(args, 'name');
		if (name === undefined) {
			return okText(listText(allDefinitions(taskboard, type), type));
		}

		const matches = findDefinitions(taskboard, name, type);
		if (matches.length === 0) {
			return inputFailure(
				`没有名为「${name}」的定义${type === undefined ? '' : `（类型限定为 ${typeLabel(type)}）`}。`,
				'不传 name 调一次可以列出全部定义；拿到名字/ref 再查详情。',
			);
		}
		if (matches.length > 1) {
			return inputFailure(
				`「${name}」在 ${matches.length} 个类型里都有定义，需要给 type 指定是哪一种：\n${candidatesText(matches)}`,
				`补上 type（${[...new Set(matches.map((one) => one.type))].join(' / ')}）后重试。`,
			);
		}
		// TODO(审查): matches.length 已排除 0 和 >1，这个 `undefined` 分支**不可达** —— 它只为满足 noUncheckedIndexedAccess
		// 而存在，却生成一条用户永远看不到的错误（AGENTS 3.1 要求下标守卫后必须跟真实分支）。可直接改：
		// 用 `if (matches.length !== 1)` 一次收口，或 `const [only] = matches; if (!only) throw new Error('invariant')`。
		const only = matches[0];
		if (only === undefined) return inputFailure(`没有名为「${name}」的定义。`);
		return okText(only.detail);
	};

	return defineTool({
		name: 'taskboard_definitions',
		description:
			'查看定义。不传 name = 列出定义清单（可只列 type 指定的那类）；传 name = 查详情。' +
			'接受 4 类定义：domain（领域）、state（状态）、template（模板）、kind（分类）。' +
			'模板详情里有章节 key / action / 默认 payload —— 建卡前先用它看模板，再用 taskboard_create。' +
			'名字在不同类型里重名时，用 type 指定是哪一种。',
		inputSchema: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description:
						'定义名：领域 id/中文名、状态 id/中文名、模板 ref/显示名、分类 id/中文名。省略 = 列出清单。',
				},
				type: {
					type: 'string',
					enum: [...DEFINITION_TYPES],
					description: '限定定义类型：domain / state / template / kind。用于重名时消歧，或只看某一类清单。',
				},
			},
		},
		handler,
	});
}
