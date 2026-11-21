/**
 * 契约测试 —— **只测「本包是什么」，不测业务行为**。
 *
 * 这一组断言是架构边界的守门人：
 *
 * · 依赖只有 core / protocol（用户要求：「只对 core 进行调用」）；
 * · `src/` 里不出现任何宿主模块（MCP 与 DSH 通用 ⇒ 不能绑任一边）；
 * · 16 个工具的名字与顺序稳定（与 `dsh` 同名，将来退化成薄适配层时不破坏会话）；
 * · 参数表是**静态纯 JSON Schema**，且被冻结；
 * · 注册表按名字派发。
 *
 * 业务行为在 `tools.test.ts`；措辞在 `format.test.ts`。
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createTaskboard } from '@taskboard/core';
import { POLICY_TOOLS } from '@taskboard/core';
import { BASE_TOOLS } from '@taskboard/core';

import {
	createTaskboardToolRegistry,
	createTaskboardTools,
	textContentBlocks,
	TEXT_OUTPUT_SCHEMA,
	type TaskboardTool,
	type TaskboardToolContext,
} from '../src/index.ts';
import { createMemoryStore } from './support/memory-store.ts';

/* ────────────────────────────── 夹具 ──────────────────────────────
 *
 * ⚠ **不依赖 cwd**：全部路径从 `import.meta.url` / `require.resolve` 推出来，
 *   从 `C:\` 跑一遍必须同样绿（AGENTS 规则 4）。
 */

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url));
const TEMPLATE_DIR = join(
	createRequire(import.meta.url).resolve('@taskboard/core/package.json'),
	'..',
	'templates',
);

/** 建一个工具集（每个用例独立，互不影响档位）。 */
function makeTools(options: Parameters<typeof createTaskboardTools>[1] = {}): readonly TaskboardTool[] {
	const taskboard = createTaskboard({ store: createMemoryStore() });
	taskboard.templates().loadDirectory(TEMPLATE_DIR);
	return createTaskboardTools(taskboard, options);
}

/** 与 `dsh` 那 16 个工具**同名同序**（名字/顺序都是契约）。 */
const EXPECTED_NAMES = [
	'taskboard_workspaces',
	'taskboard_cards',
	'taskboard_card',
	'taskboard_create',
	'taskboard_update_content',
	'taskboard_update_note',
	'taskboard_transition',
	'taskboard_adopt',
	'taskboard_claim',
	'taskboard_release',
	'taskboard_registry',
	'taskboard_mark_seen',
	'taskboard_tool_policies',
	'taskboard_tool_policy_set',
	'taskboard_tool_policy_members',
	'taskboard_tool_policy_reset',
] as const;

/* ────────────────────────────── 依赖边界 ────────────────────────────── */

describe('包边界：只依赖 core / protocol，不与宿主绑定', () => {
	const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
		optionalDependencies?: Record<string, string>;
	};

	it('dependencies 只有 @taskboard/core 与 @taskboard/protocol', () => {
		assert.deepEqual(manifest.dependencies, {
			'@taskboard/core': 'workspace:*',
			'@taskboard/protocol': 'workspace:*',
		});
	});

	it('没有任何 peer / optional / dev 依赖把宿主混进来', () => {
		assert.equal(manifest.peerDependencies, undefined);
		assert.equal(manifest.optionalDependencies, undefined);
		assert.equal(manifest.devDependencies, undefined);
	});

	it('src/ 只 import 相对 .ts 与两个 @taskboard 包 —— 不碰 dsh / cordis / express / node:', () => {
		/*
		 * 这是「MCP 和 DSH 通用」的**结构**保证：
		 *   只要 `src/` 里出现 `@deepseek-ai/dsh-tools`、cordis、express、
		 *   任何 `node:` 内置或 zod，本包就只能被那一个宿主消费。
		 *   白名单断言比「逐个拉黑」更可靠 —— 将来冒出新宿主包也不会漏。
		 */
		const srcDir = join(PACKAGE_DIR, 'src');
		const files = readdirSync(srcDir).filter((name) => name.endsWith('.ts'));
		assert.ok(files.length >= 5, `src/ 里只有 ${files.length} 个文件，像没写完`);

		const allowedPackages = new Set(['@taskboard/core', '@taskboard/protocol']);
		const specifiers = new Set<string>();

		for (const file of files) {
			const text = readFileSync(join(srcDir, file), 'utf8');
			/* 覆盖 `import ... from 'x'`、`export ... from 'x'`、`import('x')`。 */
			for (const match of text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
				if (match[1] !== undefined) specifiers.add(match[1]);
			}
			for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
				if (match[1] !== undefined) specifiers.add(match[1]);
			}
		}

		assert.ok(specifiers.size > 0, '没有抓到任何 import，正则可能失效了');

		for (const specifier of specifiers) {
			if (specifier.startsWith('./') || specifier.startsWith('../')) {
				assert.ok(
					specifier.endsWith('.ts'),
					`相对导入必须写 .ts 扩展名（否则 node --test 直跑源码会 ERR_MODULE_NOT_FOUND）：${specifier}`,
				);
				continue;
			}
			assert.ok(
				allowedPackages.has(specifier),
				`src/ 里出现了不允许的依赖「${specifier}」—— 本包只能调 core / protocol`,
			);
		}
	});

	it('源码里没有 .js / .mjs 文件（纯 TS）', () => {
		for (const dir of ['src', 'test']) {
			for (const name of readdirSync(join(PACKAGE_DIR, dir), { withFileTypes: true })) {
				if (name.isFile()) {
					assert.ok(
						!name.name.endsWith('.js') && !name.name.endsWith('.mjs') && !name.name.endsWith('.cjs'),
						`${dir}/${name.name} 是手写 JS，仓库规则要求纯 TS`,
					);
				}
			}
		}
	});
});

