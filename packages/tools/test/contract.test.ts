/**
 * 契约测试 —— 只测「本包是什么」，不测业务行为。
 *
 * 守的是架构边界：
 * · 依赖只有 core / protocol；
 * · `src/` 不出现宿主模块（dsh-tools / cordis / express / zod / node:）；
 * · 11 个工具的名字与顺序稳定；
 * TODO(审查): 上面「11 个」已过期 —— 实际 9 个（下面 EXPECTED_NAMES 也是 9 个，两个权限工具搬去 dsh-agent-guard）。可直接改。
 * · `hosts` 元数据表达「仅 DSH」；
 * · schema 是静态纯 JSON Schema 且冻结。
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	createTaskboardToolRegistry,
	createTaskboardTools,
	textContentBlocks,
	TEXT_OUTPUT_SCHEMA,
	toolsForHost,
	type TaskboardTool,
} from '../src/index.ts';
import { makeFixture } from './support/fixtures.ts';

const PACKAGE_DIR = fileURLToPath(new URL('../', import.meta.url));

const EXPECTED_NAMES = [
	'taskboard_workspaces',
	'taskboard_cards',
	'taskboard_card',
	'taskboard_raw_card',
	'taskboard_definitions',
	'taskboard_create',
	'taskboard_update',
	'taskboard_update_note',
	'taskboard_transition',
] as const;

/** 需要 `workspaceId` 的工具（#1 列空间、#4 看定义不需要）。 */
const NEEDS_WORKSPACE = [
	'taskboard_cards',
	'taskboard_card',
	'taskboard_raw_card',
	'taskboard_create',
	'taskboard_update',
	'taskboard_update_note',
	'taskboard_transition',
] as const;

describe('包边界', () => {
	const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
	};

	it('dependencies 只有 @taskboard/core 与 @taskboard/protocol', () => {
		assert.deepEqual(manifest.dependencies, {
			'@taskboard/core': 'workspace:*',
			'@taskboard/protocol': 'workspace:*',
		});
		assert.equal(manifest.devDependencies, undefined);
		assert.equal(manifest.peerDependencies, undefined);
	});

	it('src/ 只 import 相对 .ts 与两个 @taskboard 包', () => {
		const files = listTsFiles(join(PACKAGE_DIR, 'src'));
		assert.ok(files.length >= 10, `src/ 只有 ${files.length} 个文件，像没写完`);
		const allowedPackages = new Set(['@taskboard/core', '@taskboard/protocol']);
		const specifiers = new Set<string>();
		for (const file of files) {
			const text = readFileSync(file, 'utf8');
			// TODO(审查): 这个正则只抓 `from '…'`，漏掉副作用导入 `import 'x'`、`export * from '…'`、动态 import()
			// —— 而「src/ 只 import 两个包」是硬边界，守卫有口子。可直接改：把 import/export/from 三种形式都扫一遍。
			for (const match of text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
				if (match[1] !== undefined) specifiers.add(match[1]);
			}
		}
		assert.ok(specifiers.size > 0, '没有抓到任何 import，正则可能失效了');
		for (const specifier of specifiers) {
			if (specifier.startsWith('./') || specifier.startsWith('../')) {
				assert.ok(specifier.endsWith('.ts'), `相对导入必须写 .ts：${specifier}`);
				continue;
			}
			assert.ok(allowedPackages.has(specifier), `出现了不允许的依赖「${specifier}」`);
		}
	});

	// TODO(审查): 这条**永不失败**：listTsFiles() 只收集 .ts（见文件尾），所以 `!(/\.(js|mjs|cjs)$/)` 恒真；
	// 后面 `assert.equal(new Set(...).size > 0, true)` 也恒真。等于没有守卫（AGENTS 3.5 的「静默失效」）。
	// 可直接改：先列全目录再按扩展名筛，断言「没有 .js/.mjs/.cjs」。
	it('源码里没有手写 .js 文件', () => {
		for (const file of listTsFiles(join(PACKAGE_DIR, 'src'))) {
			assert.ok(!/\.(?:js|mjs|cjs)$/u.test(file), `${file} 是手写 JS`);
		}
		assert.equal(new Set(listTsFiles(join(PACKAGE_DIR, 'src'))).size > 0, true);
	});
});

