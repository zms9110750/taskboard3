/**
 * 契约测试 —— 只测「本包是什么」，不测业务行为。
 *
 * 守的是架构边界：
 * · 依赖只有 core / protocol；
 * · `src/` 不出现宿主模块（dsh-tools / cordis / express / zod / node:）；
 * · 11 个工具的名字与顺序稳定；
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
	'taskboard_tool_policy',
	'taskboard_tool_policy_read',
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

	it('源码里没有手写 .js 文件', () => {
		for (const file of listTsFiles(join(PACKAGE_DIR, 'src'))) {
			assert.ok(!/\.(?:js|mjs|cjs)$/u.test(file), `${file} 是手写 JS`);
		}
		assert.equal(new Set(listTsFiles(join(PACKAGE_DIR, 'src'))).size > 0, true);
	});
});

describe('工具注册面', () => {
	it('11 个工具，名字与顺序稳定', async () => {
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

	it('schema 静态：两次建出来逐字节相同', async () => {
		const a = await makeFixture();
		const b = await makeFixture();
		assert.equal(
			JSON.stringify(a.tools.map((one) => one.inputSchema)),
			JSON.stringify(b.tools.map((one) => one.inputSchema)),
		);
	});

	it('「仅 DSH」用 hosts 元数据表达', async () => {
		const fixture = await makeFixture();
		const policy = fixture.tools.find((one) => one.name === 'taskboard_tool_policy');
		assert.notEqual(policy, undefined);
		assert.deepEqual(policy?.hosts, ['dsh']);
		for (const tool of fixture.tools) {
			if (tool.name === 'taskboard_tool_policy' || tool.name === 'taskboard_tool_policy_read') continue;
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
	it('DSH 11 个、MCP 9 个（#9 不出现）', async () => {
		const fixture = await makeFixture();
		const dsh = createTaskboardToolRegistry(fixture.tools, { host: 'dsh' });
		const mcp = createTaskboardToolRegistry(fixture.tools, { host: 'mcp' });
		assert.equal(dsh.names.length, 11);
		assert.equal(mcp.names.length, 9);
		assert.equal(mcp.has('taskboard_tool_policy'), false);
		assert.equal(dsh.has('taskboard_tool_policy'), true);
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