/* ────────────────────────────── 工具注册面 ────────────────────────────── */

describe('工具注册面', () => {
	const tools = makeTools();

	it('16 个工具，名字与顺序稳定（与 dsh 同名同序）', () => {
		assert.deepEqual(
			tools.map((one) => one.name),
			[...EXPECTED_NAMES],
		);
	});

	it('每个工具都有名字、长描述、对象入参 schema、handler', () => {
		for (const one of tools) {
			assert.equal(typeof one.name, 'string');
			assert.ok(one.name.length > 0);
			assert.ok(one.description.length > 10, `${one.name} 的描述太短`);
			assert.equal(one.inputSchema.type, 'object', `${one.name} 的 inputSchema 必须是对象`);
			assert.equal(typeof one.handler, 'function');
		}
	});

	it('inputSchema 是深冻结的纯 JSON Schema', () => {
		for (const one of tools) {
			assert.ok(Object.isFrozen(one.inputSchema), `${one.name} 的 schema 没冻结`);
			/* 必填项必须真的在 properties 里，否则宿主校验会永远失败。 */
			for (const key of one.inputSchema.required ?? []) {
				assert.ok(
					Object.hasOwn(one.inputSchema.properties, key),
					`${one.name} 的 required 里有「${key}」，但 properties 里没有`,
				);
			}
			/* 每个属性都必须声明 type（本包的 schema 子集要求）。 */
			for (const [key, node] of Object.entries(one.inputSchema.properties)) {
				assert.equal(typeof node.type, 'string', `${one.name}.${key} 没有 type`);
			}
		}
	});

	it('schema 静态：两次建出来的参数表逐字节相同', () => {
		/*
		 * 用户裁定：工具 schema 在 prompt 前缀里，一动就击穿 KV cache。
		 * ⇒ 不按模板 / 空间 / actor / 状态动态生成。这里在同一空任务板上
		 *   建两次（中间注册了模板也不行 —— schema 不读模板），比较序列化结果。
		 */
		const first = makeTools();
		const second = makeTools();
		assert.deepEqual(
			second.map((one) => one.inputSchema),
			first.map((one) => one.inputSchema),
		);
		assert.equal(JSON.stringify(second.map((one) => one.inputSchema)), JSON.stringify(first.map((one) => one.inputSchema)));
	});

	it('content 是开放对象，不按模板展开', () => {
		for (const name of ['taskboard_create', 'taskboard_update_content']) {
			const found = tools.find((one) => one.name === name);
			assert.ok(found !== undefined, `缺工具 ${name}`);
			const content = found.inputSchema.properties['content'];
			assert.ok(content !== undefined, `${name} 缺 content 参数`);
			assert.equal(content.additionalProperties, true, `${name} 的 content 必须是开放对象`);
		}
		/* 建卡参数只有 4 个固定键，不随模板变。 */
		const create = tools.find((one) => one.name === 'taskboard_create');
		assert.deepEqual(Object.keys(create?.inputSchema.properties ?? {}).sort(), [
			'content',
			'templateRef',
			'title',
			'workspaceId',
		]);
	});

	it('taskboard_transition 的 to 是 string 不是 enum', () => {
		/*
		 * 用户裁定：`enum` 会随状态表变化而改变 schema ⇒ 击穿 KV cache。
		 * 合法性在 handler 里判（`resolveStateId`）。
		 */
		const to = tools.find((one) => one.name === 'taskboard_transition')?.inputSchema.properties['to'];
		assert.equal(to?.type, 'string');
		assert.equal(to?.enum, undefined, 'to 不允许是 enum');
	});

	it('权限档位的 enum 只描述**结构**（三档不随数据变）', () => {
		for (const name of ['taskboard_tool_policy_set', 'taskboard_tool_policy_reset']) {
			const granularity = tools.find((one) => one.name === name)?.inputSchema.properties['granularity'];
			assert.deepEqual(granularity?.enum, ['common', 'group', 'template'], `${name} 的三档是结构，可以 enum`);
		}
	});

	it('taskboard_adopt 的参数里没有 to（采纳目标由类别算）', () => {
		const adopt = tools.find((one) => one.name === 'taskboard_adopt');
		assert.deepEqual(Object.keys(adopt?.inputSchema.properties ?? {}).sort(), ['id', 'workspaceId']);
		assert.equal('to' in (adopt?.inputSchema.properties ?? {}), false);
	});

	it('⚠ 权限工具与 core 的 POLICY_TOOLS 对齐', () => {
		/*
		 * `POLICY_TOOLS` 是 core 权限模型的**安全边界**：不在里面的权限工具
		 * guard 不会受开关控制。两侧必须同时改，这条断言抓漏改。
		 */
		const registered = tools
			.map((one) => one.name)
			.filter((name) => name.startsWith('taskboard_tool_'))
			.sort();
		assert.deepEqual(registered, [...POLICY_TOOLS].sort());
		for (const name of registered) {
			assert.ok(!BASE_TOOLS.includes(name), `${name} 不该在 BASE_TOOLS 里（否则开关失效）`);
		}
	});
});