describe('工具注册面', () => {
	it('9 个工具，名字与顺序稳定（两个权限工具已按用户裁决搬到 dsh-agent-guard）', async () => {
		const fixture = await makeFixture();
		assert.deepEqual(
			fixture.tools.map((one) => one.name),
			[...EXPECTED_NAMES],
		);
	});

	it('每个工具都有名字、长描述、对象 schema、handler', async () => {
		const fixture = await makeFixture();
		for (const tool of fixture.tools) {
			assert.ok(tool.name.length > 0, tool.name);
			assert.ok(tool.description.length > 20, `${tool.name} 描述太短`);
			assert.equal(tool.inputSchema.type, 'object', tool.name);
			assert.equal(typeof tool.handler, 'function', tool.name);
			assert.ok(Object.isFrozen(tool.inputSchema), `${tool.name} 的 schema 没冻结`);
			for (const key of tool.inputSchema.required ?? []) {
				assert.ok(Object.hasOwn(tool.inputSchema.properties, key), `${tool.name} required 里有不存在的 ${key}`);
			}
			for (const [key, node] of Object.entries(tool.inputSchema.properties)) {
				assert.equal(typeof node, 'object', `${tool.name}.${key} 不是 schema 节点`);
			}
		}
	});

	/*
	 * 用户 `2026-11-22` 取消「激活空间」⇒ `resolveWorkspace` 对缺 `workspaceId` 一律报错。
	 * 所以 7 个需要空间的工具必须**如实**把 workspaceId 标成必填，并且描述里不能再许诺
	 * 「省略 = 宿主激活空间」（模型会照着省略参数，然后吃一个它没预料到的失败）。
	 */
	it('7 个需要空间的工具都如实把 workspaceId 标成必填，且不再许诺「激活空间」', async () => {
		const fixture = await makeFixture();
		const withWorkspace = fixture.tools.filter((one) => Object.hasOwn(one.inputSchema.properties, 'workspaceId'));
		assert.deepEqual(
			withWorkspace.map((one) => one.name),
			[...NEEDS_WORKSPACE],
		);
		for (const tool of withWorkspace) {
			assert.ok(
				(tool.inputSchema.required ?? []).includes('workspaceId'),
				`${tool.name} 没把 workspaceId 列进 required`,
			);
			assert.ok(
				tool.inputSchema.properties['workspaceId']?.description?.includes('必填') === true,
				`${tool.name}.workspaceId 的描述没写「必填」`,
			);
			assert.ok(!tool.description.includes('宿主激活空间'), `${tool.name} 的描述还在许诺激活空间`);
			assert.ok(
				!JSON.stringify(tool.inputSchema).includes('宿主激活空间'),
				`${tool.name} 的 schema 还在许诺激活空间`,
			);
		}
	});

	it('schema 静态：两次建出来逐字节相同', async () => {
		const a = await makeFixture();
		const b = await makeFixture();
		assert.equal(
			JSON.stringify(a.tools.map((one) => one.inputSchema)),
			JSON.stringify(b.tools.map((one) => one.inputSchema)),
		);
	});

	it('9 个工具都不再标 hosts（「仅 DSH」的两个已按用户裁决搬走）', async () => {
		const fixture = await makeFixture();
		for (const tool of fixture.tools) {
			assert.equal(tool.hosts, undefined, `${tool.name} 不该标 hosts`);
		}
	});
	it('关系类型与定义类型是封闭枚举（不随数据变）', async () => {
		const fixture = await makeFixture();
		const create = fixture.tools.find((one) => one.name === 'taskboard_create');
		const relationType = create?.inputSchema.properties['relations']?.items?.properties?.['type'];
		assert.deepEqual(relationType?.enum, [
			'parent',
			'dependsOn',
			'supersedes',
			'constrains',
			'related',
			'references',
		]);
		const definitions = fixture.tools.find((one) => one.name === 'taskboard_definitions');
		assert.deepEqual(definitions?.inputSchema.properties['type']?.enum, ['domain', 'state', 'template', 'kind']);
	});

	it('输出 schema 共用一份；textContentBlocks 同形', () => {
		assert.deepEqual(Object.keys(TEXT_OUTPUT_SCHEMA.properties), ['text']);
		assert.deepEqual(textContentBlocks({ text: 'x' }), [{ type: 'text', text: 'x' }]);
	});
});

describe('注册表 + 宿主过滤', () => {
	it('DSH 9 个、MCP 9 个（两个权限工具已搬到 dsh-agent-guard）', async () => {
		const fixture = await makeFixture();
		const dsh = createTaskboardToolRegistry(fixture.tools, { host: 'dsh' });
		const mcp = createTaskboardToolRegistry(fixture.tools, { host: 'mcp' });
		assert.equal(dsh.names.length, 9);
		assert.equal(mcp.names.length, 9);
		assert.equal(mcp.has('taskboard_tool_policy'), false);
		assert.equal(dsh.has('taskboard_tool_policy'), false);
		assert.deepEqual(
			toolsForHost(fixture.tools, 'mcp').map((one) => one.name),
			mcp.names,
		);
	});

	it('重复工具名 / 未知名字 ⇒ 抛（接线错误）', async () => {
		const fixture = await makeFixture();
		const duplicated = [fixture.tools[0], fixture.tools[0]] as readonly TaskboardTool[];
		assert.throws(() => createTaskboardToolRegistry(duplicated), /重复的工具名/);
		const registry = createTaskboardToolRegistry(fixture.tools, { host: 'mcp' });
		// TODO(审查): 这条断言在固化一句**已不成立**的错误文案：taskboard_tool_policy 不是「别的宿主才有」，
		// 而是搬到了 dsh-agent-guard（hosts 机制已空转，见 registry.ts / types.ts 的 TODO）。可直接改：只断言 /未知工具/ 足够。
		await assert.rejects(() => registry.invoke('taskboard_tool_policy'), /未知工具/);
	});
});

/** 递归列出一个目录下所有 .ts 文件。 */
function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listTsFiles(full));
		else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
	}
	return out;
}