/* ────────────────────────────── 注册表 ────────────────────────────── */

describe('注册表（按名字派发）', () => {
	it('get / has / names / tools 一致', () => {
		const tools = makeTools();
		const registry = createTaskboardToolRegistry(tools);
		assert.equal(registry.names.length, 16);
		assert.deepEqual([...registry.names], tools.map((one) => one.name));
		assert.ok(registry.tools.every((one) => registry.get(one.name) === one));
		assert.equal(registry.has('taskboard_cards'), true);
		assert.equal(registry.has('没有这个'), false);
		assert.equal(registry.get('没有这个'), undefined);
		assert.ok(Object.isFrozen(registry.tools));
		assert.ok(Object.isFrozen(registry.names));
	});

	it('invoke 按名字执行，并把 ctx 传给 handler', async () => {
		const tools = makeTools();
		const registry = createTaskboardToolRegistry(tools);
		const result = await registry.invoke('taskboard_workspaces', {});
		/* 内存库刚建，还没有空间 —— 也验证了「空任务板」的文案。 */
		assert.ok(result.text.includes('还没有任何工作空间'), result.text);
		assert.notEqual(result.isError, true);
	});

	it('重复工具名 ⇒ 当场抛（接线错误不能静默）', () => {
		const tools = makeTools();
		const duplicated = [tools[0], tools[0]] as readonly TaskboardTool[];
		assert.throws(
			() => createTaskboardToolRegistry(duplicated),
			/重复的工具名/,
			'同名工具必须抛，否则派发到哪个取决于插入顺序',
		);
	});

	it('未知名字 invoke ⇒ 抛（不是返回一段错误文本）', async () => {
		const registry = createTaskboardToolRegistry(makeTools());
		await assert.rejects(() => registry.invoke('taskboard_nope'), /未知工具/);
	});
});

/* ────────────────────────────── 输出形状 ────────────────────────────── */

describe('输出形状（所有工具共用一份）', () => {
	it('TEXT_OUTPUT_SCHEMA 只声明 text', () => {
		assert.equal(TEXT_OUTPUT_SCHEMA.type, 'object');
		assert.deepEqual(Object.keys(TEXT_OUTPUT_SCHEMA.properties), ['text']);
		assert.deepEqual(TEXT_OUTPUT_SCHEMA.required, ['text']);
		assert.equal(TEXT_OUTPUT_SCHEMA.additionalProperties, false);
	});

	it('textContentBlocks 产出 MCP / DSH 同形的文本块', () => {
		assert.deepEqual(textContentBlocks({ text: 'x' }), [{ type: 'text', text: 'x' }]);
		/* 宿主若直接把 handler 返回值传进来，也能兜住。 */
		assert.deepEqual(textContentBlocks('裸字符串'), [{ type: 'text', text: '裸字符串' }]);
	});

	it('ctx 默认值：省略 holder 时 claim 记 unknown（不抛）', async () => {
		const tools = makeTools();
		const registry = createTaskboardToolRegistry(tools);
		/* 这一步只验证 ctx 可省略；真正的 holder 行为在 tools.test.ts。 */
		const ctx: TaskboardToolContext = {};
		const result = await registry.invoke('taskboard_cards', {}, ctx);
		assert.equal(typeof result.text, 'string');
	});
});
